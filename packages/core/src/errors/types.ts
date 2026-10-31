/**
 * エラー・ログ基盤の共有型（error-logging-foundation.md 2.1 節・2.2 節、08_error_logging.md 1 節・2 節）。
 *
 * IPC を越える型（`NotificationLevel` / `NotificationChannel` / `NotificationEvent` / `NotificationButtons` / `LogEntry`）は
 * `@riff-line/shared-types` が単一の真実源（error-logging-foundation.md 2.4 節）。ここは re-export に留める。
 * `ErrorCodeDefinition` / `LogSink` は Webコア内部だけで完結するため本ファイルで定義する。
 */

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
 * チャンネルは `level` から `LEVEL_TO_CHANNEL` 表で導出するため、実質 `level` だけを登録すればよい（channels.ts）。 <!-- req errorloggingfoundation:eef1f7b0.23e0 --> <!-- req errorloggingfoundation:eef1f7b0.0bb1 -->
 */
export interface ErrorCodeDefinition {
  /** このコードに固定されたレベル。コードとレベルは 1 対 1（呼び出し側がレベルを指定できない設計、2.1 節）。 */
  // <!-- req errorloggingfoundation:7bf846f1.7108 --> <!-- req errorloggingfoundation:eef1f7b0.ca68 -->
  level: NotificationLevel;
  /**
   * メッセージのテンプレート。`{context.xxx}` を `context.xxx` の値で置き換える（messageTemplate.ts）。
   * Critical のコードでは本文（原因の要約と選択肢）として使う。 <!-- req errorloggingfoundation:eef1f7b0.1682 -->
   */
  // <!-- req errorloggingfoundation:7bf846f1.dc5a --> <!-- req errorloggingfoundation:eef1f7b0.714c -->
  messageTemplate: string;
  /** Critical のコードの見出し（何が起きたか）。`NotificationEvent.title` に載せてモーダルへ渡す。 */
  // <!-- req errorloggingfoundation:eef1f7b0.ad16 -->
  title?: string;
  /** Critical のコードのボタンの文言（肯定・否定をはっきりさせ、「OK」だけにしない）。`NotificationEvent.buttons` に載せる。 */
  // <!-- req errorloggingfoundation:eef1f7b0.c803 -->
  buttons?: NotificationButtons;
  /**
   * 画面に出すか。省略時 `true`＝レベルから `LEVEL_TO_CHANNEL` で決まるチャンネルへ出す。`false` ならログにだけ書く。 <!-- req errorloggingfoundation:eef1f7b0.47e4 -->
   * レベルを問わず指定できる。 <!-- req errorloggingfoundation:eef1f7b0.873b -->
   */
  // <!-- req errorloggingfoundation:eef1f7b0.a34e -->
  showOnScreen?: boolean;
  /** `showOnScreen: false` のときの、出さない理由（必須。空なら `ErrorCodeRegistry.register` が拒否する）。 */
  // <!-- req errorloggingfoundation:eef1f7b0.ce99 -->
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
