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
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** 1 オクターブの半音の数。高さの類（オクターブの違いを除いたもの）は、音の高さをこの数で割った余り。 */
const SEMITONES_PER_OCTAVE = 12;

/**
 * 知っているコードの形の辞書（editing-core.md 8 節の表）。押さえ方ではなく、ルートからの半音の並びで持つ。
 * 並びは表の順のままにする（選ぶ順の (3)「表の上にある型」に使う）。テンションを含まない 3 和音を上に、4 和音を下に置く。
 */
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

export interface ChordDetectionResult {
  /** 出す名前（例 "Am7"、"C/E"）。 */
  name: string;
  /** ルートの音の高さの類（0 が C）。 */
  rootPitchClass: number;
}

// 9.2 節：コード推定は実音への読み替えの関数（computeRealMidiPitch）を呼び、自分の中で加算を書かない。MIDI 書き出しも同じ関数を呼ぶ（export-print.md の作業パッケージ） <!-- req webcorefoundation:bf72b763.2ad4 --> <!-- req webcorefoundation:bf72b763.ab5d --> <!-- req webcorefoundation:bf72b763.6413 -->
export class ChordDetectionService {
  /**
   * 拍の出すコード名。`Beat.text`（手で入れた値、`SetChordNameCommand`）があればそれを、無ければ `detect` の名前を返す
   * （editing-core.md 8 節「欄が空なら推し量った候補を出し、値があれば手で入れた値を優先して出す」）。どちらも無ければ null。
   */
  resolveDisplayName(score: model.Score, trackIndex: number, beat: model.Beat): string | null {
    if (beat.text !== null && beat.text.length > 0) return beat.text;
    return this.detect(score, trackIndex, beat)?.name ?? null;
  }

  /** 拍の構成音からコードを推し量る（手で入れた値は見ない）。当てはまる型が無いときは null。 */
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
  return computeRealMidiPitch(openStringPitch(staff, stringNumber), staff.capo, fret);
}

/** 音の高さの類（オクターブの違いを除いたもの。0 が C）。 */
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
export function detectFromPitchClasses(
  pitchClasses: ReadonlySet<number>,
  lowestPitchClass: number,
): ChordDetectionResult | null {
  // 辞書の照らし合わせの段：14 の型を 12 のルートへずらした集まりと、構成音の集まりを突き合わせる
  const interpretations: ChordInterpretation[] = [];
  CHORD_TEMPLATES.forEach((template, templateIndex) => {
    for (let root = 0; root < SEMITONES_PER_OCTAVE; root++) {
      const shifted = new Set(template.intervals.map((interval) => pitchClassOf(root + interval)));
      if (sameSet(shifted, pitchClasses)) interpretations.push({ root, templateIndex });
    }
  });

  // 和声の解析の段：(1) 一番低い音をルートとする解釈、(2) 構成音の少ない型、(3) 表の上にある型、の順で 1 つ選ぶ
  const chosen = interpretations.sort((a, b) =>
    compareInOrder(selectionKeys(a, lowestPitchClass), selectionKeys(b, lowestPitchClass)),
  )[0];
  if (chosen === undefined) return null;

  const name = `${PITCH_NAMES[chosen.root]!}${CHORD_TEMPLATES[chosen.templateIndex]!.suffix}`;
  // ルートが一番低い音でなければ「ルートの名前/一番低い音の名前」の分数の形（C/E）にする
  const displayName =
    chosen.root === lowestPitchClass ? name : `${name}/${PITCH_NAMES[pitchClassOf(lowestPitchClass)]!}`;
  return { name: displayName, rootPitchClass: chosen.root };
}

/** 選ぶ順の 3 つの鍵（小さいほうを先に選ぶ）。 */
function selectionKeys(interpretation: ChordInterpretation, lowestPitchClass: number): readonly number[] {
  const rootIsLowest = interpretation.root === lowestPitchClass ? 0 : 1;
  const noteCount = CHORD_TEMPLATES[interpretation.templateIndex]!.intervals.length;
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
