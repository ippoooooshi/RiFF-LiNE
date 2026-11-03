// UT-ERR-RING: LogRingBuffer（main の直近の LogEntry の履歴）
// 検証節: error-logging-foundation.md 2.4 節（LogRingBuffer の行、B32。保持する型は LogEntry・既定 200 件・push・snapshot）

import { describe, expect, it } from 'vitest';

import type { LogEntry } from '@riff-line/shared-types';

import { DEFAULT_LOG_RING_SIZE, LogRingBuffer } from './LogRingBuffer';

const entry = (code: string): LogEntry => ({
  timestamp: `t-${code}`,
  level: 'warning',
  code,
  message: 'm',
  context: {},
});

describe('LogRingBuffer', () => {
  it('LogRingBuffer_上限より少なく積む_全部を古い順に残す', () => {
    // UT-ERR-RING-01
    const ring = new LogRingBuffer(3);
    ring.push(entry('a'));
    ring.push(entry('b'));
    expect(ring.size).toBe(2);
    expect(ring.snapshot().map((e) => e.code)).toEqual(['a', 'b']);
  });

  it('LogRingBuffer_上限を超えて積む_古いものから捨てる', () => {
    // UT-ERR-RING-02
    const ring = new LogRingBuffer(2);
    ring.push(entry('a'));
    ring.push(entry('b'));
    ring.push(entry('c'));
    expect(ring.size).toBe(2);
    expect(ring.snapshot().map((e) => e.code)).toEqual(['b', 'c']);
  });

  it('LogRingBuffer_snapshotは写し_変えても中は変わらない', () => {
    // UT-ERR-RING-03
    const ring = new LogRingBuffer(5);
    ring.push(entry('a'));
    ring.snapshot().push(entry('x'));
    expect(ring.size).toBe(1);
  });

  it('LogRingBuffer_0以下の上限_1件に丸める', () => {
    // UT-ERR-RING-04
    const ring = new LogRingBuffer(0);
    ring.push(entry('a'));
    ring.push(entry('b'));
    expect(ring.snapshot().map((e) => e.code)).toEqual(['b']);
  });

  it('LogRingBuffer_既定の上限_200件で古い50件を捨てる', () => {
    // UT-ERR-RING-05 2.4 節「既定200件」
    expect(DEFAULT_LOG_RING_SIZE).toBe(200);
    const ring = new LogRingBuffer();
    for (let i = 0; i < 250; i++) ring.push(entry(String(i)));
    expect(ring.size).toBe(200);
    expect(ring.snapshot()[0]?.code).toBe('50');
    expect(ring.snapshot()[199]?.code).toBe('249');
  });

  it('LogRingBuffer_受けたLogEntryをそのまま持つ_組み立て直さない', () => {
    // UT-ERR-RING-06 2.4 節：log:append で届くのは組み立て済みの LogEntry。保持する型は LogEntry
    const ring = new LogRingBuffer();
    const received: LogEntry = { ...entry('FILE-001'), level: 'error', context: { songId: 's1' }, stack: 'Error: x' };
    ring.push(received);
    expect(ring.snapshot()).toEqual([received]);
    expect(ring.snapshot()[0]).toBe(received);
  });
});
