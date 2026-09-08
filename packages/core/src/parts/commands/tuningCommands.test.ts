// UT-PART-TUNING: part-tuning-management.md §3.2・§5・§6.2・§7 — ApplyTuningPresetCommand / SetCustomTuningCommand
// 検証観点（C2）: 弦数増加（警告なし）／減少（Note破棄＋EDIT-006）／同数、undo で Score JSON 完全復元、
//   redo で EDIT-006 を再通知しない、SetCustomTuning は弦数を変えない。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { ApplyTuningPresetCommand, SetCustomTuningCommand } from './tuningCommands';
import { PlaceNoteCommand } from '../../editing/commands/PlaceNoteCommand';
import { getStringCount, getTuning } from '../partModel';
import { buildEditTarget, RecordingReporter, scoreJson } from '../../testing/editingFakes';

const GTR6 = [64, 59, 55, 50, 45, 40];
const GTR7 = [69, 64, 59, 55, 50, 45, 40];
const GTR5 = [64, 59, 55, 50, 45];

describe('ApplyTuningPresetCommand', () => {
  it('increaseStringCount_NoWarning_UndoRestores', () => {
    const target = buildEditTarget();
    const reporter = new RecordingReporter();
    const before = scoreJson(target);

    const cmd = new ApplyTuningPresetCommand(target.score, 0, { name: '7弦', stringPitches: GTR7 }, reporter);
    cmd.execute();
    expect(getStringCount(target.score, 0)).toBe(7);
    expect(getTuning(target.score, 0)).toEqual(GTR7);
    expect(reporter.reports).toEqual([]);

    cmd.undo();
    expect(getStringCount(target.score, 0)).toBe(6);
    expect(scoreJson(target)).toBe(before);
  });

  it('decreaseStringCount_DropsNotesOnLostStrings_ReportsEDIT006_UndoRestores', () => {
    const target = buildEditTarget();
    // 弦6（最低音弦）に音を置く → 5弦化で消える
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 6, 3, model.Duration.Quarter).execute();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, 5, model.Duration.Quarter).execute();
    const before = scoreJson(target);
    const reporter = new RecordingReporter();

    const cmd = new ApplyTuningPresetCommand(target.score, 0, { name: '5弦', stringPitches: GTR5 }, reporter);
    cmd.execute();
    expect(getStringCount(target.score, 0)).toBe(5);
    // 弦6の音は破棄、弦3の音は残る
    const notes = target.score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.notes;
    expect(notes.map((n) => n.string).sort()).toEqual([3]);
    expect(reporter.reports).toHaveLength(1);
    expect(reporter.reports[0]!.code).toBe('EDIT-006');
    expect(reporter.reports[0]!.context).toMatchObject({ droppedCount: 1, newStringCount: 5 });

    cmd.undo();
    expect(getStringCount(target.score, 0)).toBe(6);
    expect(scoreJson(target)).toBe(before);

    // redo では EDIT-006 を再通知しない
    cmd.execute();
    expect(reporter.reports.filter((r) => r.code === 'EDIT-006')).toHaveLength(1);
  });

  it('sameStringCount_JustSwapsPitches_NoWarning', () => {
    const target = buildEditTarget();
    const reporter = new RecordingReporter();
    const dropD = [64, 59, 55, 50, 45, 38];
    const cmd = new ApplyTuningPresetCommand(target.score, 0, { name: 'ドロップD', stringPitches: dropD }, reporter);
    cmd.execute();
    expect(getTuning(target.score, 0)).toEqual(dropD);
    expect(target.score.tracks[0]!.staves[0]!.stringTuning.name).toBe('ドロップD');
    expect(reporter.reports).toEqual([]);
    cmd.undo();
    expect(getTuning(target.score, 0)).toEqual(GTR6);
  });
});

describe('SetCustomTuningCommand', () => {
  it('setCustomTuning_ChangesPitchesNotStringCount_ClearsPresetName_UndoRestores', () => {
    const target = buildEditTarget();
    target.score.tracks[0]!.staves[0]!.stringTuning.name = 'ドロップD';
    const before = scoreJson(target);

    const custom = [65, 60, 56, 51, 46, 41];
    const cmd = new SetCustomTuningCommand(target.score, 0, custom);
    cmd.execute();
    expect(getTuning(target.score, 0)).toEqual(custom);
    expect(getStringCount(target.score, 0)).toBe(6);
    expect(target.score.tracks[0]!.staves[0]!.stringTuning.name).toBe('');

    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });
});
