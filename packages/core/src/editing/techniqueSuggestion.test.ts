// UT-EDIT-ATTR: suggestTechniques・TECHNIQUE_SUGGEST_THRESHOLDS（奏法記号の自動の候補）
// 検証節: editing-core.md 7.1 節
// 検証観点: 間とフレットの差の組み合わせ（C2。しきい値のちょうどと、その 1 つ外）、直前の拍の決め方（同じボイス・小節をまたぐ・
//   拍子の分母で 1 拍）、スタッカートの音価、候補の数（2 件まで）、Score を変えないこと。

// <!-- req editingcore:ef2d6011.0815 -->
// <!-- req editingcore:ef2d6011.a656 -->
import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { getBar, getMasterBar, getStaff } from './scoreModel';
import { suggestTechniques, TECHNIQUE_SUGGEST_THRESHOLDS, type TechniqueSuggestion } from './techniqueSuggestion';
import type { CursorPosition, NoteRef } from './types';
import { buildEditTarget } from '../testing/editingFakes';

/** 拍 1 つの作り方。notes は [弦, フレット] の組（空なら休符の拍）。 */
interface BeatSpec {
  readonly duration?: model.Duration;
  readonly dots?: number;
  readonly tuplet?: readonly [number, number];
  readonly notes?: readonly (readonly [number, number])[];
}

const q = (notes: readonly (readonly [number, number])[] = []): BeatSpec => ({
  duration: model.Duration.Quarter,
  notes,
});

function makeBeat(spec: BeatSpec): model.Beat {
  const beat = new model.Beat();
  beat.duration = spec.duration ?? model.Duration.Quarter;
  beat.dots = spec.dots ?? 0;
  if (spec.tuplet !== undefined) {
    beat.tupletNumerator = spec.tuplet[0];
    beat.tupletDenominator = spec.tuplet[1];
  }
  for (const [string, fret] of spec.notes ?? []) {
    const note = new model.Note();
    note.string = string;
    note.fret = fret;
    beat.addNote(note);
  }
  return beat;
}

/**
 * パート 0 の小節を bars のとおりに作る（bars[i][v] が小節 i のボイス v の拍。ボイスの配列が無ければそのボイスを作らない）。
 * timeSignatures[i] があれば小節 i の拍子にする（無ければ 4/4）。
 */
function buildScore(
  bars: readonly (readonly (readonly BeatSpec[])[])[],
  timeSignatures: readonly (readonly [number, number] | undefined)[] = [],
): model.Score {
  const { score } = buildEditTarget();
  const staff = getStaff(score, 0);
  bars.forEach((voices, barIndex) => {
    if (barIndex > 0) {
      score.addMasterBar(new model.MasterBar());
      staff.addBar(new model.Bar());
    }
    const bar = getBar(score, 0, barIndex);
    bar.voices.splice(0);
    for (const beats of voices) {
      const voice = new model.Voice();
      bar.addVoice(voice);
      for (const spec of beats) voice.addBeat(makeBeat(spec));
    }
    const signature = timeSignatures[barIndex];
    if (signature !== undefined) {
      getMasterBar(score, barIndex).timeSignatureNumerator = signature[0];
      getMasterBar(score, barIndex).timeSignatureDenominator = signature[1];
    }
  });
  return score;
}

const at = (barIndex: number, beatIndex: number, voiceIndex: 0 | 1 = 0): CursorPosition => ({
  trackIndex: 0,
  barIndex,
  voiceIndex,
  beatIndex,
});

const ref = (position: CursorPosition, stringNumber = 3): NoteRef => ({ position, stringNumber });

const kinds = (suggestions: readonly TechniqueSuggestion[]): string[] => suggestions.map((s) => s.kind);

/** 小節 0 に、弦 3 の 2 つの拍（前の音価 previous、フレット from → to）を置いた Score。 */
function twoNotes(from: number, to: number, previous: BeatSpec = q()): model.Score {
  return buildScore([[[{ ...previous, notes: [[3, from]] }, q([[3, to]])]]]);
}

