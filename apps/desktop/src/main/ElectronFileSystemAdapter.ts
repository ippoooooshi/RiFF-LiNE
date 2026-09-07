/**
 * FileSystemAdapter の Electron（Node.js）実装（web-core-foundation.md §3.3）。
 *
 * fs/promises をラップし、Node 固有のエラー（ENOENT / EACCES / EISDIR 等）を Webコアが扱える
 * 軽量エラークラス（FileNotFoundError / FileReadError / FileWriteError）へ変換する。
 * 生の Node エラーオブジェクトは境界の外へ出さない（electron.rule.md「エラー変換」）。
 * ルートパスはコンストラクタで受け取る（DI）。app.getPath 等の Electron API は main.ts 側で解決し、
 * 本クラスは electron に依存しない（テスト容易性と責務分離のため）。
 *
 * 本パッケージの範囲: フォルダ配下の読み書き・一覧・ディレクトリ用意のみ。
 * アトミック書き込み（一時ファイル→リネーム）・自動保存デバウンス・ゴミ箱・保存先切替は
 * 次パッケージ「データモデル・永続化」が本クラス／インターフェースを非破壊拡張する。
 */

import { mkdir, readFile as fsReadFile, readdir, stat, writeFile as fsWriteFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

// platform サブパスから import する（バレル経由だと rendering → alphaTab までメインプロセスに入るため）。
import { FileNotFoundError, FileReadError, FileWriteError } from '@tab-app/core/platform';
import type { DirEntry, FileSystemAdapter } from '@tab-app/shared-types';

/** Node のエラーは code プロパティ（'ENOENT' 等）を持つ。 */
function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export class ElectronFileSystemAdapter implements FileSystemAdapter {
  /** ストレージルートの絶対パス。 */
  private readonly rootPath: string;

  constructor(rootPath: string) {
    if (!isAbsolute(rootPath)) {
      throw new Error(`ElectronFileSystemAdapter requires an absolute root path (got: ${rootPath}).`);
    }
    this.rootPath = normalize(rootPath);
  }

  getRootPath(): string {
    return this.rootPath;
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    const absolute = this.toAbsolute(relativePath);
    try {
      const buffer = await fsReadFile(absolute);
      // Node の Buffer を素の Uint8Array として返す（Webコアは Buffer を知らない）。
      return new Uint8Array(buffer);
    } catch (error) {
      // 不在は FileNotFoundError、それ以外の読み取り失敗（EACCES / EISDIR / ENOTDIR 等）は
      // FileReadError に正規化する。生の Node エラーを Webコアへ漏らさない（electron.rule.md）。
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
      // リトライ判断は呼び出し元（次パッケージのアトミック書き込みロジック）の責務。
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
