/**
 * Electron メインプロセスのエントリポイント（web-core-foundation.md 6 節・7.2 節、data-model-persistence.md 10.1 節、
 * screens-navigation.md 4.1 節・4.4 節）。
 * 8.1 節：Electron は PC 版のシェルの土台で、apps/desktop の開発用の依存 <!-- req webcorefoundation:8a54496e.f617 --> <!-- req webcorefoundation:8a54496e.f7e6 -->
 * 15.4 節：作業パッケージ 1 は Electron の雛形（このファイル・preload・レンダラーの入口）を含む <!-- req webcorefoundation:712a4506.a2d5 -->
 * 6.1 節の main（apps/desktop/src/main に 1 つ）：アダプタの実際の仕事・⑤〜⑦・IPC のハンドラを持つ。7.2 節の⑤〜⑦はアダプタを通さず main で OS に直接触れる <!-- req webcorefoundation:c49f0398.bbb4 --> <!-- req webcorefoundation:c49f0398.68a4 --> <!-- req webcorefoundation:c49f0398.99d5 --> <!-- req webcorefoundation:c49f0398.b554 --> <!-- req webcorefoundation:4d0c1209.c1a1 --> <!-- req webcorefoundation:4d0c1209.56d0 -->
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
 * 7.2 節の⑤ OS のダイアログ（7.3 節のフォルダ選択 3 つ）と⑥メニューは、使う作業パッケージでここ（main）に足す。印刷の見えないウィンドウは export-print.md の作業パッケージ <!-- req webcorefoundation:2fd33c51.3376 --> <!-- req webcorefoundation:2fd33c51.5e80 --> <!-- req webcorefoundation:2fd33c51.e0c3 --> <!-- req webcorefoundation:2fd33c51.8173 --> <!-- req webcorefoundation:a2d1a83c.0776 --> <!-- req webcorefoundation:a2d1a83c.555b --> <!-- req webcorefoundation:a2d1a83c.4535 --> <!-- req webcorefoundation:a2d1a83c.a69b --> <!-- req webcorefoundation:a2d1a83c.9bc4 --> <!-- req webcorefoundation:019a6dc4.091f --> <!-- req webcorefoundation:019a6dc4.2f43 --> <!-- req webcorefoundation:019a6dc4.0fb4 --> <!-- req webcorefoundation:019a6dc4.176f --> <!-- req webcorefoundation:97b94d07.cb37 --> <!-- req webcorefoundation:97b94d07.cb98 --> <!-- req webcorefoundation:97b94d07.713c --> <!-- req webcorefoundation:97b94d07.f8c3 --> <!-- req webcorefoundation:d915884f.be54 --> <!-- req webcorefoundation:d915884f.3b03 --> <!-- req webcorefoundation:d915884f.8e44 --> <!-- req webcorefoundation:d915884f.0a75 --> <!-- req webcorefoundation:d915884f.f689 --> <!-- req webcorefoundation:86b266c6.c472 -->
 * 7.1 節：シェル側（apps/desktop・apps/mobile）の責務は 7.2 節の 7 点だけ。7 点の外の機能と画面の部品は Webコアに置く（画面の部品を apps/desktop から移すのは作業パッケージ 8） <!-- req webcorefoundation:9ef31c3d.65bf --> <!-- req webcorefoundation:9ef31c3d.5669 --> <!-- req webcorefoundation:9ef31c3d.ed67 --> <!-- req webcorefoundation:9ef31c3d.b53e --> <!-- req webcorefoundation:9ef31c3d.0aa1 --> <!-- req webcorefoundation:9cad6d94.045b --> <!-- req webcorefoundation:9cad6d94.4505 --> <!-- req webcorefoundation:9cad6d94.b800 --> <!-- req webcorefoundation:9cad6d94.9516 --> <!-- req webcorefoundation:9cad6d94.9642 --> <!-- req webcorefoundation:9cad6d94.7f77 --> <!-- req webcorefoundation:9cad6d94.50db --> <!-- req webcorefoundation:9cad6d94.4ef5 --> <!-- req webcorefoundation:9cad6d94.beac --> <!-- req webcorefoundation:9cad6d94.6986 --> <!-- req webcorefoundation:d599e740.5c20 -->
 */
