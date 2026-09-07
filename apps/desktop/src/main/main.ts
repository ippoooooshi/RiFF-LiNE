/**
 * Electron メインプロセスのエントリポイント（web-core-foundation.md §3.3・§5 起動シーケンス）。
 *
 * 責務（本パッケージの範囲）:
 *  - 単一インスタンスロックの取得（同一プロセスの二重起動防止）
 *  - contextIsolation:true / nodeIntegration:false のメインウィンドウ生成
 *  - fs:* IPC ハンドラの登録（ElectronFileSystemAdapter へ委譲）
 *
 * スコープ外（後続パッケージ）: 複数ウィンドウの本格対応、ネイティブメニュー、クラッシュ復旧、
 * 保存先バックエンド切替。
 */

import { join } from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import { ElectronFileSystemAdapter } from './ElectronFileSystemAdapter';
import { registerFsHandlers } from './ipc';

// 本パッケージ時点ではローカルフォルダ固定（OS のユーザーデータフォルダ配下）。
// iCloud Drive / Google Drive の選択・切替 UI と設定永続化は次パッケージ「データモデル・永続化」。
const storageRootPath = join(app.getPath('userData'), 'TabApp');
const fileSystemAdapter = new ElectronFileSystemAdapter(storageRootPath);

/**
 * メインウィンドウを生成する。
 * セキュリティ既定値（AD-3・electron.rule.md）: contextIsolation を有効、Node 統合を無効にし、
 * Node.js API へは preload 経由の IPC でのみアクセスさせる。
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
    },
  });

  window.once('ready-to-show', () => window.show());

  // 外部オリジンへのナビゲーション・新規ウィンドウを禁止（オフライン方針）。
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
  // 2 つ目の起動が試みられたら既存ウィンドウを前面化する。
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  void app.whenReady().then(async () => {
    // ストレージルートを用意してから IPC を受け付ける。
    await fileSystemAdapter.ensureDirectory('.');
    registerFsHandlers(ipcMain, fileSystemAdapter);

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
