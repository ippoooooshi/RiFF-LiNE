/**
 * main のログの結線（error-logging-foundation.md 2.4 節、B32、2026-10-29 本人決定 K1・決定 T1）。
 *
 * - 起動：主ストレージのアダプタで `Logger` を作り、`enforceQuota(DEFAULT_LOG_QUOTA_BYTES)` を 1 回呼ぶ（2.4 節の `Logger` の行・3.3 節）。
 * - 書く：`LogRingBuffer` に積んでから、その時の書き先の `Logger.append` を呼ぶ（`MainErrorLogger` の `writeLog`、2.6 節）。
 * - クラッシュ：`onCrash({reason})` を `Logger.writeCrashLog(reason, LogRingBuffer.snapshot())` へつなぐ（2.4 節のクラッシュログの結線）。
 * - 保存先を動いている途中で変えた：`shared:changed` の `storage` の知らせを受けたら、`Logger` の書き先を新しい主ストレージの
 *   アダプタ（その `logs/`）に替える（K1）。ほかの知らせでは何もしない。
 * - 終了：終了の順の最後に `Logger.flush()` を 1 回呼び、終わってからプロセスを終える（決定 T1）。
 *
 * main.ts には分かれ道を置かず（web-core-foundation.md 14.7 節）、判断はここの関数に出す。
 */

import {
  DEFAULT_LOG_QUOTA_BYTES,
  Logger,
  type LogEntry,
  type LogFileStore,
  type LoggerOptions,
} from '@riff-line/core/errors';
import type { SharedChangeNotice } from '@riff-line/shared-types';

import { LogRingBuffer } from './LogRingBuffer';

export interface MainLoggingDeps {
  /** 今の主ストレージのアダプタを引く（`storage` の知らせを受けたとき）。main.ts は `getActiveRoot` → `createForRoot` を渡す。 */
  resolvePrimaryStore(): Promise<LogFileStore>;
  /** `Logger` の選択（テストで時刻を固定する）。 */
  loggerOptions?: LoggerOptions;
}

/** main に 1 つ。main.ts の起動の手順で `MainLogging.start` から作る。 */
export class MainLogging {
  /** main の `Logger`（書き先は `storage` の知らせで替わる。インスタンスは替えない）。 */
  readonly logger: Logger;
  /** クラッシュログに添える直近の `LogEntry`（2.4 節の `LogRingBuffer` の行）。 */
  // <!-- req errorloggingfoundation:ec50c85a.07d1 -->
  readonly ring = new LogRingBuffer();

  private constructor(
    store: LogFileStore,
    private readonly deps: MainLoggingDeps,
  ) {
    this.logger = new Logger(store, deps.loggerOptions);
  }

  /** 主ストレージのアダプタで `Logger` を作り、起動時のクォータを 1 回当てる（2.4 節・3.3 節）。 */
  static async start(store: LogFileStore, deps: MainLoggingDeps): Promise<MainLogging> {
    const logging = new MainLogging(store, deps);
    // <!-- req errorloggingfoundation:f1b0b76f.2491 -->
    await logging.logger.enforceQuota(DEFAULT_LOG_QUOTA_BYTES);
    return logging;
  }

  /** ログの 1 行を書く。`LogRingBuffer` に積んでから `Logger.append` を呼ぶ（`MainErrorLogger` の `writeLog`、2.6 節）。 */
  writeLog(entry: LogEntry): Promise<void> {
    this.ring.push(entry);
    return this.logger.append(entry);
  }

  /** クラッシュログを書く。添えるのは `LogRingBuffer.snapshot()` だけ（2.4 節、2026-10-29 決定 X4）。 */
  writeCrashLog(reason: string): Promise<void> {
    // <!-- req errorloggingfoundation:ec50c85a.bccc --> <!-- req errorloggingfoundation:ec50c85a.2543 --> <!-- req errorloggingfoundation:438c1323.f87c --> <!-- req errorloggingfoundation:527c56a7.e3de -->
    return this.logger.writeCrashLog(reason, this.ring.snapshot());
  }

  /**
   * `shared:changed` の知らせを受ける（2.4 節の `Logger` の行、K1）。`storage` なら書き先を新しい主ストレージのアダプタに替える。
   * 新しい主ストレージを引けなければ、前の書き先のまま書き続ける（ログを失わないため）。
   */
  async onSharedChange(notice: SharedChangeNotice): Promise<void> {
    if (notice.kind !== 'storage') return;
    try {
      // <!-- req errorloggingfoundation:f1b0b76f.8cad --> <!-- req datamodelpersistence:0636b892.7e1a -->
      // error-logging-foundation.md 2.2 節：setStore に渡すのは新しい主ストレージの FileSystemAdapter <!-- req errorloggingfoundation:982e378a.6dbb -->
      this.logger.setStore(await this.deps.resolvePrimaryStore());
    } catch (error) {
      console.error('[MainLogging] 新しい保存先を引けなかったので、ログは前の保存先に書き続けます:', error);
    }
  }

  /** 積んだログを書き終えるまで待つ（終了の順の最後、決定 T1）。 */
  flush(): Promise<void> {
    return this.logger.flush();
  }
}

/**
 * 終了の順の最後（error-logging-foundation.md 2.4 節の `flush` の段落、決定 T1）：`Logger.flush()` を 1 回呼び、終わってから終える。
 * まだ組み立てていなければ（起動の途中）、待たずに終える。待ちが失敗しても終える。
 */
export async function flushLogsThenQuit(
  logging: Pick<MainLogging, 'flush'> | undefined,
  quit: () => void,
): Promise<void> {
  try {
    // <!-- req errorloggingfoundation:00300126.71d1 -->
    await logging?.flush();
  } catch (error) {
    console.error('[MainLogging] 終了のときにログを書き切れませんでした:', error);
  }
  // <!-- req errorloggingfoundation:00300126.0752 -->
  quit();
}
