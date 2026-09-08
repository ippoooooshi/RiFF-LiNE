// UT-ERR-NC: error-logging-foundation.md §2.1・§3.1・§6 — NotificationCenter / toLogEntry
// 検証観点（§6 の C2 対象）:
//  - コードからレベル・チャンネルが正しく解決される（レベル×チャンネルの全組み合わせ網羅）
//  - 未登録コードで例外
//  - subscribe / 解除、購読ハンドラの例外分離
//  - getRecentBuffer（上限・maxEntries<=0・件数）
//  - LogSink への転送（成功・同期例外・reject をいずれも飲み込む）、setLogSink
//  - toLogEntry（Error/Critical のみ stack、context 透過）

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCodeRegistry } from './ErrorCodeRegistry';
import { UnknownErrorCodeError } from './errors';
import { DEFAULT_RECENT_BUFFER_SIZE, NotificationCenter, toLogEntry } from './NotificationCenter';
import type { LogEntry, LogSink, NotificationEvent } from './types';

/** レベル → 期待チャンネル（08_error_logging.md §1 の表 = LEVEL_TO_CHANNEL）。 */
const LEVEL_CHANNEL: [NotificationEvent['level'], NotificationEvent['channel']][] = [
  ['info', 'toast'],
  ['warning', 'toast'],
  ['error', 'highlight'],
  ['critical', 'modal'],
];

let registry: ErrorCodeRegistry;

beforeEach(() => {
  registry = new ErrorCodeRegistry();
  registry.register('T-INFO', { level: 'info', messageTemplate: 'info {context.x}' });
  registry.register('T-WARN', { level: 'warning', messageTemplate: 'warn' });
  registry.register('T-ERR', { level: 'error', messageTemplate: 'err' });
  registry.register('T-CRIT', { level: 'critical', messageTemplate: 'crit' });
});

describe('NotificationCenter.report — level/channel resolution (C2)', () => {
  it.each(LEVEL_CHANNEL)('report_%sCode_RoutesTo%sChannel', (level, channel) => {
    const reg = new ErrorCodeRegistry();
    reg.register('X', { level, messageTemplate: 'm' });
    const nc = new NotificationCenter(reg);
    const events: NotificationEvent[] = [];
    nc.subscribe((event) => events.push(event));

    nc.report('X');

    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe(level);
    expect(events[0]?.channel).toBe(channel);
    expect(events[0]?.code).toBe('X');
    expect(typeof events[0]?.timestamp).toBe('string');
  });

  it('report_TemplateWithContext_ExpandsMessageAndKeepsContext', () => {
    const nc = new NotificationCenter(registry);
    const events: NotificationEvent[] = [];
    nc.subscribe((event) => events.push(event));

    nc.report('T-INFO', { x: 42 });

    expect(events[0]?.message).toBe('info 42');
    expect(events[0]?.context).toEqual({ x: 42 });
  });

  it('report_NoContext_OmitsContextField', () => {
    const nc = new NotificationCenter(registry);
    let received: NotificationEvent | undefined;
    nc.subscribe((event) => (received = event));

    nc.report('T-WARN');

    expect(received).toBeDefined();
    expect('context' in (received as NotificationEvent)).toBe(false);
  });

  it('report_UnknownCode_ThrowsUnknownErrorCodeError', () => {
    const nc = new NotificationCenter(registry);
    expect(() => nc.report('NOPE')).toThrow(UnknownErrorCodeError);
  });
});

