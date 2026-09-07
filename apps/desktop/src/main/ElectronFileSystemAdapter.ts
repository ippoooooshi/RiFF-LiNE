/**
 * FileSystemAdapter の Electron（Node.js）実装（web-core-foundation.md §3.3、data-model-persistence.md §3.3）。
 *
 * fs/promises をラップし、Node 固有のエラー（ENOENT / EACCES / EISDIR 等）を Webコアが扱える
 * 軽量エラークラス（FileNotFoundError / FileReadError / FileWriteError）へ変換する。
 * 生の Node エラーオブジェクトは境界の外へ出さない（electron.rule.md「エラー変換」）。
 * ルートパスはコンストラクタで受け取る（DI）。app.getPath 等の Electron API は main.ts 側で解決し、
 * 本クラスは electron に依存しない（テスト容易性と責務分離のため）。
 *
 * 最小版（readFile〜getRootPath）は「Webコア基盤構築」で確定。
 * 「データモデル・永続化」が renameFile / deleteFile / copyFile / exists を非破壊追加し、
 * readFile へオンデマンドダウンロード対策（§6、A5）をラップした。
 */

import {
  copyFile as fsCopyFile,
  mkdir,
  readFile as fsReadFile,
  readdir,
  rename as fsRename,
  rm as fsRm,
  stat,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

// platform サブパスから import する（バレル経由だと domain/rendering → alphaTab までメインプロセスに入るため）。
import { FileNotFoundError, FileReadError, FileWriteError } from '@riff-line/core/platform';
import type { DirEntry, FileSystemAdapter } from '@riff-line/shared-types';

import { retryOnEmptyRead } from './onDemandRetry';

/**
 * Node の fs エラーが持つ `code` 文字列（'ENOENT' / 'EACCES' 等）を安全に取り出す。
 * `code` を持たない値・非文字列 code・非オブジェクトが投げられた場合は `undefined`
 * （＝「不在ではない何らかの失敗」として扱い、呼び出し側で FileReadError/FileWriteError に倒す）。
 * テスト可能な縫い目として export する（typescript.rule.md）。
 */
export function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export interface ElectronFileSystemAdapterOptions {
  /**
   * readFile で空データ（クラウド同期のプレースホルダー疑い）が返ったときに指数バックオフでリトライするか
   * （data-model-persistence.md §6）。既定 true。本アプリは空ファイルを書かないため安全。
   * A5 実機検証・空ファイルを扱うテストでは false にできる。
   */
  retryOnDemandDownload?: boolean;
}

export class ElectronFileSystemAdapter implements FileSystemAdapter {
  /** ストレージルートの絶対パス。 */
  private readonly rootPath: string;
  private readonly retryOnDemandDownload: boolean;

  constructor(rootPath: string, options: ElectronFileSystemAdapterOptions = {}) {
    if (!isAbsolute(rootPath)) {
      throw new Error(`ElectronFileSystemAdapter requires an absolute root path (got: ${rootPath}).`);
    }
    this.rootPath = normalize(rootPath);
    this.retryOnDemandDownload = options.retryOnDemandDownload ?? true;
  }

  getRootPath(): string {
    return this.rootPath;
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    const absolute = this.toAbsolute(relativePath);
    // Node の Buffer を素の Uint8Array として返す（Webコアは Buffer を知らない）。
    const readOnce = async (): Promise<Uint8Array> => new Uint8Array(await fsReadFile(absolute));
    try {
      return this.retryOnDemandDownload ? await retryOnEmptyRead(readOnce) : await readOnce();
    } catch (error) {
      // 不在は FileNotFoundError、それ以外の読み取り失敗（EACCES / EISDIR / ENOTDIR、
      // およびオンデマンド実体化待ちの打ち切り）は FileReadError に正規化する（electron.rule.md）。
      throw errorCode(error) === 'ENOENT'
        ? new FileNotFoundError(relativePath, { cause: error })
        : new FileReadError(relativePath, { cause: error });
    }
  }

  async writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    const absolute = this.toAbsolute(relativePath);
    try {
      await fsWriteFile(absolute, data);
    } catch (error) {
      // ENOENT（親ディレクトリ不在）も含め、書き込み系の失敗は FileWriteError に正規化する。
      // リトライ判断は呼び出し元（アトミック書き込みロジック）の責務。
      throw new FileWriteError(relativePath, { cause: error });
    }
  }

  async listDirectory(relativePath: string): Promise<DirEntry[]> {
    const absolute = this.toAbsolute(relativePath);
    try {
      const names = await readdir(absolute);
      // 各エントリの stat も同じ try に含める。readdir 後にエントリが消える・壊れた
      // シンボリックリンク等の失敗も生の Node エラーとして外へ出さない。
      return await Promise.all(
        names.map(async (name): Promise<DirEntry> => {
          const info = await stat(join(absolute, name));
          return {
            name,
            isDirectory: info.isDirectory(),
            sizeBytes: info.isDirectory() ? 0 : info.size,
            modifiedAt: info.mtime.toISOString(),
          };
        }),
      );
    } catch (error) {
      // 不在は FileNotFoundError、それ以外（EACCES / ENOTDIR 等）は FileReadError に正規化する。
      throw errorCode(error) === 'ENOENT'
        ? new FileNotFoundError(relativePath, { cause: error })
        : new FileReadError(relativePath, { cause: error });
    }
  }

  async ensureDirectory(relativePath: string): Promise<void> {
    const absolute = this.toAbsolute(relativePath);
    try {
      await mkdir(absolute, { recursive: true });
    } catch (error) {
      throw new FileWriteError(relativePath, { cause: error });
    }
  }

  // ===== data-model-persistence.md §3.3 で非破壊追加 =====

  async renameFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = this.toAbsolute(fromRelativePath);
    const to = this.toAbsolute(toRelativePath);
    try {
      await fsRename(from, to);
    } catch (error) {
      throw errorCode(error) === 'ENOENT'
        ? new FileNotFoundError(fromRelativePath, { cause: error })
        : new FileWriteError(toRelativePath, { cause: error });
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    const absolute = this.toAbsolute(relativePath);
    try {
      // 既に無い場合も成功扱い（ゴミ箱の完全削除は冪等でよい）。
      await fsRm(absolute, { force: true });
    } catch (error) {
      throw new FileWriteError(relativePath, { cause: error });
    }
  }

  async copyFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = this.toAbsolute(fromRelativePath);
    const to = this.toAbsolute(toRelativePath);
    try {
      await fsCopyFile(from, to);
    } catch (error) {
      throw errorCode(error) === 'ENOENT'
        ? new FileNotFoundError(fromRelativePath, { cause: error })
        : new FileWriteError(toRelativePath, { cause: error });
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    // ルート外への `..` トラバーサルは他メソッドと同様、素の Error で即拒否する（try の外）。
    const absolute = this.toAbsolute(relativePath);
    try {
      await stat(absolute);
      return true;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false;
      // 権限不足等でアクセスできない場合も「無い」として扱わず、読み取り失敗として上げる。
      throw new FileReadError(relativePath, { cause: error });
    }
  }

  // ===== 内部ヘルパー =====

  /**
   * ルート相対パスを絶対パスへ解決する。
   * ルート外へ出る（`..` によるトラバーサル）指定は拒否する（安全側）。
   */
  private toAbsolute(relativePath: string): string {
    const absolute = resolve(this.rootPath, relativePath);
    const withSep = this.rootPath.endsWith(sep) ? this.rootPath : this.rootPath + sep;
    if (absolute !== this.rootPath && !absolute.startsWith(withSep)) {
      throw new Error(`Path escapes the storage root: ${relativePath}`);
    }
    return absolute;
  }
}
