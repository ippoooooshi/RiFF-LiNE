// UT-EDIT-MODEL: scoreModel（alphaTab の Score の階層を辿る・作る道具） <!-- req webcorefoundation:b6101ee6.dbac -->
// 検証節: editing-core.md 2.4 節・3.1 節・3.3 節・3.4 節
// 検証観点: 階層の外を指したときの RangeError、2 つ目のボイスの引き方、音価の入れ方と戻し方、
//   拍の挿入（逆参照を張る）と取り除き、音符の並びの置き直し、同じ弦の次の音符の探し方。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import {
  applyDurationSpec,
  beatIndexForVoiceSwitch,
  captureDurationFields,
  clampStringNumber,
  createRestBeat,
  ensureSecondVoice,
  findNextNoteOnString,
  findNextNoteRefOnString,
  getBar,
  getBeat,
  getMasterBar,
  getStaff,
  getVoice,
  insertBeatAt,
  isBarFilled,
  NOTE_DURATIONS,
  openStringPitch,
  removeBeat,
  removeVoice,
  replaceNotes,
  restoreDurationFields,
  SAME_STRING_SEARCH_BAR_SPAN,
  createStringNote,
  voiceBeats,
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

  it('scoreModel_isBarFilled_音価の合計が拍子の長さに届いたか超えたとき真', () => {
    // UT-EDIT-MODEL-11 4.1 節「小節が埋まったとき（小節の音価の合計が拍子の長さに届いたか超えたとき）」・3.3 節（付点・連符を含む音価）
    const { score } = buildEditTarget();
    const voice = getVoice(getBar(score, 0, 0));
    const setBeats = (beats: model.Beat[]): void => {
      voice.beats.length = 0;
      beats.forEach((beat, i) => insertBeatAt(voice, i, beat));
    };
    const beatOf = (duration: model.Duration, dots = 0, tuplet: [number, number] = [1, 1]): model.Beat => {
      const beat = createRestBeat(duration);
      beat.dots = dots;
      [beat.tupletNumerator, beat.tupletDenominator] = tuplet;
      return beat;
    };
    const Q = model.Duration.Quarter;
    setBeats([beatOf(Q), beatOf(Q), beatOf(Q)]);
    expect(isBarFilled(score, 0, 0, 0)).toBe(false);
    setBeats([beatOf(Q), beatOf(Q), beatOf(Q), beatOf(Q)]);
    expect(isBarFilled(score, 0, 0, 0)).toBe(true);
    // 付点 4 分 2 つ（3/8 + 3/8）と 4 分 1 つで 1、複付点 2 分（7/8）だけでは届かない
    setBeats([beatOf(Q, 1), beatOf(Q, 1), beatOf(Q)]);
    expect(isBarFilled(score, 0, 0, 0)).toBe(true);
    setBeats([beatOf(model.Duration.Half, 2)]);
    expect(isBarFilled(score, 0, 0, 0)).toBe(false);
    // 8 分の 3 連符 6 つ（2/3 × 1/8 × 6 = 1/2）と 2 分 1 つで 1。3 連符を 5 つにすると届かない
    const triplets = (count: number): model.Beat[] =>
      Array.from({ length: count }, () => beatOf(model.Duration.Eighth, 0, [3, 2]));
    setBeats([...triplets(6), beatOf(model.Duration.Half)]);
    expect(isBarFilled(score, 0, 0, 0)).toBe(true);
    setBeats([...triplets(5), beatOf(model.Duration.Half)]);
    expect(isBarFilled(score, 0, 0, 0)).toBe(false);
    // 超えたときも真。Duration の負の値（DoubleWhole）は全音符 2 つ分
    setBeats([beatOf(model.Duration.Whole), beatOf(Q)]);
    expect(isBarFilled(score, 0, 0, 0)).toBe(true);
    setBeats([beatOf(model.Duration.DoubleWhole)]);
    expect(isBarFilled(score, 0, 0, 0)).toBe(true);
    // 拍子の長さで数える（3/4 では 4 分 3 つで埋まる）。2 つ目のボイスがまだ無ければ埋まっていない
    getMasterBar(score, 0).timeSignatureNumerator = 3;
    setBeats([beatOf(Q), beatOf(Q), beatOf(Q)]);
    expect(isBarFilled(score, 0, 0, 0)).toBe(true);
    expect(isBarFilled(score, 0, 0, 1)).toBe(false);
    expect(voiceBeats(score, 0, 0, 1)).toEqual([]);
  });

  it('scoreModel_beatIndexForVoiceSwitch_同じか直前に始まる切り替え先の拍', () => {
    // UT-EDIT-MODEL-12 3.1 節「ボイスを切り替えたら、同じ小節の中で、それまでの拍の始まりの時刻と同じか、その直前に始まる、
    //   切り替えた先のボイスの拍へカーソルを移す」・4.1 節「2 つ目のボイスがまだ無い小節では…拍 0」
    const { score } = buildEditTarget();
    const bar = getBar(score, 0, 0);
    expect(beatIndexForVoiceSwitch(score, 0, 0, 0, 0, 1)).toBe(0);
    const first = getVoice(bar);
    first.beats.length = 0;
    for (let i = 0; i < 4; i++) insertBeatAt(first, i, createRestBeat(model.Duration.Quarter));
    const second = ensureSecondVoice(bar)!;
    expect(beatIndexForVoiceSwitch(score, 0, 0, 0, 2, 1)).toBe(0);
    insertBeatAt(second, 0, createRestBeat(model.Duration.Half));
    insertBeatAt(second, 1, createRestBeat(model.Duration.Half));
    // ボイス 1 の拍 1（1/4 で始まる）→ ボイス 2 の拍 0（0 で始まる）、拍 2（1/2）→ 拍 1（1/2、同じ時刻）
    expect(beatIndexForVoiceSwitch(score, 0, 0, 0, 1, 1)).toBe(0);
    expect(beatIndexForVoiceSwitch(score, 0, 0, 0, 2, 1)).toBe(1);
    expect(beatIndexForVoiceSwitch(score, 0, 0, 0, 3, 1)).toBe(1);
    // 最後の拍の後ろ（beats.length）からは、切り替え先の最後の拍
    expect(beatIndexForVoiceSwitch(score, 0, 0, 0, 4, 1)).toBe(1);
    // ボイス 2 の拍 1（1/2）→ ボイス 1 の拍 2
    expect(beatIndexForVoiceSwitch(score, 0, 0, 1, 1, 0)).toBe(2);
  });

  it('scoreModel_ensureSecondVoice_無ければ2つ目を作り在れば作らずremoveVoiceで外す', () => {
    // UT-EDIT-MODEL-13 4.1 節「その小節の Bar.voices に 2 つ目の Voice を作る。作った Voice は、置いたコマンドの undo で外す」
    const { score } = buildEditTarget();
    const bar = getBar(score, 0, 0);
    const created = ensureSecondVoice(bar)!;
    expect(bar.voices).toHaveLength(2);
    expect(bar.voices[1]).toBe(created);
    expect(created.bar).toBe(bar);
    expect(ensureSecondVoice(bar)).toBeNull();
    expect(bar.voices).toHaveLength(2);
    removeVoice(bar, created);
    expect(bar.voices).toHaveLength(1);
    removeVoice(bar, created);
    expect(bar.voices).toHaveLength(1);
    expect(ensureSecondVoice(bar, created)).toBe(created);
    expect(bar.voices[1]).toBe(created);
  });

  it('scoreModel_clampStringNumber_1からパートの弦の本数までに収める', () => {
    // UT-EDIT-MODEL-14 4.1 節「↑ ↓ は選んでいる弦を 1 本ずつ変え、一番低い弦と一番高い弦で止める（反対の端へ回らない）」
    const { score } = buildEditTarget();
    expect(clampStringNumber(score, 0, 0)).toBe(1);
    expect(clampStringNumber(score, 0, 3)).toBe(3);
    expect(clampStringNumber(score, 0, 7)).toBe(6);
  });

  it('scoreModel_findNextNoteRefOnString_見つけた音符の位置と弦を返す', () => {
    // UT-EDIT-MODEL-15 3.5 節「「次の音まで」はその音符と、同じ弦の次の音符（無ければその音符だけ）の両方に立てる」
    const score = songWithBars(2);
    const target = createStringNote(4, 2);
    getVoice(getBar(score, 0, 1)).beats[0]!.addNote(target);
    expect(findNextNoteRefOnString(score, 0, 0, 0, 4)).toEqual({
      note: target,
      ref: { position: { trackIndex: 0, barIndex: 1, voiceIndex: 0, beatIndex: 0 }, stringNumber: 4 },
    });
    expect(findNextNoteRefOnString(score, 0, 1, 0, 4)).toBeNull();
  });

  it('scoreModel_findNextNoteRefOnString_SAME_STRING_SEARCH_BAR_SPANの小節より先もパートの最後まで探す', () => {
    // UT-EDIT-MODEL-16 3.5 節「「次の音まで」はその音符と、同じ弦の次の音符（無ければその音符だけ）の両方に立てる」
    //   （パームミュートの次の音符は、タイの 3 小節の幅で区切らない）
    const score = songWithBars(6);
    getVoice(getBar(score, 0, 0)).beats[0]!.addNote(createStringNote(3, 5));
    const far = createStringNote(3, 5);
    getVoice(getBar(score, 0, 5)).beats[0]!.addNote(far);
    expect(findNextNoteOnString(score, 0, 0, 0, 3)).toBeNull();
    expect(findNextNoteRefOnString(score, 0, 0, 0, 3)).toEqual({
      note: far,
      ref: { position: { trackIndex: 0, barIndex: 5, voiceIndex: 0, beatIndex: 0 }, stringNumber: 3 },
    });
    expect(findNextNoteRefOnString(score, 0, 5, 0, 3)).toBeNull();
  });
});
