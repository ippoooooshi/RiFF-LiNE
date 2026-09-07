/**
 * エラー・ログ基盤パッケージ完成までの暫定ログ出力（data-model-persistence.md §11 申し送り）。
 *
 * [[web-core-foundation.md#3.1]] の ScoreRenderHost と同じ暫定方式。
 * 「エラー・ログ基盤」パッケージ完成後、呼び出し箇所を NotificationCenter.report(code, context) へ置き換える。
 * それまでは console へ最小限の出力を行う（typescript.rule.md：console.log の常用は禁止だが、
 * この暫定ログは Warning/Error 相当の可観測性を保つためのもので、置換対象として明記されている）。
 */

/** Warning 相当（処理は継続する）。将来 NotificationCenter の Warning コードへ。 */
export function warnProvisional(message: string, context?: Record<string, unknown>): void {
  console.warn(`[persistence] ${message}`, context ?? '');
}

/** Error 相当（当該操作は失敗した）。将来 NotificationCenter の Error コードへ。 */
export function errorProvisional(message: string, context?: Record<string, unknown>): void {
  console.error(`[persistence] ${message}`, context ?? '');
}
