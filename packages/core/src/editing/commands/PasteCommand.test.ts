// UT-EDIT-PASTE: PasteCommand と ClipboardService（コピーと貼り付け、B3 の弦の数の決まり）
// 検証節: editing-core.md 2.3 節・2.6 節の表・9 節、基本設計 04 章 9 節
// 検証観点（C2）: CompositeCommand として子を 9 節の順（拍ごとに InsertRestCommand → 音符ごとの PlaceNoteCommand と、奏法記号のある音符の
//               SetTechniqueCommand → あるときだけ SetBeatTechniqueCommand）に組み、1 回の取り消しで全体が戻る。
//               弦の数が足りない（EDIT-009、はみ出す弦の子を作らない）／同じ／多い（知らせない）、カーソルが最後の拍の後ろより先、やり直し。
//               クリップボードへ写す中身（音価の 3 つの要素・Note と Beat の奏法記号。タイとスラーは写さない）と copyAt の 1 拍の形。

import { describe, expect, it, vi } from 'vitest';

import { model } from '@coderline/alphatab';

import type * as InsertRestModule from './InsertRestCommand';
import { fitSnapshotToStrings, PasteCommand } from './PasteCommand';
import { InsertBarCommand } from './barCommands';
import { PlaceNoteCommand } from './PlaceNoteCommand';
import { createEmptyAppMetadata } from '../../domain/SongDocument';
import { createInitialScore } from '../../domain/newSong';
import { ClipboardService, type ClipboardBeat, type ClipboardSnapshot } from '../ClipboardService';
import { CompositeCommand } from '../CompositeCommand';
import { getBar, getBeat, getStaff, getVoice, insertBeatAt } from '../scoreModel';
import type { BeatDurationSpec, CursorPosition, EditTarget } from '../types';
import { buildEditTarget, RecordingReporter, scoreJson } from '../../testing/editingFakes';
import { rebuildBeforeRender } from '../../testing/noteAttributeFixtures';

/**
 * 子のコマンドを作った数を数えるために、InsertRestCommand を、作るたびに数を足すだけの継いだクラスに差し替える
 * （動きは元のクラスのまま。弦の数の確かめと知らせが子を作る前にあることを確かめる UT-EDIT-PASTE-14 が読む）。
 */
const insertRestCount = vi.hoisted(() => ({ value: 0 }));
vi.mock('./InsertRestCommand', async (importOriginal) => {
  const original = await importOriginal<typeof InsertRestModule>();
  class CountingInsertRestCommand extends original.InsertRestCommand {
    constructor(...args: ConstructorParameters<typeof original.InsertRestCommand>) {
      super(...args);
      insertRestCount.value += 1;
    }
  }
  return { ...original, InsertRestCommand: CountingInsertRestCommand };
});

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

/** 奏法記号の無いクリップボードの拍（音価は付点・連符なし）。notes は [弦, フレット] の並び。 */
function clipBeat(duration: model.Duration, notes: [number, number][]): ClipboardBeat {
  return {
    duration: { duration, dots: 0, tuplet: null },
    notes: notes.map(([string, fret]) => ({ string, fret, techniques: {} })),
    beatTechniques: {},
  };
}

