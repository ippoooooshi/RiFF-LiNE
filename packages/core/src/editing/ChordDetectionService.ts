/**
 * 拍の構成音からコード名を推し量る（editing-core.md 8 節、基本設計 04 章 7 節）。
 *
 * 推し量り方は 2 つの段に分ける（editing-core.md 8 節）。
 *  - 辞書の照らし合わせ：表の 14 の型（ルートからの半音の並び）を 12 のルートへずらした集まりと、構成音の高さの類の
 *    集まりがちょうど同じになるかを見る。集まりで見るので、転回形によらず同じ型に当たる。
 *  - 和声の解析：当たった解釈のうちどれをルートとするかを、(1) 一番低い音をルートとする解釈、(2) 構成音の少ない型、
 *    (3) 表の上にある型、の順で 1 つ選び、ルートが一番低い音でなければ「ルート/一番低い音」の分数の形にする。
 *
 * 音の高さは `computeRealMidiPitch`（playback-integration.md 9.1 節、`domain/pitch.ts`）を呼んで出し、ここでは加算を書かない
 * （式を 1 か所に置くため）。結果の覚えは持たない（覚えて捨てるのは `EditingService`、editing-core.md 8 節）。
 */

import type { model } from '@coderline/alphatab';

import { computeRealMidiPitch } from '../domain/pitch';

import { getStaff, openStringPitch } from './scoreModel';

/** 音の名前。シャープで書き、調によるフラットとシャープの書き分けは推し量らない（editing-core.md 8 節）。 */
// <!-- req editingcore:e99d35cc.077f --> <!-- req editingcore:e99d35cc.d47c --> <!-- req editingcore:e99d35cc.477e --> <!-- req editingcore:e99d35cc.ef12 -->
// <!-- req editingcore:e99d35cc.6c01 --> <!-- req editingcore:e99d35cc.edf1 --> <!-- req editingcore:e99d35cc.d816 --> <!-- req editingcore:e99d35cc.7181 -->
// <!-- req editingcore:e99d35cc.d031 --> <!-- req editingcore:e99d35cc.b55c --> <!-- req editingcore:e99d35cc.011f --> <!-- req editingcore:e99d35cc.59b6 -->
// <!-- req editingcore:e99d35cc.6d9d --> <!-- req editingcore:e99d35cc.4f8a -->
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** 1 オクターブの半音の数。高さの類（オクターブの違いを除いたもの）は、音の高さをこの数で割った余り。 */
const SEMITONES_PER_OCTAVE = 12;

/**
 * 知っているコードの形の辞書（editing-core.md 8 節の表）。押さえ方ではなく、ルートからの半音の並びで持つ。
 * 並びは表の順のままにする（選ぶ順の (3)「表の上にある型」に使う）。テンションを含まない 3 和音を上に、4 和音を下に置く。
 */
