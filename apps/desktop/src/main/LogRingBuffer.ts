/**
 * main プロセスの直近の `LogEntry` の履歴（error-logging-foundation.md 2.4 節の `LogRingBuffer` の行、B32）。
 *
 * `render-process-gone` で renderer の中の記録は失われるため、クラッシュログに添える直近の記録は main でも持つ。
 * `log:append` で届くのは renderer が組み立てた `LogEntry` なので、保持する型も `LogEntry`（2026-09-24 改訂）。
 * main で出たエラーの `LogEntry` も `MainErrorLogger` の `writeLog` でここに積む（2026-10-29 本人決定 K5）。
 * クラッシュログに添える直近の記録は、この `snapshot()` だけから取る（2026-10-29 決定 X4）。
 * 上限を超えたら古いものから捨てる（`NotificationCenter.getRecentBuffer` と同じ方式、既定 200 件）。
 */

import type { LogEntry } from '@riff-line/shared-types';

/** 既定の保持件数（error-logging-foundation.md 2.4 節「既定200件」）。 */
// <!-- req errorloggingfoundation:ec50c85a.403f -->
export const DEFAULT_LOG_RING_SIZE = 200;

// <!-- req errorloggingfoundation:ec50c85a.bc65 -->
export class LogRingBuffer {
  // <!-- req errorloggingfoundation:ec50c85a.3ae9 --> <!-- req errorloggingfoundation:29b6f717.7f3e -->
  private readonly entries: LogEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_LOG_RING_SIZE) {
    this.maxSize = Math.max(1, maxSize);
  }

  /** 1 件積む。上限を超えた分は古いものから捨てる。 */
  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) {
      // <!-- req errorloggingfoundation:ec50c85a.ae99 -->
      this.entries.splice(0, this.entries.length - this.maxSize);
    }
  }

  /** 今の保持内容を古い順の写しで返す（`Logger.writeCrashLog` の `recentBuffer`、2.4 節のクラッシュログの結線）。 */
  snapshot(): LogEntry[] {
    return this.entries.slice();
  }

  /** 保持件数。 */
  get size(): number {
    return this.entries.length;
  }
}
