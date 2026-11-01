/**
 * エラー・ログ基盤の共有型（error-logging-foundation.md 2.1 節・2.2 節、08_error_logging.md 1 節・2 節）。
 *
 * IPC を越える型（`NotificationLevel` / `NotificationChannel` / `NotificationEvent` / `NotificationButtons` / `LogEntry`）は
 * `@riff-line/shared-types` が単一の真実源（error-logging-foundation.md 2.4 節）。ここは re-export に留める。
 * `ErrorCodeDefinition` / `LogSink` は Webコア内部だけで完結するため本ファイルで定義する。
 */

// <!-- req errorloggingfoundation:920e31e8.9186 -->
export type {
  NotificationLevel,
  NotificationChannel,
  NotificationEvent,
  NotificationButtons,
  LogEntry,
} from '@riff-line/shared-types';

import type { LogEntry, NotificationButtons, NotificationLevel } from '@riff-line/shared-types';

/**
 * エラーコード 1 件の定義（error-logging-foundation.md 2.1 節）。
 * `channel` はフィールドに持たず、`report()` が `level` から `LEVEL_TO_CHANNEL` 表で導き出す（channels.ts）。 <!-- req errorloggingfoundation:36b6ffa1.d1fb --> <!-- req errorloggingfoundation:36b6ffa1.fcce -->
 * `level` で分けた合併型：Critical のコードは `title` と `buttons` を省けない（`CriticalErrorCodeDefinition`）。
 * Critical 以外のコードは `title`・`buttons` を持てない（`NonCriticalErrorCodeDefinition`。見出しとボタンはモーダルにだけ出すため）。
 */
export type ErrorCodeDefinition = CriticalErrorCodeDefinition | NonCriticalErrorCodeDefinition;

/** Critical のコードの定義（error-logging-foundation.md 2.1 節）。見出しとボタンの文言を必ず持つ。 */
export interface CriticalErrorCodeDefinition extends ErrorCodeDefinitionBase {
  /** このコードに固定されたレベル。コードとレベルは 1 対 1（呼び出し側がレベルを指定できない設計、2.1 節）。 */
  // <!-- req errorloggingfoundation:bfb5910c.7108 --> <!-- req errorloggingfoundation:36b6ffa1.994b -->
  level: 'critical';
  /** Critical のコードの見出し（何が起きたか）。`NotificationEvent.title` に載せてモーダルへ渡す。 */
  // <!-- req errorloggingfoundation:36b6ffa1.ad16 -->
  title: string;
  /** Critical のコードのボタンの文言（肯定・否定をはっきりさせ、「OK」だけにしない）。`NotificationEvent.buttons` に載せる。 */
  // <!-- req errorloggingfoundation:36b6ffa1.c803 -->
  buttons: NotificationButtons;
}

/** Critical 以外（Info・Warning・Error）のコードの定義（error-logging-foundation.md 2.1 節）。見出しとボタンを持たない。 */
export interface NonCriticalErrorCodeDefinition extends ErrorCodeDefinitionBase {
  /** このコードに固定されたレベル（2.1 節）。 */
  level: Exclude<NotificationLevel, 'critical'>;
  title?: never;
  buttons?: never;
}

/** レベルを問わず持つフィールド（error-logging-foundation.md 2.1 節）。 */
interface ErrorCodeDefinitionBase {
  /**
   * メッセージのテンプレート。`{context.xxx}` を `context.xxx` の値で置き換える（messageTemplate.ts）。
   * Critical のコードでは本文（原因の要約と選択肢）として使う。 <!-- req errorloggingfoundation:36b6ffa1.1682 -->
   */
  // <!-- req errorloggingfoundation:bfb5910c.dc5a --> <!-- req errorloggingfoundation:36b6ffa1.714c -->
  messageTemplate: string;
  /**
   * 画面に出すか。省略時 `true`＝レベルから `LEVEL_TO_CHANNEL` で決まるチャンネルへ出す。`false` ならログにだけ書く。 <!-- req errorloggingfoundation:36b6ffa1.47e4 -->
   * レベルを問わず指定できる。 <!-- req errorloggingfoundation:36b6ffa1.873b -->
   */
  // <!-- req errorloggingfoundation:36b6ffa1.a34e -->
  // <!-- req 00:c6a42980.3300 -->
  showOnScreen?: boolean;
  /** `showOnScreen: false` のときの、出さない理由（必須。空なら `ErrorCodeRegistry.register` が拒否する）。 */
  // <!-- req errorloggingfoundation:36b6ffa1.ce99 -->
  // <!-- req 00:c6a42980.5033 -->
  logOnlyReason?: string;
}

/**
 * `NotificationCenter` のログの受け手が記録を渡す先（error-logging-foundation.md 2.1 節の `setLogSink` の注入先）。
 * 同じプロセスで書く場合（テスト）は、ここへモックの `Logger` を渡す（2.2 節の結線）。
 */
export interface LogSink {
  /** 1 件のログ行を記録する。失敗しても呼び出し元（`report()`）へ例外を伝えない。 */
  append(entry: LogEntry): void | Promise<void>;
}
