/**
 * カーソル（editing-core.md 4.1 節・4.7 節）。位置・選んでいる弦・今の入力音価・「和音」ボタンの入切・範囲選択を持つ。
 *
 * 編集ウィンドウごとに 1 つ持つ画面の状態で、カーソルを動かすことはコマンドにせず、取り消しの対象にしない（editing-core.md 4.1 節）。
 * コマンドの `execute`・`undo` が返す `CommandOutcome` を、`EditingService` が `applyOutcome` でここへ渡す。
 * 次の位置（小節が埋まったか・前の小節の最後の拍）は、渡された `EditTarget` の Score から読む。
 *
 * ボイスの切り替え（editing-core.md 3.1 節）は宣言に口が無いので、呼ぶ側が `scoreModel.beatIndexForVoiceSwitch` で
 * 切り替えた先の拍を求め、`setPosition` に voiceIndex を変えた位置を渡す。
 */

import { barCount, isBarFilled, voiceBeats } from './scoreModel';
import {
  DEFAULT_DURATION_SPEC,
  type BeatDurationSpec,
  type CommandOutcome,
  type CursorPosition,
  type EditTarget,
  type SelectionRange,
} from './types';

type ChangeListener = () => void;

/** 選んでいる弦の既定（1 が最も低い弦、editing-core.md 4.1 節）。 */
const DEFAULT_STRING = 1;

