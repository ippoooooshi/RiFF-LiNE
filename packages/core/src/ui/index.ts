/**
 * 画面群・ナビゲーション（L1〜L2、フレームワーク非依存部分）の公開バレル（screens-navigation.md §4）。
 *
 * React コンポーネント（JSX）はここには含まない。画面の「見た目に依存しないロジック」＝ ViewModel / Binder /
 * Service / Store / Router のみ。JSX は L5（`apps/desktop/src/renderer/screens`）が本バレルの型・クラスを使って組む
 * （ui.rule.md の「画面コンポーネントは packages/core/src/ui」に対する運用判断は 00_reference.md §9.25 に記録）。
 *
 * `TAG-001`／`SONG-001`／`SONG-002` は `errors/index.ts` がコア 8 コードを共有レジストリへ登録するのと同じ方式で、
 * 本バレル読み込み時に副作用登録する（screens-navigation.md §3.5）。
 */

import { errorCodeRegistry } from '../errors';

import { registerUiErrorCodes } from './uiErrorCodes';

export type {
  AppPreferences,
  SongListLayout,
  MetronomePresetId,
  MenuItemDescriptor,
  ToolbarState,
  StatusBarState,
  ToolbarPanelName,
  UiNotificationReporter,
} from './types';
export {
  DEFAULT_APP_PREFERENCES,
  MIN_ZOOM_SCALE_PERCENT,
  MAX_ZOOM_SCALE_PERCENT,
  MIN_TAP_TEMPO_SAMPLE_SIZE,
  MAX_TAP_TEMPO_SAMPLE_SIZE,
  MIN_VOLUME,
  MAX_VOLUME,
} from './types';

export { UI_ERROR_CODES, registerUiErrorCodes } from './uiErrorCodes';
export { AppPreferencesService } from './AppPreferencesService';
export { TagStore, MAX_TAG_COUNT } from './TagStore';
export {
  ThumbnailGenerator,
  defaultRasterizer,
  rasterizeEnv,
  svgToDataUrl,
  stripDataUrlPrefix,
  THUMBNAIL_MAX_WIDTH,
  THUMBNAIL_MAX_HEIGHT,
  type Thumbnail,
  type ThumbnailSource,
  type SvgRasterizer,
} from './ThumbnailGenerator';
export { NotificationUIBinder, type NotificationSource, type NotificationChannelSinks } from './NotificationUIBinder';
export { ScoreHighlightBinder, type ScoreHighlightHost } from './ScoreHighlightBinder';
export { ToolbarViewModel, type HistoryStateSource, type PlaybackStateSource } from './ToolbarViewModel';
export {
  StatusBarViewModel,
  type StatusBarContext,
  type StatusBarContextProvider,
  type ZoomPercentSource,
} from './StatusBarViewModel';
export { MenuBarController, type MenuActionMap, type MenuItemId, type MenuBarOptions } from './MenuBarController';
export {
  KeyboardShortcutRouter,
  normalizeCombo,
  type KeyEventLike,
  type ShortcutBinding,
  type ShortcutContext,
} from './KeyboardShortcutRouter';
export { PartColorOverlay, PART_COLOR_OVERLAY_CLASS } from './PartColorOverlay';
export { PlaybackPreferencesAdapter } from './PlaybackPreferencesAdapter';

// 副作用：画面群パッケージのエラーコードを共有レジストリへ登録する。
registerUiErrorCodes(errorCodeRegistry);
