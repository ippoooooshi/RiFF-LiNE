/**
 * 画面群・ナビゲーション（L1〜L2）の共通型（screens-navigation.md §3・§4）。
 *
 * ここに置くのはフレームワーク非依存のデータ形だけ。React コンポーネント（JSX）は
 * L5（`apps/desktop/src/renderer/screens`）が担い、本ディレクトリは ViewModel・Binder・Service
 * などの「見た目に依存しないロジック」を提供する（ui.rule.md、レイヤー依存規則）。
 */

import type { RenderViewMode } from '../rendering';

/** 曲一覧の表示方式（screens-navigation.md §4.8 #1、03_screens_ui_pc.md §10 項目「曲一覧表示方式既定値」）。 */
export type SongListLayout = 'grid' | 'list';

/** メトロノーム音色プリセット（03_screens_ui_pc.md §10 項目④）。playback の `metronomePresetId` へ渡る文字列。 */
export type MetronomePresetId = 'acoustic' | 'click' | 'wood' | 'beep';

/**
 * 設定ダイアログ項目 1〜6・8・11 ＋ オンボーディング表示済みフラグの格納形（screens-navigation.md §3.1）。
 *
 * 保存先/ミラー先/ゴミ箱保持日数（項目 9・10・12）は `StorageConfigService`（`settings.json`）管轄で
 * ここには含まない。項目 7（タグ管理）は永続値を持たない導線のため対象外（§3.1・00_reference.md §3.8）。
 */
export interface AppPreferences {
  /** 項目① 新規パートの初期チューニングプリセット ID。未設定は組み込み標準。 */
  defaultTuningPresetId: string | null;
  /** 項目② 新規パートの初期音色（音源）ID。未設定はエンジン既定。 */
  defaultInstrumentSoundId: string | null;
  /** 項目③ 各表示モードの目安初期ズームに対する倍率（%）。100 = 目安どおり（view-modes.md §3.2、§3.4）。 */
  zoomScaleByMode: Record<RenderViewMode, number>;
  /** 項目④ メトロノーム音量（0.0〜1.0）。 */
  metronomeVolume: number;
  /** 項目④ メトロノーム音色プリセット。 */
  metronomePresetId: MetronomePresetId;
  /** 項目⑤ カウントインの小節数倍率（1 または 2、playback の `countInMeasureMultiplier`）。 */
  countInMeasureMultiplier: 1 | 2;
  /** 項目⑥ タップテンポ感度＝平均に使う直近タップ数（playback の `tapTempoSampleSize`）。 */
  tapTempoSampleSize: number;
  /** 項目⑧ パート追加時のデフォルト音量（0.0〜1.0）。 */
  partDefaultVolume: number;
  /** 項目⑪ 起動時にアプリ情報（オンボーディング等）を表示するか。 */
  showAppInfoOnStartup: boolean;
  /** 曲一覧の既定表示方式。 */
  songListLayout: SongListLayout;
  /** 初回オンボーディングオーバーレイを表示済みか（screens-navigation.md §4.8 #13、§5.5）。 */
  onboardingSeen: boolean;
}

/** ズーム倍率（%）の下限・上限。極端値による描画破綻を防ぐ（screens-navigation.md §3.4）。 */
export const MIN_ZOOM_SCALE_PERCENT = 25;
export const MAX_ZOOM_SCALE_PERCENT = 400;

/** タップテンポ感度の下限・上限（playback の `MIN/MAX_TAP_SAMPLE_SIZE` と一致させる）。 */
export const MIN_TAP_TEMPO_SAMPLE_SIZE = 2;
export const MAX_TAP_TEMPO_SAMPLE_SIZE = 8;

/** 音量の下限・上限。 */
export const MIN_VOLUME = 0;
export const MAX_VOLUME = 1;

/**
 * 未保存時に返す組み込み既定値（screens-navigation.md §3.1「既定値」行）。
 * メトロノーム音色＝アコースティック系、曲一覧＝グリッド、ズーム倍率＝各モード 100%（目安どおり）。
 */
export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultTuningPresetId: null,
  defaultInstrumentSoundId: null,
  zoomScaleByMode: { focus: 100, scroll: 100, score: 100 },
  metronomeVolume: 0.8,
  metronomePresetId: 'acoustic',
  countInMeasureMultiplier: 1,
  tapTempoSampleSize: 4,
  partDefaultVolume: 0.8,
  showAppInfoOnStartup: true,
  songListLayout: 'grid',
  onboardingSeen: false,
};

/** `NotificationCenter.report` の最小要求（editing の `NotificationReporter` と同じ縫い目）。 */
export interface UiNotificationReporter {
  report(code: string, context?: Record<string, unknown>): void;
}

// ===== メニューバー（screens-navigation.md §4.2） =====

/** メニュー項目 1 件のフレームワーク非依存な記述。OS ネイティブメニュー構築は L5 が行う。 */
export interface MenuItemDescriptor {
  /** 一意な識別子（配線先の特定に使う）。区切り線のときは省略。 */
  id?: string;
  /** 表示ラベル。区切り線のときは省略。 */
  label?: string;
  /** 区切り線なら true。 */
  separator?: boolean;
  /** アクセラレータ表記（例 `'CmdOrCtrl+Z'`）。表示のみで、実処理は `KeyboardShortcutRouter` が担う。 */
  accelerator?: string;
  /** 選択時に実行するアクション。未配線なら無効表示にする。 */
  action?: () => void;
  /** 無効化状態（Phase 2 未実装のエクスポート実行等、B19）。 */
  enabled?: boolean;
  /** 子メニュー。 */
  submenu?: MenuItemDescriptor[];
}

// ===== ツールバー / ステータスバー（screens-navigation.md §4.4） =====

/** ツールバーの表示状態（編集ウィンドウごと）。 */
export interface ToolbarState {
  canUndo: boolean;
  canRedo: boolean;
  isPlaying: boolean;
  /** パネルの表示トグル状態（Undo/Redo 対象外）。 */
  panels: {
    mixer: boolean;
    partManagement: boolean;
    tuning: boolean;
    fretboard: boolean;
    memoList: boolean;
  };
}

/** ステータスバーに等幅表示する数値群（編集ウィンドウごと、14_visual_design_system.md §4）。 */
export interface StatusBarState {
  /** 1 始まりの小節番号。 */
  barNumber: number;
  /** 拍子（例 `'4/4'`）。 */
  timeSignature: string;
  /** テンポ（BPM）。 */
  tempoBpm: number;
  /** カポ位置（フレット）。0 はカポなし。 */
  capoFret: number;
  /** ズーム率（%）。 */
  zoomPercent: number;
}

/** トグル対象のパネル名。 */
export type ToolbarPanelName = keyof ToolbarState['panels'];
