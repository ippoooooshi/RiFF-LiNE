/**
 * Electron メインプロセスのエントリポイント（web-core-foundation.md 6 節・7.2 節、data-model-persistence.md 10.1 節、
 * screens-navigation.md 4.1 節・4.4 節）。
 * 8.1 節：Electron は PC 版のシェルの土台で、apps/desktop の開発用の依存 <!-- req webcorefoundation:8a54496e.f617 --> <!-- req webcorefoundation:8a54496e.f7e6 -->
 * 15.4 節：作業パッケージ 1 は Electron の雛形（このファイル・preload・レンダラーの入口）を含む <!-- req webcorefoundation:712a4506.a2d5 -->
 * 6.1 節の main（apps/desktop/src/main に 1 つ）：アダプタの実際の仕事・⑤〜⑦・IPC のハンドラを持つ。7.2 節の⑤〜⑦はアダプタを通さず main で OS に直接触れる <!-- req webcorefoundation:60e75035.bbb4 --> <!-- req webcorefoundation:60e75035.68a4 --> <!-- req webcorefoundation:60e75035.99d5 --> <!-- req webcorefoundation:60e75035.b554 --> <!-- req webcorefoundation:4d0c1209.c1a1 --> <!-- req webcorefoundation:4d0c1209.56d0 -->
 *
 * 責務:
 *  - 単一インスタンスロックの取得（同一プロセスの二重起動防止）
 *  - contextIsolation:true / nodeIntegration:false / sandbox:true のウィンドウ生成
 *  - fs:* / fs:*At / appconfig:* / log:* / crash:* / window:* IPC ハンドラの登録（Adapter / Logger / WindowManager へ委譲）
 *  - 起動時のログクォータ適用（Logger.enforceQuota）とレンダラークラッシュ検知（CrashRecoveryController）
 *  - 曲一覧ウィンドウ・編集ウィンドウの複数ウィンドウ管理（WindowManager、screens-navigation.md 4.1 節）
 *
 * スコープ外（後続フェーズ）: ネイティブメニューの OS 登録（MenuBarController の buildTemplate() を使う配線は Phase 1 の
 * 追い込みで実施）、編集ウィンドウごとの Webコア DI 一式（renderer 側 bootstrap で段階的に結線、G23 P2 系）。
 * 8.1 節：PDF は専用のライブラリを入れず webContents.printToPDF() で作る（export-print.md の作業パッケージ）。alphaTex の書き出しは alphaTab の API <!-- req webcorefoundation:e0406137.26ae --> <!-- req webcorefoundation:e0406137.2d07 --> <!-- req webcorefoundation:e0406137.fdd9 --> <!-- req webcorefoundation:e0406137.b1d9 --> <!-- req webcorefoundation:e0406137.2996 -->
 * 7.2 節の⑤ OS のダイアログ（7.3 節のフォルダ選択 3 つ）と⑥メニューは、使う作業パッケージでここ（main）に足す。印刷の見えないウィンドウは export-print.md の作業パッケージ <!-- req webcorefoundation:6fb40fdd.3376 --> <!-- req webcorefoundation:6fb40fdd.5e80 --> <!-- req webcorefoundation:6fb40fdd.310a --> <!-- req webcorefoundation:6fb40fdd.e0c3 --> <!-- req webcorefoundation:6fb40fdd.8173 --> <!-- req webcorefoundation:ecf2feea.c0cb --> <!-- req webcorefoundation:ecf2feea.99ae --> <!-- req webcorefoundation:ecf2feea.6df8 --> <!-- req webcorefoundation:ecf2feea.42f9 --> <!-- req webcorefoundation:ecf2feea.a69b --> <!-- req webcorefoundation:ecf2feea.5e56 --> <!-- req webcorefoundation:51f64d21.5da1 --> <!-- req webcorefoundation:019a6dc4.091f --> <!-- req webcorefoundation:019a6dc4.2f43 --> <!-- req webcorefoundation:019a6dc4.0fb4 --> <!-- req webcorefoundation:019a6dc4.176f --> <!-- req webcorefoundation:97b94d07.cb37 --> <!-- req webcorefoundation:97b94d07.cb98 --> <!-- req webcorefoundation:97b94d07.713c --> <!-- req webcorefoundation:97b94d07.f8c3 --> <!-- req webcorefoundation:d915884f.be54 --> <!-- req webcorefoundation:d915884f.3b03 --> <!-- req webcorefoundation:d915884f.8e44 --> <!-- req webcorefoundation:d915884f.0a75 --> <!-- req webcorefoundation:d915884f.f689 --> <!-- req webcorefoundation:86b266c6.c472 -->
 * 7.1 節：シェル側（apps/desktop・apps/mobile）の責務は 7.2 節の 7 点だけ。7 点の外の機能と画面の部品は Webコアに置く（画面の部品を apps/desktop から移すのは作業パッケージ 8） <!-- req webcorefoundation:9ef31c3d.65bf --> <!-- req webcorefoundation:9ef31c3d.5669 --> <!-- req webcorefoundation:9ef31c3d.ed67 --> <!-- req webcorefoundation:9ef31c3d.b53e --> <!-- req webcorefoundation:9ef31c3d.0aa1 --> <!-- req webcorefoundation:e95e3825.045b --> <!-- req webcorefoundation:e95e3825.4505 --> <!-- req webcorefoundation:e95e3825.b800 --> <!-- req webcorefoundation:e95e3825.9516 --> <!-- req webcorefoundation:e95e3825.9642 --> <!-- req webcorefoundation:e95e3825.7f77 --> <!-- req webcorefoundation:e95e3825.50db --> <!-- req webcorefoundation:e95e3825.4ef5 --> <!-- req webcorefoundation:e95e3825.beac --> <!-- req webcorefoundation:e95e3825.6986 --> <!-- req webcorefoundation:ff43d25d.5c20 -->
 */
