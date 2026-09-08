/**
 * パートの追加・削除・並べ替え（part-tuning-management.md §5、editing-core.md §6 基盤に準拠）。
 *
 * `RemovePartCommand` は差分保持の原則の例外で、削除した Track オブジェクトを丸ごと保持して undo で戻す
 * （04_editing_core.md §8.2、C11 のメモリ予算はこれを見積もる）。
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../../editing/commandBase';
import type { Command, CommandOutcome } from '../../editing/types';
import { buildPartTrack, getStaff } from '../partModel';

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

/** 全トラックのインデックス（構造変更は全パート再描画）。 */
function allTrackIndices(score: model.Score): number[] {
  return score.tracks.map((_t, i) => i);
}

export interface NewPartSpec {
  name: string;
  /** General MIDI プログラム番号。 */
  program: number;
  /** 開放弦チューニング（高音弦→低音弦）。 */
  tuning: number[];
  /** 識別色（`#RRGGBB`、`PartColorAllocator` が払い出した値）。 */
  colorHex?: string;
}

export class AddPartCommand implements Command {
  readonly kind = 'add-part';
  readonly label = 'パートを追加';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly spec: NewPartSpec;
  private readonly at: number;
  private added: model.Track | null = null;

  /**
   * @param at 挿入位置。省略・範囲外は末尾。
   */
  constructor(score: model.Score, spec: NewPartSpec, at?: number) {
    this.score = score;
    this.spec = spec;
    this.at = at ?? score.tracks.length;
    this.affectedTrackIndices = allTrackIndices(score);
  }

  execute(): CommandOutcome {
    const track = buildPartTrack({
      name: this.spec.name,
      program: this.spec.program,
      tuning: this.spec.tuning,
      bars: Math.max(1, this.score.masterBars.length),
      colorHex: this.spec.colorHex,
    });
    track.score = this.score;
    this.added = track;

    const at = Math.min(Math.max(0, this.at), this.score.tracks.length);
    this.score.tracks.splice(at, 0, track);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.added !== null) {
      const index = this.score.tracks.indexOf(this.added);
      if (index >= 0) this.score.tracks.splice(index, 1);
    }
    this.added = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

export class RemovePartCommand implements Command {
  readonly kind = 'remove-part';
  readonly label = 'パートを削除';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly trackIndex: number;
  private removed: { track: model.Track; index: number } | null = null;

  constructor(score: model.Score, trackIndex: number) {
    this.score = score;
    this.trackIndex = trackIndex;
    this.affectedTrackIndices = allTrackIndices(score);
  }

  execute(): CommandOutcome {
    const [track] = this.score.tracks.splice(this.trackIndex, 1);
    if (track !== undefined) this.removed = { track, index: this.trackIndex };
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.removed !== null) {
      this.score.tracks.splice(this.removed.index, 0, this.removed.track);
    }
    this.removed = null;
    return NO_ADVANCE;
  }

  /** パート全体（全 Bar/Note）を保持するため大きめに見積もる（C11 の予算対象）。 */
  estimateSizeBytes(): number {
    const barCount = this.score.tracks[this.trackIndex]
      ? getStaff(this.score, this.trackIndex).bars.length
      : this.score.masterBars.length;
    return BASE_COMMAND_BYTES + barCount * 4096;
  }
}

export class ReorderPartsCommand implements Command {
  readonly kind = 'reorder-parts';
  readonly label = 'パートを並べ替え';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  /** 新しい並び順（現在の `score.tracks` のインデックスの順列）。 */
  private readonly order: readonly number[];
  private previousTracks: model.Track[] | null = null;

  constructor(score: model.Score, order: readonly number[]) {
    this.score = score;
    this.order = order;
    this.affectedTrackIndices = allTrackIndices(score);
  }

  execute(): CommandOutcome {
    this.previousTracks = [...this.score.tracks];
    const reordered = this.order.map((i) => this.previousTracks![i]).filter((t): t is model.Track => t !== undefined);
    // 順列が不完全な場合に取りこぼしを防ぐ：order に含まれなかった track を末尾へ付ける。
    for (const track of this.previousTracks) {
      if (!reordered.includes(track)) reordered.push(track);
    }
    this.score.tracks.splice(0, this.score.tracks.length, ...reordered);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.previousTracks !== null) {
      this.score.tracks.splice(0, this.score.tracks.length, ...this.previousTracks);
    }
    this.previousTracks = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