// <!-- req webcorefoundation:367f6477.3d1d --> <!-- req webcorefoundation:850fe53c.598d -->
// <!-- req webcorefoundation:3d0f46f7.b844 --> <!-- req webcorefoundation:3d0f46f7.25aa --> <!-- req webcorefoundation:3d0f46f7.c362 -->
// <!-- req webcorefoundation:7cb842f8.1870 -->
// 作業パッケージ 8 で作る（plan の受け持ち）：⑥ネイティブのメニュー（右クリックのメニューは main で組まず画面で描く）、メニューで選ばれた項目をレンダラーへ送る知らせ（web-core-foundation.md 6.1 節・6.3 節・7.2 節） <!-- req webcorefoundation:7cb842f8.2214 --> <!-- req webcorefoundation:7cb842f8.e82e --> <!-- req webcorefoundation:c49f0398.9ed6 --> <!-- req webcorefoundation:563536f0.cb8e -->
// 作業パッケージ 3 で作る（plan の受け持ち）：⑤に入れるフリーズのダイアログ（dialog.showMessageBox）とログフォルダを開く口（shell.openPath）。⑤のうちフォルダを開くことは Phase 2 の書き出し・印刷と共同、ファイル選択のダイアログは作業パッケージ 8、印刷の OS ダイアログは Phase 2 の書き出し・印刷が作る（web-core-foundation.md 7.2 節） <!-- req webcorefoundation:2fd33c51.310a --> <!-- req webcorefoundation:2fd33c51.9c77 --> <!-- req webcorefoundation:2fd33c51.0a75 --> <!-- req webcorefoundation:2fd33c51.bfde --> <!-- req webcorefoundation:2fd33c51.28f5 -->

import { join } from 'node:path';

import { errorCodeRegistry } from '@riff-line/core/errors'; // <!-- req webcorefoundation:c6e13e49.0b8f -->
import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';

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
  registerSharedChangeHandlers,
  registerWindowHandlers,
} from './ipc';
import { MainErrorLogger, registerMainUncaughtHandlers, reportThroughMainErrorLogger } from './mainErrorLogger';
import { flushLogsThenQuit, MainLogging } from './mainLogging';
import { quitAfterMirrorSync, setUpMirrorSync, type MainMirrorSync } from './mirrorSync';
import { registerThumbnailHandlers } from './thumbnailRegenerate';
import { applyUserDataPath } from './userDataDir';
import { WindowManager, type ManagedWindow } from './WindowManager';

// data-model-persistence.md 11 節：アプリの領域のフォルダを、配布したアプリは RiFF-LiNE、開発で動かすときは RiFF-LiNE-dev にする。
// userData を使う所（下の appLocalConfig と単一インスタンスロック）より前に決める。
// 起動の引数 --user-data-dir があれば setPath せず、渡されたフォルダを使う（確かめのため）。
// web-core-foundation.md 14.7 節：この入口には分かれ道を置かず、判断は userDataDir.ts・devTools.ts・entryDecisions.ts の関数に出す。 <!-- req webcorefoundation:8f5284e2.db36 -->
applyUserDataPath(app);

// 端末ローカル領域（app.getPath('userData')）上のポインタ／既定ルート解決を担う。
// data-model-persistence.md 13.2 節：ローカル既定パスは Electron の app.getPath(userData) とする <!-- req datamodelpersistence:fdc64d7d.6065 -->
// <!-- req datamodelpersistence:eb1ed8ce.4b08 -->
const appLocalConfig = new ElectronAppLocalConfigService(app.getPath('userData'));
// error-logging-foundation.md 2.6 節：main で出たエラーの口。Logger を作った直後（whenReady 内）に作る。下の adapterFactory の report が引く。
let mainErrorLogger: MainErrorLogger | undefined;
// 任意ルートのアダプタ生成器（アクティブストレージ・ミラー先・移行元/先を横断的に扱う）。
// data-model-persistence.md 16 節：読み直しが尽きたときの FILE-003 は MainErrorLogger の report で出す（error-logging-foundation.md 2.6 節）。
// アダプタは MainErrorLogger より先にできるので、呼ばれたときに上の mainErrorLogger を引く。作る前は記録せずコンソールにだけ出す（2.6 節の (b)）。
// 共有の notificationCenter を経て渡し直す口は置かない（data-model-persistence.md 14.1 節の (b)、honnin-queue 228 番）。
const adapterFactory = new ElectronFileSystemAdapterFactory({
  // <!-- req datamodelpersistence:9447272d.b682 -->
  // <!-- req errorloggingfoundation:d4b54e58.1c52 -->
  report: reportThroughMainErrorLogger(() => mainErrorLogger),
});

