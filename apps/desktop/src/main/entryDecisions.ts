/**
 * Electron メインプロセスの入口（main.ts）から出した判断の関数（web-core-foundation.md 14.7 節、2026-10-25 本人決定）。 <!-- req webcorefoundation:c27f130d.2c1f --> <!-- req webcorefoundation:8f5284e2.6075 -->
 *
 * 入口は単体テストで読み込まず数えに出ないので、入口には分かれ道を置かず、判断はこのファイルの関数に出して単体テストで通す。
 * Electron の API（`app`・`BrowserWindow`・`webContents`）は引数で受け、このファイルでは import しない（テストで偽物を渡すため）。
 * 単体テストは apps/desktop/src/dev/entry.test.ts（UT-DEV-ENTRY）。
 */

/** 単一インスタンスロックに使う `app` の部分。 */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
}

/**
 * 単一インスタンスロックを取り、取れたときだけ起動の手順を走らせる。取れなければ二重起動なので終了する（6.1 節：main プロセスは 1 つ）。
 * @param app Electron の `app`
 * @param start ロックが取れたときに走らせる起動の手順
 */
export function runWithSingleInstanceLock(app: SingleInstanceApp, start: () => void): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  start();
}

/** 前面に出すウィンドウの部分（Electron の `BrowserWindow`）。 */
export interface RestorableWindow {
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}

/**
 * 2 つめの起動が来たとき、開いているウィンドウの 1 枚目を前面に出す。最小化されていれば元に戻す。ウィンドウが無ければ何もしない。
 * @param windows Electron の `BrowserWindow.getAllWindows()`
 */
export function focusFirstWindow(windows: readonly RestorableWindow[]): void {
  const [existing] = windows;
  if (!existing) return;
  if (existing.isMinimized()) existing.restore();
  existing.focus();
}

/**
 * 開いているウィンドウが 1 枚も無いときだけ開く（`activate` のとき。screens-navigation.md 4.1 節の曲一覧ウィンドウ）。
 * @param windows Electron の `BrowserWindow.getAllWindows()`
 * @param open ウィンドウを開く手順
 */
export function openIfNoWindows(windows: readonly unknown[], open: () => void): void {
  if (windows.length === 0) open();
}

/**
 * 曲の編集ウィンドウを引く。開いていなければ null（flush の要求の宛先、screens-navigation.md 4.4 節）。
 * @param windowsBySong 曲の ID → 編集ウィンドウ
 * @param songId 曲の ID
 */
export function windowForSong<W>(windowsBySong: ReadonlyMap<string, W>, songId: string): W | null {
  return windowsBySong.get(songId) ?? null;
}

/**
 * URL から `#` より後を除く。
 * @param url URL
 */
export function stripHash(url: string): string {
  const at = url.indexOf('#');
  return at === -1 ? url : url.slice(0, at);
}

/**
 * `#` から後を除いて比べ、今のページと違う URL へは移らせない（6.2 節）。ハッシュだけの変化（ルートの遷移）とリロードは許す。
 * @param event ナビゲーションのイベント
 * @param url 移ろうとしている URL
 * @param currentUrl 今のページの URL（`webContents.getURL()`）
 */
export function preventForeignNavigation(event: { preventDefault(): void }, url: string, currentUrl: string): void {
  if (stripHash(url) !== stripHash(currentUrl)) event.preventDefault();
}

/** レンダラーを読み込むウィンドウの部分（Electron の `BrowserWindow`）。 */
export interface RendererLoader {
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string, options: { hash: string }): Promise<void>;
}

/**
 * レンダラーを読み込む。開発のとき（electron-vite が Vite のサーバーの URL を渡す）はその URL を、
 * 渡されないとき（配布したアプリ）はビルド済みの HTML を読む。どちらもルートをハッシュで渡す。
 * @param window 読み込むウィンドウ
 * @param rendererUrl 環境変数 `ELECTRON_RENDERER_URL`
 * @param route ハッシュのルート（`'songlist'` / `'edit/<songId>'`）
 * @param indexHtmlPath ビルド済みの HTML の場所
 */
export function loadRenderer(
  window: RendererLoader,
  rendererUrl: string | undefined,
  route: string,
  indexHtmlPath: string,
): void {
  if (rendererUrl) {
    void window.loadURL(`${rendererUrl}#${route}`);
    return;
  }
  void window.loadFile(indexHtmlPath, { hash: route });
}
