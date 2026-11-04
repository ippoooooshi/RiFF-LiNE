/**
 * alphaTab `model.Score` グラフのナビゲーション／生成ヘルパー（editing-core.md §3）。
 *
 * コマンド実装から alphaTab グラフの走査コードを分離し、1 箇所に集約する（テスト可能な縫い目・単一の真実源）。
 * MVP は「1 トラック = 1 Staff = 1 Voice」前提（04_editing_core.md §1、newSong.ts と同じ）。
 */

// data-model-persistence.md 3 節：実行時の曲のモデルは alphaTab の Score・Track・Staff・Bar・Voice・Beat・Note を土台にして辿る <!-- req datamodelpersistence:b10105e1.f339 --> <!-- req datamodelpersistence:b10105e1.59b4 --> <!-- req datamodelpersistence:b10105e1.f15a --> <!-- req datamodelpersistence:b10105e1.9c16 --> <!-- req datamodelpersistence:b10105e1.6120 --> <!-- req datamodelpersistence:b10105e1.92d4 --> <!-- req datamodelpersistence:b10105e1.f436 -->
import { model, Settings } from '@coderline/alphatab';

import type { BeatDurationSpec } from './types';

/** フレット番号の許容範囲（04_editing_core.md §4、`EDIT-002`）。 */
export const MIN_FRET = 0;
export const MAX_FRET = 24;

/** 小節数のハードキャップ（04_editing_core.md §4・§11、`EDIT-003`、B20）。 */
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
// <!-- req editingcore:4f7b6002.a64f --> <!-- req editingcore:4f7b6002.1c02 --> <!-- req editingcore:4f7b6002.5c1c --> <!-- req editingcore:4f7b6002.a40a --> <!-- req editingcore:dfa5c06f.ea0d --> <!-- req editingcore:dfa5c06f.359e -->
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

/** Beat 内の指定弦の Note（無ければ null）。 */
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
// <!-- req editingcore:54e0b2f1.b3ab --> <!-- req editingcore:ab5ff289.d652 -->
export function insertBeatAt(voice: model.Voice, index: number, beat: model.Beat): void {
  // <!-- req editingcore:ab5ff289.cd5c --> <!-- req editingcore:ab5ff289.b432 --> <!-- req editingcore:ab5ff289.de28 -->
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
 * 同じ弦の次の音符を探す小節の幅。alphaTab 1.8.4 の `Note` が同じ弦の前後の音符を探す幅（`_maxOffsetForSameLineSearch`、
 * `alphaTab.core.mjs` の `nextNoteOnSameLine`・`findTieOrigin`）と同じ 3 小節にそろえる。これより先の音符は、alphaTab が
 * 描く前の作り直しでタイの始まりとして見つけないため。
 */
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
  const bars = getStaff(score, trackIndex).bars;
  const lastBar = Math.min(bars.length - 1, barIndex + SAME_STRING_SEARCH_BAR_SPAN);
  for (let b = barIndex; b <= lastBar; b++) {
    const beats = bars[b]!.voices[voiceIndex]?.beats ?? [];
    for (let i = b === barIndex ? beatIndex + 1 : 0; i < beats.length; i++) {
      const note = findNoteOnString(beats[i]!, stringNumber);
      if (note !== null) return note;
    }
  }
  return null;
}

/**
 * 構造変更（Beat/Bar の追加・削除、Note の追加）後にグラフの派生情報を再構築する。
 * `index` / `previousBeat`・`nextBeat` の張り直し、duration 再計算等。
 * alphaTab 内部でも import 後・render 前に呼ばれる処理で、再入可能。
 */
export function finishScore(score: model.Score): void {
  score.finish(new Settings());
}
