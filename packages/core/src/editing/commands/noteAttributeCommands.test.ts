// UT-EDIT-ATTR: SetTieCommand・SetSlurCommand・SetTechniqueCommand・SetChordNameCommand・naturalHarmonicValue <!-- req webcorefoundation:70d77fab.4c87 -->
// UT-EDIT-BEATTECH: SetBeatTechniqueCommand（各テストに連番つきの ID を書く） <!-- req webcorefoundation:eb42fe4e.1cb6 --> <!-- req webcorefoundation:45b9a8e8.4bbd -->
// 検証節: editing-core.md 2.2 節・2.4 節・2.6 節・3.4 節・3.5 節・7.2 節・7.3 節・8 節
// 検証観点: 属性の当て方と、execute と undo の対称性（C2。undo で Score の JSON が前と同じに戻る）。 <!-- req webcorefoundation:33b2c87c.b2af -->
//   相手の音符が無いときに何もしないこと。finish() が作る派生情報（タイのつながり）を変えないこと。

import { beforeEach, describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { PlaceNoteCommand } from './PlaceNoteCommand';
import { CompositeCommand } from '../CompositeCommand';
import {
  ACCENTUATION_TYPES,
  createPalmMuteCommand,
  naturalHarmonicValue,
  SetBeatTechniqueCommand,
  SLIDE_IN_TYPES,
  SLIDE_OUT_TYPES,
  SetChordNameCommand,
  SetSlurCommand,
  SetTechniqueCommand,
  SetTieCommand,
} from './noteAttributeCommands';
import { getBar, getBeat, getStaff } from '../scoreModel';
import type { BeatDurationSpec, CursorPosition, EditTarget, SelectionRange } from '../types';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';
import { harmonicValueReadFromAlphaTexNh, rebuildBeforeRender } from '../../testing/noteAttributeFixtures';

const QUARTER: BeatDurationSpec = { duration: model.Duration.Quarter, dots: 0, tuplet: null };

const at = (beatIndex: number, barIndex = 0): CursorPosition => ({ trackIndex: 0, barIndex, voiceIndex: 0, beatIndex });

const range = (startBeatIndex: number, endBeatIndex: number, voiceIndex: 0 | 1 = 0): SelectionRange => ({
  trackIndex: 0,
  voiceIndex,
  startBarIndex: 0,
  startBeatIndex,
  endBarIndex: 0,
  endBeatIndex,
});

/** bar0 に 3 拍（弦 3、フレット 5・7・9）を置く。 */
function placeThreeNotes(target: EditTarget): void {
  for (let i = 0; i < 3; i++) new PlaceNoteCommand(target, at(i), 3, 5 + i * 2, QUARTER).execute();
}

/** パート 0 の最後に、休符の拍を 1 つ持つ小節を足す。 */
function appendBar(target: EditTarget): void {
  target.score.addMasterBar(new model.MasterBar());
  const bar = new model.Bar();
  getStaff(target.score, 0).addBar(bar);
  const voice = new model.Voice();
  bar.addVoice(voice);
  voice.addBeat(new model.Beat());
}

const noteAt = (target: EditTarget, beatIndex: number, barIndex = 0): model.Note =>
  getBeat(target.score, 0, barIndex, beatIndex).notes[0]!;

let target: EditTarget;
let before: string;

beforeEach(() => {
  target = buildEditTarget();
  placeThreeNotes(target);
  before = scoreJson(target);
});

// <!-- req editingcore:3ad90622.b260 -->
describe('SetTieCommand', () => {
  it('SetTieCommand_始まりの音符にタイ_同じ弦の次の音符のisTieDestinationだけが真になりundoで戻る', () => {
    // UT-EDIT-ATTR-01 3.4 節「音符 A の tieToNext が真のとき、同じ弦の次の音符 B の isTieDestination を真にする」・2.6 節「そのパート」
    const cmd = new SetTieCommand(target, at(0), 3, true);
    expect(cmd.kind).toBe('set-tie');
    expect(cmd.label).toBe('set-tie');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    expect(cmd.execute().cursorAdvance).toBe('none');
    expect(noteAt(target, 1).isTieDestination).toBe(true);
    expect(noteAt(target, 0).isTieDestination).toBe(false);
    expect(noteAt(target, 2).isTieDestination).toBe(false);
    expect(cmd.undo().cursorAdvance).toBe('none');
    expect(noteAt(target, 1).isTieDestination).toBe(false);
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTieCommand_execute_finishが作るタイのつながりとフレットの写しを変えない', () => {
    // UT-EDIT-ATTR-02 2.4 節「finish() が作る派生情報…は変えない」・3.4 節「B.tieOrigin と A.tieDestination のつながりはコマンドでは入れず」
    new SetTieCommand(target, at(0), 3, true).execute();
    expect(noteAt(target, 1).tieOrigin).toBeNull();
    expect(noteAt(target, 0).tieDestination).toBeNull();
    expect(noteAt(target, 1).fret).toBe(7);
  });

  // <!-- req editingcore:5e27ed95.9c9d -->
  // <!-- req editingcore:5e27ed95.d20f -->
  // <!-- req editingcore:5e27ed95.6591 -->
  // <!-- req editingcore:5e27ed95.66fd -->
  // <!-- req editingcore:5e27ed95.82e3 -->
  // <!-- req editingcore:5e27ed95.a855 -->
  it('SetTieCommand_描く前の作り直しを通す_付けるとBがAにつながりAのフレットが写り取り消すと全部戻る', () => {
    // UT-EDIT-ATTR-03 3.4 節「タイを付けて描く前の作り直し（12.1 節の rebuildDerivedLinks）を通すと、B の tieOrigin が A を指し、
    // B に A のフレットが写る。取り消して通すと、B の tieOrigin と A の tieDestination が空に戻り、B のフレットがタイを付ける前の値に戻る」
    const cmd = new SetTieCommand(target, at(0), 3, true);
    cmd.execute();
    rebuildBeforeRender(target.score);
    const a = noteAt(target, 0);
    const b = noteAt(target, 1);
    expect(b.tieOrigin).toBe(a);
    expect(a.tieDestination).toBe(b);
    expect(b.fret).toBe(5);

    cmd.undo();
    rebuildBeforeRender(target.score);
    expect(b.tieOrigin).toBeNull();
    expect(a.tieDestination).toBeNull();
    expect(b.fret).toBe(7);
  });

  it('SetTieCommand_同じ弦の音符が無い拍を飛ばす_その先の同じ弦の音符をタイの終わりにする', () => {
    // UT-EDIT-ATTR-04 3.4 節「同じ弦の次の音符 B」
    const t = buildEditTarget();
    new PlaceNoteCommand(t, at(0), 3, 5, QUARTER).execute();
    new PlaceNoteCommand(t, at(1), 2, 5, QUARTER).execute();
    new PlaceNoteCommand(t, at(2), 3, 5, QUARTER).execute();
    new SetTieCommand(t, at(0), 3, true).execute();
    expect(noteAt(t, 1).isTieDestination).toBe(false);
    expect(noteAt(t, 2).isTieDestination).toBe(true);
  });

  it('SetTieCommand_小節の最後の音符から_次の小節の同じ弦の音符へタイを付ける', () => {
    // UT-EDIT-ATTR-05 3.4 節「同じ弦の次の音符 B」（小節をまたぐ）
    appendBar(target);
    new PlaceNoteCommand(target, at(0, 1), 3, 9, QUARTER).execute();
    const beforeTie = scoreJson(target);
    const cmd = new SetTieCommand(target, at(2), 3, true);
    cmd.execute();
    expect(noteAt(target, 0, 1).isTieDestination).toBe(true);
    cmd.undo();
    expect(scoreJson(target)).toBe(beforeTie);
  });

  it('SetTieCommand_次の音符が無い_何もせず宙に浮いたタイの終わりを作らない', () => {
    // UT-EDIT-ATTR-06 3.4 節（B が無ければタイの終わりを置かない）
    const cmd = new SetTieCommand(target, at(2), 3, true);
    cmd.execute();
    expect(scoreJson(target)).toBe(before);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTieCommand_指定した弦に音符が無い_何もしない', () => {
    // UT-EDIT-ATTR-07 3.4 節（始まりの音符 A が無い）
    const cmd = new SetTieCommand(target, at(1), 6, true);
    cmd.execute();
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTieCommand_拍の外を指す_何もしない', () => {
    // UT-EDIT-ATTR-08 3.4 節（始まりの拍が無い）
    const cmd = new SetTieCommand(target, at(5), 3, true);
    cmd.execute();
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTieCommand_付けたタイを外す_isTieDestinationが偽になりundoで付いた状態へ戻る', () => {
    // UT-EDIT-ATTR-09 2.6 節「SetTieCommand は Note.tieToNext を変える」（外す側）
    new SetTieCommand(target, at(0), 3, true).execute();
    const tied = scoreJson(target);
    const untie = new SetTieCommand(target, at(0), 3, false);
    untie.execute();
    expect(noteAt(target, 1).isTieDestination).toBe(false);
    untie.undo();
    expect(scoreJson(target)).toBe(tied);
  });

  // <!-- req editingcore:5e27ed95.60f9 -->
  it('SetTieCommand_タイを付ける_スラーのつながりを変えない', () => {
    // UT-EDIT-ATTR-10 3.4 節「タイを付けても音符の slurGroupId とスラーのつながりが変わらず」
    new SetSlurCommand(target, range(0, 2)).execute();
    new SetTieCommand(target, at(0), 3, true).execute();
    expect(noteAt(target, 0).slurDestination).toBe(noteAt(target, 2));
    expect(noteAt(target, 2).slurOrigin).toBe(noteAt(target, 0));
    expect(noteAt(target, 2).isSlurDestination).toBe(true);
    expect(noteAt(target, 1).isSlurDestination).toBe(false);
  });
});

describe('SetSlurCommand', () => {
  it('SetSlurCommand_範囲_最初と最後の音符をつなぎundoで戻る', () => {
    // UT-EDIT-ATTR-11 3.4 節「A.slurDestination に B を、B.slurOrigin に A を入れ、B.isSlurDestination を真にする」・2.6 節「そのパート」
    const cmd = new SetSlurCommand(target, range(0, 2));
    expect(cmd.kind).toBe('set-slur');
    expect(cmd.label).toBe('set-slur');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    cmd.execute();
    expect(noteAt(target, 0).slurDestination).toBe(noteAt(target, 2));
    expect(noteAt(target, 2).slurOrigin).toBe(noteAt(target, 0));
    expect(noteAt(target, 2).isSlurDestination).toBe(true);
    cmd.undo();
    expect(noteAt(target, 0).slurDestination).toBeNull();
    expect(noteAt(target, 2).slurOrigin).toBeNull();
    expect(noteAt(target, 2).isSlurDestination).toBe(false);
    expect(scoreJson(target)).toBe(before);
  });

  it('SetSlurCommand_和音の拍_弦の番号の小さい音符どうしをつなぐ', () => {
    // UT-EDIT-ATTR-30 3.4 節「同じ slurGroupId を持つ音符のうち、最初の音符 A と最後の音符 B をつなぐ」（和音では弦の番号の小さい音符）
    new PlaceNoteCommand(target, at(0), 1, 3, QUARTER).execute();
    new PlaceNoteCommand(target, at(2), 2, 3, QUARTER).execute();
    new SetSlurCommand(target, range(0, 2)).execute();
    const low = getBeat(target.score, 0, 0, 0).getNoteOnString(1)!;
    const end = getBeat(target.score, 0, 0, 2).getNoteOnString(2)!;
    expect(low.slurDestination).toBe(end);
    expect(end.slurOrigin).toBe(low);
  });

  // <!-- req editingcore:5e27ed95.13ff -->
  it('SetSlurCommand_スラーを付ける_タイの印とつながりを変えない', () => {
    // UT-EDIT-ATTR-12 3.4 節「スラーを付けても tieToNext とタイのつながりが変わらない」
    new SetTieCommand(target, at(0), 3, true).execute();
    new SetSlurCommand(target, range(0, 2)).execute();
    expect(noteAt(target, 1).isTieDestination).toBe(true);
    expect(noteAt(target, 2).isTieDestination).toBe(false);
    expect(noteAt(target, 1).tieOrigin).toBeNull();
    expect(noteAt(target, 0).tieDestination).toBeNull();
  });

  it('SetSlurCommand_始まりと終わりが同じ拍_何もしない', () => {
    // UT-EDIT-ATTR-13 3.4 節（最初と最後が同じ音符ならつながりを入れない）
    const cmd = new SetSlurCommand(target, range(1, 1));
    cmd.execute();
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetSlurCommand_始まりか終わりが休符の拍_何もしない', () => {
    // UT-EDIT-ATTR-14 3.4 節「slurGroupId が空の音符には、どれも入れない」（休符の拍には音符が無い）
    // 拍 0 は初めからある休符の拍、拍 1 と 2 は音符、拍 3 は休符の拍
    const t = buildEditTarget();
    new PlaceNoteCommand(t, at(1), 3, 5, QUARTER).execute();
    new PlaceNoteCommand(t, at(2), 3, 7, QUARTER).execute();
    getBar(t.score, 0, 0).voices[0]!.addBeat(new model.Beat());
    const rests = scoreJson(t);
    new SetSlurCommand(t, range(0, 1)).execute();
    expect(scoreJson(t)).toBe(rests);
    new SetSlurCommand(t, range(1, 3)).execute();
    expect(scoreJson(t)).toBe(rests);
    expect(noteAt(t, 1).slurDestination).toBeNull();
  });

  it('SetSlurCommand_2つ目のボイスの範囲_そのボイスの音符だけをつなぐ', () => {
    // UT-EDIT-ATTR-15 3.1 節「2 つ目は Bar.voices の 2 つ目に置く」・2.6 節「SelectionRange に voiceIndex」
    const bar = getBar(target.score, 0, 0);
    const voice2 = new model.Voice();
    bar.addVoice(voice2);
    for (const fret of [1, 3]) {
      const beat = new model.Beat();
      const note = new model.Note();
      note.string = 2;
      note.fret = fret;
      beat.addNote(note);
      voice2.addBeat(beat);
    }
    new SetSlurCommand(target, range(0, 1, 1)).execute();
    expect(voice2.beats[0]!.notes[0]!.slurDestination).toBe(voice2.beats[1]!.notes[0]);
    expect(voice2.beats[1]!.notes[0]!.isSlurDestination).toBe(true);
    expect(noteAt(target, 0).slurDestination).toBeNull();
  });
});

describe('SetTechniqueCommand', () => {
  it('SetTechniqueCommand_patchのキー_指定した所だけを変えundoで全部戻る', () => {
    // UT-EDIT-ATTR-16 7.3 節「Note の奏法記号は、patch で指定した所だけを変える」・2.6 節「そのパート」
    const cmd = new SetTechniqueCommand(target, at(0), 3, {
      slideOutType: model.SlideOutType.Shift,
      slideInType: model.SlideInType.IntoFromBelow,
      isHammerPullOrigin: true,
      isPalmMute: true,
      vibrato: model.VibratoType.Slight,
    });
    expect(cmd.kind).toBe('set-technique');
    expect(cmd.label).toBe('set-technique');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    cmd.execute();
    const note = noteAt(target, 0);
    expect(note.slideOutType).toBe(model.SlideOutType.Shift);
    expect(note.slideInType).toBe(model.SlideInType.IntoFromBelow);
    expect(note.isHammerPullOrigin).toBe(true);
    expect(note.isPalmMute).toBe(true);
    expect(note.vibrato).toBe(model.VibratoType.Slight);
    expect(note.isStaccato).toBe(false);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_空のpatch_何も変えない', () => {
    // UT-EDIT-ATTR-17 7.3 節「patch は、指定したキーだけを変える」
    const cmd = new SetTechniqueCommand(target, at(0), 3, {});
    cmd.execute();
    expect(scoreJson(target)).toBe(before);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_弦に音符が無い_何もしない', () => {
    // UT-EDIT-ATTR-18 7.3 節（弦を指定して Note を変える。無ければ変えない）
    const cmd = new SetTechniqueCommand(target, at(0), 6, { isPalmMute: true });
    cmd.execute();
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_アーティキュレーションの5つ_付けて外しundoで戻る', () => {
    // UT-EDIT-ATTR-19 3.5 節「5 つとも、付けるのも外すのも同じ SetTechniqueCommand で行う。外すときは、accentuated を None、
    // isStaccato と isGhost を偽にする指定を送る」
    for (const accent of [model.AccentuationType.Normal, model.AccentuationType.Heavy, model.AccentuationType.Tenuto]) {
      const on = new SetTechniqueCommand(target, at(0), 3, { accentuated: accent, isStaccato: true, isGhost: true });
      on.execute();
      expect(noteAt(target, 0).accentuated).toBe(accent);
      expect(noteAt(target, 0).isStaccato).toBe(true);
      expect(noteAt(target, 0).isGhost).toBe(true);
      const withMarks = scoreJson(target);

      const off = new SetTechniqueCommand(target, at(0), 3, {
        accentuated: model.AccentuationType.None,
        isStaccato: false,
        isGhost: false,
      });
      off.execute();
      expect(scoreJson(target)).toBe(before);
      off.undo();
      expect(scoreJson(target)).toBe(withMarks);
      on.undo();
      expect(scoreJson(target)).toBe(before);
    }
  });

  it('SetTechniqueCommand_自然ハーモニクスでharmonicValueが無い_フレットから値を入れundoで戻す', () => {
    // UT-EDIT-ATTR-20 7.3 節「patch の harmonicType が Natural で patch に harmonicValue が無いとき、その音のフレットから
    // naturalHarmonicValue で値を入れる」「undo も、harmonicValue を前の値に戻す」
    const cmd = new SetTechniqueCommand(target, at(1), 3, { harmonicType: model.HarmonicType.Natural });
    cmd.execute();
    expect(noteAt(target, 1).harmonicType).toBe(model.HarmonicType.Natural);
    expect(noteAt(target, 1).harmonicValue).toBe(7);
    cmd.undo();
    expect(noteAt(target, 1).harmonicValue).toBe(0);
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_harmonicValueを渡す_渡した値を入れる', () => {
    // UT-EDIT-ATTR-21 7.3 節「人工ハーモニクスの音の高さ（harmonicValue）も、同じ SetTechniqueCommand の patch のキーで変える」
    const artificial = new SetTechniqueCommand(target, at(0), 3, {
      harmonicType: model.HarmonicType.Artificial,
      harmonicValue: 12,
    });
    artificial.execute();
    expect(noteAt(target, 0).harmonicValue).toBe(12);
    artificial.undo();
    const natural = new SetTechniqueCommand(target, at(0), 3, {
      harmonicType: model.HarmonicType.Natural,
      harmonicValue: 5,
    });
    natural.execute();
    expect(noteAt(target, 0).harmonicValue).toBe(5);
    natural.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_チョーキングの幅と形_bendTypeとbendPointsを入れundoで戻す', () => {
    // UT-EDIT-ATTR-22 7.3 節「チョーキングの幅は、bendType を BendType.Bend にし、bendPoints を始まり（offset 0、value 0）と
    // 終わり（offset 60、value は幅）の 2 点で持つ」「undo は…bendPoints は中身を写して持つ」
    const points = [
      { offset: 0, value: 0 },
      { offset: 60, value: 4 },
    ];
    const cmd = new SetTechniqueCommand(target, at(0), 3, { bendType: model.BendType.Bend, bendPoints: points });
    cmd.execute();
    const note = noteAt(target, 0);
    expect(note.bendType).toBe(model.BendType.Bend);
    expect(note.bendPoints!.map((p) => [p.offset, p.value])).toEqual([
      [0, 0],
      [60, 4],
    ]);
    expect(note.maxBendPoint?.value).toBe(4);
    points[1] = { offset: 60, value: 8 };
    expect(note.bendPoints![1]!.value).toBe(4);

    cmd.undo();
    expect(note.bendType).toBe(model.BendType.None);
    expect(note.bendPoints).toBeNull();
    expect(note.maxBendPoint).toBeNull();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_bendPointsだけを渡す_bendTypeを変えない', () => {
    // UT-EDIT-ATTR-23 7.3 節「patch で指定した所だけを変える」（addBendPoint が bendType を Custom に変えても戻す）
    const cmd = new SetTechniqueCommand(target, at(0), 3, { bendPoints: [{ offset: 0, value: 2 }] });
    cmd.execute();
    expect(noteAt(target, 0).bendType).toBe(model.BendType.None);
    expect(noteAt(target, 0).bendPoints).toHaveLength(1);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_チョーキングを外す_bendTypeをNoneにしbendPointsを空にしundoで戻す', () => {
    // UT-EDIT-ATTR-24 7.3 節「外すときは bendType を None、bendPoints を空にする」
    new SetTechniqueCommand(target, at(0), 3, {
      bendType: model.BendType.Bend,
      bendPoints: [
        { offset: 0, value: 0 },
        { offset: 60, value: 2 },
      ],
    }).execute();
    const bent = scoreJson(target);
    const off = new SetTechniqueCommand(target, at(0), 3, { bendType: model.BendType.None, bendPoints: [] });
    off.execute();
    expect(noteAt(target, 0).bendType).toBe(model.BendType.None);
    expect(noteAt(target, 0).bendPoints ?? []).toHaveLength(0);
    off.undo();
    expect(scoreJson(target)).toBe(bent);
    expect(noteAt(target, 0).maxBendPoint?.value).toBe(2);
  });

  it('SetTechniqueCommand_やり直し_同じ変更をもう一度当てて取り消せる', () => {
    // UT-EDIT-ATTR-25 2.2 節「execute() と undo() の対称性は、各コマンドが自分で保証する」（取り消しの後のやり直し）
    const cmd = new SetTechniqueCommand(target, at(0), 3, { isGhost: true });
    cmd.execute();
    const after = scoreJson(target);
    cmd.undo();
    cmd.execute();
    expect(scoreJson(target)).toBe(after);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_executeの前のundo_何もしない', () => {
    // UT-EDIT-ATTR-26 2.2 節「undo() は、execute() の変更を打ち消し」（打ち消すものが無ければ変えない）
    const cmd = new SetTechniqueCommand(target, at(0), 3, { isGhost: true });
    expect(cmd.undo().cursorAdvance).toBe('none');
    expect(scoreJson(target)).toBe(before);
    expect(cmd.estimateSizeBytes()).toBeGreaterThan(0);
  });
});

describe('naturalHarmonicValue', () => {
  it('naturalHarmonicValue_フレット0から24_alphaTexのnhで読み込んだ値と同じ', () => {
    // UT-EDIT-ATTR-27 7.2 節「フレット 0 から 24 のそれぞれについて、alphaTex の nh で読み込んだ音の harmonicValue と
    // naturalHarmonicValue の値が同じことを確かめる」
    for (let fret = 0; fret <= 24; fret++) {
      expect(naturalHarmonicValue(fret), `fret ${fret}`).toBe(harmonicValueReadFromAlphaTexNh(fret));
    }
  });
});

describe('SetBeatTechniqueCommand', () => {
  it('SetBeatTechniqueCommand_スラップとポップとタップとブラシ_Beatの属性に入れundoで戻る', () => {
    // UT-EDIT-BEATTECH-01 7.3 節「Beat の単位で扱うのは、スラップ・ポップ・タップ・ブラシとする」・2.6 節「Beat の奏法記号」「そのパート」 <!-- req webcorefoundation:eb42fe4e.e6f9 -->
    const cmd = new SetBeatTechniqueCommand(target, at(1), {
      slap: true,
      pop: true,
      tap: true,
      brushType: model.BrushType.BrushDown,
    });
    expect(cmd.kind).toBe('set-beat-technique');
    expect(cmd.label).toBe('set-beat-technique');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    cmd.execute();
    const beat = getBeat(target.score, 0, 0, 1);
    expect([beat.slap, beat.pop, beat.tap, beat.brushType]).toEqual([true, true, true, model.BrushType.BrushDown]);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetBeatTechniqueCommand_1つのキーだけ_ほかのキーを変えない', () => {
    // UT-EDIT-BEATTECH-02 7.3 節「指定したキーだけを変える」
    new SetBeatTechniqueCommand(target, at(1), { pop: true }).execute();
    const popped = scoreJson(target);
    const cmd = new SetBeatTechniqueCommand(target, at(1), { slap: true });
    cmd.execute();
    const beat = getBeat(target.score, 0, 0, 1);
    expect(beat.slap).toBe(true);
    expect(beat.pop).toBe(true);
    expect(beat.tap).toBe(false);
    cmd.undo();
    expect(scoreJson(target)).toBe(popped);
  });

  it('SetBeatTechniqueCommand_空のpatch_何も変えない', () => {
    // UT-EDIT-BEATTECH-03 7.3 節「指定したキーだけを変える」（キーが無ければ変えない）
    const cmd = new SetBeatTechniqueCommand(target, at(1), {});
    cmd.execute();
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });
});

describe('SetChordNameCommand', () => {
  it('SetChordNameCommand_名前_Beat.textに入れundoで外す', () => {
    // UT-EDIT-ATTR-28 8 節「手での指定の欄の実体は、alphaTab の Beat.text とする」・2.6 節「そのパート」
    const cmd = new SetChordNameCommand(target, at(0), 'Cmaj7');
    expect(cmd.kind).toBe('set-chord-name');
    expect(cmd.label).toBe('set-chord-name');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    cmd.execute();
    expect(getBeat(target.score, 0, 0, 0).text).toBe('Cmaj7');
    cmd.undo();
    expect(getBeat(target.score, 0, 0, 0).text).toBeNull();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetChordNameCommand_null_手の値を外しundoで戻す', () => {
    // UT-EDIT-ATTR-29 2.6 節「name が null なら手の値を外す」
    new SetChordNameCommand(target, at(0), 'G').execute();
    const withText = scoreJson(target);
    const clear = new SetChordNameCommand(target, at(0), null);
    clear.execute();
    expect(getBeat(target.score, 0, 0, 0).text).toBeNull();
    clear.undo();
    expect(scoreJson(target)).toBe(withText);
  });
});

describe('奏法記号の種類（3.5 節）', () => {
  it('SetTechniqueCommand_スライドアウトは4つとNoneだけ_ピックスライドはRangeErrorで作らない', () => {
    // UT-EDIT-ATTR-31 3.5 節「スライドアウト（音から出る側）の種類は、シフト・レガート・下へのスライドアウト・上へのスライドアウトの 4 つとする」
    const kinds = [
      model.SlideOutType.None,
      model.SlideOutType.Shift,
      model.SlideOutType.Legato,
      model.SlideOutType.OutDown,
      model.SlideOutType.OutUp,
    ];
    expect(SLIDE_OUT_TYPES).toEqual(kinds);
    for (const slideOutType of kinds) {
      expect(() => new SetTechniqueCommand(target, at(0), 3, { slideOutType })).not.toThrow();
    }
    for (const slideOutType of [model.SlideOutType.PickSlideDown, model.SlideOutType.PickSlideUp]) {
      expect(() => new SetTechniqueCommand(target, at(0), 3, { slideOutType })).toThrow(RangeError);
    }
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_スライドインは2つとアクセントは3つ_外の値はRangeError', () => {
    // UT-EDIT-ATTR-32 3.5 節「スライドインの種類は…2 つとし、スライドアウトの 4 つと合わせて 6 つとする」・
    //   「アーティキュレーション記号…は、次の 5 つに限り、増やさない」
    expect(SLIDE_IN_TYPES).toEqual([
      model.SlideInType.None,
      model.SlideInType.IntoFromBelow,
      model.SlideInType.IntoFromAbove,
    ]);
    expect(ACCENTUATION_TYPES).toEqual([
      model.AccentuationType.None,
      model.AccentuationType.Normal,
      model.AccentuationType.Heavy,
      model.AccentuationType.Tenuto,
    ]);
    // alphaTab の列挙が種類を増やしたら気づくように、列挙の値の全部と比べる
    const numericValues = (e: object): unknown[] => Object.values(e).filter((v) => typeof v === 'number');
    expect(numericValues(model.SlideInType)).toEqual([...SLIDE_IN_TYPES]);
    expect(numericValues(model.AccentuationType)).toEqual([...ACCENTUATION_TYPES]);
    expect(() => new SetTechniqueCommand(target, at(0), 3, { slideInType: 3 as model.SlideInType })).toThrow(
      RangeError,
    );
    expect(() => new SetTechniqueCommand(target, at(0), 3, { accentuated: 4 as model.AccentuationType })).toThrow(
      RangeError,
    );
  });
});

describe('パームミュートの範囲（3.5 節）', () => {
  it('createPalmMuteCommand_その音だけ_その音符だけに立てる', () => {
    // UT-EDIT-ATTR-33 3.5 節「「その音だけ」はその音符だけに isPalmMute を立て」
    const cmd = createPalmMuteCommand(target, at(0), 3, 'note', true);
    expect(cmd).toBeInstanceOf(SetTechniqueCommand);
    cmd.execute();
    expect([noteAt(target, 0).isPalmMute, noteAt(target, 1).isPalmMute]).toEqual([true, false]);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('createPalmMuteCommand_次の音まで_同じ弦の次の音符にも立て1回の取り消しで両方戻る', () => {
    // UT-EDIT-ATTR-34 3.5 節「「次の音まで」はその音符と、同じ弦の次の音符…の両方に立てる」・7.3 節「SetTechniqueCommand 2 つを
    //   CompositeCommand にまとめて出す。1 回の取り消しで 2 つとも外れる」
    const cmd = createPalmMuteCommand(target, at(0), 3, 'untilNext', true);
    expect(cmd).toBeInstanceOf(CompositeCommand);
    expect(cmd.kind).toBe('set-technique');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    cmd.execute();
    expect([0, 1, 2].map((i) => noteAt(target, i).isPalmMute)).toEqual([true, true, false]);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('createPalmMuteCommand_次の音まで_次の音符が無ければその音符だけで外すときも同じ', () => {
    // UT-EDIT-ATTR-35 3.5 節「同じ弦の次の音符（無ければその音符だけ）」
    const last = createPalmMuteCommand(target, at(2), 3, 'untilNext', true);
    expect(last).toBeInstanceOf(SetTechniqueCommand);
    last.execute();
    expect([0, 1, 2].map((i) => noteAt(target, i).isPalmMute)).toEqual([false, false, true]);
    last.undo();
    expect(scoreJson(target)).toBe(before);

    createPalmMuteCommand(target, at(1), 3, 'untilNext', true).execute();
    const off = createPalmMuteCommand(target, at(1), 3, 'untilNext', false);
    off.execute();
    expect([1, 2].map((i) => noteAt(target, i).isPalmMute)).toEqual([false, false]);
    off.undo();
    expect([1, 2].map((i) => noteAt(target, i).isPalmMute)).toEqual([true, true]);
  });

  it('createPalmMuteCommand_次の音まで_次の音符が4小節先でも立てる', () => {
    // UT-EDIT-ATTR-37 3.5 節「同じ弦の次の音符（無ければその音符だけ）の両方に立てる」（タイの 3 小節の幅で区切らない）
    for (let i = 0; i < 4; i++) appendBar(target);
    new PlaceNoteCommand(target, at(0, 4), 3, 9, QUARTER).execute();
    const beforePalmMute = scoreJson(target);
    const cmd = createPalmMuteCommand(target, at(2), 3, 'untilNext', true);
    expect(cmd).toBeInstanceOf(CompositeCommand);
    cmd.execute();
    expect([noteAt(target, 2).isPalmMute, noteAt(target, 0, 4).isPalmMute]).toEqual([true, true]);
    cmd.undo();
    expect(scoreJson(target)).toBe(beforePalmMute);
  });
});

describe('ボイス 2 の位置（3.1 節）', () => {
  it('属性のコマンド_ボイス2の位置_ボイス2の拍だけを変える', () => {
    // UT-EDIT-ATTR-36 3.1 節「カーソルは、選んでいるボイス（Bar.voices の 1 つ目か 2 つ目）の拍（Beat）の上だけを動く」
    const v2 = (beatIndex: number): CursorPosition => ({ ...at(beatIndex), voiceIndex: 1 });
    new PlaceNoteCommand(target, v2(0), 3, 1, QUARTER).execute();
    new PlaceNoteCommand(target, v2(1), 3, 2, QUARTER).execute();
    const withVoice2 = scoreJson(target);
    const v2Note = (beatIndex: number): model.Note => getBeat(target.score, 0, 0, beatIndex, 1).notes[0]!;

    const commands = [
      new SetTechniqueCommand(target, v2(0), 3, { isGhost: true }),
      new SetTieCommand(target, v2(0), 3, true),
      new SetChordNameCommand(target, v2(0), 'E5'),
    ];
    for (const cmd of commands) cmd.execute();
    expect(v2Note(0).isGhost).toBe(true);
    expect(v2Note(1).isTieDestination).toBe(true);
    expect(getBeat(target.score, 0, 0, 0, 1).text).toBe('E5');
    expect(noteAt(target, 0).isGhost).toBe(false);
    expect(noteAt(target, 1).isTieDestination).toBe(false);
    expect(getBeat(target.score, 0, 0, 0).text).toBeNull();
    for (const cmd of [...commands].reverse()) cmd.undo();
    expect(scoreJson(target)).toBe(withVoice2);
  });

  it('SetBeatTechniqueCommand_ボイス2の位置_ボイス2の拍だけを変える', () => {
    // UT-EDIT-BEATTECH-04 3.1 節「カーソルは、選んでいるボイス…の拍の上だけを動く」
    new PlaceNoteCommand(target, { ...at(0), voiceIndex: 1 }, 3, 1, QUARTER).execute();
    new SetBeatTechniqueCommand(target, { ...at(0), voiceIndex: 1 }, { tap: true }).execute();
    expect(getBeat(target.score, 0, 0, 0, 1).tap).toBe(true);
    expect(getBeat(target.score, 0, 0, 0).tap).toBe(false);
  });
});

describe('ハーモニクスの種類と音の高さ（7.2 節）', () => {
  /** 拍 at の音符に人工ハーモニクスを音の高さ value で付けておく。 */
  function artificial(beatIndex: number, value: number): string {
    new SetTechniqueCommand(target, at(beatIndex), 3, {
      harmonicType: model.HarmonicType.Artificial,
      harmonicValue: value,
    }).execute();
    return scoreJson(target);
  }

  it('SetTechniqueCommand_人工ハーモニクスからピンチへ_同じコマンドでharmonicValueを0に戻しundoで両方戻す', () => {
    // UT-EDIT-ATTR-38 7.2 節「人工ハーモニクスからピンチか「なし」へ変えるときは、同じ patch で harmonicValue を 0 に戻す」
    const withArtificial = artificial(0, 12);
    const cmd = new SetTechniqueCommand(target, at(0), 3, { harmonicType: model.HarmonicType.Pinch });
    cmd.execute();
    expect(noteAt(target, 0).harmonicType).toBe(model.HarmonicType.Pinch);
    expect(noteAt(target, 0).harmonicValue).toBe(0);
    cmd.undo();
    expect(noteAt(target, 0).harmonicType).toBe(model.HarmonicType.Artificial);
    expect(noteAt(target, 0).harmonicValue).toBe(12);
    expect(scoreJson(target)).toBe(withArtificial);
  });

  it('SetTechniqueCommand_人工ハーモニクスからなしへ_harmonicValueを0に戻し付ける前と同じ保存の値になる', () => {
    // UT-EDIT-ATTR-39 7.2 節「「なし」へ変えるときは、人工ハーモニクスの harmonicValue を 0 に戻す」・「人工ハーモニクスのために選んだ値が、
    // 別の種類の鳴り方と描き方に残らないようにする」
    const withArtificial = artificial(0, 7);
    const cmd = new SetTechniqueCommand(target, at(0), 3, { harmonicType: model.HarmonicType.None });
    cmd.execute();
    expect(noteAt(target, 0).harmonicValue).toBe(0);
    expect(scoreJson(target)).toBe(before);
    cmd.undo();
    expect(scoreJson(target)).toBe(withArtificial);
  });

  it('SetTechniqueCommand_人工ハーモニクスから自然へ_フレットの決まりの値を同じコマンドで入れundoで戻す', () => {
    // UT-EDIT-ATTR-40 7.2 節「自然へ変えるときは、次の決まりの値を同じ patch で入れる」（拍 1 はフレット 7、拍 2 はフレット 9）
    const withArtificial = artificial(1, 5);
    const cmd = new SetTechniqueCommand(target, at(1), 3, { harmonicType: model.HarmonicType.Natural });
    cmd.execute();
    expect(noteAt(target, 1).harmonicType).toBe(model.HarmonicType.Natural);
    expect(noteAt(target, 1).harmonicValue).toBe(naturalHarmonicValue(7));
    cmd.undo();
    expect(scoreJson(target)).toBe(withArtificial);
  });

  it('SetTechniqueCommand_人工ハーモニクスで音の高さを選ばない_harmonicValueを0のまま変えない', () => {
    // UT-EDIT-ATTR-41 7.2 節「既定は「指定なし」とし、人工ハーモニクスを付けるときに音の高さを選ばなければ、harmonicValue を 0 のまま変えない」
    const cmd = new SetTechniqueCommand(target, at(0), 3, { harmonicType: model.HarmonicType.Artificial });
    cmd.execute();
    expect(noteAt(target, 0).harmonicType).toBe(model.HarmonicType.Artificial);
    expect(noteAt(target, 0).harmonicValue).toBe(0);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTechniqueCommand_人工ハーモニクスの音の高さの5つの候補_選んだ値をharmonicValueに入れる', () => {
    // UT-EDIT-ATTR-42 7.2 節「「指定なし」（harmonicValue を 0）・「12（1オクターブ上）」（12）・「7（1オクターブと5度上）」（7）・
    // 「5（2オクターブ上）」（5）・「4（2オクターブと長3度上）」（4）の 5 つ」
    const withArtificial = artificial(0, 12);
    for (const value of [0, 12, 7, 5, 4]) {
      const cmd = new SetTechniqueCommand(target, at(0), 3, { harmonicValue: value });
      cmd.execute();
      expect(noteAt(target, 0).harmonicValue).toBe(value);
      expect(noteAt(target, 0).harmonicType).toBe(model.HarmonicType.Artificial);
      cmd.undo();
      expect(scoreJson(target)).toBe(withArtificial);
    }
  });

  it('SetTechniqueCommand_人工ハーモニクスで種類を変えないpatch_選んだ音の高さを変えない', () => {
    // UT-EDIT-ATTR-43 7.2 節「人工ハーモニクスからピンチか「なし」へ変えるとき」（種類を変えない patch では 0 に戻さない）・
    // 「ハーモニクスの種類は、自然・人工・ピンチから選べる」（ハーモニクスの無い音にピンチを付ける）
    artificial(0, 12);
    new SetTechniqueCommand(target, at(0), 3, { isPalmMute: true }).execute();
    expect(noteAt(target, 0).harmonicValue).toBe(12);
    new SetTechniqueCommand(target, at(1), 3, { harmonicType: model.HarmonicType.Pinch }).execute();
    expect(noteAt(target, 1).harmonicType).toBe(model.HarmonicType.Pinch);
    expect(noteAt(target, 1).harmonicValue).toBe(0);
  });
});
