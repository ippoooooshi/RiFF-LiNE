/**
 * 奏法記号の自動の候補（editing-core.md 7.1 節）。
 *
 * 音符を置いた直後（`PlaceNoteCommand` の後）と休符の拍を置いた直後（`InsertRestCommand` の後）に、`EditingService` が
 * `suggestTechniques(score, placed)` で候補を 0 から 2 件求めて覚える。この関数は Score を変えない純粋な関数で、
 * 候補を付けるのは利用者が承認したときの `SetTechniqueCommand` だけ（自動では付けない、7.1 節）。
 *
 * 候補の条件（7.1 節の表）：
 *  - スライド・ハンマリング・プリング：同じ弦の続く拍で、直前の拍との間が 1 拍以内、フレットの差が 1 から 4。
 *    ハンマリングはフレットが上がるとき、プリングは下がるとき。スライドと同時に当たるので、ハンマリングかプリングとスライドを並べて出す
 *  - スタッカート：音価が 8 分音符以下で、次の拍が休符のとき（休符の拍を置いたときに、前の音符に対して示す）
 *
 * しきい値は `TECHNIQUE_SUGGEST_THRESHOLDS` の 1 か所に持つ（7.1 節）。UT-EDIT-ATTR（techniqueSuggestion.test.ts）。
 */

import { model } from '@coderline/alphatab';

import type { NoteTechniquePatch } from './commands/noteAttributeCommands';
import { findNoteOnString, getMasterBar, voiceBeats } from './scoreModel';
import type { CursorPosition, NoteRef } from './types';

/** 自動の候補 1 件（editing-core.md 7.1 節）。 */
// <!-- req editingcore:0a87e998.41b9 -->
export interface TechniqueSuggestion {
  // <!-- req editingcore:a7fb9337.a97e -->
  kind: 'slide' | 'hammer' | 'pull' | 'staccato';
  /** 記号を付ける音符（スライド・ハンマリング・プリングは前の音符、スタッカートは短い音符）。 */
  // <!-- req editingcore:e6658c79.20f8 -->
  target: NoteRef;
  // <!-- req editingcore:15bd9e7e.3589 -->
  patch: NoteTechniquePatch;
}

/** 自動の候補のしきい値（editing-core.md 7.1 節。実装で直せる定数として 1 か所に持つ）。 */
// <!-- req editingcore:038cf517.dbf1 --> <!-- req editingcore:038cf517.8ecc --> <!-- req editingcore:038cf517.77bc --> <!-- req editingcore:038cf517.8900 --> <!-- req editingcore:199bfc04.e2b5 -->
export const TECHNIQUE_SUGGEST_THRESHOLDS: {
  // <!-- req editingcore:31e4ecd4.2781 -->
  readonly minFretDelta: 1;
  // <!-- req editingcore:329d4b89.97a8 -->
  readonly maxFretDelta: 4;
  /** 直前の拍との間の上限（拍の数）。 */
  // <!-- req editingcore:0d310395.101e -->
  readonly maxGapBeats: 1;
  /** スタッカートの候補を出す一番長い音価。 */
  // <!-- req editingcore:1b1a2ad9.d297 -->
  readonly staccatoMaxDuration: model.Duration.Eighth;
} = {
  minFretDelta: 1,
  maxFretDelta: 4,
  maxGapBeats: 1,
  staccatoMaxDuration: model.Duration.Eighth,
};

/**
 * placed の音符（休符の拍なら、その拍）を置いた直後の自動の候補を 0 から 2 件返す（editing-core.md 7.1 節）。純粋な関数（Score を変えない）。
 * placed の拍が音符を持てばスライド・ハンマリング・プリングを、休符の拍ならスタッカートを見る。
 */
// <!-- req editingcore:afda4be1.369e --> <!-- req editingcore:bbb5d9c3.98ee --> <!-- req editingcore:8ee56da1.145b -->
// <!-- req editingcore:d222e544.66a1 -->
export function suggestTechniques(score: model.Score, placed: NoteRef): readonly TechniqueSuggestion[] {
  const { position } = placed;
  const beat = voiceBeats(score, position.trackIndex, position.barIndex, position.voiceIndex)[position.beatIndex];
  if (beat === undefined) return [];
  const previous = previousBeat(score, position);
  if (previous === null) return [];
  // 休符は音符を持たない Beat（editing-core.md 3.3 節）
  // <!-- req editingcore:8139909e.66f7 -->
  if (beat.notes.length === 0) return staccatoSuggestions(previous, placed.stringNumber);
  return legatoSuggestions(score, beat, previous, placed);
}

