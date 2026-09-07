/**
 * エラー・ログ基盤の内部エラー型（error-logging-foundation.md §2.1）。
 *
 * アプリのユーザー向けエラーコード体系（`FILE-001` 等、00_reference.md §5）とは別の、
 * 「開発時に気づかせるための」例外。`platform/errors.ts` の軽量エラークラスと同じ位置づけ。
 */

/**
 * 未登録のエラーコードで `ErrorCodeRegistry.resolve()` / `NotificationCenter.report()` が
 * 呼ばれたときに投げる。握り潰さず開発時に顕在化させる（コード表への登録漏れを検出する）。
 */
export class UnknownErrorCodeError extends Error {
  readonly code = 'UNKNOWN_ERROR_CODE' as const;
  /** 解決できなかったエラーコード。 */
  readonly unknownCode: string;

  constructor(unknownCode: string, options?: ErrorOptions) {
    super(`Unknown error code: ${unknownCode}. Register it in the ErrorCodeRegistry before use.`, options);
    this.name = 'UnknownErrorCodeError';
    this.unknownCode = unknownCode;
    Object.setPrototypeOf(this, UnknownErrorCodeError.prototype);
  }
}
