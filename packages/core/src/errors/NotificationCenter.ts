/**
 * 4 段階のメッセージ方式（Info／Warning／Error／Critical）の唯一の窓口 <!-- req errorloggingfoundation:e8eddb7c.039b --> <!-- req errorloggingfoundation:438c1323.a9bb -->
 * （error-logging-foundation.md 2.1 節、08_error_logging.md 1.1 節）。
 *
 * プラットフォーム非依存の純粋ロジック。各サービスは `report(code, context)` を呼ぶだけで、レベル・チャンネルは <!-- req errorloggingfoundation:438c1323.db08 -->
 * コードから決まる。`report()` は記録（`NotificationEvent`）を 1 つ作って受け手へ登録順に配るだけで、
 * 受け手ごとの振る舞い（ログに書く・画面に出す）は受け手が持つ（2.1 節「受け手を分ける」）。 <!-- req errorloggingfoundation:84704e6c.319e --> <!-- req errorloggingfoundation:84704e6c.9ffc -->
 * 表示（toast／highlight／modal）の部品は本パッケージの外で、ここではイベントの契約までを決める（1 節）。 <!-- req errorloggingfoundation:6b1ad6ce.cdd5 -->
 *
 * 曲や小節を発生源に持つ呼び出し側は、`context` に `songId`・`barIndex`（パートがあれば `trackIndex`）を入れる。
 * 曲や小節を発生源に持たない通知（`SYS-001` など）は入れなくてよい（2.1 節）。
 */

// <!-- req errorloggingfoundation:6f5772e1.4117 --> <!-- req errorloggingfoundation:6f5772e1.4e1d -->
import { LEVEL_TO_CHANNEL } from './channels';
import type { ErrorCodeRegistry } from './ErrorCodeRegistry';
import { renderMessageTemplate } from './messageTemplate';
import type { LogEntry, LogSink, NotificationEvent } from './types';

/** 直近バッファの既定の保持件数（`getRecentBuffer`、error-logging-foundation.md 2.1 節）。 */
export const DEFAULT_RECENT_BUFFER_SIZE = 200;

export interface NotificationCenterOptions {
  /** ログの受け手が書く先。未指定なら書かない（ログ結線前の起動初期）。後から `setLogSink` でもよい。 */
  logSink?: LogSink;
  /** 直近バッファの保持件数。 */
  recentBufferSize?: number;
}

/** 受け手。`report()`／`relay()` が配る記録を 1 件ずつ受ける。 */
// <!-- req errorloggingfoundation:89362a5e.e962 -->
export type NotificationHandler = (event: NotificationEvent) => void;

/** `subscribe` の 2 つ目の引数（error-logging-foundation.md 2.1 節、2026-10-29 本人決定 K5）。 <!-- req errorloggingfoundation:438c1323.8741 --> */
// <!-- req errorloggingfoundation:438c1323.e5c5 -->
export interface SubscribeOptions {
  /** `relay()` の記録も受けるか。省略時 `true`。`false` で登録した受け手には `relay()` の記録を配らない。 */
  relayed?: boolean;
}

interface Receiver {
  readonly handler: NotificationHandler;
  readonly relayed: boolean;
}

// <!-- req errorloggingfoundation:e8eddb7c.e838 -->
// <!-- req errorloggingfoundation:3dbcd071.15be --> <!-- req errorloggingfoundation:de73de7c.6ab5 --> <!-- req errorloggingfoundation:de73de7c.40af -->
// <!-- req errorloggingfoundation:6f5772e1.522d -->
export class NotificationCenter {
  private readonly registry: ErrorCodeRegistry;
  /** 受け手。`Set` は登録順に回る（2.4 節「購読の順番」）。 */
  // <!-- req errorloggingfoundation:1de54fea.1f70 -->
  private readonly receivers = new Set<Receiver>();
  private readonly recent: NotificationEvent[] = [];
  private readonly recentBufferSize: number;
  private logSink: LogSink | undefined;

  constructor(registry: ErrorCodeRegistry, options: NotificationCenterOptions = {}) {
    this.registry = registry;
    this.logSink = options.logSink;
    this.recentBufferSize = Math.max(1, options.recentBufferSize ?? DEFAULT_RECENT_BUFFER_SIZE);
    // ログの受け手（2.1 節）：直近バッファと setLogSink の注入先。showOnScreen を見ずにすべての記録を受ける。 <!-- req errorloggingfoundation:527c56a7.935a -->
    // 最初に登録するので、すべての記録はまずここに届く。relay の記録は main がもう書いたので受けない（2.6 節）。
    // <!-- req errorloggingfoundation:527c56a7.caed --> <!-- req errorloggingfoundation:527c56a7.1252 -->
    // <!-- req 00:3adf3baa.0e2a -->
    // <!-- req errorloggingfoundation:cffd0968.5695 -->
    // <!-- req errorloggingfoundation:cffd0968.5a74 -->
    this.subscribe((event) => this.receiveForLog(event), { relayed: false });
  }

