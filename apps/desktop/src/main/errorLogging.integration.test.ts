// IT-ERR-LOG: error-logging-foundation.md §3.1・§3.3・§7 — Logger + NotificationCenter を実 I/O で結線
// 検証観点:
//  - NotificationCenter.report → LogSink(Logger) → 実ファイル（logs/app-YYYYMMDD.log）へ 1 行 1 JSON
//  - Logger.writeCrashLog が実ファイルを作る
//  - Logger.enforceQuota が実フォルダの合計サイズ超過時に古いファイルを消す
//  - registerLogHandlers 経由（renderer → main の往復）で Logger へ流れる

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_LOG_QUOTA_BYTES,
  ErrorCodeRegistry,
  Logger,
  NotificationCenter,
  registerCoreErrorCodes,
  toLogEntry,
} from '@riff-line/core/errors';
import type { NotificationEvent } from '@riff-line/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ElectronFileSystemAdapter } from './ElectronFileSystemAdapter';
import { registerLogHandlers, type IpcMainLike } from './ipc';

class FakeIpcMain implements IpcMainLike {
  private readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return Promise.resolve(handler({}, payload));
  }
}

let root: string;
let adapter: ElectronFileSystemAdapter;
let logger: Logger;
let notificationCenter: NotificationCenter;
const fixedNow = new Date(2026, 8, 8, 12, 0, 0);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tabapp-errlog-'));
  adapter = new ElectronFileSystemAdapter(root, { retryOnDemandDownload: false });
  logger = new Logger(adapter, { now: () => fixedNow });

  const registry = new ErrorCodeRegistry();
  registerCoreErrorCodes(registry);
  notificationCenter = new NotificationCenter(registry, { logSink: logger });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('NotificationCenter + Logger (実 I/O)', () => {
  it('report_WritesJsonLineToTodayLogFile', async () => {
    notificationCenter.report('FILE-001', { songId: 's1' });
    notificationCenter.report('RENDER-001', { detail: 'x' });
    await logger.flush();

    const text = await readFile(join(root, 'logs', 'app-20260908.log'), 'utf8');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ code: 'FILE-001', level: 'error', context: { songId: 's1' } });
    expect(JSON.parse(lines[1]!)).toMatchObject({ code: 'RENDER-001' });
    // Error レベルは stack 付き（§2.2）。
    expect(typeof JSON.parse(lines[0]!).stack).toBe('string');
  });

  it('writeCrashLog_CreatesCrashFileWithBuffer', async () => {
    notificationCenter.report('FILE-005', { songId: 's1' });
    const buffer: NotificationEvent[] = notificationCenter.getRecentBuffer(50);

    await logger.writeCrashLog('crashed', buffer);

    const files = (await readdir(join(root, 'logs'))).filter((f) => f.startsWith('crash-'));
    expect(files).toEqual(['crash-20260908-120000.log']);
    const text = await readFile(join(root, 'logs', files[0]!), 'utf8');
    expect(JSON.parse(text.trimEnd().split('\n')[0]!)).toMatchObject({ kind: 'crash', reason: 'crashed' });
  });

  it('enforceQuota_OverBudget_DeletesOldestFilesFirst', async () => {
    await adapter.ensureDirectory('logs');
    // 古い順に app-20260906(6MB) / app-20260907(3MB) / app-20260908(3MB) = 12MB > 10MB。
    const big = (mb: number): Uint8Array => new Uint8Array(mb * 1024 * 1024);
    await writeFile(join(root, 'logs', 'app-20260906.log'), big(6));
    await new Promise((r) => setTimeout(r, 5));
    await writeFile(join(root, 'logs', 'app-20260907.log'), big(3));
    await new Promise((r) => setTimeout(r, 5));
    await writeFile(join(root, 'logs', 'app-20260908.log'), big(3));

    await logger.enforceQuota(DEFAULT_LOG_QUOTA_BYTES);

    const remaining = (await readdir(join(root, 'logs'))).sort();
    expect(remaining).toEqual(['app-20260907.log', 'app-20260908.log']);
  });

  it('registerLogHandlers_RoundTrip_FeedsLoggerAndRingBufferConsumer', async () => {
    const ipc = new FakeIpcMain();
    const seen: NotificationEvent[] = [];
    registerLogHandlers(
      ipc,
      (event) => {
        seen.push(event);
        void logger.append(toLogEntry(event));
      },
      () => ({ recovered: false, repeatedCrash: false }),
    );

    const event: NotificationEvent = {
      level: 'warning',
      channel: 'toast',
      code: 'FILE-005',
      message: 'm',
      timestamp: '2026-09-08T12:00:00.000Z',
    };
    await ipc.invoke('log:append', event);
    await logger.flush();

    expect(seen).toEqual([event]);
    const text = await readFile(join(root, 'logs', 'app-20260908.log'), 'utf8');
    expect(JSON.parse(text.trimEnd())).toMatchObject({ code: 'FILE-005' });
  });
});
