/**
 * Electron メインプロセスのエントリポイント（web-core-foundation.md §3.3・§5、data-model-persistence.md §3.3.1、
 * screens-navigation.md §4.1・§5.1）。
 *
 * 責務:
 *  - 単一インスタンスロックの取得（同一プロセスの二重起動防止）
 *  - contextIsolation:true / nodeIntegration:false / sandbox:true のウィンドウ生成
 *  - fs:* / fs:*At / appconfig:* / log:* / crash:* / window:* IPC ハンドラの登録（Adapter / Logger / WindowManager へ委譲）
 *  - 起動時のログクォータ適用（Logger.enforceQuota）とレンダラークラッシュ検知（CrashRecoveryController）
 *  - 曲一覧ウィンドウ・編集ウィンドウの複数ウィンドウ管理（WindowManager、screens-navigation.md §4.1）
 *
 * スコープ外（後続フェーズ）: ネイティブメニューの OS 登録（MenuBarController の buildTemplate() を使う配線は Phase 1 の
 * 追い込みで実施）、編集ウィンドウごとの Webコア DI 一式（renderer 側 bootstrap で段階的に結線、G23 P2 系）。
 */

import { join } from 'node:path';

// errors サブパスから読む（main バレル経由だと alphaTab まで main プロセスへ引き込むため）。
import { DEFAULT_LOG_QUOTA_BYTES, Logger, toLogEntry } from '@riff-line/core/errors';
import { app, BrowserWindow, ipcMain } from 'electron';

import { AutoSaveFlushBridge } from './autoSaveFlushBridge';
import { CrashRecoveryController } from './CrashRecoveryController';
import { ElectronAppLocalConfigService } from './ElectronAppLocalConfigService';
import { ElectronFileSystemAdapterFactory } from './ElectronFileSystemAdapterFactory';
import {
  registerAppConfigHandlers,
  registerFsAtHandlers,
  registerFsHandlers,
  registerLogHandlers,
  registerWindowHandlers,
} from './ipc';
import { LogRingBuffer } from './LogRingBuffer';
import { WindowManager, type ManagedWindow } from './WindowManager';

// 端末ローカル領域（app.getPath('userData')）上のポインタ／既定ルート解決を担う。
const appLocalConfig = new ElectronAppLocalConfigService(app.getPath('userData'));
// 任意ルートのアダプタ生成器（アクティブストレージ・ミラー先・移行元/先を横断的に扱う）。
const adapterFactory = new ElectronFileSystemAdapterFactory();

// クラッシュログに添える直近イベント履歴（renderer 消失後も main 側に残す、B32）。
const logRing = new LogRingBuffer();
// レンダラークラッシュの検知・再読み込み・繰り返し判定（error-logging-foundation.md §2.3）。
// onCrash → Logger.writeCrashLog の結線は logger 生成後（whenReady 内）に行うため let で保持する。
let crashRecovery: CrashRecoveryController;

/**
 * セキュリティ既定値（AD-3・electron.rule.md「変更禁止」）で 1 枚の BrowserWindow を生成する。
 * @param route レンダラーへ渡すハッシュルート（`'songlist'` / `'edit/<songId>'`）。
 */
function createBrowserWindow(route: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      // electron-vite が preload を dist-electron/preload/preload.js（CJS）へ出力する。
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // レンダラープロセスを OS サンドボックスで隔離する。electron.rule.md の「変更禁止」既定値。
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // 新規ウィンドウ生成・あらゆるフレームのナビゲーションを既定で拒否する（オフライン方針・electron.rule.md）。
  // 許可するのは現在ロード中の URL 自身への遷移（リロード）のみ。ハッシュのみの変化（ルート遷移）は許可する。
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const stripHash = (url: string): string => url.split('#')[0] ?? url;
  const denyForeignNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (stripHash(url) !== stripHash(window.webContents.getURL())) event.preventDefault();
  };
  window.webContents.on('will-navigate', denyForeignNavigation);
  window.webContents.on('will-redirect', denyForeignNavigation);
  window.webContents.on('will-frame-navigate', (event) => denyForeignNavigation(event, event.url));

  // dev では electron-vite が Vite サーバーの URL を渡す。packaged ではビルド済み HTML を読む。
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void window.loadURL(`${rendererUrl}#${route}`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: route });
  }

  return window;
}

