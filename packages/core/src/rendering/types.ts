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

/** 各イベントのペイロード。 */
export interface RenderHostEventMap {
  renderStarted: void;
  renderFinished: void;
  /** 不正な Score や alphaTab の内部エラーを通知する。外部に例外は投げない。 */
  renderError: { error: unknown };
}

export type RenderHostEventListener<E extends RenderHostEvents> = (payload: RenderHostEventMap[E]) => void;
