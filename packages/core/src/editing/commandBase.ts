/**
 * コマンド実装の共有ヘルパー（editing-core.md §6）。
 */

/**
 * 差分のみを保持する通常コマンド 1 件の推定保持サイズ（バイト）。
 * 実際の JS オブジェクトのヒープ使用量は測れないため、履歴予算（80MB, §6.2）に対して
 * 安全側に丸めた固定見積り。数百件積んでも数百 KB で、予算に対して無視できる。
 */
export const BASE_COMMAND_BYTES = 512;

/**
 * スナップショット（Score 断片の複製）を保持するコマンドの推定サイズ。
 * 決定的 JSON 文字列化のバイト長で近似する（UTF-16 の 1 文字 ≒ 2 バイトとみなし ×2）。
 */
export function estimateSnapshotBytes(snapshot: unknown): number {
  try {
    return JSON.stringify(snapshot).length * 2 + BASE_COMMAND_BYTES;
  } catch {
    return BASE_COMMAND_BYTES;
  }
}
