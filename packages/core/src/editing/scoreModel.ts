/**
 * alphaTab `model.Score` グラフのナビゲーション／生成ヘルパー（editing-core.md §3）。
 *
 * コマンド実装から alphaTab グラフの走査コードを分離し、1 箇所に集約する（テスト可能な縫い目・単一の真実源）。
 * MVP は「1 トラック = 1 Staff = 1 Voice」前提（04_editing_core.md §1、newSong.ts と同じ）。
 */

// data-model-persistence.md 3 節：実行時の曲のモデルは alphaTab の Score・Track・Staff・Bar・Voice・Beat・Note を土台にして辿る <!-- req datamodelpersistence:b10105e1.f339 --> <!-- req datamodelpersistence:b10105e1.59b4 --> <!-- req datamodelpersistence:b10105e1.f15a --> <!-- req datamodelpersistence:b10105e1.9c16 --> <!-- req datamodelpersistence:b10105e1.6120 --> <!-- req datamodelpersistence:b10105e1.92d4 --> <!-- req datamodelpersistence:b10105e1.f436 -->
import { model, Settings } from '@coderline/alphatab';

import type { BeatDurationSpec, NoteRef } from './types';

/** フレット番号の許容範囲（04_editing_core.md §4、`EDIT-002`）。 */
// <!-- req editingcore:5e3e2ebe.f073 -->
export const MIN_FRET = 0;
// <!-- req editingcore:5e3e2ebe.f5db -->
export const MAX_FRET = 24;

/** 小節数のハードキャップ（04_editing_core.md §4・§11、`EDIT-003`、B20）。 */
// <!-- req editingcore:570b0a02.49f0 --> <!-- req editingcore:570b0a02.50dd -->
export const MAX_BAR_COUNT = 2048;

/** `score.tracks` の本数。 */
export function trackCount(score: model.Score): number {
  return score.tracks.length;
}

/** 全トラックのインデックス（`InsertBarCommand` 等の「全パート」affectedTrackIndices 用）。 */
export function allTrackIndices(score: model.Score): number[] {
  return score.tracks.map((_track, index) => index);
}

/** 小節数（= MasterBar 数。全パートで同一）。 */
export function barCount(score: model.Score): number {
  return score.masterBars.length;
}

// data-model-persistence.md 4 節：パートの譜表は Track.staves[0] の Staff とする <!-- req datamodelpersistence:b5b55bb6.5754 --> <!-- req datamodelpersistence:b5b55bb6.1136 -->
/** 指定トラックの主 Staff（MVP は staff 0）。 */
export function getStaff(score: model.Score, trackIndex: number): model.Staff {
  const track = score.tracks[trackIndex];
  if (!track) throw new RangeError(`trackIndex out of range: ${trackIndex}`);
  const staff = track.staves[0];
  if (!staff) throw new RangeError(`track ${trackIndex} has no staff`);
  return staff;
}

/** 指定トラックの弦数（開放弦チューニング数）。 */
export function stringCount(score: model.Score, trackIndex: number): number {
  return getStaff(score, trackIndex).tuning.length;
}

/** 指定位置の Bar。 */
export function getBar(score: model.Score, trackIndex: number, barIndex: number): model.Bar {
  // data-model-persistence.md 4 節：パートの小節は Bar（Staff.bars）で表す <!-- req datamodelpersistence:806faf90.7f0b -->
  const bar = getStaff(score, trackIndex).bars[barIndex];
  if (!bar) throw new RangeError(`barIndex out of range: ${barIndex} (track ${trackIndex})`);
  return bar;
}

/**
 * Bar の Voice（editing-core.md 3.1 節）。小節から音符までは alphaTab の階層（Bar → Voice → Beat → Note）をそのまま使い、
 * 自前の階層を作らない。ボイスは 1 小節に 1 つ（Bar.voices の 1 つ目）を基本とし、2 つ目のボイスは Bar.voices の 2 つ目に置く。
 * 1 つの小節に置けるボイスは 2 つまでなので、voiceIndex は 0（1 つ目）か 1（2 つ目）の型に限り、既定は 1 つ目とする。
 */
