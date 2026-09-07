/**
 * preload スクリプト（web-core-foundation.md §3.4・§4）。
 *
 * contextBridge で window.tabAppApi を公開する。公開するのは 4.1 節の IPC 契約に対応する
 * 型安全なラッパー関数のみ。ipcRenderer そのもの・Node.js API・Electron モジュールは公開しない。
 */

import { contextBridge, ipcRenderer } from 'electron';

import {
  FS_CHANNELS,
  type DirEntry,
  type FsEnsureDirectoryRequest,
  type FsListDirectoryRequest,
  type FsReadFileRequest,
  type FsWriteFileRequest,
  type TabAppApi,
} from '@tab-app/shared-types';

const api: TabAppApi = {
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
};

contextBridge.exposeInMainWorld('tabAppApi', api);
