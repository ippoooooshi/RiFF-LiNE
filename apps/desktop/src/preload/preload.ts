/**
 * preload スクリプト（web-core-foundation.md 3.1 節・6.3 節。チャンネルの中身は使う機能の詳細設計、ファイル I/O は data-model-persistence.md 10.1 節）。
 *
 * contextBridge で window.riffLineApi を公開する。公開するのは IPC 契約に対応する型安全な
 * ラッパー関数のみ。ipcRenderer そのもの・Node.js API・Electron モジュールは公開しない。
 * 6.1 節・6.3 節：preload（apps/desktop/src/preload）が出すのは ipcRenderer.invoke を包んだ呼び口と購読の関数だけ <!-- req webcorefoundation:21f12fae.dbf5 --> <!-- req webcorefoundation:21f12fae.ace6 --> <!-- req webcorefoundation:92c05a8f.77ec --> <!-- req webcorefoundation:f67c02df.5ad2 -->
 */
// <!-- req webcorefoundation:ac409453.3c39 -->
// <!-- req webcorefoundation:0a3de015.1efe --> <!-- req webcorefoundation:0a3de015.c770 --> <!-- req webcorefoundation:0a3de015.957d -->

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  APP_CHANNELS,
  APP_CONFIG_CHANNELS,
  CRASH_CHANNELS,
  FREEZE_CHANNELS,
  FS_CHANNELS,
  LOG_CHANNELS,
  MIRROR_CHANNELS,
  NOTIFY_CHANNELS,
  SHARED_CHANNELS,
  WINDOW_CHANNELS,
  type CrashRecoveryState,
  type LogEntry,
  type NotificationEvent,
  type SharedChangeNotice,
  type MirrorSyncAfterSaveRequest,
  type WindowFlushAutoSaveAck,
  type WindowFlushAutoSaveRequest,
  type WindowOpenSongRequest,
  type DirEntry,
  type AppConfigDeleteWindowBoundsRequest,
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
  type FsRemoveEmptyDirectoryAtRequest,
  type FsRenameFileAtRequest,
  type FsWriteFileAtRequest,
  type FsWriteFileRequest,
  type RiffLineApi,
  type StorageRootPointer,
} from '@riff-line/shared-types';

