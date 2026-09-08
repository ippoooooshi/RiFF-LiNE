// UT-PART-COLOR: part-tuning-management.md §3.4・§3.6・§7 — PartColorAllocator
// 検証観点: 未使用の先頭色、使用中除外、reserved 除外、8色枯渇時の縮退、正規化（#有無・大小）（C1）。

import { describe, expect, it } from 'vitest';

import { PART_COLOR_PALETTE, PartColorAllocator } from './PartColorAllocator';

const alloc = new PartColorAllocator();

describe('PartColorAllocator', () => {
  it('allocate_NoneUsed_ReturnsFirstPaletteColor', () => {
    expect(alloc.allocate([])).toBe(PART_COLOR_PALETTE[0]);
  });

  it('allocate_SkipsUsedColors', () => {
    expect(alloc.allocate([PART_COLOR_PALETTE[0]!, PART_COLOR_PALETTE[1]!])).toBe(PART_COLOR_PALETTE[2]);
  });

  it('allocate_SkipsReservedColors', () => {
    expect(alloc.allocate([PART_COLOR_PALETTE[0]!], [PART_COLOR_PALETTE[1]!])).toBe(PART_COLOR_PALETTE[2]);
  });

  it('allocate_NormalizesHashAndCase', () => {
    const used = [PART_COLOR_PALETTE[0]!.replace('#', '').toUpperCase()];
    expect(alloc.allocate(used)).toBe(PART_COLOR_PALETTE[1]);
  });

  it('allocate_AllEightUsed_FallsBackToFirst', () => {
    expect(alloc.allocate([...PART_COLOR_PALETTE])).toBe(PART_COLOR_PALETTE[0]);
  });

  it('allocate_EightDistinctSequentially_NoDuplicates', () => {
    const used: string[] = [];
    for (let i = 0; i < 8; i++) {
      const c = alloc.allocate(used);
      expect(used).not.toContain(c);
      used.push(c);
    }
    expect(new Set(used).size).toBe(8);
  });
});
