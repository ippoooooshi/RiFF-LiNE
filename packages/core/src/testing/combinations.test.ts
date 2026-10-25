// UT-FIXTURE-COMB: C2 の組み合わせの表（allCombinations） <!-- req webcorefoundation:bfba7a51.9420 --> <!-- req webcorefoundation:f41152a9.f427 -->
// 検証節: web-core-foundation.md 14.9 節・14.3 節

import { describe, expect, it } from 'vitest';

import { allCombinations } from './combinations';

describe('allCombinations（14.9 節）', () => {
  it('allCombinations_キーごとの真と偽の組み合わせを2のn乗の行で重ならずに返す', () => {
    // UT-FIXTURE-COMB-01
    const rows = allCombinations(['a', 'b', 'c'] as const);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => `${r.a}${r.b}${r.c}`)).size).toBe(8);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['a', 'b', 'c']);
    expect(rows).toContainEqual({ a: true, b: true, c: true });
    expect(rows).toContainEqual({ a: false, b: false, c: false });
  });

  it('allCombinations_キーが無ければ空の組み合わせ1行', () => {
    // UT-FIXTURE-COMB-02 2 の 0 乗
    expect(allCombinations([])).toEqual([{}]);
  });
});
