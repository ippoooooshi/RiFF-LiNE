// UT-ERR-NC: error-logging-foundation.md 2.1 節・2.2 節・3.1 節・6 節 — NotificationCenter / toLogEntry <!-- req webcorefoundation:7c43fb53.6e3f -->
// 検証観点（6 節の C2 対象）:
//  - コードからレベル・チャンネルが正しく解決される（レベル×チャンネルの全組み合わせ網羅）
//  - 未登録コードで例外
//  - subscribe / 解除、購読ハンドラの例外分離、登録順に配る（ログの受け手が先）
//  - showOnScreen（省略時 true・false でもログの受け手には届く）、Critical の title／buttons
//  - stack の取り方（Error／Critical だけ。context.error の stack か report() を呼んだ地点）
//  - relay（作り直さずに配る・{ relayed: false } の受け手を飛ばす・直近バッファと LogSink に積まない）
//  - getRecentBuffer（上限・maxEntries<=0・件数）
//  - LogSink への転送（成功・同期例外・reject をいずれも飲み込む）、setLogSink
//  - toLogEntry（stack を写すだけ、context 透過、context.error を { name, message } に置き換え）

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCodeRegistry } from './ErrorCodeRegistry';
import { UnknownErrorCodeError } from './errors';
import { DEFAULT_RECENT_BUFFER_SIZE, NotificationCenter, toLogEntry } from './NotificationCenter';
import type { LogEntry, LogSink, NotificationEvent } from './types';

/** レベル → 期待チャンネル（08_error_logging.md 1 節の表 = LEVEL_TO_CHANNEL）。 */
const LEVEL_CHANNEL: [NotificationEvent['level'], NotificationEvent['channel']][] = [
  ['info', 'toast'],
  ['warning', 'toast'],
  ['error', 'highlight'],
  ['critical', 'modal'],
];

let registry: ErrorCodeRegistry;

beforeEach(() => {
  registry = new ErrorCodeRegistry();
  registry.register('EDIT-901', { level: 'info', messageTemplate: 'info {context.x}' });
  registry.register('EDIT-902', { level: 'warning', messageTemplate: 'warn' });
  registry.register('EDIT-903', { level: 'error', messageTemplate: 'err' });
  registry.register('EDIT-904', {
    level: 'critical',
    title: '見出し',
    messageTemplate: 'crit',
    buttons: { confirm: '復元する', cancel: 'キャンセル' },
  });
  registry.register('EDIT-905', {
    level: 'error',
    messageTemplate: 'hidden',
    showOnScreen: false,
    logOnlyReason: '代わりの画面が知らせるため',
  });
});

/** 記録を集める受け手を登録して、その配列を返す。 */
function collect(nc: NotificationCenter, options?: { relayed?: boolean }): NotificationEvent[] {
  const events: NotificationEvent[] = [];
  nc.subscribe((event) => events.push(event), options);
  return events;
}

/** main から届いた記録の見本（relay 用）。 */
const relayedEvent: NotificationEvent = {
  level: 'warning',
  channel: 'toast',
  code: 'FILE-005',
  message: 'ミラー先への保存に失敗しました（主保存は正常です）',
  timestamp: '2026-11-01T00:00:00.000Z',
  showOnScreen: true,
};

