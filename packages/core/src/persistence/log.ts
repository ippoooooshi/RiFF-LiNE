/**
 * 永続化層の内部リカバリ警告（コード無し）の暫定出力。
 *
 * `trash-index.json` の破損時の再構築、読めない曲のファイルを飛ばしての索引の作り直し、サムネイルの写し・
 * ローカルバックアップ・保存の後の処理・起動のときの片付けの失敗のように、「自動的に回復し、ユーザー操作を妨げない」種類の Warning はエラーコード体系（`FILE-xxx`）を持たない。
 * これらは `NotificationCenter` を通さず、開発時の可観測性のために console へ最小限出力する。
 *
 * エラーコードを持つ遷移（FILE-001 リトライ全滅 / FILE-005 ミラー失敗 等）は
 * `NotificationCenter.report(code, context)` を直接呼ぶ（error-logging-foundation.md §9.2）。
 */

/** Warning 相当（処理は自動回復し継続する）。エラーコードを持たない内部警告用。 */
export function warnProvisional(message: string, context?: Record<string, unknown>): void {
  console.warn(`[persistence] ${message}`, context ?? '');
}
