/**
 * Electron メインプロセスのエントリポイント（web-core-foundation.md §3.3・§5、data-model-persistence.md §3.3.1）。
 *
 * 責務:
 *  - 単一インスタンスロックの取得（同一プロセスの二重起動防止）
 *  - contextIsolation:true / nodeIntegration:false / sandbox:true のメインウィンドウ生成
 *  - fs:* / fs:*At / appconfig:* IPC ハンドラの登録（Adapter / Factory / AppLocalConfigService へ委譲）
 *
 * スコープ外（後続パッケージ）: 複数ウィンドウの本格対応、ネイティブメニュー、クラッシュ復旧。
 */

import { join } from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import { ElectronAppLocalConfigService } from './ElectronAppLocalConfigService';
import { ElectronFileSystemAdapterFactory } from './ElectronFileSystemAdapterFactory';
import { registerAppConfigHandlers, registerFsAtHandlers, registerFsHandlers } from './ipc';

// 端末ローカル領域（app.getPath('userData')）上のポインタ／既定ルート解決を担う。
const appLocalConfig = new ElectronAppLocalConfigService(app.getPath('userData'));
// 任意ルートのアダプタ生成器（アクティブストレージ・ミラー先・移行元/先を横断的に扱う）。
const adapterFactory = new ElectronFileSystemAdapterFactory();

/**
 * メインウィンドウを生成する。
 * セキュリティ既定値（AD-3・electron.rule.md「変更禁止」）: contextIsolation を有効、Node 統合を無効、
 * レンダラーを sandbox 化し、Node.js API へは preload 経由の IPC でのみアクセスさせる。
 */
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

    registerFsHandlers(ipcMain, activeAdapter);
    registerFsAtHandlers(ipcMain, adapterFactory);
    registerAppConfigHandlers(
      ipcMain,
      appLocalConfig,
      () => appLocalConfig.getActiveRoot(),
      () => appLocalConfig.getLocalBackupRoot(),
    );

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
