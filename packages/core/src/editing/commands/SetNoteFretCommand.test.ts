// UT-EDIT-NOTEFRET: SetNoteFretCommand <!-- req webcorefoundation:fdafa42c.3b38 -->
// 検証節: editing-core.md 2.2 節・2.6 節・4.2 節・7.3 節
// 検証観点: 置いた音符のフレットの書き換えと undo の対称性（C2）、自然ハーモニクスの harmonicValue の合わせ直し、
//   同じ音符を置いた PlaceNoteCommand と履歴の 1 つの項目にまとめること（canMergeWith・mergeWith）。

import { beforeEach, describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { CommandHistory } from './CommandHistory';
import { SetChordNameCommand, SetTechniqueCommand } from './noteAttributeCommands';
import { PlaceNoteCommand } from './PlaceNoteCommand';
import { SetNoteFretCommand } from './SetNoteFretCommand';
import { getBeat } from '../scoreModel';
import type { BeatDurationSpec, CursorPosition, EditTarget } from '../types';
import {
  buildEditTarget,
  countUndoable,
  RecordingRenderRequester,
  RecordingReporter,
  scoreJson,
} from '../../testing/editingFakes';

const QUARTER: BeatDurationSpec = { duration: model.Duration.Quarter, dots: 0, tuplet: null };
const at = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, beatIndex });

let target: EditTarget;
let before: string;

beforeEach(() => {
  target = buildEditTarget();
  new PlaceNoteCommand(target, at(0), 3, 1, QUARTER).execute();
  before = scoreJson(target);
});

