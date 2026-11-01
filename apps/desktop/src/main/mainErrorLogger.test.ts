// UT-ERR-MEL: MainErrorLogger（main で出たエラーを main が自分でログに書き、画面に出す記録を窓へ送る口）と registerMainUncaughtHandlers
// 検証節: error-logging-foundation.md 2.4 節（K5）・2.6 節（main の単体テストの観点）

import {
  ErrorCodeRegistry,
  NotificationCenter,
  registerCoreErrorCodes,
  registerPersistenceErrorCodes,
  UnknownErrorCodeError,
} from '@riff-line/core/errors';
import { NOTIFY_CHANNELS, type LogEntry, type NotificationEvent } from '@riff-line/shared-types';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { forwardSharedNotifications, MainErrorLogger, registerMainUncaughtHandlers } from './mainErrorLogger';

function makeRegistry(): ErrorCodeRegistry {
  const registry = new ErrorCodeRegistry();
  registerCoreErrorCodes(registry);
  registerPersistenceErrorCodes(registry);
  return registry;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 送れるか・破棄済みかを選べる BrowserWindow の代わり（使うのは isDestroyed と webContents の isDestroyed・send だけ）。 */
function fakeWindow(
  opts: { destroyed?: boolean; contentsDestroyed?: boolean; sendThrows?: boolean } = {},
): BrowserWindow & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(() => {
    if (opts.sendThrows) throw new Error('render frame was disposed');
  });
  const window = {
    isDestroyed: () => opts.destroyed ?? false,
    webContents: { isDestroyed: () => opts.contentsDestroyed ?? false, send },
    send,
  };
  return window as unknown as BrowserWindow & { send: ReturnType<typeof vi.fn> };
}

function makeLogger(windows: readonly BrowserWindow[] = []): {
  logger: MainErrorLogger;
  writeLog: ReturnType<typeof vi.fn<(entry: LogEntry) => Promise<void>>>;
} {
  const writeLog = vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve());
  const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog, targetWindows: () => windows });
  return { logger, writeLog };
}

type ProcessEvent = 'uncaughtException' | 'unhandledRejection';
type Listener = (...args: never[]) => unknown;

function listenersOf(event: ProcessEvent): Listener[] {
  return event === 'uncaughtException'
    ? process.listeners('uncaughtException')
    : process.listeners('unhandledRejection');
}

/** 登録の前後で増えた process の受け口（vitest 自身の受け口に例外を流さないよう、受け口を直に呼ぶ）。 */
function addedListeners(event: ProcessEvent, before: Listener[]): Array<(reason: unknown, extra: unknown) => void> {
  return listenersOf(event).filter((listener) => !before.includes(listener)) as Array<
    (reason: unknown, extra: unknown) => void
  >;
}

