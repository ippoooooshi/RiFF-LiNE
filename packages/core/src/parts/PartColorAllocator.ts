/**
 * パート識別色の自動割当（part-tuning-management.md §3.4・§4.3、02_data_model.md §3.2）。
 *
 * **ステートレスな割当処理**（part-tuning-management.md §3.6）：インスタンス状態を一切持たず、
 * 呼び出しのたびに「現在使用中の色」を引数で受け取り、未使用の先頭色を返すだけ。スコープの概念を持たない。
 * バッチ一括追加時の同一バッチ内重複回避は呼び出し元の責務（`reserved` で除外リストを渡す）。
 */

/**
 * 固定8色パレット（パート数上限8と同数＝全パートに重複なく割り当て可能）。
 * 具体値はビジュアルデザインシステム（14_visual_design_system.md §3）のトークンへ将来差し替え可能。
 */
export const PART_COLOR_PALETTE: readonly string[] = [
  '#4f46e5', // indigo
  '#059669', // emerald
  '#dc2626', // red
  '#d97706', // amber
  '#0891b2', // cyan
  '#7c3aed', // violet
  '#db2777', // pink
  '#65a30d', // lime
];

/** 比較用に正規化（先頭 `#` を付け小文字化）。 */
function normalize(hex: string): string {
  const body = hex.replace(/^#/, '').toLowerCase();
  return `#${body}`;
}

export class PartColorAllocator {
  /**
   * 未使用の先頭パレット色を返す。
   * @param usedColors 対象曲で現在使用中の色（`Part.color` 相当）。
   * @param reserved 同一バッチ内で払い出し済みだが未実行の色（§3.6、任意）。
   * @returns 未使用色。全色が埋まっている場合（通常はパート数上限で到達しない）はパレット先頭を返す。
   */
  allocate(usedColors: Iterable<string>, reserved: Iterable<string> = []): string {
    const taken = new Set<string>();
    for (const c of usedColors) taken.add(normalize(c));
    for (const c of reserved) taken.add(normalize(c));

    for (const color of PART_COLOR_PALETTE) {
      if (!taken.has(normalize(color))) return color;
    }
    return PART_COLOR_PALETTE[0]!;
  }
}