// <!-- req editingcore:4f7b6002.a64f --> <!-- req editingcore:4f7b6002.1c02 --> <!-- req editingcore:4f7b6002.5c1c --> <!-- req editingcore:4f7b6002.a40a --> <!-- req editingcore:dfa5c06f.ea0d --> <!-- req editingcore:dfa5c06f.359e --> <!-- req editingcore:8ee56da1.fbf3 -->
export function getVoice(bar: model.Bar, voiceIndex: 0 | 1 = 0): model.Voice {
  // data-model-persistence.md 4 節：VOICE は Voice（Bar.voices）で表す <!-- req datamodelpersistence:6b0cf6a1.3945 -->
  // <!-- req editingcore:dfa5c06f.52a4 -->
  const voice = bar.voices[voiceIndex];
  if (!voice) throw new RangeError(`bar has no voice ${voiceIndex}`);
  return voice;
}

/** 指定位置の Beat。voiceIndex は getVoice と同じ（既定は Bar.voices の 1 つ目）。 */
export function getBeat(
  score: model.Score,
  trackIndex: number,
  barIndex: number,
  beatIndex: number,
  voiceIndex: 0 | 1 = 0,
): model.Beat {
  const voice = getVoice(getBar(score, trackIndex, barIndex), voiceIndex);
  // data-model-persistence.md 4 節：BEAT は Beat（Voice.beats）で表す <!-- req datamodelpersistence:235d262a.c4f8 -->
  const beat = voice.beats[beatIndex];
  if (!beat) throw new RangeError(`beatIndex out of range: ${beatIndex} (track ${trackIndex}, bar ${barIndex})`);
  return beat;
}

// data-model-persistence.md 4 節：拍子・テンポ・リピートは曲共通の小節 MasterBar（Score.masterBars）が持つ <!-- req datamodelpersistence:806faf90.e590 -->
/** 指定位置の MasterBar（拍子・テンポの器）。 */
// <!-- req editingcore:af3f1af2.fdb5 --> <!-- req editingcore:af3f1af2.c192 -->
export function getMasterBar(score: model.Score, barIndex: number): model.MasterBar {
  const masterBar = score.masterBars[barIndex];
  if (!masterBar) throw new RangeError(`masterBar index out of range: ${barIndex}`);
  return masterBar;
}

/**
 * Beat 内の指定弦の Note（無ければ null）。弦の番号 `stringNumber` は、editing-core.md 3.7 節の弦の論理名 `stringIndex` に当たり、
 * alphaTab の `Note.string` と同じ数え方（1 が最も低い弦）をする。
 */
// <!-- req editingcore:8ba29eb2.8991 -->
export function findNoteOnString(beat: model.Beat, stringNumber: number): model.Note | null {
  // data-model-persistence.md 4 節：NOTE は Note（Beat.notes）で表す <!-- req datamodelpersistence:cf9b39de.604a -->
  return beat.notes.find((note) => note.string === stringNumber) ?? null;
}

/**
 * 指定弦の開放弦 MIDI ピッチ（規約の単一の真実源）。
 *
 * **alphaTab 規約**：`note.string` は 1 = 最低音弦（タブ最下線）で上へ増加。一方 `staff.tuning`
 * （= `stringTuning.tunings`）は先頭＝最高音弦の並び（高音弦→低音弦）。よって `stringNumber` 番弦の
 * 開放弦ピッチは `tuning[tuning.length - stringNumber]`（alphaTab 本体のピッチ算出式と一致）。
 * カポ・フレットは呼び出し側で加算する（実音 = 本値 + capo + fret）。
 */
export function openStringPitch(staff: model.Staff, stringNumber: number): number {
  const tuning = staff.tuning;
  return tuning[tuning.length - stringNumber] ?? 0;
}

// data-model-persistence.md 4 節：休符は音価を duration に持ち notes が空の Beat として作り、isRest に書き込まない <!-- req datamodelpersistence:235d262a.4d97 --> <!-- req datamodelpersistence:235d262a.9faf --> <!-- req datamodelpersistence:235d262a.c629 -->
/** 全休符の Beat を新規生成する。 */
// <!-- req editingcore:8c147b81.ca14 --> <!-- req editingcore:8c147b81.e572 --> <!-- req editingcore:8c147b81.438a -->
export function createRestBeat(duration: model.Duration): model.Beat {
  const beat = new model.Beat();
  beat.duration = duration;
  return beat;
}

