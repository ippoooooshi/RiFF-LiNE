/**
 * FileSystemAdapter の Electron（Node.js）実装（web-core-foundation.md 3.2 節・7.2 節の①、data-model-persistence.md 10 節・10.1 節）。
 *
 * fs/promises をラップし、Node 固有のエラー（ENOENT / EACCES / EISDIR 等）を Webコアが扱える
 * 軽量エラークラス（FileNotFoundError / FileReadError / FileWriteError）へ変換する。
 * 生の Node エラーオブジェクトは境界の外へ出さない（electron.rule.md「エラー変換」）。
 * ルートパスはコンストラクタで受け取る（DI）。app.getPath 等の Electron API は main.ts 側で解決し、
 * 本クラスは electron に依存しない（テスト容易性と責務分離のため）。
 *
 * readFile へはオンデマンドダウンロード対策（data-model-persistence.md 16 節、A5）をラップしている。
 * <!-- req datamodelpersistence:c905f9d7.8498 -->
 * 7.2 節の①：main が fs/promises で読み書きする。6.2 節：iCloud Drive・Google Drive の同期フォルダもローカルのフォルダとして読み書きし、同期の処理・状態の確かめ・待ちはしない（中身の無いプレースホルダーを読んだときの短い読み直しは除く、data-model-persistence.md 16 節） <!-- req webcorefoundation:85290f71.083d --> <!-- req webcorefoundation:b3bce20b.330d --> <!-- req webcorefoundation:b3bce20b.c7b9 --> <!-- req webcorefoundation:b3bce20b.b7e2 --> <!-- req webcorefoundation:b3bce20b.ee95 --> <!-- req webcorefoundation:b3bce20b.1e16 --> <!-- req webcorefoundation:b3bce20b.ad71 -->
 */
// <!-- req webcorefoundation:6581ddd9.bb7d -->

// data-model-persistence.md 10 節：iCloud Drive と Google Drive for Desktop がこの PC の中に作る同期フォルダも、main が Node.js の fs で読み書きし、クラウドの API を呼ばない <!-- req datamodelpersistence:0b658915.de4f --> <!-- req datamodelpersistence:0b658915.58a8 --> <!-- req datamodelpersistence:0b658915.dba9 --> <!-- req datamodelpersistence:0b658915.7b3f --> <!-- req datamodelpersistence:0b658915.e6f5 --> <!-- req datamodelpersistence:0b658915.f8d5 -->
// data-model-persistence.md 10 節：クラウドの API の認証（トークンの管理を含む）とネットワークの例外の処理を持たない（import するのは node:fs/promises と node:path だけ） <!-- req datamodelpersistence:e6ec547d.bdc4 --> <!-- req datamodelpersistence:e6ec547d.08c2 --> <!-- req datamodelpersistence:e6ec547d.6e86 -->
// data-model-persistence.md 10 節：どの保存先でも完全オフラインで動き、ローカルのファイルの読み書きだけをして、同期は OS の側の同期クライアントに任せる <!-- req datamodelpersistence:3def7753.950e --> <!-- req datamodelpersistence:3def7753.4786 --> <!-- req datamodelpersistence:3def7753.4dda -->
import {
  copyFile as fsCopyFile,
  mkdir,
  open,
  readFile as fsReadFile,
  readdir,
  rename as fsRename,
  rm as fsRm,
  rmdir as fsRmdir,
  stat,
} from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

// platform サブパスから import する（バレル経由だと domain/rendering → alphaTab までメインプロセスに入るため）。
import { FileNotFoundError, FileReadError, FileWriteError } from '@riff-line/core/platform';
import type { DirEntry, FileSystemAdapter } from '@riff-line/core/platform';

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

/**
 * ルートの絶対パスを、同じフォルダなら同じ文字列になる形（末尾の区切りを除き、`..` を畳む）にそろえる。
 * ファクトリの使い回しの鍵にも使う（ElectronFileSystemAdapterFactory）。
 * @throws Error 絶対パスでないとき（メッセージにパスを入れない）
 */