// <!-- req webcorefoundation:367f6477.3d1d --> <!-- req webcorefoundation:850fe53c.598d -->
// <!-- req webcorefoundation:3d0f46f7.b844 --> <!-- req webcorefoundation:3d0f46f7.25aa --> <!-- req webcorefoundation:3d0f46f7.c362 -->
// <!-- req webcorefoundation:6581ddd9.1870 --> <!-- req webcorefoundation:6581ddd9.4d0e -->

import { join } from 'node:path';

// errors サブパスから読む（main バレル経由だと alphaTab まで main プロセスへ引き込むため）。
import { DEFAULT_LOG_QUOTA_BYTES, Logger, toLogEntry } from '@riff-line/core/errors';
import { app, BrowserWindow, ipcMain } from 'electron';

import { AutoSaveFlushBridge } from './autoSaveFlushBridge';
import { CrashRecoveryController } from './CrashRecoveryController';
import { openDevToolsIfDebug } from './devTools';
import { ElectronAppLocalConfigService } from './ElectronAppLocalConfigService';
import { ElectronFileSystemAdapterFactory } from './ElectronFileSystemAdapterFactory';
import {
  focusFirstWindow,
  loadRenderer,
  openIfNoWindows,
  preventForeignNavigation,
  runWithSingleInstanceLock,
  windowForSong,
} from './entryDecisions';
import {
  registerAppConfigHandlers,
  registerFsAtHandlers,
  registerFsHandlers,
  registerLogHandlers,
  registerWindowHandlers,
} from './ipc';
import { LogRingBuffer } from './LogRingBuffer';
import { applyUserDataPath } from './userDataDir';
import { WindowManager, type ManagedWindow } from './WindowManager';

// data-model-persistence.md 11 節：アプリの領域のフォルダを、配布したアプリは RiFF-LiNE、開発で動かすときは RiFF-LiNE-dev にする。
// userData を使う所（下の appLocalConfig と単一インスタンスロック）より前に決める。
// 起動の引数 --user-data-dir があれば setPath せず、渡されたフォルダを使う（確かめのため）。
// web-core-foundation.md 14.7 節：この入口には分かれ道を置かず、判断は userDataDir.ts・devTools.ts・entryDecisions.ts の関数に出す。 <!-- req webcorefoundation:8f5284e2.db36 -->
applyUserDataPath(app);

