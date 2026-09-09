/**
 * ステータスバーの数値表示状態（編集ウィンドウごと、screens-navigation.md §4.4、14_visual_design_system.md §4）。
 *
 * 小節位置 / 拍子 / テンポ / カポ（`CursorController` と当該パートの `Part` 情報から取得）、ズーム％（`ZoomController`）を
 * 等幅フォント表示するための派生状態を保持する。ドメイン計算自体は行わず、注入された provider から読むだけ（AD-2）。
 */

import type { CursorLike } from '../viewmodes/types';

import type { StatusBarState } from './types';

/** ステータスバーに出す小節コンテキスト（`CursorController` の現在位置＋当該 Bar/Part から算出した結果）。 */
export interface StatusBarContext {
  /** 1 始まりの小節番号。 */
  barNumber: number;
  /** 拍子（例 `'4/4'`）。 */
  timeSignature: string;
  /** テンポ（BPM）。 */
  tempoBpm: number;
  /** カポ位置（フレット）。0 はカポなし。 */
  capoFret: number;
}

/** 現在のカーソル位置に対応する小節コンテキストを返す provider（bootstrap が Score/Part 参照を閉じ込める）。 */
export interface StatusBarContextProvider {
  read(): StatusBarContext;
}

/** `ZoomController` のズーム％参照部分だけの最小契約（view-modes.md §4.2）。 */
export interface ZoomPercentSource {
  readonly zoomPercent: number;
}

export class StatusBarViewModel {
  private readonly cursor: CursorLike;
  private readonly zoom: ZoomPercentSource;
  private readonly context: StatusBarContextProvider;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribes: Array<() => void> = [];
  private state: StatusBarState;

  constructor(cursor: CursorLike, zoom: ZoomPercentSource, context: StatusBarContextProvider) {
    this.cursor = cursor;
    this.zoom = zoom;
    this.context = context;
    this.state = this.compute();
    // カーソル移動のたびに小節位置等を再計算する。ズーム変化は bootstrap が refresh() を呼ぶ（ZoomController に購読 API が無いため）。
    this.unsubscribes.push(this.cursor.onChange(() => this.refresh()));
  }

  /** 現在のステータスバー表示状態を返す。 */
  getState(): StatusBarState {
    return { ...this.state };
  }

  /** 状態変化を購読する。戻り値で解除。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** provider / ズームから再計算し、変化があれば通知する（カーソル移動・ズーム変更・拍子変更時に呼ぶ）。 */
  refresh(): void {
    const next = this.compute();
    if (this.equals(this.state, next)) return;
    this.state = next;
    this.emit();
  }

  /** 購読を全解除する（ウィンドウクローズ時）。 */
  dispose(): void {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.listeners.clear();
  }

  /** provider ＋ ズーム％から `StatusBarState` を組み立てる。 */
  private compute(): StatusBarState {
    const ctx = this.context.read();
    return {
      barNumber: ctx.barNumber,
      timeSignature: ctx.timeSignature,
      tempoBpm: ctx.tempoBpm,
      capoFret: ctx.capoFret,
      zoomPercent: this.zoom.zoomPercent,
    };
  }

  /** 全フィールド一致なら true（不要な onChange を抑止）。 */
  private equals(a: StatusBarState, b: StatusBarState): boolean {
    return (
      a.barNumber === b.barNumber &&
      a.timeSignature === b.timeSignature &&
      a.tempoBpm === b.tempoBpm &&
      a.capoFret === b.capoFret &&
      a.zoomPercent === b.zoomPercent
    );
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[StatusBarViewModel] listener threw:', error);
      }
    }
  }
}
