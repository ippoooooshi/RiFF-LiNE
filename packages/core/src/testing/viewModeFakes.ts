/**
 * 表示モードパッケージのテスト用フェイク（tests.rule.md「I/O・外部ライブラリは fake で差し替え」）。
 * 本番コードからは import しない（`src/index.ts` のバレルにも含めない）。
 */

import type { ViewModeRenderRequest } from '../rendering';
import type { CursorLike, ViewModeRenderHost } from '../viewmodes';

/** `ViewModeRenderHost` の呼び出しを記録する fake（`ScoreRenderHost` の代役）。 */
export class RecordingViewModeRenderHost implements ViewModeRenderHost {
  readonly viewModeCalls: ViewModeRenderRequest[] = [];
  readonly zoomCalls: number[] = [];

  applyViewMode(request: ViewModeRenderRequest): void {
    // 参照ではなく値をコピーして保存する（呼び出し側が後で変更しても記録がぶれないように）。
    this.viewModeCalls.push({
      mode: request.mode,
      focusTrackIndex: request.focusTrackIndex,
      focusRange: request.focusRange ? { ...request.focusRange } : undefined,
    });
  }

  applyZoom(scale: number): void {
    this.zoomCalls.push(scale);
  }

  get lastViewMode(): ViewModeRenderRequest | undefined {
    return this.viewModeCalls.at(-1);
  }

  get lastZoom(): number | undefined {
    return this.zoomCalls.at(-1);
  }
}

/** `CursorController` の最小代役。位置を差し替えて `onChange` 購読者へ通知できる。 */
export class FakeCursor implements CursorLike {
  private trackIndex: number;
  private barIndex: number;
  private beatIndex: number;
  private readonly listeners = new Set<() => void>();

  constructor(init: { trackIndex?: number; barIndex?: number; beatIndex?: number } = {}) {
    this.trackIndex = init.trackIndex ?? 0;
    this.barIndex = init.barIndex ?? 0;
    this.beatIndex = init.beatIndex ?? 0;
  }

  get position(): { trackIndex: number; barIndex: number; beatIndex: number } {
    return { trackIndex: this.trackIndex, barIndex: this.barIndex, beatIndex: this.beatIndex };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 位置を更新して購読者へ通知する（テストからカーソル移動を模す）。 */
  moveTo(pos: { trackIndex?: number; barIndex?: number; beatIndex?: number }): void {
    this.trackIndex = pos.trackIndex ?? this.trackIndex;
    this.barIndex = pos.barIndex ?? this.barIndex;
    this.beatIndex = pos.beatIndex ?? this.beatIndex;
    for (const listener of this.listeners) listener();
  }
}
