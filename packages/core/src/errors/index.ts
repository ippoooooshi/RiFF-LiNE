/**
 * エラー・ログ基盤（L2/L3）の公開バレル（error-logging-foundation.md §2）。
 *
 * - `NotificationCenter`：4 段階メッセージの唯一の窓口（クラス）。テストは直接 `new` する。
 * - `notificationCenter`：アプリ実行時に使う共有シングルトン（08_error_logging.md §1.1「Webコア内シングルトン」）。
 *   コア 8 コードを登録済み。起動シーケンスが `setLogSink()` で `Logger`（IPC 実装）を結線する（B32）。
 * - `Logger`：永続ログ記録（main プロセス側で `FileSystemAdapter` を注入）。
 */

export type {
  NotificationLevel,
  NotificationChannel,
  NotificationEvent,
  ErrorCodeDefinition,
  LogEntry,
  LogSink,
} from './types';

export { LEVEL_TO_CHANNEL } from './channels';
export { UnknownErrorCodeError } from './errors';
export { ErrorCodeRegistry } from './ErrorCodeRegistry';
export { renderMessageTemplate } from './messageTemplate';
export { CORE_ERROR_CODES, registerCoreErrorCodes } from './coreErrorCodes';
export {
  NotificationCenter,
  toLogEntry,
  DEFAULT_RECENT_BUFFER_SIZE,
  type NotificationCenterOptions,
} from './NotificationCenter';
export { Logger, dateStamp, dateTimeStamp, DEFAULT_LOG_QUOTA_BYTES, type LoggerOptions } from './Logger';

import { registerCoreErrorCodes } from './coreErrorCodes';
import { ErrorCodeRegistry } from './ErrorCodeRegistry';
import { NotificationCenter } from './NotificationCenter';

/** コア 8 コードを登録済みの共有レジストリ。後続パッケージが自ドメインのコードを追加登録する。 */
export const errorCodeRegistry: ErrorCodeRegistry = new ErrorCodeRegistry();
registerCoreErrorCodes(errorCodeRegistry);

/** アプリ実行時に全レイヤーが使う共有 `NotificationCenter`（Webコア内シングルトン）。 */
export const notificationCenter: NotificationCenter = new NotificationCenter(errorCodeRegistry);
