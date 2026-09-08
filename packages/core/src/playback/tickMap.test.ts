// UT: playback-integration.md §4.1・§4.2 — ArrayTickMap / buildBarTickBoundaries
//
// 検証観点:
//  - buildBarTickBoundaries：長さ = 小節数 + 1、単調増加、先頭 0、小節が無ければ throw
//  - ArrayTickMap.tickToBarIndex：区間 [start,end) 判定、負値/先頭前・曲末以降のクランプ
//  - ArrayTickMap.barStartTick：範囲内・下限クランプ・barCount（曲末 tick）
//  - コンストラクタの要素数不足 throw、fromScore

import { model } from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';

import { makeSong } from '../testing/editingFixtures';

import { ArrayTickMap, buildBarTickBoundaries } from './tickMap';

describe('buildBarTickBoundaries', () => {
  it('buildBarTickBoundaries_SingleBarScore_ReturnsZeroAndBarDuration', () => {
    // UT: §4.2
    const { score } = makeSong();
    const boundaries = buildBarTickBoundaries(score);
    expect(boundaries).toHaveLength(2);
    expect(boundaries[0]).toBe(0);
    expect(boundaries[1]).toBe(score.masterBars[0]!.calculateDuration());
    expect(boundaries[1]).toBeGreaterThan(0);
  });

  it('buildBarTickBoundaries_MultiBarScore_IsMonotonicIncreasing', () => {
    // UT: §4.2
    const { score } = makeSong();
    score.addMasterBar(new model.MasterBar());
    score.addMasterBar(new model.MasterBar());
    const boundaries = buildBarTickBoundaries(score);
    expect(boundaries).toHaveLength(4);
    for (let i = 1; i < boundaries.length; i += 1) {
      expect(boundaries[i]!).toBeGreaterThan(boundaries[i - 1]!);
    }
  });

  it('buildBarTickBoundaries_ScoreWithoutMasterBars_Throws', () => {
    // UT: §4.2 — 防御的ガード
    const empty = new model.Score();
    expect(() => buildBarTickBoundaries(empty)).toThrow(RangeError);
  });
});

describe('ArrayTickMap', () => {
  const boundaries = [0, 1000, 2000, 3000];

  it('ArrayTickMap_BoundariesTooShort_Throws', () => {
    // UT: §4.2
    expect(() => new ArrayTickMap([0])).toThrow(RangeError);
  });

  it('ArrayTickMap_FromScore_BuildsFromMasterBarDurations', () => {
    // UT: §4.2
    const { score } = makeSong();
    const map = ArrayTickMap.fromScore(score);
    expect(map.barStartTick(0)).toBe(0);
    expect(map.barStartTick(1)).toBe(score.masterBars[0]!.calculateDuration());
  });

  it('ArrayTickMap_TickInsideBar_ReturnsThatBar', () => {
    // UT: §4.2 — 区間 [start,end)
    const map = new ArrayTickMap(boundaries);
    expect(map.tickToBarIndex(0)).toBe(0);
    expect(map.tickToBarIndex(999)).toBe(0);
    expect(map.tickToBarIndex(1000)).toBe(1);
    expect(map.tickToBarIndex(2500)).toBe(2);
  });

  it('ArrayTickMap_TickBeforeStart_ClampsToFirstBar', () => {
    // UT: §4.2
    const map = new ArrayTickMap(boundaries);
    expect(map.tickToBarIndex(-100)).toBe(0);
  });

  it('ArrayTickMap_TickAtOrAfterEnd_ClampsToLastBar', () => {
    // UT: §4.2
    const map = new ArrayTickMap(boundaries);
    expect(map.tickToBarIndex(3000)).toBe(2);
    expect(map.tickToBarIndex(9999)).toBe(2);
  });

  it('ArrayTickMap_BarStartTick_ReturnsBoundaryForBarIndex', () => {
    // UT: §4.2
    const map = new ArrayTickMap(boundaries);
    expect(map.barStartTick(0)).toBe(0);
    expect(map.barStartTick(2)).toBe(2000);
  });

  it('ArrayTickMap_BarStartTick_ClampsNegativeToZeroAndBarCountToEndTick', () => {
    // UT: §4.2 — barIndex === barCount は曲末 tick
    const map = new ArrayTickMap(boundaries);
    expect(map.barStartTick(-5)).toBe(0);
    expect(map.barStartTick(3)).toBe(3000);
    expect(map.barStartTick(99)).toBe(3000);
  });

  it('ArrayTickMap_BarStartTick_FloorsFractionalIndex', () => {
    // UT: §4.2
    const map = new ArrayTickMap(boundaries);
    expect(map.barStartTick(1.9)).toBe(1000);
  });
});
