/**
 * main プロセス側の直近 NotificationEvent バッファ（error-logging-foundation.md §2.3、B32）。
 *
 * レンダラーの `NotificationCenter` は `log:append` IPC でイベントを送ってくる。クラッシュ時は
 * レンダラー（と `NotificationCenter` の内部バッファ）が失われるため、クラッシュログに添える直近履歴は
 * main 側でも保持しておく必要がある。`NotificationCenter.getRecentBuffer` と同じ FIFO 上限方式。
 */

import type { NotificationEvent } from '@riff-line/shared-types';

/** 既定保持件数（`NotificationCenter` の `DEFAULT_RECENT_BUFFER_SIZE` と揃える）。 */
export const DEFAULT_LOG_RING_SIZE = 200;

export class LogRingBuffer {
  private readonly events: NotificationEvent[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_LOG_RING_SIZE) {
    this.maxSize = Math.max(1, maxSize);
  }

  /** 1 件追加する。上限超過分は古いものから捨てる。 */
  push(event: NotificationEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxSize) {
      this.events.splice(0, this.events.length - this.maxSize);
    }
  }

  /** 現在の保持内容を古い順のコピーで返す（クラッシュログ添付用）。 */
  snapshot(): NotificationEvent[] {
    return this.events.slice();
  }

  /** 保持件数。 */
  get size(): number {
    return this.events.length;
  }
}