describe('MainErrorLogger.report（error-logging-foundation.md 2.6 節）', () => {
  it('MainErrorLogger_report_toLogEntryで組み立てたLogEntryでwriteLogを1回呼ぶ', () => {
    // UT-ERR-MEL-01 2.6 節「MainErrorLogger.report が writeLog を 1 回呼び」「toLogEntry(event) で組み立てた LogEntry を writeLog に渡す」
    const writeLog = vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve());
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog, targetWindows: () => [] });

    logger.report('FILE-005', { songId: 's1' });

    expect(writeLog).toHaveBeenCalledTimes(1);
    const entry = writeLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ code: 'FILE-005', level: 'warning', context: { songId: 's1' } });
    // LogEntry の形（画面向けの欄を持たない）
    expect(entry).not.toHaveProperty('channel');
    expect(entry).not.toHaveProperty('showOnScreen');
  });

  it('MainErrorLogger_画面に出さないコード_showOnScreenを見ずにwriteLogを呼ぶ', () => {
    // UT-ERR-MEL-02 2.6 節「(1) ログの受け手：showOnScreen を見ずに」（SYS-005・FILE-015 は画面に出さない）
    const writeLog = vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve());
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog, targetWindows: () => [] });

    logger.report('SYS-005', { kind: 'main-uncaughtException', error: new Error('boom') });
    logger.report('FILE-015');

    expect(writeLog.mock.calls.map(([entry]) => entry.code)).toEqual(['SYS-005', 'FILE-015']);
  });

  it('MainErrorLogger_contextのerror_stackはそのErrorのstackでcontext.errorはnameとmessage', () => {
    // UT-ERR-MEL-03 2.6 節「レベル・チャンネル・文言・stack の決め方（2.1 節・2.2 節）が renderer で出た記録と同じになる」
    const writeLog = vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve());
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog, targetWindows: () => [] });
    const thrown = new Error('boom');

    logger.report('SYS-005', { kind: 'main-uncaughtException', error: thrown });

    const entry = writeLog.mock.calls[0]![0];
    expect(entry.stack).toBe(thrown.stack);
    expect(entry.context).toEqual({ kind: 'main-uncaughtException', error: { name: 'Error', message: 'boom' } });
  });

  it('MainErrorLogger_writeLogがreject_reportは投げずunhandledRejectionも起こさない', async () => {
    // UT-ERR-MEL-04 2.6 節「writeLog が reject しても report が投げず、unhandledRejection を起こさないこと」
    const writeLog = vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.reject(new Error('disk full')));
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog, targetWindows: () => [] });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      expect(() => logger.report('FILE-005')).not.toThrow();
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      process.off('unhandledRejection', unhandled);
      consoleError.mockRestore();
    }
  });

  it('MainErrorLogger_未登録のコード_UnknownErrorCodeErrorを投げwriteLogを呼ばない', () => {
    // UT-ERR-MEL-05 2.1 節：未登録コードは UnknownErrorCodeError（renderer と同じく開発時に気づけるようにする）
    const writeLog = vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve());
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog, targetWindows: () => [] });

    expect(() => logger.report('SYS-999')).toThrow(UnknownErrorCodeError);
    expect(writeLog).not.toHaveBeenCalled();
  });
});