// <!-- req editingcore:572cf2ce.fac2 --> <!-- req editingcore:1383a663.c02e --> <!-- req editingcore:1383a663.2a0e --> <!-- req editingcore:1383a663.cec5 -->
// <!-- req editingcore:1383a663.8fb6 --> <!-- req editingcore:1383a663.5ded --> <!-- req editingcore:8b997d12.5343 --> <!-- req editingcore:8b997d12.44e0 -->
// <!-- req editingcore:8b997d12.8d3f --> <!-- req editingcore:7130ec96.6d0a --> <!-- req editingcore:7130ec96.4fed --> <!-- req editingcore:7130ec96.718e -->
// <!-- req editingcore:cb0723f2.96ea --> <!-- req editingcore:cb0723f2.2f25 --> <!-- req editingcore:20ae3d7e.8e9f --> <!-- req editingcore:20ae3d7e.8d07 -->
// <!-- req editingcore:20ae3d7e.06a9 --> <!-- req editingcore:20ae3d7e.f673 --> <!-- req editingcore:20ae3d7e.d95d --> <!-- req editingcore:dd0f3270.5a6f -->
// <!-- req editingcore:dd0f3270.b3d4 --> <!-- req editingcore:dd0f3270.2bc8 --> <!-- req editingcore:dd0f3270.2985 --> <!-- req editingcore:dd0f3270.9abc -->
// <!-- req editingcore:7f063593.a47b --> <!-- req editingcore:7f063593.1384 --> <!-- req editingcore:7f063593.8ba0 --> <!-- req editingcore:7f063593.f4b8 -->
// <!-- req editingcore:7f063593.6429 --> <!-- req editingcore:1cf64a30.8e41 --> <!-- req editingcore:1cf64a30.c749 --> <!-- req editingcore:1cf64a30.13c9 -->
// <!-- req editingcore:1cf64a30.33fb --> <!-- req editingcore:1cf64a30.4be9 --> <!-- req editingcore:6211e3e3.17c1 --> <!-- req editingcore:6211e3e3.5be5 -->
// <!-- req editingcore:6211e3e3.bc89 --> <!-- req editingcore:6211e3e3.6fed --> <!-- req editingcore:6211e3e3.d5a6 --> <!-- req editingcore:6211e3e3.6ec3 -->
// <!-- req editingcore:8aef7371.2b39 --> <!-- req editingcore:8aef7371.7e2f --> <!-- req editingcore:8aef7371.2bf9 --> <!-- req editingcore:8aef7371.12b7 -->
// <!-- req editingcore:8aef7371.51df --> <!-- req editingcore:8aef7371.7e4a --> <!-- req editingcore:dc57902e.0d23 --> <!-- req editingcore:dc57902e.25f1 -->
// <!-- req editingcore:dc57902e.9f9e --> <!-- req editingcore:dc57902e.eddd --> <!-- req editingcore:dc57902e.8150 --> <!-- req editingcore:dc57902e.c412 -->
// <!-- req editingcore:9d87c915.2878 --> <!-- req editingcore:9d87c915.2061 --> <!-- req editingcore:9d87c915.bc36 --> <!-- req editingcore:9d87c915.7ef8 -->
// <!-- req editingcore:9d87c915.bc93 --> <!-- req editingcore:9d87c915.8a64 --> <!-- req editingcore:9313d746.270d --> <!-- req editingcore:9313d746.6941 -->
// <!-- req editingcore:9313d746.db9f --> <!-- req editingcore:9313d746.09f8 --> <!-- req editingcore:9313d746.3d26 --> <!-- req editingcore:9313d746.3977 -->
// <!-- req editingcore:c37ccb5f.160b --> <!-- req editingcore:c37ccb5f.fe2f --> <!-- req editingcore:c37ccb5f.1642 --> <!-- req editingcore:c37ccb5f.23ae -->
// <!-- req editingcore:c37ccb5f.ff17 --> <!-- req editingcore:c37ccb5f.3968 --> <!-- req editingcore:543ef383.b36f --> <!-- req editingcore:543ef383.0463 -->
// <!-- req editingcore:543ef383.ac00 --> <!-- req editingcore:543ef383.8e36 --> <!-- req editingcore:543ef383.ce16 --> <!-- req editingcore:4980699a.4f4a -->
// <!-- req editingcore:4980699a.2e22 --> <!-- req editingcore:4980699a.8fe0 --> <!-- req editingcore:55e87bb2.e425 --> <!-- req editingcore:55e87bb2.0579 -->
const CHORD_TEMPLATES: readonly { readonly intervals: readonly number[]; readonly suffix: string }[] = [
  { intervals: [0, 4, 7], suffix: '' },
  { intervals: [0, 3, 7], suffix: 'm' },
  { intervals: [0, 7], suffix: '5' },
  { intervals: [0, 5, 7], suffix: 'sus4' },
  { intervals: [0, 2, 7], suffix: 'sus2' },
  { intervals: [0, 3, 6], suffix: 'dim' },
  { intervals: [0, 4, 8], suffix: 'aug' },
  { intervals: [0, 4, 7, 10], suffix: '7' },
  { intervals: [0, 3, 7, 10], suffix: 'm7' },
  { intervals: [0, 4, 7, 11], suffix: 'maj7' },
  { intervals: [0, 4, 7, 9], suffix: '6' },
  { intervals: [0, 3, 7, 9], suffix: 'm6' },
  { intervals: [0, 3, 6, 10], suffix: 'm7b5' },
  { intervals: [0, 3, 6, 9], suffix: 'dim7' },
];

