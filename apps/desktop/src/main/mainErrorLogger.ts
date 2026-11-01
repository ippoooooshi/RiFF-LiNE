/**
 * main で出たエラーを main が自分でログに書く口（error-logging-foundation.md 2.4 節・2.6 節、2026-10-29 本人決定 K5）。
 *
 * main で出たエラーは renderer を通さない。中に renderer と同じクラスの `NotificationCenter` を 1 つ持ち（renderer の共有
 * シングルトンとは別のインスタンス）、記録の組み立ては Webコアの `NotificationCenter` と `toLogEntry` に任せる。main は書くだけを
 * 受け持つ（組み立ての決まりは Webコアの 1 か所のまま、基本設計 08 章 1.1 節との両立の読みは 2.6 節）。
 * 読み込む入口は `@riff-line/core/errors` だけ（alphaTab を引き込まない細い入口、2.6 節）。
 *
 * 中の `NotificationCenter` には受け手を 2 つ、この順で登録する（2.6 節）。
 * (1) ログの受け手：`showOnScreen` を見ずに `toLogEntry(event)` で組み立てた `LogEntry` を `writeLog` に渡す。
 *     `writeLog` が reject しても、ここで受けて捨てる（コンソールにだけ出す。2.6 節の (b)：受けずに置くと unhandledRejection の
 *     繰り返しになるため）。
 * (2) 送る受け手：`showOnScreen` が真の記録だけを、`NotificationEvent` のまま `notify:fromMain` で `targetWindows()` の窓の全部へ送る。
 *     送れない窓は飛ばし、`send` が投げたら捨てて次の窓へ進む。窓が 1 枚も無いときは送らずにログにだけ書く。
 *
 * `registerMainUncaughtHandlers` は `process` の `uncaughtException`・`unhandledRejection` を `SYS-005` で記録する（2.6 節）。
 * `main.ts` が `Logger` を作る前に投げた例外は受けず、Electron の既定の扱いになる（2.6 節の (b)）。
 */

// <!-- req errorloggingfoundation:3114ff19.fde2 -->
import type { BrowserWindow } from 'electron';

// <!-- req errorloggingfoundation:21d65ed0.20f4 -->
// <!-- req errorloggingfoundation:5fcacc0c.e190 -->
// <!-- req errorloggingfoundation:5fcacc0c.cd99 -->
// <!-- req errorloggingfoundation:5fcacc0c.e820 -->
// <!-- req errorloggingfoundation:5fcacc0c.e3d0 -->
import { NotificationCenter, toLogEntry, type ErrorCodeRegistry, type LogEntry } from '@riff-line/core/errors';
import { NOTIFY_CHANNELS, type NotificationEvent } from '@riff-line/shared-types';

import { sendToWindows } from './ipc';

// <!-- req errorloggingfoundation:975ee1ee.f3b9 -->
export interface MainErrorLoggerDeps {
  /** 記録を組み立てる登録簿。main.ts は `@riff-line/core/errors` の `errorCodeRegistry`（4 節のコードを登録済み）を渡す。 */
  // <!-- req errorloggingfoundation:493f48fe.25c1 -->
  registry: ErrorCodeRegistry;
  /** ログの 1 行を書く。main.ts は、`LogRingBuffer` に積んでから、その時の書き先の `Logger.append` を呼ぶ関数を渡す（2.4 節）。 */
  // <!-- req errorloggingfoundation:b7fb4eb6.ff12 -->
  writeLog(entry: LogEntry): Promise<void>;
  /** 知らせを送る先。main.ts は `WindowManager` が持つ曲一覧ウィンドウと編集ウィンドウを渡す（印刷用の見えないウィンドウは入れない）。 */
  // <!-- req errorloggingfoundation:992db9e5.656a -->
  targetWindows(): readonly BrowserWindow[];
}

/** main に 1 つ。main.ts が `Logger` を作った直後に作る（error-logging-foundation.md 2.6 節）。 */
// <!-- req errorloggingfoundation:e6bd7249.e3c1 -->
// <!-- req errorloggingfoundation:14eaf20a.ed41 -->
// <!-- req errorloggingfoundation:3bb8948d.bdcf -->
// <!-- req errorloggingfoundation:90453047.a783 -->
// <!-- req errorloggingfoundation:f784b298.ed41 -->
export class MainErrorLogger {
  private readonly center: NotificationCenter;