/** 直前の拍と、その拍の位置。 */
interface PreviousBeat {
  readonly beat: model.Beat;
  readonly position: CursorPosition;
}

/**
 * 直前の拍（editing-core.md 7.1 節）：同じパートの同じボイスで 1 つ前の拍。小節をまたいでも数え、そのボイスに拍が無い小節は飛ばす。
 * 前後の拍のつながり（`Beat.previousBeat`）は finish() が作る派生情報なので使わず、配列の位置で辿る（2.4 節）。
 */
// <!-- req editingcore:e62b656f.6c0a -->
function previousBeat(score: model.Score, position: CursorPosition): PreviousBeat | null {
  const { trackIndex, voiceIndex } = position;
  // <!-- req editingcore:e62b656f.3b96 -->
  for (let barIndex = position.barIndex; barIndex >= 0; barIndex--) {
    const beats = voiceBeats(score, trackIndex, barIndex, voiceIndex);
    // <!-- req editingcore:e62b656f.9358 -->
    const beatIndex = barIndex === position.barIndex ? position.beatIndex - 1 : beats.length - 1;
    const beat = beats[beatIndex];
    if (beat !== undefined) return { beat, position: { trackIndex, barIndex, voiceIndex, beatIndex } };
  }
  return null;
}

/**
 * スライド・ハンマリング・プリング（editing-core.md 7.1 節）。同じ弦の続く拍で、間が `maxGapBeats` 拍以内、フレットの差が
 * `minFretDelta` から `maxFretDelta` のとき、フレットの上下で決まるハンマリングかプリングと、スライドを並べて返す。
 * 記号は始まりの音（前の音符）に付ける（スライドは `SlideOutType.Shift`、ハンマリング・プリングは `isHammerPullOrigin`）。
 */
function legatoSuggestions(
  score: model.Score,
  beat: model.Beat,
  previous: PreviousBeat,
  placed: NoteRef,
): readonly TechniqueSuggestion[] {
  const note = findNoteOnString(beat, placed.stringNumber);
  // <!-- req editingcore:ad802184.cfa3 -->
  const previousNote = findNoteOnString(previous.beat, placed.stringNumber);
  if (note === null || previousNote === null) return [];
  // <!-- req editingcore:ad802184.a5e2 --> <!-- req editingcore:6425b8b7.11c9 --> <!-- req editingcore:6425b8b7.206d --> <!-- req editingcore:ef2d6011.98d8 -->
  if (!isWithinGap(score, previous.position, placed.position)) return [];
  const delta = note.fret - previousNote.fret;
  const distance = Math.abs(delta);
  const { minFretDelta, maxFretDelta } = TECHNIQUE_SUGGEST_THRESHOLDS;
  // <!-- req editingcore:ad802184.a6f5 --> <!-- req editingcore:d10a1725.5d0b --> <!-- req editingcore:d10a1725.206d -->
  if (distance < minFretDelta || distance > maxFretDelta) return [];

  // <!-- req editingcore:a992fbd1.8649 --> <!-- req editingcore:a992fbd1.e39f --> <!-- req editingcore:a992fbd1.a797 -->
  const target: NoteRef = { position: previous.position, stringNumber: placed.stringNumber };
  // <!-- req editingcore:281fe3a4.0ddc --> <!-- req editingcore:53cb98d2.a097 -->
  return [
    // <!-- req editingcore:389d6451.5add --> <!-- req editingcore:389d6451.75d0 --> <!-- req editingcore:c1125977.0268 --> <!-- req editingcore:c1125977.8068 --> <!-- req editingcore:53cb98d2.6aa6 --> <!-- req editingcore:a992fbd1.26f2 -->
    { kind: delta > 0 ? 'hammer' : 'pull', target, patch: { isHammerPullOrigin: true } },
    // <!-- req editingcore:ad802184.4a08 --> <!-- req editingcore:53cb98d2.66e1 --> <!-- req editingcore:a992fbd1.29fa --> <!-- req editingcore:a992fbd1.0204 -->
    { kind: 'slide', target, patch: { slideOutType: model.SlideOutType.Shift } },
  ];
}

