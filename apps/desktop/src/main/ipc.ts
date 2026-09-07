/**
 * IPC ハンドラの登録（web-core-foundation.md §3.3・§4.1、data-model-persistence.md §3.3.1）。
 *
 * すべて ipcRenderer.invoke / ipcMain.handle（Promise ベース）。ハンドラは
 * Adapter 実装／Factory／AppLocalConfigService へ委譲するだけで、ビジネスロジックを持たない。
 * ipcMain は引数で受け取る（DI）ので、テストは fake を渡して契約の往復を検証できる。
 */

import {
  APP_CONFIG_CHANNELS,
  FS_CHANNELS,
  type AppConfigWritePointerRequest,
  type AppLocalConfigService,
  type DirEntry,
  type FileSystemAdapter,
  type FileSystemAdapterFactory,
  type FsCopyFileAtRequest,
  type FsDeleteFileAtRequest,
  type FsEnsureDirectoryAtRequest,
  type FsEnsureDirectoryRequest,
  type FsExistsAtRequest,
  type FsListDirectoryAtRequest,
  type FsListDirectoryRequest,
  type FsReadFileAtRequest,
  type FsReadFileRequest,
  type FsRenameFileAtRequest,
  type FsWriteFileAtRequest,
  type FsWriteFileRequest,
  type StorageRootPointer,
} from '@riff-line/shared-types';

/** ipcMain.handle のうち本モジュールが使う部分だけを型として要求する。 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>): void;
}

/**
 * 4.1 節の契約表に従い、単一（アクティブ）ルート用 fs:* チャンネルのハンドラを登録する。
 * （web-core-foundation.md §4.1、変更なし）
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

/**
 * ルート指定付き fs:*At チャンネルのハンドラを登録する（data-model-persistence.md §3.3.1、B31）。
 * 各ハンドラは factory.createForRoot(rootPath) でアダプタを解決して委譲する。
 * rootPath が絶対パスでない等は ElectronFileSystemAdapter コンストラクタが throw し、invoke が reject する。
 */
export function registerFsAtHandlers(ipcMain: IpcMainLike, factory: FileSystemAdapterFactory): void {
  ipcMain.handle(FS_CHANNELS.readFileAt, (_event, payload): Promise<Uint8Array> => {
    const { rootPath, relativePath } = payload as FsReadFileAtRequest;
    return factory.createForRoot(rootPath).readFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.writeFileAt, (_event, payload): Promise<void> => {
    const { rootPath, relativePath, data } = payload as FsWriteFileAtRequest;
    return factory.createForRoot(rootPath).writeFile(relativePath, data);
  });

  ipcMain.handle(FS_CHANNELS.listDirectoryAt, (_event, payload): Promise<DirEntry[]> => {
    const { rootPath, relativePath } = payload as FsListDirectoryAtRequest;
    return factory.createForRoot(rootPath).listDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.ensureDirectoryAt, (_event, payload): Promise<void> => {
    const { rootPath, relativePath } = payload as FsEnsureDirectoryAtRequest;
    return factory.createForRoot(rootPath).ensureDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.renameFileAt, (_event, payload): Promise<void> => {
    const { rootPath, fromRelativePath, toRelativePath } = payload as FsRenameFileAtRequest;
    return factory.createForRoot(rootPath).renameFile(fromRelativePath, toRelativePath);
  });

  ipcMain.handle(FS_CHANNELS.deleteFileAt, (_event, payload): Promise<void> => {
    const { rootPath, relativePath } = payload as FsDeleteFileAtRequest;
    return factory.createForRoot(rootPath).deleteFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.copyFileAt, (_event, payload): Promise<void> => {
    const { rootPath, fromRelativePath, toRelativePath } = payload as FsCopyFileAtRequest;
    return factory.createForRoot(rootPath).copyFile(fromRelativePath, toRelativePath);
  });

  ipcMain.handle(FS_CHANNELS.existsAt, (_event, payload): Promise<boolean> => {
    const { rootPath, relativePath } = payload as FsExistsAtRequest;
    return factory.createForRoot(rootPath).exists(relativePath);
  });
}

/**
 * AppLocalConfigService 系チャンネルのハンドラを登録する（data-model-persistence.md §3.3.1）。
 * @param resolveActiveRoot appconfig:getActiveRoot の実装（初回起動時の既定ルート解決）。
 * @param resolveLocalBackupRoot appconfig:getLocalBackupRoot の実装（端末ローカル専用領域）。
 */
export function registerAppConfigHandlers(
  ipcMain: IpcMainLike,
  service: AppLocalConfigService,
  resolveActiveRoot: () => Promise<string> | string,
  resolveLocalBackupRoot: () => Promise<string> | string,
): void {
  ipcMain.handle(APP_CONFIG_CHANNELS.readPointer, (): Promise<StorageRootPointer | null> => {
    return service.readPointer();
  });

  ipcMain.handle(APP_CONFIG_CHANNELS.writePointer, (_event, payload): Promise<void> => {
    const { pointer } = payload as AppConfigWritePointerRequest;
    return service.writePointer(pointer);
  });

  ipcMain.handle(APP_CONFIG_CHANNELS.getActiveRoot, (): Promise<string> | string => resolveActiveRoot());

  ipcMain.handle(APP_CONFIG_CHANNELS.getLocalBackupRoot, (): Promise<string> | string => resolveLocalBackupRoot());
}
