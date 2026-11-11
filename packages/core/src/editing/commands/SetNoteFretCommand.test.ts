// UT-EDIT-NOTEFRET: SetNoteFretCommand <!-- req webcorefoundation:fdafa42c.3b38 -->
// 検証節: editing-core.md 2.2 節・2.6 節・4.2 節・7.3 節
// 検証観点: 置いた音符のフレットの書き換えと undo の対称性（C2）、自然ハーモニクスの harmonicValue の合わせ直し、
//   同じ音符を置いた PlaceNoteCommand（か、それと InsertBarCommand をまとめた CompositeCommand）と履歴の 1 つの項目に
//   まとめること（canMergeWith・mergeWith）。

import { beforeEach, describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { DeleteBarCommand, InsertBarCommand } from './barCommands';
import type { Command } from './Command';
import { CommandHistory } from './CommandHistory';
import { DeleteNotesCommand } from './DeleteNotesCommand';
import { InsertRestCommand } from './InsertRestCommand';
import { SetChordNameCommand, SetTechniqueCommand } from './noteAttributeCommands';
import { PlaceNoteCommand } from './PlaceNoteCommand';
import { SetBeatDurationCommand } from './SetBeatDurationCommand';
import { SetNoteFretCommand } from './SetNoteFretCommand';
import { CompositeCommand } from '../CompositeCommand';
import { getBar, getBeat } from '../scoreModel';
import type { BeatDurationSpec, CursorPosition, EditTarget } from '../types';
import {
  buildEditTarget,
  countUndoable,
  RecordingRenderRequester,
  RecordingReporter,
  scoreJson,
} from '../../testing/editingFakes';

const QUARTER: BeatDurationSpec = { duration: model.Duration.Quarter, dots: 0, tuplet: null };
const at = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });

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

  it('SetNoteFretCommand_canMergeWith_同じ音符を置いたPlaceNoteCommandとInsertBarCommandの2つだけのまとまりのときだけ真', () => {
    // UT-EDIT-NOTEFRET-10 4.2 節「SetNoteFretCommand.canMergeWith が、直前の項目が同じ音符を置いた PlaceNoteCommand か、
    //   その PlaceNoteCommand と InsertBarCommand をまとめた CompositeCommand（531 行）のときだけ真を返す」
    const cmd = new SetNoteFretCommand(target, at(1), 3, 12);
    const place = (stringNumber = 3, beatIndex = 1): PlaceNoteCommand =>
      new PlaceNoteCommand(target, at(beatIndex), stringNumber, 1, QUARTER);
    const insertBar = (): InsertBarCommand => new InsertBarCommand(target, 1);
    const composite = (children: Command[]): CompositeCommand =>
      new CompositeCommand('place-note-append-bar', 'place-note', children);
    expect(cmd.canMergeWith(composite([place(), insertBar()]))).toBe(true);
    // 子の形が違うまとまり（別の弦か別の拍の音符・順が逆・小節を足さない・子の数が違う）
    expect(cmd.canMergeWith(composite([place(2), insertBar()]))).toBe(false);
    expect(cmd.canMergeWith(composite([place(3, 0), insertBar()]))).toBe(false);
    expect(cmd.canMergeWith(composite([insertBar(), place()]))).toBe(false);
    expect(cmd.canMergeWith(composite([place(), new InsertRestCommand(target, at(2), QUARTER)]))).toBe(false);
    expect(cmd.canMergeWith(composite([place()]))).toBe(false);
    expect(cmd.canMergeWith(composite([place(), insertBar(), insertBar()]))).toBe(false);
    // ほかのまとまり：小節の挿入そのもの・小節の削除・音符の移動・奏法記号の 2 つの音符への付け方・音価のまとめ変更
    expect(cmd.canMergeWith(insertBar())).toBe(false);
    expect(cmd.canMergeWith(new DeleteBarCommand(target, 0, 'none'))).toBe(false);
    expect(
      cmd.canMergeWith(
        new CompositeCommand('move-note', 'move-note', [new DeleteNotesCommand(target, [], []), place()]),
      ),
    ).toBe(false);
    expect(
      cmd.canMergeWith(
        new CompositeCommand('set-technique', 'set-technique', [
          new SetTechniqueCommand(target, at(0), 3, { isPalmMute: true }),
          new SetTechniqueCommand(target, at(0), 3, { isPalmMute: true }),
        ]),
      ),
    ).toBe(false);
    expect(
      cmd.canMergeWith(
        new CompositeCommand('set-beat-duration', 'set-beat-duration', [
          new SetBeatDurationCommand(target, at(0), QUARTER),
        ]),
      ),
    ).toBe(false);
  });

  it('SetNoteFretCommand_履歴で前の置いた音符と足した小節のまとまりに重ねる_1回の取り消しで両方が戻りやり直しで両方が当たる', () => {
    // UT-EDIT-NOTEFRET-11 4.2 節「書き換えは、前の PlaceNoteCommand と履歴の 1 つの項目にまとめる（…その PlaceNoteCommand と
    //   InsertBarCommand をまとめた CompositeCommand（531 行）のときだけ真を返す）。1 回の取り消しで 2 桁の入力が全部戻り」
    const history = new CommandHistory(new RecordingRenderRequester(), new RecordingReporter());
    const empty = scoreJson(target);
    history.execute(
      new CompositeCommand('place-note-append-bar', 'place-note', [
        new PlaceNoteCommand(target, at(1), 4, 1, QUARTER),
        new InsertBarCommand(target, 1),
      ]),
    );
    const fret = new SetNoteFretCommand(target, at(1), 4, 15);
    history.execute(fret);
    expect(getBeat(target.score, 0, 0, 1).notes[0]!.fret).toBe(15);
    expect(target.score.masterBars).toHaveLength(2);
    expect(countUndoable(history)).toBe(1);
    expect(fret.label).toBe('place-note');

    history.undo();
    expect(scoreJson(target)).toBe(empty);
    expect(target.score.masterBars).toHaveLength(1);
    expect(history.canUndo()).toBe(false);
    // やり直しは足した小節を作り直すので、拍と小節の中身で確かめる（作り直した Bar の id は変わる）
    history.redo();
    expect(getBeat(target.score, 0, 0, 1).notes.map((n) => [n.string, n.fret])).toEqual([[4, 15]]);
    expect(target.score.masterBars).toHaveLength(2);
    expect(getBar(target.score, 0, 1).voices).toHaveLength(1);
  });

  it('SetNoteFretCommand_パートが2つの曲で重ねる_足した小節のまとまりなら両方のパートで置いた音符だけなら今のパートのまま', () => {
    // UT-EDIT-NOTEFRET-12 4.2 節「affectedTrackIndices は [position.trackIndex]。CompositeCommand に重ねたあとは、取り込んだまとまりの
    //   affectedTrackIndices との和集合」・2.3 節「affectedTrackIndices は children の和集合」
    const two = buildEditTarget(2);
    const second = (beatIndex: number): CursorPosition => ({ ...at(beatIndex), trackIndex: 1 });
    const history = new CommandHistory(new RecordingRenderRequester(), new RecordingReporter());
    history.execute(
      new CompositeCommand('place-note-append-bar', 'place-note', [
        new PlaceNoteCommand(two, second(0), 3, 1, QUARTER),
        new InsertBarCommand(two, 1),
      ]),
    );
    const onAppendBar = new SetNoteFretCommand(two, second(0), 3, 12);
    expect(onAppendBar.affectedTrackIndices).toEqual([1]);
    history.execute(onAppendBar);
    expect(countUndoable(history)).toBe(1);
    expect(onAppendBar.affectedTrackIndices).toEqual([0, 1]);

    history.execute(new PlaceNoteCommand(two, second(1), 3, 1, QUARTER));
    const onPlaceOnly = new SetNoteFretCommand(two, second(1), 3, 13);
    history.execute(onPlaceOnly);
    expect(countUndoable(history)).toBe(2);
    expect(onPlaceOnly.affectedTrackIndices).toEqual([1]);
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

  it('SetNoteFretCommand_ボイス2の位置_2つ目のボイスの音符を書き換え1つ目のボイスは変えない', () => {
    // UT-EDIT-NOTEFRET-08 editing-core.md 3.1 節「カーソルは、選んでいるボイス（`Bar.voices` の 1 つ目か 2 つ目）の拍（`Beat`）の上だけを動く」・4.1 節 CursorPosition.voiceIndex
    const v2: CursorPosition = { ...at(0), voiceIndex: 1 };
    // 1 つ目のボイスの拍 0 にも同じ弦 3 の音（フレット 1）がある
    new PlaceNoteCommand(target, v2, 3, 2, QUARTER).execute();
    const withSecond = scoreJson(target);

    const cmd = new SetNoteFretCommand(target, v2, 3, 12);
    cmd.execute();
    expect(getBeat(target.score, 0, 0, 0, 1).notes[0]!.fret).toBe(12);
    expect(getBeat(target.score, 0, 0, 0, 0).notes[0]!.fret).toBe(1);
    cmd.undo();
    expect(getBeat(target.score, 0, 0, 0, 1).notes[0]!.fret).toBe(2);
    expect(scoreJson(target)).toBe(withSecond);
  });

  it('SetNoteFretCommand_2つ目のボイスが無い小節のボイス2の位置_投げずに何もしない', () => {
    // UT-EDIT-NOTEFRET-09 editing-core.md 4.1 節「2 つ目のボイスがまだ無い小節では、ボイス 2 を選んだときのカーソルの位置は拍 0（最後の拍の後ろ）だけとし」
    expect(getBar(target.score, 0, 0).voices).toHaveLength(1);
    const cmd = new SetNoteFretCommand(target, { ...at(0), voiceIndex: 1 }, 3, 12);
    expect(() => cmd.execute()).not.toThrow();
    expect(scoreJson(target)).toBe(before);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });
});
