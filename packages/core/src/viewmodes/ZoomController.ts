/**
 * 表示モードごとに独立したズームレベルの保持（view-modes.md §3.2・§4.2、B16）。
 *
 * **編集ウィンドウ（＝開いている曲）ごとに 1 インスタンス**。3 つの表示モード（focus/scroll/score）で
 * ズーム値を共有せず、モードごとに独立して持つ（フォーカス＝精密編集と全体確認では最適なズーム量が
 * 大きく異なり、共有だとモード切替のたびに再調整が要るため）。
 *
 * `ScoreRenderHost` の生 API には触れず、`ViewModeRenderHost.applyZoom(scale)` にのみ依存する。
 * ステータスバー表示（03_screens_ui_pc.md §5）へは `onZoomChange` コールバックで現在の％を通知する。
 */

import type { RenderViewMode, ViewModeRenderHost } from './types';

/** ズーム対象の表示モード一覧。 */
export const ZOOM_VIEW_MODES: readonly RenderViewMode[] = ['focus', 'scroll', 'score'];

/**
 * モード別の既定ズーム％（view-modes.md §3.2）。
 * フォーカス＝1 画面に 1〜2 小節、全体スクロール／スコア＝4〜8 小節が収まる目安。
 * 正確な換算は alphaTab のレイアウトに依存するため暫定値。負荷テスト／パッケージ8で微調整する。
 */
export const DEFAULT_ZOOM_PERCENT_BY_MODE: Readonly<Record<RenderViewMode, number>> = {
  focus: 180,
  scroll: 100,
  score: 100,
};

/** ズーム％の下限・上限・ステップ（要件4.5「全曲俯瞰〜1音符単位」）。 */
export const MIN_ZOOM_PERCENT = 25;
export const MAX_ZOOM_PERCENT = 400;
export const ZOOM_STEP_PERCENT = 10;

export interface ZoomControllerOptions {
  /**
   * モード別の初期ズーム％の注入口。パッケージ8の `AppPreferencesService`（設定ダイアログ項目③
   * 「デフォルトズームレベル」の倍率）由来の値を bootstrap が渡す（00_reference.md §3.6）。
   * 省略したモードは `DEFAULT_ZOOM_PERCENT_BY_MODE`。
   */
  initialZoomPercentByMode?: Partial<Record<RenderViewMode, number>>;
  /** ズーム％が変わるたびに呼ばれる（ステータスバー更新用）。 */
  onZoomChange?: (percent: number, mode: RenderViewMode) => void;
}

/** ％を [MIN, MAX] に丸め、整数へ量子化する。 */
function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return MIN_ZOOM_PERCENT;
  return Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, Math.round(percent)));
}

export class ZoomController {
  /** モード → 現在のズーム％。コンストラクタで 3 モード分を必ず確定させる（欠損キーは持たない）。 */
  private readonly zoomByMode: Record<RenderViewMode, number>;

  /**
   * @param host ズーム適用先（`ScoreRenderHost`）。
   * @param getCurrentMode 現在の表示モードの問い合わせ先（`ViewModeController.currentMode`）。
   *   view-modes.md §5.3 の「ZOOM→VMC: 現在の表示モードを問い合わせ」に対応する。
   */
  constructor(
    private readonly host: ViewModeRenderHost,
    private readonly getCurrentMode: () => RenderViewMode,
    private readonly options: ZoomControllerOptions = {},
  ) {
    const injected = options.initialZoomPercentByMode ?? {};
    this.zoomByMode = {
      focus: clampPercent(injected.focus ?? DEFAULT_ZOOM_PERCENT_BY_MODE.focus),
      scroll: clampPercent(injected.scroll ?? DEFAULT_ZOOM_PERCENT_BY_MODE.scroll),
      score: clampPercent(injected.score ?? DEFAULT_ZOOM_PERCENT_BY_MODE.score),
    };
  }

  /** 現在モードのズーム％。 */
  get zoomPercent(): number {
    return this.zoomPercentOf(this.getCurrentMode());
  }

  /** 指定モードのズーム％。 */
  zoomPercentOf(mode: RenderViewMode): number {
    return this.zoomByMode[mode];
  }

  /**
   * 現在モードのズーム％を設定する（ズームスライダー操作、view-modes.md §5.3）。
   * [MIN, MAX] に丸めたうえで保存し、`host` へ適用、`onZoomChange` で通知する。
   */
  setZoom(percent: number): void {
    this.commit(this.getCurrentMode(), clampPercent(percent));
  }

  /** 現在モードのズームを 1 ステップ拡大する（Ctrl+ + / Ctrl+ホイール）。 */
  zoomIn(): void {
    this.setZoom(this.zoomPercent + ZOOM_STEP_PERCENT);
  }

  /** 現在モードのズームを 1 ステップ縮小する（Ctrl+ - / Ctrl+ホイール）。 */
  zoomOut(): void {
    this.setZoom(this.zoomPercent - ZOOM_STEP_PERCENT);
  }

  /**
   * 現在モードの保存済みズームを `host` へ再適用する（view-modes.md §5.1）。
   * `ViewModeController` のモード切替後に bootstrap が呼び、切替先モードのズームを反映する。
   */
  reapplyForCurrentMode(): void {
    const mode = this.getCurrentMode();
    this.commit(mode, this.zoomPercentOf(mode));
  }

  /** ％を保存し、alphaTab スケール（1 = 100%）へ変換して適用、通知する。 */
  private commit(mode: RenderViewMode, percent: number): void {
    this.zoomByMode[mode] = percent;
    this.host.applyZoom(percent / 100);
    this.options.onZoomChange?.(percent, mode);
  }
}