describe('SetNoteFretCommand', () => {
  it('SetNoteFretCommand_置いた音符_フレットを2桁に書き換えundoで戻る', () => {
    // UT-EDIT-NOTEFRET-01 2.6 節「SetNoteFretCommand は置いた音符のフレットを 2 桁に書き換える」「そのパート」・4.2 節「cursorAdvance は 'none'」
    const cmd = new SetNoteFretCommand(target, at(0), 3, 12);
    expect(cmd.kind).toBe('set-note-fret');
    expect(cmd.label).toBe('set-note-fret');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    expect(cmd.execute().cursorAdvance).toBe('none');
    expect(getBeat(target.score, 0, 0, 0).notes[0]!.fret).toBe(12);
    expect(cmd.undo().cursorAdvance).toBe('none');
    expect(getBeat(target.score, 0, 0, 0).notes[0]!.fret).toBe(1);
    expect(scoreJson(target)).toBe(before);
  });

  it('SetNoteFretCommand_自然ハーモニクスの音_harmonicValueを書き換えた後のフレットに合わせundoで一緒に戻す', () => {
    // UT-EDIT-NOTEFRET-02 7.3 節「SetNoteFretCommand（4.2 節）は、書き換える音が自然ハーモニクスなら、書き換えた後のフレットから
    // 同じ決まりで harmonicValue を入れ直す。どちらの undo も、harmonicValue を前の値に戻す」
    new SetTechniqueCommand(target, at(0), 3, { harmonicType: model.HarmonicType.Natural }).execute();
    const natural = scoreJson(target);
    const note = getBeat(target.score, 0, 0, 0).notes[0]!;
    expect(note.harmonicValue).toBe(12);

    const cmd = new SetNoteFretCommand(target, at(0), 3, 10);
    cmd.execute();
    expect(note.fret).toBe(10);
    expect(note.harmonicValue).toBe(9.6);
    cmd.undo();
    expect(note.fret).toBe(1);
    expect(note.harmonicValue).toBe(12);
    expect(scoreJson(target)).toBe(natural);
  });

  it('SetNoteFretCommand_自然ハーモニクスでない音_harmonicValueを変えない', () => {
    // UT-EDIT-NOTEFRET-03 4.2 節「自然ハーモニクスの音なら harmonicValue も書き換えた後のフレットに合わせ」（それ以外は変えない）
    new SetTechniqueCommand(target, at(0), 3, {
      harmonicType: model.HarmonicType.Artificial,
      harmonicValue: 7,
    }).execute();
    new SetNoteFretCommand(target, at(0), 3, 15).execute();
    expect(getBeat(target.score, 0, 0, 0).notes[0]!.harmonicValue).toBe(7);
  });

  it('SetNoteFretCommand_弦に音符が無いか拍の外_何もしない', () => {
    // UT-EDIT-NOTEFRET-04 4.2 節（書き換える音符が無ければ変えない）
    for (const cmd of [new SetNoteFretCommand(target, at(0), 6, 12), new SetNoteFretCommand(target, at(4), 3, 12)]) {
      cmd.execute();
      expect(scoreJson(target)).toBe(before);
      cmd.undo();
      expect(scoreJson(target)).toBe(before);
    }
  });

  it('SetNoteFretCommand_canMergeWith_同じ音符を置いたPlaceNoteCommandのときだけ真', () => {
    // UT-EDIT-NOTEFRET-05 4.2 節「SetNoteFretCommand.canMergeWith が、直前の項目が同じ音符を置いた PlaceNoteCommand のときだけ真を返す」
    // ・2.2 節「canMergeWith は、続けて起きる同じ種類の細かい操作（4.2 節の 2 桁のフレットの書き換え）を…まとめられるかを判定する」
    const cmd = new SetNoteFretCommand(target, at(1), 3, 12);
    expect(cmd.canMergeWith(new PlaceNoteCommand(target, at(1), 3, 1, QUARTER))).toBe(true);
    expect(cmd.canMergeWith(new PlaceNoteCommand(target, at(1), 2, 1, QUARTER))).toBe(false);
    expect(cmd.canMergeWith(new PlaceNoteCommand(target, at(0), 3, 1, QUARTER))).toBe(false);
    expect(cmd.canMergeWith(new SetChordNameCommand(target, at(1), 'C'))).toBe(false);
    expect(cmd.canMergeWith(new SetNoteFretCommand(target, at(1), 3, 13))).toBe(false);
  });

  it('SetNoteFretCommand_履歴で前のPlaceNoteCommandとまとめる_1回の取り消しで両方が戻りやり直しで両方が当たる', () => {
    // UT-EDIT-NOTEFRET-06 4.2 節「書き換えは、前の PlaceNoteCommand と履歴の 1 つの項目にまとめる…1 回の取り消しで 2 桁の入力が全部戻り」
    // ・2.2 節「mergeWith は、まとめられると判定された 2 つのコマンドを 1 つにまとめる」
    const history = new CommandHistory(new RecordingRenderRequester(), new RecordingReporter());
    const empty = scoreJson(target);
    history.execute(new PlaceNoteCommand(target, at(1), 4, 1, QUARTER));
    const fret = new SetNoteFretCommand(target, at(1), 4, 15);
    history.execute(fret);
    const typed = scoreJson(target);
    expect(getBeat(target.score, 0, 0, 1).notes[0]!.fret).toBe(15);
    expect(countUndoable(history)).toBe(1);
    expect(fret.label).toBe('place-note');
    expect(fret.estimateSizeBytes()).toBeGreaterThan(new SetNoteFretCommand(target, at(1), 4, 15).estimateSizeBytes());

    history.undo();
    expect(scoreJson(target)).toBe(empty);
    expect(history.canUndo()).toBe(false);
    history.redo();
    expect(scoreJson(target)).toBe(typed);
  });

  it('SetNoteFretCommand_mergeWithにPlaceNoteCommandでないもの_取り込まない', () => {
    // UT-EDIT-NOTEFRET-07 2.2 節「mergeWith は、まとめられると判定された 2 つのコマンドを 1 つにまとめる」（判定されないものは取り込まない）
    const cmd = new SetNoteFretCommand(target, at(0), 3, 12);
    const size = cmd.estimateSizeBytes();
    cmd.mergeWith(new SetChordNameCommand(target, at(0), 'C'));
    expect(cmd.label).toBe('set-note-fret');
    expect(cmd.estimateSizeBytes()).toBe(size);
    cmd.execute();
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });
});
