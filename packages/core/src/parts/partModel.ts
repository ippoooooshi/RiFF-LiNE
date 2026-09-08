/**
 * alphaTab `model.Track` / `model.Staff` をアプリの「パート」として扱うためのヘルパー
 * （part-tuning-management.md §4、02_data_model.md §3.2）。
 *
 * パート = `score.tracks[i]` ＋ その `staves[0]`（MVP は 1 トラック = 1 Staff）。
 * フィールド対応：
 *  - 弦チューニング／弦数 : `staff.stringTuning.tunings`（高音弦→低音弦）
 *  - カポ               : `staff.capo`
 *  - 音量／パン／ソロ／ミュート : `track.playbackInfo.volume` / `.balance` / `.isSolo` / `.isMute`
 *  - 識別色             : `track.color`（HEX 文字列 ⇔ `model.Color` を変換）
 *  - order              : `score.tracks` 内の位置
 */

import { model } from '@coderline/alphatab';

// 弦・トラック走査の基本ヘルパーは editing パッケージが単一の真実源（重複定義を避ける）。
// parts 内の他ファイルからは本モジュール経由で使うが、`parts/index.ts` からは再エクスポートしない
// （main バレルで editing 側と名前衝突するため）。
import { getStaff, trackCount } from '../editing/scoreModel';

export { getStaff, trackCount };

/** ミキサー値（part-tuning-management.md §5）。alphaTab の 0〜16 レンジをそのまま使う。 */
export interface MixerValues {
  volume: number;
  pan: number;
  solo: boolean;
  mute: boolean;
}

export function getTrack(score: model.Score, trackIndex: number): model.Track {
  const track = score.tracks[trackIndex];
  if (!track) throw new RangeError(`trackIndex out of range: ${trackIndex}`);
  return track;
}

/** 開放弦チューニング（高音弦→低音弦の MIDI ピッチ）。 */
export function getTuning(score: model.Score, trackIndex: number): number[] {
  return [...getStaff(score, trackIndex).stringTuning.tunings];
}

export function getStringCount(score: model.Score, trackIndex: number): number {
  return getStaff(score, trackIndex).stringTuning.tunings.length;
}

/**
 * 指定弦の開放弦 MIDI ピッチ。
 *
 * **alphaTab 規約**：`note.string` は 1 = 最低音弦（タブ最下線）で上へ増加。一方 `stringTuning.tunings` は
 * 先頭＝最高音弦（タブ最上線）の並び（高音弦→低音弦）。したがって
 * `tunings[tunings.length - stringNumber]` が `stringNumber` 番弦の開放弦ピッチ。
 */
export function openStringPitch(score: model.Score, trackIndex: number, stringNumber: number): number {
  const tunings = getStaff(score, trackIndex).stringTuning.tunings;
  return tunings[tunings.length - stringNumber] ?? 0;
}

export function getCapo(score: model.Score, trackIndex: number): number {
  return getStaff(score, trackIndex).capo;
}

export function getMixer(score: model.Score, trackIndex: number): MixerValues {
  const info = getTrack(score, trackIndex).playbackInfo;
  return { volume: info.volume, pan: info.balance, solo: info.isSolo, mute: info.isMute };
}

// ===== 色（HEX 文字列 ⇔ model.Color） =====

/** `#RRGGBB` / `#RGB` → `model.Color`。不正な文字列は黒。 */
export function hexToColor(hex: string): model.Color {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return new model.Color(Number.isNaN(r) ? 0 : r, Number.isNaN(g) ? 0 : g, Number.isNaN(b) ? 0 : b);
}

/** `model.Color` → `#RRGGBB`（小文字）。 */
export function colorToHex(color: model.Color): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${h(color.r)}${h(color.g)}${h(color.b)}`;
}

export function getColorHex(score: model.Score, trackIndex: number): string {
  return colorToHex(getTrack(score, trackIndex).color);
}

/**
 * 新規パート（Track ＋ Staff ＋ 全 MasterBar 分の空 Bar）を組み立てる。`score.addTrack` 前の状態で返す。
 * @param bars 用意する Bar 数（= 既存の `score.masterBars.length`、最低 1）。
 */
export function buildPartTrack(params: {
  name: string;
  program: number;
  tuning: number[];
  bars: number;
  /** 識別色（`#RRGGBB`）。省略時は alphaTab 既定色。 */
  colorHex?: string;
}): model.Track {
  const track = new model.Track();
  track.name = params.name;
  track.playbackInfo.program = params.program;
  if (params.colorHex !== undefined) track.color = hexToColor(params.colorHex);

  const staff = new model.Staff();
  track.addStaff(staff);
  staff.stringTuning.tunings = [...params.tuning];
  staff.showTablature = true;
  staff.showStandardNotation = false;

  for (let i = 0; i < Math.max(1, params.bars); i++) {
    const bar = new model.Bar();
    staff.addBar(bar);
    const voice = new model.Voice();
    bar.addVoice(voice);
    const rest = new model.Beat();
    rest.duration = model.Duration.Whole;
    voice.addBeat(rest);
  }
  return track;
}
