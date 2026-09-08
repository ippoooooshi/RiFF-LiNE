/**
 * 表示モード（L2）の公開バレル（view-modes.md）。
 *
 * `ViewModeController`（focus/scroll/score の切替・フォーカス範囲追従）と
 * `ZoomController`（モードごとに独立したズーム保持、B16）。いずれも編集ウィンドウ単位スコープ。
 * エラーコードの追加はない。
 */

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
