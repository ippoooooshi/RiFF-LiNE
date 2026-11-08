// UT-EDIT-PASTE: PasteCommand と ClipboardService（コピーと貼り付け、B3 の弦の数の決まり）
// 検証節: editing-core.md 2.3 節・2.6 節の表・9 節、基本設計 04 章 9 節
// 検証観点（C2）: CompositeCommand として子を 9 節の順（拍ごとに InsertRestCommand → 音符ごとの PlaceNoteCommand）に組み、1 回の取り消しで全体が戻る。
//               弦の数が足りない（EDIT-009、はみ出す弦の子を作らない）／同じ／多い（知らせない）、カーソルが最後の拍の後ろより先、やり直し。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { PasteCommand } from './PasteCommand';
import { PlaceNoteCommand } from './PlaceNoteCommand';
import { createEmptyAppMetadata } from '../../domain/SongDocument';
import { createInitialScore } from '../../domain/newSong';
import { ClipboardService, type ClipboardSnapshot } from '../ClipboardService';
import { CompositeCommand } from '../CompositeCommand';
import { getBar, getBeat, getStaff, getVoice, insertBeatAt } from '../scoreModel';
import type { BeatDurationSpec, CursorPosition, EditTarget } from '../types';
import { buildEditTarget, RecordingReporter, scoreJson } from '../../testing/editingFakes';

const QUARTER: BeatDurationSpec = { duration: model.Duration.Quarter, dots: 0, tuplet: null };

/** track0 = 6弦ギター、track1 = 4弦ベースの target。 */
function guitarAndBass(): EditTarget {
  const score = createInitialScore({
    title: 'GB',
    parts: [
      { name: 'Guitar', instrumentType: 'electric_guitar', tuning: [64, 59, 55, 50, 45, 40] },
      { name: 'Bass', instrumentType: 'bass', tuning: [43, 38, 33, 28] },
    ],
  });
  return { score, appMeta: createEmptyAppMetadata() };
}

/** 小節 0 の拍 beatIndex（パート trackIndex）。 */
function at(beatIndex: number, trackIndex = 0): CursorPosition {
  return { trackIndex, barIndex: 0, voiceIndex: 0, beatIndex };
}

/** パートの小節 0 のボイス 0 を、渡したフレット（弦 3）の 4 分音符の拍で置き直す。 */
function fillBar(target: EditTarget, frets: number[], trackIndex = 0): model.Voice {
  const voice = getStaff(target.score, trackIndex).bars[0]!.voices[0]!;
  voice.beats.splice(0);
  frets.forEach((fret, i) => {
    const beat = new model.Beat();
    beat.duration = model.Duration.Quarter;
    const note = new model.Note();
    note.string = 3;
    note.fret = fret;
    beat.addNote(note);
    insertBeatAt(voice, i, beat);
  });
  return voice;
}

function childKinds(command: CompositeCommand): string[] {
  return (command as unknown as { children: readonly { kind: string }[] }).children.map((c) => c.kind);
}