/**
 * スタッカート（editing-core.md 7.1 節）。休符の拍を置いた直後に、直前の拍が音符を持ち、その音価が `staccatoMaxDuration` 以下なら、
 * その音符に対して示す。和音の拍では、placed と同じ弦の音符を、無ければ弦の番号の一番小さい音符を target にする。
 */
function staccatoSuggestions(previous: PreviousBeat, stringNumber: number): readonly TechniqueSuggestion[] {
  const notes = previous.beat.notes;
  if (notes.length === 0) return [];
  // <!-- req editingcore:8139909e.6d23 -->
  if (!atMost(beatLength(previous.beat), ratio(1, TECHNIQUE_SUGGEST_THRESHOLDS.staccatoMaxDuration))) return [];
  const targetString =
    findNoteOnString(previous.beat, stringNumber)?.string ?? Math.min(...notes.map((note) => note.string));
  return [
    {
      kind: 'staccato',
      // <!-- req editingcore:c7d1d266.36e3 -->
      target: { position: previous.position, stringNumber: targetString },
      patch: { isStaccato: true },
    },
  ];
}

/**
 * 直前の拍との間が `maxGapBeats` 拍以内か（editing-core.md 7.1 節）。間は、直前の拍の始まりから今の拍の始まりまでの長さ。
 * 拍の始まりは、小節の始まり（前の小節の拍子の長さを足したもの）に、小節の中で前にある拍の音価を足した所とする。
 * 1 拍は、今の拍の小節の拍子の分母の音符 1 つの長さ。
 */
function isWithinGap(score: model.Score, from: CursorPosition, to: CursorPosition): boolean {
  // <!-- req editingcore:e62b656f.b177 -->
  let gap = sub(offsetInBar(score, to), offsetInBar(score, from));
  for (let barIndex = from.barIndex; barIndex < to.barIndex; barIndex++) {
    const masterBar = getMasterBar(score, barIndex);
    gap = add(gap, ratio(masterBar.timeSignatureNumerator, masterBar.timeSignatureDenominator));
  }
  // <!-- req editingcore:e62b656f.36bb -->
  const beatUnit = getMasterBar(score, to.barIndex).timeSignatureDenominator;
  return atMost(gap, ratio(TECHNIQUE_SUGGEST_THRESHOLDS.maxGapBeats, beatUnit));
}

/** 小節の始まりから、その拍の始まりまでの長さ（同じボイスの前の拍の音価の合計）。 */
function offsetInBar(score: model.Score, position: CursorPosition): Ratio {
  return voiceBeats(score, position.trackIndex, position.barIndex, position.voiceIndex)
    .slice(0, position.beatIndex)
    .reduce((sum, beat) => add(sum, beatLength(beat)), ratio(0, 1));
}

// ===== 長さ（全音符を 1 とする分数。丸めずに比べるため） =====

interface Ratio {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 分母を正にそろえて約分する（alphaTab の Beat の連符の初めの値は分子・分母とも −1 なので、分母が負で来ることがある）。 */
function ratio(n: number, d: number): Ratio {
  const sign = d < 0 ? -1 : 1;
  const g = gcd(Math.abs(n), Math.abs(d));
  return { n: (sign * n) / g, d: (sign * d) / g };
}

function add(a: Ratio, b: Ratio): Ratio {
  return ratio(a.n * b.d + b.n * a.d, a.d * b.d);
}

function sub(a: Ratio, b: Ratio): Ratio {
  return ratio(a.n * b.d - b.n * a.d, a.d * b.d);
}

/** a が b 以下か。 */
function atMost(a: Ratio, b: Ratio): boolean {
  return a.n * b.d <= b.n * a.d;
}

/**
 * 拍の音価の長さ（editing-core.md 3.3 節・4.3 節）。音符の長さ（`Beat.duration`）・付点（k 個で (2^(k+1)−1)/2^k 倍）・
 * 連符（`tupletDenominator / tupletNumerator` 倍）の組から数える。`Duration` の負の値（`DoubleWhole` は −2）は、その絶対値の数の全音符の長さ
 * （読み込んだ曲に入っていることがあるため、scoreModel.ts の `isBarFilled` と同じ数え方にする）。
 */
function beatLength(beat: model.Beat): Ratio {
  const base = beat.duration > 0 ? ratio(1, beat.duration) : ratio(-beat.duration, 1);
  const dotted = ratio(base.n * (2 ** (beat.dots + 1) - 1), base.d * 2 ** beat.dots);
  return ratio(dotted.n * beat.tupletDenominator, dotted.d * beat.tupletNumerator);
}
