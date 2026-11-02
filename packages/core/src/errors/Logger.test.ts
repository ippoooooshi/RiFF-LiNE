// UT-ERR-LOG: error-logging-foundation.md 2.2 節・3.3 節・6 節 — Logger
// 検証観点:
//  - append: 当日ファイルへ 1 行 1 JSON 追記、日付跨ぎで別ファイル、失敗を飲み込む、受け取った LogEntry をそのまま書く
//  - writeCrashLog: crash-YYYYMMDD-HHMMSS.log の 1 行目に理由と検知時刻、2 行目から直近の LogEntry を古い順に
//  - enforceQuota: 10MB 前後の境界（C1）、古いファイルから削除、上限内は無操作、フォルダ未作成
//  - getLogFolderAbsolutePath

import { describe, expect, it, vi } from 'vitest';

import type { DirEntry, FileSystemAdapter } from '../platform';

import { FileNotFoundError } from '../platform/errors';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { DEFAULT_LOG_QUOTA_BYTES, Logger, dateStamp, dateTimeStamp } from './Logger';
import type { LogEntry } from './types';

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  timestamp: '2026-09-08T00:00:00.000Z',
  level: 'warning',
  code: 'FILE-005',
  message: 'm',
  context: {},
  ...over,
});

describe('dateStamp / dateTimeStamp', () => {
  it('dateStamp_PadsMonthAndDay', () => {
    expect(dateStamp(new Date(2026, 0, 3))).toBe('20260103');
  });
  it('dateTimeStamp_PadsAllParts', () => {
    expect(dateTimeStamp(new Date(2026, 8, 8, 4, 5, 9))).toBe('20260908-040509');
  });
});

