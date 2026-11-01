/**
 * main で出たエラーを main が自分でログに書く口（error-logging-foundation.md 2.4 節・2.6 節、2026-10-29 本人決定 K5）。
 *
 * main で出たエラーは renderer を通さない。中に renderer と同じクラスの `NotificationCenter` を 1 つ持ち（renderer の共有
 * シングルトンとは別のインスタンス）、記録の組み立ては Webコアの `NotificationCenter` と `toLogEntry` に任せる。main は書くだけを
 * 受け持つ（組み立ての決まりは Webコアの 1 か所のまま、基本設計 08 章 1.1 節との両立の読みは 2.6 節）。
 * 読み込む入口は `@riff-line/core/errors` だけ（alphaTab を引き込まない細い入口、2.6 節）。
 *
 * 受け手の 1 つ目はログの受け手で、`showOnScreen` を見ずに `toLogEntry(event)` で組み立てた `LogEntry` を `writeLog` に渡す。
 * `writeLog` が reject しても、ここで受けて捨てる（コンソールにだけ出す。2.6 節の (b)：受けずに置くと unhandledRejection の
 * 繰り返しになるため）。
 *
 * まだ作らないもの（後の区切り）：2 つ目の受け手（`showOnScreen` が真の記録を `notify:fromMain` で開いている窓の全部へ送る）と、
 * `process` の `uncaughtException`・`unhandledRejection` を登録する `registerMainUncaughtHandlers`（2.6 節）。
 */

import { NotificationCenter, toLogEntry, type ErrorCodeRegistry, type LogEntry } from '@riff-line/core/errors';

export interface MainErrorLoggerDeps {
  /** 記録を組み立てる登録簿。main.ts は `@riff-line/core/errors` の `errorCodeRegistry`（4 節のコードを登録済み）を渡す。 */
  registry: ErrorCodeRegistry;
  /** ログの 1 行を書く。main.ts は、`LogRingBuffer` に積んでから、その時の書き先の `Logger.append` を呼ぶ関数を渡す（2.4 節）。 */
  writeLog(entry: LogEntry): Promise<void>;
}

/** main に 1 つ。main.ts が `Logger` を作った直後に作る（error-logging-foundation.md 2.6 節）。 */
// <!-- req errorloggingfoundation:e6bd7249.e3c1 -->
export class MainErrorLogger {
  private readonly center: NotificationCenter;

  constructor(private readonly deps: MainErrorLoggerDeps) {
    this.center = new NotificationCenter(deps.registry);
    // (1) ログの受け手：showOnScreen を見ずに、すべての記録をまずログに書く（2.4 節の「購読の順番」と同じ理由で先に登録する）。
    // <!-- req errorloggingfoundation:e6bd7249.b947 -->
    this.center.subscribe((event) => this.writeEntry(toLogEntry(event)));
  }

  /**
   * renderer の `NotificationCenter.report` と同じ形。記録を作ってログに書く。
   * @throws UnknownErrorCodeError 未登録のコード（`ErrorCodeRegistry.resolve` から。renderer と同じく開発時に気づけるようにする）。
   */
  report(code: string, context?: Record<string, unknown>): void {
    this.center.report(code, context);
  }

  /** `writeLog` に 1 行渡す。reject は受けて捨てる（2.6 節の (b)）。 */
  private writeEntry(entry: LogEntry): void {
    this.deps.writeLog(entry).catch((error: unknown) => {
      console.error('[MainErrorLogger] ログに書けませんでした:', error);
    });
  }
}