/** パートごとの、小節ごとの 1 つ目のボイスの拍の数。 */
function voiceBeatCounts(target: EditTarget): number[][] {
  return target.score.tracks.map((_track, t) =>
    getStaff(target.score, t).bars.map((bar) => bar.voices[0]!.beats.length),
  );
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
        clipBeat(model.Duration.Quarter, [
          [6, 3],
          [2, 5],
        ]),
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
      beats: [clipBeat(model.Duration.Eighth, [[4, 5]])],
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
        clipBeat(model.Duration.Quarter, [
          [1, 0],
          [2, 1],
        ]),
        clipBeat(model.Duration.Half, []),
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
      beats: [clipBeat(model.Duration.Quarter, [[3, 8]]), clipBeat(model.Duration.Quarter, [[3, 9]])],
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
      beats: [clipBeat(model.Duration.Quarter, [[2, 9]])],
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
      clipBeat(model.Duration.Quarter, [[2, 9]]),
      clipBeat(model.Duration.Quarter, [[2, 10]]),
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
      beats: [clipBeat(model.Duration.Quarter, [[2, 9]]), clipBeat(model.Duration.Eighth, [])],
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

  it('ClipboardService_奏法記号のある範囲をコピー_音価の3要素とNoteとBeatの奏法記号を写しタイとスラーは写さない', () => {
    // UT-EDIT-PASTE-09 9 節の (b)「写すのは、拍の音価（BeatDurationSpec）と、音符の弦とフレットと Note の奏法記号（NoteTechniquePatch の形）と、
    // 拍の Beat の単位の奏法記号（BeatTechniquePatch の形）とする。タイとスラーの印は写さない」・「写す中身（ClipboardSnapshot）は数と真偽だけでできている」
    const target = buildEditTarget();
    const voice = fillBar(target, [5, 7]);
    const first = voice.beats[0]!;
    first.duration = model.Duration.Eighth;
    first.dots = 1;
    first.tupletNumerator = 3;
    first.tupletDenominator = 2;
    first.slap = true;
    first.brushType = model.BrushType.BrushDown;
    const note = first.notes[0]!;
    note.isPalmMute = true;
    note.slideOutType = model.SlideOutType.Shift;
    note.harmonicType = model.HarmonicType.Artificial;
    note.harmonicValue = 12;
    note.addBendPoint(new model.BendPoint(0, 0));
    note.addBendPoint(new model.BendPoint(60, 4));
    note.bendType = model.BendType.Bend;
    // タイとスラーの印（写さない）
    note.isTieDestination = true;
    note.isSlurDestination = true;
    const plain = new model.Note();
    plain.string = 4;
    plain.fret = 7;
    first.addNote(plain);
    // 2 つ目の拍は休符にする
    voice.beats[1]!.removeNote(voice.beats[1]!.notes[0]!);

    const clip = new ClipboardService();
    clip.copy(target, {
      trackIndex: 0,
      voiceIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 0,
      endBeatIndex: 1,
    });
    const snapshot = clip.getSnapshot()!;
    expect(snapshot.beats).toEqual([
      {
        duration: { duration: model.Duration.Eighth, dots: 1, tuplet: { numerator: 3, denominator: 2 } },
        notes: [
          {
            string: 3,
            fret: 5,
            techniques: {
              slideOutType: model.SlideOutType.Shift,
              harmonicType: model.HarmonicType.Artificial,
              harmonicValue: 12,
              isPalmMute: true,
              bendType: model.BendType.Bend,
              bendPoints: [
                { offset: 0, value: 0 },
                { offset: 60, value: 4 },
              ],
            },
          },
          { string: 4, fret: 7, techniques: {} },
        ],
        beatTechniques: { slap: true, brushType: model.BrushType.BrushDown },
      },
      clipBeat(model.Duration.Quarter, []),
    ]);
    // 数と真偽だけ（文字列にして戻しても同じ）
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('ClipboardService_残りの奏法記号と受けない種類_付いているものだけ写しピックスライドと自然ハーモニクスの値は写さない', () => {
    // UT-EDIT-PASTE-10 9 節の (b)（Note と Beat の奏法記号を patch の形で写す）・3.5 節（スライドは 6 つ）・7.3 節（自然ハーモニクスの値はコマンドがフレットから入れる）
    const target = buildEditTarget();
    const voice = fillBar(target, [5, 12]);
    const [a, b] = [voice.beats[0]!.notes[0]!, voice.beats[1]!.notes[0]!];
    a.slideInType = model.SlideInType.IntoFromBelow;
    a.slideOutType = model.SlideOutType.PickSlideDown; // 3.5 節の種類の外
    a.isHammerPullOrigin = true;
    a.vibrato = model.VibratoType.Slight;
    a.isGhost = true;
    a.isStaccato = true;
    a.accentuated = model.AccentuationType.Heavy;
    b.harmonicType = model.HarmonicType.Natural;
    b.harmonicValue = 12;
    voice.beats[1]!.pop = true;
    voice.beats[1]!.tap = true;

    const clip = new ClipboardService();
    clip.copy(target, {
      trackIndex: 0,
      voiceIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 0,
      endBeatIndex: 1,
    });
    const [first, second] = clip.getSnapshot()!.beats;
    expect(first!.notes[0]!.techniques).toEqual({
      slideInType: model.SlideInType.IntoFromBelow,
      isHammerPullOrigin: true,
      vibrato: model.VibratoType.Slight,
      isGhost: true,
      isStaccato: true,
      accentuated: model.AccentuationType.Heavy,
    });
    expect(first!.beatTechniques).toEqual({});
    expect(second!.notes[0]!.techniques).toEqual({ harmonicType: model.HarmonicType.Natural });
    expect(second!.beatTechniques).toEqual({ pop: true, tap: true });
  });

  it('ClipboardService_copyAt_音符なら音符1つだけの1拍_休符の拍なら音符の無い1拍_無い所なら変えない', () => {
    // UT-EDIT-PASTE-11 9 節「音符（NoteRef）なら、その拍の音価と Beat の単位の奏法記号と、その音符 1 つ（弦・フレット・Note の奏法記号）だけを持つ 1 拍を、
    // 休符の拍（CursorPosition）なら、その音価の音符の無い 1 拍を、ClipboardService.copyAt でクリップボードへ写す」
    const target = buildEditTarget();
    const voice = fillBar(target, [5, 7]);
    const chord = voice.beats[0]!;
    chord.tap = true;
    const other = new model.Note();
    other.string = 1;
    other.fret = 2;
    other.isGhost = true;
    chord.addNote(other);
    const rest = new model.Beat();
    rest.duration = model.Duration.Half;
    insertBeatAt(voice, 2, rest);

    const clip = new ClipboardService();
    expect(clip.hasContent()).toBe(false);
    expect(clip.getSnapshot()).toBeNull();
    clip.copyAt(target, { position: at(0), stringNumber: 1 });
    expect(clip.getSnapshot()!.beats).toEqual([
      {
        duration: { duration: model.Duration.Quarter, dots: 0, tuplet: null },
        notes: [{ string: 1, fret: 2, techniques: { isGhost: true } }],
        beatTechniques: { tap: true },
      },
    ]);
    clip.copyAt(target, at(2));
    expect(clip.getSnapshot()!.beats).toEqual([clipBeat(model.Duration.Half, [])]);
    expect(clip.hasContent()).toBe(true);

    // 指した所に拍も音符も無いとき（画面からは渡らない）は変えない
    const kept = clip.getSnapshot();
    clip.copyAt(target, at(9));
    clip.copyAt(target, { position: at(1), stringNumber: 6 });
    expect(clip.getSnapshot()).toBe(kept);

    clip.clear();
    expect(clip.getSnapshot()).toBeNull();
    expect(clip.hasContent()).toBe(false);
  });

  it('PasteCommand_奏法記号のある拍_奏法記号の子を音符ごととBeatの1つ作り1回の取り消しで全体が戻る', () => {
    // UT-EDIT-PASTE-12 9 節「子として…Note の奏法記号を写す SetTechniqueCommand（奏法記号のある音符ごと）、Beat の奏法記号を写す
    // SetBeatTechniqueCommand（あるときだけ）を、挿入する順に並べる」「1 回の取り消しで貼り付け全体が戻る」
    const target = guitarAndBass();
    const snapshot: ClipboardSnapshot = {
      beats: [
        {
          duration: { duration: model.Duration.Eighth, dots: 1, tuplet: { numerator: 3, denominator: 2 } },
          notes: [
            { string: 3, fret: 7, techniques: { isPalmMute: true, harmonicType: model.HarmonicType.Natural } },
            { string: 2, fret: 9, techniques: {} },
            { string: 6, fret: 1, techniques: { isGhost: true } }, // ベースでははみ出す
          ],
          beatTechniques: { slap: true },
        },
        clipBeat(model.Duration.Quarter, [[1, 3]]),
      ],
    };
    const reporter = new RecordingReporter();
    const paste = new PasteCommand(target, at(0, 1), snapshot, reporter);
    expect(childKinds(paste)).toEqual([
      'insert-rest',
      'place-note',
      'set-technique',
      'place-note',
      'set-beat-technique',
      'insert-rest',
      'place-note',
    ]);
    expect(reporter.reports).toEqual([{ code: 'EDIT-009', context: { droppedCount: 1, targetStringCount: 4 } }]);

    const before = scoreJson(target);
    paste.execute();
    const beat = getBeat(target.score, 1, 0, 0);
    expect([beat.duration, beat.dots, beat.tupletNumerator, beat.tupletDenominator]).toEqual([
      model.Duration.Eighth,
      1,
      3,
      2,
    ]);
    expect(beat.slap).toBe(true);
    const palm = beat.notes.find((n) => n.string === 3)!;
    expect(palm.isPalmMute).toBe(true);
    // 自然ハーモニクスの値は、貼った先のコマンドがフレットから入れる（7.3 節）
    expect(palm.harmonicType).toBe(model.HarmonicType.Natural);
    expect(palm.harmonicValue).toBe(7);
    expect(beat.notes.find((n) => n.string === 2)!.isPalmMute).toBe(false);
    paste.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('fitSnapshotToStrings_弦の数で確かめる_はみ出す弦の音符だけを捨てて数え拍とクリップボードの中身は変えない', () => {
    // UT-EDIT-PASTE-13 9 節「弦の数の確かめ（はみ出す弦の音符を捨てて EDIT-009 を出す、下の箇条）は子を作る前に行い、捨てた音符の子は作らない」・
    // 「貼り付け先の弦の数が多いときは、余った弦を使わない」
    const snapshot: ClipboardSnapshot = {
      beats: [
        clipBeat(model.Duration.Quarter, [
          [6, 3],
          [4, 1],
          [5, 2],
        ]),
        clipBeat(model.Duration.Half, []),
        clipBeat(model.Duration.Eighth, [[1, 0]]),
      ],
    };
    const copy = structuredClone(snapshot);
    const fitted = fitSnapshotToStrings(snapshot, 4);
    expect(fitted.droppedCount).toBe(2);
    expect(fitted.beats).toEqual([
      clipBeat(model.Duration.Quarter, [[4, 1]]),
      clipBeat(model.Duration.Half, []),
      clipBeat(model.Duration.Eighth, [[1, 0]]),
    ]);
    expect(snapshot).toEqual(copy);
    // 弦の数が足りていれば何も捨てない
    expect(fitSnapshotToStrings(snapshot, 6)).toEqual({ beats: copy.beats, droppedCount: 0 });
  });

  it('PasteCommand_知らせを出す時_子のコマンドを作る前で貼り付け先の曲はまだ変わっていない', () => {
    // UT-EDIT-PASTE-14 9 節「弦の数の確かめ（はみ出す弦の音符を捨てて EDIT-009 を出す、下の箇条）は子を作る前に行い」
    const target = guitarAndBass();
    const before = scoreJson(target);
    // 知らせを受けた時点で作られていた子のコマンド（InsertRestCommand）の数
    const seen: { code: string; constructedChildren: number }[] = [];
    const reporter = {
      report(code: string): void {
        seen.push({ code, constructedChildren: insertRestCount.value });
      },
    };
    insertRestCount.value = 0;
    const paste = new PasteCommand(
      target,
      at(0, 1),
      { beats: [clipBeat(model.Duration.Quarter, [[6, 3]]), clipBeat(model.Duration.Quarter, [[1, 3]])] },
      reporter,
    );
    expect(seen).toEqual([{ code: 'EDIT-009', constructedChildren: 0 }]);
    expect(insertRestCount.value).toBe(2);
    expect(childKinds(paste)).toEqual(['insert-rest', 'insert-rest', 'place-note']);
    expect(scoreJson(target)).toBe(before);
  });

  it('PasteCommand_貼り付けと取り消しの後_どの小節のボイスにも拍がありどの位置も休符か音の拍で描く前の作り直しが通る', () => {
    // UT-EDIT-PASTE-15 3.3 節「小節を作ったときは、そのボイスに全音符の長さの休符の Beat を 1 つ置く」（貼り付けは拍を挿入するだけで、拍の無い小節を作らない）
    const target = guitarAndBass();
    new InsertBarCommand(target, 1).execute();
    const snapshot: ClipboardSnapshot = {
      beats: [clipBeat(model.Duration.Quarter, [[6, 3]]), clipBeat(model.Duration.Half, [])],
    };
    const paste = new PasteCommand(target, at(0, 1), snapshot, new RecordingReporter());
    paste.execute();
    expect(voiceBeatCounts(target)).toEqual([
      [1, 1],
      [3, 1],
    ]);
    expect(() => rebuildBeforeRender(target.score)).not.toThrow();
    paste.undo();
    expect(voiceBeatCounts(target)).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(() => rebuildBeforeRender(target.score)).not.toThrow();
  });

  it('ClipboardService_3.5節の外のハーモニクス_TapとSemiとFeedbackは写さず3種は写して貼った先にも外の値が入らない', () => {
    // UT-EDIT-PASTE-16 9 節「Note の奏法記号のうち 3.5 節の外の値（ピックスライドも含む）は写さない」・3.5 節「ハーモニクス 3 種」
    // （Natural・Artificial・Pinch。alphaTab の Tap・Semi・Feedback は、ピックスライドと同じく写さない）
    const outside = [model.HarmonicType.Tap, model.HarmonicType.Semi, model.HarmonicType.Feedback];
    const inside = [model.HarmonicType.Natural, model.HarmonicType.Artificial, model.HarmonicType.Pinch];
    const target = buildEditTarget();
    const voice = fillBar(target, [5, 7, 9, 12, 3, 4]);
    [...outside, ...inside].forEach((harmonicType, i) => {
      const note = voice.beats[i]!.notes[0]!;
      note.harmonicType = harmonicType;
      note.harmonicValue = 12;
      note.isPalmMute = true; // 3.5 節の中の記号は、外のハーモニクスと一緒に付いていても写す
    });

    const clip = new ClipboardService();
    clip.copy(target, {
      trackIndex: 0,
      voiceIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 0,
      endBeatIndex: 5,
    });
    const beats = clip.getSnapshot()!.beats;
    expect(beats.map((beat) => beat.notes[0]!.techniques)).toEqual([
      { isPalmMute: true },
      { isPalmMute: true },
      { isPalmMute: true },
      { harmonicType: model.HarmonicType.Natural, isPalmMute: true },
      { harmonicType: model.HarmonicType.Artificial, harmonicValue: 12, isPalmMute: true },
      { harmonicType: model.HarmonicType.Pinch, isPalmMute: true },
    ]);

    // 貼った先の音符にも 3.5 節の外のハーモニクスは入らない
    const pasteTarget = buildEditTarget();
    new PasteCommand(pasteTarget, at(0), clip.getSnapshot()!, new RecordingReporter()).execute();
    const pasted = getVoice(getBar(pasteTarget.score, 0, 0))
      .beats.slice(0, 6)
      .map((beat) => beat.notes[0]!.harmonicType);
    expect(pasted).toEqual([model.HarmonicType.None, model.HarmonicType.None, model.HarmonicType.None, ...inside]);
  });
});
