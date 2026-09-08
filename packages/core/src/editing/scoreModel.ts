/**
 * alphaTab `model.Score` グラフのナビゲーション／生成ヘルパー（editing-core.md §3）。
 *
 * コマンド実装から alphaTab グラフの走査コードを分離し、1 箇所に集約する（テスト可能な縫い目・単一の真実源）。
 * MVP は「1 トラック = 1 Staff = 1 Voice」前提（04_editing_core.md §1、newSong.ts と同じ）。
 */

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
  const bar = getStaff(score, trackIndex).bars[barIndex];
  if (!bar) throw new RangeError(`barIndex out of range: ${barIndex} (track ${trackIndex})`);
  return bar;
}

/** Bar の主 Voice（MVP は voice 0）。 */
export function getVoice(bar: model.Bar): model.Voice {
  const voice = bar.voices[0];
  if (!voice) throw new RangeError('bar has no voice');
  return voice;
}

/** 指定位置の Beat。 */
export function getBeat(score: model.Score, trackIndex: number, barIndex: number, beatIndex: number): model.Beat {
  const voice = getVoice(getBar(score, trackIndex, barIndex));
  const beat = voice.beats[beatIndex];
  if (!beat) throw new RangeError(`beatIndex out of range: ${beatIndex} (track ${trackIndex}, bar ${barIndex})`);
  return beat;
}

/** 指定位置の MasterBar（拍子・テンポの器）。 */
export function getMasterBar(score: model.Score, barIndex: number): model.MasterBar {
  const masterBar = score.masterBars[barIndex];
  if (!masterBar) throw new RangeError(`masterBar index out of range: ${barIndex}`);
  return masterBar;
}

/** Beat 内の指定弦の Note（無ければ null）。 */
export function findNoteOnString(beat: model.Beat, stringNumber: number): model.Note | null {
  return beat.notes.find((note) => note.string === stringNumber) ?? null;
}

/** 全休符の Beat を新規生成する。 */
export function createRestBeat(duration: model.Duration): model.Beat {
  const beat = new model.Beat();
  beat.duration = duration;
  return beat;
}

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
