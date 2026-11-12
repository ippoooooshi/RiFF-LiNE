// UT-EDIT-PLACENOTE: PlaceNoteCommand
// 検証節: editing-core.md 2.4 節・2.6 節・3.3 節・4.2 節・4.7 節
// 検証観点（execute と undo の対称性 C2）: 休符の拍を音符の拍へ / 和音へ足す / 新しい拍の 3 つの場合、 <!-- req webcorefoundation:80c9bca6.b1fb -->
//   渡した音価（BeatDurationSpec）の入れ方、undo で元の Score（JSON）へ戻ること。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { PlaceNoteCommand } from './PlaceNoteCommand';
import { findNoteOnString, getBar, getBeat, getVoice } from '../scoreModel';
import type { BeatDurationSpec, CursorPosition } from '../types';
import { allCombinations } from '../../testing/combinations';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';

const spec = (
  duration: model.Duration,
  dots: 0 | 1 | 2 = 0,
  tuplet: BeatDurationSpec['tuplet'] = null,
): BeatDurationSpec => ({
  duration,
  dots,
  tuplet,
});
const QUARTER = spec(model.Duration.Quarter);

// <!-- req editingcore:3ad90622.a663 -->
describe('PlaceNoteCommand', () => {
  it('PlaceNoteCommand_休符の拍_音符の拍へ変えて渡した音価にしundoで戻る', () => {
    // UT-EDIT-PLACENOTE-01 2.6 節「休符の拍は音符の拍へ」・4.2 節「置いた音の弦は Note.string に、フレットは Note.fret に入れる」
    const target = buildEditTarget();
    const before = scoreJson(target);

    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 },
      3,
      5,
      spec(model.Duration.Eighth, 1),
    );
    expect(cmd.kind).toBe('place-note');
    expect(cmd.label).toBe('place-note');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    expect(cmd.execute().cursorAdvance).toBe('beat');

    const beat = getBeat(target.score, 0, 0, 0);
    expect(beat.notes).toHaveLength(1);
    expect(beat.notes[0]!.string).toBe(3);
    expect(beat.notes[0]!.fret).toBe(5);
    expect(beat.duration).toBe(model.Duration.Eighth);
    expect(beat.dots).toBe(1);

    expect(cmd.undo().cursorAdvance).toBe('none');
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(0);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 0), 3)).toBeNull();
    expect(getBeat(target.score, 0, 0, 0).getNoteOnString(3)).toBeNull();
    expect(scoreJson(target)).toBe(before);
  });

  it('PlaceNoteCommand_音のある拍_和音として足し音価を変えずundoでその音符だけ外す', () => {
    // UT-EDIT-PLACENOTE-02 2.6 節「音のある拍は和音へ」・4.7 節「PlaceNoteCommand は、拍の音符の並びへの追加として働く」
    const target = buildEditTarget();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 }, 3, 5, QUARTER).execute();
    const afterFirst = scoreJson(target);

    const chord = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 },
      2,
      7,
      spec(model.Duration.Half),
    );
    chord.execute();
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(2);
    expect(getBeat(target.score, 0, 0, 0).duration).toBe(model.Duration.Quarter);

    chord.undo();
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(1);
    expect(getBeat(target.score, 0, 0, 0).getNoteOnString(2)).toBeNull();
    expect(scoreJson(target)).toBe(afterFirst);
  });

  it('PlaceNoteCommand_拍が無い位置_新しい拍を足して逆参照を張りundoで外す', () => {
    // UT-EDIT-PLACENOTE-03 2.6 節「拍が無ければ新しい拍」・2.4 節「足した拍から属する Voice への逆参照（Beat.voice）を…insertBeatAt で明示的に張る」
    const target = buildEditTarget();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 }, 3, 5, QUARTER).execute();
    const afterFirst = scoreJson(target);
    const voice = getVoice(getBar(target.score, 0, 0));
    const beatsBefore = voice.beats.length;

    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: beatsBefore },
      4,
      0,
      spec(model.Duration.ThirtySecond, 0, { numerator: 3, denominator: 2 }),
    );
    cmd.execute();
    expect(voice.beats.length).toBe(beatsBefore + 1);
    const added = voice.beats[beatsBefore]!;
    expect(added.voice).toBe(voice);
    expect(added.duration).toBe(model.Duration.ThirtySecond);
    expect([added.tupletNumerator, added.tupletDenominator]).toEqual([3, 2]);

    cmd.undo();
    expect(voice.beats.length).toBe(beatsBefore);
    expect(scoreJson(target)).toBe(afterFirst);
  });

  it('PlaceNoteCommand_取り消しの後のやり直し_同じ音符をもう一度置ける', () => {
    // UT-EDIT-PLACENOTE-04 2.2 節「execute() と undo() の対称性は、各コマンドが自分で保証する」
    const target = buildEditTarget();
    const empty = scoreJson(target);
    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 },
      3,
      5,
      QUARTER,
    );
    cmd.execute();
    const after = scoreJson(target);
    const added = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 1 },
      2,
      3,
      QUARTER,
    );
    const chord = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 },
      1,
      3,
      QUARTER,
    );
    for (const step of [added, chord]) {
      step.execute();
      const stepped = scoreJson(target);
      step.undo();
      expect(scoreJson(target)).toBe(after);
      step.execute();
      expect(scoreJson(target)).toBe(stepped);
      step.undo();
    }
    cmd.undo();
    expect(scoreJson(target)).toBe(empty);
    cmd.execute();
    expect(scoreJson(target)).toBe(after);
  });

  it('PlaceNoteCommand_placesNoteAt_同じ拍の同じ弦のときだけ真', () => {
    // UT-EDIT-PLACENOTE-05 4.2 節「SetNoteFretCommand.canMergeWith が、直前の項目が同じ音符を置いた PlaceNoteCommand のときだけ真を返す」
    const target = buildEditTarget(2);
    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 1, barIndex: 0, voiceIndex: 0, beatIndex: 2 },
      3,
      5,
      QUARTER,
    );
    expect(cmd.affectedTrackIndices).toEqual([1]);
    expect(cmd.placesNoteAt({ trackIndex: 1, barIndex: 0, voiceIndex: 0, beatIndex: 2 }, 3)).toBe(true);
    expect(cmd.placesNoteAt({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 2 }, 3)).toBe(false);
    expect(cmd.placesNoteAt({ trackIndex: 1, barIndex: 1, voiceIndex: 0, beatIndex: 2 }, 3)).toBe(false);
    expect(cmd.placesNoteAt({ trackIndex: 1, barIndex: 0, voiceIndex: 0, beatIndex: 1 }, 3)).toBe(false);
    expect(cmd.placesNoteAt({ trackIndex: 1, barIndex: 0, voiceIndex: 0, beatIndex: 2 }, 4)).toBe(false);
  });

  it('PlaceNoteCommand_6つの外の音符の長さ_拍を変えずにRangeErrorを投げる', () => {
    // UT-EDIT-PLACENOTE-06 3.3 節「音符の長さは、全音符（Duration.Whole）から 32 分音符（Duration.ThirtySecond）までの 6 つに限る」
    const target = buildEditTarget();
    const before = scoreJson(target);
    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 },
      3,
      5,
      spec(model.Duration.SixtyFourth),
    );
    expect(() => cmd.execute()).toThrow(RangeError);
    expect(scoreJson(target)).toBe(before);
  });

  it('PlaceNoteCommand_2つ目のボイスがまだ無い小節のボイス2_Voiceを作って置きundoで外す', () => {
    // UT-EDIT-PLACENOTE-08 4.1 節「音か休符を置いたときに、その小節の Bar.voices に 2 つ目の Voice を作る。
    //   作った Voice は、置いたコマンドの undo で外す」
    const target = buildEditTarget();
    const before = scoreJson(target);
    const bar = getBar(target.score, 0, 0);
    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 1, beatIndex: 0 },
      2,
      3,
      QUARTER,
    );
    expect(cmd.execute().cursorAdvance).toBe('beat');
    expect(bar.voices).toHaveLength(2);
    const second = getVoice(bar, 1);
    expect(second.beats).toHaveLength(1);
    expect(second.beats[0]!.voice).toBe(second);
    expect(getBeat(target.score, 0, 0, 0, 1).notes[0]!.fret).toBe(3);
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(0);
    const after = scoreJson(target);

    cmd.undo();
    expect(bar.voices).toHaveLength(1);
    expect(scoreJson(target)).toBe(before);
    cmd.execute();
    expect(scoreJson(target)).toBe(after);
  });

  it('PlaceNoteCommand_2つ目のボイスが在る小節のボイス2_Voiceを作らずundoでも外さない', () => {
    // UT-EDIT-PLACENOTE-09 3.1 節「1 つの小節に置けるボイスは 2 つまでで、Bar.voices の 3 つ目以降は作らない」
    const target = buildEditTarget();
    const first = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 1, beatIndex: 0 },
      2,
      3,
      QUARTER,
    );
    first.execute();
    const afterFirst = scoreJson(target);
    const second = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 1, beatIndex: 1 },
      2,
      5,
      QUARTER,
    );
    second.execute();
    const bar = getBar(target.score, 0, 0);
    expect(bar.voices).toHaveLength(2);
    expect(getVoice(bar, 1).beats).toHaveLength(2);
    second.undo();
    expect(bar.voices).toHaveLength(2);
    expect(scoreJson(target)).toBe(afterFirst);
    expect(second.placesNoteAt({ trackIndex: 0, barIndex: 0, voiceIndex: 1, beatIndex: 1 }, 2)).toBe(true);
    expect(second.placesNoteAt({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 1 }, 2)).toBe(false);
  });

  it('PlaceNoteCommand_estimateSizeBytes_差分だけの小さな定数', () => {
    // UT-EDIT-PLACENOTE-07 2.3 節「各コマンドは、原則として変更の差分だけを持ち」
    const target = buildEditTarget();
    const cmd = new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 },
      1,
      1,
      QUARTER,
    );
    expect(cmd.estimateSizeBytes()).toBeLessThan(2048);
  });

  // UT-EDIT-PLACENOTE-10 web-core-foundation.md 14.3 節 C2：PlaceNoteCommand.ts:85〜89 の placesNoteAt の 5 つの && の条件
  // （パート・小節・ボイス・拍・弦がそれぞれ同じか）。真になるのは 5 つとも同じときだけ。SetNoteFretCommand の canMergeWith が
  // 履歴の積み方を決めるのに使う（editing-core.md 4.2 節）
  it.each(allCombinations(['sameTrack', 'sameBar', 'sameVoice', 'sameBeat', 'sameString'] as const))(
    'PlaceNoteCommand_placesNoteAtのC2_sameTrack=$sameTrack, sameBar=$sameBar, sameVoice=$sameVoice, sameBeat=$sameBeat, sameString=$sameString',
    ({ sameTrack, sameBar, sameVoice, sameBeat, sameString }) => {
      // UT-EDIT-PLACENOTE-10 4.2 節「SetNoteFretCommand.canMergeWith が、直前の項目が同じ音符（同じ拍の同じ弦）を置いた PlaceNoteCommand」
      const target = buildEditTarget();
      const cmd = new PlaceNoteCommand(
        target,
        { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 2 },
        3,
        5,
        QUARTER,
      );
      const asked: CursorPosition = {
        trackIndex: sameTrack ? 0 : 1,
        barIndex: sameBar ? 0 : 1,
        voiceIndex: sameVoice ? 0 : 1,
        beatIndex: sameBeat ? 2 : 3,
      };
      const expected = sameTrack && sameBar && sameVoice && sameBeat && sameString;
      expect(cmd.placesNoteAt(asked, sameString ? 3 : 4)).toBe(expected);
    },
  );
});
