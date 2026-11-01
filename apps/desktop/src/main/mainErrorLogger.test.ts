// UT-ERR-MEL: MainErrorLogger（main で出たエラーを main が自分でログに書く口）
// 検証節: error-logging-foundation.md 2.4 節（K5）・2.6 節（main の単体テストの観点のうち、ログに書く所）

import {
  ErrorCodeRegistry,
  registerCoreErrorCodes,
  registerPersistenceErrorCodes,
  UnknownErrorCodeError,
} from '@riff-line/core/errors';
import type { LogEntry } from '@riff-line/shared-types';
import { describe, expect, it, vi } from 'vitest';

import { MainErrorLogger } from './mainErrorLogger';

function makeRegistry(): ErrorCodeRegistry {
  const registry = new ErrorCodeRegistry();
  registerCoreErrorCodes(registry);
  registerPersistenceErrorCodes(registry);
  return registry;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('MainErrorLogger.report（error-logging-foundation.md 2.6 節）', () => {
  it('MainErrorLogger_report_toLogEntryで組み立てたLogEntryでwriteLogを1回呼ぶ', () => {
    // UT-ERR-MEL-01 2.6 節「MainErrorLogger.report が writeLog を 1 回呼び」「toLogEntry(event) で組み立てた LogEntry を writeLog に渡す」
    const writeLog = vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve());
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog });

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
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog });

    logger.report('SYS-005', { kind: 'main-uncaughtException', error: new Error('boom') });
    logger.report('FILE-015');

    expect(writeLog.mock.calls.map(([entry]) => entry.code)).toEqual(['SYS-005', 'FILE-015']);
  });

  it('MainErrorLogger_contextのerror_stackはそのErrorのstackでcontext.errorはnameとmessage', () => {
    // UT-ERR-MEL-03 2.6 節「レベル・チャンネル・文言・stack の決め方（2.1 節・2.2 節）が renderer で出た記録と同じになる」
    const writeLog = vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve());
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog });
    const thrown = new Error('boom');

    logger.report('SYS-005', { kind: 'main-uncaughtException', error: thrown });

    const entry = writeLog.mock.calls[0]![0];
    expect(entry.stack).toBe(thrown.stack);
    expect(entry.context).toEqual({ kind: 'main-uncaughtException', error: { name: 'Error', message: 'boom' } });
  });

  it('MainErrorLogger_writeLogがreject_reportは投げずunhandledRejectionも起こさない', async () => {
    // UT-ERR-MEL-04 2.6 節「writeLog が reject しても report が投げず、unhandledRejection を起こさないこと」
    const writeLog = vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.reject(new Error('disk full')));
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog });
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
    const logger = new MainErrorLogger({ registry: makeRegistry(), writeLog });

    expect(() => logger.report('SYS-999')).toThrow(UnknownErrorCodeError);
    expect(writeLog).not.toHaveBeenCalled();
  });
});