  // <!-- req errorloggingfoundation:6ce8bf80.3991 -->
  constructor(private readonly deps: MainErrorLoggerDeps) {
    // <!-- req errorloggingfoundation:21d65ed0.04bc -->
    // <!-- req errorloggingfoundation:0d1a1939.84a8 -->
    // <!-- req errorloggingfoundation:0d1a1939.8cb4 -->
    // <!-- req errorloggingfoundation:0d1a1939.681b -->
    // <!-- req errorloggingfoundation:0d1a1939.5ff4 -->
    // <!-- req errorloggingfoundation:0d1a1939.3839 -->
    this.center = new NotificationCenter(deps.registry);
    // (1) ログの受け手：showOnScreen を見ずに、すべての記録をまずログに書く（2.4 節の「購読の順番」と同じ理由で先に登録する）。
    // <!-- req errorloggingfoundation:e6bd7249.b947 -->
    // <!-- req errorloggingfoundation:14eaf20a.64ec -->
    // <!-- req errorloggingfoundation:21d65ed0.9679 -->
    // <!-- req errorloggingfoundation:21d65ed0.c457 -->
    // <!-- req errorloggingfoundation:0d1a1939.5d0e -->
    // <!-- req errorloggingfoundation:0d1a1939.55a2 -->
    // <!-- req errorloggingfoundation:0d1a1939.7d5d -->
    // <!-- req errorloggingfoundation:0d1a1939.abe8 -->
    // <!-- req errorloggingfoundation:ee7799c4.a683 -->
    // <!-- req errorloggingfoundation:ee7799c4.dba9 -->
    // <!-- req 00:bf061284.9d1d -->
    // <!-- req errorloggingfoundation:e6bd7249.48d2 -->
    // <!-- req webcorefoundation:ec378e6a.4de6 -->
    // <!-- req webcorefoundation:ec378e6a.5ace -->
    // <!-- req errorloggingfoundation:f784b298.64ec -->
    this.center.subscribe((event) => this.writeEntry(toLogEntry(event)));
    // (2) 送る受け手：画面に出す記録だけを、開いている窓の全部へ送る（2.6 節）。ログは (1) で 1 回だけ書いてある。
    this.center.subscribe((event) => {
      // <!-- req errorloggingfoundation:0d1a1939.309e -->
      // <!-- req errorloggingfoundation:7da05550.4b8f -->
      // <!-- req datamodelpersistence:ef984f9d.db6f -->
      // <!-- req errorloggingfoundation:e6bd7249.d754 -->
      // <!-- req errorloggingfoundation:a955fbc5.f6a5 -->
      // <!-- req datamodelpersistence:779b936e.db6f -->
      if (event.showOnScreen) this.sendToWindows(event);
    });
  }

  /**
   * renderer の `NotificationCenter.report` と同じ形。記録を作ってログに書き、`showOnScreen` が真なら `notify:fromMain` で送る。
   * @throws UnknownErrorCodeError 未登録のコード（`ErrorCodeRegistry.resolve` から。renderer と同じく開発時に気づけるようにする）。
   */
  // <!-- req errorloggingfoundation:03d876ac.9aa2 -->
  report(code: string, context?: Record<string, unknown>): void {
    this.center.report(code, context);
  }

  /** `writeLog` に 1 行渡す。reject は受けて捨てる（2.6 節の (b)）。 */
  private writeEntry(entry: LogEntry): void {
    // <!-- req errorloggingfoundation:21d65ed0.8cc8 -->
    // <!-- req errorloggingfoundation:0d1a1939.7e67 -->
    // <!-- req errorloggingfoundation:c672f2ef.0af9 -->
    // <!-- req errorloggingfoundation:c672f2ef.b8a2 -->
    // <!-- req errorloggingfoundation:e6bd7249.3880 -->
    // <!-- req errorloggingfoundation:8fcec46d.1280 -->
    // <!-- req errorloggingfoundation:8fcec46d.b8a2 -->
    this.deps.writeLog(entry).catch((error: unknown) => {
      // <!-- req errorloggingfoundation:c672f2ef.2da5 -->
      // <!-- req errorloggingfoundation:8fcec46d.332c -->
      console.error('[MainErrorLogger] ログに書けませんでした:', error);
    });
  }

  /** 記録を `NotificationEvent` のまま `notify:fromMain` で窓の全部へ送る（窓が無ければ何も送らない、2.6 節の (b)）。 */
  // <!-- req errorloggingfoundation:0d1a1939.b0d5 -->
  // <!-- req 00:bf061284.9004 -->
  // <!-- req errorloggingfoundation:a955fbc5.2f2e -->
  private sendToWindows(event: NotificationEvent): void {
    // <!-- req errorloggingfoundation:14eaf20a.8709 -->
    // <!-- req errorloggingfoundation:0d1a1939.554b -->
    // <!-- req errorloggingfoundation:0d1a1939.0741 -->
    // <!-- req errorloggingfoundation:e6bd7249.6b84 -->
    // <!-- req errorloggingfoundation:a955fbc5.e2f8 -->
    // <!-- req webcorefoundation:f67c02df.b9a8 -->
    // <!-- req webcorefoundation:ec378e6a.a1a4 -->
    // <!-- req errorloggingfoundation:f784b298.8709 -->
    sendToWindows(this.deps.targetWindows(), NOTIFY_CHANNELS.fromMain, event);
  }
}

/** main の未捕捉の例外の `SYS-005` の `kind`（renderer の `'error'`・`'unhandledrejection'` と見分ける、2.6 節）。 */
// <!-- req errorloggingfoundation:7da05550.a31b -->
// <!-- req 00:bf061284.976f -->
type MainUncaughtKind = 'main-uncaughtException' | 'main-unhandledRejection';