// <!-- req errorloggingfoundation:c25652e9.3645 -->
// <!-- req errorloggingfoundation:c25652e9.ccb7 -->
// <!-- req errorloggingfoundation:c25652e9.10ef -->
describe('NotificationCenter.report — level/channel resolution (C2)', () => {
  // <!-- req errorloggingfoundation:c25652e9.95ee -->
  // <!-- req errorloggingfoundation:c25652e9.8744 -->
  // <!-- req errorloggingfoundation:c25652e9.d9bd -->
  it.each(LEVEL_CHANNEL)('report_%sCode_RoutesTo%sChannel', (level, channel) => {
    const reg = new ErrorCodeRegistry();
    // Critical は型で title と buttons を省けない（2.1 節）
    reg.register(
      'SYS-900',
      level === 'critical'
        ? { level, title: 't', messageTemplate: 'm', buttons: { confirm: '閉じる' } }
        : { level, messageTemplate: 'm' },
    );
    const nc = new NotificationCenter(reg);
    const events = collect(nc);

    nc.report('SYS-900');

    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe(level);
    expect(events[0]?.channel).toBe(channel);
    expect(events[0]?.code).toBe('SYS-900');
    expect(typeof events[0]?.timestamp).toBe('string');
  });

  it('report_TemplateWithContext_ExpandsMessageAndKeepsContext', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);

    nc.report('EDIT-901', { x: 42 });

    expect(events[0]?.message).toBe('info 42');
    expect(events[0]?.context).toEqual({ x: 42 });
  });

  it('report_NoContext_OmitsContextField', () => {
    const nc = new NotificationCenter(registry);
    let received: NotificationEvent | undefined;
    nc.subscribe((event) => (received = event));

    nc.report('EDIT-902');

    expect(received).toBeDefined();
    expect('context' in (received as NotificationEvent)).toBe(false);
  });

  // <!-- req errorloggingfoundation:c25652e9.4732 -->
  it('report_UnknownCode_ThrowsUnknownErrorCodeError', () => {
    const nc = new NotificationCenter(registry);
    expect(() => nc.report('EDIT-999')).toThrow(UnknownErrorCodeError);
  });

  // <!-- req errorloggingfoundation:6f5772e1.9bbf -->
  // <!-- req errorloggingfoundation:6f5772e1.272c -->
  // <!-- req errorloggingfoundation:6f5772e1.ef0c -->
  // <!-- req errorloggingfoundation:6f5772e1.4d24 -->
  // <!-- req errorloggingfoundation:6f5772e1.f5f3 -->
  // <!-- req errorloggingfoundation:6f5772e1.b955 -->
  // <!-- req errorloggingfoundation:6f5772e1.91c5 -->
  it('report_WithoutWindowAndDocument_RoutesAndLogsAllFourLevels', () => {
    // UT-ERR-NC-01 6 節（2026-10-14 追加）：Webコアの中の純粋なロジックで、DOM の API に依存しない。
    // DOM の入口（window・document）を消しても、4 つのレベルのそれぞれで振り分けとログの記録ができること
    // （Electron の import は eslint.config.js の no-restricted-imports が packages/core で止める）
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    try {
      const append = vi.fn();
      const nc = new NotificationCenter(registry, { logSink: { append } });
      const events = collect(nc);

      nc.report('EDIT-901', { x: 1 });
      nc.report('EDIT-902');
      nc.report('EDIT-903');
      nc.report('EDIT-904');

      expect(events.map((event) => [event.level, event.channel])).toEqual(LEVEL_CHANNEL);
      expect(append.mock.calls.map(([entry]) => [(entry as LogEntry).code, (entry as LogEntry).level])).toEqual([
        ['EDIT-901', 'info'],
        ['EDIT-902', 'warning'],
        ['EDIT-903', 'error'],
        ['EDIT-904', 'critical'],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// <!-- req errorloggingfoundation:e47e4e60.9e03 -->
// <!-- req errorloggingfoundation:e47e4e60.0e1c -->
describe('NotificationCenter.report — showOnScreen / title / buttons（2.1 節）', () => {
  // <!-- req errorloggingfoundation:e47e4e60.a218 -->
  it('report_ShowOnScreenOmitted_EventShowOnScreenTrue', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);

    nc.report('EDIT-903');

    expect(events[0]?.showOnScreen).toBe(true);
  });

  // <!-- req errorloggingfoundation:e47e4e60.163d -->
  // <!-- req errorloggingfoundation:e47e4e60.bfc1 -->
  // <!-- req errorloggingfoundation:e47e4e60.c68b -->
  it('report_ShowOnScreenFalse_EventShowOnScreenFalseAndLogReceiverStillGetsIt', () => {
    const appended: LogEntry[] = [];
    const nc = new NotificationCenter(registry, { logSink: { append: (entry) => void appended.push(entry) } });
    const events = collect(nc);

    nc.report('EDIT-905');

    expect(events[0]?.showOnScreen).toBe(false);
    // ログの受け手は showOnScreen を見ずに受け取る（直近バッファと LogSink の両方）
    expect(appended.map((entry) => entry.code)).toEqual(['EDIT-905']);
    expect(nc.getRecentBuffer(10).map((event) => event.code)).toEqual(['EDIT-905']);
  });

  it('report_ShowOnScreenFalseWithSetLogSinkMock_MockReceivesEntry', () => {
    // UT-ERR-NC-02 6 節（2026-09-24 追加）：showOnScreen: false の定義でも、setLogSink で渡したログの受け手に記録が届く
    const append = vi.fn<(entry: LogEntry) => Promise<void>>().mockResolvedValue(undefined);
    const nc = new NotificationCenter(registry);
    nc.setLogSink({ append });
    const events = collect(nc);

    nc.report('EDIT-905');

    expect(events[0]?.showOnScreen).toBe(false);
    expect(append).toHaveBeenCalledTimes(1);
    const [entry] = append.mock.calls[0]!;
    expect(entry).toMatchObject({ level: 'error', code: 'EDIT-905', message: 'hidden' });
  });

  it('report_CriticalWithTitleAndButtons_EventCarriesThem', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);

    nc.report('EDIT-904');

    expect(events[0]?.title).toBe('見出し');
    expect(events[0]?.buttons).toEqual({ confirm: '復元する', cancel: 'キャンセル' });
    expect(events[0]?.message).toBe('crit');
  });

  it('report_DefinitionWithoutTitleAndButtons_EventOmitsThem', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);

    nc.report('EDIT-903');

    expect('title' in (events[0] as NotificationEvent)).toBe(false);
    expect('buttons' in (events[0] as NotificationEvent)).toBe(false);
  });
});

