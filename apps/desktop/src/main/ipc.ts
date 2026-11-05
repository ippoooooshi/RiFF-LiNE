/**
 * IPC ハンドラの登録（web-core-foundation.md 3.1 節・6.2 節・6.3 節。チャンネルの中身は使う機能の詳細設計、ファイル I/O は data-model-persistence.md 10.1 節）。
 *
 * すべて ipcRenderer.invoke / ipcMain.handle（Promise ベース）。ハンドラは
 * Adapter 実装／Factory／AppLocalConfigService へ委譲するだけで、ビジネスロジックを持たない。
 * 受け取った引数は `as` で型を付けるだけにせず、ipcPayload.ts で形を確かめてから使う（6.2 節）。形が違えば invoke が reject する。
 * 6.2 節・6.3 節：main は ipcMain.handle で受け、戻り値は Promise <!-- req webcorefoundation:c17748d6.5f73 --> <!-- req webcorefoundation:92c05a8f.bd1f --> <!-- req webcorefoundation:92c05a8f.04c2 --> <!-- req webcorefoundation:c49f0398.99d5 -->
 * ipcMain は引数で受け取る（DI）ので、テストは fake を渡して契約の往復を検証できる。
 */

// アダプタのインターフェースは packages/core/src/platform（web-core-foundation.md 3.1 節）、IPC の要求と応答の型と
// チャンネルの名前は packages/shared-types から取る。
import type { Logger } from '@riff-line/core/errors';
import type { FileSystemAdapter, FileSystemAdapterFactory, WindowAdapter } from '@riff-line/core/platform'; // <!-- req webcorefoundation:c6e13e49.3f62 -->

import type { AppLocalConfigService } from './ElectronAppLocalConfigService';
import type { LogRingBuffer } from './LogRingBuffer';
import {
  APP_CHANNELS,
  APP_CONFIG_CHANNELS,
  CRASH_CHANNELS,
  FS_CHANNELS,
  LOG_CHANNELS,
  SHARED_CHANNELS,
  WINDOW_CHANNELS,
  type AppConfigClaimStartupCleanupResponse,
  type AppConfigDeleteWindowBoundsResponse,
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
  type SharedChangeNotice,
} from '@riff-line/shared-types';