// data-model-persistence.md 4 節：音符の弦は string、フレットは fret に持つ <!-- req datamodelpersistence:cf9b39de.e785 --> <!-- req datamodelpersistence:cf9b39de.1d4a -->
/** 弦・フレット指定の Note を新規生成する（`beat.addNote` で追加すること）。 */
export function createStringNote(stringNumber: number, fret: number): model.Note {
  const note = new model.Note();
  // <!-- req editingcore:54e0b2f1.b473 -->
  note.string = stringNumber;
  note.fret = fret;
  return note;
}

/**
 * Voice の任意位置へ Beat を挿入する（editing-core.md 2.4 節、B33）。拍や小節を足すコマンドは、足した拍から属する Voice への
 * 逆参照（`Beat.voice`）をここで明示的に張る。`Voice.beats` へ直に足すだけでは逆参照が張られず、描き直しの前に
 * `ScoreRenderHost` が曲を組み直すとき（`Score.finish`）に失敗するため。`Beat.index` などの finish() が作る派生情報は触らない。
 * @param index `voice.beats.length` 以上なら末尾追加。
 */
// <!-- req editingcore:54e0b2f1.b3ab --> <!-- req editingcore:1d5ebb81.d652 -->
export function insertBeatAt(voice: model.Voice, index: number, beat: model.Beat): void {
  // <!-- req editingcore:1d5ebb81.cd5c --> <!-- req editingcore:1d5ebb81.b432 --> <!-- req editingcore:1d5ebb81.de28 -->
  beat.voice = voice;
  if (index >= voice.beats.length) {
    voice.beats.push(beat);
  } else {
    voice.beats.splice(Math.max(0, index), 0, beat);
  }
}

/**
 * Voice から Beat を取り除き、取り除いた位置を返す（無ければ -1）。取り消しで `insertBeatAt` に同じ位置を渡して戻す。
 */
export function removeBeat(voice: model.Voice, beat: model.Beat): number {
  const index = voice.beats.indexOf(beat);
  if (index >= 0) voice.beats.splice(index, 1);
  return index;
}

/**
 * 休符の拍を取り除いた後、拍が 1 つも無くなった 1 つ目のボイス（`Bar.voices` の 1 つ目）に、全音符の長さの休符の拍を 1 つ置き、
 * 置いた拍を返す（拍が残っていれば何もせず null）。editing-core.md 3.3 節「小節の中で音を置かない位置は、自動で休符の Beat にする」と、
 * 4.4 節の (b) の、小節全体の休符は拍子によらず全音符の休符の拍 1 つで書く形（小節を作るコマンドと同じ）に合わせる。
 * 拍が 0 個のボイスは alphaTab の曲の形に無く（読み込みでは空のボイスにも拍を 1 つ置く）、描く前の作り直し（`Score.finish`）が
 * 前の小節の最後の拍から次の拍をつなぐところで失敗するため。取り消しでは、戻す拍を入れる前に、置いた拍を `removeBeat` で外す。
 */
export function fillEmptyVoiceWithBarRest(voice: model.Voice): model.Beat | null {
  if (voice.beats.length > 0) return null;
  const rest = createRestBeat(model.Duration.Whole);
  insertBeatAt(voice, 0, rest);
  return rest;
}

/**
 * Beat の音符の並びを、渡した並びに置き直す。`Beat.addNote`・`Beat.removeNote` だけを使い、alphaTab が弦から音符を引く表
 * （`Beat.getNoteOnString` が読む）も同じに保つ。取り消しで音符を元の順に戻すときに使う。
 */
export function replaceNotes(beat: model.Beat, notes: readonly model.Note[]): void {
  for (const note of [...beat.notes]) beat.removeNote(note);
  for (const note of notes) beat.addNote(note);
}

/**
 * 音符の長さとして置ける 6 つ（editing-core.md 3.3 節）。全音符（`Duration.Whole`）から 32 分音符（`Duration.ThirtySecond`）まで。
 */
