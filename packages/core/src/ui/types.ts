/**
 * 画面群・ナビゲーション（L1、web-core-foundation.md 2.1 節）の共通型（screens-navigation.md §3・§4）。
 *
 * ここに置くのはフレームワーク非依存のデータ形だけ。React コンポーネント（JSX）は
 * L5（`apps/desktop/src/renderer/screens`）が担い、本ディレクトリは ViewModel・Binder・Service
 * などの「見た目に依存しないロジック」を提供する（ui.rule.md、レイヤー依存規則）。
 */

import { DEFAULT_TRASH_RETENTION_DAYS } from '../persistence/constants';
import type { RenderViewMode } from '../rendering';

/** 曲一覧の表示方式（screens-navigation.md §4.8 #1、03_screens_ui_pc.md §10 項目「曲一覧表示方式既定値」）。 */
export type SongListLayout = 'grid' | 'list';

/** メトロノーム音色プリセット（03_screens_ui_pc.md §10 項目④）。playback の `metronomePresetId` へ渡る文字列。 */
export type MetronomePresetId = 'acoustic' | 'click' | 'wood' | 'beep';

/**
 * 曲一覧の並べ替えのキー（screens-navigation.md 6.2 節の 6 つ：曲名・アーティスト名・更新日時・作成日時・パート種別・チューニング名）。
 */
// data-model-persistence.md 13.3 節：SongListSortKey は screens-navigation.md 6.2 節の 6 つのキー <!-- req datamodelpersistence:4786e528.21d5 -->
export const SONG_LIST_SORT_KEYS = [
  'title',
  'artist',
  'updatedAt',
  'createdAt',
  'instrumentType',
  'tuningName',
] as const;
/** 曲一覧の並べ替えのキー（data-model-persistence.md 13.3 節の `SongListSortKey`）。 */
export type SongListSortKey = (typeof SONG_LIST_SORT_KEYS)[number];
/** 曲一覧の並べ方。キーと向きは 2 つそろって 1 つの並べ方を決める（data-model-persistence.md 13.3 節の (b)）。 */
// data-model-persistence.md 13.3 節：並べ替えは key（SongListSortKey）と direction（asc か desc）を 1 つの項目で持つ <!-- req datamodelpersistence:4786e528.3a0d --> <!-- req datamodelpersistence:4786e528.f0d4 --> <!-- req datamodelpersistence:4786e528.c41f -->
export interface SongListSort {
  key: SongListSortKey;
  direction: 'asc' | 'desc';
}

/** ゴミ箱の保持期間に選べる日の数（data-model-persistence.md 13.3 節。既定は 30）。 */
// data-model-persistence.md 13.3 節：trashRetentionDays が取れる値は 7・14・30・60・90 の 5 つ <!-- req datamodelpersistence:51e9b06f.2405 --> <!-- req datamodelpersistence:51e9b06f.9022 --> <!-- req datamodelpersistence:51e9b06f.4333 --> <!-- req datamodelpersistence:51e9b06f.5585 --> <!-- req datamodelpersistence:51e9b06f.51fe -->
export const TRASH_RETENTION_DAY_OPTIONS = [7, 14, 30, 60, 90] as const;
/** ゴミ箱の保持期間（日の数、data-model-persistence.md 13.3 節の `7 | 14 | 30 | 60 | 90`）。 */
export type TrashRetentionDays = (typeof TRASH_RETENTION_DAY_OPTIONS)[number];

/**
 * 設定ダイアログ項目 1〜6・8・11・12 ＋ オンボーディング表示済みフラグの格納形（screens-navigation.md §3.1）。
 *
 * 保存先/ミラー先（項目 9・10）は `StorageConfigService`（`settings.json`）管轄でここには含まない。
 * ゴミ箱の保持期間（項目 12）は `preferences.json` に置く（data-model-persistence.md 13.3 節）。
 * 項目 7（タグ管理）は永続値を持たない導線のため対象外（§3.1・00_reference.md §3.8）。
 */
// data-model-persistence.md 13.3 節：preferences.json は 4 つのまとまり（設定ダイアログの 1 から 6・11・12 項目目の値、曲一覧の表示方式、並べ替え、onboardingSeen）を持ち、8 項目目・タグ・保存先・ミラー先・チューニングプリセット・窓の位置と大きさは入れない <!-- req datamodelpersistence:3d9dd43e.31ce --> <!-- req datamodelpersistence:1653b377.cc58 --> <!-- req datamodelpersistence:1653b377.d69c --> <!-- req datamodelpersistence:1653b377.0faf --> <!-- req datamodelpersistence:6394dbd7.baed --> <!-- req datamodelpersistence:e0dd6d5d.6752 -->
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
  // data-model-persistence.md 13.3 節：preferences.json に曲一覧の表示方式を入れる <!-- req datamodelpersistence:ead32116.68d9 -->
  songListLayout: SongListLayout;
  /** 曲一覧の並べ替えのキーと向き（data-model-persistence.md 13.3 節、screens-navigation.md 6.2 節）。 */
  // data-model-persistence.md 13.3 節：曲一覧の並べ替えのキーと向きを 1 つの項目 songListSort で preferences.json に入れる <!-- req datamodelpersistence:9ed97437.8846 --> <!-- req datamodelpersistence:9ed97437.eb61 --> <!-- req datamodelpersistence:4786e528.21cf --> <!-- req datamodelpersistence:af935b21.8673 -->
  // <!-- req screensnavigation:4d18e79e.921b --> <!-- req screensnavigation:4d18e79e.b69a --> <!-- req screensnavigation:4d18e79e.63c6 --> <!-- req screensnavigation:4d18e79e.4962 -->
  songListSort: SongListSort;
  /** 初回オンボーディングオーバーレイを表示済みか（screens-navigation.md §4.8 #13、§5.5）。 */
  // data-model-persistence.md 13.3 節：preferences.json にオンボーディングを見た印 onboardingSeen を入れる <!-- req datamodelpersistence:6c7e5ea3.717d -->
  onboardingSeen: boolean;
  // data-model-persistence.md 13.3 節：ゴミ箱の保持期間は preferences.json の trashRetentionDays に、7・14・30・60・90 のどれかで持つ
  /** 項目⑫ ゴミ箱の保持期間（日の数）。 */
  // data-model-persistence.md 13.3 節：12 項目目のゴミ箱の保持期間は trashRetentionDays（7・14・30・60・90 の日の数）で preferences.json に持つ <!-- req datamodelpersistence:dc40f86a.eb6e --> <!-- req datamodelpersistence:1653b377.c4ed --> <!-- req datamodelpersistence:51e9b06f.d38f --> <!-- req datamodelpersistence:4786e528.312b --> <!-- req datamodelpersistence:af935b21.cd7a -->
  trashRetentionDays: TrashRetentionDays;
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
  // 並べ替えの既定は更新日時の新しい順（screens-navigation.md 6.2 節、2026-10-27 本人決定）。
  // <!-- req screensnavigation:4d18e79e.ec8c --> <!-- req screensnavigation:4d18e79e.1894 -->
  songListSort: { key: 'updatedAt', direction: 'desc' },
  onboardingSeen: false,
  trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
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