// data-model-persistence.md 10.1 節：main は rootPath が絶対パスかを確かめる（fs:*At のルートもここを通る） <!-- req datamodelpersistence:140013f9.494d -->
export function resolveRootPath(rootPath: string): string {
  if (!isAbsolute(rootPath)) {
    throw new Error('ElectronFileSystemAdapter requires an absolute root path.');
  }
  return resolve(rootPath);
}

export interface ElectronFileSystemAdapterOptions {
  /**
   * readFile で空データ（クラウド同期のプレースホルダー疑い）が返ったときに指数バックオフでリトライするか
   * （data-model-persistence.md 16 節）。既定 true。本アプリは空ファイルを書かないため安全。
   * A5 実機検証・空ファイルを扱うテストでは false にできる。
   */
  retryOnDemandDownload?: boolean;
}

// <!-- req datamodelpersistence:8b0bd457.6dfc -->
// <!-- req datamodelpersistence:8b0bd457.ed73 -->
export class ElectronFileSystemAdapter implements FileSystemAdapter {
  /** ストレージルートの絶対パス。 */
  private readonly rootPath: string;
  private readonly retryOnDemandDownload: boolean;

  constructor(rootPath: string, options: ElectronFileSystemAdapterOptions = {}) {
    this.rootPath = resolveRootPath(rootPath);
    this.retryOnDemandDownload = options.retryOnDemandDownload ?? true;
  }

  // data-model-persistence.md 10.1 節：getRootPath はルートの絶対パスを返し、エラーにならない <!-- req datamodelpersistence:3feab5cc.8721 --> <!-- req datamodelpersistence:3feab5cc.4a7e -->
  getRootPath(): string {
    return this.rootPath;
  }

  // data-model-persistence.md 10.1 節：readFile はルートからの相対パス（区切りは /）の中身のバイト列を返し、無ければ FileNotFoundError、読めなければ FileReadError <!-- req datamodelpersistence:ffc64c81.e869 --> <!-- req datamodelpersistence:ffc64c81.3ece --> <!-- req datamodelpersistence:ffc64c81.1c93 --> <!-- req datamodelpersistence:ffc64c81.d820 -->
  async readFile(relativePath: string): Promise<Uint8Array> {
    const absolute = this.toAbsolute(relativePath);
    // Node の Buffer を素の Uint8Array として返す（Webコアは Buffer を知らない）。
    const readOnce = async (): Promise<Uint8Array> => new Uint8Array(await fsReadFile(absolute));
    try {
      // <!-- req datamodelpersistence:460bf076.4563 -->
      // <!-- req datamodelpersistence:460bf076.73ac -->
      return this.retryOnDemandDownload ? await retryOnEmptyRead(readOnce) : await readOnce();
    } catch (error) {
      // 不在は FileNotFoundError、それ以外の読み取り失敗（EACCES / EISDIR / ENOTDIR、
      // およびオンデマンド実体化待ちの打ち切り）は FileReadError に正規化する（electron.rule.md）。
      throw errorCode(error) === 'ENOENT'
        ? new FileNotFoundError(relativePath, { cause: error })
        : new FileReadError(relativePath, { cause: error });
    }
  }