describe('NotificationCenter.report — stack の取り方（2.2 節）', () => {
  it('report_ErrorWithContextError_UsesThatErrorsStack', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);
    const cause = new Error('thrown at the source');

    nc.report('EDIT-903', { error: cause });

    expect(events[0]?.stack).toBe(cause.stack);
  });

  it('report_CriticalWithContextError_UsesThatErrorsStack', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);
    const cause = new Error('critical cause');

    nc.report('EDIT-904', { error: cause });

    expect(events[0]?.stack).toBe(cause.stack);
  });

  it('report_ErrorWithoutContextError_TakesStackAtReportCaller', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);

    nc.report('EDIT-903', { songId: 's1' });

    // report() の中で取るので、呼んだ地点（このテストのファイル）が載る
    expect(events[0]?.stack).toContain('NotificationCenter.test.ts');
    expect(events[0]?.stack).toContain('EDIT-903');
  });

  it('report_ErrorWithoutContext_TakesStackAtReportCaller', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);

    nc.report('EDIT-903');

    expect(events[0]?.stack).toContain('NotificationCenter.test.ts');
  });

  it('report_ErrorWithNonErrorContextError_TakesStackAtReportCaller', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);

    nc.report('EDIT-903', { error: 'not an Error' });

    expect(events[0]?.stack).toContain('NotificationCenter.test.ts');
  });

  it('report_ContextErrorWithoutStack_EventHasNoStack', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);
    const cause = new Error('no stack');
    cause.stack = undefined;

    nc.report('EDIT-903', { error: cause });

    expect('stack' in (events[0] as NotificationEvent)).toBe(false);
  });

  it('report_InfoAndWarning_NoStackEvenWithContextError', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);

    nc.report('EDIT-901', { error: new Error('x') });
    nc.report('EDIT-902', { error: new Error('y') });

    expect(events.map((event) => event.stack)).toEqual([undefined, undefined]);
  });
});