  /**
   * 記録を 1 つ作って受け手へ登録順に配る（error-logging-foundation.md 2.1 節・3.1 節）。 <!-- req errorloggingfoundation:438c1323.b769 -->
   * 引数は `code` と `context` の 2 つだけで、レベルは `ErrorCodeRegistry` がコードから引く。 <!-- req errorloggingfoundation:6d7dfd48.3c6c -->
   *
   * @param code `{ドメイン}-{連番}` 形式の登録済みコード。
   * @param context 文脈情報。メッセージの展開とログの両方で使う。
   * @throws UnknownErrorCodeError 未登録コード（`ErrorCodeRegistry.resolve` から。開発時に気づけるようにする）。
   */
  // <!-- req errorloggingfoundation:438c1323.c0bb --> <!-- req errorloggingfoundation:6d7dfd48.a581 --> <!-- req errorloggingfoundation:49e2af85.5a63 -->
  // <!-- req errorloggingfoundation:05b392ec.4a45 --> <!-- req errorloggingfoundation:39023a45.ad43 --> <!-- req errorloggingfoundation:39023a45.6a11 --> <!-- req errorloggingfoundation:39023a45.c23c --> <!-- req errorloggingfoundation:39023a45.6f75 -->
  // <!-- req errorloggingfoundation:71ee025b.20c4 -->
  // <!-- req errorloggingfoundation:6f5772e1.5f60 -->
  report(code: string, context?: Record<string, unknown>): void {
    // <!-- req errorloggingfoundation:6d7dfd48.b374 -->
    // <!-- req errorloggingfoundation:6f5772e1.499e -->
    const definition = this.registry.resolve(code);
    // <!-- req errorloggingfoundation:84704e6c.aac7 --> <!-- req errorloggingfoundation:4d822df3.02a9 -->
    const event: NotificationEvent = {
      // <!-- req errorloggingfoundation:89362a5e.c9bb -->
      level: definition.level,
      // <!-- req errorloggingfoundation:36b6ffa1.fcce -->
      channel: LEVEL_TO_CHANNEL[definition.level],
      code,
      message: renderMessageTemplate(definition.messageTemplate, context),
      timestamp: new Date().toISOString(),
      // 画面に出すか。定義の省略時は true（2.1 節）。
      // <!-- req errorloggingfoundation:d6cfbf9d.71b3 --> <!-- req errorloggingfoundation:36b6ffa1.f731 -->
      // <!-- req 00:4bcd3e9d.82a5 -->
      showOnScreen: definition.showOnScreen ?? true,
    };
    if (context !== undefined) event.context = context;
    // Critical の見出しとボタンの文言をモーダルへ渡す（2.1 節）。
    // <!-- req errorloggingfoundation:36b6ffa1.2915 -->
    if (definition.title !== undefined) event.title = definition.title;
    if (definition.buttons !== undefined) event.buttons = definition.buttons;
    // スタックトレースの取得元（2.2 節）：Error／Critical のときだけ、ここで取る。受け手の中で取ると受け手の <!-- req errorloggingfoundation:49e2af85.2a34 --> <!-- req errorloggingfoundation:49e2af85.70d6 -->
    // 呼び出し地点になってしまうため。context.error が Error ならその stack、そうでなければ report() を呼んだ地点。
    // <!-- req errorloggingfoundation:d6cfbf9d.7f30 --> <!-- req errorloggingfoundation:49e2af85.9e76 --> <!-- req errorloggingfoundation:49e2af85.c90d -->
    // <!-- req errorloggingfoundation:49344b98.f40c -->
    if (definition.level === 'error' || definition.level === 'critical') {
      const cause = context?.['error'];
      // <!-- req errorloggingfoundation:49e2af85.af98 --> <!-- req errorloggingfoundation:49e2af85.fca6 -->
      // <!-- req errorloggingfoundation:a30de309.351e -->
      // <!-- req errorloggingfoundation:a30de309.a837 -->
      const stack = cause instanceof Error ? cause.stack : new Error(`${code}: ${event.message}`).stack;
      // <!-- req errorloggingfoundation:49e2af85.cb01 -->
      if (stack !== undefined) event.stack = stack;
    }
    // <!-- req errorloggingfoundation:84704e6c.cd2e --> <!-- req errorloggingfoundation:4d822df3.a156 -->
    // <!-- req errorloggingfoundation:89362a5e.2f19 -->
    this.deliver(event, false);
  }

  /**
   * main から `notify:fromMain` で届いた記録を、作り直さずに受け手へ配る（error-logging-foundation.md 2.1 節・2.6 節）。 <!-- req errorloggingfoundation:438c1323.42f7 -->
   * `{ relayed: false }` で登録した受け手（ログの受け手）は飛ばす。直近バッファにも `setLogSink` にも積まない。
   */
  // <!-- req errorloggingfoundation:438c1323.3d60 -->
  // <!-- req errorloggingfoundation:cffd0968.3c78 -->
  relay(event: NotificationEvent): void {
    // <!-- req errorloggingfoundation:cffd0968.b095 -->
    this.deliver(event, true);
  }

