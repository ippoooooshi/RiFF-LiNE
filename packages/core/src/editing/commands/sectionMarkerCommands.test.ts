// UT-EDIT-SECTION: Add/Edit/DeleteSectionMarkerCommand（セクションマーカーを足す・変える・消す）
// 検証節: editing-core.md 2.6 節の表・3.10 節・10 節、基本設計 02 章 3.5 節
// 検証観点（C2）: appMeta.sectionMarkers と写しの MasterBar.section の両方を変えて戻す、affectedTrackIndices は全部のパート、
//               作るときの確かめ（小節の範囲・1 小節に 1 つ・マーカーの有無）で RangeError、実行の前の取り消しは何も変えない。

import { describe, expect, it } from 'vitest';

import { InsertBarCommand } from './barCommands';
import { AddSectionMarkerCommand, DeleteSectionMarkerCommand, EditSectionMarkerCommand } from './sectionMarkerCommands';
import { getMasterBar } from '../scoreModel';
import { allCombinations } from '../../testing/combinations';
import { buildEditTarget, appMetaJson, scoreJson } from '../../testing/editingFakes';

describe('AddSectionMarkerCommand', () => {
  it('add_SetsMarkerAndMirrorsToMasterBar_UndoRestoresBoth', () => {
    // UT-EDIT-SECTION-01 2.6 節の表「AddSectionMarkerCommand がセクションマーカーを足す」・3.10 節（写しの MasterBar.section）
    const target = buildEditTarget(2);
    const beforeMeta = appMetaJson(target);
    const beforeScore = scoreJson(target);

    const cmd = new AddSectionMarkerCommand(target, 0, 'サビ');
    expect(cmd.kind).toBe('add-section-marker');
    expect(cmd.label).toBe('add-section-marker');
    expect(cmd.estimateSizeBytes()).toBeGreaterThan(0);
    cmd.execute();
    expect(target.appMeta.sectionMarkers[0]!.label).toBe('サビ');
    expect(target.appMeta.sectionMarkers[0]!.barId).toBe('0');
    expect(getMasterBar(target.score, 0).section?.text).toBe('サビ');
    // 10 節「3 つのマーカーのコマンドの affectedTrackIndices は全部のパート」
    expect([...cmd.affectedTrackIndices]).toEqual([0, 1]);

    cmd.undo();
    expect(target.appMeta.sectionMarkers).toHaveLength(0);
    expect(getMasterBar(target.score, 0).section).toBeNull();
    expect(appMetaJson(target)).toBe(beforeMeta);
    expect(scoreJson(target)).toBe(beforeScore);
  });

  it.each([-1, 1, 0.5])('AddSectionMarkerCommand_小節の範囲の外(%s)_RangeErrorを投げる', (barIndex) => {
    // UT-EDIT-SECTION-04 10 節の (b)「barIndex が曲の小節の範囲の中にあることを確かめ、外なら RangeError」
    const target = buildEditTarget();
    expect(() => new AddSectionMarkerCommand(target, barIndex, 'A')).toThrow(RangeError);
  });

  it('AddSectionMarkerCommand_同じ小節にマーカーがある_RangeErrorを投げる', () => {
    // UT-EDIT-SECTION-05 10 節「1 つの小節に置けるマーカーは 1 つ」「同じ小節にマーカーが無いことを確かめ、あれば RangeError」
    const target = buildEditTarget();
    new InsertBarCommand(target, 1).execute();
    new AddSectionMarkerCommand(target, 0, 'A').execute();
    expect(() => new AddSectionMarkerCommand(target, 0, 'B')).toThrow(RangeError);
    expect(() => new AddSectionMarkerCommand(target, 1, 'B')).not.toThrow();
  });

  // UT-EDIT-SECTION-11 web-core-foundation.md 14.3 節 C2：sectionMarkerCommands.ts:58 の小節の範囲の確かめの 3 つの || の条件
  // （整数でないか・0 より小さいか・小節の数以上か）。RangeError にするのはどれかが真のとき。0 より小さく小節の数以上の値は作れないので外す
  it.each(
    allCombinations(['notInteger', 'negative', 'tooLarge'] as const).filter((row) => !(row.negative && row.tooLarge)),
  )(
    'AddSectionMarkerCommand_小節の範囲のC2_notInteger=$notInteger, negative=$negative, tooLarge=$tooLarge',
    ({ notInteger, negative, tooLarge }) => {
      // UT-EDIT-SECTION-11 10 節の (b)「barIndex が曲の小節の範囲の中にあることを確かめ、外なら RangeError」
      const target = buildEditTarget();
      new InsertBarCommand(target, 1).execute(); // 2 小節
      const whole = negative ? -1 : tooLarge ? 2 : 1;
      const barIndex = notInteger ? whole + 0.5 * Math.sign(whole) : whole;
      const create = (): AddSectionMarkerCommand => new AddSectionMarkerCommand(target, barIndex, 'A');
      if (notInteger || negative || tooLarge) expect(create).toThrow(RangeError);
      else expect(create).not.toThrow();
    },
  );

  it('AddSectionMarkerCommand_実行の前の取り消し_何も変えない', () => {
    // UT-EDIT-SECTION-06 2.2 節（undo は execute の変更を打ち消すだけ）
    const target = buildEditTarget();
    const cmd = new AddSectionMarkerCommand(target, 0, 'A');
    const before = { meta: appMetaJson(target), score: scoreJson(target) };
    cmd.undo();
    expect(appMetaJson(target)).toBe(before.meta);
    expect(scoreJson(target)).toBe(before.score);
  });
});

