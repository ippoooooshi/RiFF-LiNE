/**
 * 4 段階メッセージ方式の唯一の窓口（error-logging-foundation.md §2.1、08_error_logging.md §1.1）。
 *
 * プラットフォーム非依存の純粋ロジック。各サービス層は `report(code, context)` を呼ぶだけで、
 * レベル・チャンネルはコードから機械的に決まる。表示（Toast/Highlight/Modal）は購読側の責務。
 *
 * プロセス配置（B32）：本クラスは Webコア（レンダラー）側のシングルトン（`errors/index.ts`）。
 * 永続ログは main プロセスの `Logger` が持つため、`LogSink`（IPC 転送実装を含む）を注入して結線する。
 */

import { LEVEL_TO_CHANNEL } from './channels';
import type { ErrorCodeRegistry } from './ErrorCodeRegistry';
import { renderMessageTemplate } from './messageTemplate';
import type { LogEntry, LogSink, NotificationEvent } from './types';

/** 直近ログバッファの既定保持件数（`getRecentBuffer` / クラッシュログ用、error-logging-foundation.md §2.1）。 */
export const DEFAULT_RECENT_BUFFER_SIZE = 200;

export interface NotificationCenterOptions {
  /** 永続ログの記録先。未指定なら記録しない（テスト・ログ結線前の起動初期）。後から `setLogSink` でも可。 */
  logSink?: LogSink;
  /** 直近バッファの保持件数。 */
  recentBufferSize?: number;
}

type Handler = (event: NotificationEvent) => void;

export class NotificationCenter {
  private readonly registry: ErrorCodeRegistry;
  private readonly handlers = new Set<Handler>();
  private readonly recent: NotificationEvent[] = [];
  private readonly recentBufferSize: number;
  private logSink: LogSink | undefined;

  constructor(registry: ErrorCodeRegistry, options: NotificationCenterOptions = {}) {
    this.registry = registry;
    this.logSink = options.logSink;
    this.recentBufferSize = Math.max(1, options.recentBufferSize ?? DEFAULT_RECENT_BUFFER_SIZE);
  }

  /**
   * エラー／警告／通知を発行する（error-logging-foundation.md §3.1）。
   *
   * 手順：コード解決 → チャンネル導出 → テンプレート展開 → イベント組み立て → 直近バッファ追加 →
   * ログ記録（`LogSink`、失敗しても飲み込む）→ 購読者通知（1 購読者の例外が他へ波及しない）。
   *
   * @param code `{ドメイン}-{連番}` 形式の登録済みコード。
   * @param context 曲 ID・小節番号等の文脈情報。メッセージ展開とログの両方で使う。
   * @throws UnknownErrorCodeError 未登録コード（`ErrorCodeRegistry.resolve` 由来。開発時に顕在化させる）。
   */
  report(code: string, context?: Record<string, unknown>): void {
    const definition = this.registry.resolve(code);
    const channel = LEVEL_TO_CHANNEL[definition.level];
    const message = renderMessageTemplate(definition.messageTemplate, context);
    const timestamp = new Date().toISOString();

    const event: NotificationEvent =
      context !== undefined
        ? { level: definition.level, channel, code, message, context, timestamp }
        : { level: definition.level, channel, code, message, timestamp };

    // 直近バッファへ（クラッシュログ・デバッグ用）。上限超過分は古いものから捨てる。
    this.recent.push(event);
    if (this.recent.length > this.recentBufferSize) {
      this.recent.splice(0, this.recent.length - this.recentBufferSize);
    }

    // 永続ログ（error-logging-foundation.md §2.2 の結線）。ログ失敗を report の呼び出し元へ伝播させない。
    this.writeToLog(event);

    // 購読者へ配信。1 つの購読ハンドラが投げても残りの配信は続行する。
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (handlerError) {
        console.error('[NotificationCenter] subscriber threw:', handlerError);
      }
    }
  }

  /**
   * イベント購読を登録する。戻り値を呼ぶと解除される（error-logging-foundation.md §2.1）。
   */
  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * 直近の発行イベントを最大 `maxEntries` 件、古い順で返す（クラッシュログへの添付用）。
   * 返すのはコピーなので呼び出し側が変更しても内部状態に影響しない。
   */
  getRecentBuffer(maxEntries: number): NotificationEvent[] {
    if (maxEntries <= 0) return [];
    return this.recent.slice(-maxEntries);
  }

  /** ログ記録先を後から差し替える（起動後に `Logger`（IPC 実装）を結線する用、B32）。 */
  setLogSink(sink: LogSink | undefined): void {
    this.logSink = sink;
  }

  // ===== 内部ヘルパー =====

  /** `LogSink` へ 1 行渡す。同期例外も Promise reject も飲み込む（§2.2）。 */
  private writeToLog(event: NotificationEvent): void {
    const sink = this.logSink;
    if (sink === undefined) return;

    const entry = toLogEntry(event);
    try {
      const result = sink.append(entry);
      if (result instanceof Promise) {
        result.catch((logError: unknown) => {
          console.error('[NotificationCenter] log sink rejected:', logError);
        });
      }
    } catch (logError) {
      console.error('[NotificationCenter] log sink threw:', logError);
    }
  }
}

/**
 * `NotificationEvent` を永続ログ 1 行へ変換する。
 * Error / Critical のときだけ、発生位置の手がかりとして合成スタックを添える（08_error_logging.md §2 の記録内容）。
 */
export function toLogEntry(event: NotificationEvent): LogEntry {
  const base: LogEntry = {
    timestamp: event.timestamp,
    level: event.level,
    code: event.code,
    message: event.message,
  };
  if (event.context !== undefined) base.context = event.context;
  if (event.level === 'error' || event.level === 'critical') {
    const stack = new Error(`${event.code}: ${event.message}`).stack;
    if (stack !== undefined) base.stack = stack;
  }
  return base;
}
