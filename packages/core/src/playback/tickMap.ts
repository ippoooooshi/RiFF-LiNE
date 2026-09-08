/**
 * `TickMap` の Score 由来の実装（playback-integration.md §4.1・§4.2）。
 *
 * 小節先頭 tick の配列（境界）を alphaTab `MasterBar.calculateDuration()` の積算で作り、
 * tick ⇔ 小節インデックスの相互変換を提供する。純粋データのみを持ち、alphaTab の再生 API には依存しない。
 */

import type { model } from '@coderline/alphatab';

import type { TickMap } from './types';

/**
 * 各小節先頭の tick を積算した配列を返す（長さ = 小節数 + 1、先頭は 0、末尾は曲末の tick）。
 * @throws 小節が 1 つも無い Score の場合。
 */
export function buildBarTickBoundaries(score: model.Score): number[] {
  const masterBars = score.masterBars;
  if (masterBars.length === 0) {
    throw new RangeError('buildBarTickBoundaries requires a score with at least one master bar.');
  }
  const boundaries: number[] = [0];
  for (const masterBar of masterBars) {
    const previous = boundaries[boundaries.length - 1] ?? 0;
    boundaries.push(previous + masterBar.calculateDuration());
  }
  return boundaries;
}

/** 小節先頭 tick 配列を包む `TickMap` 実装。 */
export class ArrayTickMap implements TickMap {
  private readonly boundaries: readonly number[];
  /** 最終小節のインデックス（0 始まり）。 */
  private readonly lastBarIndex: number;

  /**
   * @param boundaries 小節先頭 tick の配列（`buildBarTickBoundaries` 形式、単調増加・長さ 2 以上）。
   * @throws 要素数が 2 未満（＝小節が 1 つも無い）の場合。
   */
  constructor(boundaries: readonly number[]) {
    if (boundaries.length < 2) {
      throw new RangeError('ArrayTickMap requires boundaries for at least one bar (length >= 2).');
    }
    this.boundaries = boundaries;
    this.lastBarIndex = boundaries.length - 2;
  }

  /** Score から直接構築する。 */
  static fromScore(score: model.Score): ArrayTickMap {
    return new ArrayTickMap(buildBarTickBoundaries(score));
  }

  tickToBarIndex(tick: number): number {
    // 先頭より前は最初の小節へクランプ。
    if (tick <= 0) return 0;
    // 各小節の半開区間 [boundaries[i], boundaries[i+1]) で判定する。
    for (let barIndex = 0; barIndex <= this.lastBarIndex; barIndex += 1) {
      if (tick < (this.boundaries[barIndex + 1] ?? Number.POSITIVE_INFINITY)) {
        return barIndex;
      }
    }
    // 曲末以降は最終小節へクランプ。
    return this.lastBarIndex;
  }

  barStartTick(barIndex: number): number {
    // barIndex === barCount（= lastBarIndex + 1）は曲末 tick を返す（ループ終端の指定に使う）。
    const clamped = Math.min(Math.max(0, Math.floor(barIndex)), this.lastBarIndex + 1);
    return this.boundaries[clamped] ?? 0;
  }
}
