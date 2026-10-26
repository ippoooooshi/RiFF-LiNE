/**
 * レンダラー側の IPC 経由 FileSystemAdapter（data-model-persistence.md 10.1 節の (b)、B31 の (c)）。
 *
 * `window.riffLineApi.fsAt`（preload 公開 API）だけに依存し、`electron` / `node:*` は import しない
 * （layer-architecture.rule.md）。`@riff-line/core` の永続化サービス群へ注入する。
 * 7.2 節の①：レンダラーの側のクラスが IPC で main のファイル I/O を呼ぶ <!-- req webcorefoundation:85290f71.6f2d --> <!-- req webcorefoundation:a23f31ef.6c9a -->
 *
 * IPC の reject では独自エラークラスの identity が失われる（構造化クローン）ため、
 * メインが投げた軽量エラークラス名をエラーメッセージから読み取り、対応する型へ復元する。
 */

// data-model-persistence.md 10.1 節：preload が出す window.riffLineApi の呼び口だけに頼り、electron と Node.js の組み込みモジュールを import しない（import は下の 2 行だけ） <!-- req datamodelpersistence:d93b91cc.353b --> <!-- req datamodelpersistence:d93b91cc.905d --> <!-- req datamodelpersistence:d93b91cc.7a5e -->
import { FileNotFoundError, FileReadError, FileWriteError } from '@riff-line/core/platform';
import type { DirEntry, FileSystemAdapter, FileSystemAdapterFactory } from '@riff-line/core/platform';
// <!-- req webcorefoundation:7f4d096a.a83f --> <!-- req webcorefoundation:7f4d096a.e82b --> <!-- req webcorefoundation:d8f912d1.29ba --> <!-- req webcorefoundation:d8f912d1.8252 --> <!-- req webcorefoundation:d8f912d1.4cb7 --> <!-- req webcorefoundation:bb228dbf.f16f -->

/**
 * IPC 越しに失われたエラー型を復元する。
 * まず（Electron が own-enumerable として保持しうる）`error.code` を見て、
 * 無ければエラーメッセージ中のクラス名／コード文字列で判定する。
 * どれにも当たらなければ元のエラーをそのまま返す。
 */
function mapIpcError(error: unknown, path: string): Error {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const has = (needle: string): boolean => code === needle || message.includes(needle);

  if (has('FILE_NOT_FOUND') || message.includes('FileNotFoundError')) {
    return new FileNotFoundError(path, { cause: error });
  }
  if (has('FILE_WRITE_FAILED') || message.includes('FileWriteError')) {
    return new FileWriteError(path, { cause: error });
  }
  if (has('FILE_READ_FAILED') || message.includes('FileReadError')) {
    return new FileReadError(path, { cause: error });
  }
  return error instanceof Error ? error : new Error(message);
}

/** window.riffLineApi.fsAt の形（テスト時の差し替え用に型を切り出す）。 */
type FsAtApi = Window['riffLineApi']['fsAt'];

// data-model-persistence.md 10.1 節：レンダラーからは IPC で main を呼ぶ。FileSystemAdapter を満たす IpcFileSystemAdapter で、各メソッドは持っているルートを付けて fs:*At を呼ぶ <!-- req datamodelpersistence:140013f9.93d7 --> <!-- req datamodelpersistence:d93b91cc.afd8 --> <!-- req datamodelpersistence:d93b91cc.fe00 -->
export class IpcFileSystemAdapter implements FileSystemAdapter {
  constructor(
    private readonly rootPath: string,
    private readonly fsAt: FsAtApi = window.riffLineApi.fsAt,
  ) {}

  getRootPath(): string {
    return this.rootPath;
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    try {
      return await this.fsAt.readFile(this.rootPath, relativePath);
    } catch (error) {
      throw mapIpcError(error, relativePath);
    }
  }

  async writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    try {
      await this.fsAt.writeFile(this.rootPath, relativePath, data);
    } catch (error) {
      throw mapIpcError(error, relativePath);
    }
  }

  async listDirectory(relativePath: string): Promise<DirEntry[]> {
    try {
      return await this.fsAt.listDirectory(this.rootPath, relativePath);
    } catch (error) {
      throw mapIpcError(error, relativePath);
    }
  }

  async ensureDirectory(relativePath: string): Promise<void> {
    try {
      await this.fsAt.ensureDirectory(this.rootPath, relativePath);
    } catch (error) {
      throw mapIpcError(error, relativePath);
    }
  }

  async renameFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    try {
      await this.fsAt.renameFile(this.rootPath, fromRelativePath, toRelativePath);
    } catch (error) {
      throw mapIpcError(error, fromRelativePath);
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    try {
      await this.fsAt.deleteFile(this.rootPath, relativePath);
    } catch (error) {
      throw mapIpcError(error, relativePath);
    }
  }

  async copyFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    try {
      await this.fsAt.copyFile(this.rootPath, fromRelativePath, toRelativePath);
    } catch (error) {
      throw mapIpcError(error, fromRelativePath);
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      return await this.fsAt.exists(this.rootPath, relativePath);
    } catch (error) {
      throw mapIpcError(error, relativePath);
    }
  }
}

/** ルートごとに IpcFileSystemAdapter を 1 個だけ生成してキャッシュする。 */
// data-model-persistence.md 10.1 節：FileSystemAdapterFactory を満たす IpcFileSystemAdapterFactory <!-- req datamodelpersistence:d93b91cc.b2cf -->
export class IpcFileSystemAdapterFactory implements FileSystemAdapterFactory {
  private readonly cache = new Map<string, FileSystemAdapter>();

  constructor(private readonly fsAt: FsAtApi = window.riffLineApi.fsAt) {}

  // data-model-persistence.md 10.1 節：createForRoot は渡されたルートを持つ IpcFileSystemAdapter を返す <!-- req datamodelpersistence:d93b91cc.5ff7 -->
  createForRoot(absoluteRootPath: string): FileSystemAdapter {
    let adapter = this.cache.get(absoluteRootPath);
    if (!adapter) {
      adapter = new IpcFileSystemAdapter(absoluteRootPath, this.fsAt);
      this.cache.set(absoluteRootPath, adapter);
    }
    return adapter;
  }
}
