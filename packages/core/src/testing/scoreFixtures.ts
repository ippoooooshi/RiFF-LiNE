/**
 * 開発用サンプルデータ（web-core-foundation.md 14.9 節）。奏法記号の網羅・大曲・複数のパートの 3 つのフィクスチャ。
 *
 * 利用者に向けて同梱するサンプルとは別のもので、packages/core/src/testing に置き、そのための `tools/` を設けない。 15.4 節の置き場所（packages/core/src/testing の scoreFixtures.ts） <!-- req webcorefoundation:2a4c3b22.a4dc -->
 * データのファイルをリポジトリにコミットせず、テストのたびに作る関数として置く（2048 小節の大曲も同じ）。
 * どの関数も呼ばれるたびに新しい Score を組み立てて返し、共有のオブジェクトを返さない。本番コードからは import しない。
 * テストは scoreFixtures.test.ts（UT-FIXTURE-SCORE）。
 */
// <!-- req webcorefoundation:460ed1a7.16bb --> <!-- req webcorefoundation:460ed1a7.fb67 --> <!-- req webcorefoundation:460ed1a7.0d60 --> <!-- req webcorefoundation:da1a44f3.7d08 -->
// <!-- req webcorefoundation:9cf69156.dcaa --> <!-- req webcorefoundation:9cf69156.0b56 --> <!-- req webcorefoundation:9cf69156.70ac --> <!-- req webcorefoundation:f7075984.9840 --> <!-- req webcorefoundation:f7075984.cf3a --> <!-- req webcorefoundation:e34d41de.a620 -->

import { model, Settings } from '@coderline/alphatab';

import { createInitialScore, STANDARD_BASS_TUNING, STANDARD_GUITAR_TUNING } from '../domain/newSong';
import type { NewPartSetup } from '../domain/types';

type Score = model.Score;

/** 1 つの音に付ける奏法記号（基本設計 04 章 6 節の Note の単位の行）。名前はテストの失敗の表示に使う。 */
const NOTE_TECHNIQUES: readonly { name: string; apply: (note: model.Note) => void }[] = [
  {
    name: 'チョーキング（1 音）',
    apply: (n) => {
      n.bendType = model.BendType.Bend;
      n.addBendPoint(new model.BendPoint(0, 0));
      n.addBendPoint(new model.BendPoint(model.BendPoint.MaxPosition, 4));
    },
  },
  { name: 'スライド', apply: (n) => (n.slideOutType = model.SlideOutType.Shift) },
  { name: 'HP-PO', apply: (n) => (n.isHammerPullOrigin = true) },
  { name: 'パームミュート', apply: (n) => (n.isPalmMute = true) },
  { name: 'ビブラート', apply: (n) => (n.vibrato = model.VibratoType.Slight) },
  { name: '自然ハーモニクス', apply: (n) => (n.harmonicType = model.HarmonicType.Natural) },
  {
    name: '人工ハーモニクス',
    apply: (n) => {
      n.harmonicType = model.HarmonicType.Artificial;
      n.harmonicValue = 12;
    },
  },
  { name: 'ピンチハーモニクス', apply: (n) => (n.harmonicType = model.HarmonicType.Pinch) },
  { name: 'アクセント', apply: (n) => (n.accentuated = model.AccentuationType.Normal) },
  { name: '強いアクセント', apply: (n) => (n.accentuated = model.AccentuationType.Heavy) },
  { name: 'テヌート', apply: (n) => (n.accentuated = model.AccentuationType.Tenuto) },
  { name: 'スタッカート', apply: (n) => (n.isStaccato = true) },
  { name: 'ゴースト', apply: (n) => (n.isGhost = true) },
];

/** 拍に付ける奏法記号（基本設計 04 章 6 節の Beat の単位の行）。 */
const BEAT_TECHNIQUES: readonly { name: string; apply: (beat: model.Beat) => void }[] = [
  { name: 'タッピング', apply: (b) => (b.tap = true) },
  { name: 'スラップ', apply: (b) => (b.slap = true) },
  { name: 'ポップ', apply: (b) => (b.pop = true) },
  { name: 'ブラシ', apply: (b) => (b.brushType = model.BrushType.BrushDown) },
];

/** 1 つの拍。notes は [弦, フレット] の組（弦は alphaTab の番号）。 */
function beatOf(duration: model.Duration, notes: readonly (readonly [number, number])[]): model.Beat {
  const beat = new model.Beat();
  beat.duration = duration;
  for (const [string, fret] of notes) {
    const note = new model.Note();
    note.string = string;
    note.fret = fret;
    beat.addNote(note);
  }
  return beat;
}

/**
 * 小節を 1 つ足す（MasterBar と、各パートの Bar と Voice）。
 * fill はパートごとに呼ばれ、その小節の拍を並べて返す。
 */
function appendBar(score: Score, fill: (trackIndex: number) => model.Beat[]): void {
  score.addMasterBar(new model.MasterBar());
  score.tracks.forEach((track, trackIndex) => {
    const bar = new model.Bar();
    track.staves[0]!.addBar(bar);
    const voice = new model.Voice();
    bar.addVoice(voice);
    for (const beat of fill(trackIndex)) voice.addBeat(beat);
  });
}

/**
 * 奏法記号を 1 つ付けた小節の拍。HP-PO は後ろに同じ弦の音を置き、ブラシは和音にする。
 * index は NOTE_TECHNIQUES に続けて BEAT_TECHNIQUES を数えた番号（大曲は小節の番号で回す）。
 */
