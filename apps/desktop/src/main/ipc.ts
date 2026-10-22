/**
 * IPC ハンドラの登録（web-core-foundation.md 3.1 節・6.2 節・6.3 節。チャンネルの中身は使う機能の詳細設計、ファイル I/O は data-model-persistence.md 10.1 節）。
 *
 * すべて ipcRenderer.invoke / ipcMain.handle（Promise ベース）。ハンドラは
 * Adapter 実装／Factory／AppLocalConfigService へ委譲するだけで、ビジネスロジックを持たない。
 * 受け取った引数は `as` で型を付けるだけにせず、ipcPayload.ts で形を確かめてから使う（6.2 節）。形が違えば invoke が reject する。
 * 6.2 節・6.3 節：main は ipcMain.handle で受け、戻り値は Promise <!-- req webcorefoundation:c17748d6.5f73 --> <!-- req webcorefoundation:92c05a8f.bd1f --> <!-- req webcorefoundation:92c05a8f.04c2 --> <!-- req webcorefoundation:60e75035.99d5 -->
 * ipcMain は引数で受け取る（DI）ので、テストは fake を渡して契約の往復を検証できる。
 */

// アダプタのインターフェースは packages/core/src/platform（web-core-foundation.md 3.1 節）、IPC の要求と応答の型と
// チャンネルの名前は packages/shared-types から取る。
import type { FileSystemAdapter, FileSystemAdapterFactory, WindowAdapter } from '@riff-line/core/platform';

import type { AppLocalConfigService } from './ElectronAppLocalConfigService';
import {
  APP_CONFIG_CHANNELS,
  CRASH_CHANNELS,
  FS_CHANNELS,
  LOG_CHANNELS,
  WINDOW_CHANNELS,
  type CrashRecoveryState,
  type DirEntry,
  type NotificationEvent,
  type StorageRootPointer,
} from '@riff-line/shared-types';

import {
  parseAt,
  parseMoveAt,
  parseNotificationEvent,
  parseRelativePath,
  parseSongId,
  parseWrite,
  parseWriteAt,
  parseWritePointer,
} from './ipcPayload';

/** ipcMain.handle のうち本モジュールが使う部分だけを型として要求する。 */
export interface IpcMainLike {
  // <!-- req webcorefoundation:e1213282.a5ed --> <!-- req webcorefoundation:e1213282.e1e9 --> <!-- req webcorefoundation:e1213282.7054 --> <!-- req webcorefoundation:321767f7.08d0 --> <!-- req webcorefoundation:321767f7.781a -->
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>): void;
}

/**
 * 単一（アクティブ）ルート用 fs:* チャンネル 5 本のハンドラを登録する。
 * （data-model-persistence.md 10.1 節の (b)、変更なし）
 */
