// UT-EDIT-PLACENOTE: editing-core.md §6.4、04_editing_core.md §2・§3 — PlaceNoteCommand
// 検証観点（execute/undo 対称性 C2）: 休符→音符変換 / 和音追加 / 新規 Beat の 3 モード、
//   undo で元の Score 状態（JSON）へ完全に戻ること。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { PlaceNoteCommand } from './PlaceNoteCommand';
import { getBeat, getVoice, getBar } from '../scoreModel';
import { buildEditTarget } from '../../testing/editingFakes';

const snapshot = (target: ReturnType<typeof buildEditTarget>): string => model.JsonConverter.scoreToJson(target.score);

describe('PlaceNoteCommand', () => {
  it('placeNote_OnRestBeat_ConvertsToNoteBeat_UndoRestores', () => {
    const target = buildEditTarget();
    const before = snapshot(target);

    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, beatIndex: 0 },
      3, // string
      5, // fret
      model.Duration.Eighth,
    );
    const outcome = cmd.execute();

    const beat = getBeat(target.score, 0, 0, 0);
    expect(beat.notes).toHaveLength(1);
    expect(beat.notes[0]!.string).toBe(3);
    expect(beat.notes[0]!.fret).toBe(5);
    expect(beat.duration).toBe(model.Duration.Eighth);
    expect(outcome.cursorAdvance).toBe('beat');

    expect(cmd.undo().cursorAdvance).toBe('none');
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(0);
    expect(snapshot(target)).toBe(before);
  });

  it('placeNote_ChordAdd_AddsSecondNote_UndoRemovesOnlyThatNote', () => {
    const target = buildEditTarget();
    // 先に 1 音置く
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, 5, model.Duration.Quarter).execute();
    const afterFirst = snapshot(target);

    const chord = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, beatIndex: 0 },
      2,
      7,
      model.Duration.Quarter,
    );
    chord.execute();
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(2);

    chord.undo();
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(1);
    expect(snapshot(target)).toBe(afterFirst);
  });

  it('placeNote_NewBeatBeyondEnd_AppendsBeat_UndoRemovesIt', () => {
    const target = buildEditTarget();
    // beat 0 を音符化してから beat 1（存在しない）へ置く
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, 5, model.Duration.Quarter).execute();
    const afterFirst = snapshot(target);
    const beatsBefore = getVoice(getBar(target.score, 0, 0)).beats.length;

    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, beatIndex: beatsBefore },
      4,
      0,
      model.Duration.Quarter,
    );
    cmd.execute();
    expect(getVoice(getBar(target.score, 0, 0)).beats.length).toBe(beatsBefore + 1);

    cmd.undo();
    expect(getVoice(getBar(target.score, 0, 0)).beats.length).toBe(beatsBefore);
    expect(snapshot(target)).toBe(afterFirst);
  });

  it('estimateSizeBytes_IsSmallConstant', () => {
    const target = buildEditTarget();
    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, beatIndex: 0 },
      1,
      1,
      model.Duration.Quarter,
    );
    expect(cmd.estimateSizeBytes()).toBeLessThan(2048);
  });
});