describe('TECHNIQUE_SUGGEST_THRESHOLDS', () => {
  it('TECHNIQUE_SUGGEST_THRESHOLDS_表のしきい値_フレットの差1から4と間1拍と8分音符', () => {
    // UT-EDIT-ATTR-44 7.1 節「条件は下の表の数のしきい値で決め、しきい値は実装で直せる定数として 1 か所に持つ」
    expect(TECHNIQUE_SUGGEST_THRESHOLDS).toEqual({
      minFretDelta: 1,
      maxFretDelta: 4,
      maxGapBeats: 1,
      staccatoMaxDuration: model.Duration.Eighth,
    });
  });
});

describe('suggestTechniques（スライド・ハンマリング・プリング）', () => {
  it('suggestTechniques_フレットが上がる_ハンマリングとスライドを前の音符に並べScoreを変えない', () => {
    // UT-EDIT-ATTR-45 7.1 節「ハンマリング｜同じ条件で、フレットが上がるとき」「ハンマリングかプリングと、スライドを並べて出す」・
    // 「スライド・ハンマリング・プリングは、始まりの音（前の音符）に付ける（Note.slideOutType は SlideOutType.Shift、
    // Note.isHammerPullOrigin は真）」「純粋な関数（Score を変えない）」
    const score = twoNotes(5, 7);
    const before = model.JsonConverter.scoreToJson(score);
    const target = ref(at(0, 0));
    expect(suggestTechniques(score, ref(at(0, 1)))).toEqual([
      { kind: 'hammer', target, patch: { isHammerPullOrigin: true } },
      { kind: 'slide', target, patch: { slideOutType: model.SlideOutType.Shift } },
    ]);
    expect(model.JsonConverter.scoreToJson(score)).toBe(before);
  });

  it('suggestTechniques_フレットが下がる_プリングとスライドを並べる', () => {
    // UT-EDIT-ATTR-46 7.1 節「プリング｜同じ条件で、フレットが下がるとき」・「同時に出す候補は 2 件までとする」
    const suggestions = suggestTechniques(twoNotes(7, 5), ref(at(0, 1)));
    expect(kinds(suggestions)).toEqual(['pull', 'slide']);
    expect(suggestions[0]!.patch).toEqual({ isHammerPullOrigin: true });
  });

  it('suggestTechniques_フレットの差_1から4なら出し0と5なら出さない', () => {
    // UT-EDIT-ATTR-47 7.1 節「フレットの差が 1 から 4」「フレットの差が 4 を超えるときは、候補を出さない」
    expect(kinds(suggestTechniques(twoNotes(5, 6), ref(at(0, 1))))).toEqual(['hammer', 'slide']);
    expect(kinds(suggestTechniques(twoNotes(5, 9), ref(at(0, 1))))).toEqual(['hammer', 'slide']);
    expect(kinds(suggestTechniques(twoNotes(9, 5), ref(at(0, 1))))).toEqual(['pull', 'slide']);
    expect(suggestTechniques(twoNotes(5, 10), ref(at(0, 1)))).toEqual([]);
    expect(suggestTechniques(twoNotes(10, 5), ref(at(0, 1)))).toEqual([]);
    expect(suggestTechniques(twoNotes(5, 5), ref(at(0, 1)))).toEqual([]);
  });

  it('suggestTechniques_直前の拍との間_1拍以内なら出し1拍を超えると出さない', () => {
    // UT-EDIT-ATTR-48 7.1 節「直前の拍との間が 1 拍以内」「直前の拍との間が 1 拍を超えるときも、候補を出さない」・
    // 「間は、直前の拍の始まりから今の拍の始まりまでの長さ」（前の拍の音価が間になる）
    const eighth: BeatSpec = { duration: model.Duration.Eighth };
    const tripletQuarter: BeatSpec = { duration: model.Duration.Quarter, tuplet: [3, 2] };
    const dottedQuarter: BeatSpec = { duration: model.Duration.Quarter, dots: 1 };
    const half: BeatSpec = { duration: model.Duration.Half };
    expect(suggestTechniques(twoNotes(5, 7, eighth), ref(at(0, 1)))).toHaveLength(2);
    expect(suggestTechniques(twoNotes(5, 7, tripletQuarter), ref(at(0, 1)))).toHaveLength(2);
    expect(suggestTechniques(twoNotes(5, 7, q()), ref(at(0, 1)))).toHaveLength(2);
    expect(suggestTechniques(twoNotes(5, 7, dottedQuarter), ref(at(0, 1)))).toEqual([]);
    expect(suggestTechniques(twoNotes(5, 7, half), ref(at(0, 1)))).toEqual([]);
  });

  it('suggestTechniques_小節をまたぐ_前の小節の最後の拍を直前の拍とし小節の始まりまでを間に数える', () => {
    // UT-EDIT-ATTR-49 7.1 節「1 つ前の拍は小節をまたいでも数える」「間は、直前の拍の始まりから今の拍の始まりまでの長さ」
    const full = buildScore([[[q(), q(), q(), q([[3, 5]])]], [[q([[3, 7]])]]]);
    const suggestions = suggestTechniques(full, ref(at(1, 0)));
    expect(kinds(suggestions)).toEqual(['hammer', 'slide']);
    expect(suggestions[0]!.target).toEqual(ref(at(0, 3)));
    // 前の小節が 2 拍しか無いと、足りない分（暗黙の休符）も間に入り、間は 3 拍になる
    const short = buildScore([[[q(), q([[3, 5]])]], [[q([[3, 7]])]]]);
    expect(suggestTechniques(short, ref(at(1, 0)))).toEqual([]);
  });

  it('suggestTechniques_1拍は拍子の分母の音符_8分の6拍子では8分音符の間で出し4分音符の間で出さない', () => {
    // UT-EDIT-ATTR-50 7.1 節「1 拍は拍子の分母の音符 1 つの長さとする」
    const eighthGap = buildScore([[[{ duration: model.Duration.Eighth, notes: [[3, 5]] }, q([[3, 7]])]]], [[6, 8]]);
    expect(suggestTechniques(eighthGap, ref(at(0, 1)))).toHaveLength(2);
    const quarterGap = buildScore([[[q([[3, 5]]), q([[3, 7]])]]], [[6, 8]]);
    expect(suggestTechniques(quarterGap, ref(at(0, 1)))).toEqual([]);
    const halfBeat = buildScore([[[q([[3, 5]]), q([[3, 7]])]]], [[2, 2]]);
    expect(suggestTechniques(halfBeat, ref(at(0, 1)))).toHaveLength(2);
  });

  it('suggestTechniques_直前の拍に同じ弦の音符が無い_出さない', () => {
    // UT-EDIT-ATTR-51 7.1 節「同じ弦の続く拍で」（直前の拍の別の弦の音符・休符の拍は数えない）
    const otherString = buildScore([[[q([[2, 5]]), q([[3, 7]])]]]);
    expect(suggestTechniques(otherString, ref(at(0, 1)))).toEqual([]);
    const restBefore = buildScore([[[q([[3, 5]]), q(), q([[3, 7]])]]]);
    expect(suggestTechniques(restBefore, ref(at(0, 2)))).toEqual([]);
    // placed の弦に音符が無い（呼ぶ側の誤り）も出さない
    expect(suggestTechniques(twoNotes(5, 7), ref(at(0, 1), 4))).toEqual([]);
  });

  it('suggestTechniques_2つ目のボイス_同じボイスの1つ前の拍だけを見る', () => {
    // UT-EDIT-ATTR-52 7.1 節「直前の拍は、同じパートの同じボイスで 1 つ前の拍とし」
    const score = buildScore([
      [
        [q([[3, 1]]), q([[3, 12]])],
        [q([[3, 5]]), q([[3, 7]])],
      ],
    ]);
    const suggestions = suggestTechniques(score, ref(at(0, 1, 1)));
    expect(kinds(suggestions)).toEqual(['hammer', 'slide']);
    expect(suggestions[1]!.target).toEqual(ref(at(0, 0, 1)));
    expect(suggestTechniques(score, ref(at(0, 1, 0)))).toEqual([]);
  });

  it('suggestTechniques_直前の拍が無いか拍の外_出さない', () => {
    // UT-EDIT-ATTR-53 7.1 節「0 から 2 件」（曲の最初の拍・拍の外の位置では 0 件）
    const score = twoNotes(5, 7);
    expect(suggestTechniques(score, ref(at(0, 0)))).toEqual([]);
    expect(suggestTechniques(score, ref(at(0, 2)))).toEqual([]);
  });
});

