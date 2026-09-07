/**
 * fs:* IPC ハンドラの登録（web-core-foundation.md §3.3・§4.1）。
 *
 * すべて ipcRenderer.invoke / ipcMain.handle（Promise ベース）。ハンドラは
 * FileSystemAdapter 実装へ委譲するだけで、ビジネスロジックを持たない。
 * ipcMain は引数で受け取る（DI）ので、テストは fake を渡して契約の往復を検証できる。
 */

import {
  FS_CHANNELS,
  type DirEntry,
  type FileSystemAdapter,
  type FsEnsureDirectoryRequest,
  type FsListDirectoryRequest,
  type FsReadFileRequest,
  type FsWriteFileRequest,
} from '@tab-app/shared-types';

/** ipcMain.handle のうち本モジュールが使う部分だけを型として要求する。 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>): void;
}

/**
 * 4.1 節の契約表に従い fs:* チャンネルのハンドラを登録する。
 * @returns 登録解除用の関数（テスト・ウィンドウ破棄時のクリーンアップ用）。
 */
export function registerFsHandlers(ipcMain: IpcMainLike, adapter: FileSystemAdapter): void {
  ipcMain.handle(FS_CHANNELS.readFile, (_event, payload): Promise<Uint8Array> => {
    const { relativePath } = payload as FsReadFileRequest;
    return adapter.readFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.writeFile, (_event, payload): Promise<void> => {
    const { relativePath, data } = payload as FsWriteFileRequest;
    return adapter.writeFile(relativePath, data);
  });

  ipcMain.handle(FS_CHANNELS.listDirectory, (_event, payload): Promise<DirEntry[]> => {
    const { relativePath } = payload as FsListDirectoryRequest;
    return adapter.listDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.ensureDirectory, (_event, payload): Promise<void> => {
    const { relativePath } = payload as FsEnsureDirectoryRequest;
    return adapter.ensureDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.getRootPath, (): string => {
    return adapter.getRootPath();
  });
}