/**
 * `MainErrorLogger` を作った直後に 1 回呼び、`process` の `uncaughtException` と `unhandledRejection` を登録する。戻り値で外す
 * （error-logging-foundation.md 2.6 節）。受けたら `logger.report('SYS-005', { kind, error })` を 1 回呼び、main は止めずに動かし続ける。
 */
// <!-- req errorloggingfoundation:14eaf20a.270b -->
// <!-- req errorloggingfoundation:14eaf20a.ce78 -->
// <!-- req errorloggingfoundation:14eaf20a.7754 -->
// <!-- req errorloggingfoundation:9d24af3d.3648 -->
// <!-- req errorloggingfoundation:f784b298.270b -->
// <!-- req errorloggingfoundation:f784b298.ce78 -->
// <!-- req errorloggingfoundation:f784b298.7754 -->
export function registerMainUncaughtHandlers(logger: MainErrorLogger): () => void {
  // <!-- req errorloggingfoundation:7da05550.e938 -->
  // <!-- req 00:bf061284.2aa6 -->
  // <!-- req errorloggingfoundation:3680e262.3a3f -->
  const onUncaughtException = (error: unknown): void => reportMainUncaught(logger, 'main-uncaughtException', error);
  // <!-- req errorloggingfoundation:7da05550.d0ff -->
  // <!-- req 00:bf061284.053c -->
  // <!-- req errorloggingfoundation:3680e262.e720 -->
  const onUnhandledRejection = (reason: unknown): void => reportMainUncaught(logger, 'main-unhandledRejection', reason);
  // <!-- req errorloggingfoundation:14eaf20a.3c8d -->
  // <!-- req errorloggingfoundation:f61c32f7.cddc -->
  // <!-- req 00:bf061284.ac13 -->
  // <!-- req errorloggingfoundation:3680e262.7f14 -->
  // <!-- req webcorefoundation:ec378e6a.217c -->
  // <!-- req errorloggingfoundation:f784b298.3c8d -->
  process.on('uncaughtException', onUncaughtException);
  // <!-- req errorloggingfoundation:14eaf20a.3972 -->
  // <!-- req 00:bf061284.5fe5 -->
  // <!-- req errorloggingfoundation:3680e262.ab30 -->
  // <!-- req webcorefoundation:ec378e6a.9a38 -->
  // <!-- req errorloggingfoundation:f784b298.3972 -->
  process.on('unhandledRejection', onUnhandledRejection);
  return () => {
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
  };
}

/**
 * 受け口の中身。`Error` でなければ `new Error(String(reason))` に包む（`stack` は 2.2 節の決まりどおり `context.error` から取る）。
 * 中の処理は `try` で包み、中で投げたものは捨てる（受け口の中の例外で main が終わらないようにするため、2.6 節の (b)）。
 */
function reportMainUncaught(logger: MainErrorLogger, kind: MainUncaughtKind, reason: unknown): void {
  // <!-- req errorloggingfoundation:f61c32f7.e22a -->
  try {
    // <!-- req errorloggingfoundation:7da05550.faa3 -->
    const error = reason instanceof Error ? reason : new Error(String(reason));
    // <!-- req errorloggingfoundation:7da05550.fe37 -->
    // <!-- req errorloggingfoundation:7da05550.0822 -->
    // <!-- req errorloggingfoundation:7da05550.7cb8 -->
    // <!-- req 00:bf061284.bc11 -->
    // <!-- req 00:bf061284.47b2 -->
    // <!-- req 00:bf061284.6cfe -->
    // <!-- req errorloggingfoundation:3680e262.2b04 -->
    // <!-- req webcorefoundation:ec378e6a.c5bf -->
    logger.report('SYS-005', { kind, error });
    // <!-- req errorloggingfoundation:f61c32f7.fb85 -->
  } catch (handlerError) {
    console.error('[MainErrorLogger] 未捕捉の例外を記録できませんでした:', handlerError);
  }
}

/**
 * `MainErrorLogger` より先にできる部品（main.ts の `ElectronFileSystemAdapterFactory` が出す `FILE-003`）に渡す `report`。
 * 呼ばれたときに `getLogger()` で `MainErrorLogger` を引いて、その `report` に code と context のまま渡す（error-logging-foundation.md
 * 2.6 節：main で出たエラーは `MainErrorLogger` の口で出す。共有の `notificationCenter` を経て渡し直す口は置かない、
 * data-model-persistence.md 14.1 節の (b)、honnin-queue 228 番）。
 * まだ作っていないとき（`Logger` を作る前）は記録せず、コードだけをコンソールに出す（2.6 節の (b)：ログを書く先が決まる前で、書く手段が無いため）。
 */
export function reportThroughMainErrorLogger(
  getLogger: () => Pick<MainErrorLogger, 'report'> | undefined,
): (code: string, context?: Record<string, unknown>) => void {
  return (code, context) => {
    const logger = getLogger();
    if (logger === undefined) {
      console.error(`[MainErrorLogger] 作る前に出た記録はログに書けません: ${code}`);
      return;
    }
    logger.report(code, context);
  };
}
