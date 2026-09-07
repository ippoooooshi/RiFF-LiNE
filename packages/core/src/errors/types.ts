/**
 * エラー・ログ基盤の共有型（error-logging-foundation.md §2.1・§2.2、08_error_logging.md §1・§2）。
 *
 * IPC を越える型（`NotificationLevel` / `NotificationChannel` / `NotificationEvent` / `LogEntry`）は
 * `@riff-line/shared-types` が単一の真実源（B32：Logger は main プロセス側）。ここは re-export に留める。
 * `ErrorCodeDefinition` / `LogSink` は Webコア内部だけで完結するため本ファイルで定義する。
 */

export type { NotificationLevel, NotificationChannel, NotificationEvent, LogEntry } from '@riff-line/shared-types';

import type { LogEntry, NotificationLevel } from '@riff-line/shared-types';

/**
 * エラーコード 1 件の定義（error-logging-foundation.md §2.1）。
 * `channel` は `level` から導出するため登録は実質 `level` と `messageTemplate` のみ。
 */
export interface ErrorCodeDefinition {
  /** このコードに固定されたレベル。コードとレベルは 1 対 1（呼び出し側がレベルを指定できない設計）。 */
  level: NotificationLevel;
  /**
   * 表示メッセージのテンプレート。`{context.xxx}` を `context.xxx` の値で置換する
   * （messageTemplate.ts）。プレースホルダを含まない固定文言でもよい。
   */
  messageTemplate: string;
}

/**
 * `NotificationCenter` が発行イベントを永続化のために渡す先（error-logging-foundation.md §2.2 の
 * 「`NotificationCenter` が `Logger` インスタンスを保持する」結線）。`Logger` を直接参照せず本 I/F に
 * 依存することで、テスト時のモック差し替えと「`Logger` は main プロセス側（IPC 経由）」という
 * プロセス配置（B32）の両方を吸収する。
 */
export interface LogSink {
  /** 1 件のログ行を記録する。失敗しても呼び出し元（`report()`）へ例外を伝播してはならない。 */
  append(entry: LogEntry): void | Promise<void>;
}
