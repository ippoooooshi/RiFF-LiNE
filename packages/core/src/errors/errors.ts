/**
 * エラー・ログ基盤の内部エラー型（error-logging-foundation.md 2.1 節）。
 *
 * アプリのエラーコード体系（`FILE-001` など、00_reference.md 5 節）とは別の、開発時に気づかせるための例外。
 * `platform/errors.ts` の軽量エラークラスと同じ位置づけ。
 */

/**
 * 未登録のエラーコードで `ErrorCodeRegistry.resolve()` / `NotificationCenter.report()` が
 * 呼ばれたときに投げる。握り潰さず開発時に気づけるようにする（コード表への登録漏れを見つける）。
 */
// <!-- req errorloggingfoundation:7bf846f1.19b0 -->
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

/**
 * 拒否の理由。`domain`＝8 つのドメインの外のコード（または `{ドメイン}-{3桁の連番}` の形でない）、
 * `logOnlyReason`＝`showOnScreen: false` なのに `logOnlyReason` が空。
 */
export type InvalidErrorCodeReason = 'domain' | 'logOnlyReason';

/**
 * `ErrorCodeRegistry.register()` が受け付けない定義を拒否するときに投げる（error-logging-foundation.md 2.1 節）。
 * 未登録コードの `UnknownErrorCodeError` と同じく、開発時に気づけるようにする。
 */
export class InvalidErrorCodeError extends Error {
  readonly code = 'INVALID_ERROR_CODE' as const;
  /** 拒否したエラーコード。 */
  readonly invalidCode: string;
  /** 拒否の理由。 */
  readonly reason: InvalidErrorCodeReason;

  constructor(invalidCode: string, reason: InvalidErrorCodeReason, options?: ErrorOptions) {
    super(`Invalid error code definition: ${invalidCode} (${reason}).`, options);
    this.name = 'InvalidErrorCodeError';
    this.invalidCode = invalidCode;
    this.reason = reason;
    Object.setPrototypeOf(this, InvalidErrorCodeError.prototype);
  }
}
