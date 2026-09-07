/**
 * Electron メインプロセスのエントリポイント（web-core-foundation.md §3.3・§5、data-model-persistence.md §3.3.1）。
 *
 * 責務:
 *  - 単一インスタンスロックの取得（同一プロセスの二重起動防止）
 *  - contextIsolation:true / nodeIntegration:false / sandbox:true のメインウィンドウ生成
 *  - fs:* / fs:*At / appconfig:* / log:* / crash:* IPC ハンドラの登録（Adapter / Logger 等へ委譲）
 *  - 起動時のログクォータ適用（Logger.enforceQuota）とレンダラークラッシュ検知（CrashRecoveryController）
 *
 * スコープ外（後続パッケージ）: 複数ウィンドウの本格対応、ネイティブメニュー。
 */

import { join } from 'node:path';

// errors サブパスから読む（main バレル経由だと alphaTab まで main プロセスへ引き込むため）。
import { DEFAULT_LOG_QUOTA_BYTES, Logger, toLogEntry } from '@riff-line/core/errors';
import { app, BrowserWindow, ipcMain } from 'electron';

import { CrashRecoveryController } from './CrashRecoveryController';
import { ElectronAppLocalConfigService } from './ElectronAppLocalConfigService';
import { ElectronFileSystemAdapterFactory } from './ElectronFileSystemAdapterFactory';
import { registerAppConfigHandlers, registerFsAtHandlers, registerFsHandlers, registerLogHandlers } from './ipc';
import { LogRingBuffer } from './LogRingBuffer';

// 端末ローカル領域（app.getPath('userData')）上のポインタ／既定ルート解決を担う。
const appLocalConfig = new ElectronAppLocalConfigService(app.getPath('userData'));
// 任意ルートのアダプタ生成器（アクティブストレージ・ミラー先・移行元/先を横断的に扱う）。
const adapterFactory = new ElectronFileSystemAdapterFactory();

/**
 * メインウィンドウを生成する。
 * セキュリティ既定値（AD-3・electron.rule.md「変更禁止」）: contextIsolation を有効、Node 統合を無効、
 * レンダラーを sandbox 化し、Node.js API へは preload 経由の IPC でのみアクセスさせる。
 */
// クラッシュログに添える直近イベント履歴（renderer 消失後も main 側に残す、B32）。
const logRing = new LogRingBuffer();
// レンダラークラッシュの検知・再読み込み・繰り返し判定（error-logging-foundation.md §2.3）。
// onCrash → Logger.writeCrashLog の結線は logger 生成後（whenReady 内）に行うため let で保持する。
let crashRecovery: CrashRecoveryController;

function createMainWindow(): BrowserWindow {
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
  // 許可するのは現在ロード中の URL 自身への遷移（リロード）のみ。
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const denyForeignNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  };
  window.webContents.on('will-navigate', denyForeignNavigation);
  window.webContents.on('will-redirect', denyForeignNavigation);
  window.webContents.on('will-frame-navigate', (event) => denyForeignNavigation(event, event.url));

  // dev では electron-vite が Vite サーバーの URL を渡す。packaged ではビルド済み HTML を読む。
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
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

    crashRecovery.attach(createMainWindow());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) crashRecovery.attach(createMainWindow());
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
