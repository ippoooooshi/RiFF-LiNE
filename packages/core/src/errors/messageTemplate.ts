/**
 * メッセージテンプレートの展開（error-logging-foundation.md §2.1 の `messageTemplate`）。
 *
 * `{context.xxx}` を `context.xxx` の値で置換する。純粋関数。
 */

/** `{context.<key>}` にマッチする。`<key>` は英数字と `_`。 */
const PLACEHOLDER = /\{context\.([A-Za-z0-9_]+)\}/g;

/**
 * `template` 内の `{context.xxx}` を `context.xxx` の文字列表現へ置換する。
 *
 * - `context` に該当キーが**ある**場合のみ置換する（値が `undefined` でも「キーがある」なら `"undefined"` になる）。
 * - キーが無い場合はプレースホルダをそのまま残す（文脈不足に気づけるようにするため空文字で潰さない）。
 * - プレースホルダを含まないテンプレートはそのまま返る。
 *
 * @param template 定義済みのメッセージテンプレート。
 * @param context 呼び出し側が `report()` に渡した文脈情報。
 */
export function renderMessageTemplate(template: string, context?: Record<string, unknown>): string {
  if (!template.includes('{context.')) return template;

  return template.replace(PLACEHOLDER, (whole, key: string) => {
    if (context !== undefined && Object.prototype.hasOwnProperty.call(context, key)) {
      return String(context[key]);
    }
    return whole;
  });
}
