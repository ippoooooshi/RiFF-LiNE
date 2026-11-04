// UT-EDIT-TIMESIG: SetTimeSignatureCommand（拍子を変える・継ぐ状態へ戻す・一覧の書き換えと取り消し）
// 検証節: editing-core.md 2.6 節の表・3.2 節・10 節
// 検証観点（C2）: 値を入れる／null で戻す／1 小節目に null の 3 つの分かれ道と、undo の対称性・一覧の並び・継いでいる小節のそろえ方。

import { describe, expect, it } from 'vitest';

import { InsertBarCommand } from './barCommands';
import { SetTimeSignatureCommand } from './SetTimeSignatureCommand';
import { getMasterBar } from '../scoreModel';
import type { EditTarget } from '../types';
import { appMetaJson, buildEditTarget, scoreJson } from '../../testing/editingFakes';

/** N 小節・partCount パートの target（足した小節は 1 小節目の拍子を継ぐ）。 */
function barsTarget(bars: number, partCount = 1): EditTarget {
  const target = buildEditTarget(partCount);
  for (let i = 1; i < bars; i++) new InsertBarCommand(target, i).execute();
  return target;
}

function signatureOf(target: EditTarget, barIndex: number): [number, number] {
  const masterBar = getMasterBar(target.score, barIndex);
  return [masterBar.timeSignatureNumerator, masterBar.timeSignatureDenominator];
}

describe('SetTimeSignatureCommand', () => {
  it('SetTimeSignatureCommand_値を入れる_一覧に足して後ろの継いでいる小節もそろい取り消しで戻る', () => {
    // UT-EDIT-TIMESIG-01 3.2 節「値を入れたら一覧に足す」・10 節「undo は前の値と継ぐ印を戻す」
    const target = barsTarget(4);
    const beforeScore = scoreJson(target);
    const beforeMeta = appMetaJson(target);

    const cmd = new SetTimeSignatureCommand(target, 1, { numerator: 3, denominator: 4 });
    expect(cmd.kind).toBe('set-time-signature');
    expect(cmd.label).toBe('set-time-signature');
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 1]);
    expect(signatureOf(target, 0)).toEqual([4, 4]);
    expect(signatureOf(target, 1)).toEqual([3, 4]);
    // 一覧に無い小節は直前の小節の拍子を継ぐ（MasterBar にも同じ値を置く）
    expect(signatureOf(target, 2)).toEqual([3, 4]);
    expect(signatureOf(target, 3)).toEqual([3, 4]);

    cmd.undo();
    expect(scoreJson(target)).toBe(beforeScore);
    expect(appMetaJson(target)).toBe(beforeMeta);
  });

  it('SetTimeSignatureCommand_nullを渡す_一覧から外して直前を継ぎ取り消しで戻る', () => {
    // UT-EDIT-TIMESIG-02 3.2 節「null で継ぐ状態へ戻したら一覧から外す」、10 節「SetTempoCommand と対称」
    const target = barsTarget(3);
    new SetTimeSignatureCommand(target, 1, { numerator: 6, denominator: 8 }).execute();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new SetTimeSignatureCommand(target, 1, null);
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect(signatureOf(target, 1)).toEqual([4, 4]);
    expect(signatureOf(target, 2)).toEqual([4, 4]);

    cmd.undo();
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
  });

  it('SetTimeSignatureCommand_1小節目にnull_継ぐ先が無いので一覧から外さない', () => {
    // UT-EDIT-TIMESIG-03 3.2 節「1 小節目は継ぐ先が無いので、いつも一覧に入れる」
    const target = barsTarget(2);
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new SetTimeSignatureCommand(target, 0, null);
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect(scoreJson(target)).toBe(before.score);

    cmd.undo();
    expect(appMetaJson(target)).toBe(before.meta);
  });

  it('SetTimeSignatureCommand_後ろの小節から入れる_書き換えた後の一覧は小さい順', () => {
    // UT-EDIT-TIMESIG-04 3.2 節「書き換えた後の一覧を小さい順に並べた形にする」
    const target = barsTarget(5);
    new SetTimeSignatureCommand(target, 3, { numerator: 5, denominator: 4 }).execute();
    new SetTimeSignatureCommand(target, 1, { numerator: 2, denominator: 4 }).execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 1, 3]);
    expect(signatureOf(target, 2)).toEqual([2, 4]);
    expect(signatureOf(target, 4)).toEqual([5, 4]);
  });

  it('SetTimeSignatureCommand_はっきり入れた小節の値を変える_一覧は重ならない', () => {
    // UT-EDIT-TIMESIG-05 3.2 節（一覧に既にある小節へ値を入れ直しても 1 つのまま）
    const target = barsTarget(2);
    const cmd = new SetTimeSignatureCommand(target, 0, { numerator: 7, denominator: 8 });
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect(signatureOf(target, 1)).toEqual([7, 8]);
  });

  it('SetTimeSignatureCommand_取り消しからやり直す_同じ結果になる', () => {
    // UT-EDIT-TIMESIG-06 2.3 節「execute と undo の対称性」（redo は execute を呼び直す）
    const target = barsTarget(3);
    const cmd = new SetTimeSignatureCommand(target, 2, { numerator: 3, denominator: 8 });
    cmd.execute();
    const after = { score: scoreJson(target), meta: appMetaJson(target) };
    cmd.undo();
    cmd.execute();
    expect(scoreJson(target)).toBe(after.score);
    expect(appMetaJson(target)).toBe(after.meta);
  });

  it('SetTimeSignatureCommand_実行の前の取り消し_何も変えない', () => {
    // UT-EDIT-TIMESIG-07 2.2 節（undo は execute の変更を打ち消すだけ）
    const target = barsTarget(2);
    const before = { score: scoreJson(target), meta: appMetaJson(target) };
    new SetTimeSignatureCommand(target, 1, { numerator: 3, denominator: 4 }).undo();
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
  });

  it('SetTimeSignatureCommand_変更が及ぶパート_全部のパート', () => {
    // UT-EDIT-TIMESIG-08 2.6 節の表「SetTimeSignatureCommand の範囲は全部のパート」
    const target = buildEditTarget(3);
    const cmd = new SetTimeSignatureCommand(target, 0, { numerator: 3, denominator: 4 });
    expect([...cmd.affectedTrackIndices]).toEqual([0, 1, 2]);
    expect(cmd.estimateSizeBytes()).toBeGreaterThan(0);
  });
});
