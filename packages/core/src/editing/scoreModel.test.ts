// UT-EDIT-MODEL: scoreModel（alphaTab の Score の階層を辿る・作る道具） <!-- req webcorefoundation:b6101ee6.dbac -->
// 検証節: editing-core.md 2.4 節・3.1 節・3.3 節・3.4 節
// 検証観点: 階層の外を指したときの RangeError、2 つ目のボイスの引き方、音価の入れ方と戻し方、
//   拍の挿入（逆参照を張る）と取り除き、音符の並びの置き直し、同じ弦の次の音符の探し方。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import {
  applyDurationSpec,
  captureDurationFields,
  findNextNoteOnString,
  getBar,
  getBeat,
  getMasterBar,
  getStaff,
  getVoice,
  insertBeatAt,
  NOTE_DURATIONS,
  openStringPitch,
  removeBeat,
  replaceNotes,
  restoreDurationFields,
  SAME_STRING_SEARCH_BAR_SPAN,
  createStringNote,
} from './scoreModel';
import { buildEditTarget } from '../testing/editingFakes';
import { makeSongWithBars } from '../testing/editingFixtures';

/** パート 0 の各小節に Bar と休符の拍を足して、小節の数を masterBars にそろえる。 */
function songWithBars(count: number): model.Score {
  const { score } = makeSongWithBars(count);
  const staff = getStaff(score, 0);
  while (staff.bars.length < count) {
    const bar = new model.Bar();
    staff.addBar(bar);
    const voice = new model.Voice();
    bar.addVoice(voice);
    voice.addBeat(new model.Beat());
  }
  return score;
}

function noteOn(stringNumber: number): model.Beat {
  const beat = new model.Beat();
  beat.addNote(createStringNote(stringNumber, 0));
  return beat;
}