// <!-- req editingcore:6fc352c4.c5ae --> <!-- req editingcore:5d55c049~1.22c8 --> <!-- req editingcore:470bf793.79a3 --> <!-- req editingcore:33281d1f.0072 -->
// <!-- req editingcore:33281d1f.52ed -->
export interface ChordDetectionResult {
  /** 出す名前（例 "Am7"、"C/E"）。 */
  name: string;
  /** ルートの音の高さの類（0 が C）。 */
  rootPitchClass: number;
}

// 9.2 節：コード推定は実音への読み替えの関数（computeRealMidiPitch）を呼び、自分の中で加算を書かない。MIDI 書き出しも同じ関数を呼ぶ（export-print.md の作業パッケージ） <!-- req webcorefoundation:bf72b763.2ad4 --> <!-- req webcorefoundation:bf72b763.ab5d --> <!-- req webcorefoundation:bf72b763.6413 -->
// <!-- req editingcore:77110ff1.04cf --> <!-- req editingcore:a37c7c1f.7867 --> <!-- req editingcore:c1c425de.af85 -->
export class ChordDetectionService {
  /**
   * 拍の出すコード名。`Beat.text`（手で入れた値、`SetChordNameCommand`）があればそれを、無ければ `detect` の名前を返す
   * （editing-core.md 8 節「欄が空なら推し量った候補を出し、値があれば手で入れた値を優先して出す」）。どちらも無ければ null。
   */
  // <!-- req editingcore:7db55b0f.8e3d -->
  resolveDisplayName(score: model.Score, trackIndex: number, beat: model.Beat): string | null {
    // <!-- req editingcore:1001cdcd.a439 --> <!-- req editingcore:1001cdcd.98b3 --> <!-- req editingcore:98a6ca4d.58fb --> <!-- req editingcore:98a6ca4d.3b56 -->
    if (beat.text !== null && beat.text.length > 0) return beat.text;
    return this.detect(score, trackIndex, beat)?.name ?? null;
  }

  /** 拍の構成音からコードを推し量る（手で入れた値は見ない）。当てはまる型が無いときは null。 */
  // <!-- req editingcore:184a2aa1.e6e9 -->
  detect(score: model.Score, trackIndex: number, beat: model.Beat): ChordDetectionResult | null {
    const staff = getStaff(score, trackIndex);
    const pitches = beat.notes.map((note) => midiPitch(staff, note.string, note.fret));
    if (pitches.length === 0) return null;
    const pitchClasses = new Set(pitches.map(pitchClassOf));
    return detectFromPitchClasses(pitchClasses, pitchClassOf(Math.min(...pitches)));
  }
}

/** 実際の音の高さ ＝ 開放弦の高さ（`openStringPitch`）とカポとフレットから `computeRealMidiPitch` で出す。 */
function midiPitch(staff: model.Staff, stringNumber: number, fret: number): number {
  // <!-- req editingcore:f2aacfdd.2872 --> <!-- req editingcore:f2aacfdd.b288 --> <!-- req editingcore:f2aacfdd.4ac9 -->
  return computeRealMidiPitch(openStringPitch(staff, stringNumber), staff.capo, fret);
}

/** 音の高さの類（オクターブの違いを除いたもの。0 が C）。 */
// <!-- req editingcore:4dad2592.f79b -->
function pitchClassOf(pitch: number): number {
  return pitch % SEMITONES_PER_OCTAVE;
}

/** 辞書の照らし合わせで当たった解釈：表の何番目の型を、どのルートへずらしたものか。 */
interface ChordInterpretation {
  readonly root: number;
  readonly templateIndex: number;
}

/**
 * 照らし合わせの本体（純粋な関数）。lowestPitchClass は一番低い音の高さの類。
 * 表に当たらない集まり（1 つの音だけ・型に無い組み合わせ）は null。
 */
