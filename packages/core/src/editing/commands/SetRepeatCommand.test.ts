// UT-EDIT-REPEAT: SetRepeatCommand（リピートの開始と終わりの回数を付ける・外す）
// 検証節: editing-core.md 2.6 節の表・3.10 節・10 節
// 検証観点（C2）: patch のキーの有無（isRepeatStart だけ・repeatCount だけ・両方）と、undo が指定したキーの前の値だけを戻すこと。 <!-- req webcorefoundation:33b2c87c.f6af -->

import { describe, expect, it } from 'vitest';

import { InsertBarCommand } from './barCommands';
import { SetRepeatCommand } from './SetRepeatCommand';
import { getMasterBar } from '../scoreModel';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';

describe('SetRepeatCommand', () => {
  it('SetRepeatCommand_開始を付ける_isRepeatStartだけを変え取り消しで戻る', () => {
    // UT-EDIT-REPEAT-01 10 節「開始を付けるのは { isRepeatStart: true }」「指定したキーだけを変える」
    const target = buildEditTarget();
    const before = scoreJson(target);
    const cmd = new SetRepeatCommand(target, 0, { isRepeatStart: true });
    expect(cmd.kind).toBe('set-repeat');
    expect(cmd.label).toBe('set-repeat');

    cmd.execute();
    expect(getMasterBar(target.score, 0).isRepeatStart).toBe(true);
    expect(getMasterBar(target.score, 0).repeatCount).toBe(0);

    cmd.undo();
    expect(getMasterBar(target.score, 0).isRepeatStart).toBe(false);
    expect(scoreJson(target)).toBe(before);
  });

  it('SetRepeatCommand_終わりの回数を付ける_repeatCountだけを変え取り消しで戻る', () => {
    // UT-EDIT-REPEAT-02 10 節「終わりの回数を付けるか変えるのは { repeatCount: n }」
    const target = buildEditTarget();
    new SetRepeatCommand(target, 0, { isRepeatStart: true }).execute();
    const before = scoreJson(target);

    const cmd = new SetRepeatCommand(target, 0, { repeatCount: 3 });
    cmd.execute();
    expect(getMasterBar(target.score, 0).repeatCount).toBe(3);
    expect(getMasterBar(target.score, 0).isRepeatStart).toBe(true);

    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetRepeatCommand_両方のキーを外す_2つとも前の値へ戻る', () => {
    // UT-EDIT-REPEAT-03 10 節「外すのは { isRepeatStart: false }・{ repeatCount: 0 }」「undo は patch で指定したキーの前の値を戻す」
    const target = buildEditTarget();
    new SetRepeatCommand(target, 0, { isRepeatStart: true, repeatCount: 2 }).execute();
    const before = scoreJson(target);

    const cmd = new SetRepeatCommand(target, 0, { isRepeatStart: false, repeatCount: 0 });
    cmd.execute();
    expect(getMasterBar(target.score, 0).isRepeatStart).toBe(false);
    expect(getMasterBar(target.score, 0).repeatCount).toBe(0);

    cmd.undo();
    expect(scoreJson(target)).toBe(before);
    // やり直すと同じ結果
    cmd.execute();
    expect(getMasterBar(target.score, 0).repeatCount).toBe(0);
  });

  it('SetRepeatCommand_開始と終わりを付ける_alphaTabのリピートのまとまりを組み直す', () => {
    // UT-EDIT-REPEAT-04 3.10 節（リピートは MasterBar.isRepeatStart・repeatCount で持ち、譜面と再生が読むまとまりを合わせる）
    const target = buildEditTarget();
    new InsertBarCommand(target, 1).execute();
    new SetRepeatCommand(target, 0, { isRepeatStart: true }).execute();
    const end = new SetRepeatCommand(target, 1, { repeatCount: 2 });
    end.execute();
    const group = getMasterBar(target.score, 0).repeatGroup;
    expect(group.masterBars).toEqual([getMasterBar(target.score, 0), getMasterBar(target.score, 1)]);
    expect(group.isClosed).toBe(true);

    end.undo();
    expect(getMasterBar(target.score, 0).repeatGroup.isClosed).toBe(false);
  });

  it('SetRepeatCommand_実行の前の取り消し_何も変えない', () => {
    // UT-EDIT-REPEAT-05 2.2 節（undo は execute の変更を打ち消すだけ）
    const target = buildEditTarget();
    const before = scoreJson(target);
    new SetRepeatCommand(target, 0, { isRepeatStart: true }).undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetRepeatCommand_変更が及ぶパート_全部のパート', () => {
    // UT-EDIT-REPEAT-06 2.6 節の表「SetRepeatCommand の描き直しの範囲は全部のパート」
    const target = buildEditTarget(2);
    const cmd = new SetRepeatCommand(target, 0, {});
    expect([...cmd.affectedTrackIndices]).toEqual([0, 1]);
    expect(cmd.estimateSizeBytes()).toBeGreaterThan(0);
  });
});
