// UT-EDIT-MEMO: editing-core.md §6.4、02_data_model.md §3.6 — Add/Edit/DeleteMemoCommand
// 検証観点: 追加/編集/削除と undo の対称性、affectedTrackIndices は空、削除は元位置へ戻る（C2）。

import { describe, expect, it } from 'vitest';

import { AddMemoCommand, DeleteMemoCommand, EditMemoCommand, memosForBar } from './memoCommands';
import { buildEditTarget, appMetaJson } from '../../testing/editingFakes';

const fixedNow = (): Date => new Date('2026-09-08T00:00:00.000Z');

describe('AddMemoCommand', () => {
  it('add_AppendsMemoWithBarRef_UndoRemoves', () => {
    const target = buildEditTarget();
    const before = appMetaJson(target);

    const cmd = new AddMemoCommand(target, 2, 'イントロのリフ', fixedNow);
    cmd.execute();
    expect(target.appMeta.memos).toHaveLength(1);
    expect(memosForBar(target.appMeta, 2)[0]!.text).toBe('イントロのリフ');
    expect([...cmd.affectedTrackIndices]).toEqual([]);

    cmd.undo();
    expect(target.appMeta.memos).toHaveLength(0);
    expect(appMetaJson(target)).toBe(before);
  });
});

describe('EditMemoCommand', () => {
  it('edit_ChangesText_UndoRestores', () => {
    const target = buildEditTarget();
    const add = new AddMemoCommand(target, 0, 'v1', fixedNow);
    add.execute();
    const memoId = target.appMeta.memos[0]!.id;
    const afterAdd = appMetaJson(target);

    const edit = new EditMemoCommand(target, memoId, 'v2');
    edit.execute();
    expect(target.appMeta.memos[0]!.text).toBe('v2');
    edit.undo();
    expect(appMetaJson(target)).toBe(afterAdd);
  });

  it('edit_UnknownId_IsNoOp', () => {
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
    const target = buildEditTarget();
    new AddMemoCommand(target, 0, 'a', fixedNow).execute();
    new AddMemoCommand(target, 1, 'b', fixedNow).execute();
    new AddMemoCommand(target, 2, 'c', fixedNow).execute();
    const afterAdds = appMetaJson(target);
    const midId = target.appMeta.memos[1]!.id;

    const del = new DeleteMemoCommand(target, midId);
    del.execute();
    expect(target.appMeta.memos.map((m) => m.text)).toEqual(['a', 'c']);

    del.undo();
    expect(target.appMeta.memos.map((m) => m.text)).toEqual(['a', 'b', 'c']);
    expect(appMetaJson(target)).toBe(afterAdds);
  });
});
