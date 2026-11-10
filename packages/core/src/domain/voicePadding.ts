/**
 * ボイスの数のそろえと外し（web-core-foundation.md 12.1 節、2026-11-10 チャット側の決定 264 番の案 C）。
 *
 * 2 つ目のボイスを持つ小節と持たない小節が並ぶ曲も描けて保存できるように、alphaTab 1.8.4 に渡す間だけ、同じ譜表（Staff）の
 * 小節のボイスの数を一番多い小節にそろえ、足したボイスと拍 0 個のボイスに空の拍（`isEmpty` が真の Beat）を 1 つずつ補う。
 * alphaTab 1.8.4 の `Voice` の `_chain` が次の小節の同じ番号のボイス（`this.bar.nextBar.voices[this.index]`）を読み、
 * 無いと落ち、拍 0 個なら次の拍が無いまま `beat.nextBeat.previousBeat` を書いて落ちるため。
 * 描く前の作り直し（`rebuildDerivedLinks`）と保存（`SongDocument` の `scoreToJson`）が補ってから渡し、渡した後に外す。
 * 開き直し（`jsonToScore`）は、保存で補ったボイスを `stripEmptyVoices` で外す。
 * 置き場所は domain：描画（L1）と保存（domain、L3）の両方から呼ぶため（web-core-foundation.md 2.2 節の層の向き）。
 */

import { model } from '@coderline/alphatab';

/** `padEmptyVoices` が補った所。`unpadEmptyVoices` に渡して外す。 */
export interface VoicePadding {
  /** 補った空の拍と、入れたボイス（足したボイスに入れたものも含む）。 */
  readonly beats: readonly { readonly voice: model.Voice; readonly beat: model.Beat }[];
  /** ボイスの数をそろえるために足したボイスと、足した小節。 */
  readonly voices: readonly { readonly bar: model.Bar; readonly voice: model.Voice }[];
}

/** 空の拍（`isEmpty` が真の Beat）を作る。alphaTab 1.8.4 の読み込みが拍 0 個のボイスに入れるものと同じ形。 */
function createEmptyBeat(): model.Beat {
  const beat = new model.Beat();
  beat.isEmpty = true;
  return beat;
}

/**
 * 譜表（Staff）ごとに、小節のボイスの数を一番多い小節にそろえ、足したボイスと拍 0 個のボイスに空の拍を 1 つずつ補い、
 * 補った所を返す（web-core-foundation.md 12.1 節）。
 */
// <!-- req webcorefoundation:7fee54e4.403e --> <!-- req webcorefoundation:7fee54e4.0da3 --> <!-- req webcorefoundation:7fee54e4.2d39 -->
export function padEmptyVoices(score: model.Score): VoicePadding {
  const beats: { voice: model.Voice; beat: model.Beat }[] = [];
  const voices: { bar: model.Bar; voice: model.Voice }[] = [];
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      const voiceCount = Math.max(0, ...staff.bars.map((bar) => bar.voices.length));
      for (const bar of staff.bars) {
        // 同じ譜表の小節のボイスの数を、一番多い小節にそろえる
        while (bar.voices.length < voiceCount) {
          const voice = new model.Voice();
          bar.addVoice(voice);
          voices.push({ bar, voice });
        }
        // 足したボイスと拍 0 個のボイスに、空の拍を 1 つ補う
        for (const voice of bar.voices) {
          if (voice.beats.length > 0) continue;
          const beat = createEmptyBeat();
          voice.addBeat(beat);
          beats.push({ voice, beat });
        }
      }
    }
  }
  return { beats, voices };
}

/**
 * 外す拍の前後の拍のつながりを、外す拍を飛ばして繋ぎ直す（外す拍を指すつながりを残さない）。
 * 前の拍の次の拍が外す拍なら、外す拍の次の拍に、次の拍の前の拍が外す拍なら、外す拍の前の拍にする。
 */
function bridgeOver(beat: model.Beat): void {
  const previous = beat.previousBeat;
  const next = beat.nextBeat;
  if (previous !== null && previous.nextBeat === beat) previous.nextBeat = next;
  if (next !== null && next.previousBeat === beat) next.previousBeat = previous;
  beat.previousBeat = null;
  beat.nextBeat = null;
}

/** ボイスから拍を外し、外す前に前後の拍のつながりを繋ぎ直す。 */
function removePaddedBeat(voice: model.Voice, beat: model.Beat): void {
  bridgeOver(beat);
  const index = voice.beats.indexOf(beat);
  if (index >= 0) voice.beats.splice(index, 1);
}

/** 小節からボイスを外す。 */
function removePaddedVoice(bar: model.Bar, voice: model.Voice): void {
  const index = bar.voices.indexOf(voice);
  if (index >= 0) bar.voices.splice(index, 1);
}

/**
 * `padEmptyVoices` が補った拍とボイスを外し、外した拍を指したままの前後の拍のつながりを、補う前と同じ形
 * （外した拍が無いときの前後どうし）に繋ぎ直す（web-core-foundation.md 12.1 節）。
 */
// <!-- req webcorefoundation:7fee54e4.38ef --> <!-- req webcorefoundation:7fee54e4.9f28 --> <!-- req webcorefoundation:7fee54e4.1c8b -->
export function unpadEmptyVoices(_score: model.Score, padding: VoicePadding): void {
  for (const { voice, beat } of padding.beats) removePaddedBeat(voice, beat);
  // 足した順の逆に外す（同じ小節に 2 つ以上足したとき、後ろのボイスから外す）
  for (let i = padding.voices.length - 1; i >= 0; i--) {
    const { bar, voice } = padding.voices[i]!;
    removePaddedVoice(bar, voice);
  }
}

/** ボイスが、空の拍（`isEmpty` が真の Beat）1 つだけを持つか。音や休符のある拍を持つボイスは偽。 */
function holdsOnlyAnEmptyBeat(voice: model.Voice): boolean {
  return voice.beats.length === 1 && voice.beats[0]!.isEmpty;
}

/**
 * 開き直した曲から、2 つ目から後のボイスのうち拍が空の拍 1 つだけのものを外し、保存の前と同じ形に戻す
 * （web-core-foundation.md 12.1 節）。音や休符のある拍を持つボイスと、1 つ目のボイスは外さない。
 * 読み込み（`jsonToScore`）の中の `finish` が張った、外す拍を指すつながりも、`unpadEmptyVoices` と同じく繋ぎ直す。
 */
// <!-- req webcorefoundation:7fee54e4.6a32 --> <!-- req webcorefoundation:7fee54e4.e5f4 --> <!-- req webcorefoundation:7fee54e4.5496 -->
export function stripEmptyVoices(score: model.Score): void {
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        // 後ろから見る（外したボイスの後ろのボイスの番号を、見る前にずらさない）
        for (let i = bar.voices.length - 1; i >= 1; i--) {
          const voice = bar.voices[i]!;
          if (!holdsOnlyAnEmptyBeat(voice)) continue;
          removePaddedBeat(voice, voice.beats[0]!);
          removePaddedVoice(bar, voice);
        }
        // 外したボイスの後ろに残ったボイスの番号を、Bar.voices の中の位置に合わせる（Voice.index は addVoice だけが入れる）
        bar.voices.forEach((voice, index) => {
          voice.index = index;
        });
      }
    }
  }
}