describe('Logger.append', () => {
  it('append_FirstCall_CreatesTodayFileWithOneJsonLine', async () => {
    const fs = new FakeFileSystemAdapter();
    const now = new Date(2026, 8, 8, 10, 0, 0);
    const logger = new Logger(fs, { now: () => now });

    await logger.append(entry({ code: 'FILE-001' }));

    const text = fs.readText(`logs/app-${dateStamp(now)}.log`);
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ code: 'FILE-001' });
  });

  it('append_MultipleSameDay_AppendsLines', async () => {
    const fs = new FakeFileSystemAdapter();
    const now = new Date(2026, 8, 8, 10, 0, 0);
    const logger = new Logger(fs, { now: () => now });

    await logger.append(entry({ code: 'A' }));
    await logger.append(entry({ code: 'B' }));

    const lines = fs
      .readText(`logs/app-${dateStamp(now)}.log`)
      .trimEnd()
      .split('\n');
    expect(lines.map((l) => JSON.parse(l).code)).toEqual(['A', 'B']);
  });

  it('append_DifferentDay_WritesSeparateFile', async () => {
    const fs = new FakeFileSystemAdapter();
    let now = new Date(2026, 8, 8, 23, 59, 0);
    const logger = new Logger(fs, { now: () => now });

    await logger.append(entry({ code: 'DAY1' }));
    now = new Date(2026, 8, 9, 0, 1, 0);
    await logger.append(entry({ code: 'DAY2' }));

    expect(fs.readText('logs/app-20260908.log').trimEnd()).toContain('DAY1');
    expect(fs.readText('logs/app-20260909.log').trimEnd()).toContain('DAY2');
  });

  it('append_ConcurrentCalls_SerializedNoLinesLost', async () => {
    const fs = new FakeFileSystemAdapter();
    const now = new Date(2026, 8, 8, 10, 0, 0);
    const logger = new Logger(fs, { now: () => now });

    // await せずに 10 件同時に投げる（report が連続で呼ぶ状況）。
    await Promise.all(Array.from({ length: 10 }, (_v, i) => logger.append(entry({ code: `C${i}` }))));

    const lines = fs
      .readText(`logs/app-${dateStamp(now)}.log`)
      .trimEnd()
      .split('\n');
    expect(lines.map((l) => JSON.parse(l).code)).toEqual(Array.from({ length: 10 }, (_v, i) => `C${i}`));
  });

  it('append_WriteFails_DoesNotThrow', async () => {
    const fs = new FakeFileSystemAdapter();
    vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('disk full'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new Logger(fs);

    await expect(logger.append(entry())).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each([new Error('eacces'), 'string thrown', null])(
    'append_ReadFailsOtherThanNotFound_%s_DoesNotWriteAndDoesNotThrow',
    async (thrown) => {
      const fs = new FakeFileSystemAdapter();
      vi.spyOn(fs, 'readFile').mockRejectedValue(thrown);
      const write = vi.spyOn(fs, 'writeFile');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(new Logger(fs).append(entry())).resolves.toBeUndefined();

      // 読めない既存のログを空とみなして上書きしない
      expect(write).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    },
  );

  it('append_WritesReceivedEntryAsIs_NoAssembly', async () => {
    const fs = new FakeFileSystemAdapter();
    const now = new Date(2026, 8, 8, 10, 0, 0);
    const given = entry({ level: 'error', code: 'SYS-005', context: { kind: 'error' }, stack: 'S' });

    await new Logger(fs, { now: () => now }).append(given);

    const line = fs.readText(`logs/app-${dateStamp(now)}.log`).trimEnd();
    expect(JSON.parse(line)).toEqual(given);
  });

  it('append_OneCallFails_LaterCallsStillWritten', async () => {
    const fs = new FakeFileSystemAdapter();
    const now = new Date(2026, 8, 8, 10, 0, 0);
    let calls = 0;
    const logger = new Logger(fs, {
      now: () => {
        calls += 1;
        if (calls === 1) throw new Error('clock failed');
        return now;
      },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = logger.append(entry({ code: 'LOST' }));
    const second = logger.append(entry({ code: 'KEPT' }));

    await expect(first).resolves.toBeUndefined();
    await second;
    expect(fs.readText(`logs/app-${dateStamp(now)}.log`).trimEnd()).toContain('KEPT');
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('flush_WaitsUntilQueuedAppendsAreWritten', async () => {
    const fs = new FakeFileSystemAdapter();
    const now = new Date(2026, 8, 8, 10, 0, 0);
    const logger = new Logger(fs, { now: () => now });

    void logger.append(entry({ code: 'Q1' }));
    void logger.append(entry({ code: 'Q2' }));
    await logger.flush();

    const lines = fs
      .readText(`logs/app-${dateStamp(now)}.log`)
      .trimEnd()
      .split('\n');
    expect(lines.map((l) => JSON.parse(l).code)).toEqual(['Q1', 'Q2']);
  });
});

describe('Logger.writeCrashLog', () => {
  it('writeCrashLog_WritesReasonHeaderThenBufferedEvents', async () => {
    const fs = new FakeFileSystemAdapter();
    const now = new Date(2026, 8, 8, 4, 5, 9);
    const logger = new Logger(fs, { now: () => now });
    const buffer: LogEntry[] = [
      { level: 'error', code: 'RENDER-001', message: 'x', timestamp: 't1', context: { songId: 's1' }, stack: 'S1' },
      { level: 'warning', code: 'FILE-005', message: 'y', timestamp: 't2', context: {} },
    ];

    await logger.writeCrashLog('crashed', buffer);

    const text = fs.readText(`logs/crash-${dateTimeStamp(now)}.log`);
    const lines = text.trimEnd().split('\n');
    // 1 行目：クラッシュ理由と検知時刻
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: 'crash',
      reason: 'crashed',
      at: now.toISOString(),
      bufferedEvents: 2,
    });
    // 2 行目から：渡された LogEntry を古い順に 1 行 1 JSON
    expect(JSON.parse(lines[1]!)).toEqual(buffer[0]);
    expect(JSON.parse(lines[2]!)).toEqual(buffer[1]);
    expect(lines).toHaveLength(3);
  });

  it('writeCrashLog_EmptyBuffer_WritesHeaderOnly', async () => {
    const fs = new FakeFileSystemAdapter();
    const now = new Date(2026, 8, 8, 4, 5, 9);
    const logger = new Logger(fs, { now: () => now });

    await logger.writeCrashLog('oom', []);

    const lines = fs
      .readText(`logs/crash-${dateTimeStamp(now)}.log`)
      .trimEnd()
      .split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).reason).toBe('oom');
  });

  it('writeCrashLog_WriteFails_DoesNotThrow', async () => {
    const fs = new FakeFileSystemAdapter();
    vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('ro'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(new Logger(fs).writeCrashLog('r', [])).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

/** enforceQuota 用に modifiedAt / sizeBytes を制御できる最小アダプタ。 */
class QuotaFakeAdapter implements FileSystemAdapter {
  deleted: string[] = [];
  constructor(private entries: DirEntry[]) {}
  listDirectory(relativePath: string): Promise<DirEntry[]> {
    if (relativePath !== 'logs') return Promise.reject(new FileNotFoundError(relativePath));
    return Promise.resolve(this.entries);
  }
  deleteFile(relativePath: string): Promise<void> {
    this.deleted.push(relativePath);
    const name = relativePath.replace('logs/', '');
    this.entries = this.entries.filter((e) => e.name !== name);
    return Promise.resolve();
  }
  getRootPath(): string {
    return '/root/TabApp';
  }
  readFile(): Promise<Uint8Array> {
    return Promise.reject(new Error('unused'));
  }
  writeFile(): Promise<void> {
    return Promise.resolve();
  }
  ensureDirectory(): Promise<void> {
    return Promise.resolve();
  }
  renameFile(): Promise<void> {
    return Promise.resolve();
  }
  copyFile(): Promise<void> {
    return Promise.resolve();
  }
  removeEmptyDirectory(): Promise<void> {
    return Promise.resolve();
  }
  exists(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

const dirEntry = (name: string, sizeBytes: number, modifiedAt: string): DirEntry => ({
  name,
  isDirectory: false,
  sizeBytes,
  modifiedAt,
});

describe('Logger.enforceQuota', () => {
  it('enforceQuota_UnderLimit_DeletesNothing', async () => {
    const fs = new QuotaFakeAdapter([
      dirEntry('app-20260907.log', 4_000_000, '2026-09-07T00:00:00Z'),
      dirEntry('app-20260908.log', 4_000_000, '2026-09-08T00:00:00Z'),
    ]);
    await new Logger(fs).enforceQuota(DEFAULT_LOG_QUOTA_BYTES);
    expect(fs.deleted).toEqual([]);
  });

  // <!-- req errorloggingfoundation:2662d589.f1db -->
  it('enforceQuota_ExactlyAtLimit_DeletesNothing', async () => {
    const fs = new QuotaFakeAdapter([dirEntry('app-1.log', DEFAULT_LOG_QUOTA_BYTES, '2026-09-08T00:00:00Z')]);
    await new Logger(fs).enforceQuota(DEFAULT_LOG_QUOTA_BYTES);
    expect(fs.deleted).toEqual([]);
  });

  // <!-- req errorloggingfoundation:2662d589.f1db -->
  it('enforceQuota_OneByteOver_DeletesOldestUntilUnder', async () => {
    const fs = new QuotaFakeAdapter([
      dirEntry('app-20260906.log', 6_000_000, '2026-09-06T00:00:00Z'),
      dirEntry('crash-20260907-000000.log', 3_000_000, '2026-09-07T00:00:00Z'),
      dirEntry('app-20260908.log', DEFAULT_LOG_QUOTA_BYTES - 9_000_000 + 1, '2026-09-08T00:00:00Z'),
    ]);
    await new Logger(fs).enforceQuota(DEFAULT_LOG_QUOTA_BYTES);
    // 合計 = 上限 + 1 バイト。最古 (app-20260906) を消せば収まり、種別（app/crash）は問わない。
    expect(fs.deleted).toEqual(['logs/app-20260906.log']);
  });

  it('enforceQuota_AllOverEvenAfterDeletions_StopsWhenEmpty', async () => {
    const fs = new QuotaFakeAdapter([
      dirEntry('a.log', 20_000_000, '2026-09-06T00:00:00Z'),
      dirEntry('b.log', 20_000_000, '2026-09-07T00:00:00Z'),
    ]);
    await new Logger(fs).enforceQuota(DEFAULT_LOG_QUOTA_BYTES);
    expect(fs.deleted).toEqual(['logs/a.log', 'logs/b.log']);
  });

  it('enforceQuota_LogsFolderMissing_NoThrowNoDelete', async () => {
    const fs = new FakeFileSystemAdapter();
    await expect(new Logger(fs).enforceQuota(DEFAULT_LOG_QUOTA_BYTES)).resolves.toBeUndefined();
  });

  it('enforceQuota_ListFails_Swallowed', async () => {
    const fs = new FakeFileSystemAdapter();
    vi.spyOn(fs, 'listDirectory').mockRejectedValue(new Error('eacces'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(new Logger(fs).enforceQuota(1)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('enforceQuota_IgnoresSubdirectories', async () => {
    const fs = new QuotaFakeAdapter([
      { name: 'archive', isDirectory: true, sizeBytes: 0, modifiedAt: '2026-01-01T00:00:00Z' },
      dirEntry('app-20260908.log', 3_000_000, '2026-09-08T00:00:00Z'),
    ]);
    await new Logger(fs).enforceQuota(DEFAULT_LOG_QUOTA_BYTES);
    expect(fs.deleted).toEqual([]);
  });
});

describe('Logger.getLogFolderAbsolutePath', () => {
  it('getLogFolderAbsolutePath_JoinsRootAndLogsDir', () => {
    const fs = new FakeFileSystemAdapter({ rootPath: '/home/u/TabApp' });
    expect(new Logger(fs).getLogFolderAbsolutePath()).toBe('/home/u/TabApp/logs');
  });

  it('getLogFolderAbsolutePath_StripsTrailingSlashOnRoot', () => {
    const fs = new FakeFileSystemAdapter({ rootPath: 'C:\\Users\\u\\TabApp\\' });
    expect(new Logger(fs).getLogFolderAbsolutePath()).toBe('C:\\Users\\u\\TabApp/logs');
  });
});

describe('Logger.setStore（error-logging-foundation.md 2.4 節の Logger の行、2026-10-29 本人決定 K1）', () => {
  it('setStore_替えた後_append・writeCrashLog・getLogFolderAbsolutePathは新しい書き先を使う', async () => {
    // UT-ERR-LOG-01 2.4 節「Logger の書き先を新しい主ストレージのアダプタ（その logs/）に替える」
    const before = new FakeFileSystemAdapter({ rootPath: '/old/TabApp' });
    const after = new FakeFileSystemAdapter({ rootPath: '/new/TabApp' });
    const now = new Date(2026, 8, 8, 4, 5, 9);
    const logger = new Logger(before, { now: () => now });

    logger.setStore(after);
    await logger.append(entry({ code: 'AFTER' }));
    await logger.writeCrashLog('crashed', []);

    expect(after.readText(`logs/app-${dateStamp(now)}.log`)).toContain('AFTER');
    expect(after.readText(`logs/crash-${dateTimeStamp(now)}.log`)).toContain('crashed');
    expect(() => before.readText(`logs/app-${dateStamp(now)}.log`)).toThrow();
    expect(logger.getLogFolderAbsolutePath()).toBe('/new/TabApp/logs');
  });

  it('setStore_替える前に積んだ行_前の書き先に書き_順も崩れない', async () => {
    // UT-ERR-LOG-02 2.4 節：替える前に受けた記録は、受けた時の書き先（前の主ストレージの logs/）に残す
    const before = new FakeFileSystemAdapter({ rootPath: '/old/TabApp' });
    const after = new FakeFileSystemAdapter({ rootPath: '/new/TabApp' });
    const now = new Date(2026, 8, 8, 10, 0, 0);
    const logger = new Logger(before, { now: () => now });

    void logger.append(entry({ code: 'B1' }));
    void logger.append(entry({ code: 'B2' }));
    logger.setStore(after);
    void logger.append(entry({ code: 'A1' }));
    await logger.flush();

    const codes = (fs: FakeFileSystemAdapter): string[] =>
      fs
        .readText(`logs/app-${dateStamp(now)}.log`)
        .trimEnd()
        .split('\n')
        .map((l) => JSON.parse(l).code as string);
    expect(codes(before)).toEqual(['B1', 'B2']);
    expect(codes(after)).toEqual(['A1']);
  });

  it('setStore_替えた後のenforceQuota_新しい書き先のlogsを見る', async () => {
    // UT-ERR-LOG-03 2.4 節：容量の枠（2.2 節）も新しい主ストレージの logs/ で見る
    const before = new QuotaFakeAdapter([dirEntry('app-1.log', DEFAULT_LOG_QUOTA_BYTES + 1, '2026-09-06T00:00:00Z')]);
    const after = new QuotaFakeAdapter([dirEntry('app-2.log', DEFAULT_LOG_QUOTA_BYTES + 1, '2026-09-07T00:00:00Z')]);
    const logger = new Logger(before);

    logger.setStore(after);
    await logger.enforceQuota(DEFAULT_LOG_QUOTA_BYTES);

    expect(before.deleted).toEqual([]);
    expect(after.deleted).toEqual(['logs/app-2.log']);
  });
});
