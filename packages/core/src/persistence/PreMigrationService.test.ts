// UT-PERSIST-PREMIG: `PreMigrationService`（変換する前の版を PreMigration/ に残し、30 日を過ぎたものを起動のときに消す）
// 検証節: data-model-persistence.md 8 節・13.2 節
// 検証観点: 中身を変えずに {songId}.{変換する前の schemaVersion}.tabapp へ写すこと、残してから 30 日を過ぎたものだけを消して
// 消した数を返すこと、フォルダがまだ無いときは 0、ほかの読み込みの失敗は伝えること（C0/C1）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DirEntry } from '../platform';
import { FileNotFoundError, FileReadError } from '../platform/errors';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import {
  PRE_MIGRATION_DIR,
  PRE_MIGRATION_RETENTION_DAYS,
  PreMigrationService,
  preMigrationFileName,
} from './PreMigrationService';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-27T00:00:00.000Z');

let adapter: FakeFileSystemAdapter;
let service: PreMigrationService;

beforeEach(() => {
  adapter = new FakeFileSystemAdapter({ rootPath: '/userData/PreMigration' });
  service = new PreMigrationService(adapter, () => NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fileEntry(name: string, ageDays: number): DirEntry {
  return { name, isDirectory: false, sizeBytes: 1, modifiedAt: new Date(NOW - ageDays * DAY).toISOString() };
}

describe('PreMigrationService.preserve', () => {
  it('preserve_WritesUnchangedBytesUnderSongIdAndOldVersion', async () => {
    // UT-PERSIST-PREMIG-01 data-model-persistence.md 8 節：読んだ曲のファイルを中身を変えずに {songId}.{変換する前の schemaVersion}.tabapp へ写す
    adapter.dirs.clear();
    const bytes = new TextEncoder().encode('{"schemaVersion":"1.0.0"}');
    await service.preserve('song-1', '1.0.0', bytes);
    expect(adapter.files.get('song-1.1.0.0.tabapp')).toEqual(bytes);
    expect(preMigrationFileName('song-1', '1.0.0')).toBe('song-1.1.0.0.tabapp');
  });

  it('preserve_Constants_FolderNameAndRetention', () => {
    // UT-PERSIST-PREMIG-02 data-model-persistence.md 8 節・13.2 節：フォルダは LocalBackup/ と並ぶ PreMigration/、残してから 30 日で消す
    expect(PRE_MIGRATION_DIR).toBe('PreMigration');
    expect(PRE_MIGRATION_RETENTION_DAYS).toBe(30);
  });
});

describe('PreMigrationService.purgeExpired', () => {
  it('purgeExpired_DeletesOnlyFilesOlderThan30Days_ReturnsCount', async () => {
    // UT-PERSIST-PREMIG-03 data-model-persistence.md 8 節：30 日を過ぎたものを消し、消した数を返す
    for (const name of ['old.1.0.0.tabapp', 'edge.1.0.0.tabapp', 'young.1.0.0.tabapp', 'note.txt']) {
      adapter.putText(name, 'x');
    }
    vi.spyOn(adapter, 'listDirectory').mockResolvedValue([
      fileEntry('old.1.0.0.tabapp', 45),
      fileEntry('edge.1.0.0.tabapp', 30),
      fileEntry('young.1.0.0.tabapp', 29.9),
      fileEntry('note.txt', 90),
      { name: 'sub', isDirectory: true, sizeBytes: 0, modifiedAt: new Date(0).toISOString() },
    ]);
    await expect(service.purgeExpired()).resolves.toBe(2);
    expect([...adapter.files.keys()].sort()).toEqual(['note.txt', 'young.1.0.0.tabapp']);
  });

  it('purgeExpired_UnparsableModifiedAt_Kept', async () => {
    // UT-PERSIST-PREMIG-04 data-model-persistence.md 8 節：残した時刻が読めないものは 30 日を過ぎたと言えないので消さない
    adapter.putText('odd.1.0.0.tabapp', 'x');
    vi.spyOn(adapter, 'listDirectory').mockResolvedValue([
      { name: 'odd.1.0.0.tabapp', isDirectory: false, sizeBytes: 1, modifiedAt: 'not-a-date' },
    ]);
    await expect(service.purgeExpired()).resolves.toBe(0);
    expect(adapter.files.has('odd.1.0.0.tabapp')).toBe(true);
  });

  it('purgeExpired_FolderNotCreatedYet_ReturnsZero', async () => {
    // UT-PERSIST-PREMIG-05 data-model-persistence.md 8 節：まだ 1 曲も変換していない（フォルダが無い）ときは 0
    vi.spyOn(adapter, 'listDirectory').mockRejectedValue(new FileNotFoundError('.'));
    await expect(service.purgeExpired()).resolves.toBe(0);
  });

  it('purgeExpired_OtherReadFailure_Rethrows', async () => {
    // UT-PERSIST-PREMIG-06 data-model-persistence.md 8 節：フォルダが無い以外の読み込みの失敗は呼び出し元へ伝える
    vi.spyOn(adapter, 'listDirectory').mockRejectedValue(new FileReadError('.'));
    await expect(service.purgeExpired()).rejects.toBeInstanceOf(FileReadError);
  });

  it('purgeExpired_DefaultClock_UsesDateNow', async () => {
    // UT-PERSIST-PREMIG-07 data-model-persistence.md 8 節：時刻を渡さなければ今の時刻で数える
    const real = new PreMigrationService(adapter);
    adapter.putText('a.1.0.0.tabapp', 'x');
    vi.spyOn(adapter, 'listDirectory').mockResolvedValue([
      {
        name: 'a.1.0.0.tabapp',
        isDirectory: false,
        sizeBytes: 1,
        modifiedAt: new Date(Date.now() - 31 * DAY).toISOString(),
      },
    ]);
    await expect(real.purgeExpired()).resolves.toBe(1);
  });
});