/** Electron `BrowserWindow` を `WindowManager` が要求する `ManagedWindow` 契約へ薄く適合させる。 */
function toManagedWindow(window: BrowserWindow): ManagedWindow {
  return {
    id: window.id,
    focus: () => window.focus(),
    isMinimized: () => window.isMinimized(),
    restore: () => window.restore(),
    onClose: (handler) => window.on('close', (event) => handler(event)),
    onClosed: (handler) => window.on('closed', handler),
    destroy: () => window.destroy(),
  };
}

// 単一インスタンスロック: 取得できなければ二重起動なので終了する。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  void app.whenReady().then(async () => {
    // アクティブストレージルートを解決（初回はローカル既定 = {userData}/TabApp）してから IPC を受け付ける。
    const activeRoot = await appLocalConfig.getActiveRoot();
    const activeAdapter = adapterFactory.createForRoot(activeRoot);
    await activeAdapter.ensureDirectory('.');

    // ログ基盤（error-logging-foundation.md §2.2・§3.3）。起動時に 10MB クォータを適用する。
    const logger = new Logger(activeAdapter);
    await logger.enforceQuota(DEFAULT_LOG_QUOTA_BYTES);

    // クラッシュ時のクラッシュログ書き出しを結線する。
    crashRecovery = new CrashRecoveryController({
      onCrash: ({ reason }) => void logger.writeCrashLog(reason, logRing.snapshot()),
    });

    // 編集ウィンドウの songId → 実 BrowserWindow 対応（flush 要求の宛先解決に使う）。
    const editWindowsBySong = new Map<string, BrowserWindow>();
    // クローズ確定前の自動保存 flush ハンドシェイク（トークン付き request/ack、既定タイムアウト 5 秒）。
    const flushBridge = new AutoSaveFlushBridge(ipcMain);

    // 複数ウィンドウ管理（screens-navigation.md §4.1）。実 BrowserWindow 生成はここでファクトリとして渡す。
    const windowManager = new WindowManager({
      createSongListWindow: () => {
        const win = createBrowserWindow('songlist');
        crashRecovery.attach(win);
        return toManagedWindow(win);
      },
      createEditWindow: (songId) => {
        const win = createBrowserWindow(`edit/${songId}`);
        editWindowsBySong.set(songId, win);
        win.on('closed', () => editWindowsBySong.delete(songId));
        crashRecovery.attach(win);
        return toManagedWindow(win);
      },
      // 編集ウィンドウ単位スコープの Webコア一式（CommandHistory 等）は renderer 側 bootstrap（App.tsx）が保持する。
      // main 側はライフサイクルのフックだけを持つ。renderer 側インスタンスの破棄はウィンドウ破棄に伴い GC される。
      createEditWindowInstances: () => ({ dispose: () => undefined }),
      // クローズ時の自動保存確定。対象ウィンドウの renderer へ flush を要求し、ack かタイムアウトまで待つ
      // （screens-navigation.md §4.1・§9.0 P2-a。renderer 側で実 AutoSaveScheduler.flush を差し込む配線は追い込み）。
      flushAutoSave: (songId) => flushBridge.requestFlush(songId, editWindowsBySong.get(songId) ?? null),
    });

    registerFsHandlers(ipcMain, activeAdapter);
    registerFsAtHandlers(ipcMain, adapterFactory);
    registerAppConfigHandlers(
      ipcMain,
      appLocalConfig,
      () => appLocalConfig.getActiveRoot(),
      () => appLocalConfig.getLocalBackupRoot(),
    );
    // renderer の NotificationCenter → Logger.append + 直近バッファ、および crash 復旧状態の取得（B32）。
    registerLogHandlers(
      ipcMain,
      (event) => {
        logRing.push(event);
        void logger.append(toLogEntry(event));
      },
      () => crashRecovery.consumeRecoveryState(),
    );
    // 編集ウィンドウを開く / 曲一覧を前面化する（screens-navigation.md §4.1）。
    registerWindowHandlers(ipcMain, windowManager);

    // 起動時は曲一覧ウィンドウを 1 枚（screens-navigation.md §5.1）。
    windowManager.openSongListWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) windowManager.openSongListWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