describe('scoreModel', () => {
  it('scoreModel_階層の外を指す_RangeErrorを投げる', () => {
    // UT-EDIT-MODEL-01 3.1 節「小節から音符までは、alphaTab の階層（Bar → Voice → Beat → Note）をそのまま使い」
    const { score } = buildEditTarget();
    expect(() => getStaff(score, 3)).toThrow(RangeError);
    score.tracks[0]!.staves.length = 0;
    expect(() => getStaff(score, 0)).toThrow(RangeError);
    const other = buildEditTarget().score;
    expect(() => getBar(other, 0, 5)).toThrow(RangeError);
    expect(() => getBeat(other, 0, 0, 9)).toThrow(RangeError);
    expect(() => getMasterBar(other, 4)).toThrow(RangeError);
  });

  it('scoreModel_getVoice_2つ目のボイスはBar.voicesの2つ目で無ければRangeError', () => {
    // UT-EDIT-MODEL-02 3.1 節「2 つ目は Bar.voices の 2 つ目に置く」「1 つの小節に置けるボイスは 2 つまで」
    const { score } = buildEditTarget();
    const bar = getBar(score, 0, 0);
    expect(getVoice(bar)).toBe(bar.voices[0]);
    expect(() => getVoice(bar, 1)).toThrow(RangeError);
    const second = new model.Voice();
    bar.addVoice(second);
    second.addBeat(noteOn(2));
    expect(getVoice(bar, 1)).toBe(second);
    expect(getBeat(score, 0, 0, 0, 1)).toBe(second.beats[0]);
  });

  it('scoreModel_applyDurationSpec_音符の長さと付点と連符を入れ控えた値で戻せる', () => {
    // UT-EDIT-MODEL-03 3.3 節「音価は、音符の長さ・付点の数・連符の組で表し、32 分音符と 3 連符も表せる」
    const beat = new model.Beat();
    const original = captureDurationFields(beat);
    applyDurationSpec(beat, {
      duration: model.Duration.ThirtySecond,
      dots: 2,
      tuplet: { numerator: 3, denominator: 2 },
    });
    expect(captureDurationFields(beat)).toEqual({
      duration: model.Duration.ThirtySecond,
      dots: 2,
      tupletNumerator: 3,
      tupletDenominator: 2,
    });
    applyDurationSpec(beat, { duration: model.Duration.Whole, dots: 0, tuplet: null });
    expect([beat.tupletNumerator, beat.tupletDenominator]).toEqual([1, 1]);
    restoreDurationFields(beat, original);
    expect(captureDurationFields(beat)).toEqual(original);
  });

  it('scoreModel_NOTE_DURATIONS_全音符から32分音符までの6つでその外はRangeError', () => {
    // UT-EDIT-MODEL-04 3.3 節「音符の長さは、全音符（Duration.Whole）から 32 分音符（Duration.ThirtySecond）までの 6 つに限る」
    expect(NOTE_DURATIONS).toEqual([
      model.Duration.Whole,
      model.Duration.Half,
      model.Duration.Quarter,
      model.Duration.Eighth,
      model.Duration.Sixteenth,
      model.Duration.ThirtySecond,
    ]);
    const beat = new model.Beat();
    const before = captureDurationFields(beat);
    for (const duration of [model.Duration.SixtyFourth, model.Duration.DoubleWhole]) {
      expect(() => applyDurationSpec(beat, { duration, dots: 0, tuplet: null })).toThrow(RangeError);
    }
    expect(captureDurationFields(beat)).toEqual(before);
  });

  it('scoreModel_insertBeatAtとremoveBeat_逆参照を張って足し取り除いた位置を返す', () => {
    // UT-EDIT-MODEL-05 2.4 節「足した拍から属する Voice への逆参照（Beat.voice）を、ヘルパーの insertBeatAt…で明示的に張る」
    const voice = getVoice(getBar(buildEditTarget().score, 0, 0));
    const first = voice.beats[0]!;
    const head = new model.Beat();
    const tail = new model.Beat();
    insertBeatAt(voice, -2, head);
    insertBeatAt(voice, 99, tail);
    expect(voice.beats).toEqual([head, first, tail]);
    expect(head.voice).toBe(voice);
    expect(tail.voice).toBe(voice);
    expect(removeBeat(voice, first)).toBe(1);
    expect(removeBeat(voice, first)).toBe(-1);
    expect(voice.beats).toEqual([head, tail]);
  });

  it('scoreModel_replaceNotes_音符の並びと弦から引く表を渡した並びにそろえる', () => {
    // UT-EDIT-MODEL-06 2.2 節「undo() は、execute() の変更を打ち消し、変更の前の状態へ戻す」（音符を元の順へ戻す道具）
    const beat = noteOn(3);
    const low = createStringNote(1, 2);
    beat.addNote(low);
    const original = [...beat.notes];
    beat.removeNote(original[0]!);
    replaceNotes(beat, original);
    expect(beat.notes).toEqual(original);
    expect(beat.getNoteOnString(3)).toBe(original[0]);
    expect(beat.getNoteOnString(1)).toBe(low);
  });

  it('scoreModel_findNextNoteOnString_同じ弦の次の音符を小節をまたいで探す', () => {
    // UT-EDIT-MODEL-07 3.4 節「同じ弦の次の音符 B」
    const score = songWithBars(3);
    const voice0 = getVoice(getBar(score, 0, 0));
    voice0.beats[0]!.addNote(createStringNote(3, 5));
    insertBeatAt(voice0, 1, noteOn(2));
    const target = createStringNote(3, 7);
    getVoice(getBar(score, 0, 2)).beats[0]!.addNote(target);
    expect(findNextNoteOnString(score, 0, 0, 0, 3)).toBe(target);
    expect(findNextNoteOnString(score, 0, 0, 0, 2)).toBe(voice0.beats[1]!.notes[0]);
    expect(findNextNoteOnString(score, 0, 2, 0, 3)).toBeNull();
  });

  it('scoreModel_findNextNoteOnString_SAME_STRING_SEARCH_BAR_SPANの小節より先は探さない', () => {
    // UT-EDIT-MODEL-08 3.4 節（描く前の作り直しで alphaTab がタイの始まりとして見つける 3 小節の幅にそろえる）
    expect(SAME_STRING_SEARCH_BAR_SPAN).toBe(3);
    const score = songWithBars(6);
    getVoice(getBar(score, 0, 0)).beats[0]!.addNote(createStringNote(3, 5));
    const far = createStringNote(3, 5);
    getVoice(getBar(score, 0, 4)).beats[0]!.addNote(far);
    expect(findNextNoteOnString(score, 0, 0, 0, 3)).toBeNull();
    expect(findNextNoteOnString(score, 0, 1, 0, 3)).toBe(far);
  });

  it('scoreModel_findNextNoteOnString_2つ目のボイス_無い小節は飛ばしてそのボイスの拍だけを見る', () => {
    // UT-EDIT-MODEL-09 3.1 節「もう一方のボイスの拍は、写しも書き換えもしない」（ボイスごとに辿る）
    const score = songWithBars(2);
    getVoice(getBar(score, 0, 1)).beats[0]!.addNote(createStringNote(3, 5));
    const second = new model.Voice();
    getBar(score, 0, 0).addVoice(second);
    second.addBeat(noteOn(3));
    expect(findNextNoteOnString(score, 0, 0, 0, 3, 1)).toBeNull();
    expect(findNextNoteOnString(score, 0, 0, -1, 3, 1)).toBe(second.beats[0]!.notes[0]);
  });

  it('scoreModel_openStringPitch_弦の外は0', () => {
    // UT-EDIT-MODEL-10 3.1 節（弦の番号は 1 が最も低い弦。チューニングの外の弦は音の高さを持たない）
    const staff = getStaff(buildEditTarget().score, 0);
    expect(openStringPitch(staff, 1)).toBe(40);
    expect(openStringPitch(staff, 6)).toBe(64);
    expect(openStringPitch(staff, 7)).toBe(0);
  });
});
