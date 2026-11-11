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

import { barCount, isBarFilled, isBarFilledAtLastBeat, voiceBeats } from './scoreModel';
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

/**
 * 同じパートの同じボイスの 2 つの拍を両端に含む範囲（editing-core.md 9 節）。小節と拍の順で前のほうを始まりにする。
 * パートとボイスは `anchor` のものを使う（呼ぶ側が同じであることを確かめる）。
 */
// <!-- req editingcore:92a14e82.8ca2 -->
function rangeBetween(anchor: CursorPosition, at: CursorPosition): SelectionRange {
  const atFirst = at.barIndex < anchor.barIndex || (at.barIndex === anchor.barIndex && at.beatIndex < anchor.beatIndex);
  const [start, end] = atFirst ? [at, anchor] : [anchor, at];
  return {
    trackIndex: anchor.trackIndex,
    voiceIndex: anchor.voiceIndex,
    startBarIndex: start.barIndex,
    startBeatIndex: start.beatIndex,
    endBarIndex: end.barIndex,
    endBeatIndex: end.beatIndex,
  };
}

// <!-- req editingcore:03197e3d.b811 --> <!-- req editingcore:24c63d8c.be93 --> <!-- req editingcore:24c63d8c.4d57 --> <!-- req editingcore:24c63d8c.8c22 --> <!-- req editingcore:e27a9687.7243 --> <!-- req editingcore:9fe8543b.249c --> <!-- req webcorefoundation:1fdb3647.bdda -->
export class CursorController {
  private current: CursorPosition = { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
  // <!-- req editingcore:3898189b.dc88 --> <!-- req editingcore:3898189b.1541 -->
  private stringNumber = DEFAULT_STRING;
  private duration: BeatDurationSpec = DEFAULT_DURATION_SPEC;
  // <!-- req editingcore:014cc199.6309 --> <!-- req editingcore:014cc199.ddf3 --> <!-- req editingcore:014cc199.31d3 -->
  private chordInput = false;
  /** 和音の入力の途中の印（editing-core.md 4.7 節）。ボタンが入っている間に音を置いた拍の位置。 */
  private chordPending: CursorPosition | null = null;
  private selectionRange: SelectionRange | null = null;
  /** 範囲の始まりに置いた拍（editing-core.md 9 節）。終わりを動かしても変わらない。 */
  private selectionAnchor: CursorPosition | null = null;
  private readonly listeners = new Set<ChangeListener>();

  // ===== 位置 =====

  // <!-- req editingcore:9fe8543b.fb9f -->
  get position(): CursorPosition {
    return { ...this.current };
  }

  /**
   * 手で動かす（クリック・ボイスの切り替え）。和音の入力の途中の印を捨てる。「和音」ボタンの入切は変えない（editing-core.md 4.7 節）。
   * 負の値は 0 に丸める。
   */
  // <!-- req editingcore:bada46b8.7aa4 -->
  // <!-- req editingcore:5e8df02f.7517 --> <!-- req editingcore:5e8df02f.f7b4 --> <!-- req editingcore:5e8df02f.8b65 --> <!-- req editingcore:5e8df02f.0ada --> <!-- req editingcore:5e8df02f.eaa7 --> <!-- req editingcore:5e8df02f.e9d3 -->
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
  // <!-- req editingcore:ff027f8f.3d3f --> <!-- req editingcore:8ee56da1.5e26 --> <!-- req editingcore:c21fa2a1.5f8a -->
  // <!-- req editingcore:5e8df02f.2724 -->
  moveByBeat(target: EditTarget, direction: -1 | 1): void {
    this.chordPending = null;
    const next = direction === -1 ? this.previousBeat(target) : this.nextBeat(target);
    this.moveTo(next);
  }

  // ===== 選んでいる弦（CursorPosition に入れず別に持つ、editing-core.md 4.1 節） =====

  /** 選んでいる弦（1 が最も低い弦。alphaTab の Note.string と同じ数え方）。 */
  // <!-- req editingcore:3898189b.4763 -->
  get currentString(): number {
    return this.stringNumber;
  }

  /**
   * 選んでいる弦を変える。1 より小さい値は 1（一番低い弦）で止める。一番高い弦はパートの弦の本数で決まるので、
   * ↑ の呼ぶ側が `scoreModel.clampStringNumber` で収めた値を渡す（editing-core.md 4.1 節）。
   */
  // <!-- req editingcore:3f915522.b592 -->
  setString(stringNumber: number): void {
    this.stringNumber = Math.max(DEFAULT_STRING, stringNumber);
    this.emit();
  }

  // ===== 今の入力音価（画面の状態、コマンドにしない、editing-core.md 4.2 節・4.3 節） =====
  // <!-- req editingcore:235d6526.3cae --> <!-- req editingcore:235d6526.7a9a -->

  /** 分数・付点・連符の 3 つの組（BeatDurationSpec）で決まる今の入力音価（editing-core.md 4.3 節）。 */
  // <!-- req editingcore:9be0ce75.9480 -->
  get currentDuration(): BeatDurationSpec {
    return this.duration;
  }

  /** 今の入力音価を変えるだけで、和音の確定も進めもしない（editing-core.md 4.7 節）。 */
  // <!-- req editingcore:67288335.3a9c --> <!-- req editingcore:60cb6efa.362a -->
  // <!-- req editingcore:a327195d.e61e --> <!-- req editingcore:a327195d.2874 --> <!-- req editingcore:a327195d.b21b -->
  setDuration(spec: BeatDurationSpec): void {
    // <!-- req editingcore:235d6526.432e -->
    this.duration = spec;
    this.emit();
  }

  // ===== 「和音」ボタン（editing-core.md 4.7 節） =====

  // <!-- req editingcore:ae3bb44d.85df -->
  get chordInputMode(): boolean {
    return this.chordInput;
  }

  // <!-- req editingcore:f9834fd4.4f2e -->
  // <!-- req editingcore:65ca282d.f9cc -->
  enterChordInput(): void {
    this.chordInput = true;
    this.emit();
  }

  /** ボタンを切る。和音の入力の途中なら確定し、置いた拍から、音を置いたときと同じ進め方で 1 つ進める（editing-core.md 4.7 節）。 */
  // <!-- req editingcore:2ad6b055.96d9 -->
  exitChordInput(target: EditTarget): void {
    this.chordInput = false;
    const pending = this.chordPending;
    this.chordPending = null;
    if (pending !== null) {
      // <!-- req editingcore:acdbe57b.2f39 -->
      this.moveTo(this.afterPlaced(target, pending));
    } else {
      this.emit();
    }
  }

  // ===== コマンドの戻り値 =====

  /**
   * コマンドの戻り値でカーソルを動かす（editing-core.md 4.1 節・4.2 節・4.7 節）。`'beat'` のときだけ動き、
   * 「和音」ボタンが入っている間は、音を置いた拍なら進めずに和音の入力の途中として覚える。休符の拍（音符を持たない拍）は音ではないので
   * 覚えずに進める（→ が置いた休符で止まらないため、4.1 節・4.7 節）。ボタンが切れている間と休符の拍は、小節が埋まれば次の小節の頭へ、
   * 埋まっていなければ同じ小節の次の拍（beatIndex + 1）へ進める。置いた拍と次の位置は target の Score から読む。
   */
  // <!-- req editingcore:e4a98aa0.8b9e -->
  applyOutcome(outcome: CommandOutcome, target: EditTarget): void {
    if (outcome.cursorAdvance !== 'beat') return;
    // <!-- req editingcore:ae3bb44d.d2da --> <!-- req editingcore:ae3bb44d.90b6 --> <!-- req editingcore:b05578b4.82d9 -->
    if (this.chordInput && this.placedBeatHasNotes(target)) {
      // <!-- req editingcore:ae3bb44d.e47f -->
      this.chordPending = this.position;
      return;
    }
    // <!-- req editingcore:fc44df70.988b --> <!-- req editingcore:fc44df70.08a3 --> <!-- req editingcore:fc44df70.633a -->
    // <!-- req editingcore:47f7fe30.a13d --> <!-- req editingcore:47f7fe30.f83b -->
    this.moveTo(this.afterPlaced(target, this.current));
  }

  // ===== 範囲選択 =====

  get selection(): SelectionRange | null {
    return this.selectionRange;
  }

  /**
   * 範囲を決める（editing-core.md 9 節。範囲は 1 つのパートの 1 つのボイスの中で、始まりと終わりの拍を両端に含む）。
   * 渡した範囲の始まりを、この後 `extendSelection` で終わりを動かすときの始まりにする。
   */
  // <!-- req editingcore:53838bc2.be8d --> <!-- req editingcore:21a29679.e80b -->
  setSelection(range: SelectionRange): void {
    this.selectionAnchor = {
      trackIndex: range.trackIndex,
      barIndex: range.startBarIndex,
      voiceIndex: range.voiceIndex,
      beatIndex: range.startBeatIndex,
    };
    this.selectionRange = range;
    this.emit();
  }

  /**
   * 範囲の始まりを置く（editing-core.md 9 節）。クリックした 1 拍だけの範囲（始まりと終わりが同じ拍）を作る。
   * 選択モードの間の始まりの位置のクリックと、ドラッグの始まり（画面の部品は作業パッケージ 8）が呼ぶ。
   */
  // <!-- req editingcore:20f640c0.da9d --> // <!-- req editingcore:53838bc2.d022 --> // <!-- req editingcore:53838bc2.4723 -->
  beginSelection(at: CursorPosition): void {
    this.selectionAnchor = { ...at };
    this.selectionRange = rangeBetween(at, at);
    this.emit();
  }

  /**
   * 範囲の終わりを動かす（editing-core.md 9 節）。始まりから `at` までの拍を両端に含む範囲にする（`at` が始まりより前なら、
   * `at` を範囲の始まりの拍にする）。選択モードの間の終わりの位置のクリック・Shift＋クリック・ドラッグの途中が、同じこの状態へ入れる。
   * 範囲は 1 つのパートの中だけなので、始まりが無いとき・始まりと別のパート（か別のボイス）を指したときは、`at` を新しい始まりにして、
   * `at` の 1 拍だけの範囲で作り直す（9 節の (b)、チャット側の決定 2026-11-10）。その後の呼び出しで終わりを動かす。
   */
  // <!-- req editingcore:20f640c0.2c58 --> // <!-- req editingcore:5131ed9d.b055 --> // <!-- req editingcore:5131ed9d.4aab --> // <!-- req editingcore:5131ed9d.f7ff --> // <!-- req editingcore:5131ed9d.4608 --> // <!-- req editingcore:5131ed9d.651f -->
  // <!-- req editingcore:92a14e82.e45f -->
  extendSelection(at: CursorPosition): void {
    const anchor = this.selectionAnchor;
    // <!-- req editingcore:13016752.8a81 --> // <!-- req editingcore:13016752.ce7d -->
    // <!-- req editingcore:13016752.754d -->
    if (anchor === null || anchor.trackIndex !== at.trackIndex || anchor.voiceIndex !== at.voiceIndex) {
      // <!-- req editingcore:13016752.3d16 -->
      // <!-- req editingcore:13016752.d2eb -->
      this.beginSelection(at);
      return;
    }
    this.selectionRange = rangeBetween(anchor, at);
    this.emit();
  }

  // <!-- req editingcore:5131ed9d.86b6 -->
  clearSelection(): void {
    this.selectionAnchor = null;
    this.selectionRange = null;
    this.emit();
  }

  // ===== 変更の知らせ =====

  /** カーソルの状態が変わったら呼ばれる購読を登録する。戻り値で解除する。 */
  // <!-- req editingcore:5160e65d.b0fa -->
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ===== 内部 =====

  /**
   * 音か休符を置いた拍 placed の次の位置（editing-core.md 4.1 節）。placed がその小節のそのボイスの最後の拍で、小節が埋まり、
   * 次の小節があればその頭（拍 0）、それ以外（途中の拍に置いたときを含む）は同じ小節の次の拍。
   * 最後の小節が埋まったときに小節を足すのは EditingService（4.1 節）で、足した後ならその頭になる。
   */
  // <!-- req editingcore:2dc49069.8488 --> <!-- req editingcore:5e51f4c5.086b -->
  private afterPlaced(target: EditTarget, placed: CursorPosition): CursorPosition {
    const { score } = target;
    // <!-- req editingcore:5e51f4c5.f5b4 -->
    if (isBarFilledAtLastBeat(score, placed) && placed.barIndex + 1 < barCount(score)) {
      return { ...placed, barIndex: placed.barIndex + 1, beatIndex: 0 };
    }
    // <!-- req editingcore:5e51f4c5.1835 -->
    return { ...placed, beatIndex: placed.beatIndex + 1 };
  }

  /** 今の位置の拍が音符を持つか（拍が無いか休符の拍なら偽）。 */
  private placedBeatHasNotes(target: EditTarget): boolean {
    const at = this.current;
    const beat = voiceBeats(target.score, at.trackIndex, at.barIndex, at.voiceIndex)[at.beatIndex];
    return beat !== undefined && beat.notes.length > 0;
  }

  /** ← の行き先。 */
  // <!-- req editingcore:1b80ef35.6394 -->
  private previousBeat(target: EditTarget): CursorPosition {
    const at = this.current;
    // <!-- req editingcore:1b80ef35.a7f4 -->
    if (at.beatIndex > 0) return { ...at, beatIndex: at.beatIndex - 1 };
    // <!-- req editingcore:1b80ef35.fcd6 -->
    if (at.barIndex === 0) return at;
    const previousBar = at.barIndex - 1;
    const count = voiceBeats(target.score, at.trackIndex, previousBar, at.voiceIndex).length;
    // <!-- req editingcore:1b80ef35.2c2d -->
    return { ...at, barIndex: previousBar, beatIndex: Math.max(0, count - 1) };
  }

  /** → の行き先（editing-core.md 4.1 節の (b) の箇条）。 */
  private nextBeat(target: EditTarget): CursorPosition {
    const at = this.current;
    const { score } = target;
    const count = voiceBeats(score, at.trackIndex, at.barIndex, at.voiceIndex).length;
    // <!-- req editingcore:52b52eea.cb4d -->
    if (at.beatIndex < count - 1) return { ...at, beatIndex: at.beatIndex + 1 };
    const filled = isBarFilled(score, at.trackIndex, at.barIndex, at.voiceIndex);
    // <!-- req editingcore:52b52eea.b8e5 -->
    // <!-- req editingcore:87024fc3.e435 --> <!-- req editingcore:87024fc3.5354 -->
    if (at.beatIndex === count - 1 && !filled) return { ...at, beatIndex: count };
    // <!-- req editingcore:52b52eea.8aa4 -->
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