// <!-- req editingcore:a8c1f983.67fd -->
export const NOTE_DURATIONS: readonly model.Duration[] = [
  model.Duration.Whole,
  model.Duration.Half,
  model.Duration.Quarter,
  model.Duration.Eighth,
  model.Duration.Sixteenth,
  // <!-- req editingcore:a8c1f983.ecd7 -->
  model.Duration.ThirtySecond,
];

/** Beat の音価を作る 4 つの項目の、そのままの値（取り消しで戻すために控える）。 */
export interface BeatDurationFields {
  duration: model.Duration;
  dots: number;
  tupletNumerator: number;
  tupletDenominator: number;
}

/** Beat の音価の 4 つの項目を控える。 */
export function captureDurationFields(beat: model.Beat): BeatDurationFields {
  return {
    duration: beat.duration,
    dots: beat.dots,
    tupletNumerator: beat.tupletNumerator,
    tupletDenominator: beat.tupletDenominator,
  };
}

/** 控えた音価の 4 つの項目を Beat に戻す。 */
export function restoreDurationFields(beat: model.Beat, fields: BeatDurationFields): void {
  beat.duration = fields.duration;
  beat.dots = fields.dots;
  beat.tupletNumerator = fields.tupletNumerator;
  beat.tupletDenominator = fields.tupletDenominator;
}

/**
 * 音価（editing-core.md 3.3 節・4.3 節）を Beat に入れる。音符の長さは `Beat.duration`、付点の数は `Beat.dots`、
 * 連符は `Beat.tupletNumerator`・`Beat.tupletDenominator` に持つ。連符でない（`tuplet` が null）ときは分子と分母を 1 にする。
 * 音符の長さが `NOTE_DURATIONS` の 6 つの外なら、何も変えずに RangeError を投げる（確かめは発行の前に済んでいる前提）。
 */
export function applyDurationSpec(beat: model.Beat, spec: BeatDurationSpec): void {
  if (!NOTE_DURATIONS.includes(spec.duration)) {
    throw new RangeError(`duration out of range: ${spec.duration}`);
  }
  // <!-- req editingcore:a8c1f983.9f40 -->
  beat.duration = spec.duration;
  // <!-- req editingcore:f270f4a2.c24d --> <!-- req editingcore:a8c1f983.4e71 -->
  beat.dots = spec.dots;
  // <!-- req editingcore:f270f4a2.0447 --> <!-- req editingcore:a8c1f983.d7d3 -->
  beat.tupletNumerator = spec.tuplet?.numerator ?? 1;
  // <!-- req editingcore:f270f4a2.b3ac --> <!-- req editingcore:a8c1f983.010a -->
  beat.tupletDenominator = spec.tuplet?.denominator ?? 1;
}

/**
 * 小節に 2 つ目のボイスがまだ無ければ、`Bar.voices` の 2 つ目に空の Voice を作り、作った Voice を返す（editing-core.md 4.1 節）。
 * 既に 2 つ目があれば何もせず null を返す。音か休符をボイス 2 に置くコマンド（PlaceNoteCommand・InsertRestCommand）が使い、
 * 作った Voice は置いたコマンドの undo で `removeVoice` で外す（音を置いていない小節に空のボイスを残さないため）。
 * @param created やり直しのときに、前の execute で作った同じ Voice を置き直すために渡す。
 */
// <!-- req editingcore:32ac0aef.6f50 -->
export function ensureSecondVoice(bar: model.Bar, created: model.Voice | null = null): model.Voice | null {
  if (bar.voices.length >= 2) return null;
  const voice = created ?? new model.Voice();
  bar.addVoice(voice);
  return voice;
}

/** `ensureSecondVoice` で作った Voice を、小節の `Bar.voices` から外す（editing-core.md 4.1 節）。 */
// <!-- req editingcore:32ac0aef.cdc0 -->
export function removeVoice(bar: model.Bar, voice: model.Voice): void {
  const index = bar.voices.indexOf(voice);
  if (index >= 0) bar.voices.splice(index, 1);
}

/** 拍が 0 個になって外した 2 つ目の Voice と、外した小節と、`Bar.voices` の中の元の位置（取り消しで同じ位置に戻す）。 */
export interface RemovedVoice {
  readonly bar: model.Bar;
  readonly voice: model.Voice;
  readonly index: number;
}

