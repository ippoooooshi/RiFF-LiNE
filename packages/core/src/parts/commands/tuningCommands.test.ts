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

  it('decreaseStringCount_DropsLowestStringNotes_RenumbersSurvivors_ReportsEDIT006_UndoRestores', () => {
    const target = buildEditTarget();
    // alphaTab 規約：note.string=1 が最低音弦。6→5 弦化（低音弦を削る）で string=1 の音が消え、
    // string=2..6 は string=1..5 へ繰り下がる（音高は保たれる）。
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 1, 3, model.Duration.Quarter).execute(); // 消える
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 4, 5, model.Duration.Quarter).execute(); // 残る→string 3
    const before = scoreJson(target);
    const reporter = new RecordingReporter();

    const cmd = new ApplyTuningPresetCommand(target.score, 0, { name: '5弦', stringPitches: GTR5 }, reporter);
    cmd.execute();
    expect(getStringCount(target.score, 0)).toBe(5);
    const notes = target.score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.notes;
    expect(notes.map((n) => n.string).sort((a, b) => a - b)).toEqual([3]); // 元 string 4 が 3 へ
    expect(notes[0]!.fret).toBe(5);
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

  it('increaseStringCount_RenumbersNotesUpward_UndoRestores', () => {
    const target = buildEditTarget();
    // string=1（最低音弦）に音 → 7弦化（低音弦を1本追加）で string=2 へ繰り上がる
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 1, 2, model.Duration.Quarter).execute();
    const before = scoreJson(target);

    const seven = [64, 59, 55, 50, 45, 40, 35]; // 低音 B(35) を追加
    const cmd = new ApplyTuningPresetCommand(
      target.score,
      0,
      { name: '7弦', stringPitches: seven },
      new RecordingReporter(),
    );
    cmd.execute();
    expect(getStringCount(target.score, 0)).toBe(7);
    expect(target.score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.notes[0]!.string).toBe(2);

    cmd.undo();
    expect(scoreJson(target)).toBe(before);
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
