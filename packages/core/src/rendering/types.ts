/**
 * ScoreRenderHost の型（web-core-foundation.md §3.1）。
 */

/**
 * ScoreRenderHost.initialize() のオプション。
 * 値はコード上の定数ではなく引数として渡す（環境差異〈dev の Vite サーバー / packaged の file://〉を吸収するため）。
 */
export interface RenderHostOptions {
  /** レンダリングエンジン。SVG 固定（13_design_decision_points.md A2 で確定）。 */
  engine: 'svg';
  /** alphaTab が要求する Bravura 等フォントアセットのベースパス。 */
  fontAssetsBasePath: string;
  /**
   * SoundFont アセットのベースパス。本パッケージでは未使用（再生は扱わない）。
   * 再生エンジン統合パッケージ向けに先行定義しているだけ。
   */
  soundFontAssetsBasePath: string;
}

/** ScoreRenderHost が発火するイベント名（web-core-foundation.md §3.1）。 */
export type RenderHostEvents = 'renderStarted' | 'renderFinished' | 'renderError';

// ===== 表示モード拡張（view-modes.md §4.3、パッケージ6の非破壊拡張、00_reference.md §4） =====

/**
 * 表示モード（view-modes.md §1）。`domain` の `ViewMode`（02_data_model.md SONG_SETTINGS）と
 * 構造的に同一だが、レイヤー依存方向（rendering → domain を作らない）を保つためここで独自に持つ。
 */
export type RenderViewMode = 'focus' | 'scroll' | 'score';

/** フォーカスビューの表示範囲（対象小節レンジ）。`startBarIndex` は 0 始まり。 */
export interface FocusRange {
  /** レンジ先頭の小節インデックス（0 始まり）。 */
  startBarIndex: number;
  /** レンジに含める小節数（1 以上）。 */
  barCount: number;
}

/**
 * `ScoreRenderHost.applyViewMode` へ渡す描画構成（view-modes.md §4.3）。
 * - focus  … `focusTrackIndex` の 1 パートを `focusRange` の小節レンジで描画
 * - scroll … `focusTrackIndex` の 1 パートを曲全体スクロール可能に描画
 * - score  … 全パートを縦並びで描画（パート識別色オーバーレイはパッケージ8、B34）
 */
export interface ViewModeRenderRequest {
  mode: RenderViewMode;
  /** focus / scroll モードで描画する単一パート。score モードでは無視される。 */
  focusTrackIndex: number;
  /** focus モードのみ有効。表示する小節レンジ。省略時は全小節。 */
  focusRange?: FocusRange;
}

// ===== ハイライト表示 / パート識別色オーバーレイ拡張（screens-navigation.md §4.5.1・G24、パッケージ8の非破壊拡張、00_reference.md §4） =====

/**
 * `ScoreRenderHost.showErrorHighlight` へ渡す赤枠ハイライト要求（screens-navigation.md §4.5.1）。
 * Error レベル通知（`EDIT-001` 等）の `context` から `ScoreHighlightBinder` が組み立てる。
 */
export interface ScoreHighlightRequest {
  /** ハイライト対象トラック（0 始まり）。 */
  trackIndex: number;
  /** ハイライト先頭小節（0 始まり）。 */
  startBarIndex: number;
  /** ハイライトに含める小節数（1 以上）。 */
  barCount: number;
  /** 発生元エラーコード（オーバーレイの `data-*` 属性・デバッグ用）。 */
  code?: string;
  /** 自動解除までのミリ秒。省略時はホスト既定（`DEFAULT_HIGHLIGHT_DURATION_MS`）。 */
  durationMs?: number;
}

/**
 * `ScoreRenderHost.getPartRegions()` が返すパート別描画領域（G24、view-modes.md §4.3・§9）。
 * alphaTab `boundsLookup`（`staffSystems` の矩形）から算出した、コンテナ左上を原点とする CSS ピクセル座標。
 * スコア表示（全パート縦並び）でのパート識別色オーバーレイの土台に使う。
 */
export interface PartRegion {
  /** 対象トラック（0 始まり）。 */
  trackIndex: number;
  /** コンテナ相対 X（px）。 */
  x: number;
  /** コンテナ相対 Y（px）。 */
  y: number;
  /** 幅（px）。 */
  width: number;
  /** 高さ（px）。 */
  height: number;
}

/** ハイライトの既定自動解除時間（ms）。 */
export const DEFAULT_HIGHLIGHT_DURATION_MS = 4000;

/** 各イベントのペイロード。 */
export interface RenderHostEventMap {
  renderStarted: void;
  renderFinished: void;
  /** 不正な Score や alphaTab の内部エラーを通知する。外部に例外は投げない。 */
  renderError: { error: unknown };
}

export type RenderHostEventListener<E extends RenderHostEvents> = (payload: RenderHostEventMap[E]) => void;
