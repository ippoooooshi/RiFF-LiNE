// UT: data-model-persistence.md §3.2・§5、06_file_io_persistence.md §2.2、C14 — StorageMigrationService
// 検証観点: songs/・trash/・各設定ファイルのコピー、照合失敗で success=false、進捗コールバック、
// logs/ を含めないこと（C0/C1）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFileSystemAdapterFactory } from '../testing/FakeFileSystemAdapter';

import { INDEX_FILE, LOGS_DIR, PREFERENCES_FILE, TAGS_FILE } from './constants';
import { StorageMigrationService } from './StorageMigrationService';

const FROM = '/old/TabApp';
const TO = '/new/TabApp';

let factory: FakeFileSystemAdapterFactory;
let service: StorageMigrationService;

beforeEach(() => {
  factory = new FakeFileSystemAdapterFactory();
  const from = factory.createForRoot(FROM);
  from.putJson('songs/s1.tabapp', { id: 's1' });
  from.putJson('songs/s2.tabapp', { id: 's2' });
  from.putJson('trash/t1.tabapp', { id: 't1' });
  from.putJson(INDEX_FILE, [{ id: 's1' }]);
  from.putJson(TAGS_FILE, [{ id: 'tag1', name: 'Rock' }]);
  from.putJson(PREFERENCES_FILE, { defaultZoom: 1 });
  from.putText(`${LOGS_DIR}/app.log`, 'noise'); // 移行対象外（C14）
  service = new StorageMigrationService(factory);
});

describe('StorageMigrationService.migrate', () => {
  it('migrate_CopiesSongsTrashAndConfigFiles_ReportsSuccess', async () => {
    const result = await service.migrate(FROM, TO);
    const dest = factory.createForRoot(TO);

    expect(result.success).toBe(true);
    expect(dest.readJson('songs/s1.tabapp')).toEqual({ id: 's1' });
    expect(dest.readJson('songs/s2.tabapp')).toEqual({ id: 's2' });
    expect(dest.readJson('trash/t1.tabapp')).toEqual({ id: 't1' });
    expect(dest.readJson(INDEX_FILE)).toEqual([{ id: 's1' }]);
    expect(dest.readJson(TAGS_FILE)).toEqual([{ id: 'tag1', name: 'Rock' }]);
    expect(dest.readJson(PREFERENCES_FILE)).toEqual({ defaultZoom: 1 });
  });

  it('migrate_DoesNotCopyLogsFolder', async () => {
    await service.migrate(FROM, TO);
    const dest = factory.createForRoot(TO);
    expect(dest.files.has(`${LOGS_DIR}/app.log`)).toBe(false);
  });

  it('migrate_MissingOptionalConfigFiles_AreSkippedNotFailed', async () => {
    // tuning-presets.json / settings.json / trash-index.json は用意していない → 失敗にしない。
    const result = await service.migrate(FROM, TO);
    expect(result.success).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('migrate_WriteFailureOnOneFile_ReportsFailureAndSuccessFalse', async () => {
    const dest = factory.createForRoot(TO);
    vi.spyOn(dest, 'writeFile').mockImplementation(async (path: string, data: Uint8Array) => {
      if (path === 'songs/s2.tabapp') throw new Error('disk full');
      dest.files.set(path.replace(/^\.\//, ''), data);
    });

    const result = await service.migrate(FROM, TO);
    expect(result.success).toBe(false);
    expect(result.failures.map((f) => f.path)).toContain('songs/s2.tabapp');
    // 他ファイルはコピーされている（全件試行する）。
    expect(dest.files.has('songs/s1.tabapp')).toBe(true);
  });

  it('migrate_VerificationMismatch_ReportsFailure', async () => {
    const dest = factory.createForRoot(TO);
    // 書き込みは黙って別内容にすり替える → 読み戻し照合で不一致。
    vi.spyOn(dest, 'writeFile').mockImplementation(async (path: string) => {
      dest.files.set(path.replace(/^\.\//, ''), new TextEncoder().encode('tampered'));
    });
    const result = await service.migrate(FROM, TO);
    expect(result.success).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('migrate_ListDirectoryNonEnoentError_Propagates', async () => {
    const source = factory.createForRoot(FROM);
    vi.spyOn(source, 'listDirectory').mockRejectedValue(Object.assign(new Error('perm'), { code: 'FILE_READ_FAILED' }));
    await expect(service.migrate(FROM, TO)).rejects.toThrow('perm');
  });

  it('migrate_InvokesProgressCallbackForEachTarget', async () => {
    const onProgress = vi.fn();
    const result = await service.migrate(FROM, TO, onProgress);
    expect(onProgress).toHaveBeenCalledTimes(result.total);
    expect(onProgress).toHaveBeenLastCalledWith(result.total, result.total);
  });
});