describe('NotificationCenter.subscribe', () => {
  it('subscribe_ReturnsUnsubscribe_StopsFurtherDelivery', () => {
    const nc = new NotificationCenter(registry);
    const handler = vi.fn();
    const off = nc.subscribe(handler);

    nc.report('T-WARN');
    off();
    nc.report('T-WARN');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('subscribe_OneHandlerThrows_OtherHandlersStillReceive', () => {
    const nc = new NotificationCenter(registry);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    nc.subscribe(() => {
      throw new Error('boom');
    });
    nc.subscribe(good);

    expect(() => nc.report('T-ERR')).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('NotificationCenter.getRecentBuffer', () => {
  it('getRecentBuffer_ReturnsLastNInOrder', () => {
    const nc = new NotificationCenter(registry);
    nc.report('T-INFO', { x: 1 });
    nc.report('T-WARN');
    nc.report('T-ERR');

    const last2 = nc.getRecentBuffer(2);
    expect(last2.map((e) => e.code)).toEqual(['T-WARN', 'T-ERR']);
  });

  it('getRecentBuffer_MaxEntriesZeroOrNegative_ReturnsEmpty', () => {
    const nc = new NotificationCenter(registry);
    nc.report('T-WARN');
    expect(nc.getRecentBuffer(0)).toEqual([]);
    expect(nc.getRecentBuffer(-5)).toEqual([]);
  });

  it('getRecentBuffer_ReturnsCopy_NotInternalArray', () => {
    const nc = new NotificationCenter(registry);
    nc.report('T-WARN');
    const buf = nc.getRecentBuffer(10);
    buf.push({} as NotificationEvent);
    expect(nc.getRecentBuffer(10)).toHaveLength(1);
  });

  it('report_BeyondBufferSize_EvictsOldest', () => {
    const nc = new NotificationCenter(registry, { recentBufferSize: 3 });
    for (let i = 0; i < 5; i++) nc.report('T-WARN', { i });
    const buf = nc.getRecentBuffer(100);
    expect(buf).toHaveLength(3);
    expect(buf.map((e) => e.context?.['i'])).toEqual([2, 3, 4]);
  });

  it('NotificationCenter_DefaultBufferSize_Is200', () => {
    expect(DEFAULT_RECENT_BUFFER_SIZE).toBe(200);
    const nc = new NotificationCenter(registry);
    for (let i = 0; i < 250; i++) nc.report('T-WARN');
    expect(nc.getRecentBuffer(1000)).toHaveLength(200);
  });
});

describe('NotificationCenter — LogSink wiring', () => {
  it('report_WithLogSink_AppendsConvertedEntry', () => {
    const appended: LogEntry[] = [];
    const sink: LogSink = { append: (entry) => void appended.push(entry) };
    const nc = new NotificationCenter(registry, { logSink: sink });

    nc.report('T-ERR', { songId: 's1' });

    expect(appended).toHaveLength(1);
    expect(appended[0]?.code).toBe('T-ERR');
    expect(appended[0]?.context).toEqual({ songId: 's1' });
    expect(typeof appended[0]?.stack).toBe('string'); // error レベルなので stack 付き
  });

  it('report_LogSinkThrowsSynchronously_Swallowed', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink: LogSink = {
      append: () => {
        throw new Error('disk full');
      },
    };
    const nc = new NotificationCenter(registry, { logSink: sink });
    const handler = vi.fn();
    nc.subscribe(handler);

    expect(() => nc.report('T-WARN')).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1); // ログ失敗でも購読通知は続く
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('report_LogSinkRejects_Swallowed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink: LogSink = { append: () => Promise.reject(new Error('io')) };
    const nc = new NotificationCenter(registry, { logSink: sink });

    expect(() => nc.report('T-WARN')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('setLogSink_ReplacesSink_UndefinedDisablesLogging', () => {
    const appended: LogEntry[] = [];
    const nc = new NotificationCenter(registry);
    nc.report('T-WARN'); // sink 無し = 記録なし（例外も出ない）
    expect(appended).toHaveLength(0);

    nc.setLogSink({ append: (e) => void appended.push(e) });
    nc.report('T-WARN');
    expect(appended).toHaveLength(1);

    nc.setLogSink(undefined);
    nc.report('T-WARN');
    expect(appended).toHaveLength(1);
  });
});

describe('toLogEntry', () => {
  it('toLogEntry_InfoAndWarning_NoStack', () => {
    for (const level of ['info', 'warning'] as const) {
      const entry = toLogEntry({ level, channel: 'toast', code: 'C', message: 'm', timestamp: 't' });
      expect(entry.stack).toBeUndefined();
    }
  });

  it('toLogEntry_ErrorAndCritical_HasStack', () => {
    for (const [level, channel] of [
      ['error', 'highlight'],
      ['critical', 'modal'],
    ] as const) {
      const entry = toLogEntry({ level, channel, code: 'C', message: 'm', timestamp: 't' });
      expect(typeof entry.stack).toBe('string');
    }
  });

  it('toLogEntry_PassesThroughContextWhenPresentOnly', () => {
    const withCtx = toLogEntry({
      level: 'info',
      channel: 'toast',
      code: 'C',
      message: 'm',
      timestamp: 't',
      context: { a: 1 },
    });
    expect(withCtx.context).toEqual({ a: 1 });
    const withoutCtx = toLogEntry({ level: 'info', channel: 'toast', code: 'C', message: 'm', timestamp: 't' });
    expect('context' in withoutCtx).toBe(false);
  });
});
