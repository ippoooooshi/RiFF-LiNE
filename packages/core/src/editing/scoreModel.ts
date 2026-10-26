/**
 * alphaTab `model.Score` グラフのナビゲーション／生成ヘルパー（editing-core.md §3）。
 *
 * コマンド実装から alphaTab グラフの走査コードを分離し、1 箇所に集約する（テスト可能な縫い目・単一の真実源）。
 * MVP は「1 トラック = 1 Staff = 1 Voice」前提（04_editing_core.md §1、newSong.ts と同じ）。
 */

// data-model-persistence.md 3 節：実行時の曲のモデルは alphaTab の Score・Track・Staff・Bar・Voice・Beat・Note を土台にして辿る <!-- req datamodelpersistence:b10105e1.f339 --> <!-- req datamodelpersistence:b10105e1.59b4 --> <!-- req datamodelpersistence:b10105e1.f15a --> <!-- req datamodelpersistence:b10105e1.9c16 --> <!-- req datamodelpersistence:b10105e1.6120 --> <!-- req datamodelpersistence:b10105e1.92d4 --> <!-- req datamodelpersistence:b10105e1.f436 -->
import { model, Settings } from '@coderline/alphatab';

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

/** Bar の主 Voice（MVP は voice 0）。 */
export function getVoice(bar: model.Bar): model.Voice {
  // data-model-persistence.md 4 節：VOICE は Voice（Bar.voices）で表す <!-- req datamodelpersistence:6b0cf6a1.3945 -->
  const voice = bar.voices[0];
  if (!voice) throw new RangeError('bar has no voice');
  return voice;
}

/** 指定位置の Beat。 */
export function getBeat(score: model.Score, trackIndex: number, barIndex: number, beatIndex: number): model.Beat {
  const voice = getVoice(getBar(score, trackIndex, barIndex));
  // data-model-persistence.md 4 節：BEAT は Beat（Voice.beats）で表す <!-- req datamodelpersistence:235d262a.c4f8 -->
  const beat = voice.beats[beatIndex];
  if (!beat) throw new RangeError(`beatIndex out of range: ${beatIndex} (track ${trackIndex}, bar ${barIndex})`);
  return beat;
}

// data-model-persistence.md 4 節：拍子・テンポ・リピートは曲共通の小節 MasterBar（Score.masterBars）が持つ <!-- req datamodelpersistence:806faf90.e590 -->
/** 指定位置の MasterBar（拍子・テンポの器）。 */
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
export function createRestBeat(duration: model.Duration): model.Beat {
  const beat = new model.Beat();
  beat.duration = duration;
  return beat;
}

// data-model-persistence.md 4 節：音符の弦は string、フレットは fret に持つ <!-- req datamodelpersistence:cf9b39de.e785 --> <!-- req datamodelpersistence:cf9b39de.1d4a -->
/** 弦・フレット指定の Note を新規生成する（`beat.addNote` で追加すること）。 */
export function createStringNote(stringNumber: number, fret: number): model.Note {
  const note = new model.Note();
  note.string = stringNumber;
  note.fret = fret;
  return note;
}

/**
 * Voice の任意位置へ Beat を挿入する。`voice.addBeat`/`insertBeat` は末尾 or 相対指定しかできず、
 * 生の `beats.splice` は `beat.voice` 逆参照を設定しないため `finishScore` が失敗する。ここで補う。
 * @param index `voice.beats.length` 以上なら末尾追加。
 */
export function insertBeatAt(voice: model.Voice, index: number, beat: model.Beat): void {
  beat.voice = voice;
  if (index >= voice.beats.length) {
    voice.beats.push(beat);
  } else {
    voice.beats.splice(Math.max(0, index), 0, beat);
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