// <!-- req editingcore:d30eb900.bea3 --> <!-- req editingcore:d30eb900.21cc --> <!-- req editingcore:63f446aa.199d --> <!-- req editingcore:63f446aa.5cad -->
// <!-- req editingcore:89c19063.1571 --> <!-- req editingcore:572cf2ce.0bf8 -->
export function detectFromPitchClasses(
  pitchClasses: ReadonlySet<number>,
  lowestPitchClass: number,
): ChordDetectionResult | null {
  // 辞書の照らし合わせの段：14 の型を 12 のルートへずらした集まりと、構成音の集まりを突き合わせる
  const interpretations: ChordInterpretation[] = [];
  // <!-- req editingcore:4980699a.a6e3 --> <!-- req editingcore:4980699a.bfba -->
  CHORD_TEMPLATES.forEach((template, templateIndex) => {
    for (let root = 0; root < SEMITONES_PER_OCTAVE; root++) {
      const shifted = new Set(template.intervals.map((interval) => pitchClassOf(root + interval)));
      // <!-- req editingcore:4dad2592.179c --> <!-- req editingcore:4dad2592.a75b --> <!-- req editingcore:4dad2592.4122 --> <!-- req editingcore:4dad2592.ab81 -->
      // <!-- req editingcore:4dad2592.474c --> <!-- req editingcore:4980699a.4920 -->
      if (sameSet(shifted, pitchClasses)) interpretations.push({ root, templateIndex });
    }
  });

  // 和声の解析の段：(1) 一番低い音をルートとする解釈、(2) 構成音の少ない型、(3) 表の上にある型、の順で 1 つ選ぶ
  // <!-- req editingcore:576d6653.cb06 --> <!-- req editingcore:576d6653.1a25 --> <!-- req editingcore:576d6653.f246 --> <!-- req editingcore:c30a6aa0.e8a8 -->
  // <!-- req editingcore:c30a6aa0.784e --> <!-- req editingcore:4980699a.02fe --> <!-- req editingcore:4980699a.15c3 --> <!-- req editingcore:4980699a.87bf -->
  // <!-- req editingcore:4980699a.9a2e --> <!-- req editingcore:55e87bb2.5757 --> <!-- req editingcore:55e87bb2.ca1b -->
  const chosen = interpretations.sort((a, b) =>
    compareInOrder(selectionKeys(a, lowestPitchClass), selectionKeys(b, lowestPitchClass)),
  )[0];
  if (chosen === undefined) return null;

  const name = `${PITCH_NAMES[chosen.root]!}${CHORD_TEMPLATES[chosen.templateIndex]!.suffix}`;
  // ルートが一番低い音でなければ「ルートの名前/一番低い音の名前」の分数の形（C/E）にする
  const displayName =
    // <!-- req editingcore:4980699a.d791 --> <!-- req editingcore:4980699a.5686 --> <!-- req editingcore:e99d35cc.e26b --> <!-- req editingcore:e99d35cc.09fe -->
    // <!-- req editingcore:e99d35cc.490c -->
    chosen.root === lowestPitchClass ? name : `${name}/${PITCH_NAMES[pitchClassOf(lowestPitchClass)]!}`;
  return { name: displayName, rootPitchClass: chosen.root };
}

/** 選ぶ順の 3 つの鍵（小さいほうを先に選ぶ）。 */
function selectionKeys(interpretation: ChordInterpretation, lowestPitchClass: number): readonly number[] {
  const rootIsLowest = interpretation.root === lowestPitchClass ? 0 : 1;
  const noteCount = CHORD_TEMPLATES[interpretation.templateIndex]!.intervals.length;
  // <!-- req editingcore:22e02fd5.0abf --> <!-- req editingcore:22e02fd5.2e3e --> <!-- req editingcore:22e02fd5.e9dc --> <!-- req editingcore:55e87bb2.e6bd -->
  // <!-- req editingcore:55e87bb2.5761 --> <!-- req editingcore:55e87bb2.a71a --> <!-- req editingcore:55e87bb2.f902 --> <!-- req editingcore:55e87bb2.7940 -->
  // <!-- req editingcore:55e87bb2.ca4d --> <!-- req editingcore:55e87bb2.b3f4 --> <!-- req editingcore:55e87bb2.17ab --> <!-- req editingcore:55e87bb2.4660 -->
  // <!-- req editingcore:55e87bb2.56e5 -->
  return [rootIsLowest, noteCount, interpretation.templateIndex];
}

/** 鍵を前から順に比べる。 */
function compareInOrder(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}
// 13.2 節：コードダイアグラムは作らない。足すときはコード名のデータに押さえ方を足し、alphaTab のコードダイアグラムの表示を使い、表示の形を自作しない <!-- req webcorefoundation:0d765111.9311 --> <!-- req webcorefoundation:0d765111.f1f5 --> <!-- req webcorefoundation:0d765111.ab4f --> <!-- req webcorefoundation:0d765111.8528 -->
