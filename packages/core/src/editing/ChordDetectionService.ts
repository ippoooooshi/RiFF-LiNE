/**
 * Beat の構成音からコードネームを推定する（editing-core.md §8、04_editing_core.md §7）。
 *
 * 既知コードフォーム辞書（ルートからの音程集合）との照合＋転回形対応のハイブリッド。
 * カバー範囲・優先順位は「実装時に確定してよい実装詳細」（§8）。テキスト表示のみ（指板図なし、§7.4）。
 *
 * ピッチ算出：`開放弦チューニング + capo + フレット`。この式は playback パッケージが
 * `computeRealMidiPitch`（B18、`domain/pitch.ts`）として共有純粋関数へ抽出したため、
 * 重複を避けてそちらへ委譲する（単一の真実源、editing-core.md §14・00_reference.md §2）。
 */

import type { model } from '@coderline/alphatab';

import { computeRealMidiPitch } from '../domain/pitch';

import { getStaff, openStringPitch } from './scoreModel';

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** ルートからの半音集合 → サフィックス。長いパターンから先に照合する（より具体的な解釈を優先）。 */
const CHORD_TEMPLATES: readonly { intervals: readonly number[]; suffix: string }[] = [
  { intervals: [0, 4, 7, 11], suffix: 'maj7' },
  { intervals: [0, 3, 7, 10], suffix: 'm7' },
  { intervals: [0, 4, 7, 10], suffix: '7' },
  { intervals: [0, 3, 6, 9], suffix: 'dim7' },
  { intervals: [0, 3, 6, 10], suffix: 'm7b5' },
  { intervals: [0, 4, 7, 9], suffix: '6' },
  { intervals: [0, 3, 7, 9], suffix: 'm6' },
  { intervals: [0, 5, 7], suffix: 'sus4' },
  { intervals: [0, 2, 7], suffix: 'sus2' },
  { intervals: [0, 3, 6], suffix: 'dim' },
  { intervals: [0, 4, 8], suffix: 'aug' },
  { intervals: [0, 4, 7], suffix: '' }, // major
  { intervals: [0, 3, 7], suffix: 'm' },
  { intervals: [0, 7], suffix: '5' }, // power chord
];

export interface ChordDetectionResult {
  /** 表示名（例：`"Cmaj7"`、`"Am"`、`"G5"`）。 */
  name: string;
  /** ルート音のピッチクラス（0=C）。 */
  rootPitchClass: number;
}

export class ChordDetectionService {
  /**
   * Beat の表示コードネームを解決する。`Beat.text`（手動 override、`SetChordNameCommand`）があればそれを優先し、
   * 無ければ構成音から推定する（§8「override優先」）。推定不能なら null。
   */
  resolveDisplayName(score: model.Score, trackIndex: number, beat: model.Beat): string | null {
    if (beat.text !== null && beat.text.length > 0) return beat.text;
    return this.detect(score, trackIndex, beat)?.name ?? null;
  }

  /** Beat の構成音からコードを推定する（override は見ない）。純粋な推定。 */
  detect(score: model.Score, trackIndex: number, beat: model.Beat): ChordDetectionResult | null {
    const staff = getStaff(score, trackIndex);
    const pitchClasses = new Set<number>();
    for (const note of beat.notes) {
      pitchClasses.add(midiPitch(staff, note.string, note.fret) % 12);
    }
    return detectFromPitchClasses(pitchClasses);
  }
}

/** 実音 MIDI ピッチ ＝ 開放弦ピッチ（`openStringPitch`、規約の単一の真実源）＋ capo ＋ フレット（`computeRealMidiPitch`）。 */
function midiPitch(staff: model.Staff, stringNumber: number, fret: number): number {
  return computeRealMidiPitch(openStringPitch(staff, stringNumber), staff.capo, fret);
}

/** ピッチクラス集合からコードを推定する（テスト用に純関数として分離）。 */
export function detectFromPitchClasses(pitchClasses: ReadonlySet<number>): ChordDetectionResult | null {
  const pcs = [...pitchClasses];
  if (pcs.length < 2) return null;

  for (const template of CHORD_TEMPLATES) {
    if (template.intervals.length !== pcs.length) continue;
    for (const root of pcs) {
      const expected = new Set(template.intervals.map((i) => (root + i) % 12));
      if (expected.size === pitchClasses.size && [...pitchClasses].every((pc) => expected.has(pc))) {
        return { name: `${PITCH_NAMES[root]!}${template.suffix}`, rootPitchClass: root };
      }
    }
  }
  return null;
}
