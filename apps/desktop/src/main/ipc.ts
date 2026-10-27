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
  type AppConfigGetActiveRootResponse,
  type AppConfigGetLocalBackupRootResponse,
  type AppConfigGetPreMigrationRootResponse,
  type AppConfigReadPointerResponse,
  type AppConfigWritePointerResponse,
  type CrashRecoveryState,
  type FsCopyFileResponse,
  type FsDeleteFileResponse,
  type FsEnsureDirectoryResponse,
  type FsExistsResponse,
  type FsGetRootPathResponse,
  type FsListDirectoryResponse,
  type FsReadFileResponse,
  type FsRemoveEmptyDirectoryResponse,
  type FsRenameFileResponse,
  type FsWriteFileResponse,
  type NotificationEvent,
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
 * （data-model-persistence.md 10.1 節の (b)、名前と要求と応答の型は変えない）
 */
export function registerFsHandlers(ipcMain: IpcMainLike, adapter: FileSystemAdapter): void {
  ipcMain.handle(FS_CHANNELS.readFile, async (_event, payload): Promise<FsReadFileResponse> => {
    const { relativePath } = parseRelativePath(FS_CHANNELS.readFile, payload);
    return adapter.readFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.writeFile, async (_event, payload): Promise<FsWriteFileResponse> => {
    const { relativePath, data } = parseWrite(FS_CHANNELS.writeFile, payload);
    return adapter.writeFile(relativePath, data);
  });

  ipcMain.handle(FS_CHANNELS.listDirectory, async (_event, payload): Promise<FsListDirectoryResponse> => {
    const { relativePath } = parseRelativePath(FS_CHANNELS.listDirectory, payload);
    return adapter.listDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.ensureDirectory, async (_event, payload): Promise<FsEnsureDirectoryResponse> => {
    const { relativePath } = parseRelativePath(FS_CHANNELS.ensureDirectory, payload);
    return adapter.ensureDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.getRootPath, (): FsGetRootPathResponse => {
    return adapter.getRootPath();
  });
}

/**
 * ルート指定付き fs:*At チャンネルのハンドラを登録する（data-model-persistence.md 10.1 節の (b)、B31 の (c)）。
 * 各ハンドラは factory.createForRoot(rootPath) でアダプタを解決して委譲する。
 * rootPath が絶対パスでなければ ElectronFileSystemAdapter のコンストラクタが、ルートの外（..）を指す相対パスは
 * ElectronFileSystemAdapter が拒み、invoke が reject する。
 */
// data-model-persistence.md 10.1 節：fs:*At の群を、getRootPath を除く 9 つのメソッドに 1 つずつ（fs:readFileAt から fs:existsAt までと fs:removeEmptyDirectoryAt）別に足し、{ rootPath, relativePath } を受ける <!-- req datamodelpersistence:140013f9.45a1 --> <!-- req datamodelpersistence:cd9bc9db.0655 -->
export function registerFsAtHandlers(ipcMain: IpcMainLike, factory: FileSystemAdapterFactory): void {
  ipcMain.handle(FS_CHANNELS.readFileAt, async (_event, payload): Promise<FsReadFileResponse> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.readFileAt, payload);
    return factory.createForRoot(rootPath).readFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.writeFileAt, async (_event, payload): Promise<FsWriteFileResponse> => {
    const { rootPath, relativePath, data } = parseWriteAt(FS_CHANNELS.writeFileAt, payload);
    return factory.createForRoot(rootPath).writeFile(relativePath, data);
  });

  ipcMain.handle(FS_CHANNELS.listDirectoryAt, async (_event, payload): Promise<FsListDirectoryResponse> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.listDirectoryAt, payload);
    return factory.createForRoot(rootPath).listDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.ensureDirectoryAt, async (_event, payload): Promise<FsEnsureDirectoryResponse> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.ensureDirectoryAt, payload);
    return factory.createForRoot(rootPath).ensureDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.renameFileAt, async (_event, payload): Promise<FsRenameFileResponse> => {
    const { rootPath, fromRelativePath, toRelativePath } = parseMoveAt(FS_CHANNELS.renameFileAt, payload);
    return factory.createForRoot(rootPath).renameFile(fromRelativePath, toRelativePath);
  });

  ipcMain.handle(FS_CHANNELS.deleteFileAt, async (_event, payload): Promise<FsDeleteFileResponse> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.deleteFileAt, payload);
    return factory.createForRoot(rootPath).deleteFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.copyFileAt, async (_event, payload): Promise<FsCopyFileResponse> => {
    const { rootPath, fromRelativePath, toRelativePath } = parseMoveAt(FS_CHANNELS.copyFileAt, payload);
    return factory.createForRoot(rootPath).copyFile(fromRelativePath, toRelativePath);
  });

  ipcMain.handle(FS_CHANNELS.existsAt, async (_event, payload): Promise<FsExistsResponse> => {
    const { rootPath, relativePath } = parseAt(FS_CHANNELS.existsAt, payload);
    return factory.createForRoot(rootPath).exists(relativePath);
  });

  // data-model-persistence.md 10.1 節：空のフォルダを消す removeEmptyDirectory の fs:removeEmptyDirectoryAt（2026-10-27 本人決定）。
  // ルートの外（..）を指す相対パスは、ほかの fs:*At と同じく ElectronFileSystemAdapter が拒む
  ipcMain.handle(
    FS_CHANNELS.removeEmptyDirectoryAt,
    async (_event, payload): Promise<FsRemoveEmptyDirectoryResponse> => {
      const { rootPath, relativePath } = parseAt(FS_CHANNELS.removeEmptyDirectoryAt, payload);
      return factory.createForRoot(rootPath).removeEmptyDirectory(relativePath);
    },
  );
}

