// UT-EDIT-DELSEL: DeleteSelectionCommand（選択範囲の削除と、切り取りの消す側） <!-- req webcorefoundation:abefb1dd.af41 -->
// 検証節: editing-core.md 2.6 節の表・3.1 節・9 節
// 検証観点（C2）: 範囲の中の音のある拍は同じ長さの休符の拍に、休符の拍は取り除いて詰める。範囲は 1 つのボイスの中で両端を含み、
//               小節をまたぐ（始まりの小節・間の小節・終わりの小節）、選んだボイスが無い小節は飛ばす。undo で元の並びと音符の順に戻る。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { InsertBarCommand } from './barCommands';
import { collectRangeBeats, DeleteSelectionCommand } from './DeleteSelectionCommand';
import { AddMemoCommand } from './memoCommands';
import { getStaff, insertBeatAt } from '../scoreModel';
import type { EditTarget, SelectionRange } from '../types';
import { appMetaJson, buildEditTarget, scoreJson } from '../../testing/editingFakes';

/** 拍の中身：音符の [弦, フレット] の並び（空なら休符の拍）。 */
type BeatContent = [number, number][];

/** 小節のボイスの拍を、渡した中身で置き直す（ボイスが無ければ作る）。拍の長さは 8 分音符。 */
function fillVoice(
  target: EditTarget,
  barIndex: number,
  beats: BeatContent[],
  voiceIndex = 0,
  trackIndex = 0,
): model.Voice {
  const bar = getStaff(target.score, trackIndex).bars[barIndex]!;
  while (bar.voices.length <= voiceIndex) bar.addVoice(new model.Voice());
  const voice = bar.voices[voiceIndex]!;
  voice.beats.splice(0);
  beats.forEach((notes, i) => {
    const beat = new model.Beat();
    beat.duration = model.Duration.Eighth;
    for (const [string, fret] of notes) {
      const note = new model.Note();
      note.string = string;
      note.fret = fret;
      beat.addNote(note);
    }
    insertBeatAt(voice, i, beat);
  });
  return voice;
}

function range(partial: Partial<SelectionRange>): SelectionRange {
  return {
    trackIndex: 0,
    voiceIndex: 0,
    startBarIndex: 0,
    startBeatIndex: 0,
    endBarIndex: 0,
    endBeatIndex: 0,
    ...partial,
  };
}

/** 拍ごとの音符の数（休符は 0）。 */
function noteCounts(voice: model.Voice): number[] {
  return voice.beats.map((b) => b.notes.length);
}

