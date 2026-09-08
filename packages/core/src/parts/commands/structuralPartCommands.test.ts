// UT-PART-STRUCT: part-tuning-management.md §5・§7 — AddPart/RemovePart/ReorderPartsCommand
// 検証観点（C2）: 全パート同期、undo で Score JSON 完全復元、RemovePart のパート全体保持、
//   ReorderParts の順列適用と不完全順列の取りこぼし防止、8パート境界。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { AddPartCommand, RemovePartCommand, ReorderPartsCommand } from './structuralPartCommands';
import { PlaceNoteCommand } from '../../editing/commands/PlaceNoteCommand';
import { createEmptyAppMetadata } from '../../domain/SongDocument';
import { createInitialScore } from '../../domain/newSong';
import type { EditTarget } from '../../editing';
import { scoreJson } from '../../testing/editingFakes';

function multiPart(n: number): EditTarget {
  const parts = Array.from({ length: n }, (_v, i) => ({
    name: `P${i + 1}`,
    instrumentType: 'electric_guitar' as const,
    tuning: [64, 59, 55, 50, 45, 40],
  }));
  return { score: createInitialScore({ title: 'T', parts }), appMeta: createEmptyAppMetadata() };
}

const GUITAR: { name: string; program: number; tuning: number[] } = {
  name: 'New',
  program: 30,
  tuning: [64, 59, 55, 50, 45, 40],
};

describe('AddPartCommand', () => {
  it('add_AppendsTrackWithBarsMatchingMasterBars_UndoRestores', () => {
    const target = multiPart(1);
    // 3小節にしておく
    target.score.addMasterBar(new model.MasterBar());
    target.score.addMasterBar(new model.MasterBar());
    const before = scoreJson(target);

    const cmd = new AddPartCommand(target.score, { ...GUITAR, colorHex: '#059669' });
    cmd.execute();
    expect(target.score.tracks).toHaveLength(2);
    expect(target.score.tracks[1]!.staves[0]!.bars).toHaveLength(3);
    expect(target.score.tracks[1]!.color.r).toBe(0x05);

    cmd.undo();
    expect(target.score.tracks).toHaveLength(1);
    expect(scoreJson(target)).toBe(before);
  });

  it('add_AtSpecificIndex_Inserts', () => {
    const target = multiPart(2);
    const cmd = new AddPartCommand(target.score, GUITAR, 1);
    cmd.execute();
    expect(target.score.tracks).toHaveLength(3);
    expect(target.score.tracks[1]!.name).toBe('New');
    cmd.undo();
    expect(target.score.tracks.map((t) => t.name)).toEqual(['P1', 'P2']);
  });
});

describe('RemovePartCommand', () => {
  it('remove_WithNotes_UndoRestoresEverything', () => {
    const target = multiPart(2);
    new PlaceNoteCommand(target, { trackIndex: 1, barIndex: 0, beatIndex: 0 }, 3, 7, model.Duration.Quarter).execute();
    const before = scoreJson(target);

    const cmd = new RemovePartCommand(target.score, 1);
    cmd.execute();
    expect(target.score.tracks).toHaveLength(1);

    cmd.undo();
    expect(target.score.tracks).toHaveLength(2);
    expect(scoreJson(target)).toBe(before);
  });

  it('estimateSizeBytes_ScalesWithBarCount', () => {
    const target = multiPart(1);
    const small = new RemovePartCommand(target.score, 0).estimateSizeBytes();
    target.score.addMasterBar(new model.MasterBar());
    target.score.tracks[0]!.staves[0]!.addBar(new model.Bar());
    const larger = new RemovePartCommand(target.score, 0).estimateSizeBytes();
    expect(larger).toBeGreaterThan(small);
  });
});

describe('ReorderPartsCommand', () => {
  it('reorder_AppliesPermutation_UndoRestores', () => {
    const target = multiPart(3);
    const before = target.score.tracks.map((t) => t.name);

    const cmd = new ReorderPartsCommand(target.score, [2, 0, 1]);
    cmd.execute();
    expect(target.score.tracks.map((t) => t.name)).toEqual(['P3', 'P1', 'P2']);

    cmd.undo();
    expect(target.score.tracks.map((t) => t.name)).toEqual(before);
  });

  it('reorder_IncompletePermutation_KeepsOmittedTracksAtEnd', () => {
    const target = multiPart(3);
    const cmd = new ReorderPartsCommand(target.score, [1]); // P2 だけ指定
    cmd.execute();
    expect(target.score.tracks.map((t) => t.name)).toEqual(['P2', 'P1', 'P3']);
    cmd.undo();
    expect(target.score.tracks.map((t) => t.name)).toEqual(['P1', 'P2', 'P3']);
  });
});
