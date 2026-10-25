/**
 * C2（条件網羅）の組み合わせの表（web-core-foundation.md 14.3 節・14.9 節）。
 * 本番コードからは import しない。テストは combinations.test.ts（UT-FIXTURE-COMB）。15.4 節の置き場所（packages/core/src/testing の combinations.ts） <!-- req webcorefoundation:2a4c3b22.d124 -->
 */

/** C2 の組み合わせの表（14.3 節）。keys の要素ごとの真と偽の組み合わせを、2 の keys.length 乗の行で返す */
// <!-- req webcorefoundation:03b008ab.3ab8 -->
export function allCombinations<K extends string>(keys: readonly K[]): Array<Record<K, boolean>> {
  const rows: Array<Record<K, boolean>> = [];
  for (let mask = 0; mask < 2 ** keys.length; mask++) {
    const row = {} as Record<K, boolean>;
    keys.forEach((key, i) => (row[key] = (mask & (1 << i)) !== 0));
    rows.push(row);
  }
  return rows;
}
