/**
 * エラー・ログ基盤（層の外、web-core-foundation.md 2.1 節）の公開の入口（error-logging-foundation.md 2 節）。
 * main からは `@riff-line/core/errors` としてこの入口だけを読み込む（alphaTab を引き込まない細い入口、2.6 節）。
 *
 * - `NotificationCenter`：4 段階のメッセージ方式の唯一の窓口（クラス）。テストは直接 `new` する。
 * - `notificationCenter`：renderer（Webコア）の共有シングルトン（2.4 節）。4 節の表の 14 コードを登録済みの
 *   `errorCodeRegistry` を持つ。
 * - `Logger`：永続ログ（main プロセス側で `FileSystemAdapter` を注入）。
 */

// <!-- req errorloggingfoundation:249656c5.edd3 -->
export type {
  NotificationLevel,
  NotificationChannel,
  NotificationEvent,
  NotificationButtons,
  ErrorCodeDefinition,
  LogEntry,
  LogSink,
} from './types';

// <!-- req errorloggingfoundation:21d65ed0.7710 -->
export { LEVEL_TO_CHANNEL } from './channels';
export { UnknownErrorCodeError, InvalidErrorCodeError, type InvalidErrorCodeReason } from './errors';
export { ErrorCodeRegistry, ERROR_DOMAINS, type ErrorDomain } from './ErrorCodeRegistry';
export { renderMessageTemplate } from './messageTemplate';
export {
  CORE_ERROR_CODES,
  PERSISTENCE_ERROR_CODES,
  REPEATED_CRASH_THRESHOLD,
  registerCoreErrorCodes,
  registerPersistenceErrorCodes,
} from './coreErrorCodes';
export {
  NotificationCenter,
  toLogEntry,
  DEFAULT_RECENT_BUFFER_SIZE,
  type NotificationCenterOptions,
  type NotificationHandler,
  type SubscribeOptions,
} from './NotificationCenter';
export {
  Logger,
  dateStamp,
  dateTimeStamp,
  DEFAULT_LOG_QUOTA_BYTES,
  type LoggerOptions,
  type LogFileStore,
} from './Logger';

import { registerCoreErrorCodes, registerPersistenceErrorCodes } from './coreErrorCodes';
import { ErrorCodeRegistry } from './ErrorCodeRegistry';
import { NotificationCenter } from './NotificationCenter';

/**
 * 共有レジストリ。4 節の表の 14 コードと、このフォルダに置いた登録パッケージ = 2 のコードを登録済み。
 * 後のパッケージが自分の担当領域のコードを追加登録する。
 */
export const errorCodeRegistry: ErrorCodeRegistry = new ErrorCodeRegistry();
// <!-- req errorloggingfoundation:de73de7c.6861 -->
registerCoreErrorCodes(errorCodeRegistry);
registerPersistenceErrorCodes(errorCodeRegistry);

/** アプリ実行時に renderer の全レイヤーが使う共有 `NotificationCenter`（Webコア内シングルトン、2.4 節）。 */
// <!-- req errorloggingfoundation:de73de7c.f06c --> <!-- req errorloggingfoundation:de73de7c.0a90 -->
// <!-- req errorloggingfoundation:8157cf58.a55a -->
export const notificationCenter: NotificationCenter = new NotificationCenter(errorCodeRegistry);
// <!-- req webcorefoundation:78eb81f7.de3a --> <!-- req webcorefoundation:78eb81f7.8846 --> <!-- req webcorefoundation:78eb81f7.1a67 -->