/**
 * 範囲の削除や音符の削除で、2 つ目のボイス（`Bar.voices` の 1 つ目より後）の拍が 0 個になったら、その小節の `Bar.voices` から外し、
 * 外した所を返す（拍が残っているか、1 つ目のボイスなら何もせず null。editing-core.md 4.1 節の (b)、2026-11-10 チャット側の決定 265 番）。
 * 音を置いていない小節に空のボイスを残さないため。取り消しでは `restoreRemovedVoice` で同じ位置に戻す。
 */
// <!-- req editingcore:31c02a9c.92df --> <!-- req editingcore:31c02a9c.e01a -->
export function removeVoiceIfNoBeats(voice: model.Voice): RemovedVoice | null {
  const bar = voice.bar;
  if (voice.beats.length > 0) return null;
  const index = bar.voices.indexOf(voice);
  if (index < 1) return null;
  bar.voices.splice(index, 1);
  return { bar, voice, index };
}

/** `removeVoiceIfNoBeats` で外した Voice を、小節の `Bar.voices` の元の位置に戻す（editing-core.md 4.1 節の (b)）。 */
// <!-- req editingcore:31c02a9c.f273 -->
export function restoreRemovedVoice(removed: RemovedVoice): void {
  removed.bar.voices.splice(removed.index, 0, removed.voice);
  removed.voice.bar = removed.bar;
  removed.voice.index = removed.index;
}