describe('ClipboardService + PasteCommand', () => {
  it('copyThenPaste_SamePart_RoundTrips_UndoRestores', () => {
    // UT-EDIT-PASTE-01 9 節「カーソルのある小節と拍の前へ、クリップボードの拍を順に挿入する」「今ある拍を上書きしない」
    const target = buildEditTarget();
    fillBar(target, [5, 7]);
    const before = scoreJson(target);

    const clip = new ClipboardService();
    clip.copy(target, {
      trackIndex: 0,
      voiceIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 0,
      endBeatIndex: 1,
    });
    expect(clip.hasContent()).toBe(true);

    const reporter = new RecordingReporter();
    const paste = new PasteCommand(target, at(2), clip.getSnapshot()!, reporter);
    paste.execute();
    const voice = getVoice(getBar(target.score, 0, 0));
    expect(voice.beats.map((b) => b.notes[0]!.fret)).toEqual([5, 7, 5, 7]); // 2 元 + 2 貼付
    expect(reporter.reports).toEqual([]); // 同一パート＝弦数十分

    paste.undo();
    expect(getVoice(getBar(target.score, 0, 0)).beats.length).toBe(2);
    expect(scoreJson(target)).toBe(before);
  });

  it('EDIT-009: 弦の少ないパートへの貼り付け', () => {
    // UT-EDIT-PASTE-02 9 節「貼り付け先の弦の数が足りないときは、はみ出す弦の音符を捨て、Warning（EDIT-009）で知らせる」
    const target = guitarAndBass();
    const snapshot: ClipboardSnapshot = {
      beats: [
        {
          duration: model.Duration.Quarter,
          notes: [
            { string: 6, fret: 3 },
            { string: 2, fret: 5 },
          ],
        },
      ],
    };

    const reporter = new RecordingReporter();
    // ベース(track1、4弦)へ貼り付け → 弦6は破棄し、子を作らない
    const paste = new PasteCommand(target, at(1, 1), snapshot, reporter);
    expect(childKinds(paste)).toEqual(['insert-rest', 'place-note']);
    expect(reporter.reports).toEqual([{ code: 'EDIT-009', context: { droppedCount: 1, targetStringCount: 4 } }]);
    paste.execute();

    const pastedBeat = getBeat(target.score, 1, 0, 1);
    expect(pastedBeat.notes.map((n) => [n.string, n.fret])).toEqual([[2, 5]]);

    // undo → redo で EDIT-009 が再通知されない
    paste.undo();
    paste.execute();
    expect(reporter.reports.filter((r) => r.code === 'EDIT-009')).toHaveLength(1);
  });

  it('paste_TargetHasMoreStrings_NoWarning_KeepsFret', () => {
    // UT-EDIT-PASTE-03 9 節「弦の数が多いときは、余った弦を使わない」「知らせを出さない」「フレットの数を保って写す」
    const target = guitarAndBass();
    const snapshot: ClipboardSnapshot = {
      beats: [{ duration: model.Duration.Eighth, notes: [{ string: 4, fret: 5 }] }],
    };

    const reporter = new RecordingReporter();
    // ギター(track0、6弦)へ貼り付け → 破棄なし
    const paste = new PasteCommand(target, at(1), snapshot, reporter);
    paste.execute();
    const beat = getBeat(target.score, 0, 0, 1);
    expect(beat.notes.map((n) => [n.string, n.fret])).toEqual([[4, 5]]);
    expect(beat.duration).toBe(model.Duration.Eighth);
    expect(reporter.reports).toEqual([]);
  });

  it('PasteCommand_子のコマンド_9節の順に並んだCompositeCommandで範囲は貼り付け先のパート', () => {
    // UT-EDIT-PASTE-04 2.6 節の表「PasteCommand は CompositeCommand として構成する」「範囲は貼り付け先のパート」・9 節の子の順
    const target = guitarAndBass();
    const snapshot: ClipboardSnapshot = {
      beats: [
        {
          duration: model.Duration.Quarter,
          notes: [
            { string: 1, fret: 0 },
            { string: 2, fret: 1 },
          ],
        },
        { duration: model.Duration.Half, notes: [] },
      ],
    };
    const paste = new PasteCommand(target, at(0, 1), snapshot, new RecordingReporter());
    expect(paste).toBeInstanceOf(CompositeCommand);
    expect(paste.kind).toBe('paste');
    expect(paste.label).toBe('paste');
    expect(childKinds(paste)).toEqual(['insert-rest', 'place-note', 'place-note', 'insert-rest']);
    expect([...paste.affectedTrackIndices]).toEqual([1]);
    expect(paste.estimateSizeBytes()).toBeGreaterThan(0);

    const before = scoreJson(target);
    paste.execute();
    const voice = getVoice(getBar(target.score, 1, 0));
    // 和音の拍・休符の拍・元の全音符の休符の拍
    expect(voice.beats.map((b) => b.notes.length)).toEqual([2, 0, 0]);
    expect(voice.beats[1]!.duration).toBe(model.Duration.Half);
    paste.undo();
    expect(scoreJson(target)).toBe(before);
    // やり直すと同じ結果（C2 の対称性）
    paste.execute();
    expect(getVoice(getBar(target.score, 1, 0)).beats.map((b) => b.notes.length)).toEqual([2, 0, 0]);
  });

  it('PasteCommand_カーソルが最後の拍の後ろより先_最後の拍の後ろから続けて挿入する', () => {
    // UT-EDIT-PASTE-05 9 節（貼り付ける位置はカーソルの位置。拍の並びの外は最後の拍の後ろ）
    const target = buildEditTarget();
    const voice = fillBar(target, [1]);
    const snapshot: ClipboardSnapshot = {
      beats: [
        { duration: model.Duration.Quarter, notes: [{ string: 3, fret: 8 }] },
        { duration: model.Duration.Quarter, notes: [{ string: 3, fret: 9 }] },
      ],
    };
    new PasteCommand(target, at(9), snapshot, new RecordingReporter()).execute();
    expect(voice.beats.map((b) => b.notes[0]!.fret)).toEqual([1, 8, 9]);
  });

  it('PasteCommand_ボイス2の位置_2つ目のボイスの拍の数で位置を決めて貼り1つ目のボイスは変えない', () => {
    // UT-EDIT-PASTE-06 editing-core.md 3.1 節「貼り付けは選んでいるボイスへ貼り」「もう一方のボイスの拍は、写しも書き換えもしない」・4.1 節 CursorPosition.voiceIndex
    const target = buildEditTarget();
    const first = fillBar(target, [1]);
    const v2 = (beatIndex: number): CursorPosition => ({ ...at(beatIndex), voiceIndex: 1 });
    // ボイス 2 は 3 拍（1 つ目のボイスは 1 拍）
    [4, 5, 6].forEach((fret, i) => new PlaceNoteCommand(target, v2(i), 2, fret, QUARTER).execute());
    const second = getVoice(getBar(target.score, 0, 0), 1);
    const before = scoreJson(target);
    const snapshot: ClipboardSnapshot = {
      beats: [{ duration: model.Duration.Quarter, notes: [{ string: 2, fret: 9 }] }],
    };

    const paste = new PasteCommand(target, v2(9), snapshot, new RecordingReporter());
    paste.execute();
    // 最後の拍の後ろは、ボイス 2 の拍の数（3）で決まる
    expect(second.beats.map((b) => b.notes[0]!.fret)).toEqual([4, 5, 6, 9]);
    expect(first.beats.map((b) => b.notes[0]!.fret)).toEqual([1]);
    paste.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('ClipboardService_ボイス2の選択範囲_2つ目のボイスの拍だけを写す', () => {
    // UT-EDIT-PASTE-07 editing-core.md 3.1 節「コピーと切り取りは、選んでいるボイスの拍だけを写し」「もう一方のボイスの拍は、写しも書き換えもしない」・9 節 SelectionRange.voiceIndex
    const target = buildEditTarget();
    fillBar(target, [5, 7]);
    new PlaceNoteCommand(target, { ...at(0), voiceIndex: 1 }, 2, 9, QUARTER).execute();
    new PlaceNoteCommand(target, { ...at(1), voiceIndex: 1 }, 2, 10, QUARTER).execute();

    const clip = new ClipboardService();
    clip.copy(target, {
      trackIndex: 0,
      voiceIndex: 1,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 0,
      endBeatIndex: 1,
    });
    expect(clip.getSnapshot()!.beats).toEqual([
      { duration: model.Duration.Quarter, notes: [{ string: 2, fret: 9 }] },
      { duration: model.Duration.Quarter, notes: [{ string: 2, fret: 10 }] },
    ]);
  });

  it('PasteCommand_2つ目のボイスが無い小節のボイス2の拍0_ボイス2を作って貼りundoで外す', () => {
    // UT-EDIT-PASTE-08 editing-core.md 4.1 節「2 つ目のボイスがまだ無い小節では、ボイス 2 を選んだときのカーソルの位置は拍 0（最後の拍の後ろ）だけとし、音か休符を置いたときに、その小節の `Bar.voices` に 2 つ目の `Voice` を作る」
    const target = buildEditTarget();
    const first = fillBar(target, [1]);
    const bar = getBar(target.score, 0, 0);
    expect(bar.voices).toHaveLength(1);
    const before = scoreJson(target);
    const snapshot: ClipboardSnapshot = {
      beats: [
        { duration: model.Duration.Quarter, notes: [{ string: 2, fret: 9 }] },
        { duration: model.Duration.Eighth, notes: [] },
      ],
    };

    const paste = new PasteCommand(target, { ...at(0), voiceIndex: 1 }, snapshot, new RecordingReporter());
    paste.execute();
    expect(bar.voices).toHaveLength(2);
    const second = getVoice(bar, 1);
    expect(second.beats.map((b) => b.notes.map((n) => [n.string, n.fret]))).toEqual([[[2, 9]], []]);
    expect(second.beats[1]!.duration).toBe(model.Duration.Eighth);
    expect(first.beats.map((b) => b.notes[0]!.fret)).toEqual([1]);

    paste.undo();
    expect(bar.voices).toHaveLength(1);
    expect(scoreJson(target)).toBe(before);
  });
});
