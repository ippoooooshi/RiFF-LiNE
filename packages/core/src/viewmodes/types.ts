/**
 * 表示モード管理（L2）の共通型（view-modes.md §4）。
 *
 * `ViewModeController` / `ZoomController` は `ScoreRenderHost` の生 API に直接結合せず、
 * ここで定義する最小契約 `ViewModeRenderHost` にのみ依存する（editing の `RenderRequester` と同じ縫い目）。
 */

import type { FocusRange, RenderViewMode, ViewModeRenderRequest } from '../rendering';

export type { FocusRange, RenderViewMode, ViewModeRenderRequest };

/**
 * `ViewModeController` / `ZoomController` が要求する `ScoreRenderHost` の最小契約（view-modes.md §4.3）。
 * `ScoreRenderHost` はこの構造を満たす（`applyViewMode` / `applyZoom` を非破壊拡張済み）。
 */
export interface ViewModeRenderHost {
  applyViewMode(request: ViewModeRenderRequest): void;
  /** @param scale 1 = 100%。 */
  applyZoom(scale: number): void;
}

/** `ViewModeController` がカーソル追従に必要とする `CursorController` の部分契約。 */
export interface CursorLike {
  readonly position: { readonly trackIndex: number; readonly barIndex: number; readonly beatIndex: number };
  /** カーソル状態変化の購読。戻り値で解除。 */
  onChange(listener: () => void): () => void;
}