export class CursorController {
  private current: CursorPosition = { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
  private stringNumber = DEFAULT_STRING;
  private duration: BeatDurationSpec = DEFAULT_DURATION_SPEC;
  private chordInput = false;
  /** 和音の入力の途中の印（editing-core.md 4.7 節）。ボタンが入っている間に音を置いた拍の位置。 */
  private chordPending: CursorPosition | null = null;
  private selectionRange: SelectionRange | null = null;
  private readonly listeners = new Set<ChangeListener>();

  // ===== 位置 =====

  get position(): CursorPosition {
    return { ...this.current };
  }

  /**
   * 手で動かす（クリック・ボイスの切り替え）。和音の入力の途中の印を捨てる。「和音」ボタンの入切は変えない（editing-core.md 4.7 節）。
   * 負の値は 0 に丸める。
   */
  setPosition(position: CursorPosition): void {
    this.chordPending = null;
    this.moveTo({
      trackIndex: Math.max(0, position.trackIndex),
      barIndex: Math.max(0, position.barIndex),
      voiceIndex: position.voiceIndex,
      beatIndex: Math.max(0, position.beatIndex),
    });
  }

  /**
   * 拍の単位で動くだけで、コマンドは出さない（editing-core.md 4.1 節の ← の箇条と、→ の (b) の箇条）。拍の並びは target の Score から読む。
   * ← は選んでいるボイスの拍を 1 つ前へ。小節の最初の拍なら前の小節の最後の拍へ、曲の最初の拍では動かない。
   * → は小節の最後の拍で、空きがあれば最後の拍の後ろ（beats.length）へ、埋まっていれば次の小節の頭へ。それより前の拍では次の拍へ。
   * 和音の入力の途中の印は捨てる（← は 4.7 節の手で動かしたとき。→ は EditingService.stepRight の確定がこの動きになる）。
   */
  moveByBeat(target: EditTarget, direction: -1 | 1): void {
    this.chordPending = null;
    const next = direction === -1 ? this.previousBeat(target) : this.nextBeat(target);
    this.moveTo(next);
  }

  // ===== 選んでいる弦（CursorPosition に入れず別に持つ、editing-core.md 4.1 節） =====

  /** 選んでいる弦（1 が最も低い弦。alphaTab の Note.string と同じ数え方）。 */
  get currentString(): number {
    return this.stringNumber;
  }

  /**
   * 選んでいる弦を変える。1 より小さい値は 1（一番低い弦）で止める。一番高い弦はパートの弦の本数で決まるので、
   * ↑ の呼ぶ側が `scoreModel.clampStringNumber` で収めた値を渡す（editing-core.md 4.1 節）。
   */
  setString(stringNumber: number): void {
    this.stringNumber = Math.max(DEFAULT_STRING, stringNumber);
    this.emit();
  }

  // ===== 今の入力音価（画面の状態、コマンドにしない、editing-core.md 4.2 節・4.3 節） =====

  get currentDuration(): BeatDurationSpec {
    return this.duration;
  }

  /** 今の入力音価を変えるだけで、和音の確定も進めもしない（editing-core.md 4.7 節）。 */
  setDuration(spec: BeatDurationSpec): void {
    this.duration = spec;
    this.emit();
  }

  // ===== 「和音」ボタン（editing-core.md 4.7 節） =====

  get chordInputMode(): boolean {
    return this.chordInput;
  }

  enterChordInput(): void {
    this.chordInput = true;
    this.emit();
  }

  /** ボタンを切る。和音の入力の途中なら確定し、置いた拍から、音を置いたときと同じ進め方で 1 つ進める（editing-core.md 4.7 節）。 */
  exitChordInput(target: EditTarget): void {
    this.chordInput = false;
    const pending = this.chordPending;
    this.chordPending = null;
    if (pending !== null) {
      this.moveTo(this.afterPlaced(target, pending));
    } else {
      this.emit();
    }
  }

  // ===== コマンドの戻り値 =====

  /**
   * コマンドの戻り値でカーソルを動かす（editing-core.md 4.1 節・4.2 節・4.7 節）。`'beat'` のときだけ動き、
   * 「和音」ボタンが入っている間は進めずに置いた拍を和音の入力の途中として覚える。切れている間は、小節が埋まれば次の小節の頭へ、
   * 埋まっていなければ同じ小節の次の拍（beatIndex + 1）へ進める。次の位置は target の Score から読む。
   */
  applyOutcome(outcome: CommandOutcome, target: EditTarget): void {
    if (outcome.cursorAdvance !== 'beat') return;
    if (this.chordInput) {
      this.chordPending = this.position;
      return;
    }
    this.moveTo(this.afterPlaced(target, this.current));
  }

  // ===== 範囲選択 =====

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

  // ===== 変更の知らせ =====

  /** カーソルの状態が変わったら呼ばれる購読を登録する。戻り値で解除する。 */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ===== 内部 =====

  /**
   * 音か休符を置いた拍 placed の次の位置（editing-core.md 4.1 節）。小節が埋まり次の小節があればその頭（拍 0）、
   * それ以外は同じ小節の次の拍。最後の小節が埋まったときに小節を足すのは EditingService（4.1 節）で、足した後ならその頭になる。
   */
  private afterPlaced(target: EditTarget, placed: CursorPosition): CursorPosition {
    const { score } = target;
    if (
      isBarFilled(score, placed.trackIndex, placed.barIndex, placed.voiceIndex) &&
      placed.barIndex + 1 < barCount(score)
    ) {
      return { ...placed, barIndex: placed.barIndex + 1, beatIndex: 0 };
    }
    return { ...placed, beatIndex: placed.beatIndex + 1 };
  }

  /** ← の行き先。 */
  private previousBeat(target: EditTarget): CursorPosition {
    const at = this.current;
    if (at.beatIndex > 0) return { ...at, beatIndex: at.beatIndex - 1 };
    if (at.barIndex === 0) return at;
    const previousBar = at.barIndex - 1;
    const count = voiceBeats(target.score, at.trackIndex, previousBar, at.voiceIndex).length;
    return { ...at, barIndex: previousBar, beatIndex: Math.max(0, count - 1) };
  }

  /** → の行き先（editing-core.md 4.1 節の (b) の箇条）。 */
  private nextBeat(target: EditTarget): CursorPosition {
    const at = this.current;
    const { score } = target;
    const count = voiceBeats(score, at.trackIndex, at.barIndex, at.voiceIndex).length;
    if (at.beatIndex < count - 1) return { ...at, beatIndex: at.beatIndex + 1 };
    const filled = isBarFilled(score, at.trackIndex, at.barIndex, at.voiceIndex);
    if (at.beatIndex === count - 1 && !filled) return { ...at, beatIndex: count };
    if (filled && at.barIndex + 1 < barCount(score)) return { ...at, barIndex: at.barIndex + 1, beatIndex: 0 };
    return at;
  }

  private moveTo(position: CursorPosition): void {
    this.current = { ...position };
    this.emit();
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