describe('suggestTechniques（スタッカート）', () => {
  it('suggestTechniques_8分音符の後ろに休符の拍_前の音符にスタッカートを示す', () => {
    // UT-EDIT-ATTR-54 7.1 節「スタッカート｜音価が 8 分音符以下で、次の拍が休符のとき」・「短い音符の後ろに休符の拍を置いたとき
    // （InsertRestCommand の後）に、前の音符に対して示す」
    const score = buildScore([[[{ duration: model.Duration.Eighth, notes: [[3, 5]] }, q()]]]);
    expect(suggestTechniques(score, ref(at(0, 1)))).toEqual([
      { kind: 'staccato', target: ref(at(0, 0)), patch: { isStaccato: true } },
    ]);
  });

  it('suggestTechniques_スタッカートの音価_8分音符以下なら出し長ければ出さない', () => {
    // UT-EDIT-ATTR-55 7.1 節「音価が 8 分音符以下」（16 分・32 分・3 連の 8 分は短い、付点 8 分・4 分・2 倍全音符は長い）
    const afterRest = (previous: BeatSpec): readonly TechniqueSuggestion[] =>
      suggestTechniques(buildScore([[[{ ...previous, notes: [[3, 5]] }, q()]]]), ref(at(0, 1)));
    expect(kinds(afterRest({ duration: model.Duration.Sixteenth }))).toEqual(['staccato']);
    expect(kinds(afterRest({ duration: model.Duration.ThirtySecond }))).toEqual(['staccato']);
    expect(kinds(afterRest({ duration: model.Duration.Eighth, tuplet: [3, 2] }))).toEqual(['staccato']);
    expect(afterRest({ duration: model.Duration.Eighth, dots: 1 })).toEqual([]);
    expect(afterRest({ duration: model.Duration.Quarter })).toEqual([]);
    expect(afterRest({ duration: model.Duration.DoubleWhole })).toEqual([]);
  });

  it('suggestTechniques_休符の前が休符_スタッカートを出さない', () => {
    // UT-EDIT-ATTR-56 7.1 節「前の音符に対して示す」（前の拍に音符が無ければ示さない）
    const score = buildScore([[[{ duration: model.Duration.Eighth }, q()]]]);
    expect(suggestTechniques(score, ref(at(0, 1)))).toEqual([]);
  });

  it('suggestTechniques_和音の後ろに休符の拍_同じ弦の音符か弦の番号の一番小さい音符に示す', () => {
    // UT-EDIT-ATTR-57 7.1 節「target は…スタッカートは短い音符」（和音の拍のどの音符に付けるか）
    const score = buildScore([
      [
        [
          {
            duration: model.Duration.Eighth,
            notes: [
              [4, 2],
              [2, 3],
            ],
          },
          q(),
        ],
      ],
    ]);
    expect(suggestTechniques(score, ref(at(0, 1), 4))[0]!.target).toEqual(ref(at(0, 0), 4));
    expect(suggestTechniques(score, ref(at(0, 1), 3))[0]!.target).toEqual(ref(at(0, 0), 2));
  });

  it('suggestTechniques_前の小節に拍が無いボイス_その前の小節の最後の拍を直前の拍にする', () => {
    // UT-EDIT-ATTR-58 7.1 節「同じボイスで 1 つ前の拍とし、小節をまたいでも数える」（拍が 0 個のボイスの小節は飛ばす）
    const score = buildScore([[[q(), { duration: model.Duration.Eighth, notes: [[3, 5]] }]], [[]], [[q()]]]);
    expect(suggestTechniques(score, ref(at(2, 0)))).toEqual([
      { kind: 'staccato', target: ref(at(0, 1)), patch: { isStaccato: true } },
    ]);
  });

  it('suggestTechniques_音符を置いた拍と休符を置いた拍_それぞれ別の候補だけを出す', () => {
    // UT-EDIT-ATTR-59 7.1 節「同時に出す候補は 2 件までとする」・「スタッカートの候補は…休符の拍を置いたとき」
    // 8 分音符の後ろに音符を置いてもスタッカートは出さず、休符を置いてもスライドは出さない
    const score = buildScore([[[{ duration: model.Duration.Eighth, notes: [[3, 5]] }, q([[3, 7]]), q()]]]);
    expect(kinds(suggestTechniques(score, ref(at(0, 1))))).toEqual(['hammer', 'slide']);
    expect(kinds(suggestTechniques(score, ref(at(0, 2))))).toEqual([]);
  });
});