import {
  parseAt,
  parseDeleteWindowBounds,
  parseLogEntry,
  parseMoveAt,
  parseRelativePath,
  parseSharedChangeNotice,
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
 * 呼ばれるたびに今の主ストレージのルートを引いて（`resolveActiveRoot` → `factory.createForRoot`。同じルートには 1 つだけ）使う。
 * 起動時のアダプタを持ち続けると、保存先を替えた後に前のルートを読み書きするため（2026-11-02 チャット側の決定）。
 * @param factory ルートごとのアダプタを作る（main では `ElectronFileSystemAdapterFactory`。同じルートは使い回す）。
 * @param resolveActiveRoot 今の主ストレージのルート（main では `appLocalConfig.getActiveRoot()`）。
 */
export function registerFsHandlers(
  ipcMain: IpcMainLike,
  factory: FileSystemAdapterFactory,
  resolveActiveRoot: () => Promise<string>,
): void {
  // <!-- req datamodelpersistence:373be5f2.d553 --> <!-- req datamodelpersistence:373be5f2.c616 --> <!-- req datamodelpersistence:373be5f2.f80f -->
  const activeAdapter = async (): Promise<FileSystemAdapter> => factory.createForRoot(await resolveActiveRoot());

  ipcMain.handle(FS_CHANNELS.readFile, async (_event, payload): Promise<FsReadFileResponse> => {
    const { relativePath } = parseRelativePath(FS_CHANNELS.readFile, payload);
    return (await activeAdapter()).readFile(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.writeFile, async (_event, payload): Promise<FsWriteFileResponse> => {
    const { relativePath, data } = parseWrite(FS_CHANNELS.writeFile, payload);
    return (await activeAdapter()).writeFile(relativePath, data);
  });

  ipcMain.handle(FS_CHANNELS.listDirectory, async (_event, payload): Promise<FsListDirectoryResponse> => {
    const { relativePath } = parseRelativePath(FS_CHANNELS.listDirectory, payload);
    return (await activeAdapter()).listDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.ensureDirectory, async (_event, payload): Promise<FsEnsureDirectoryResponse> => {
    const { relativePath } = parseRelativePath(FS_CHANNELS.ensureDirectory, payload);
    return (await activeAdapter()).ensureDirectory(relativePath);
  });

  ipcMain.handle(FS_CHANNELS.getRootPath, async (): Promise<FsGetRootPathResponse> => {
    return (await activeAdapter()).getRootPath();
  });
}

/**
 * ルート指定付き fs:*At チャンネルのハンドラを登録する（data-model-persistence.md 10.1 節の (b)、B31 の (c)）。
 * 各ハンドラは factory.createForRoot(rootPath) でアダプタを解決して委譲する。
 * rootPath が絶対パスでなければ ElectronFileSystemAdapter のコンストラクタが、ルートの外（..）を指す相対パスは
 * ElectronFileSystemAdapter が拒み、invoke が reject する。
 */
// data-model-persistence.md 10.1 節：fs:*At の群を、getRootPath を除く 9 つのメソッドに 1 つずつ（fs:readFileAt から fs:existsAt までと fs:removeEmptyDirectoryAt）別に足し、{ rootPath, relativePath } を受ける <!-- req datamodelpersistence:140013f9.45a1 --> <!-- req datamodelpersistence:373be5f2.0655 -->
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
 * @param deleteWindowBounds appconfig:deleteWindowBounds の実装（`window-bounds.json` からその曲の 1 件だけを除く、
 *   10.1 節・17 節の (b)、honnin-queue 216 番）。
 *
 * appconfig:claimStartupCleanup（10.1 節・17 節の (b)）の 1 回だけにする印は、ここで登録したハンドラが持つ変数に置く。
 * 登録はアプリの起動ごとに 1 回（main.ts の whenReady の中）なので、印はアプリが動いている間だけ在り、
 * 曲一覧ウィンドウを閉じて開き直しても消えない。初めての呼び出しだけ true、2 回目からは false。
 */
// data-model-persistence.md 10.1 節：主ストレージのルートとローカル既定パスの側の場所を引く appconfig:* の群（readPointer・writePointer・getActiveRoot・getLocalBackupRoot）を足す <!-- req datamodelpersistence:31a0c1dc.e467 --> <!-- req datamodelpersistence:31a0c1dc.a043 --> <!-- req datamodelpersistence:31a0c1dc.3acd --> <!-- req datamodelpersistence:31a0c1dc.fe10 --> <!-- req datamodelpersistence:31a0c1dc.698c -->
export function registerAppConfigHandlers(
  ipcMain: IpcMainLike,
  service: AppLocalConfigService,
  resolveActiveRoot: () => Promise<AppConfigGetActiveRootResponse> | AppConfigGetActiveRootResponse,
  resolveLocalBackupRoot: () => Promise<AppConfigGetLocalBackupRootResponse> | AppConfigGetLocalBackupRootResponse,
  resolvePreMigrationRoot: () => Promise<AppConfigGetPreMigrationRootResponse> | AppConfigGetPreMigrationRootResponse,
  deleteWindowBounds: (songId: string) => Promise<AppConfigDeleteWindowBoundsResponse>,
): void {
  /** 起動のときの片付けを、このアプリの起動で既に渡したか（appconfig:claimStartupCleanup）。 */
  // <!-- req datamodelpersistence:7cae72ec.faaa -->
  let startupCleanupClaimed = false;

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

  ipcMain.handle(
    APP_CONFIG_CHANNELS.deleteWindowBounds,
    async (_event, payload): Promise<AppConfigDeleteWindowBoundsResponse> => {
      const { songId } = parseDeleteWindowBounds(APP_CONFIG_CHANNELS.deleteWindowBounds, payload);
      return deleteWindowBounds(songId);
    },
  );

  // <!-- req datamodelpersistence:31a0c1dc.81da -->
  ipcMain.handle(APP_CONFIG_CHANNELS.claimStartupCleanup, (): AppConfigClaimStartupCleanupResponse => {
    // <!-- req datamodelpersistence:31a0c1dc.83c7 -->
    if (startupCleanupClaimed) return false;
    startupCleanupClaimed = true;
    return true;
  });
}

/**
 * エラー・ログ基盤の IPC ハンドラが使うもの（error-logging-foundation.md 2.3 節・2.4 節）。
 * @typeParam W 送り手の窓（main では Electron の `BrowserWindow`）の型
 */
export interface LogHandlerDeps<W> {
  /** main の `Logger`。`log:append` の `LogEntry` を書き、`app:openLogFolder` でログのフォルダの場所を返す。 */
  logger: Pick<Logger, 'append' | 'getLogFolderAbsolutePath'>;
  /** main の直近の履歴（クラッシュログに添える）。 */
  ring: Pick<LogRingBuffer, 'push'>;
  /** 受けた IPC のイベントの送り手の窓。main.ts は `BrowserWindow.fromWebContents(event.sender)` を渡す。 */
  senderWindow(event: unknown): W | null;
  /** main に 1 つの `CrashRecoveryController` のうち、IPC から呼ぶ所。 */
  crashRecovery: {
    consumeRecoveryState(window: W | null): CrashRecoveryState;
    reloadAfterRenderError(window: W): void;
  };
  /** フォルダを OS のファイルの画面で開く。main.ts は `shell.openPath` を渡す（失敗の文を返し、成功なら空の文字）。 */
  openPath(path: string): Promise<string>;
}

/**
 * エラー・ログ基盤の IPC ハンドラを登録する（error-logging-foundation.md 2.4 節、B32、非破壊追加）。
 * ハンドラは組み立ても判断も持たず、受けたものを渡すだけ（他ハンドラと同方針）。
 *
 * - `log:append`：受けた `LogEntry` を確かめてから、そのまま `LogRingBuffer.push` と `Logger.append` に渡す（組み立てない）。
 * - `crash:getRecoveryState`：送り手の窓を `consumeRecoveryState` に渡す（2.3 節、決定 L2）。
 * - `window:reloadAfterRenderError`：送り手の窓を `reloadAfterRenderError` に渡す（2.5 節）。送り手が窓でなければ何もしない。
 * - `app:openLogFolder`：`Logger.getLogFolderAbsolutePath()` のフォルダを開く。開けなければ reject する（文に場所を入れない）。
 */
export function registerLogHandlers<W>(ipcMain: IpcMainLike, deps: LogHandlerDeps<W>): void {
  // <!-- req errorloggingfoundation:eff8188b.f8a8 -->
  ipcMain.handle(LOG_CHANNELS.append, async (_event, payload): Promise<void> => {
    // <!-- req errorloggingfoundation:eff8188b.52c4 -->
    const entry = parseLogEntry(LOG_CHANNELS.append, payload); // <!-- req errorloggingfoundation:eff8188b.c704 -->
    // <!-- req errorloggingfoundation:eff8188b.070e --> <!-- req errorloggingfoundation:5e36aaaf.1e9d -->
    deps.ring.push(entry);
    // <!-- req errorloggingfoundation:eff8188b.3f95 -->
    await deps.logger.append(entry);
  });

  ipcMain.handle(
    // <!-- req errorloggingfoundation:c7d54f51.eec9 -->
    CRASH_CHANNELS.getRecoveryState,
    // <!-- req errorloggingfoundation:efe204dd.ea23 -->
    (event): CrashRecoveryState => deps.crashRecovery.consumeRecoveryState(deps.senderWindow(event)),
  );

  // <!-- req errorloggingfoundation:efe204dd.d7e2 -->
  ipcMain.handle(WINDOW_CHANNELS.reloadAfterRenderError, (event): void => {
    const window = deps.senderWindow(event);
    // <!-- req errorloggingfoundation:5fab509d.0c18 -->
    // <!-- req errorloggingfoundation:6947599d.bb76 -->
    if (window !== null) deps.crashRecovery.reloadAfterRenderError(window);
  });

  ipcMain.handle(APP_CHANNELS.openLogFolder, async (): Promise<void> => {
    // <!-- req errorloggingfoundation:8521749a.c7a2 -->
    const failure = await deps.openPath(deps.logger.getLogFolderAbsolutePath());
    if (failure !== '') throw new Error('ログのフォルダを開けませんでした。');
  });
}

/** `shared:changed`・`notify:fromMain` を配る先の窓のうち、使う所（main では Electron の `BrowserWindow` がこの形を満たす）。 */
export interface SharedChangeTargetWindow {
  isDestroyed(): boolean;
  readonly webContents: {
    isDestroyed(): boolean;
    send(channel: string, ...args: unknown[]): void;
  };
}

export interface SharedChangeHandlerDeps {
  /** 開いている窓の全部。main.ts は `BrowserWindow.getAllWindows()` を渡す。 */
  targetWindows(): readonly SharedChangeTargetWindow[];
  /** main の中の受け口（`storage` なら `Logger` の書き先を替える、error-logging-foundation.md 2.4 節）。待たない。 */
  onNotice(notice: SharedChangeNotice): void;
}

/**
 * `shared:changed` の中継を登録する（web-core-foundation.md 6.3 節、2026-10-29 本人決定 K1）。
 * 変えた窓から来た知らせを確かめてから、送った窓を除く全部の窓へ同じチャンネルで配り、main の中の受け口にも渡す。
 * 送った窓は受けた窓の読み直しを待たない（配り終えたら応答する）。破棄済みの窓は飛ばし、`send` が投げても次の窓へ進む。
 */
export function registerSharedChangeHandlers(ipcMain: IpcMainLike, deps: SharedChangeHandlerDeps): void {
  ipcMain.handle(SHARED_CHANNELS.changed, (event, payload): void => {
    // <!-- req webcorefoundation:f09ef65e.3785 -->
    const notice = parseSharedChangeNotice(SHARED_CHANNELS.changed, payload);
    const sender = (event as { sender?: unknown } | null | undefined)?.sender;
    sendToWindows(deps.targetWindows(), SHARED_CHANNELS.changed, notice, sender); // <!-- req webcorefoundation:f09ef65e.6ffb -->
    deps.onNotice(notice);
  });
}

/**
 * main から開いている窓の全部へ 1 つの知らせを送る（web-core-foundation.md 6.3 節の `shared:changed`、
 * error-logging-foundation.md 2.6 節の `notify:fromMain`）。送れない窓（窓かその `webContents` が破棄済み）と、
 * `exceptContents` の窓（`shared:changed` を送ってきた窓）は飛ばす。`send` が投げたら捨てて次の窓へ進む。
 */
export function sendToWindows(
  windows: readonly SharedChangeTargetWindow[],
  channel: string,
  payload: unknown,
  exceptContents?: unknown,
): void {
  for (const window of windows) {
    // <!-- req errorloggingfoundation:14ac861c.3769 -->
    // <!-- req errorloggingfoundation:14ac861c.e5f3 -->
    // <!-- req errorloggingfoundation:14ac861c.58f0 -->
    if (window.isDestroyed() || window.webContents.isDestroyed() || window.webContents === exceptContents) continue;
    try {
      // <!-- req errorloggingfoundation:14ac861c.049e -->
      // <!-- req errorloggingfoundation:14ac861c.59ff -->
      window.webContents.send(channel, payload);
    } catch (error) {
      console.error(`[${channel}] 窓へ送れませんでした:`, error);
    }
  }
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
