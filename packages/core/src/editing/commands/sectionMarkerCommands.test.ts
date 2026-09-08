// UT-EDIT-SECTION: editing-core.md §6.4、02_data_model.md §3.5 — Add/Edit/DeleteSectionMarkerCommand
// 検証観点: AppMetadata と alphaTab MasterBar.section の両方を設定/復元、affectedTrackIndices は全パート（C2）。

import { describe, expect, it } from 'vitest';

import { AddSectionMarkerCommand, DeleteSectionMarkerCommand, EditSectionMarkerCommand } from './sectionMarkerCommands';
import { getMasterBar } from '../scoreModel';
import { buildEditTarget, appMetaJson, scoreJson } from '../../testing/editingFakes';

describe('AddSectionMarkerCommand', () => {
  it('add_SetsMarkerAndMirrorsToMasterBar_UndoRestoresBoth', () => {
    const target = buildEditTarget();
    const beforeMeta = appMetaJson(target);
    const beforeScore = scoreJson(target);

    const cmd = new AddSectionMarkerCommand(target, 0, 'サビ');
    cmd.execute();
    expect(target.appMeta.sectionMarkers[0]!.label).toBe('サビ');
    expect(getMasterBar(target.score, 0).section?.text).toBe('サビ');
    expect([...cmd.affectedTrackIndices]).toEqual([0]);

    cmd.undo();
    expect(target.appMeta.sectionMarkers).toHaveLength(0);
    expect(getMasterBar(target.score, 0).section).toBeNull();
    expect(appMetaJson(target)).toBe(beforeMeta);
    expect(scoreJson(target)).toBe(beforeScore);
  });
});

describe('EditSectionMarkerCommand', () => {
  it('edit_ChangesLabelAndMirror_UndoRestores', () => {
    const target = buildEditTarget();
    const add = new AddSectionMarkerCommand(target, 0, 'A');
    add.execute();
    const afterAdd = scoreJson(target);
    const id = target.appMeta.sectionMarkers[0]!.id;

    const edit = new EditSectionMarkerCommand(target, id, 'Aメロ');
    edit.execute();
    expect(getMasterBar(target.score, 0).section?.text).toBe('Aメロ');
    edit.undo();
    expect(getMasterBar(target.score, 0).section?.text).toBe('A');
    expect(scoreJson(target)).toBe(afterAdd);
  });
});

describe('DeleteSectionMarkerCommand', () => {
  it('delete_RemovesMarkerAndMirror_UndoRestoresAtIndex', () => {
    const target = buildEditTarget();
    new AddSectionMarkerCommand(target, 0, 'A').execute();
    const afterAdd = { meta: appMetaJson(target), score: scoreJson(target) };
    const id = target.appMeta.sectionMarkers[0]!.id;

    const del = new DeleteSectionMarkerCommand(target, id);
    del.execute();
    expect(target.appMeta.sectionMarkers).toHaveLength(0);
    expect(getMasterBar(target.score, 0).section).toBeNull();

    del.undo();
    expect(appMetaJson(target)).toBe(afterAdd.meta);
    expect(scoreJson(target)).toBe(afterAdd.score);
  });
});