describe('MainErrorLogger の送る受け手（error-logging-foundation.md 2.6 節）', () => {
  it('MainErrorLogger_画面に出すコード_送れる窓の全部へnotifyFromMainを1回ずつNotificationEventのまま送る', () => {
    // UT-ERR-MEL-06 2.6 節「showOnScreen が真のコード（FILE-005）なら送れる窓の全部へ notify:fromMain を 1 回ずつ送り」
    const windows = [fakeWindow(), fakeWindow()];
    const { logger, writeLog } = makeLogger(windows);

    logger.report('FILE-005', { songId: 's1' });

    expect(writeLog).toHaveBeenCalledTimes(1);
    for (const window of windows) {
      expect(window.send).toHaveBeenCalledTimes(1);
      const [channel, event] = window.send.mock.calls[0] as [string, NotificationEvent];
      expect(channel).toBe(NOTIFY_CHANNELS.fromMain);
      expect(channel).toBe('notify:fromMain');
      // LogEntry ではなく NotificationEvent のまま（画面向けの欄を持つ）
      expect(event).toMatchObject({
        code: 'FILE-005',
        level: 'warning',
        showOnScreen: true,
        context: { songId: 's1' },
      });
      expect(event).toHaveProperty('channel');
    }
  });

  it('MainErrorLogger_画面に出さないコード_窓へ送らない', () => {
    // UT-ERR-MEL-07 2.6 節「偽のコード（SYS-005・FILE-015）なら送らないこと」
    const window = fakeWindow();
    const { logger, writeLog } = makeLogger([window]);

    logger.report('SYS-005', { kind: 'main-uncaughtException', error: new Error('boom') });
    logger.report('FILE-015');

    expect(writeLog).toHaveBeenCalledTimes(2);
    expect(window.send).not.toHaveBeenCalled();
  });

  it('MainErrorLogger_送れない窓とsendが投げる窓_飛ばして残りの窓へ送る', () => {
    // UT-ERR-MEL-08 2.6 節「送れない窓を飛ばし、webContents.send が投げても残りの窓へ送ること」
    const destroyed = fakeWindow({ destroyed: true });
    const contentsDestroyed = fakeWindow({ contentsDestroyed: true });
    const throwing = fakeWindow({ sendThrows: true });
    const alive = fakeWindow();
    const { logger, writeLog } = makeLogger([destroyed, contentsDestroyed, throwing, alive]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => logger.report('FILE-005')).not.toThrow();
    } finally {
      consoleError.mockRestore();
    }

    expect(destroyed.send).not.toHaveBeenCalled();
    expect(contentsDestroyed.send).not.toHaveBeenCalled();
    expect(throwing.send).toHaveBeenCalledTimes(1);
    expect(alive.send).toHaveBeenCalledTimes(1);
    expect(writeLog).toHaveBeenCalledTimes(1);
  });

  it('MainErrorLogger_窓が無い_送らずにwriteLogだけ呼ぶ', () => {
    // UT-ERR-MEL-09 2.6 節「窓が無いときも writeLog が呼ばれること」
    const { logger, writeLog } = makeLogger([]);

    logger.report('FILE-005');

    expect(writeLog).toHaveBeenCalledTimes(1);
    expect(writeLog.mock.calls[0]![0].code).toBe('FILE-005');
  });

  it('MainErrorLogger_受け手の順_ログに書いてから窓へ送る', () => {
    // UT-ERR-MEL-10 2.6 節「ログの受け手を先にする」（2.4 節の購読の順番と同じ）
    const order: string[] = [];
    const window = fakeWindow();
    window.send.mockImplementation(() => void order.push('send'));
    const logger = new MainErrorLogger({
      registry: makeRegistry(),
      writeLog: () => {
        order.push('log');
        return Promise.resolve();
      },
      targetWindows: () => [window],
    });

    logger.report('FILE-005');

    expect(order).toEqual(['log', 'send']);
  });
});