function techniqueBeats(index: number): model.Beat[] {
  const all = NOTE_TECHNIQUES.length + BEAT_TECHNIQUES.length;
  const i = index % all;
  const noteTechnique = NOTE_TECHNIQUES[i];
  if (noteTechnique !== undefined) {
    const first = beatOf(model.Duration.Half, [[3, 5]]);
    noteTechnique.apply(first.notes[0]!);
    return [first, beatOf(model.Duration.Half, [[3, 7]])];
  }
  const beat = beatOf(model.Duration.Whole, [
    [1, 0],
    [2, 2],
    [3, 2],
  ]);
  BEAT_TECHNIQUES[i - NOTE_TECHNIQUES.length]!.apply(beat);
  return [beat];
}

function guitarPart(i: number): NewPartSetup {
  return { name: `Guitar ${i + 1}`, instrumentType: 'electric_guitar', tuning: [...STANDARD_GUITAR_TUNING] };
}

/** 奏法記号の網羅のフィクスチャ。毎回新しい Score を返す */
// <!-- req webcorefoundation:55b6a78a.0c57 --> <!-- req webcorefoundation:f2ae9867.a7df --> <!-- req webcorefoundation:f2ae9867.7620 --> <!-- req webcorefoundation:f2ae9867.c08b --> <!-- req webcorefoundation:f2ae9867.b4cb --> <!-- req webcorefoundation:f2ae9867.a658 --> <!-- req webcorefoundation:f2ae9867.7057 -->
// <!-- req webcorefoundation:f2ae9867.1d12 --> <!-- req webcorefoundation:f2ae9867.42cb --> <!-- req webcorefoundation:f2ae9867.29a9 --> <!-- req webcorefoundation:f2ae9867.bc9c --> <!-- req webcorefoundation:f2ae9867.06d0 --> <!-- req webcorefoundation:f2ae9867.acdf --> <!-- req webcorefoundation:f2ae9867.c6aa -->
export function makeTechniqueCoverageScore(): Score {
  // 短い曲：最初の空の小節に続けて、奏法記号ごとに 1 小節（Note の単位 13・Beat の単位 4）
  const score = createInitialScore({ title: 'Technique coverage', parts: [guitarPart(0)] });
  const count = NOTE_TECHNIQUES.length + BEAT_TECHNIQUES.length;
  for (let i = 0; i < count; i++) appendBar(score, () => techniqueBeats(i));
  score.finish(new Settings());
  return score;
}

/** 大曲のフィクスチャ。小節の数とパートの数を受け、毎回作り直す */
// <!-- req webcorefoundation:03ee4ff8.68e1 --> <!-- req webcorefoundation:de495c0d.236f --> <!-- req webcorefoundation:de495c0d.944d --> <!-- req webcorefoundation:de495c0d.a890 --> <!-- req webcorefoundation:de495c0d.3ebb -->
export function makeLargeScore(options: { barCount: number; partCount: 4 | 8 }): Score {
  const { barCount, partCount } = options;
  if (!Number.isInteger(barCount) || barCount < 1) {
    throw new RangeError(`barCount は 1 以上の整数で渡してください（受け取った値: ${barCount}）`);
  }
  // 機械で作る。演奏として自然である必要はないので、小節の番号で奏法記号を順に回す（14.8 節の「全部の奏法記号を含む」）
  const parts = Array.from({ length: partCount }, (_v, i) => guitarPart(i));
  const score = createInitialScore({ title: `Large ${barCount} bars ${partCount} parts`, parts });
  for (let bar = 1; bar < barCount; bar++) appendBar(score, () => techniqueBeats(bar - 1));
  score.finish(new Settings());
  return score;
}

/** 複数のパートのフィクスチャで使うパート（上限の 8 パート、チューニングとカポを変える）。 */
const MULTI_PARTS: readonly { part: NewPartSetup; capo: number }[] = [
  { part: guitarPart(0), capo: 0 },
  { part: { name: 'Guitar Drop D', instrumentType: 'electric_guitar', tuning: [64, 59, 55, 50, 45, 38] }, capo: 2 },
  { part: { name: 'Guitar Open G', instrumentType: 'electric_guitar', tuning: [62, 59, 55, 50, 43, 38] }, capo: 5 },
  { part: { name: 'Guitar Half Down', instrumentType: 'electric_guitar', tuning: [63, 58, 54, 49, 44, 39] }, capo: 0 },
  {
    part: { name: 'Guitar 7 strings', instrumentType: 'electric_guitar', tuning: [64, 59, 55, 50, 45, 40, 35] },
    capo: 3,
  },
  { part: { name: 'Bass', instrumentType: 'bass', tuning: [...STANDARD_BASS_TUNING] }, capo: 0 },
  { part: { name: 'Bass 5 strings', instrumentType: 'bass', tuning: [43, 38, 33, 28, 23] }, capo: 0 },
  { part: { name: 'Bass Drop D', instrumentType: 'bass', tuning: [43, 38, 33, 26] }, capo: 1 },
];

/** 複数のパート・複数のチューニング・カポのフィクスチャ */
// <!-- req webcorefoundation:1a3bb763.7132 --> <!-- req webcorefoundation:d412e649.1457 --> <!-- req webcorefoundation:d412e649.b8d7 --> <!-- req webcorefoundation:d412e649.094a -->
export function makeMultiPartScore(): Score {
  const score = createInitialScore({ title: 'Multi parts', parts: MULTI_PARTS.map((p) => p.part) });
  score.tracks.forEach((track, i) => (track.staves[0]!.capo = MULTI_PARTS[i]!.capo));
  appendBar(score, () => [beatOf(model.Duration.Whole, [[1, 3]])]);
  score.finish(new Settings());
  return score;
}