const api: RiffLineApi = {
  // --- 単一（アクティブ）ルート用（data-model-persistence.md 10.1 節、不変） ---
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

  // --- ルート指定付き（data-model-persistence.md 10.1 節、B31） ---
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

    // data-model-persistence.md 10.1 節：空のフォルダを消す（2026-10-27 本人決定）
    removeEmptyDirectory: (rootPath: string, relativePath: string): Promise<void> =>
      ipcRenderer.invoke(FS_CHANNELS.removeEmptyDirectoryAt, {
        rootPath,
        relativePath,
      } satisfies FsRemoveEmptyDirectoryAtRequest),
  },

  // --- AppLocalConfigService の IPC 経路 ---
  appConfig: {
    readPointer: (): Promise<StorageRootPointer | null> => ipcRenderer.invoke(APP_CONFIG_CHANNELS.readPointer),

    writePointer: (pointer: StorageRootPointer): Promise<void> =>
      ipcRenderer.invoke(APP_CONFIG_CHANNELS.writePointer, { pointer } satisfies AppConfigWritePointerRequest),

    getActiveRoot: (): Promise<string> => ipcRenderer.invoke(APP_CONFIG_CHANNELS.getActiveRoot),

    getLocalBackupRoot: (): Promise<string> => ipcRenderer.invoke(APP_CONFIG_CHANNELS.getLocalBackupRoot),

    // data-model-persistence.md 10.1 節：PreMigration/ の場所（honnin-queue 206 番）
    getPreMigrationRoot: (): Promise<string> => ipcRenderer.invoke(APP_CONFIG_CHANNELS.getPreMigrationRoot),

    // data-model-persistence.md 10.1 節：ゴミ箱で完全に消した曲の window-bounds.json の 1 件を消させる（17 節の (b)、honnin-queue 216 番）
    deleteWindowBounds: (songId: string): Promise<void> =>
      ipcRenderer.invoke(APP_CONFIG_CHANNELS.deleteWindowBounds, {
        songId,
      } satisfies AppConfigDeleteWindowBoundsRequest),

    // data-model-persistence.md 10.1 節・17 節の (b)：起動のときの片付けを始めてよいか（アプリの起動ごとに初めての 1 回だけ true）
    claimStartupCleanup: (): Promise<boolean> => ipcRenderer.invoke(APP_CONFIG_CHANNELS.claimStartupCleanup),
  },

  // --- エラー・ログ基盤（error-logging-foundation.md 2.4 節、B32） ---
  log: {
    // <!-- req errorloggingfoundation:29b6f717.e43f -->
    append: (entry: LogEntry): Promise<void> => ipcRenderer.invoke(LOG_CHANNELS.append, entry),
  },
  crash: {
    getRecoveryState: (): Promise<CrashRecoveryState> => ipcRenderer.invoke(CRASH_CHANNELS.getRecoveryState),
    // error-logging-foundation.md 2.4 節：freeze:recovered の購読の口の名前 <!-- req errorloggingfoundation:bfae4c48.503e -->
    onFreezeRecovered: (handler: () => void): (() => void) => {
      const listener = (): void => handler();
      ipcRenderer.on(FREEZE_CHANNELS.recovered, listener);
      return () => ipcRenderer.removeListener(FREEZE_CHANNELS.recovered, listener);
    },
  },
  notify: {
    // error-logging-foundation.md 2.6 節：main の MainErrorLogger が送る notify:fromMain の受け口（中身は NotificationEvent）
    onFromMain: (handler: (event: NotificationEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, event: NotificationEvent): void => handler(event);
      ipcRenderer.on(NOTIFY_CHANNELS.fromMain, listener);
      return () => ipcRenderer.removeListener(NOTIFY_CHANNELS.fromMain, listener);
    },
  },
  app: {
    // <!-- req errorloggingfoundation:8521749a.cf0e --> <!-- req errorloggingfoundation:bfae4c48.20d7 -->
    openLogFolder: (): Promise<void> => ipcRenderer.invoke(APP_CHANNELS.openLogFolder),
  },

  // --- 窓が共有のファイルを変えたときの知らせ（web-core-foundation.md 6.3 節、2026-10-29 本人決定 K1） ---
  shared: {
    // error-logging-foundation.md 2.4 節：shared:changed を送る口と受ける口の名前 <!-- req errorloggingfoundation:bfae4c48.2635 -->
    notifyChanged: (notice: SharedChangeNotice): Promise<void> => ipcRenderer.invoke(SHARED_CHANNELS.changed, notice),
    // <!-- req errorloggingfoundation:bfae4c48.acea -->
    onChanged: (handler: (notice: SharedChangeNotice) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, notice: SharedChangeNotice): void => handler(notice);
      ipcRenderer.on(SHARED_CHANNELS.changed, listener);
      return () => ipcRenderer.removeListener(SHARED_CHANNELS.changed, listener);
    },
  },

  // --- ミラーの写し（data-model-persistence.md 14.1 節、2026-10-27 本人決定、honnin-queue 214 番） ---
  mirror: {
    syncAfterSave: (songId: string): Promise<void> =>
      ipcRenderer.invoke(MIRROR_CHANNELS.syncAfterSave, { songId } satisfies MirrorSyncAfterSaveRequest),
  },

  // --- 複数ウィンドウ管理（screens-navigation.md 4.1 節） ---
  windows: {
    openSong: (songId: string): Promise<void> =>
      ipcRenderer.invoke(WINDOW_CHANNELS.openSong, { songId } satisfies WindowOpenSongRequest),
    openSongList: (): Promise<void> => ipcRenderer.invoke(WINDOW_CHANNELS.openSongList),
    onFlushAutoSaveRequest: (handler: (request: WindowFlushAutoSaveRequest) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, request: WindowFlushAutoSaveRequest): void => handler(request);
      ipcRenderer.on(WINDOW_CHANNELS.flushAutoSaveRequest, listener);
      return () => ipcRenderer.removeListener(WINDOW_CHANNELS.flushAutoSaveRequest, listener);
    },
    ackFlushAutoSave: (token: number): Promise<void> =>
      ipcRenderer.invoke(WINDOW_CHANNELS.flushAutoSaveAck, { token } satisfies WindowFlushAutoSaveAck),
    // error-logging-foundation.md 2.4 節・2.5 節：代わりの画面の「画面を開き直す」 <!-- req errorloggingfoundation:bfae4c48.e7a5 -->
    // <!-- req errorloggingfoundation:3a457ca0.1473 -->
    reloadAfterRenderError: (): Promise<void> => ipcRenderer.invoke(WINDOW_CHANNELS.reloadAfterRenderError),
  },
};

contextBridge.exposeInMainWorld('riffLineApi', api);
