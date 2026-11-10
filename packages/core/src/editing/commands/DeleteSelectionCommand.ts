/**
 * 選択範囲の音符を消す（切り取りと削除、editing-core.md 2.6 節の表・9 節、基本設計 04 章 9 節）。
 *
 * 範囲は 1 つのパートの 1 つのボイスの中で、start と end の拍を両端に含む（`SelectionRange`、2.6 節）。もう一方のボイスの拍は消さない（3.1 節）。
 * 範囲の中の音のある拍は、音を消して同じ長さの休符の拍として残し、範囲の中の休符の拍は、取り除いて後ろを詰める
 * （4.4 節・4.5 節と同じ扱い、honnin-queue 57 番）。小節そのものと、小節の枠・拍子・テンポ・セクションマーカー・小節メモは消さない。
 * クリップボードは変えない（切り取りでクリップボードへ置く側は `ClipboardService` で、コマンドにしない）。
 * 取り消しで、消した音符と取り除いた拍を元の位置へ戻す。
 */

import type { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { getStaff, insertBeatAt, removeBeat, replaceNotes } from '../scoreModel';
import type { CommandOutcome, EditTarget, SelectionRange } from '../types';
import type { Command } from './Command';

/** 消した音符・取り除いた拍 1 つあたりの推定の大きさ（バイト、editing-core.md 2.3 節の予算の見積もり）。 */
const HELD_ITEM_BYTES = 64;

/** 範囲の中の 1 つの拍と、それが入っている Voice と位置（小節の番号と、Voice の中の拍の番号）。 */
interface RangeBeat {
  voice: model.Voice;
  beat: model.Beat;
  barIndex: number;
  index: number;
}

/**
 * 範囲の拍を、前から順に集める（editing-core.md 9 節：1 つのパートの 1 つのボイスの中で、start と end の拍を両端に含む）。
 * 選んだボイスが無い小節は飛ばす。`DuplicateSelectionCommand` も同じ集め方を使う。
 */
export function collectRangeBeats(score: model.Score, range: SelectionRange): RangeBeat[] {
  const bars = getStaff(score, range.trackIndex).bars;
  const result: RangeBeat[] = [];
  for (let b = range.startBarIndex; b <= range.endBarIndex; b++) {
    const voice = bars[b]?.voices[range.voiceIndex];
    if (voice === undefined) continue;
    const first = b === range.startBarIndex ? range.startBeatIndex : 0;
    const last =
      b === range.endBarIndex ? Math.min(range.endBeatIndex, voice.beats.length - 1) : voice.beats.length - 1;
    for (let i = first; i <= last; i++) result.push({ voice, beat: voice.beats[i]!, barIndex: b, index: i });
  }
  return result;
}

// 選択範囲の削除と、切り取りの消す側（9 節）。消す側だけを履歴に積み、取り消しで元に戻せる。クリップボードは変えない
// <!-- req editingcore:92227fca.634a --> <!-- req editingcore:e4a85c93.a326 --> <!-- req editingcore:3d11c782.ec7d --> <!-- req editingcore:3d11c782.4df1 -->
// <!-- req editingcore:a790c653.909c --> <!-- req editingcore:a790c653.5704 --> <!-- req editingcore:34a4ed78.9880 --> <!-- req editingcore:c1011209.c45a -->
export class DeleteSelectionCommand implements Command {
  readonly kind = 'delete-selection';
  readonly label: 'cut' | 'delete-selection';
  /** 範囲のパートだけ（`[range.trackIndex]`、2.6 節の表）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly range: SelectionRange;
  /** 音を消して休符にした拍と、消した音符（元の順）。 */
  private clearedNotes: { beat: model.Beat; notes: model.Note[] }[] = [];
  /** 取り除いた休符の拍と、元の位置。 */
  private removedRests: RangeBeat[] = [];

  /** @param label 切り取りなら 'cut'、削除なら 'delete-selection'（9 節）。 */
  // <!-- req editingcore:9290f772.7119 -->
  constructor(target: EditTarget, range: SelectionRange, label: 'cut' | 'delete-selection') {
    this.score = target.score;
    this.range = range;
    this.label = label; // <!-- req editingcore:a790c653.0b31 -->
    // <!-- req editingcore:92227fca.8c1a -->
    this.affectedTrackIndices = [range.trackIndex];
  }

  /**
   * 範囲の中の拍と音符だけを消す。小節そのものと、小節の枠・拍子・テンポ（MasterBar）・セクションマーカー・小節メモ（appMeta）には
   * 触れないので、消さずに残る（9 節）。切り取りの削除の側も同じ扱い。
   */
  // <!-- req editingcore:bbd1fdd3.44df --> <!-- req editingcore:bbd1fdd3.d4bb --> <!-- req editingcore:cc36cbc6.f9c7 --> <!-- req editingcore:cc36cbc6.247f -->
  // <!-- req editingcore:697049d4.a6dc --> <!-- req editingcore:697049d4.fc64 --> <!-- req editingcore:64c7fd90.9e2f --> <!-- req editingcore:64c7fd90.66ff -->
  // <!-- req editingcore:64c7fd90.382b --> <!-- req editingcore:64c7fd90.06e5 --> <!-- req editingcore:64c7fd90.0d0e --> <!-- req editingcore:64c7fd90.fd6a -->
  // <!-- req editingcore:1c03c2fe.18fa -->
  execute(): CommandOutcome {
    const beats = collectRangeBeats(this.score, this.range);
    // 先に全部を仕分けてから変える（音を消して休符になった拍を、取り除く休符の拍に数えないため）
    this.clearedNotes = beats
      .filter((b) => b.beat.notes.length > 0)
      .map((b) => ({ beat: b.beat, notes: [...b.beat.notes] }));
    this.removedRests = beats.filter((b) => b.beat.notes.length === 0);
    // 音のある拍は、音を消して同じ長さの休符の拍として残す（拍の長さは変えない）
    // <!-- req editingcore:92227fca.55b5 --> <!-- req editingcore:1c03c2fe.8e47 --> <!-- req editingcore:1c03c2fe.cd2d -->
    for (const { beat } of this.clearedNotes) replaceNotes(beat, []);
    // 休符の拍は、取り除いて後ろを詰める
    // <!-- req editingcore:1c03c2fe.594c --> <!-- req editingcore:1c03c2fe.ea39 -->
    for (const { voice, beat } of this.removedRests) removeBeat(voice, beat);
    return { cursorAdvance: 'none' };
  }

  /** 取り消しで元に戻せる（切り取りと削除のどちらも、9 節）。 */
  // <!-- req editingcore:34a4ed78.a202 --> <!-- req editingcore:c1011209.dc99 -->
  undo(): CommandOutcome {
    // 取り除いた拍は、元の位置の小さい順に戻すと、元の並びになる
    for (const { voice, beat, index } of this.removedRests) insertBeatAt(voice, index, beat);
    for (const { beat, notes } of this.clearedNotes) replaceNotes(beat, notes);
    this.clearedNotes = [];
    this.removedRests = [];
    return { cursorAdvance: 'none' };
  }

  /** 消した音符と取り除いた拍の数に比例させる（2.3 節：変更の差分だけを持つ）。 */
  estimateSizeBytes(): number {
    const notes = this.clearedNotes.reduce((sum, c) => sum + c.notes.length, 0);
    return BASE_COMMAND_BYTES + (notes + this.removedRests.length) * HELD_ITEM_BYTES;
  }
}