  /**
   * 受け手を登録する。戻り値を呼ぶと解除される（error-logging-foundation.md 2.1 節）。
   * 受け手は登録順に呼ばれる。1 つの受け手が投げても残りの受け手には配る。
   */
  // <!-- req errorloggingfoundation:438c1323.bf14 -->
  subscribe(handler: NotificationHandler, options: SubscribeOptions = {}): () => void {
    // <!-- req errorloggingfoundation:438c1323.fe54 -->
    const receiver: Receiver = { handler, relayed: options.relayed ?? true };
    this.receivers.add(receiver);
    // <!-- req errorloggingfoundation:438c1323.5b05 -->
    return () => {
      this.receivers.delete(receiver);
    };
  }

  /**
   * renderer の中の直近の記録を最大 `maxEntries` 件、古い順で返す（error-logging-foundation.md 2.1 節）。 <!-- req errorloggingfoundation:438c1323.840b -->
   * クラッシュログには使わない（クラッシュで renderer ごと失われるため。クラッシュログは main の `LogRingBuffer`）。 <!-- req errorloggingfoundation:527c56a7.2132 -->
   * 返すのはコピーなので呼び出し側が変えても中の状態は変わらない。
   */
  // <!-- req errorloggingfoundation:438c1323.4d88 -->
  getRecentBuffer(maxEntries: number): NotificationEvent[] {
    if (maxEntries <= 0) return [];
    return this.recent.slice(-maxEntries);
  }

  /** ログの受け手が書く先を差し替える。同じプロセスで書く場合（テスト）はここへモックの `Logger` を渡す（2.2 節）。 <!-- req errorloggingfoundation:eb4b0acb.9c72 --> */
  // <!-- req errorloggingfoundation:eb4b0acb.c98a -->
  // <!-- req errorloggingfoundation:e6bd7249.abf5 -->
  setLogSink(sink: LogSink | undefined): void {
    this.logSink = sink;
  }

  // ===== 内部 =====

  /** 受け手へ登録順に配る。`relayed` の記録は `{ relayed: false }` の受け手を飛ばす。 */
  private deliver(event: NotificationEvent, relayed: boolean): void {
    for (const receiver of this.receivers) {
      // <!-- req errorloggingfoundation:438c1323.c647 -->
      // <!-- req errorloggingfoundation:cffd0968.a41f -->
      if (relayed && !receiver.relayed) continue;
      try {
        receiver.handler(event);
      } catch (handlerError) {
        console.error('[NotificationCenter] subscriber threw:', handlerError);
      }
    }
  }

  /** ログの受け手（2.1 節）：直近バッファに積み、`LogSink` へ 1 行渡す。 */
  // <!-- req errorloggingfoundation:527c56a7.bd54 -->
  private receiveForLog(event: NotificationEvent): void {
    this.recent.push(event);
    if (this.recent.length > this.recentBufferSize) {
      this.recent.splice(0, this.recent.length - this.recentBufferSize);
    }
    // <!-- req errorloggingfoundation:527c56a7.38ee -->
    this.writeToLog(event);
  }

  /** `LogSink` へ 1 行渡す。同期の例外も Promise の reject も呼び出し元へ伝えない。 */
  private writeToLog(event: NotificationEvent): void {
    const sink = this.logSink;
    if (sink === undefined) return;

    try {
      const result = sink.append(toLogEntry(event));
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
 * `NotificationEvent` をログの 1 行（`LogEntry`）へ組み立てる（error-logging-foundation.md 2.2 節・2.4 節）。
 * `stack` は `report()` が記録に載せた値を写すだけ。`context.error` が `Error` なら JSON に書けないので
 * `{ name, message }` に置き換える。`context` は 2.2 節の表で省略できないので、記録に文脈が無ければ `{}` を入れる。
 */
// <!-- req errorloggingfoundation:e6bd7249.b410 --> <!-- req errorloggingfoundation:982e378a.4182 -->
export function toLogEntry(event: NotificationEvent): LogEntry {
  const entry: LogEntry = {
    timestamp: event.timestamp,
    level: event.level,
    code: event.code,
    message: event.message,
    context: event.context === undefined ? {} : toLoggableContext(event.context),
  };
  // <!-- req errorloggingfoundation:b3b0064a.a5b0 -->
  // <!-- req errorloggingfoundation:49e2af85.e4a3 -->
  if (event.stack !== undefined) entry.stack = event.stack;
  return entry;
}

/** `context.error` が `Error` なら `{ name, message }` に置き換えた写しを返す。そうでなければそのまま返す。 */
function toLoggableContext(context: Record<string, unknown>): Record<string, unknown> {
  const error = context['error'];
  if (!(error instanceof Error)) return context;
  // <!-- req errorloggingfoundation:49e2af85.bdc4 -->
  return { ...context, error: { name: error.name, message: error.message } };
}