describe('registerMainUncaughtHandlers（error-logging-foundation.md 2.6 節）', () => {
  it('registerMainUncaughtHandlers_uncaughtException_SYS005とkindで1回記録しstackは投げたErrorのstack', () => {
    // UT-ERR-MEL-11 2.6 節「process に uncaughtException を起こすと SYS-005・kind: 'main-uncaughtException' で 1 回記録され、
    // LogEntry.stack が投げた Error の stack と同じになること」。SYS-005 は画面に出さないので窓へは送らない
    const window = fakeWindow();
    const { logger, writeLog } = makeLogger([window]);
    const before = listenersOf('uncaughtException');
    const dispose = registerMainUncaughtHandlers(logger);
    try {
      const [listener] = addedListeners('uncaughtException', before);
      const thrown = new Error('main boom');
      listener!(thrown, 'uncaughtException');

      expect(writeLog).toHaveBeenCalledTimes(1);
      const entry = writeLog.mock.calls[0]![0];
      expect(entry.code).toBe('SYS-005');
      expect(entry.context).toEqual({ kind: 'main-uncaughtException', error: { name: 'Error', message: 'main boom' } });
      expect(entry.stack).toBe(thrown.stack);
      expect(window.send).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('registerMainUncaughtHandlers_Errorでない値のunhandledRejection_contextのerrorをErrorに包む', () => {
    // UT-ERR-MEL-12 2.6 節「Error でない値の unhandledRejection でも context.error が Error になること」
    const { logger } = makeLogger();
    const report = vi.spyOn(logger, 'report');
    const before = listenersOf('unhandledRejection');
    const dispose = registerMainUncaughtHandlers(logger);
    try {
      const [listener] = addedListeners('unhandledRejection', before);
      listener!('not an error', Promise.resolve());

      expect(report).toHaveBeenCalledTimes(1);
      const [code, context] = report.mock.calls[0]!;
      expect(code).toBe('SYS-005');
      expect(context?.['kind']).toBe('main-unhandledRejection');
      expect(context?.['error']).toBeInstanceOf(Error);
      expect((context?.['error'] as Error).message).toBe('not an error');
    } finally {
      dispose();
    }
  });

  it('registerMainUncaughtHandlers_Errorのreason_そのまま記録する', () => {
    // UT-ERR-MEL-13 2.6 節：unhandledRejection の理由が Error ならそのまま context.error に入れる（包むのは Error でないときだけ）
    const { logger } = makeLogger();
    const report = vi.spyOn(logger, 'report');
    const before = listenersOf('unhandledRejection');
    const dispose = registerMainUncaughtHandlers(logger);
    try {
      const reason = new TypeError('rejected');
      addedListeners('unhandledRejection', before)[0]!(reason, Promise.resolve());

      expect(report).toHaveBeenCalledWith('SYS-005', { kind: 'main-unhandledRejection', error: reason });
    } finally {
      dispose();
    }
  });

  it('registerMainUncaughtHandlers_戻り値_2つの受け口を外す', () => {
    // UT-ERR-MEL-14 2.6 節「戻り値で外す」：1 回の登録で受け口を 1 つずつ足し、外すと元に戻る
    const { logger } = makeLogger();
    const beforeException = listenersOf('uncaughtException');
    const beforeRejection = listenersOf('unhandledRejection');

    const dispose = registerMainUncaughtHandlers(logger);
    expect(addedListeners('uncaughtException', beforeException)).toHaveLength(1);
    expect(addedListeners('unhandledRejection', beforeRejection)).toHaveLength(1);

    dispose();
    expect(addedListeners('uncaughtException', beforeException)).toHaveLength(0);
    expect(addedListeners('unhandledRejection', beforeRejection)).toHaveLength(0);
  });

  it('registerMainUncaughtHandlers_受け口の中で投げる_捨てて受け口から投げない', () => {
    // UT-ERR-MEL-15 2.6 節の (b)「受け口の中の処理は try で包み、中で投げたものは捨てる」（main を止めないため）
    const failing = {
      report: () => {
        throw new Error('report failed');
      },
    } as unknown as MainErrorLogger;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const beforeException = listenersOf('uncaughtException');
    const beforeRejection = listenersOf('unhandledRejection');
    const dispose = registerMainUncaughtHandlers(failing);
    try {
      expect(() =>
        addedListeners('uncaughtException', beforeException)[0]!(new Error('x'), 'uncaughtException'),
      ).not.toThrow();
      expect(() =>
        addedListeners('unhandledRejection', beforeRejection)[0]!(undefined, Promise.resolve()),
      ).not.toThrow();
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
      consoleError.mockRestore();
    }
  });
});

describe('forwardSharedNotifications（error-logging-foundation.md 2.6 節）', () => {
  it('forwardSharedNotifications_共有のcenterの記録_MainErrorLoggerのreportへ渡し外すと渡さない', () => {
    // UT-ERR-MEL-16 2.6 節「main の MirrorSyncService が出す FILE-005 も同じ口で出す」：main のプロセスの共有の
    // notificationCenter に出た記録を MainErrorLogger の report に code と context のまま渡す
    const shared = new NotificationCenter(makeRegistry());
    const window = fakeWindow();
    const { logger, writeLog } = makeLogger([window]);
    const report = vi.spyOn(logger, 'report');

    const stop = forwardSharedNotifications(shared, logger);
    shared.report('FILE-005', { songId: 's1', mirrorRoot: 'm' });

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('FILE-005', { songId: 's1', mirrorRoot: 'm' });
    expect(writeLog).toHaveBeenCalledTimes(1);
    expect(window.send).toHaveBeenCalledTimes(1);

    stop();
    shared.report('FILE-005');
    expect(report).toHaveBeenCalledTimes(1);
  });
});