// 端末ローカル領域（app.getPath('userData')）上のポインタ／既定ルート解決を担う。
// data-model-persistence.md 13.2 節：ローカル既定パスは Electron の app.getPath(userData) とする <!-- req datamodelpersistence:fdc64d7d.6065 -->
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
  // 6.2 節：どのウィンドウもこの関数で作るので、webPreferences の既定値はどのウィンドウでも変わらない。preload もウィンドウごとに 1 つ <!-- req webcorefoundation:462be277.8b31 --> <!-- req webcorefoundation:21f12fae.5ba5 -->
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      // electron-vite が preload を dist-electron/preload/preload.js（CJS）へ出力する。
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      // 6.2 節 <!-- req webcorefoundation:462be277.86ab -->
      nodeIntegration: false,
      // 6.2 節：レンダラーは Node.js の API に直接触れない <!-- req webcorefoundation:462be277.c1a5 --> <!-- req webcorefoundation:a23f31ef.aca3 -->
      // レンダラープロセスを OS サンドボックスで隔離する。electron.rule.md の「変更禁止」既定値。
      sandbox: true,
      // 6.2 節：既定値に頼らず明示する <!-- req webcorefoundation:89f96160.894f --> <!-- req webcorefoundation:89f96160.652e -->
    },
  });

  window.once('ready-to-show', () => window.show());

  // 新規ウィンドウ生成・あらゆるフレームのナビゲーションを既定で拒否する（オフライン方針・electron.rule.md）。
  // 許可するのは現在ロード中の URL 自身への遷移（リロード）のみ。ハッシュのみの変化（ルート遷移）は許可する。
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 6.2 節：# から後を除いて比べ、今のページと違う URL へは移らせない <!-- req webcorefoundation:89f96160.880f --> <!-- req webcorefoundation:89f96160.b3f4 -->
  const denyForeignNavigation = (event: { preventDefault: () => void }, url: string): void =>
    preventForeignNavigation(event, url, window.webContents.getURL());
  window.webContents.on('will-navigate', denyForeignNavigation);
  // 6.2 節 <!-- req webcorefoundation:89f96160.8a3b -->
  window.webContents.on('will-redirect', denyForeignNavigation);
  // 6.2 節 <!-- req webcorefoundation:89f96160.5ce1 -->
  window.webContents.on('will-frame-navigate', (event) => denyForeignNavigation(event, event.url));
  // 6.2 節 <!-- req webcorefoundation:89f96160.b389 -->

  // dev では electron-vite が Vite サーバーの URL を渡す。packaged ではビルド済み HTML を読む。
  loadRenderer(window, process.env['ELECTRON_RENDERER_URL'], route, join(__dirname, '../renderer/index.html'));

  // デバッグの形（run-app.mjs の debug）だけ、開発者ツールを別の窓で開く。配布したアプリでは開かない（5.3 節）。 <!-- req webcorefoundation:8bb46d4e.0f28 --> <!-- req webcorefoundation:cc4c9850.be24 -->
  openDevToolsIfDebug(app.isPackaged, process.env, window.webContents);

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

// 10.2 節：印刷と PDF の生成のあいだだけ、画面に出さない BrowserWindow（show: false）を 1 つ作り、作る時機と閉じる時機は B28 のキャッシュ（印刷プレビューで作ったものを、曲とレイアウトの設定が変わらなければ直後の印刷で使い回す）に合わせる（export-print.md の作業パッケージ） <!-- req webcorefoundation:c098d017.6531 --> <!-- req webcorefoundation:c098d017.7334 --> <!-- req webcorefoundation:c098d017.5643 --> <!-- req webcorefoundation:c098d017.038b --> <!-- req webcorefoundation:c098d017.44f1 --> <!-- req webcorefoundation:c098d017.bc8a -->
// 単一インスタンスロック: 取得できなければ二重起動なので終了する。取れたら下の startApp を走らせる。
// 6.1 節：main プロセスは 1 つ <!-- req webcorefoundation:60e75035.c85b -->
runWithSingleInstanceLock(app, startApp);

