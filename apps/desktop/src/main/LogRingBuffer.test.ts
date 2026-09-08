// UT-ERR-RING: error-logging-foundation.md §2.3、B32 — LogRingBuffer
// 検証観点: push の上限エビクション、snapshot がコピーであること、size（C0/C1）。

import { describe, expect, it } from 'vitest';

import type { NotificationEvent } from '@riff-line/shared-types';

import { DEFAULT_LOG_RING_SIZE, LogRingBuffer } from './LogRingBuffer';

const event = (code: string): NotificationEvent => ({
  level: 'warning',
  channel: 'toast',
  code,
  message: 'm',
  timestamp: `t-${code}`,
});

describe('LogRingBuffer', () => {
  it('LogRingBuffer_PushBelowLimit_KeepsAll', () => {
    const ring = new LogRingBuffer(3);
    ring.push(event('a'));
    ring.push(event('b'));
    expect(ring.size).toBe(2);
    expect(ring.snapshot().map((e) => e.code)).toEqual(['a', 'b']);
  });

  it('LogRingBuffer_PushBeyondLimit_EvictsOldest', () => {
    const ring = new LogRingBuffer(2);
    ring.push(event('a'));
    ring.push(event('b'));
    ring.push(event('c'));
    expect(ring.size).toBe(2);
    expect(ring.snapshot().map((e) => e.code)).toEqual(['b', 'c']);
  });

  it('LogRingBuffer_Snapshot_IsCopy', () => {
    const ring = new LogRingBuffer(5);
    ring.push(event('a'));
    ring.snapshot().push(event('x'));
    expect(ring.size).toBe(1);
  });

  it('LogRingBuffer_NonPositiveMaxSize_ClampedToOne', () => {
    const ring = new LogRingBuffer(0);
    ring.push(event('a'));
    ring.push(event('b'));
    expect(ring.snapshot().map((e) => e.code)).toEqual(['b']);
  });

  it('LogRingBuffer_DefaultSize_Is200', () => {
    expect(DEFAULT_LOG_RING_SIZE).toBe(200);
    const ring = new LogRingBuffer();
    for (let i = 0; i < 250; i++) ring.push(event(String(i)));
    expect(ring.size).toBe(200);
  });
});
