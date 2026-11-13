// UT-EDIT-DUPSEL: DuplicateSelectionCommand（Ctrl+D の範囲の複製） <!-- req webcorefoundation:b4b910c5.7aab -->
// 検証節: editing-core.md 2.6 節の表・9 節
// 検証観点（C2）: 範囲の拍の写しを範囲の終わりの拍のすぐ後ろ（同じ小節の中）に挿入し、後ろの拍はずれるだけで次の小節へ送らない。
//               写すのは音価・Beat の奏法記号・音符の弦とフレットと Note の奏法記号で、タイとスラーの印は写さない。範囲が空なら何もしない。
//               undo で挿入した拍を外す。
// C2：複合の条件なし（DuplicateSelectionCommand.ts:1〜124 を && と || で grep して 0 件）

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { InsertBarCommand } from './barCommands';
import { DuplicateSelectionCommand } from './DuplicateSelectionCommand';
import { finishScore, getStaff, insertBeatAt } from '../scoreModel';
import type { EditTarget, SelectionRange } from '../types';
import { appMetaJson, buildEditTarget, scoreJson } from '../../testing/editingFakes';

/** 小節 barIndex のボイス 0 を、渡したフレットの音符（弦 1）の拍で置き直す（null は休符の拍）。 */
function fillBar(target: EditTarget, barIndex: number, frets: (number | null)[]): model.Voice {
  const voice = getStaff(target.score, 0).bars[barIndex]!.voices[0]!;
  voice.beats.splice(0);
  frets.forEach((fret, i) => {
    const beat = new model.Beat();
    beat.duration = model.Duration.Quarter;
    if (fret !== null) {
      const note = new model.Note();
      note.string = 1;
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

function frets(voice: model.Voice): (number | null)[] {
  return voice.beats.map((b) => b.notes[0]?.fret ?? null);
}

describe('DuplicateSelectionCommand', () => {
  it('DuplicateSelectionCommand_1つの小節の範囲_終わりの拍のすぐ後ろに写しを挿入し取り消しで外す', () => {
    // UT-EDIT-DUPSEL-01 2.6 節の表「DuplicateSelectionCommand は選択範囲の写しを後ろに挿入する」「範囲はそのパート」
    const target = buildEditTarget(2);
    const voice = fillBar(target, 0, [1, 2, null, 4]);
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new DuplicateSelectionCommand(target, range({ startBeatIndex: 1, endBeatIndex: 2 }));
    expect(cmd.kind).toBe('duplicate-selection');
    expect(cmd.label).toBe('duplicate-selection');
    expect([...cmd.affectedTrackIndices]).toEqual([0]);
    cmd.execute();
    expect(frets(voice)).toEqual([1, 2, null, 2, null, 4]);
    // 写しは別の拍と音符で、足した拍から Voice への逆参照を張っている
    expect(voice.beats[3]).not.toBe(voice.beats[1]);
    expect(voice.beats[3]!.notes[0]).not.toBe(voice.beats[1]!.notes[0]);
    expect(voice.beats[3]!.voice).toBe(voice);
    // クリップボードやサイドカーは変えない
    expect(appMetaJson(target)).toBe(before.meta);

    cmd.undo();
    expect(scoreJson(target)).toBe(before.score);
    cmd.execute();
    expect(frets(voice)).toEqual([1, 2, null, 2, null, 4]);
  });

  it('DuplicateSelectionCommand_小節をまたぐ範囲_写しは終わりの小節の中に入れ次の小節へ送らない', () => {
    // UT-EDIT-DUPSEL-02 9 節「範囲の終わりの拍のすぐ後ろ（同じ小節の中）に挿入」「次の小節へは送らない」
    const target = buildEditTarget();
    new InsertBarCommand(target, 1).execute();
    new InsertBarCommand(target, 2).execute();
    const v0 = fillBar(target, 0, [1, 2]);
    const v1 = fillBar(target, 1, [3, 4]);
    const v2 = fillBar(target, 2, [9]);
    const cmd = new DuplicateSelectionCommand(target, range({ startBeatIndex: 1, endBarIndex: 1, endBeatIndex: 0 }));
    cmd.execute();
    expect(frets(v0)).toEqual([1, 2]);
    expect(frets(v1)).toEqual([3, 2, 3, 4]);
    expect(frets(v2)).toEqual([9]);
  });

  it('DuplicateSelectionCommand_音価と奏法記号_写しタイとスラーは写さない', () => {
    // UT-EDIT-DUPSEL-03 9 節の (b)「写すのは、拍の音価と、音符の弦とフレットと Note の奏法記号と、Beat の単位の奏法記号」「タイとスラーの印は写さない」
    const target = buildEditTarget();
    const voice = fillBar(target, 0, [5, 7]);
    const source = voice.beats[0]!;
    source.dots = 1;
    source.tupletNumerator = 3;
    source.tupletDenominator = 2;
    source.slap = true;
    source.brushType = model.BrushType.BrushDown;
    const note = source.notes[0]!;
    note.isPalmMute = true;
    note.vibrato = model.VibratoType.Slight;
    note.slideOutType = model.SlideOutType.Shift;
    note.accentuated = model.AccentuationType.Heavy;
    note.bendType = model.BendType.Bend;
    note.addBendPoint(new model.BendPoint(0, 0));
    note.addBendPoint(new model.BendPoint(60, 4));
    note.bendType = model.BendType.Bend;
    voice.beats[1]!.notes[0]!.isTieDestination = true;

    new DuplicateSelectionCommand(target, range({ endBeatIndex: 1 })).execute();
    const copy = voice.beats[2]!;
    expect([copy.duration, copy.dots, copy.tupletNumerator, copy.tupletDenominator]).toEqual([
      model.Duration.Quarter,
      1,
      3,
      2,
    ]);
    expect(copy.slap).toBe(true);
    expect(copy.brushType).toBe(model.BrushType.BrushDown);
    const copied = copy.notes[0]!;
    expect([
      copied.string,
      copied.fret,
      copied.isPalmMute,
      copied.vibrato,
      copied.slideOutType,
      copied.accentuated,
    ]).toEqual([1, 5, true, model.VibratoType.Slight, model.SlideOutType.Shift, model.AccentuationType.Heavy]);
    expect(copied.bendType).toBe(model.BendType.Bend);
    expect(copied.bendPoints?.map((p) => [p.offset, p.value])).toEqual([
      [0, 0],
      [60, 4],
    ]);
    expect(copied.bendPoints?.[0]).not.toBe(note.bendPoints?.[0]);
    expect(copied.maxBendPoint?.value).toBe(4);
    // タイの印は写さない
    expect(voice.beats[3]!.notes[0]!.isTieDestination).toBe(false);
    // 描く前の作り直しが通る
    expect(() => finishScore(target.score)).not.toThrow();
  });

  it('DuplicateSelectionCommand_範囲に拍が無い_何もしない', () => {
    // UT-EDIT-DUPSEL-04 9 節（範囲の拍が無いときは挿入しない）
    const target = buildEditTarget();
    const before = scoreJson(target);
    const cmd = new DuplicateSelectionCommand(target, range({ startBarIndex: 3, endBarIndex: 3 }));
    cmd.execute();
    expect(scoreJson(target)).toBe(before);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('DuplicateSelectionCommand_推定の大きさ_写した拍と音符の数で増える', () => {
    // UT-EDIT-DUPSEL-05 2.3 節「各コマンドは、原則として変更の差分だけを持つ」
    const target = buildEditTarget();
    fillBar(target, 0, [1, null]);
    const cmd = new DuplicateSelectionCommand(target, range({ endBeatIndex: 1 }));
    const empty = cmd.estimateSizeBytes();
    cmd.execute();
    expect(cmd.estimateSizeBytes()).toBeGreaterThan(empty);
  });
});