/** 単一インスタンスロックが取れたときの起動の手順。 */
function startApp(): void {
  // 2 つめの起動が来たら、開いているウィンドウの 1 枚目を前面に出す。
  app.on('second-instance', () => focusFirstWindow(BrowserWindow.getAllWindows()));

  void app.whenReady().then(async () => {
    // data-model-persistence.md 13.2 節：主ストレージがまだ決まっていなければ、ローカル既定パスの settings.json に設定全体を置く。
    await appLocalConfig.writeInitialSettingsIfUndetermined();
    // アクティブストレージルートを解決（settings.json にポインタが無ければ既定のローカル = {userData}/TabApp）してから IPC を受け付ける。
    const activeRoot = await appLocalConfig.getActiveRoot();
    // data-model-persistence.md 10.1 節：主ストレージのアダプタも、そのルートの絶対パスを渡して createForRoot で作る <!-- req datamodelpersistence:a5185d1e.5c3a -->
    const activeAdapter = adapterFactory.createForRoot(activeRoot);
    await activeAdapter.ensureDirectory('.');
    // data-model-persistence.md 13.2 節の (b)：既定のローカルの TabApp/ を作り終えたら主ストレージが決まったと数え、settings.json をポインタだけにする。
    await appLocalConfig.confirmDefaultLocalIfUndetermined();

    // ログ基盤（error-logging-foundation.md §2.2・§3.3）。起動時に 10MB クォータを適用する。
    const logger = new Logger(activeAdapter);
    // 7.2 節の①に含める：log:append で受けた記録を main の Logger がファイルに書く <!-- req webcorefoundation:725967b1.b52b --> <!-- req webcorefoundation:725967b1.9d2e --> <!-- req webcorefoundation:725967b1.ff3d -->
    await logger.enforceQuota(DEFAULT_LOG_QUOTA_BYTES);

    // クラッシュ時のクラッシュログ書き出しを結線する。
    crashRecovery = new CrashRecoveryController({
      onCrash: ({ reason }) => void logger.writeCrashLog(reason, logRing.snapshot()),
      // 7.2 節の⑦に含める：レンダラーが落ちた後のクラッシュログは main の Logger と直近の履歴（LogRingBuffer）で書く <!-- req webcorefoundation:999ac20b.7d51 --> <!-- req webcorefoundation:999ac20b.58c2 --> <!-- req webcorefoundation:999ac20b.8d0a -->
    });

    // 編集ウィンドウの songId → 実 BrowserWindow 対応（flush 要求の宛先解決に使う）。
    const editWindowsBySong = new Map<string, BrowserWindow>();
    // クローズ確定前の自動保存 flush ハンドシェイク（トークン付き request/ack、既定タイムアウト 5 秒）。
    const flushBridge = new AutoSaveFlushBridge(ipcMain);

    // 複数ウィンドウ管理（screens-navigation.md 4.1 節）。実 BrowserWindow 生成はここでファクトリとして渡す。
    const windowManager = new WindowManager({
      createSongListWindow: () => {
        // 6.1 節：曲一覧ウィンドウにレンダラー 1 つ <!-- req webcorefoundation:86b266c6.e986 -->
        const win = createBrowserWindow('songlist');
        crashRecovery.attach(win);
        return toManagedWindow(win);
      },
      createEditWindow: (songId) => {
        // 6.1 節：編集ウィンドウ（曲）ごとにレンダラー 1 つ。7.2 節の③ウィンドウ管理は main <!-- req webcorefoundation:86b266c6.f353 --> <!-- req webcorefoundation:4c0ea023.0763 -->
        const win = createBrowserWindow(`edit/${songId}`);
        editWindowsBySong.set(songId, win);
        win.on('closed', () => editWindowsBySong.delete(songId));
        crashRecovery.attach(win);
        return toManagedWindow(win);
      },
      // 編集ウィンドウ単位スコープの Webコア一式（CommandHistory 等）は renderer 側 bootstrap（App.tsx）が保持する。
      // main 側はライフサイクルのフックだけを持つ。renderer 側インスタンスの破棄はウィンドウ破棄に伴い GC される。
      // quality-allow-stub: 編集ウィンドウごとの一式は今の詳細設計に無い。作業パッケージ 8（画面群・ナビゲーション、screens-navigation.md 4.3 節）で依存を外すか結線する（00_reference.md 8.1 節 G65）
      createEditWindowInstances: () => ({ dispose: () => undefined }),
      // クローズ時の自動保存確定。対象ウィンドウの renderer へ flush を要求し、ack かタイムアウトまで待つ
      // （screens-navigation.md 4.4 節、data-model-persistence.md 15 節。renderer 側で実 AutoSaveScheduler.flush を差し込む配線は追い込み）。
      flushAutoSave: (songId) => flushBridge.requestFlush(songId, windowForSong(editWindowsBySong, songId)),
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
    // 編集ウィンドウを開く / 曲一覧を前面化する（screens-navigation.md 4.1 節）。
    registerWindowHandlers(ipcMain, windowManager);

    // 起動時は曲一覧ウィンドウを 1 枚（screens-navigation.md 4.1 節）。
    void windowManager.openSongListWindow();

    app.on('activate', () =>
      openIfNoWindows(BrowserWindow.getAllWindows(), () => void windowManager.openSongListWindow()),
    );
  });

  // 13.2 節：システムトレイには常駐しない。開いているウィンドウが 1 枚も無くなったらプロセスを終える
  app.on('window-all-closed', () => {
    app.quit();
  });
}
// <!-- req webcorefoundation:d9ca1865.20af --> <!-- req webcorefoundation:d9ca1865.255e --> <!-- req webcorefoundation:ae026fc8.11eb --> <!-- req webcorefoundation:ae026fc8.d428 -->
// 13.2 節：システムトレイの常駐は作らず、開いているウィンドウが 1 枚も無くなったらプロセスを終える（上の window-all-closed）。トレイを足すならアイコンとメニューは 7.2 節の⑥、プロセスを残す動きは③の中で受け、7 点の外へシェル側の責務を足さない <!-- req webcorefoundation:a1d8f3e6.c7b4 --> <!-- req webcorefoundation:a1d8f3e6.f2f2 --> <!-- req webcorefoundation:a1d8f3e6.f9f2 --> <!-- req webcorefoundation:a1d8f3e6.828f --> <!-- req webcorefoundation:a1d8f3e6.284e -->
