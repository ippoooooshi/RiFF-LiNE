/**
 * カーソル位置・入力音価・範囲選択の保持（editing-core.md §4、04_editing_core.md §1〜§3）。
 *
 * UI 状態専用で Undo/Redo 対象外。編集ウィンドウ（＝開いている曲）ごとに 1 インスタンス。
 * コマンドの `execute`/`undo` は `CommandOutcome`（前進要否）を返し、`EditingService` が
 * `applyOutcome()` でここへ反映する。
 */

import { model } from '@coderline/alphatab';

import type { CommandOutcome, CursorPosition, SelectionRange } from './types';

/** 音価パレットの既定値（4分音符）。 */
const DEFAULT_DURATION: model.Duration = model.Duration.Quarter;

type ChangeListener = () => void;

export class CursorController {
  private trackIndex = 0;
  private barIndex = 0;
  private beatIndex = 0;
  private duration: model.Duration = DEFAULT_DURATION;
  private chordInput = false;
  private selectionRange: SelectionRange | null = null;
  private readonly listeners = new Set<ChangeListener>();

  // ===== 位置 =====

  /** 現在のカーソル位置。 */
  get position(): CursorPosition {
    return { trackIndex: this.trackIndex, barIndex: this.barIndex, beatIndex: this.beatIndex };
  }

  /**
   * 位置を直接設定する（矢印キー・クリック等の手動移動）。和音入力モードは解除される（§4）。
   * 負値は 0 に丸める。
   */
  setPosition(position: CursorPosition): void {
    this.trackIndex = Math.max(0, position.trackIndex);
    this.barIndex = Math.max(0, position.barIndex);
    this.beatIndex = Math.max(0, position.beatIndex);
    this.chordInput = false;
    this.emit();
  }

  /**
   * カーソルを次の Beat へ 1 つ進める（`PlaceNoteCommand`/`InsertRestCommand` 実行成功後）。
   * 和音入力モード中は進めない（§3「和音入力完了まで進めない」）。
   */
  advanceBeat(): void {
    if (this.chordInput) return;
    this.beatIndex += 1;
    this.emit();
  }

  /** コマンドの戻り値を反映する。`EditingService` が execute/undo の戻り値を渡す。 */
  applyOutcome(outcome: CommandOutcome): void {
    if (outcome.cursorAdvance === 'beat') this.advanceBeat();
  }

  // ===== 入力音価（UI 状態、コマンド化しない、§4） =====

  get currentDuration(): model.Duration {
    return this.duration;
  }

  setDuration(duration: model.Duration): void {
    this.duration = duration;
    this.emit();
  }

  // ===== 和音入力モード（§3） =====

  get chordInputMode(): boolean {
    return this.chordInput;
  }

  /** 同一 Beat への追加入力を続ける。以降 `advanceBeat()` は無効化される。 */
  enterChordInput(): void {
    this.chordInput = true;
    this.emit();
  }

  /** 和音入力を終了する（次の音価選択・明示確定・手動移動で解除）。 */
  exitChordInput(): void {
    this.chordInput = false;
    this.emit();
  }

  // ===== 範囲選択（同一パート内、§4・§9） =====

  get selection(): SelectionRange | null {
    return this.selectionRange;
  }

  setSelection(range: SelectionRange): void {
    this.selectionRange = range;
    this.emit();
  }

  clearSelection(): void {
    this.selectionRange = null;
    this.emit();
  }

  // ===== 変更通知（UI 用） =====

  /** カーソル状態が変わったら呼ばれる購読を登録する。戻り値で解除。 */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[CursorController] listener threw:', error);
      }
    }
  }
}
