// UT-EDIT-VALID: editing-core.md 5 節、基本設計 04 章 4 節・11 節 — ValidationService
// 検証観点（C2）: フレット範囲（境界 0/24/-1/25）と確かめの順、重複配置と context、小節数・パート数の上限、メモ切り詰め、
// 拍子の範囲、リピートの回数と対応する開始、付点と連符の範囲。

// <!-- req editingcore:d64211e4.95b3 -->
// <!-- req editingcore:d64211e4.3011 -->
import { describe, expect, it } from 'vitest';

import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { tupletSpecFor, type BeatDurationSpec, type CursorPosition } from './types';
import { ValidationService } from './ValidationService';
import { allCombinations } from '../testing/combinations';
import { buildEditTarget } from '../testing/editingFakes';
import { model } from '@coderline/alphatab';

const svc = new ValidationService();
const pos: CursorPosition = { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };

/** isIntegerIn（ValidationService.ts の 60 行）の 3 つの要素の真と偽。 */
interface IntegerInRow {
  isInteger: boolean;
  atLeastMin: boolean;
  atMostMax: boolean;
}

/**
 * isIntegerIn の 3 つの要素の真と偽から、範囲に対する値を作る。下限の下（below）・範囲の中（inner）・上限の上（above）の整数を選び、
 * 整数でないときは 0.5 を足す（below と above は範囲から 1 離した整数なので、0.5 を足しても範囲の外のまま）。
 */
const valueForIntegerIn = (row: IntegerInRow, below: number, inner: number, above: number): number =>
  (row.atLeastMin ? (row.atMostMax ? inner : above) : below) + (row.isInteger ? 0 : 0.5);

/** 下限より小さく、上限より大きい値は無い（下限 ≦ 上限）ので、atLeastMin と atMostMax が両方とも偽の組み合わせは作れない。 */
const isPossibleIntegerIn = (row: IntegerInRow): boolean => row.atLeastMin || row.atMostMax;