/**
 * AppLocalConfigService 系チャンネルのハンドラを登録する（data-model-persistence.md 10.1 節の (b)）。
 * @param resolveActiveRoot appconfig:getActiveRoot の実装（初回起動時の既定ルート解決）。
 * @param resolveLocalBackupRoot appconfig:getLocalBackupRoot の実装（端末ローカル専用領域）。
 * @param resolvePreMigrationRoot appconfig:getPreMigrationRoot の実装（`LocalBackup/` と並ぶ `PreMigration/`、8 節・honnin-queue 206 番）。
 */
// data-model-persistence.md 10.1 節：主ストレージのルートとローカル既定パスの側の場所を引く appconfig:* の群（readPointer・writePointer・getActiveRoot・getLocalBackupRoot）を足す <!-- req datamodelpersistence:546d1515.e467 --> <!-- req datamodelpersistence:546d1515.a043 --> <!-- req datamodelpersistence:546d1515.3acd --> <!-- req datamodelpersistence:546d1515.fe10 --> <!-- req datamodelpersistence:546d1515.698c -->
export function registerAppConfigHandlers(
  ipcMain: IpcMainLike,
  service: AppLocalConfigService,
  resolveActiveRoot: () => Promise<AppConfigGetActiveRootResponse> | AppConfigGetActiveRootResponse,
  resolveLocalBackupRoot: () => Promise<AppConfigGetLocalBackupRootResponse> | AppConfigGetLocalBackupRootResponse,
  resolvePreMigrationRoot: () => Promise<AppConfigGetPreMigrationRootResponse> | AppConfigGetPreMigrationRootResponse,
): void {
  ipcMain.handle(APP_CONFIG_CHANNELS.readPointer, (): Promise<AppConfigReadPointerResponse> => {
    return service.readPointer();
  });

  ipcMain.handle(APP_CONFIG_CHANNELS.writePointer, async (_event, payload): Promise<AppConfigWritePointerResponse> => {
    const { pointer } = parseWritePointer(APP_CONFIG_CHANNELS.writePointer, payload);
    return service.writePointer(pointer);
  });

  ipcMain.handle(
    APP_CONFIG_CHANNELS.getActiveRoot,
    (): Promise<AppConfigGetActiveRootResponse> | AppConfigGetActiveRootResponse => resolveActiveRoot(),
  );

  ipcMain.handle(
    APP_CONFIG_CHANNELS.getLocalBackupRoot,
    (): Promise<AppConfigGetLocalBackupRootResponse> | AppConfigGetLocalBackupRootResponse => resolveLocalBackupRoot(),
  );

  ipcMain.handle(
    APP_CONFIG_CHANNELS.getPreMigrationRoot,
    (): Promise<AppConfigGetPreMigrationRootResponse> | AppConfigGetPreMigrationRootResponse =>
      resolvePreMigrationRoot(),
  );
}

/**
 * エラー・ログ基盤の IPC ハンドラを登録する（error-logging-foundation.md 2.4 節、B32、非破壊追加）。
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
 * 複数ウィンドウ管理の IPC ハンドラを登録する（screens-navigation.md 4.1 節、electron.rule.md IPC 規約、新規追加）。
 * ハンドラは `WindowManager`（`WindowAdapter` 実装）へ委譲するだけで、生成・重複防止ロジックは持たない。
 */
export function registerWindowHandlers(ipcMain: IpcMainLike, windows: WindowAdapter): void {
  ipcMain.handle(WINDOW_CHANNELS.openSong, async (_event, payload): Promise<void> => {
    const { songId } = parseSongId(WINDOW_CHANNELS.openSong, payload);
    // <!-- req datamodelpersistence:e95fc8c9.0007 -->
    await windows.focusExistingWindow(songId);
  });

  ipcMain.handle(WINDOW_CHANNELS.openSongList, (): Promise<void> => windows.openSongListWindow());
}
