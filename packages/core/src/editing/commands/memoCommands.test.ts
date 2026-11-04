// UT-EDIT-MEMO: Add/Edit/DeleteMemoCommand（小節メモを足す・変える・消す）
// 検証節: editing-core.md 2.6 節の表・3.10 節、基本設計 02 章 3.6 節
// 検証観点（C2）: 足す／変える／消すと undo の対称性、affectedTrackIndices は無し（[]）、消したメモは元の位置へ戻る、
//               メモが無いときと実行の前の取り消しは何も変えない。

import { describe, expect, it } from 'vitest';

import { AddMemoCommand, DeleteMemoCommand, EditMemoCommand, memosForBar } from './memoCommands';
import { buildEditTarget, appMetaJson } from '../../testing/editingFakes';

const fixedNow = (): Date => new Date('2026-09-08T00:00:00.000Z');

// <!-- req editingcore:dc08ff11.9e08 -->
describe('AddMemoCommand', () => {
  it('add_AppendsMemoWithBarRef_UndoRemoves', () => {
    // UT-EDIT-MEMO-01 2.6 節の表「AddMemoCommand が小節メモを足す」「小節メモのコマンドの描き直しの範囲は無し（[]）」
    const target = buildEditTarget();
    const before = appMetaJson(target);

    const cmd = new AddMemoCommand(target, 2, 'イントロのリフ', fixedNow);
    cmd.execute();
    expect(target.appMeta.memos).toHaveLength(1);
    expect(memosForBar(target.appMeta, 2)[0]!.text).toBe('イントロのリフ');
    expect(target.appMeta.memos[0]!.createdAt).toBe('2026-09-08T00:00:00.000Z');
    expect([...cmd.affectedTrackIndices]).toEqual([]);
    expect(cmd.kind).toBe('add-memo');
    expect(cmd.label).toBe('add-memo');

    cmd.undo();
    expect(target.appMeta.memos).toHaveLength(0);
    expect(appMetaJson(target)).toBe(before);
  });

  it('AddMemoCommand_時計を渡さない_今の時刻で作る', () => {
    // UT-EDIT-MEMO-04 2.6 節（第 4 引数 now は省ける）
    const target = buildEditTarget();
    new AddMemoCommand(target, 0, 'x').execute();
    expect(Number.isNaN(Date.parse(target.appMeta.memos[0]!.createdAt))).toBe(false);
  });

  it('AddMemoCommand_実行の前の取り消し_何も変えない', () => {
    // UT-EDIT-MEMO-05 2.2 節（undo は execute の変更を打ち消すだけ）
    const target = buildEditTarget();
    new AddMemoCommand(target, 0, 'keep', fixedNow).execute();
    const before = appMetaJson(target);
    new AddMemoCommand(target, 0, 'never', fixedNow).undo();
    expect(appMetaJson(target)).toBe(before);
  });
});

describe('EditMemoCommand', () => {
  it('edit_ChangesText_UndoRestores', () => {
    // UT-EDIT-MEMO-02 2.6 節の表「EditMemoCommand が小節メモを編集する」
    const target = buildEditTarget();
    const add = new AddMemoCommand(target, 0, 'v1', fixedNow);
    add.execute();
    const memoId = target.appMeta.memos[0]!.id;
    const afterAdd = appMetaJson(target);

    const edit = new EditMemoCommand(target, memoId, 'v2');
    expect([...edit.affectedTrackIndices]).toEqual([]);
    expect(edit.estimateSizeBytes()).toBeGreaterThan(0);
    edit.execute();
    expect(target.appMeta.memos[0]!.text).toBe('v2');
    edit.undo();
    expect(appMetaJson(target)).toBe(afterAdd);
  });

  it('edit_UnknownId_IsNoOp', () => {
    // UT-EDIT-MEMO-06 3.10 節（無いメモは変えない）
    const target = buildEditTarget();
    const before = appMetaJson(target);
    const edit = new EditMemoCommand(target, 'nope', 'x');
    edit.execute();
    edit.undo();
    expect(appMetaJson(target)).toBe(before);
  });
});

describe('DeleteMemoCommand', () => {
  it('delete_RemovesMemo_UndoRestoresAtSameIndex', () => {
    // UT-EDIT-MEMO-03 2.6 節の表「DeleteMemoCommand が小節メモを消す」
    const target = buildEditTarget();
    new AddMemoCommand(target, 0, 'a', fixedNow).execute();
    new AddMemoCommand(target, 1, 'b', fixedNow).execute();
    new AddMemoCommand(target, 2, 'c', fixedNow).execute();
    const afterAdds = appMetaJson(target);
    const midId = target.appMeta.memos[1]!.id;

    const del = new DeleteMemoCommand(target, midId);
    expect([...del.affectedTrackIndices]).toEqual([]);
    expect(del.estimateSizeBytes()).toBeGreaterThan(0);
    del.execute();
    expect(target.appMeta.memos.map((m) => m.text)).toEqual(['a', 'c']);

    del.undo();
    expect(target.appMeta.memos.map((m) => m.text)).toEqual(['a', 'b', 'c']);
    expect(appMetaJson(target)).toBe(afterAdds);
  });

  it('DeleteMemoCommand_無いメモ_何も変えず取り消しも何もしない', () => {
    // UT-EDIT-MEMO-07 3.10 節（無いメモは消さない）
    const target = buildEditTarget();
    new AddMemoCommand(target, 0, 'a', fixedNow).execute();
    const before = appMetaJson(target);
    const del = new DeleteMemoCommand(target, 'nope');
    del.execute();
    del.undo();
    expect(appMetaJson(target)).toBe(before);
  });
});