describe('DeleteSelectionCommand', () => {
  it('DeleteSelectionCommand_1つの小節の範囲_音は休符に休符の拍は詰め取り消しで戻る', () => {
    // UT-EDIT-DELSEL-01 9 節「範囲の中の音のある拍は、音を消して同じ長さの休符の拍として残す。範囲の中の休符の拍は、取り除いて後ろを詰める」
    const target = buildEditTarget();
    const voice = fillVoice(target, 0, [
      [[3, 5]],
      [],
      [
        [2, 7],
        [1, 3],
      ],
      [],
      [[4, 0]],
    ]);
    const before = scoreJson(target);

    const cmd = new DeleteSelectionCommand(target, range({ startBeatIndex: 1, endBeatIndex: 3 }), 'delete-selection');
    expect(cmd.kind).toBe('delete-selection');
    expect(cmd.label).toBe('delete-selection');
    expect([...cmd.affectedTrackIndices]).toEqual([0]);
    cmd.execute();
    // 拍 1 と 3（休符）は取り除き、拍 2（和音）は同じ長さの休符に。範囲の外の拍 0 と 4 はそのまま
    expect(noteCounts(voice)).toEqual([1, 0, 1]);
    expect(voice.beats[1]!.duration).toBe(model.Duration.Eighth);

    cmd.undo();
    expect(scoreJson(target)).toBe(before);
    // 和音の音符は元の順に戻り、弦から音符を引ける
    expect(voice.beats[2]!.notes.map((n) => n.string)).toEqual([2, 1]);
    expect(voice.beats[2]!.getNoteOnString(1)?.fret).toBe(3);
  });

  it('DeleteSelectionCommand_切り取り_ラベルはcutで同じ消し方', () => {
    // UT-EDIT-DELSEL-02 9 節「消す側だけを、コマンド（DeleteSelectionCommand、ラベルの id は 'cut'）として履歴に積む」
    const target = buildEditTarget();
    const voice = fillVoice(target, 0, [[[3, 5]], []]);
    const cmd = new DeleteSelectionCommand(target, range({ endBeatIndex: 1 }), 'cut');
    expect(cmd.label).toBe('cut');
    expect(cmd.kind).toBe('delete-selection');
    cmd.execute();
    expect(noteCounts(voice)).toEqual([0]);
  });

  it('DeleteSelectionCommand_小節をまたぐ範囲_始まりの小節は途中から終わりの小節は途中まで', () => {
    // UT-EDIT-DELSEL-03 2.6 節「SelectionRange は start と end の拍を両端に含む」・9 節
    const target = buildEditTarget();
    new InsertBarCommand(target, 1).execute();
    new InsertBarCommand(target, 2).execute();
    const v0 = fillVoice(target, 0, [[[1, 1]], [[1, 2]], []]);
    const v1 = fillVoice(target, 1, [[[2, 1]], []]);
    const v2 = fillVoice(target, 2, [[[3, 1]], [], [[3, 3]]]);
    const before = scoreJson(target);

    const cmd = new DeleteSelectionCommand(
      target,
      range({ startBarIndex: 0, startBeatIndex: 1, endBarIndex: 2, endBeatIndex: 1 }),
      'delete-selection',
    );
    cmd.execute();
    expect(noteCounts(v0)).toEqual([1, 0]);
    expect(noteCounts(v1)).toEqual([0]);
    expect(noteCounts(v2)).toEqual([0, 1]);

    cmd.undo();
    expect(scoreJson(target)).toBe(before);
    // やり直すと同じ結果（C2 の対称性）
    cmd.execute();
    expect(noteCounts(v2)).toEqual([0, 1]);
  });

  it('DeleteSelectionCommand_2つ目のボイスの範囲_もう一方のボイスは消さずボイスが無い小節は飛ばす', () => {
    // UT-EDIT-DELSEL-04 3.1 節「もう一方のボイスの拍は、写しも書き換えもしない」
    const target = buildEditTarget();
    new InsertBarCommand(target, 1).execute();
    const first = fillVoice(target, 0, [[[1, 1]], [[1, 2]]], 0);
    const second = fillVoice(target, 0, [[[5, 3]], []], 1);
    const before = scoreJson(target);

    const cmd = new DeleteSelectionCommand(
      target,
      range({ voiceIndex: 1, startBarIndex: 0, endBarIndex: 1, endBeatIndex: 0 }),
      'delete-selection',
    );
    cmd.execute();
    expect(noteCounts(second)).toEqual([0]);
    expect(noteCounts(first)).toEqual([1, 1]);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('DeleteSelectionCommand_範囲が小節と拍の外まで_ある拍だけを消す', () => {
    // UT-EDIT-DELSEL-05 9 節（範囲は今ある拍に限る）
    const target = buildEditTarget();
    const voice = fillVoice(target, 0, [[[1, 1]], [[1, 2]]]);
    const cmd = new DeleteSelectionCommand(target, range({ endBarIndex: 4, endBeatIndex: 9 }), 'delete-selection');
    cmd.execute();
    expect(noteCounts(voice)).toEqual([0, 0]);
    expect(collectRangeBeats(target.score, range({ startBarIndex: 3, endBarIndex: 4 }))).toEqual([]);
  });

  it('DeleteSelectionCommand_小節そのものとメモや拍子やテンポ_消さずに残す', () => {
    // UT-EDIT-DELSEL-06 9 節「小節そのものは消さない」「小節の枠・拍子・テンポ・セクションマーカー・小節メモは、消さずに残す」
    const target = buildEditTarget();
    new AddMemoCommand(target, 0, 'memo', () => new Date('2026-11-04T00:00:00.000Z')).execute();
    const masterBar = target.score.masterBars[0]!;
    const meta = appMetaJson(target);
    fillVoice(target, 0, [[]]);
    new DeleteSelectionCommand(target, range({}), 'delete-selection').execute();
    expect(getStaff(target.score, 0).bars).toHaveLength(1);
    expect(target.score.masterBars).toEqual([masterBar]);
    expect(appMetaJson(target)).toBe(meta);
  });

  it('DeleteSelectionCommand_推定の大きさ_消した音符と拍の数で増える', () => {
    // UT-EDIT-DELSEL-07 2.3 節「各コマンドは、原則として変更の差分だけを持つ」
    const target = buildEditTarget();
    fillVoice(target, 0, [
      [
        [1, 1],
        [2, 2],
      ],
      [],
    ]);
    const cmd = new DeleteSelectionCommand(target, range({ endBeatIndex: 1 }), 'delete-selection');
    const empty = cmd.estimateSizeBytes();
    cmd.execute();
    expect(cmd.estimateSizeBytes()).toBeGreaterThan(empty);
    cmd.undo();
    expect(cmd.estimateSizeBytes()).toBe(empty);
  });
});
