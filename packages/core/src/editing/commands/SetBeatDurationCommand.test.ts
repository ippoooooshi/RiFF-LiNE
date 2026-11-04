// UT-EDIT-DURATION: SetBeatDurationCommand
// 検証節: editing-core.md 2.6 節・3.3 節・4.3 節
// 検証観点: 今ある 1 つの拍の音価・付点・連符を変え、undo で前の音価（4 つの項目のそのままの値）に戻す（C2）。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { PlaceNoteCommand } from './PlaceNoteCommand';
import { SetBeatDurationCommand } from './SetBeatDurationCommand';
import { getBeat } from '../scoreModel';
import { DEFAULT_DURATION_SPEC, type CursorPosition } from '../types';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';

const at = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, beatIndex });

describe('SetBeatDurationCommand', () => {
  it('SetBeatDurationCommand_今ある拍_音価と付点と連符を変えundoで前に戻る', () => {
    // UT-EDIT-DURATION-01 2.6 節「SetBeatDurationCommand は今ある拍の音価・付点・連符」「そのパート」・3.3 節「Beat.dots」「Beat.tupletNumerator・Beat.tupletDenominator」
    const target = buildEditTarget();
    new PlaceNoteCommand(target, at(0), 3, 5, DEFAULT_DURATION_SPEC).execute();
    new PlaceNoteCommand(target, at(1), 3, 7, DEFAULT_DURATION_SPEC).execute();
    const before = scoreJson(target);

    const cmd = new SetBeatDurationCommand(target, at(1), {
      duration: model.Duration.ThirtySecond,
      dots: 1,
      tuplet: { numerator: 3, denominator: 2 },
    });
    expect(cmd.kind).toBe('set-beat-duration');
    expect(cmd.label).toBe('set-beat-duration');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    expect(cmd.execute().cursorAdvance).toBe('none');
    const beat = getBeat(target.score, 0, 0, 1);
    expect([beat.duration, beat.dots, beat.tupletNumerator, beat.tupletDenominator]).toEqual([
      model.Duration.ThirtySecond,
      1,
      3,
      2,
    ]);
    expect(getBeat(target.score, 0, 0, 0).duration).toBe(model.Duration.Quarter);

    expect(cmd.undo().cursorAdvance).toBe('none');
    expect(scoreJson(target)).toBe(before);
  });

  it('SetBeatDurationCommand_alphaTabの初めの連符の値の拍_undoで同じ値に戻す', () => {
    // UT-EDIT-DURATION-02 2.2 節「undo() は、execute() の変更を打ち消し、変更の前の状態へ戻す」（初めからある休符の拍は分子と分母が -1）
    const target = buildEditTarget();
    const beat = getBeat(target.score, 0, 0, 0);
    const original = [beat.duration, beat.dots, beat.tupletNumerator, beat.tupletDenominator];
    const before = scoreJson(target);
    const cmd = new SetBeatDurationCommand(target, at(0), { duration: model.Duration.Half, dots: 2, tuplet: null });
    cmd.execute();
    expect([beat.duration, beat.dots, beat.tupletNumerator, beat.tupletDenominator]).toEqual([
      model.Duration.Half,
      2,
      1,
      1,
    ]);
    cmd.undo();
    expect([beat.duration, beat.dots, beat.tupletNumerator, beat.tupletDenominator]).toEqual(original);
    expect(scoreJson(target)).toBe(before);
  });

  it('SetBeatDurationCommand_6つの外の音符の長さ_拍を変えずにRangeErrorを投げる', () => {
    // UT-EDIT-DURATION-03 3.3 節「音符の長さは、全音符（Duration.Whole）から 32 分音符（Duration.ThirtySecond）までの 6 つに限る」
    const target = buildEditTarget();
    const before = scoreJson(target);
    const cmd = new SetBeatDurationCommand(target, at(0), {
      duration: model.Duration.SixtyFourth,
      dots: 0,
      tuplet: null,
    });
    expect(() => cmd.execute()).toThrow(RangeError);
    expect(scoreJson(target)).toBe(before);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetBeatDurationCommand_拍の外_RangeErrorを投げる', () => {
    // UT-EDIT-DURATION-04 4.3 節「SetBeatDurationCommand は 1 つの拍だけを変える」（今ある拍でなければ変えられない）
    const cmd = new SetBeatDurationCommand(buildEditTarget(), at(3), DEFAULT_DURATION_SPEC);
    expect(() => cmd.execute()).toThrow(RangeError);
    expect(cmd.estimateSizeBytes()).toBeLessThan(2048);
  });
});