describe('EditSectionMarkerCommand', () => {
  it('edit_ChangesLabelAndMirror_UndoRestores', () => {
    // UT-EDIT-SECTION-02 2.6 節の表「EditSectionMarkerCommand がセクションマーカーを編集する」
    const target = buildEditTarget();
    const add = new AddSectionMarkerCommand(target, 0, 'A');
    add.execute();
    const afterAdd = { meta: appMetaJson(target), score: scoreJson(target) };
    const id = target.appMeta.sectionMarkers[0]!.id;

    const edit = new EditSectionMarkerCommand(target, id, 'Aメロ');
    expect([...edit.affectedTrackIndices]).toEqual([0]);
    expect(edit.estimateSizeBytes()).toBeGreaterThan(0);
    edit.execute();
    expect(target.appMeta.sectionMarkers[0]!.label).toBe('Aメロ');
    expect(getMasterBar(target.score, 0).section?.text).toBe('Aメロ');
    edit.undo();
    expect(getMasterBar(target.score, 0).section?.text).toBe('A');
    expect(scoreJson(target)).toBe(afterAdd.score);
    expect(appMetaJson(target)).toBe(afterAdd.meta);
  });

  it('EditSectionMarkerCommand_無いマーカー_RangeErrorを投げる', () => {
    // UT-EDIT-SECTION-07 10 節の (b)「markerId のマーカーが無ければ RangeError」
    const target = buildEditTarget();
    expect(() => new EditSectionMarkerCommand(target, 'nope', 'x')).toThrow(RangeError);
  });

  it('EditSectionMarkerCommand_実行の前の取り消し_何も変えない', () => {
    // UT-EDIT-SECTION-08 2.2 節（undo は execute の変更を打ち消すだけ）
    const target = buildEditTarget();
    new AddSectionMarkerCommand(target, 0, 'A').execute();
    const before = appMetaJson(target);
    new EditSectionMarkerCommand(target, target.appMeta.sectionMarkers[0]!.id, 'B').undo();
    expect(appMetaJson(target)).toBe(before);
  });
});

describe('DeleteSectionMarkerCommand', () => {
  it('delete_RemovesMarkerAndMirror_UndoRestoresAtIndex', () => {
    // UT-EDIT-SECTION-03 2.6 節の表「DeleteSectionMarkerCommand がセクションマーカーを消す」
    const target = buildEditTarget();
    new InsertBarCommand(target, 1).execute();
    new AddSectionMarkerCommand(target, 0, 'A').execute();
    new AddSectionMarkerCommand(target, 1, 'B').execute();
    const afterAdd = { meta: appMetaJson(target), score: scoreJson(target) };
    const id = target.appMeta.sectionMarkers[0]!.id;

    const del = new DeleteSectionMarkerCommand(target, id);
    expect([...del.affectedTrackIndices]).toEqual([0]);
    expect(del.estimateSizeBytes()).toBeGreaterThan(0);
    del.execute();
    expect(target.appMeta.sectionMarkers.map((m) => m.label)).toEqual(['B']);
    expect(getMasterBar(target.score, 0).section).toBeNull();

    del.undo();
    expect(appMetaJson(target)).toBe(afterAdd.meta);
    expect(scoreJson(target)).toBe(afterAdd.score);
  });

  it('DeleteSectionMarkerCommand_無いマーカー_RangeErrorを投げる', () => {
    // UT-EDIT-SECTION-09 10 節の (b)「markerId のマーカーが無ければ RangeError」
    const target = buildEditTarget();
    expect(() => new DeleteSectionMarkerCommand(target, 'nope')).toThrow(RangeError);
  });

  it('DeleteSectionMarkerCommand_実行の前の取り消し_何も変えない', () => {
    // UT-EDIT-SECTION-10 2.2 節（undo は execute の変更を打ち消すだけ）
    const target = buildEditTarget();
    new AddSectionMarkerCommand(target, 0, 'A').execute();
    const before = appMetaJson(target);
    new DeleteSectionMarkerCommand(target, target.appMeta.sectionMarkers[0]!.id).undo();
    expect(appMetaJson(target)).toBe(before);
  });
});