describe('ValidationService.validateNotePlacement', () => {
  it.each([
    [0, true],
    [24, true],
    [12, true],
    [-1, false],
    [25, false],
    [1.5, false],
  ])('fret %s → ok=%s', (fret, ok) => {
    const target = buildEditTarget();
    const result = svc.validateNotePlacement(target, pos, 3, fret);
    expect(result.ok).toBe(ok);
    if (!ok) expect(result).toMatchObject({ code: 'EDIT-002' });
  });

  it('duplicateStringInBeat_ReturnsEDIT001', () => {
    const target = buildEditTarget();
    new PlaceNoteCommand(target, pos, 3, 5, { duration: model.Duration.Quarter, dots: 0, tuplet: null }).execute();
    const result = svc.validateNotePlacement(target, pos, 3, 7);
    expect(result).toMatchObject({ ok: false, code: 'EDIT-001', context: { stringNumber: 3 } }); // <!-- req 00:c615ee50.3c4b -->
  });

  it('ValidationService_ボイス2の位置_そのボイスの拍の重なりだけを見る', () => {
    // UT-EDIT-VALID-01 3.1 節「カーソルは、選んでいるボイス…の拍の上だけを動く」・4.1 節「2 つ目のボイスがまだ無い小節」
    const target = buildEditTarget();
    const voice2: CursorPosition = { ...pos, voiceIndex: 1 };
    new PlaceNoteCommand(target, pos, 3, 5, { duration: model.Duration.Quarter, dots: 0, tuplet: null }).execute();
    expect(svc.validateNotePlacement(target, voice2, 3, 7).ok).toBe(true);
    new PlaceNoteCommand(target, voice2, 3, 5, { duration: model.Duration.Quarter, dots: 0, tuplet: null }).execute();
    expect(svc.validateNotePlacement(target, voice2, 3, 7)).toMatchObject({ ok: false, code: 'EDIT-001' });
  });

  it('differentStringInSameBeat_IsOk', () => {
    const target = buildEditTarget();
    new PlaceNoteCommand(target, pos, 3, 5, { duration: model.Duration.Quarter, dots: 0, tuplet: null }).execute();
    expect(svc.validateNotePlacement(target, pos, 2, 7).ok).toBe(true);
  });

  it('ValidationService_重なる弦に範囲の外のフレット_EDIT002を先に返しカーソルの小節を文脈に入れる', () => {
    // UT-EDIT-VALID-02 5 節「validateNotePlacement は EDIT-002 を先に見て、範囲の外なら弦の重複を見ない」・表「context は { trackIndex, barIndex }」
    const target = buildEditTarget(2);
    const at: CursorPosition = { trackIndex: 1, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
    new PlaceNoteCommand(target, at, 3, 5, { duration: model.Duration.Quarter, dots: 0, tuplet: null }).execute();
    expect(svc.validateNotePlacement(target, at, 3, 25)).toEqual({
      ok: false,
      code: 'EDIT-002',
      context: { trackIndex: 1, barIndex: 0 },
    });
  });

  it('ValidationService_同じ拍の同じ弦_EDIT001の文脈に5つの項目を入れる', () => {
    // UT-EDIT-VALID-03 5 節「EDIT-001 の context に { trackIndex, barIndex, voiceIndex, beatIndex, stringNumber } を入れ」
    const target = buildEditTarget(2);
    const at: CursorPosition = { trackIndex: 1, barIndex: 0, voiceIndex: 1, beatIndex: 0 };
    new PlaceNoteCommand(target, at, 4, 5, { duration: model.Duration.Quarter, dots: 0, tuplet: null }).execute();
    expect(svc.validateNotePlacement(target, at, 4, 7)).toEqual({
      ok: false,
      code: 'EDIT-001',
      context: { trackIndex: 1, barIndex: 0, voiceIndex: 1, beatIndex: 0, stringNumber: 4 },
    });
  });

  // C2（web-core-foundation.md 14.3 節）：ValidationService.ts 60 行の isIntegerIn（整数か × 下限以上か × 上限以下か）。
  // isIntegerIn は export されていないので、公開の入口の validateNotePlacement のフレット（0 から 24、83 行）から届かせる。
  // 範囲の中と見るのは 3 つとも真のときだけで、そうでなければ EDIT-002。下限の下で上限の上の値は作れないので外す
  // UT-EDIT-VALID-21 web-core-foundation.md 14.3 節の C2（ValidationService.ts 60 行の isIntegerIn）・editing-core.md 5 節の EDIT-002 <!-- req webcorefoundation:7db00ef9.1c8f --> <!-- req webcorefoundation:7db00ef9.2ecb -->
  it.each(allCombinations(['isInteger', 'atLeastMin', 'atMostMax'] as const).filter(isPossibleIntegerIn))(
    'isIntegerIn_C2_フレット_isInteger=$isInteger, atLeastMin=$atLeastMin, atMostMax=$atMostMax',
    (row) => {
      const fret = valueForIntegerIn(row, -1, 12, 25);
      const result = svc.validateNotePlacement(buildEditTarget(), pos, 3, fret);
      const inRange = row.isInteger && row.atLeastMin && row.atMostMax;
      if (inRange) expect(result).toEqual({ ok: true });
      else expect(result).toEqual({ ok: false, code: 'EDIT-002', context: { trackIndex: 0, barIndex: 0 } });
    },
  );

  // C2（web-core-foundation.md 14.3 節）：ValidationService.ts 101 行の重複の判定（位置に拍があるか × その拍のその弦に音符があるか）。
  // EDIT-001 は両方が真のときだけ。拍が無い位置（拍の番号が拍の数より大きい）は音符も無いので、拍が無くて音符がある組み合わせは外す
  // UT-EDIT-VALID-22 web-core-foundation.md 14.3 節の C2（ValidationService.ts 101 行）・editing-core.md 5 節の EDIT-001 <!-- req webcorefoundation:7db00ef9.0bce --> <!-- req webcorefoundation:7db00ef9.ba83 -->
  it.each(
    allCombinations(['hasBeat', 'hasNoteOnString'] as const).filter((row) => row.hasBeat || !row.hasNoteOnString),
  )(
    'validateNotePlacement_重複のC2_hasBeat=$hasBeat, hasNoteOnString=$hasNoteOnString',
    ({ hasBeat, hasNoteOnString }) => {
      const target = buildEditTarget();
      if (hasNoteOnString) {
        new PlaceNoteCommand(target, pos, 3, 5, { duration: model.Duration.Quarter, dots: 0, tuplet: null }).execute();
      }
      const at: CursorPosition = hasBeat ? pos : { ...pos, beatIndex: 99 };
      const result = svc.validateNotePlacement(target, at, 3, 7);
      if (hasBeat && hasNoteOnString) expect(result).toMatchObject({ ok: false, code: 'EDIT-001' });
      else expect(result).toEqual({ ok: true });
    },
  );
});

describe('ValidationService.validateBarInsertion', () => {
  it('underLimit_IsOk', () => {
    expect(svc.validateBarInsertion(buildEditTarget()).ok).toBe(true);
  });

  it('atLimit_ReturnsEDIT003', () => {
    const target = buildEditTarget();
    // masterBars を 2048 まで水増しして境界を突く（Bar 本体は不要。barCount は masterBars.length）。
    while (target.score.masterBars.length < 2048) target.score.addMasterBar(new model.MasterBar());
    const result = svc.validateBarInsertion(target);
    expect(result).toMatchObject({ ok: false, code: 'EDIT-003', context: { max: 2048 } });
  });

  it('ValidationService_2047小節_1つ足すのは通り2つ足すのはEDIT003', () => {
    // UT-EDIT-VALID-04 5 節「EDIT-003（足した後の小節の数が 2048 を超える）。count は足す小節の数（既定 1）」
    const target = buildEditTarget();
    while (target.score.masterBars.length < 2047) target.score.addMasterBar(new model.MasterBar());
    expect(svc.validateBarInsertion(target).ok).toBe(true);
    expect(svc.validateBarInsertion(target, 1).ok).toBe(true);
    expect(svc.validateBarInsertion(target, 2)).toMatchObject({ ok: false, code: 'EDIT-003' });
  });
});

describe('ValidationService.validatePartCount', () => {
  it('ValidationService_7パートは通り8パートはEDIT005', () => {
    // UT-EDIT-VALID-05 5 節の表「足した後のパートの数が 8 を超える」「EDIT-005」・(b)「ValidationService に validatePartCount として置き」 <!-- req webcorefoundation:06906664.62e0 -->
    expect(svc.validatePartCount(buildEditTarget(7)).ok).toBe(true);
    expect(svc.validatePartCount(buildEditTarget(8))).toMatchObject({
      ok: false,
      code: 'EDIT-005',
      context: { current: 8, max: 8 },
    });
  });

  it('ValidationService_1パートの曲_パートを足せる', () => {
    // UT-EDIT-VALID-16 5 節の表「足した後のパートの数が 8 を超える」の内側（parts の PartValidationService から移した） <!-- req webcorefoundation:06906664.b34b -->
    expect(svc.validatePartCount(buildEditTarget())).toEqual({ ok: true });
  });

  it('ValidationService_トラックを足して8パートにした曲_EDIT005と上限8を返す', () => {
    // UT-EDIT-VALID-17 5 節の表「足した後のパートの数が 8 を超える」「EDIT-005」（parts の PartValidationService から移した）
    const target = buildEditTarget();
    while (target.score.tracks.length < 8) target.score.addTrack(new model.Track());
    expect(svc.validatePartCount(target)).toEqual({ ok: false, code: 'EDIT-005', context: { current: 8, max: 8 } });
  });
});

describe('ValidationService.validateMemoText', () => {
  it('withinLimit_OkAndUnchanged', () => {
    const r = svc.validateMemoText('短いメモ');
    expect(r.value).toBe('短いメモ');
    expect(r.outcome.ok).toBe(true);
  });

  it('overLimit_ClampsTo100AndReturnsEDIT004', () => {
    const long = 'あ'.repeat(150);
    const r = svc.validateMemoText(long);
    expect([...r.value]).toHaveLength(100);
    expect(r.outcome).toMatchObject({ ok: false, code: 'EDIT-004' });
  });
});

describe('ValidationService.validateTimeSignature', () => {
  it.each([
    [1, 4, true],
    [32, 4, true],
    [4, 1, true],
    [4, 2, true],
    [4, 8, true],
    [4, 16, true],
    [4, 32, true],
    [0, 4, false],
    [33, 4, false],
    [3.5, 4, false],
    [4, 3, false],
    [4, 64, false],
    [4, 0, false],
  ])('ValidationService_拍子%s/%s_ok=%s', (numerator, denominator, ok) => {
    // UT-EDIT-VALID-06 5 節「EDIT-010（拍子の分子か分母が範囲の外）。context は { numerator, denominator } で barIndex を持たせず」
    const result = svc.validateTimeSignature({ numerator, denominator });
    if (ok) expect(result).toEqual({ ok: true });
    else expect(result).toEqual({ ok: false, code: 'EDIT-010', context: { numerator, denominator } });
  });

  // C2（web-core-foundation.md 14.3 節）：ValidationService.ts 180〜181 行の `||`（分子が 1 から 32 の整数でないか ×
  // 分母が 1・2・4・8・16・32 でないか）。分子の側は isIntegerIn の 3 つ（整数か × 下限以上か × 上限以下か）に開いて数える。
  // 通すのは 4 つとも真のときだけで、そうでなければ EDIT-010。下限の下で上限の上の分子は作れないので外す
  // UT-EDIT-VALID-23 web-core-foundation.md 14.3 節の C2（ValidationService.ts 180〜181 行）・editing-core.md 5 節の EDIT-010 <!-- req webcorefoundation:7db00ef9.1c8f --> <!-- req webcorefoundation:7db00ef9.2ecb -->
  it.each(
    allCombinations(['isInteger', 'atLeastMin', 'atMostMax', 'denominatorAllowed'] as const).filter(
      isPossibleIntegerIn,
    ),
  )(
    'validateTimeSignature_C2_isInteger=$isInteger, atLeastMin=$atLeastMin, atMostMax=$atMostMax, denominatorAllowed=$denominatorAllowed',
    (row) => {
      const numerator = valueForIntegerIn(row, 0, 4, 33);
      const denominator = row.denominatorAllowed ? 8 : 3;
      const result = svc.validateTimeSignature({ numerator, denominator });
      const ok = row.isInteger && row.atLeastMin && row.atMostMax && row.denominatorAllowed;
      if (ok) expect(result).toEqual({ ok: true });
      else expect(result).toEqual({ ok: false, code: 'EDIT-010', context: { numerator, denominator } });
    },
  );
});

describe('ValidationService.validateRepeat', () => {
  /** 小節を count まで足した曲。startAt の小節にだけ開始を付ける（null なら開始なし）。 */
  const scoreWithBars = (count: number, startAt: number | null): model.Score => {
    const target = buildEditTarget();
    while (target.score.masterBars.length < count) target.score.addMasterBar(new model.MasterBar());
    target.score.masterBars.forEach((masterBar, index) => {
      masterBar.isRepeatStart = index === startAt;
    });
    return target.score;
  };

  it.each([
    [0, true],
    [2, true],
    [10, true],
    [1, false],
    [11, false],
    [-1, false],
    [2.5, false],
  ])('ValidationService_開始のある回数%s_ok=%s', (repeatCount, ok) => {
    // UT-EDIT-VALID-07 5 節「EDIT-011（回数が 0 か 2 から 10 の外）…context は { repeatCount } で barIndex を持たせず」
    const result = svc.validateRepeat(scoreWithBars(2, 0), 1, { repeatCount });
    if (ok) expect(result).toEqual({ ok: true });
    else expect(result).toEqual({ ok: false, code: 'EDIT-011', context: { repeatCount } });
  });

  it('ValidationService_回数を指定しないpatch_確かめずに通す', () => {
    // UT-EDIT-VALID-08 10 節「開始を付けるのは { isRepeatStart: true }、外すのは { isRepeatStart: false }」
    expect(svc.validateRepeat(scoreWithBars(2, null), 1, { isRepeatStart: true })).toEqual({ ok: true });
    expect(svc.validateRepeat(scoreWithBars(2, 0), 0, { isRepeatStart: false })).toEqual({ ok: true });
  });

  it('ValidationService_開始の無い終わり_EDIT015を返す', () => {
    // UT-EDIT-VALID-09 5 節「EDIT-015（対応する開始の無い終わり）」・10 節「対応する開始の無い終わりは EDIT-015 で知らせたうえで発行する」
    expect(svc.validateRepeat(scoreWithBars(3, null), 2, { repeatCount: 2 })).toEqual({
      ok: false,
      code: 'EDIT-015',
      context: { barIndex: 2, repeatCount: 2 },
    });
    // 開始より前の小節の終わりは、後ろの開始と対にならない
    expect(svc.validateRepeat(scoreWithBars(3, 2), 1, { repeatCount: 3 })).toMatchObject({ code: 'EDIT-015' });
  });

  it('ValidationService_その小節かそれより前に開始がある終わり_通す', () => {
    // UT-EDIT-VALID-10 5 節「EDIT-015（対応する開始の無い終わり）」の裏：開始があれば知らせない
    expect(svc.validateRepeat(scoreWithBars(3, 0), 2, { repeatCount: 2 })).toEqual({ ok: true });
    expect(svc.validateRepeat(scoreWithBars(3, 2), 2, { repeatCount: 2 })).toEqual({ ok: true });
  });

  it('ValidationService_同じpatchで開始を付け外しする_patchの開始で判断する', () => {
    // UT-EDIT-VALID-11 10 節「patch で指定したキーだけを変える」：同じ patch の開始を、その小節の開始として数える
    expect(svc.validateRepeat(scoreWithBars(2, null), 1, { isRepeatStart: true, repeatCount: 2 })).toEqual({
      ok: true,
    });
    expect(svc.validateRepeat(scoreWithBars(2, 1), 1, { isRepeatStart: false, repeatCount: 2 })).toMatchObject({
      code: 'EDIT-015',
    });
  });

  it('ValidationService_範囲の外の回数で開始も無い_EDIT011を先に返す', () => {
    // UT-EDIT-VALID-12 5 節「EDIT-011（…）と EDIT-015（…）」：拒む Error を、続ける Warning より先に見る
    expect(svc.validateRepeat(scoreWithBars(2, null), 1, { repeatCount: 11 })).toMatchObject({ code: 'EDIT-011' });
  });

  // C2（web-core-foundation.md 14.3 節）：ValidationService.ts 199 行の `||`（回数を指定していないか × 回数が 0（なし）か）。
  // どちらかが真なら確かめずに通す。両方とも偽なら先を確かめる（開始の無い曲なので回数 2 は EDIT-015）。
  // 回数を指定せずに 0 にすることはできないので、両方とも真の組み合わせは外す
  // UT-EDIT-VALID-24 web-core-foundation.md 14.3 節の C2（ValidationService.ts 199 行）・editing-core.md 10 節の SetRepeatCommand <!-- req webcorefoundation:cb2190fd.ed63 -->
  it.each(
    allCombinations(['countUndefined', 'countZero'] as const).filter((row) => !(row.countUndefined && row.countZero)),
  )(
    'validateRepeat_回数なしのC2_countUndefined=$countUndefined, countZero=$countZero',
    ({ countUndefined, countZero }) => {
      const patch = countUndefined ? {} : { repeatCount: countZero ? 0 : 2 };
      const result = svc.validateRepeat(scoreWithBars(2, null), 1, patch);
      if (countUndefined || countZero) expect(result).toEqual({ ok: true });
      else expect(result).toEqual({ ok: false, code: 'EDIT-015', context: { barIndex: 1, repeatCount: 2 } });
    },
  );

  // C2（web-core-foundation.md 14.3 節）：ValidationService.ts 205 行の `&&`（その小節に開始が無いか × それより前に開始が無いか）に、
  // 973 行の「repeatCount の範囲 × 対応する開始のリピートがあるか」のとおり 200 行の回数の範囲を掛ける。
  // 回数が範囲の外なら開始によらず EDIT-011（Error を先に見る）。範囲の中で、その小節にもそれより前にも開始が無いときだけ EDIT-015
  // UT-EDIT-VALID-25 web-core-foundation.md 14.3 節の C2（ValidationService.ts 200 行・205 行）・editing-core.md 10 節の SetRepeatCommand <!-- req webcorefoundation:cb2190fd.ed63 --> <!-- req webcorefoundation:cb2190fd.2ce0 --> <!-- req webcorefoundation:cb2190fd.34f7 --> <!-- req webcorefoundation:cb2190fd.f716 -->
  it.each(allCombinations(['countInRange', 'startsHere', 'startsBefore'] as const))(
    'validateRepeat_開始のC2_countInRange=$countInRange, startsHere=$startsHere, startsBefore=$startsBefore',
    ({ countInRange, startsHere, startsBefore }) => {
      // 3 小節の曲の 3 小節目（barIndex 2）に終わりを付ける。開始は 1 小節目（前）と 3 小節目（その小節）にだけ置く
      const score = scoreWithBars(3, null);
      score.masterBars[0]!.isRepeatStart = startsBefore;
      score.masterBars[2]!.isRepeatStart = startsHere;
      const repeatCount = countInRange ? 3 : 11;
      const result = svc.validateRepeat(score, 2, { repeatCount });
      if (!countInRange) expect(result).toEqual({ ok: false, code: 'EDIT-011', context: { repeatCount } });
      else if (!startsHere && !startsBefore) {
        expect(result).toEqual({ ok: false, code: 'EDIT-015', context: { barIndex: 2, repeatCount } });
      } else expect(result).toEqual({ ok: true });
    },
  );
});

describe('ValidationService.validateBeatDuration', () => {
  const spec = (dots: number, tupletNumerator: number | null): BeatDurationSpec => ({
    duration: model.Duration.Quarter,
    dots: dots as BeatDurationSpec['dots'],
    // 分母は分子から決まる値（4.3 節）。分母の確かめは UT-EDIT-VALID-19 で見る
    tuplet: tupletNumerator === null ? null : tupletSpecFor(tupletNumerator),
  });

  it.each([
    [0, true],
    [1, true],
    [2, true],
    [3, false],
    [-1, false],
    [1.5, false],
  ])('ValidationService_付点%s_ok=%s', (dots, ok) => {
    // UT-EDIT-VALID-13 5 節「EDIT-012（付点）」・4.3 節「付点は、なし（0）・付点（1）・複付点（2）の 3 つ」
    const result = svc.validateBeatDuration(spec(dots, null));
    if (ok) expect(result).toEqual({ ok: true });
    else expect(result).toEqual({ ok: false, code: 'EDIT-012', context: { dots } });
  });

  it.each([
    [2, true],
    [3, true],
    [12, true],
    [1, false],
    [13, false],
    [2.5, false],
  ])('ValidationService_%s連符_ok=%s', (numerator, ok) => {
    // UT-EDIT-VALID-14 5 節「EDIT-016（連符）」・4.3 節「任意（何連符かを 2 から 12 で入れる）」
    const result = svc.validateBeatDuration(spec(0, numerator));
    if (ok) expect(result).toEqual({ ok: true });
    else expect(result).toEqual({ ok: false, code: 'EDIT-016', context: { tupletNumerator: numerator } });
  });

  it('ValidationService_付点も連符も範囲の外_EDIT012を先に返す', () => {
    // UT-EDIT-VALID-15 5 節「EDIT-012（付点）と EDIT-016（連符）」の順
    expect(svc.validateBeatDuration(spec(3, 13))).toMatchObject({ code: 'EDIT-012' });
  });

  it.each([
    [2, 3],
    [3, 2],
    [4, 3],
    [5, 4],
    [6, 4],
    [7, 4],
    [8, 4],
    [9, 8],
    [12, 8],
  ])('tupletSpecFor_%s連符_分母は%s', (numerator, denominator) => {
    // UT-EDIT-VALID-18 4.3 節「3 連符（3:2）・5 連符（5:4）」・「分母は分子より小さい 2 の累乗のうち一番大きいもの（6 なら 4、7 なら 4、9 なら 8）」
    //   ・「ただし 2 と 4 は分母を 3 とする（2:3・4:3」
    expect(tupletSpecFor(numerator)).toEqual({ numerator, denominator });
  });

  it('tupletSpecFor_コアの公開の入口_同じ関数を出し2桁のフレットの窓は出さない', async () => {
    // UT-EDIT-VALID-20 4.3 節の宣言「任意の連符の組を作る…画面の音価のパレットが「任意」の欄の数から BeatDurationSpec を作るときに使い、index.ts から出す」
    const core = await import('../index');
    expect(core.tupletSpecFor).toBe(tupletSpecFor);
    expect('TWO_DIGIT_FRET_WINDOW_MS' in core).toBe(false);
  });

  it.each([
    [3, 3],
    [3, 1],
    [2, 1],
    [4, 2],
    [5, 2],
    [9, 4],
    [12, 16],
  ])('ValidationService_%s連符の分母が%s_EDIT016を返す', (numerator, denominator) => {
    // UT-EDIT-VALID-19 4.3 節「連符は、なし・3 連符（3:2）・5 連符（5:4）・任意…の 4 つとする」・00_reference.md 5 節「分母は分子から決まる」
    const result = svc.validateBeatDuration({
      duration: model.Duration.Quarter,
      dots: 0,
      tuplet: { numerator, denominator },
    });
    expect(result).toEqual({ ok: false, code: 'EDIT-016', context: { tupletNumerator: numerator } });
  });

  // C2（web-core-foundation.md 14.3 節）：ValidationService.ts 231〜232 行の `||`（何連符かが 2 から 12 の整数でないか ×
  // 分母が分子から決まる値でないか）に、973 行の「付点の数 × 連符の分子と分母」のとおり 223 行の付点の数を掛ける。
  // 分子の側は isIntegerIn の 3 つ（整数か × 下限以上か × 上限以下か）に開いて数える。付点が 0・1・2 でなければ連符によらず EDIT-012、
  // 付点が通って、分子の 3 つと分母が合うことの 4 つが全部真なら通し、そうでなければ EDIT-016。下限の下で上限の上の分子は作れないので外す
  // UT-EDIT-VALID-26 web-core-foundation.md 14.3 節の C2（ValidationService.ts 223 行・231〜232 行）・editing-core.md 4.3 節の SetBeatDurationCommand <!-- req webcorefoundation:cb2190fd.d52a --> <!-- req webcorefoundation:cb2190fd.9ac0 --> <!-- req webcorefoundation:cb2190fd.34f7 --> <!-- req webcorefoundation:cb2190fd.f716 -->
  it.each(
    allCombinations(['dotsAllowed', 'isInteger', 'atLeastMin', 'atMostMax', 'denominatorMatches'] as const).filter(
      isPossibleIntegerIn,
    ),
  )(
    'validateBeatDuration_C2_dotsAllowed=$dotsAllowed, isInteger=$isInteger, atLeastMin=$atLeastMin, atMostMax=$atMostMax, denominatorMatches=$denominatorMatches',
    (row) => {
      const dots = row.dotsAllowed ? 1 : 3;
      const numerator = valueForIntegerIn(row, 1, 6, 13);
      // 合わないときは、分子から決まる値（tupletSpecFor、4.3 節）に 1 を足した値にする
      const denominator = tupletSpecFor(numerator).denominator + (row.denominatorMatches ? 0 : 1);
      const result = svc.validateBeatDuration({
        duration: model.Duration.Quarter,
        dots: dots as BeatDurationSpec['dots'],
        tuplet: { numerator, denominator },
      });
      const tupletOk = row.isInteger && row.atLeastMin && row.atMostMax && row.denominatorMatches;
      if (!row.dotsAllowed) expect(result).toEqual({ ok: false, code: 'EDIT-012', context: { dots } });
      else if (tupletOk) expect(result).toEqual({ ok: true });
      else expect(result).toEqual({ ok: false, code: 'EDIT-016', context: { tupletNumerator: numerator } });
    },
  );
});
