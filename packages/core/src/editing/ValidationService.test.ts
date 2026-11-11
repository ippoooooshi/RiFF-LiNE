// UT-EDIT-VALID: editing-core.md 5 節、基本設計 04 章 4 節・11 節 — ValidationService
// 検証観点（C2）: フレット範囲（境界 0/24/-1/25）と確かめの順、重複配置と context、小節数・パート数の上限、メモ切り詰め、
// 拍子の範囲、リピートの回数と対応する開始、付点と連符の範囲。

// <!-- req editingcore:d64211e4.95b3 -->
// <!-- req editingcore:d64211e4.3011 -->
import { describe, expect, it } from 'vitest';

import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { tupletSpecFor, type BeatDurationSpec, type CursorPosition } from './types';
import { ValidationService } from './ValidationService';
import { buildEditTarget } from '../testing/editingFakes';
import { model } from '@coderline/alphatab';

const svc = new ValidationService();
const pos: CursorPosition = { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };

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
    // UT-EDIT-VALID-05 5 節の表「足した後のパートの数が 8 を超える」「EDIT-005」・(b)「ValidationService に validatePartCount として置き」
    expect(svc.validatePartCount(buildEditTarget(7)).ok).toBe(true);
    expect(svc.validatePartCount(buildEditTarget(8))).toMatchObject({
      ok: false,
      code: 'EDIT-005',
      context: { current: 8, max: 8 },
    });
  });

  it('ValidationService_1パートの曲_パートを足せる', () => {
    // UT-EDIT-VALID-16 5 節の表「足した後のパートの数が 8 を超える」の内側（parts の PartValidationService から移した）
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
});