// レンダラークラッシュの検知・再読み込み・繰り返し判定（error-logging-foundation.md 2.3 節）。
// onCrash → Logger.writeCrashLog の結線は logger 生成後（whenReady 内）に行うため let で保持する。
let crashRecovery: CrashRecoveryController;
// data-model-persistence.md 14.1 節：main のミラーの写し（主ストレージのルートごとの MirrorSyncService）。logger 生成後（whenReady 内）に組み立てる。
let mirrorSync: MainMirrorSync | undefined;
// error-logging-foundation.md 2.4 節：main の Logger と直近の履歴（LogRingBuffer）。whenReady 内で組み立て、終了の順の最後に flush する（決定 T1）。
let mainLogging: MainLogging | undefined;

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
function toManagedWindow(window: BrowserWindow): ManagedWindow<BrowserWindow> {
  return {
    id: window.id,
    native: window,
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
// 6.1 節：main プロセスは 1 つ <!-- req webcorefoundation:c49f0398.a29e -->
runWithSingleInstanceLock(app, startApp);

/** 単一インスタンスロックが取れたときの起動の手順。 */
function startApp(): void {
  // 2 つめの起動が来たら、開いているウィンドウの 1 枚目を前面に出す。
  // <!-- req datamodelpersistence:e95fc8c9.61b9 -->
  // <!-- req datamodelpersistence:3f4060a3.4365 -->
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

    // ログ基盤（error-logging-foundation.md 2.4 節・3.3 節）。主ストレージのアダプタで Logger を作り、起動時に 10MB クォータを 1 回当てる。
    // 保存先を動いている途中で変えたら、shared:changed の storage で書き先を新しい主ストレージのアダプタに替える（K1）。
    // <!-- req errorloggingfoundation:8157cf58.778e --> <!-- req errorloggingfoundation:f1b0b76f.7b19 --> <!-- req errorloggingfoundation:f1b0b76f.40c7 -->
    // 00_reference.md 3 節：Logger は main の永続ログで、FileSystemAdapter をここで注入する <!-- req 00:04f6cd00.0b7f -->
    const logging = await MainLogging.start(activeAdapter, {
      resolvePrimaryStore: async () => adapterFactory.createForRoot(await appLocalConfig.getActiveRoot()),
    });
    // 7.2 節の①に含める：log:append で受けた記録を main の Logger がファイルに書く <!-- req webcorefoundation:ab09caa8.b52b --> <!-- req webcorefoundation:ab09caa8.9d2e --> <!-- req webcorefoundation:ab09caa8.ff3d -->
    mainLogging = logging;

    // error-logging-foundation.md 2.6 節：Logger を作った直後に MainErrorLogger を作る。main で出たエラーは renderer を通さず、
    // ここで LogRingBuffer に積んでからその時の書き先の Logger.append に書き（保存先を変えても作り直さない）、画面に出す記録だけを
    // WindowManager が持つ曲一覧と編集の窓へ notify:fromMain で送る（印刷用の見えない窓は入れない）。
    // targetWindows は送るときに引くので、下で作る windowManager をそのとき使う。
    const errors = new MainErrorLogger({
      registry: errorCodeRegistry,
      // <!-- req errorloggingfoundation:39c2570b.55e6 -->
      // <!-- req 00:ed9feb8c.0965 -->
      // <!-- req webcorefoundation:ab09caa8.fb17 -->
      writeLog: (entry) => logging.writeLog(entry),
      // <!-- req errorloggingfoundation:14ac861c.1375 -->
      targetWindows: () => windowManager.openWindows(), // <!-- req errorloggingfoundation:14ac861c.9a7e --> // <!-- req webcorefoundation:f09ef65e.d226 --> // <!-- req webcorefoundation:ab09caa8.83d6 -->
    });
    // 作った直後に 1 回：process の uncaughtException・unhandledRejection を SYS-005 で記録する（これより前の例外は Electron の既定の扱い）
    // <!-- req errorloggingfoundation:d4b54e58.d381 -->
    // <!-- req errorloggingfoundation:d4b54e58.1da7 -->
    registerMainUncaughtHandlers(errors);
    // main の中で動く Webコアのサービス（MirrorSyncService の FILE-005、下の setUpMirrorSync の errors で constructor へ渡す）と
    // アダプタの FILE-003（上の adapterFactory の report がここから後この口を引く）も、この口で出す（honnin-queue 228 番）
    // <!-- req errorloggingfoundation:f784b298.4899 -->
    mainErrorLogger = errors;

    // クローズ確定前の自動保存 flush ハンドシェイク（トークン付き request/ack）。時間では打ち切らず、画面が落ちた・固まったときだけ
    // CrashRecoveryController が abandonFlush で待ちを打ち切るので、先に作って渡す（error-logging-foundation.md 2.3 節）。
    const flushBridge = new AutoSaveFlushBridge(ipcMain); // <!-- req errorloggingfoundation:8ad1f1c7.fd4e --> <!-- req screensnavigation:4022df52.695c -->

    // クラッシュ時のクラッシュログ書き出しを結線する。
    // <!-- req errorloggingfoundation:efe204dd.560d --> <!-- req errorloggingfoundation:adb7f025.9357 -->
    crashRecovery = new CrashRecoveryController({
      // error-logging-foundation.md 2.4 節：onCrash({reason}) → Logger.writeCrashLog(reason, LogRingBuffer.snapshot())
      // <!-- req errorloggingfoundation:efe204dd.a146 --> <!-- req errorloggingfoundation:b3b456d4.2559 --> <!-- req errorloggingfoundation:b3b456d4.3ea3 -->
      onCrash: ({ reason }) => void logging.writeCrashLog(reason),
      // 7.2 節の⑦に含める：レンダラーが落ちた後のクラッシュログは main の Logger と直近の履歴（LogRingBuffer）で書く <!-- req webcorefoundation:999ac20b.7d51 --> <!-- req webcorefoundation:999ac20b.58c2 --> <!-- req webcorefoundation:999ac20b.8d0a -->
      // error-logging-foundation.md 2.3 節：CrashRecoveryState.logFolder の出どころ（決定 O3）
      // <!-- req errorloggingfoundation:efe204dd.cb09 -->
      getLogFolder: () => logging.logger.getLogFolderAbsolutePath(),
      // error-logging-foundation.md 2.3 節：render-process-gone と 5 秒続いた unresponsive でその窓の flush の待ちを打ち切る
      flushBridge, // <!-- req screensnavigation:4022df52.226d -->
    });

    // 編集ウィンドウの songId → 実 BrowserWindow 対応（flush 要求の宛先解決に使う）。
    const editWindowsBySong = new Map<string, BrowserWindow>(); // <!-- req 00:3405ea3c.973f -->

    // 複数ウィンドウ管理（screens-navigation.md 4.1 節）。実 BrowserWindow 生成はここでファクトリとして渡す。
    const windowManager = new WindowManager<BrowserWindow>({
      createSongListWindow: () => {
        // 6.1 節：曲一覧ウィンドウにレンダラー 1 つ <!-- req webcorefoundation:86b266c6.e986 -->
        const win = createBrowserWindow('songlist');
        return toManagedWindow(win);
      },
      createEditWindow: (songId) => {
        // 6.1 節：編集ウィンドウ（曲）ごとにレンダラー 1 つ。7.2 節の③ウィンドウ管理は main <!-- req webcorefoundation:86b266c6.f353 --> <!-- req webcorefoundation:4e1f8866.0763 -->
        const win = createBrowserWindow(`edit/${songId}`);
        editWindowsBySong.set(songId, win);
        win.on('closed', () => editWindowsBySong.delete(songId));
        return toManagedWindow(win);
      },
      // error-logging-foundation.md 2.3 節：窓を作るたびに WindowManager が attach を呼び、閉じたらその窓の分を消させる（決定 D3・L2）
      crashRecovery,
      // 編集ウィンドウ単位スコープの Webコア一式（CommandHistory 等）は renderer 側 bootstrap（App.tsx）が保持する。
      // main 側はライフサイクルのフックだけを持つ。renderer 側インスタンスの破棄はウィンドウ破棄に伴い GC される。
      // quality-allow-stub: 編集ウィンドウごとの一式は今の詳細設計に無い。作業パッケージ 8（画面群・ナビゲーション、screens-navigation.md 4.3 節）で依存を外すか結線する（00_reference.md 8.1 節 G65）
      createEditWindowInstances: () => ({ dispose: () => undefined }),
      // クローズ時の自動保存確定。対象ウィンドウの renderer へ flush を要求し、ack か打ち切り（abandonFlush）まで待つ
      // （screens-navigation.md 4.4 節、data-model-persistence.md 15 節。renderer 側で実 AutoSaveScheduler.flush を差し込む配線は追い込み）。
      flushAutoSave: (songId) => flushBridge.requestFlush(songId, windowForSong(editWindowsBySong, songId)), // <!-- req 00:3405ea3c.95d6 -->
    });

    // data-model-persistence.md 10.1 節の (b)：単一のルートの 5 つは、呼ばれるたびに今の主ストレージのルートを引いて使う（起動時の activeAdapter は渡さない）
    registerFsHandlers(ipcMain, adapterFactory, () => appLocalConfig.getActiveRoot());
    registerFsAtHandlers(ipcMain, adapterFactory);
    registerAppConfigHandlers(
      ipcMain,
      appLocalConfig,
      () => appLocalConfig.getActiveRoot(),
      () => appLocalConfig.getLocalBackupRoot(),
      // data-model-persistence.md 10.1 節：appconfig:getPreMigrationRoot（LocalBackup/ と同じ親の下の PreMigration/、honnin-queue 206 番）
      () => appLocalConfig.getPreMigrationRoot(),
      // data-model-persistence.md 10.1 節：appconfig:deleteWindowBounds（ゴミ箱で完全に消した曲の 1 件を消す、17 節の (b)、honnin-queue 216 番）
      (songId) => appLocalConfig.deleteWindowBounds(songId),
    );
    // error-logging-foundation.md 2.4 節：log:append（LogEntry をそのまま Logger.append と LogRingBuffer.push へ）・crash:getRecoveryState・
    // window:reloadAfterRenderError（どちらも送り手の窓を渡す、2.3 節）・app:openLogFolder（shell.openPath）
    registerLogHandlers(ipcMain, {
      logger: logging.logger,
      ring: logging.ring,
      // <!-- req errorloggingfoundation:efe204dd.ddad -->
      senderWindow: (event) => BrowserWindow.fromWebContents((event as IpcMainInvokeEvent).sender),
      crashRecovery,
      // <!-- req errorloggingfoundation:8521749a.9458 -->
      openPath: (path) => shell.openPath(path),
    });
    // data-model-persistence.md 14.1 節：主ストレージのルートごとに MirrorSyncService を 1 つ作って使い回し、mirror:syncAfterSave を受ける（honnin-queue 214 番）。
    // 下の shared:changed の知らせで使うものを替えるので、知らせを受け付ける前に組み立てる（12 節・14.1 節の (b)、K1）。
    const mainMirrorSync = setUpMirrorSync(ipcMain, {
      adapterFactory,
      resolveActiveRoot: () => appLocalConfig.getActiveRoot(),
      defaultPrimaryRoot: app.getPath('userData'),
      // error-logging-foundation.md 2.6 節：MirrorSyncService の FILE-005 と終了の処理が出す FILE-015 も MainErrorLogger の口で出す
      // <!-- req datamodelpersistence:ee31d579.6283 -->
      // <!-- req datamodelpersistence:9447272d.6ca5 -->
      errors,
    });
    mirrorSync = mainMirrorSync;
    // data-model-persistence.md 9.1 節：曲一覧が写しを見つけられないとき、thumbnail:regenerate で今の主ストレージの曲のファイルを読み、
    // appMeta.thumbnail から thumbnails/{songId}.png を作り直す（中身は Webコアの regenerateThumbnailCopy。alphaTab を引き込まない）
    registerThumbnailHandlers(ipcMain, { adapterFactory, resolveActiveRoot: () => appLocalConfig.getActiveRoot() });
    // data-model-persistence.md 19 節の (b)：main に SongRepository・TrashService を作らない。取り込み（songs/ の中か外かの見分け・写す・ <!-- req datamodelpersistence:01d02281.995f --> <!-- req datamodelpersistence:01d02281.0d6b -->
    // index.json に足す・ゴミ箱へ移す）は曲一覧のレンダラーが Webコアの SongImportService で行い、曲のファイルの書き手をレンダラーに置く
    // web-core-foundation.md 6.3 節：shared:changed を送った窓を除く全部の窓へ配り、main の中では storage で Logger の書き先と、
    // 使う MirrorSyncService を替える（data-model-persistence.md 12 節・14.1 節の (b)、K1）
    registerSharedChangeHandlers(ipcMain, {
      targetWindows: () => BrowserWindow.getAllWindows(),
      // <!-- req errorloggingfoundation:f1b0b76f.78f4 -->
      onNotice: (notice) => {
        void logging.onSharedChange(notice);
        void mainMirrorSync.onSharedChange(notice);
      },
    });
    // 編集ウィンドウを開く / 曲一覧を前面化する（screens-navigation.md 4.1 節）。
    registerWindowHandlers(ipcMain, windowManager);

    // 起動時は曲一覧ウィンドウを 1 枚（screens-navigation.md 4.1 節）。
    void windowManager.openSongListWindow();

    app.on('activate', () =>
      openIfNoWindows(BrowserWindow.getAllWindows(), () => void windowManager.openSongListWindow()),
    );
  });

  // 13.2 節：システムトレイには常駐しない。開いているウィンドウが 1 枚も無くなったらプロセスを終える
  // data-model-persistence.md 14.1 節：最後のウィンドウが閉じた後に、main が持つ全部の MirrorSyncService の写しを待ってから終える（honnin-queue 214 番）
  // <!-- req datamodelpersistence:ee31d579.77bf -->
  // error-logging-foundation.md 2.4 節：ミラーの待ちが終わった後、終了の順の最後に Logger.flush() を 1 回呼んでから終える（決定 T1）
  // <!-- req errorloggingfoundation:a4fd041d.7c47 -->
  app.on('window-all-closed', () => {
    // <!-- req errorloggingfoundation:f1b0b76f.a705 --> <!-- req errorloggingfoundation:a4fd041d.f3e8 --> <!-- req errorloggingfoundation:24d6e022.7acc -->
    void quitAfterMirrorSync(mirrorSync, () => void flushLogsThenQuit(mainLogging, () => app.quit()));
  });
}
// <!-- req webcorefoundation:3a9ef605.20af --> <!-- req webcorefoundation:3a9ef605.255e --> <!-- req webcorefoundation:ae026fc8.11eb --> <!-- req webcorefoundation:ae026fc8.d428 -->
// 13.2 節：システムトレイの常駐は作らず、開いているウィンドウが 1 枚も無くなったらプロセスを終える（上の window-all-closed）。トレイを足すならアイコンとメニューは 7.2 節の⑥、プロセスを残す動きは③の中で受け、7 点の外へシェル側の責務を足さない <!-- req webcorefoundation:a1d8f3e6.c7b4 --> <!-- req webcorefoundation:a1d8f3e6.f2f2 --> <!-- req webcorefoundation:a1d8f3e6.f9f2 --> <!-- req webcorefoundation:a1d8f3e6.828f --> <!-- req webcorefoundation:a1d8f3e6.284e -->
