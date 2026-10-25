/**
 * ScoreRenderHost の型（web-core-foundation.md 12.1 節）。
 */

/**
 * ScoreRenderHost.initialize() のオプション。
 * 値はコード上の定数ではなく引数として渡す（環境差異〈dev の Vite サーバー / packaged の file://〉を吸収するため）。
 */
// 12.1 節：RenderHostOptions（engine・fontAssetsBasePath・soundFontAssetsBasePath） <!-- req webcorefoundation:2044551c.d7e4 --> <!-- req webcorefoundation:26173c22.ea01 --> <!-- req webcorefoundation:971d1f89.2dc4 --> <!-- req webcorefoundation:48a98c91.e68e -->
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

/** ScoreRenderHost が発火するイベント名（web-core-foundation.md 12.1 節）。 */
export type RenderHostEvents = 'renderStarted' | 'renderFinished' | 'renderError';

/** 12.1 節のシグネチャの名前。前からの `RenderHostEvents` と同じ型（名前を足しただけで、前からの名前は変えない）。 */
// 12.1 節：RenderHostEvent は renderStarted・renderFinished・renderError <!-- req webcorefoundation:75211a46.f49a --> <!-- req webcorefoundation:75211a46.cb84 --> <!-- req webcorefoundation:75211a46.b314 -->
export type RenderHostEvent = RenderHostEvents;

// ===== 表示モード（view-modes.md 1.1 節。applyViewMode に渡す形は web-core-foundation.md 12.1 節） =====

/**
 * 表示モード（view-modes.md 1.1 節）。`domain` の `ViewMode`（02_data_model.md SONG_SETTINGS）と
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
 * `ScoreRenderHost.applyViewMode` へ渡す描画構成（web-core-foundation.md 12.1 節）。
 * - focus  … `focusTrackIndex` の 1 パートを `focusRange` の小節レンジで描画
 * - scroll … `focusTrackIndex` の 1 パートを曲全体スクロール可能に描画
 * - score  … 全パートを縦並びで描画（パート識別色オーバーレイはパッケージ8、B34）
 */
// 12.1 節：ViewModeRenderRequest（mode・focusTrackIndex・focusRange・activeVoiceIndex） <!-- req webcorefoundation:2c8ce2fa.1713 --> <!-- req webcorefoundation:8de8f556.ede3 --> <!-- req webcorefoundation:8de8f556.3f09 --> <!-- req webcorefoundation:8de8f556.7042 --> <!-- req webcorefoundation:3d2ed1c1.458e --> <!-- req webcorefoundation:b53305cc.8b9f --> <!-- req webcorefoundation:b53305cc.7a67 --> <!-- req webcorefoundation:b53305cc.417a --> <!-- req webcorefoundation:b53305cc.24e1 --> <!-- req webcorefoundation:f11b6ee2.d854 --> <!-- req webcorefoundation:f11b6ee2.d156 --> <!-- req webcorefoundation:f11b6ee2.1554 --> <!-- req webcorefoundation:f11b6ee2.b528 --> <!-- req webcorefoundation:f11b6ee2.29fb -->
export interface ViewModeRenderRequest {
  mode: RenderViewMode;
  /** focus / scroll モードで描画する単一パート。score モードでは無視される。 */
  focusTrackIndex: number;
  /** focus モードのみ有効。表示する小節レンジ。省略時は全小節。 */
  focusRange?: FocusRange;
  /** 編集で選んでいるボイス。もう一方を薄く出す（view-modes.md 1.5 節。薄く出す描き方は作業パッケージ 6）。'score' では見ない。 */
  activeVoiceIndex?: 0 | 1;
}

// ===== エラーのハイライトとパートの描画の領域（web-core-foundation.md 12.1 節） =====

/**
 * `ScoreRenderHost.showErrorHighlight` へ渡す赤枠ハイライト要求（web-core-foundation.md 12.1 節。組み立てるのは
 * screens-navigation.md 13.2 節の `ScoreHighlightBinder`）。
 * Error レベル通知（`EDIT-001` 等）の `context` から `ScoreHighlightBinder` が組み立てる。
 */
// 12.1 節：ScoreHighlightRequest（trackIndex・startBarIndex・barCount・code・durationMs） <!-- req webcorefoundation:5374d6b7.dc9c --> <!-- req webcorefoundation:0b43129b.647c --> <!-- req webcorefoundation:d67542ef.30a8 --> <!-- req webcorefoundation:c5aad108.72c8 --> <!-- req webcorefoundation:c5aad108.42b9 --> <!-- req webcorefoundation:e9fbbcd7.1bd7 --> <!-- req webcorefoundation:e9fbbcd7.195c --> <!-- req webcorefoundation:7783521f.665e --> <!-- req webcorefoundation:7783521f.4ebe -->
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
 * `ScoreRenderHost.getPartRegions()` が返すパート別描画領域（形は view-modes.md 1.2 節、組み立て方は web-core-foundation.md 12.1 節）。
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
// 12.1 節：DEFAULT_HIGHLIGHT_DURATION_MS は 4000 <!-- req webcorefoundation:85be3296.21dc -->
export const DEFAULT_HIGHLIGHT_DURATION_MS = 4000;

/**
 * イベントごとに listener が受け取るもの（web-core-foundation.md 12.1 節）。renderError のときだけ { error } を渡す。
 * 起動の配線が RENDER-001 の詳細（detail）を書くのに使うため。
 */
// 12.1 節：RenderHostEventMap（renderStarted・renderFinished は void で何も受け取らず、renderError だけ { error: unknown }） <!-- req webcorefoundation:3a584954.0f49 --> <!-- req webcorefoundation:3a584954.1046 --> <!-- req webcorefoundation:3a584954.4b0f --> <!-- req webcorefoundation:3a584954.54ae --> <!-- req webcorefoundation:bcf80f48.0623 --> <!-- req webcorefoundation:bcf80f48.7858 --> <!-- req webcorefoundation:bcf80f48.9e44 -->
export interface RenderHostEventMap {
  renderStarted: void;
  renderFinished: void;
  /** 不正な Score や alphaTab の内部エラーを通知する。外部に例外は投げない。 */
  renderError: { error: unknown };
}

// 12.1 節：RenderHostEventListener<E> は RenderHostEventMap[E] を payload として受け取る <!-- req webcorefoundation:6027e215.cc8c --> <!-- req webcorefoundation:6027e215.5a70 -->
export type RenderHostEventListener<E extends RenderHostEvent> = (payload: RenderHostEventMap[E]) => void;
