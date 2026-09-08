// UT-EDIT-BAR: editing-core.md §6.4・§10.3、04_editing_core.md §10、B2・B5 — Insert/DeleteBarCommand
// 検証観点（C2）:
//  - 全パート同期挿入/削除、全パート再採番、undo で Score・AppMetadata が完全復元
//  - B5: 挿入 Bar の tempoAutomations は空（継承）、time signature は直前を継承
//  - B2: 削除時の関連メモ/マーカーを delete / move-to-previous で処理、undo で復元
//  - メモ/マーカーの barId シフト

import { describe, expect, it } from 'vitest';

import { DeleteBarCommand, InsertBarCommand } from './barCommands';
import { AddMemoCommand } from './memoCommands';
import { AddSectionMarkerCommand } from './sectionMarkerCommands';
import { SetTempoCommand } from './SetTempoCommand';
import { barCount, getMasterBar, getStaff } from '../scoreModel';
import { buildEditTarget, appMetaJson, scoreJson } from '../../testing/editingFakes';

const fixedNow = (): Date => new Date('2026-09-08T00:00:00.000Z');

/** N 小節の 2 パート target（各小節に順番のテンポを付けて識別可能にする）。 */
function multiBarTarget(bars: number): ReturnType<typeof buildEditTarget> {
  const target = buildEditTarget(2);
  for (let i = 1; i < bars; i++) new InsertBarCommand(target, i).execute();
  for (let i = 0; i < bars; i++) new SetTempoCommand(target, i, 100 + i).execute();
  return target;
}

describe('InsertBarCommand', () => {
  it('insert_AddsBarToAllStaves_AndMasterBar_UndoRestores', () => {
    const target = buildEditTarget(2);
    const before = scoreJson(target);
    expect(barCount(target.score)).toBe(1);

    const cmd = new InsertBarCommand(target, 1);
    cmd.execute();
    expect(barCount(target.score)).toBe(2);
    expect(getStaff(target.score, 0).bars).toHaveLength(2);
    expect(getStaff(target.score, 1).bars).toHaveLength(2);
    expect([...cmd.affectedTrackIndices]).toEqual([0, 1]);

    cmd.undo();
    expect(barCount(target.score)).toBe(1);
    expect(scoreJson(target)).toBe(before);
  });

  it('insert_NewBar_InheritsTempoEmpty_AndTimeSignatureFromPrev', () => {
    const target = multiBarTarget(2); // bars 0,1 with tempo 100,101
    const cmd = new InsertBarCommand(target, 1); // between bar 0 and old bar 1
    cmd.execute();

    const inserted = getMasterBar(target.score, 1);
    expect(inserted.tempoAutomations).toHaveLength(0); // B5: 継承
    expect(inserted.timeSignatureNumerator).toBe(getMasterBar(target.score, 0).timeSignatureNumerator);
  });

  it('insert_ShiftsMemoAndMarkerBarRefs_UndoUnshifts', () => {
    const target = multiBarTarget(3);
    new AddMemoCommand(target, 2, 'bar2 memo', fixedNow).execute();
    new AddSectionMarkerCommand(target, 2, 'bar2 sec').execute();
    const before = appMetaJson(target);

    const cmd = new InsertBarCommand(target, 1);
    cmd.execute();
    expect(target.appMeta.memos[0]!.barId).toBe('3'); // 2 -> 3
    expect(target.appMeta.sectionMarkers[0]!.barId).toBe('3');

    cmd.undo();
    expect(appMetaJson(target)).toBe(before);
  });
});

describe('DeleteBarCommand', () => {
  it('delete_RemovesFromAllStaves_Renumbers_UndoRestores', () => {
    const target = multiBarTarget(3);
    const before = scoreJson(target);

    const cmd = new DeleteBarCommand(target, 1, 'delete');
    cmd.execute();
    expect(barCount(target.score)).toBe(2);
    // 旧 bar2（tempo 102）が新 bar1 へ詰まる
    expect(getMasterBar(target.score, 1).tempoAutomations[0]!.value).toBe(102);

    cmd.undo();
    expect(barCount(target.score)).toBe(3);
    expect(scoreJson(target)).toBe(before);
  });

  it('delete_MoveToPrevious_ReassignsAttachedMemoToPrevBar_UndoRestores', () => {
    const target = multiBarTarget(3);
    new AddMemoCommand(target, 1, 'bar1 memo', fixedNow).execute();
    new AddSectionMarkerCommand(target, 1, 'bar1 sec').execute();
    const before = appMetaJson(target);

    const cmd = new DeleteBarCommand(target, 1, 'move-to-previous');
    cmd.execute();
    expect(target.appMeta.memos[0]!.barId).toBe('0'); // bar1 -> bar0
    expect(target.appMeta.sectionMarkers[0]!.barId).toBe('0');

    cmd.undo();
    expect(appMetaJson(target)).toBe(before);
  });

  it('delete_DeleteDisposition_RemovesAttachedMemo_UndoRestores', () => {
    const target = multiBarTarget(3);
    new AddMemoCommand(target, 1, 'doomed', fixedNow).execute();
    new AddMemoCommand(target, 2, 'survivor', fixedNow).execute();
    const before = appMetaJson(target);

    const cmd = new DeleteBarCommand(target, 1, 'delete');
    cmd.execute();
    expect(target.appMeta.memos.map((m) => m.text)).toEqual(['survivor']);
    expect(target.appMeta.memos[0]!.barId).toBe('1'); // bar2 -> bar1

    cmd.undo();
    expect(appMetaJson(target)).toBe(before);
  });
});