export function registerFsHandlers(ipcMain: IpcMainLike, adapter: FileSystemAdapter): void {
  ipcMain.handle(FS_CHANNELS.readFile, async (_event, payload): Promise<Uint8Array> => {
    const { relativePath } = parseRelativePath(FS_CHANNELS.readFile, payload);
    return adapter.readFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.writeFile, async (_event, payload): Promise<void> => {
    const { relativePath, data } = parseWrite(FS_CHANNELS.writeFile, payload);
    return adapter.writeFile(relativePath, data);
  });

  ipcMain.handle(FS_CHANNELS.listDirectory, async (_event, payload): Promise<DirEntry[]> => {
    const { relativePath } = parseRelativePath(FS_CHANNELS.listDirectory, payload);
    return adapter.listDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.ensureDirectory, async (_event, payload): Promise<void> => {
    const { relativePath } = parseRelativePath(FS_CHANNELS.ensureDirectory, payload);
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
  ipcMain.handle(FS_CHANNELS.readFileAt, async (_event, payload): Promise<Uint8Array> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.readFileAt, payload);
    return factory.createForRoot(rootPath).readFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.writeFileAt, async (_event, payload): Promise<void> => {
    const { rootPath, relativePath, data } = parseWriteAt(FS_CHANNELS.writeFileAt, payload);
    return factory.createForRoot(rootPath).writeFile(relativePath, data);
  });

  ipcMain.handle(FS_CHANNELS.listDirectoryAt, async (_event, payload): Promise<DirEntry[]> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.listDirectoryAt, payload);
    return factory.createForRoot(rootPath).listDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.ensureDirectoryAt, async (_event, payload): Promise<void> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.ensureDirectoryAt, payload);
    return factory.createForRoot(rootPath).ensureDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.renameFileAt, async (_event, payload): Promise<void> => {
    const { rootPath, fromRelativePath, toRelativePath } = parseMoveAt(FS_CHANNELS.renameFileAt, payload);
    return factory.createForRoot(rootPath).renameFile(fromRelativePath, toRelativePath);
  });

  ipcMain.handle(FS_CHANNELS.deleteFileAt, async (_event, payload): Promise<void> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.deleteFileAt, payload);
    return factory.createForRoot(rootPath).deleteFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.copyFileAt, async (_event, payload): Promise<void> => {
    const { rootPath, fromRelativePath, toRelativePath } = parseMoveAt(FS_CHANNELS.copyFileAt, payload);
    return factory.createForRoot(rootPath).copyFile(fromRelativePath, toRelativePath);
  });

  ipcMain.handle(FS_CHANNELS.existsAt, async (_event, payload): Promise<boolean> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.existsAt, payload);
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

  ipcMain.handle(APP_CONFIG_CHANNELS.writePointer, async (_event, payload): Promise<void> => {
    const { pointer } = parseWritePointer(APP_CONFIG_CHANNELS.writePointer, payload);
    return service.writePointer(pointer);
  });

  ipcMain.handle(APP_CONFIG_CHANNELS.getActiveRoot, (): Promise<string> | string => resolveActiveRoot());

  ipcMain.handle(APP_CONFIG_CHANNELS.getLocalBackupRoot, (): Promise<string> | string => resolveLocalBackupRoot());
}

/**
 * エラー・ログ基盤の IPC ハンドラを登録する（error-logging-foundation.md §2、B32、非破壊追加）。
 * ハンドラはビジネスロジックを持たず、渡されたコールバックへ委譲するだけ（他ハンドラと同方針）。
 *
 * @param onEvent renderer の NotificationCenter から届いたイベント 1 件の処理
 *   （main.ts が「Logger.append + LogRingBuffer.push」へ結線する）。
 * @param resolveCrashState `crash:getRecoveryState` の実装（CrashRecoveryController.consumeRecoveryState）。
 */
export function registerLogHandlers(
  ipcMain: IpcMainLike,
  onEvent: (event: NotificationEvent) => void,
  resolveCrashState: () => CrashRecoveryState,
): void {
  ipcMain.handle(LOG_CHANNELS.append, async (_event, payload): Promise<void> => {
    onEvent(parseNotificationEvent(LOG_CHANNELS.append, payload));
  });

  ipcMain.handle(CRASH_CHANNELS.getRecoveryState, (): CrashRecoveryState => resolveCrashState());
}

/**
 * 複数ウィンドウ管理の IPC ハンドラを登録する（screens-navigation.md §4.1、electron.rule.md IPC 規約、新規追加）。
 * ハンドラは `WindowManager`（`WindowAdapter` 実装）へ委譲するだけで、生成・重複防止ロジックは持たない。
 */
export function registerWindowHandlers(ipcMain: IpcMainLike, windows: WindowAdapter): void {
  ipcMain.handle(WINDOW_CHANNELS.openSong, async (_event, payload): Promise<void> => {
    const { songId } = parseSongId(WINDOW_CHANNELS.openSong, payload);
    await windows.focusExistingWindow(songId);
  });

  ipcMain.handle(WINDOW_CHANNELS.openSongList, (): Promise<void> => windows.openSongListWindow());
}
