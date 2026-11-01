// UT-ERR-MAINLOG: MainLogging（main のログの結線：起動のクォータ・書く・クラッシュログ・保存先の切り替え・終了の flush）
// 検証節: error-logging-foundation.md 2.4 節（Logger の行・LogRingBuffer の行・クラッシュログの結線・flush の段落、K1・T1・X4）

import { DEFAULT_LOG_QUOTA_BYTES, Logger, type LogFileStore } from '@riff-line/core/errors';
import type { DirEntry, LogEntry } from '@riff-line/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushLogsThenQuit, MainLogging } from './mainLogging';

/** 書いたファイルを持つだけの LogFileStore。 */
class MemoryStore implements LogFileStore {
  readonly files = new Map<string, Uint8Array>();
  constructor(private readonly root: string) {}
  readFile(relativePath: string): Promise<Uint8Array> {
    const data = this.files.get(relativePath);
    return data === undefined
      ? Promise.reject(Object.assign(new Error('missing'), { code: 'FILE_NOT_FOUND' }))
      : Promise.resolve(data);
  }
  writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    this.files.set(relativePath, data);
    return Promise.resolve();
  }
  listDirectory(): Promise<DirEntry[]> {
    return Promise.resolve([]);
  }
  ensureDirectory(): Promise<void> {
    return Promise.resolve();
  }
  deleteFile(relativePath: string): Promise<void> {
    this.files.delete(relativePath);
    return Promise.resolve();
  }
  getRootPath(): string {
    return this.root;
  }
  /** 書いたファイルの名前（logs/ の下）と中身の文字。 */
  texts(): Record<string, string> {
    return Object.fromEntries([...this.files].map(([path, data]) => [path, new TextDecoder().decode(data)]));
  }
}

const now = new Date(2026, 10, 1, 9, 30, 0);
const entry = (code: string): LogEntry => ({ timestamp: 't', level: 'warning', code, message: 'm', context: {} });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MainLogging.start（error-logging-foundation.md 2.4 節の Logger の行・3.3 節）', () => {
  it('MainLogging_start_主ストレージのアダプタでLoggerを作りenforceQuotaを10MBで1回呼ぶ', async () => {
    // UT-ERR-MAINLOG-01 2.4 節「起動シーケンスで enforceQuota(DEFAULT_LOG_QUOTA_BYTES=10MB) を1回呼ぶ」
    const quota = vi.spyOn(Logger.prototype, 'enforceQuota');
    const store = new MemoryStore('/primary/TabApp');

    const logging = await MainLogging.start(store, { resolvePrimaryStore: () => Promise.resolve(store) });

    expect(quota).toHaveBeenCalledTimes(1);
    expect(quota).toHaveBeenCalledWith(DEFAULT_LOG_QUOTA_BYTES);
    expect(logging.logger.getLogFolderAbsolutePath()).toBe('/primary/TabApp/logs');
  });
});

describe('MainLogging の書く口とクラッシュログ（error-logging-foundation.md 2.4 節）', () => {
  it('MainLogging_writeLog_LogRingBufferに積んでからLogger.appendに同じLogEntryを渡す', async () => {
    // UT-ERR-MAINLOG-02 2.6 節「LogRingBuffer に積んでから、その時の書き先の Logger.append を呼ぶ関数」
    const store = new MemoryStore('/primary/TabApp');
    const logging = await MainLogging.start(store, { resolvePrimaryStore: () => Promise.resolve(store) });
    const order: string[] = [];
    const push = vi.spyOn(logging.ring, 'push').mockImplementation(() => void order.push('ring'));
    const append = vi.spyOn(logging.logger, 'append').mockImplementation(() => {
      order.push('logger');
      return Promise.resolve();
    });
    const written = entry('FILE-005');

    await logging.writeLog(written);

    expect(order).toEqual(['ring', 'logger']);
    expect(push).toHaveBeenCalledWith(written);
    expect(append).toHaveBeenCalledWith(written);
  });

  it('MainLogging_writeCrashLog_LogRingBufferのsnapshotだけを添える', async () => {
    // UT-ERR-MAINLOG-03 2.4 節「onCrash({reason}) を Logger.writeCrashLog(reason, LogRingBuffer.snapshot()) へつなぐ」（決定 X4）
    const store = new MemoryStore('/primary/TabApp');
    const logging = await MainLogging.start(store, {
      resolvePrimaryStore: () => Promise.resolve(store),
      loggerOptions: { now: () => now },
    });
    await logging.writeLog(entry('A'));
    await logging.writeLog(entry('B'));

    await logging.writeCrashLog('crashed');

    const crash = store.texts()['logs/crash-20261101-093000.log']!.trimEnd().split('\n');
    expect(JSON.parse(crash[0]!)).toMatchObject({ kind: 'crash', reason: 'crashed', bufferedEvents: 2 });
    expect(crash.slice(1).map((line) => JSON.parse(line).code)).toEqual(['A', 'B']);
  });
});

