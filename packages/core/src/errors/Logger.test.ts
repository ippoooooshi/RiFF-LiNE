// UT-ERR-LOG: error-logging-foundation.md §2.2・§3.3・§6 — Logger
// 検証観点:
//  - append: 当日ファイルへ 1 行 1 JSON 追記、日付跨ぎで別ファイル、失敗を飲み込む
//  - writeCrashLog: crash-YYYYMMDD-HHMMSS.log に理由＋直近バッファ
//  - enforceQuota: 10MB 前後の境界（C1）、古いファイルから削除、上限内は無操作、フォルダ未作成
//  - getLogFolderAbsolutePath

import { describe, expect, it, vi } from 'vitest';

import type { DirEntry, FileSystemAdapter } from '@riff-line/shared-types';

import { FileNotFoundError } from '../platform/errors';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { DEFAULT_LOG_QUOTA_BYTES, Logger, dateStamp, dateTimeStamp } from './Logger';
import type { LogEntry, NotificationEvent } from './types';

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  timestamp: '2026-09-08T00:00:00.000Z',
  level: 'warning',
  code: 'FILE-005',
  message: 'm',
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
});

describe('Logger.writeCrashLog', () => {
  it('writeCrashLog_WritesReasonHeaderThenBufferedEvents', async () => {
    const fs = new FakeFileSystemAdapter();
    const now = new Date(2026, 8, 8, 4, 5, 9);
    const logger = new Logger(fs, { now: () => now });
    const buffer: NotificationEvent[] = [
      { level: 'error', channel: 'highlight', code: 'RENDER-001', message: 'x', timestamp: 't1' },
      { level: 'warning', channel: 'toast', code: 'FILE-005', message: 'y', timestamp: 't2' },
    ];

    await logger.writeCrashLog('crashed', buffer);

    const text = fs.readText(`logs/crash-${dateTimeStamp(now)}.log`);
    const lines = text.trimEnd().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ kind: 'crash', reason: 'crashed', bufferedEvents: 2 });
    expect(JSON.parse(lines[1]!).code).toBe('RENDER-001');
    expect(JSON.parse(lines[2]!).code).toBe('FILE-005');
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

  it('enforceQuota_ExactlyAtLimit_DeletesNothing', async () => {
    const fs = new QuotaFakeAdapter([dirEntry('app-1.log', DEFAULT_LOG_QUOTA_BYTES, '2026-09-08T00:00:00Z')]);
    await new Logger(fs).enforceQuota(DEFAULT_LOG_QUOTA_BYTES);
    expect(fs.deleted).toEqual([]);
  });

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