describe('NotificationCenter.subscribe', () => {
  it('subscribe_ReturnsUnsubscribe_StopsFurtherDelivery', () => {
    const nc = new NotificationCenter(registry);
    const handler = vi.fn();
    const off = nc.subscribe(handler);

    nc.report('EDIT-902');
    off();
    nc.report('EDIT-902');

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

    expect(() => nc.report('EDIT-903')).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('report_DeliversInRegistrationOrder_LogReceiverFirst', () => {
    const order: string[] = [];
    const nc = new NotificationCenter(registry, { logSink: { append: () => void order.push('log') } });
    nc.subscribe(() => order.push('first'));
    nc.subscribe(() => order.push('second'));

    nc.report('EDIT-902');

    expect(order).toEqual(['log', 'first', 'second']);
  });

  it('report_SameEventObjectToAllReceivers', () => {
    const nc = new NotificationCenter(registry);
    const a = collect(nc);
    const b = collect(nc, { relayed: false });

    nc.report('EDIT-902');

    expect(a).toHaveLength(1);
    expect(b[0]).toBe(a[0]);
    expect(nc.getRecentBuffer(1)[0]).toBe(a[0]);
  });
});

describe('NotificationCenter.relay（2.1 節・2.6 節）', () => {
  it('relay_DeliversEventAsIsToDefaultSubscribers', () => {
    const nc = new NotificationCenter(registry);
    const events = collect(nc);
    const explicit = collect(nc, { relayed: true });

    nc.relay(relayedEvent);

    expect(events).toEqual([relayedEvent]);
    expect(events[0]).toBe(relayedEvent); // 作り直さない
    expect(explicit[0]).toBe(relayedEvent);
  });

  it('relay_SkipsSubscribersRegisteredWithRelayedFalse', () => {
    const nc = new NotificationCenter(registry);
    const logForward = collect(nc, { relayed: false });
    const ui = collect(nc);

    nc.relay(relayedEvent);

    expect(logForward).toEqual([]);
    expect(ui).toHaveLength(1);
  });

  it('relay_DoesNotPushRecentBufferNorLogSink', () => {
    const append = vi.fn();
    const nc = new NotificationCenter(registry, { logSink: { append } });

    nc.relay(relayedEvent);

    expect(nc.getRecentBuffer(10)).toEqual([]);
    expect(append).not.toHaveBeenCalled();
  });

  it('subscribe_RelayedFalse_StillReceivesReport', () => {
    const nc = new NotificationCenter(registry);
    const logForward = collect(nc, { relayed: false });

    nc.report('EDIT-902');

    expect(logForward.map((event) => event.code)).toEqual(['EDIT-902']);
  });

  it('relay_SubscriberThrows_OthersStillReceive', () => {
    const nc = new NotificationCenter(registry);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    nc.subscribe(() => {
      throw new Error('boom');
    });
    const ui = collect(nc);

    expect(() => nc.relay(relayedEvent)).not.toThrow();
    expect(ui).toHaveLength(1);
    consoleError.mockRestore();
  });
});

describe('NotificationCenter.getRecentBuffer', () => {
  it('getRecentBuffer_ReturnsLastNInOrder', () => {
    const nc = new NotificationCenter(registry);
    nc.report('EDIT-901', { x: 1 });
    nc.report('EDIT-902');
    nc.report('EDIT-903');

    const last2 = nc.getRecentBuffer(2);
    expect(last2.map((e) => e.code)).toEqual(['EDIT-902', 'EDIT-903']);
  });

  it('getRecentBuffer_MaxEntriesZeroOrNegative_ReturnsEmpty', () => {
    const nc = new NotificationCenter(registry);
    nc.report('EDIT-902');
    expect(nc.getRecentBuffer(0)).toEqual([]);
    expect(nc.getRecentBuffer(-5)).toEqual([]);
  });

  it('getRecentBuffer_ReturnsCopy_NotInternalArray', () => {
    const nc = new NotificationCenter(registry);
    nc.report('EDIT-902');
    const buf = nc.getRecentBuffer(10);
    buf.push({} as NotificationEvent);
    expect(nc.getRecentBuffer(10)).toHaveLength(1);
  });

  it('report_BeyondBufferSize_EvictsOldest', () => {
    const nc = new NotificationCenter(registry, { recentBufferSize: 3 });
    for (let i = 0; i < 5; i++) nc.report('EDIT-902', { i });
    const buf = nc.getRecentBuffer(100);
    expect(buf).toHaveLength(3);
    expect(buf.map((e) => e.context?.['i'])).toEqual([2, 3, 4]);
  });

  it('NotificationCenter_DefaultBufferSize_Is200', () => {
    expect(DEFAULT_RECENT_BUFFER_SIZE).toBe(200);
    const nc = new NotificationCenter(registry);
    for (let i = 0; i < 250; i++) nc.report('EDIT-902');
    expect(nc.getRecentBuffer(1000)).toHaveLength(200);
  });
});

describe('NotificationCenter — LogSink wiring', () => {
  it('report_WithLogSink_AppendsConvertedEntry', () => {
    const appended: LogEntry[] = [];
    const sink: LogSink = { append: (entry) => void appended.push(entry) };
    const nc = new NotificationCenter(registry, { logSink: sink });

    nc.report('EDIT-903', { songId: 's1' });

    expect(appended).toHaveLength(1);
    expect(appended[0]?.code).toBe('EDIT-903');
    expect(appended[0]?.context).toEqual({ songId: 's1' });
    expect(typeof appended[0]?.stack).toBe('string'); // error レベルなので stack 付き
  });

  // <!-- req errorloggingfoundation:98ae74bf.9582 -->
  // <!-- req errorloggingfoundation:98ae74bf.45eb -->
  // <!-- req errorloggingfoundation:98ae74bf.4a91 -->
  // <!-- req errorloggingfoundation:98ae74bf.2c96 -->
  // <!-- req errorloggingfoundation:98ae74bf.4f25 -->
  // <!-- req errorloggingfoundation:98ae74bf.a5f9 -->
  // <!-- req errorloggingfoundation:98ae74bf.b329 -->
  // <!-- req errorloggingfoundation:98ae74bf.18b6 -->
  it('report_SetLogSinkWithMockLogger_LogEntryHasAllFields', () => {
    // 6 節の最後の観点：report() から toLogEntry を通したログの中身を、setLogSink に渡したモックで確かめる
    const append = vi.fn<(entry: LogEntry) => Promise<void>>().mockResolvedValue(undefined);
    const nc = new NotificationCenter(registry);
    nc.setLogSink({ append });
    const events = collect(nc);
    const cause = new TypeError('bad value');

    nc.report('EDIT-903', { songId: 's1', barIndex: 3, error: cause });
    nc.report('EDIT-902', { songId: 's1' });

    const [errorEntry] = append.mock.calls[0]!;
    expect(errorEntry).toEqual({
      timestamp: events[0]?.timestamp,
      level: 'error',
      code: 'EDIT-903',
      message: 'err',
      context: { songId: 's1', barIndex: 3, error: { name: 'TypeError', message: 'bad value' } },
      stack: cause.stack,
    });
    const [warningEntry] = append.mock.calls[1]!;
    expect('stack' in warningEntry).toBe(false);
  });

  // <!-- req errorloggingfoundation:98ae74bf.0532 -->
  it('report_CriticalWithContextErrorViaSetLogSink_LogEntryStackIsThatErrorsStack', () => {
    // UT-ERR-NC-03 6 節（2026-09-24 追加）：Critical のときもログの記録に stack が載る。setLogSink に渡したモックで確かめる
    const append = vi.fn<(entry: LogEntry) => Promise<void>>().mockResolvedValue(undefined);
    const nc = new NotificationCenter(registry);
    nc.setLogSink({ append });
    const cause = new Error('corrupted');

    nc.report('EDIT-904', { error: cause });

    expect(append).toHaveBeenCalledTimes(1);
    const [entry] = append.mock.calls[0]!;
    expect(entry.level).toBe('critical');
    expect(entry.code).toBe('EDIT-904');
    expect(typeof cause.stack).toBe('string');
    expect(entry.stack).toBe(cause.stack);
  });

  it('report_WithoutContext_LogEntryHasEmptyContext', () => {
    // 2.2 節の LogEntry の表で `?` が付くのは stack だけ。context を渡さない report() でもログの行は context: {} を持つ
    const append = vi.fn<(entry: LogEntry) => Promise<void>>().mockResolvedValue(undefined);
    const nc = new NotificationCenter(registry);
    nc.setLogSink({ append });
    const events = collect(nc);

    nc.report('EDIT-902');

    const [entry] = append.mock.calls[0]!;
    expect(entry).toEqual({
      timestamp: events[0]?.timestamp,
      level: 'warning',
      code: 'EDIT-902',
      message: 'warn',
      context: {},
    });
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

    expect(() => nc.report('EDIT-902')).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1); // ログ失敗でも購読通知は続く
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('report_LogSinkRejects_Swallowed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink: LogSink = { append: () => Promise.reject(new Error('io')) };
    const nc = new NotificationCenter(registry, { logSink: sink });

    expect(() => nc.report('EDIT-902')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('setLogSink_ReplacesSink_UndefinedDisablesLogging', () => {
    const appended: LogEntry[] = [];
    const nc = new NotificationCenter(registry);
    nc.report('EDIT-902'); // sink 無し = 記録なし（例外も出ない）
    expect(appended).toHaveLength(0);

    nc.setLogSink({ append: (e) => void appended.push(e) });
    nc.report('EDIT-902');
    expect(appended).toHaveLength(1);

    nc.setLogSink(undefined);
    nc.report('EDIT-902');
    expect(appended).toHaveLength(1);
  });
});

describe('toLogEntry', () => {
  const base = { code: 'C', message: 'm', timestamp: 't', showOnScreen: true } as const;

  it('toLogEntry_InfoAndWarning_NoStack', () => {
    for (const level of ['info', 'warning'] as const) {
      const entry = toLogEntry({ ...base, level, channel: 'toast' });
      expect('stack' in entry).toBe(false);
    }
  });

  it('toLogEntry_ErrorAndCritical_HasStack', () => {
    // stack は report() が記録に載せた値を写すだけ（toLogEntry の中では取らない、2.2 節）
    for (const [level, channel] of [
      ['error', 'highlight'],
      ['critical', 'modal'],
    ] as const) {
      const entry = toLogEntry({ ...base, level, channel, stack: `stack-of-${level}` });
      expect(entry.stack).toBe(`stack-of-${level}`);
    }
  });

  it('toLogEntry_EventWithoutStack_DoesNotSynthesizeOne', () => {
    const entry = toLogEntry({ ...base, level: 'error', channel: 'highlight' });
    expect('stack' in entry).toBe(false);
  });

  it('toLogEntry_PassesThroughContext_EmptyObjectWhenAbsent', () => {
    // 2.2 節の LogEntry の表：context は省略できない（`?` は stack だけ）。記録に context が無ければ {}
    const withCtx = toLogEntry({ ...base, level: 'info', channel: 'toast', context: { a: 1 } });
    expect(withCtx.context).toEqual({ a: 1 });
    const withoutCtx = toLogEntry({ ...base, level: 'info', channel: 'toast' });
    expect(withoutCtx.context).toEqual({});
  });

  it('toLogEntry_ContextErrorIsError_ReplacedWithNameAndMessage', () => {
    const context = { windowKind: 'edit', error: new RangeError('out of range') };
    const entry = toLogEntry({ ...base, level: 'error', channel: 'highlight', context });

    expect(entry.context).toEqual({ windowKind: 'edit', error: { name: 'RangeError', message: 'out of range' } });
    expect(JSON.parse(JSON.stringify(entry)).context.error).toEqual({ name: 'RangeError', message: 'out of range' });
    expect(context.error).toBeInstanceOf(RangeError); // 記録の context は書き換えない
  });

  it('toLogEntry_ContextErrorNotError_KeptAsIs', () => {
    const entry = toLogEntry({ ...base, level: 'error', channel: 'highlight', context: { error: 'text' } });
    expect(entry.context).toEqual({ error: 'text' });
  });

  it('toLogEntry_DoesNotCopyShowOnScreenTitleButtons', () => {
    const entry = toLogEntry({
      ...base,
      level: 'critical',
      channel: 'modal',
      title: 'h',
      buttons: { confirm: 'c' },
      showOnScreen: false,
    });
    expect(Object.keys(entry).sort()).toEqual(['code', 'context', 'level', 'message', 'timestamp']);
  });
});
