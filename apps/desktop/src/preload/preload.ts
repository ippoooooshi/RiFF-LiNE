/**
 * preload スクリプト（web-core-foundation.md §3.4・§4、data-model-persistence.md §3.3.1）。
 *
 * contextBridge で window.riffLineApi を公開する。公開するのは IPC 契約に対応する型安全な
 * ラッパー関数のみ。ipcRenderer そのもの・Node.js API・Electron モジュールは公開しない。
 */

import { contextBridge, ipcRenderer } from 'electron';

import {
  APP_CONFIG_CHANNELS,
  FS_CHANNELS,
  type DirEntry,
  type AppConfigWritePointerRequest,
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
  type RiffLineApi,
  type StorageRootPointer,
} from '@riff-line/shared-types';

const api: RiffLineApi = {
  // --- 単一（アクティブ）ルート用（web-core-foundation.md §4.1、不変） ---
  fs: {
    readFile: (relativePath: string): Promise<Uint8Array> =>
      ipcRenderer.invoke(FS_CHANNELS.readFile, { relativePath } satisfies FsReadFileRequest),

    writeFile: (relativePath: string, data: Uint8Array): Promise<void> =>
      ipcRenderer.invoke(FS_CHANNELS.writeFile, { relativePath, data } satisfies FsWriteFileRequest),

    listDirectory: (relativePath: string): Promise<DirEntry[]> =>
      ipcRenderer.invoke(FS_CHANNELS.listDirectory, { relativePath } satisfies FsListDirectoryRequest),

    ensureDirectory: (relativePath: string): Promise<void> =>
      ipcRenderer.invoke(FS_CHANNELS.ensureDirectory, { relativePath } satisfies FsEnsureDirectoryRequest),

    getRootPath: (): Promise<string> => ipcRenderer.invoke(FS_CHANNELS.getRootPath),
  },

  // --- ルート指定付き（data-model-persistence.md §3.3.1、B31） ---
  fsAt: {
    readFile: (rootPath: string, relativePath: string): Promise<Uint8Array> =>
      ipcRenderer.invoke(FS_CHANNELS.readFileAt, { rootPath, relativePath } satisfies FsReadFileAtRequest),

    writeFile: (rootPath: string, relativePath: string, data: Uint8Array): Promise<void> =>
      ipcRenderer.invoke(FS_CHANNELS.writeFileAt, { rootPath, relativePath, data } satisfies FsWriteFileAtRequest),

    listDirectory: (rootPath: string, relativePath: string): Promise<DirEntry[]> =>
      ipcRenderer.invoke(FS_CHANNELS.listDirectoryAt, { rootPath, relativePath } satisfies FsListDirectoryAtRequest),

    ensureDirectory: (rootPath: string, relativePath: string): Promise<void> =>
      ipcRenderer.invoke(FS_CHANNELS.ensureDirectoryAt, {
        rootPath,
        relativePath,
      } satisfies FsEnsureDirectoryAtRequest),

    renameFile: (rootPath: string, fromRelativePath: string, toRelativePath: string): Promise<void> =>
      ipcRenderer.invoke(FS_CHANNELS.renameFileAt, {
        rootPath,
        fromRelativePath,
        toRelativePath,
      } satisfies FsRenameFileAtRequest),

    deleteFile: (rootPath: string, relativePath: string): Promise<void> =>
      ipcRenderer.invoke(FS_CHANNELS.deleteFileAt, { rootPath, relativePath } satisfies FsDeleteFileAtRequest),

    copyFile: (rootPath: string, fromRelativePath: string, toRelativePath: string): Promise<void> =>
      ipcRenderer.invoke(FS_CHANNELS.copyFileAt, {
        rootPath,
        fromRelativePath,
        toRelativePath,
      } satisfies FsCopyFileAtRequest),

    exists: (rootPath: string, relativePath: string): Promise<boolean> =>
      ipcRenderer.invoke(FS_CHANNELS.existsAt, { rootPath, relativePath } satisfies FsExistsAtRequest),
  },

  // --- AppLocalConfigService の IPC 経路 ---
  appConfig: {
    readPointer: (): Promise<StorageRootPointer | null> => ipcRenderer.invoke(APP_CONFIG_CHANNELS.readPointer),

    writePointer: (pointer: StorageRootPointer): Promise<void> =>
      ipcRenderer.invoke(APP_CONFIG_CHANNELS.writePointer, { pointer } satisfies AppConfigWritePointerRequest),

    getActiveRoot: (): Promise<string> => ipcRenderer.invoke(APP_CONFIG_CHANNELS.getActiveRoot),

    getLocalBackupRoot: (): Promise<string> => ipcRenderer.invoke(APP_CONFIG_CHANNELS.getLocalBackupRoot),
  },
};

contextBridge.exposeInMainWorld('riffLineApi', api);