  // data-model-persistence.md 10.1 節：writeFile は相対パスと中身を受け、書き終えたら閉じる前に FileHandle.sync() でディスクへ書き出し、書けなければ FileWriteError（書き直しはしない） <!-- req datamodelpersistence:41f12dc8.1cbe --> <!-- req datamodelpersistence:41f12dc8.39da --> <!-- req datamodelpersistence:41f12dc8.ff94 --> <!-- req datamodelpersistence:41f12dc8.4d59 --> <!-- req datamodelpersistence:41f12dc8.80b8 -->
  async writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    const absolute = this.toAbsolute(relativePath);
    try {
      // <!-- req datamodelpersistence:eb1ed8ce.b39e -->
      const handle = await open(absolute, 'w');
      try {
        // <!-- req datamodelpersistence:eb1ed8ce.cabc -->
        await handle.writeFile(data);
        // このあとの renameFile でアトミックに置き換える前に、中身がディスクに在るようにする（15 節の (b)）。
        // <!-- req datamodelpersistence:5bb436f2.7b64 -->
        // <!-- req datamodelpersistence:5bb436f2.9bf3 -->
        await handle.sync();
      } finally {
        // <!-- req datamodelpersistence:5bb436f2.8564 -->
        await handle.close();
      }
    } catch (error) {
      // ENOENT（親ディレクトリ不在）も含め、書き込み系の失敗は FileWriteError に正規化する。
      // 書き直しの判断は呼び出し元（15 節の AutoSaveScheduler）の責務。
      throw new FileWriteError(relativePath, { cause: error });
    }
  }

  // data-model-persistence.md 10.1 節：listDirectory は相対パスのフォルダの中の一覧を返し、無ければ FileNotFoundError、読めなければ FileReadError <!-- req datamodelpersistence:871924a2.106c --> <!-- req datamodelpersistence:871924a2.da4a --> <!-- req datamodelpersistence:871924a2.34c0 -->
  async listDirectory(relativePath: string): Promise<DirEntry[]> {
    const absolute = this.toAbsolute(relativePath);
    let names: string[];
    try {
      names = await readdir(absolute);
    } catch (error) {
      // フォルダそのものの不在だけを FileNotFoundError、それ以外（EACCES / ENOTDIR 等）は FileReadError に正規化する。
      throw errorCode(error) === 'ENOENT'
        ? new FileNotFoundError(relativePath, { cause: error })
        : new FileReadError(relativePath, { cause: error });
    }
    try {
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
      // フォルダは在るが中の項目の stat で一覧を作れない（readdir の後に項目が消えた・壊れたシンボリックリンク等）ときは、
      // ENOENT でも「フォルダが無い」ではないので FileReadError にする。生の Node エラーは外へ出さない。
      throw new FileReadError(relativePath, { cause: error });
    }
  }

  // data-model-persistence.md 10.1 節：ensureDirectory は相対パスのフォルダを親ごと作り、既にあってもエラーにせず、作れなければ FileWriteError <!-- req datamodelpersistence:8c7378fb.cf4c --> <!-- req datamodelpersistence:8c7378fb.f24a --> <!-- req datamodelpersistence:8c7378fb.a7b9 -->
  async ensureDirectory(relativePath: string): Promise<void> {
    const absolute = this.toAbsolute(relativePath);
    try {
      await mkdir(absolute, { recursive: true });
    } catch (error) {
      throw new FileWriteError(relativePath, { cause: error });
    }
  }

  // data-model-persistence.md 10.1 節：renameFile は同じルートの中で移し、移す後に在れば fs/promises の rename 1 回でアトミックに置き換える（消してから移す・写してから消すにしない）。移す前が無ければ FileNotFoundError、移せなければ FileWriteError <!-- req datamodelpersistence:5bd9c57f.3a78 --> <!-- req datamodelpersistence:5bd9c57f.6bed --> <!-- req datamodelpersistence:5bd9c57f.6892 --> <!-- req datamodelpersistence:5bd9c57f.1538 --> <!-- req datamodelpersistence:5bd9c57f.df55 --> <!-- req datamodelpersistence:5bd9c57f.e6be --> <!-- req datamodelpersistence:5bd9c57f.6751 -->
  async renameFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = this.toAbsolute(fromRelativePath);
    const to = this.toAbsolute(toRelativePath);
    try {
      await fsRename(from, to);
    } catch (error) {
      // ENOENT は「移す前が無い」と「移す後の親のフォルダが無い」の両方で起きるので、移す前を見て分ける。
      if (errorCode(error) === 'ENOENT' && (await isMissing(from))) {
        throw new FileNotFoundError(fromRelativePath, { cause: error });
      }
      throw new FileWriteError(toRelativePath, { cause: error });
    }
  }

  // data-model-persistence.md 10.1 節：deleteFile は相対パスのファイルを消し、無くてもエラーにせず、消せなければ FileWriteError <!-- req datamodelpersistence:e4805c47.70de --> <!-- req datamodelpersistence:e4805c47.0378 --> <!-- req datamodelpersistence:e4805c47.93c6 -->
  async deleteFile(relativePath: string): Promise<void> {
    const absolute = this.toAbsolute(relativePath);
    try {
      // 既に無い場合も成功扱い（ゴミ箱の完全削除は冪等でよい）。
      // <!-- req datamodelpersistence:e4805c47.bc37 -->
      await fsRm(absolute, { force: true });
    } catch (error) {
      throw new FileWriteError(relativePath, { cause: error });
    }
  }

  /**
   * 空のフォルダを消す（data-model-persistence.md 10.1 節、2026-10-27 本人決定）。deleteFile はフォルダを消さないので、
   * 空のフォルダはこちらで消す。fs/promises の rmdir は中が空でないフォルダを消さない（ENOTEMPTY）ので、中身ごと消すことは無い。
   * フォルダが無くてもエラーにしない（deleteFile と同じ。2026-10-27 チャット側の決定）。
   * 中が空でないとき・消せないとき（フォルダでないを含む）は FileWriteError。
   */
  // <!-- req datamodelpersistence:e4805c47.54ea -->
  async removeEmptyDirectory(relativePath: string): Promise<void> {
    const absolute = this.toAbsolute(relativePath);
    try {
      // <!-- req datamodelpersistence:e4805c47.3854 -->
      await fsRmdir(absolute);
    } catch (error) {
      // 既に無い場合も成功扱い（deleteFile と同じく、消す操作は冪等でよい）。
      // Windows ではファイルを指したときも ENOENT になるので、本当に無いかを見て分ける。
      // <!-- req datamodelpersistence:e4805c47.b4b9 -->
      if (errorCode(error) === 'ENOENT' && (await isMissing(absolute))) return;
      throw new FileWriteError(relativePath, { cause: error });
    }
  }

  // data-model-persistence.md 10.1 節：copyFile は同じルートの中で、写す前と後の相対パスを受けて写し、写せなければ FileWriteError <!-- req datamodelpersistence:beba094b.a8b5 --> <!-- req datamodelpersistence:beba094b.53f4 -->
  async copyFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = this.toAbsolute(fromRelativePath);
    const to = this.toAbsolute(toRelativePath);
    try {
      await fsCopyFile(from, to);
    } catch (error) {
      // 10.1 節の表は copyFile のエラーを「写せなければ FileWriteError」の 1 つだけにしている。
      // 写す前が無いとき（ENOENT）も写せなかったことに変わりないので、FileNotFoundError に分けない。
      throw new FileWriteError(toRelativePath, { cause: error });
    }
  }

  // data-model-persistence.md 10.1 節：exists は相対パスが在るかどうかを返し、調べられなければ FileReadError <!-- req datamodelpersistence:060ab66b.1d81 --> <!-- req datamodelpersistence:060ab66b.1c62 -->
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
  // data-model-persistence.md 10.1 節：main はルートの外（..）を指す相対パスを拒み、選んでいないフォルダの外を読み書きさせない <!-- req datamodelpersistence:140013f9.3aaf -->
  private toAbsolute(relativePath: string): string {
    const absolute = resolve(this.rootPath, relativePath);
    const withSep = this.rootPath.endsWith(sep) ? this.rootPath : this.rootPath + sep;
    if (absolute !== this.rootPath && !absolute.startsWith(withSep)) {
      throw new Error(`Path escapes the storage root: ${relativePath}`);
    }
    return absolute;
  }
}

/** 絶対パスが無いことを確かめる（stat が ENOENT で失敗したときだけ true）。 */
async function isMissing(absolute: string): Promise<boolean> {
  try {
    await stat(absolute);
    return false;
  } catch (error) {
    return errorCode(error) === 'ENOENT';
  }
}
