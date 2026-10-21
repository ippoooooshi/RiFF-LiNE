/**
 * 表示モード（L1、web-core-foundation.md 2.1 節）の公開バレル（view-modes.md）。
 *
 * `ViewModeController`（focus/scroll/score の切替・フォーカス範囲追従）と
 * `ZoomController`（モードごとに独立したズーム保持、B16）。いずれも編集ウィンドウ単位スコープ。
 * エラーコードの追加はない。
 */
// <!-- req webcorefoundation:2f7f74b8.6910 --> <!-- req webcorefoundation:2f7f74b8.3273 --> <!-- req webcorefoundation:2f7f74b8.6118 --> <!-- req webcorefoundation:2f7f74b8.994e -->

// FocusRange / RenderViewMode / ViewModeRenderRequest は rendering バレルが真実源のため再エクスポートしない。
export type { CursorLike, ViewModeRenderHost } from './types';
export {
  ViewModeController,
  FOCUS_RANGE_BAR_SPAN,
  DEFAULT_INITIAL_VIEW_MODE,
  type ViewModeControllerOptions,
} from './ViewModeController';
export {
  ZoomController,
  ZOOM_VIEW_MODES,
  DEFAULT_ZOOM_PERCENT_BY_MODE,
  MIN_ZOOM_PERCENT,
  MAX_ZOOM_PERCENT,
  ZOOM_STEP_PERCENT,
  type ZoomControllerOptions,
} from './ZoomController';
