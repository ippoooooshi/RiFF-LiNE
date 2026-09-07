// UT: data-model-persistence.md §3.2・§4.3・§9.6、06_file_io_persistence.md §4、B26、FILE-005 — MirrorSyncService
// 検証観点: fire-and-forget（呼び出し元を待たせない）、awaitPending の完了待ち・タイムアウト、例外を外へ出さない（C0/C1）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFileSystemAdapter, FakeFileSystemAdapterFactory } from '../testing/FakeFileSystemAdapter';

import { MirrorSyncService } from './MirrorSyncService';
import { songFilePath } from './paths';

let source: FakeFileSystemAdapter;
let factory: FakeFileSystemAdapterFactory;
let service: MirrorSyncService;

const MIRROR_A = '/mirror-a/TabApp';
const MIRROR_B = '/mirror-b/TabApp';

beforeEach(() => {
  source = new FakeFileSystemAdapter({ rootPath: '/active/TabApp' });
  source.dirs.add('songs');
  source.putText(songFilePath('s1'), '{"song":true}');
  factory = new FakeFileSystemAdapterFactory();
  service = new MirrorSyncService(source, factory);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MirrorSyncService.syncAfterSave', () => {
  it('syncAfterSave_ReturnsSynchronously_ThenCopiesInBackground', async () => {
    const ret = service.syncAfterSave('s1', [MIRROR_A, MIRROR_B]);
    expect(ret).toBeUndefined(); // 呼び出し元は結果を待たない

    await service.awaitPending();
    expect(factory.createForRoot(MIRROR_A).readText(songFilePath('s1'))).toBe('{"song":true}');
    expect(factory.createForRoot(MIRROR_B).readText(songFilePath('s1'))).toBe('{"song":true}');
  });

  it('syncAfterSave_NoMirrors_DoesNothing', async () => {
    service.syncAfterSave('s1', []);
    await service.awaitPending();
    expect(factory.byRoot.size).toBe(0);
  });

  it('syncAfterSave_MirrorWriteFails_DoesNotThrowAndOtherMirrorsStillCopied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const badMirror = factory.createForRoot(MIRROR_A);
    vi.spyOn(badMirror, 'writeFile').mockRejectedValue(new Error('offline'));

    service.syncAfterSave('s1', [MIRROR_A, MIRROR_B]);
    await service.awaitPending();

    expect(factory.createForRoot(MIRROR_B).files.has(songFilePath('s1'))).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('syncAfterSave_SourceReadFails_LogsAndSkips', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(source, 'readFile').mockRejectedValue(new Error('gone'));
    service.syncAfterSave('s1', [MIRROR_A]);
    await service.awaitPending();
    expect(factory.createForRoot(MIRROR_A).files.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('MirrorSyncService.awaitPending', () => {
  it('awaitPending_NothingPending_ResolvesImmediately', async () => {
    await expect(service.awaitPending(10)).resolves.toBeUndefined();
  });

  it('awaitPending_WaitsForInFlightCopies', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(factory.createForRoot(MIRROR_A), 'writeFile').mockImplementation(async () => {
      await gate;
    });

    service.syncAfterSave('s1', [MIRROR_A]);
    let settled = false;
    const waiting = service.awaitPending(5000).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await waiting;
    expect(settled).toBe(true);
  });

  it('awaitPending_Timeout_ResolvesWithoutThrowingAndLogsWarning', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(factory.createForRoot(MIRROR_A), 'writeFile').mockImplementation(
      () => new Promise<void>(() => {}), // 永遠に未解決
    );

    service.syncAfterSave('s1', [MIRROR_A]);
    const waiting = service.awaitPending(15000);
    await vi.advanceTimersByTimeAsync(15000);
    await expect(waiting).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('タイムアウト'), expect.anything());
    warn.mockRestore();
  });
});