describe('MainLogging.onSharedChange（error-logging-foundation.md 2.4 節の Logger の行、K1）', () => {
  it('MainLogging_storageの知らせ_書き先を新しい主ストレージのアダプタに替える', async () => {
    // UT-ERR-MAINLOG-04 2.4 節「shared:changed の storage の知らせを受け、Logger の書き先を新しい主ストレージのアダプタ（その logs/）に替える」
    const before = new MemoryStore('/old/TabApp');
    const after = new MemoryStore('/new/TabApp');
    const logging = await MainLogging.start(before, {
      resolvePrimaryStore: () => Promise.resolve(after),
      loggerOptions: { now: () => now },
    });

    await logging.onSharedChange({ kind: 'storage' });
    await logging.writeLog(entry('AFTER'));

    expect(Object.keys(after.texts())).toEqual(['logs/app-20261101.log']);
    expect(before.files.size).toBe(0);
    expect(logging.logger.getLogFolderAbsolutePath()).toBe('/new/TabApp/logs');
  });

  it('MainLogging_storageでない知らせ_書き先を引かず替えない', async () => {
    // UT-ERR-MAINLOG-05 Logger の書き先を替えるのは storage の知らせだけ（ほかの kind は窓が読み直す）
    const store = new MemoryStore('/old/TabApp');
    const resolvePrimaryStore = vi.fn(() => Promise.resolve(new MemoryStore('/new/TabApp')));
    const logging = await MainLogging.start(store, { resolvePrimaryStore });

    for (const notice of [
      { kind: 'song', id: 's1' },
      { kind: 'tags' },
      { kind: 'storageLockStart' },
      { kind: 'storageLockEnd' },
    ] as const) {
      await logging.onSharedChange(notice);
    }

    expect(resolvePrimaryStore).not.toHaveBeenCalled();
    expect(logging.logger.getLogFolderAbsolutePath()).toBe('/old/TabApp/logs');
  });

  it('MainLogging_新しい主ストレージを引けない_前の書き先に書き続け投げない', async () => {
    // UT-ERR-MAINLOG-06 ログを失わないため、引けなければ前の書き先のまま
    const store = new MemoryStore('/old/TabApp');
    const logging = await MainLogging.start(store, {
      resolvePrimaryStore: () => Promise.reject(new Error('settings.json broken')),
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(logging.onSharedChange({ kind: 'storage' })).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(logging.logger.getLogFolderAbsolutePath()).toBe('/old/TabApp/logs');
  });
});

describe('終了の順の最後の flush（error-logging-foundation.md 2.4 節の flush の段落、決定 T1）', () => {
  it('flushLogsThenQuit_Logger.flushを1回待ってから終える', async () => {
    // UT-ERR-MAINLOG-07 2.4 節「アプリの終了の順の最後に、main が Logger.flush() を 1 回呼び、終わってからプロセスを終える」
    const store = new MemoryStore('/primary/TabApp');
    const logging = await MainLogging.start(store, { resolvePrimaryStore: () => Promise.resolve(store) });
    const order: string[] = [];
    const flush = vi.spyOn(logging.logger, 'flush').mockImplementation(async () => {
      await Promise.resolve();
      order.push('flushed');
    });

    await flushLogsThenQuit(logging, () => order.push('quit'));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['flushed', 'quit']);
  });

  it('flushLogsThenQuit_積んだ行_終える前に書き切る', async () => {
    // UT-ERR-MAINLOG-08 2.4 節「終了の途中で書いたログも残る」
    const store = new MemoryStore('/primary/TabApp');
    const logging = await MainLogging.start(store, {
      resolvePrimaryStore: () => Promise.resolve(store),
      loggerOptions: { now: () => now },
    });
    void logging.writeLog(entry('LAST'));
    let textAtQuit = '';

    await flushLogsThenQuit(logging, () => {
      textAtQuit = store.texts()['logs/app-20261101.log'] ?? '';
    });

    expect(textAtQuit).toContain('LAST');
  });

  it('flushLogsThenQuit_組み立て前_待たずに終える', async () => {
    // UT-ERR-MAINLOG-09 起動の途中で窓が全部閉じたとき
    const quit = vi.fn();
    await flushLogsThenQuit(undefined, quit);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('flushLogsThenQuit_flushが失敗_それでも終える', async () => {
    // UT-ERR-MAINLOG-10 終了を止めない
    const quit = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await flushLogsThenQuit({ flush: () => Promise.reject(new Error('x')) }, quit);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