/** 長さを全音符を 1 とする分数で表す（小節が埋まったかを、丸めずに数えるため）。 */
interface WholeFraction {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function fraction(n: number, d: number): WholeFraction {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function addFraction(a: WholeFraction, b: WholeFraction): WholeFraction {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}

/** a が b 以上か。 */
function fractionAtLeast(a: WholeFraction, b: WholeFraction): boolean {
  return a.n * b.d >= b.n * a.d;
}

/**
 * 拍の音価の長さ（全音符を 1）。音符の長さ（`Beat.duration`）・付点（`Beat.dots`、k 個で (2^(k+1)−1)/2^k 倍）・
 * 連符（`tupletDenominator / tupletNumerator` 倍）の組から数える（editing-core.md 3.3 節・4.3 節）。
 * `Duration` の負の値（`DoubleWhole` は −2、`QuadrupleWhole` は −4）は、その絶対値の数の全音符の長さ。
 */
function beatLength(beat: model.Beat): WholeFraction {
  const base = beat.duration > 0 ? fraction(1, beat.duration) : fraction(-beat.duration, 1);
  const dotted = fraction(base.n * (2 ** (beat.dots + 1) - 1), base.d * 2 ** beat.dots);
  return fraction(dotted.n * beat.tupletDenominator, dotted.d * beat.tupletNumerator);
}

/** 指定したボイスの拍の並び。小節にそのボイスがまだ無ければ空（editing-core.md 4.1 節「2 つ目のボイスがまだ無い小節」）。 */
export function voiceBeats(score: model.Score, trackIndex: number, barIndex: number, voiceIndex: 0 | 1): model.Beat[] {
  return getBar(score, trackIndex, barIndex).voices[voiceIndex]?.beats ?? [];
}

/**
 * 小節が埋まったか（editing-core.md 4.1 節）：指定したボイスの拍の音価の合計が、その小節の拍子の長さ
 * （`MasterBar.timeSignatureNumerator / timeSignatureDenominator` 全音符）に届いたか超えたとき真。
 */
export function isBarFilled(score: model.Score, trackIndex: number, barIndex: number, voiceIndex: 0 | 1): boolean {
  const total = voiceBeats(score, trackIndex, barIndex, voiceIndex).reduce(
    (sum, beat) => addFraction(sum, beatLength(beat)),
    fraction(0, 1),
  );
  const masterBar = getMasterBar(score, barIndex);
  // <!-- req editingcore:2dc49069.6ebb --> <!-- req editingcore:2dc49069.a071 -->
  return fractionAtLeast(total, fraction(masterBar.timeSignatureNumerator, masterBar.timeSignatureDenominator));
}

/**
 * ボイスを切り替えたときの、切り替えた先のボイスの拍のインデックス（editing-core.md 3.1 節）。同じ小節の中で、それまでの拍
 * （`fromVoice` の `beatIndex`。`beats.length` なら最後の拍の後ろ）の始まりの時刻と同じか、その直前に始まる、`toVoice` の拍を返す。
 * 切り替えた先のボイスがまだ無いか拍が無い小節では 0（最後の拍の後ろ、4.1 節）。呼ぶ側は、返した拍の位置を
 * `CursorController.setPosition` に渡してボイスを切り替える。
 */
// <!-- req editingcore:32ac0aef.318d --> <!-- req editingcore:c21fa2a1.5aec --> <!-- req editingcore:c21fa2a1.1136 --> <!-- req editingcore:c21fa2a1.5a04 -->
export function beatIndexForVoiceSwitch(
  score: model.Score,
  trackIndex: number,
  barIndex: number,
  fromVoice: 0 | 1,
  beatIndex: number,
  toVoice: 0 | 1,
): number {
  const start = voiceBeats(score, trackIndex, barIndex, fromVoice)
    .slice(0, beatIndex)
    .reduce((sum, beat) => addFraction(sum, beatLength(beat)), fraction(0, 1));
  let found = 0;
  let time = fraction(0, 1);
  const targetBeats = voiceBeats(score, trackIndex, barIndex, toVoice);
  for (let i = 0; i < targetBeats.length && fractionAtLeast(start, time); i++) {
    found = i;
    time = addFraction(time, beatLength(targetBeats[i]!));
  }
  return found;
}

/**
 * 選んでいる弦を、そのパートの弦の範囲（1 から `stringCount`）に収める（editing-core.md 4.1 節「↑ ↓ は…一番低い弦と一番高い弦で
 * 止める（反対の端へ回らない）」）。↑ ↓ の呼ぶ側は `CursorController.currentString ± 1` をこれに通して `setString` に渡す。
 */
// <!-- req editingcore:73808091.865e --> <!-- req editingcore:73808091.812d -->
export function clampStringNumber(score: model.Score, trackIndex: number, stringNumber: number): number {
  return Math.min(Math.max(1, stringNumber), stringCount(score, trackIndex));
}

/**
 * 同じ弦の次の音符を探す小節の幅。alphaTab 1.8.4 の `Note` が同じ弦の前後の音符を探す幅（`_maxOffsetForSameLineSearch`、
 * `alphaTab.core.mjs` の `nextNoteOnSameLine`・`findTieOrigin`）と同じ 3 小節にそろえる。これより先の音符は、alphaTab が
 * 描く前の作り直しでタイの始まりとして見つけないため。
 */
// <!-- req editingcore:927478a0.bb0c -->
export const SAME_STRING_SEARCH_BAR_SPAN = 3;

/**
 * 指定した拍より後ろで、同じ弦に音符を持つ最初の拍の、その音符（editing-core.md 3.4 節のタイの「同じ弦の次の音符」）。
 * 同じパートの同じボイスの拍を、小節をまたいで前から順に見る。見るのは指定した小節から `SAME_STRING_SEARCH_BAR_SPAN` 小節先まで。
 * 前後の拍のつながり（`Beat.nextBeat`）は finish() が作る派生情報なので使わず、配列の位置で辿る。
 */
export function findNextNoteOnString(
  score: model.Score,
  trackIndex: number,
  barIndex: number,
  beatIndex: number,
  stringNumber: number,
  voiceIndex: 0 | 1 = 0,
): model.Note | null {
  // <!-- req editingcore:927478a0.c982 -->
  const lastBar = barIndex + SAME_STRING_SEARCH_BAR_SPAN;
  return scanNextNoteOnString(score, trackIndex, barIndex, beatIndex, stringNumber, voiceIndex, lastBar)?.note ?? null;
}

/**
 * 同じ弦の次の音符と、その音符の場所（拍の位置と弦）を返す。パームミュートの「次の音まで」（editing-core.md 3.5 節「同じ弦の次の
 * 音符（無ければその音符だけ）」）で、同じ弦の次の音符にもコマンドを出すために、その音符の位置が要るため。探し方は
 * `findNextNoteOnString` と同じだが、タイと違って alphaTab が描く前の作り直しで探し直すものではないので、
 * `SAME_STRING_SEARCH_BAR_SPAN` の幅で区切らず、パートの最後の小節まで見る。
 */
export function findNextNoteRefOnString(
  score: model.Score,
  trackIndex: number,
  barIndex: number,
  beatIndex: number,
  stringNumber: number,
  voiceIndex: 0 | 1 = 0,
): { note: model.Note; ref: NoteRef } | null {
  return scanNextNoteOnString(score, trackIndex, barIndex, beatIndex, stringNumber, voiceIndex, Infinity);
}

/** 指定した拍より後ろを、同じボイスの拍で前から順に、lastBarLimit の小節（パートの最後の小節を超えるときは最後の小節）まで見る。 */
function scanNextNoteOnString(
  score: model.Score,
  trackIndex: number,
  barIndex: number,
  beatIndex: number,
  stringNumber: number,
  voiceIndex: 0 | 1,
  lastBarLimit: number,
): { note: model.Note; ref: NoteRef } | null {
  const bars = getStaff(score, trackIndex).bars;
  const lastBar = Math.min(bars.length - 1, lastBarLimit);
  for (let b = barIndex; b <= lastBar; b++) {
    const beats = bars[b]!.voices[voiceIndex]?.beats ?? [];
    for (let i = b === barIndex ? beatIndex + 1 : 0; i < beats.length; i++) {
      const note = findNoteOnString(beats[i]!, stringNumber);
      if (note !== null) {
        return { note, ref: { position: { trackIndex, barIndex: b, voiceIndex, beatIndex: i }, stringNumber } };
      }
    }
  }
  return null;
}

/**
 * 継いでいる小節の拍子の値をそろえる（editing-core.md 3.2 節・10 節の (b)）。置き場所は 10 節の宣言のとおり本ファイル。
 *
 * 拍子をはっきり入れた小節の一覧（`explicitTimeSignatureBars`）に無い小節の `MasterBar` に、直前の小節と同じ拍子の値を置く。
 * 継ぐ向きの指定（一覧と null）を作り直す再計算ではなく、変わっていない指定から、alphaTab の `MasterBar` が小節ごとに持つ拍子の値を
 * 写し直すだけの処理とする（10 節の (b)）。一覧も引数で受けて読むだけで、書き換えない。1 小節目は継ぐ先が無いので、一覧に無くても値を変えない。
 * `InsertMasterBarCommand`・`DeleteMasterBarCommand`・`SetTimeSignatureCommand` の execute と undo の最後に呼び、
 * 継いでいる小節の値を写し直す所をここ 1 つにする。
 */
// <!-- req editingcore:5741aa16.b563 --> <!-- req editingcore:5741aa16.65a9 --> <!-- req editingcore:5741aa16.9f2a --> <!-- req editingcore:5741aa16.3486 -->
// <!-- req editingcore:e2a29f1e.0a78 --> <!-- req editingcore:e2a29f1e.d7dc --> <!-- req editingcore:e2a29f1e.eb15 -->
export function resolveInheritedTimeSignatures(score: model.Score, explicitBars: readonly number[]): void {
  // <!-- req editingcore:5741aa16.c20b --> <!-- req editingcore:e2a29f1e.f303 -->
  const explicit = new Set(explicitBars);
  for (let i = 1; i < score.masterBars.length; i++) {
    // <!-- req editingcore:0f8440a3.79a7 -->
    if (explicit.has(i)) continue;
    const previous = score.masterBars[i - 1]!;
    const masterBar = score.masterBars[i]!;
    // <!-- req editingcore:b13f25dc.54b6 --> <!-- req editingcore:0f8440a3.b8ef --> <!-- req editingcore:e2a29f1e.54c6 -->
    masterBar.timeSignatureNumerator = previous.timeSignatureNumerator;
    masterBar.timeSignatureDenominator = previous.timeSignatureDenominator;
  }
}

/**
 * 構造変更（Beat/Bar の追加・削除、Note の追加）後にグラフの派生情報を再構築する。
 * `index` / `previousBeat`・`nextBeat` の張り直し、duration 再計算等。
 * alphaTab 内部でも import 後・render 前に呼ばれる処理で、再入可能。
 */
export function finishScore(score: model.Score): void {
  score.finish(new Settings());
}
