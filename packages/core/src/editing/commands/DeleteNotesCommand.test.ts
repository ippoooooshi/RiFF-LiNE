// UT-EDIT-DELNOTES: DeleteNotesCommand
// 検証節: editing-core.md 2.6 節・4.4 節・4.5 節
// 検証観点: 音符を消す（和音の 1 つだけ・最後の 1 つで休符の拍として残す）、休符の拍を取り除いて詰める、
//   音のある拍は取り除かない、undo で音符と拍が元の位置と順へ戻る（C2）。

import { beforeEach, describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { DeleteNotesCommand } from './DeleteNotesCommand';
import { PlaceNoteCommand } from './PlaceNoteCommand';
import { getBar, getVoice } from '../scoreModel';
import type { BeatDurationSpec, CursorPosition, EditTarget } from '../types';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';

const EIGHTH: BeatDurationSpec = { duration: model.Duration.Eighth, dots: 0, tuplet: null };
const at = (beatIndex: number, trackIndex = 0): CursorPosition => ({ trackIndex, barIndex: 0, beatIndex });

let target: EditTarget;
let voice: model.Voice;
let before: string;

/** 拍 0：弦 3 と弦 2 の和音、拍 1：休符、拍 2：弦 3、拍 3：休符。 */
beforeEach(() => {
  target = buildEditTarget(2);
  new PlaceNoteCommand(target, at(0), 3, 5, EIGHTH).execute();
  new PlaceNoteCommand(target, at(0), 2, 6, EIGHTH).execute();
  voice = getVoice(getBar(target.score, 0, 0));
  voice.addBeat(new model.Beat());
  new PlaceNoteCommand(target, at(2), 3, 7, EIGHTH).execute();
  voice.addBeat(new model.Beat());
  before = scoreJson(target);
});

describe('DeleteNotesCommand', () => {
  it('DeleteNotesCommand_和音の中の1つの音_その音符だけを外しundoで元の順に戻る', () => {
    // UT-EDIT-DELNOTES-01 2.6 節「DeleteNotesCommand は音符を消す」「そのパート」・4.5 節「和音の中の 1 つの音を消したときは、その音符だけを外す」
    const cmd = new DeleteNotesCommand(target, [{ position: at(0), stringNumber: 3 }], []);
    expect(cmd.kind).toBe('delete-notes');
    expect(cmd.label).toBe('delete-notes');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    expect(cmd.execute().cursorAdvance).toBe('none');
    expect(voice.beats[0]!.notes.map((n) => n.string)).toEqual([2]);
    expect(voice.beats[0]!.getNoteOnString(3)).toBeNull();
    expect(voice.beats).toHaveLength(4);
    expect(cmd.undo().cursorAdvance).toBe('none');
    expect(voice.beats[0]!.notes.map((n) => n.string)).toEqual([3, 2]);
    expect(voice.beats[0]!.getNoteOnString(3)).toBe(voice.beats[0]!.notes[0]);
    expect(scoreJson(target)).toBe(before);
  });

  it('DeleteNotesCommand_拍の最後の音_拍を取り除かず同じ長さの休符の拍として残す', () => {
    // UT-EDIT-DELNOTES-02 4.5 節「拍の最後の 1 つの音を消したとき…その拍を同じ長さの休符の拍として残す。後ろの拍の位置は変わらない」
    const third = voice.beats[3];
    const cmd = new DeleteNotesCommand(target, [{ position: at(2), stringNumber: 3 }], []);
    cmd.execute();
    expect(voice.beats).toHaveLength(4);
    expect(voice.beats[2]!.notes).toHaveLength(0);
    expect(voice.beats[2]!.duration).toBe(model.Duration.Eighth);
    expect(voice.beats[3]).toBe(third);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('DeleteNotesCommand_和音の音を全部_休符の拍として残しundoで両方戻る', () => {
    // UT-EDIT-DELNOTES-03 4.5 節「和音の音を全部消したときも同じ」
    const cmd = new DeleteNotesCommand(
      target,
      [
        { position: at(0), stringNumber: 2 },
        { position: at(0), stringNumber: 3 },
      ],
      [],
    );
    cmd.execute();
    expect(voice.beats).toHaveLength(4);
    expect(voice.beats[0]!.notes).toHaveLength(0);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('DeleteNotesCommand_休符の拍_取り除いて後ろを詰めundoで元の位置へ戻す', () => {
    // UT-EDIT-DELNOTES-04 2.6 節「休符の拍を取り除いて詰める」・4.4 節「休符の拍を消したときは、その拍を取り除き、後ろの拍を前へ詰める」
    const rest = voice.beats[1];
    const next = voice.beats[2];
    const cmd = new DeleteNotesCommand(target, [], [at(1)]);
    expect(cmd.affectedTrackIndices).toEqual([0]);
    cmd.execute();
    expect(voice.beats).toHaveLength(3);
    expect(voice.beats[1]).toBe(next);
    cmd.undo();
    expect(voice.beats[1]).toBe(rest);
    expect(rest!.voice).toBe(voice);
    expect(scoreJson(target)).toBe(before);
  });

  it('DeleteNotesCommand_休符の拍を2つと音符を一緒に_番号がずれずに全部当たりundoで戻る', () => {
    // UT-EDIT-DELNOTES-05 4.5 節「拍を取り除くのは、restBeats に渡した休符の拍だけとする」（位置は消す前の番号で受ける）
    const cmd = new DeleteNotesCommand(target, [{ position: at(2), stringNumber: 3 }], [at(1), at(3)]);
    cmd.execute();
    expect(voice.beats).toHaveLength(2);
    expect(voice.beats[1]!.notes).toHaveLength(0);
    expect(voice.beats[1]!.duration).toBe(model.Duration.Eighth);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('DeleteNotesCommand_restBeatsに音のある拍_取り除かない', () => {
    // UT-EDIT-DELNOTES-06 4.5 節「音のある拍を渡されたときは何もしない」
    const cmd = new DeleteNotesCommand(target, [], [at(0)]);
    cmd.execute();
    expect(scoreJson(target)).toBe(before);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('DeleteNotesCommand_無い音符と拍の外と同じ休符の拍を2度_当たるものだけ消す', () => {
    // UT-EDIT-DELNOTES-07 4.5 節（消す対象が無ければ変えない）
    const cmd = new DeleteNotesCommand(
      target,
      [
        { position: at(2), stringNumber: 6 },
        { position: at(9), stringNumber: 3 },
      ],
      [at(9), at(1), at(1)],
    );
    cmd.execute();
    expect(voice.beats).toHaveLength(3);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('DeleteNotesCommand_ほかのパート_affectedTrackIndicesはそのパート', () => {
    // UT-EDIT-DELNOTES-08 2.6 節「DeleteNotesCommand の affectedTrackIndices はそのパート」
    new PlaceNoteCommand(target, at(0, 1), 1, 0, EIGHTH).execute();
    const cmd = new DeleteNotesCommand(target, [{ position: at(0, 1), stringNumber: 1 }], []);
    expect(cmd.affectedTrackIndices).toEqual([1]);
    expect(new DeleteNotesCommand(target, [], []).affectedTrackIndices).toEqual([]);
    expect(
      new DeleteNotesCommand(target, [{ position: at(0, 1), stringNumber: 1 }], [at(1)]).affectedTrackIndices,
    ).toEqual([0, 1]);
    expect(cmd.estimateSizeBytes()).toBeLessThan(2048);
  });

  it('DeleteNotesCommand_取り消しの後のやり直し_同じ変更をもう一度当てられる', () => {
    // UT-EDIT-DELNOTES-09 2.2 節「execute() と undo() の対称性は、各コマンドが自分で保証する」
    const cmd = new DeleteNotesCommand(target, [{ position: at(0), stringNumber: 2 }], [at(1)]);
    cmd.execute();
    const after = scoreJson(target);
    cmd.undo();
    cmd.execute();
    expect(scoreJson(target)).toBe(after);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });
});
