// UT-PERSIST-STORAGEMIG: `StorageMigrationService`（保存先の移行）と `runStorageMigration`（移行の順）
// 検証節: data-model-persistence.md 12 節・13.1 節
// UT: data-model-persistence.md 12 節・13.1 節、06_file_io_persistence.md §2.2、C14 — StorageMigrationService
// 検証観点: 13.1 節で「移す」としたファイルの写し、一時ファイルからの改名、読み戻しの照合と曲のファイルの checksum、
// 失敗で success=false、進捗コールバック、logs/ を含めないこと、古いフォルダを消さないこと、ロックと切り替えの順（C0/C1）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computeChecksum } from '../domain/checksum';
import { FakeFileSystemAdapterFactory } from '../testing/FakeFileSystemAdapter';

import {
  INDEX_FILE,
  LOGS_DIR,
  PREFERENCES_FILE,
  STORAGE_SETTINGS_FILE,
  TAGS_FILE,
  THUMBNAILS_DIR,
  TRASH_INDEX_FILE,
  TUNING_PRESETS_FILE,
} from './constants';
import { isSongFileInTree, PRIMARY_STORAGE_TREE, songIdFromFileName } from './paths';
import {
  runStorageMigration,
  StorageMigrationService,
  type MigrationLockTarget,
  type StorageMigrationRunDeps,
} from './StorageMigrationService';

const FROM = '/old/TabApp';
const TO = '/new/TabApp';

/** integrity.checksum を持つ曲のファイル。`valid` が false なら checksum を中身と合わない値にする。 */
function songFile(id: string, valid: boolean): unknown {
  const schemaVersion = '1.0.0';
  const song = { title: id };
  const appMeta = { sectionMarkers: [], memos: [], tags: [] };
  const checksum = valid ? computeChecksum(schemaVersion, song, appMeta as never) : `sha256:${'0'.repeat(64)}`;
  return {
    schemaVersion,
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    song,
    appMeta,
    integrity: { savedAtMonotonic: 1, checksum },
  };
}

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
    // UT-PERSIST-STORAGEMIG-01
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
    // UT-PERSIST-STORAGEMIG-02
    await service.migrate(FROM, TO);
    const dest = factory.createForRoot(TO);
    expect(dest.files.has(`${LOGS_DIR}/app.log`)).toBe(false);
  });

  it('migrate_MissingOptionalConfigFiles_AreSkippedNotFailed', async () => {
    // UT-PERSIST-STORAGEMIG-03
    // tuning-presets.json / settings.json / trash-index.json は用意していない → 失敗にしない。
    const result = await service.migrate(FROM, TO);
    expect(result.success).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('migrate_WriteFailureOnOneFile_ReportsFailureAndSuccessFalse', async () => {
    // UT-PERSIST-STORAGEMIG-04
    const dest = factory.createForRoot(TO);
    vi.spyOn(dest, 'writeFile').mockImplementation(async (path: string, data: Uint8Array) => {
      // 12 節の 3：写す先には一時ファイル（`.tmp`）に書いてから改名する
      if (path.startsWith('songs/s2.tabapp')) throw new Error('disk full');
      dest.files.set(path.replace(/^\.\//, ''), data);
    });

    const result = await service.migrate(FROM, TO);
    expect(result.success).toBe(false);
    expect(result.failures.map((f) => f.path)).toContain('songs/s2.tabapp');
    // 他ファイルはコピーされている（全件試行する）。
    expect(dest.files.has('songs/s1.tabapp')).toBe(true);
  });

  it('migrate_VerificationMismatch_ReportsFailure', async () => {
    // UT-PERSIST-STORAGEMIG-05
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
    // UT-PERSIST-STORAGEMIG-06
    const source = factory.createForRoot(FROM);
    vi.spyOn(source, 'listDirectory').mockRejectedValue(Object.assign(new Error('perm'), { code: 'FILE_READ_FAILED' }));
    await expect(service.migrate(FROM, TO)).rejects.toThrow('perm');
  });

  it('migrate_InvokesProgressCallbackForEachTarget', async () => {
    // UT-PERSIST-STORAGEMIG-07
    const onProgress = vi.fn();
    const result = await service.migrate(FROM, TO, onProgress);
    expect(onProgress).toHaveBeenCalledTimes(result.total);
    expect(onProgress).toHaveBeenLastCalledWith(result.total, result.total);
  });

  it('migrate_WritesTmpThenRenames_NoTmpLeftAtDestination', async () => {
    // UT-PERSIST-STORAGEMIG-08 data-model-persistence.md 12 節の 3：移す先に 15 節と同じ一時ファイルからの改名で書く
    const dest = factory.createForRoot(TO);
    const rename = vi.spyOn(dest, 'renameFile');
    await service.migrate(FROM, TO);
    expect(rename).toHaveBeenCalledWith('songs/s1.tabapp.tmp', 'songs/s1.tabapp');
    expect(rename).toHaveBeenCalledWith(`${INDEX_FILE}.tmp`, INDEX_FILE);
    expect([...dest.files.keys()].filter((p) => p.endsWith('.tmp'))).toEqual([]);
  });

  it('migrate_SongFileChecksumMatches_Succeeds', async () => {
    // UT-PERSIST-STORAGEMIG-09 12 節の 3：曲のファイルは読み戻したものの integrity.checksum も確かめる（合えば成功）
    factory.createForRoot(FROM).putJson('songs/s3.tabapp', songFile('s3', true));
    const result = await service.migrate(FROM, TO);
    expect(result.success).toBe(true);
    expect(factory.createForRoot(TO).readJson('songs/s3.tabapp')).toEqual(songFile('s3', true));
  });

  it('migrate_SongFileChecksumMismatch_ReportsFailure', async () => {
    // UT-PERSIST-STORAGEMIG-10 12 節の 3：バイトが同じでも integrity.checksum が合わなければ失敗（ゴミ箱の曲も同じ）
    factory.createForRoot(FROM).putJson('trash/t2.tabapp', songFile('t2', false));
    const result = await service.migrate(FROM, TO);
    expect(result.success).toBe(false);
    expect(result.failures.map((f) => f.path)).toEqual(['trash/t2.tabapp']);
  });

  it('migrate_ReadBackSameLengthButDifferentBytes_ReportsFailure', async () => {
    // UT-PERSIST-STORAGEMIG-23 12 節の 3：読み戻して、古いほうとバイトが全部同じかを確かめる（長さが同じでも中身が違えば失敗）
    const dest = factory.createForRoot(TO);
    const original = dest.readFile.bind(dest);
    vi.spyOn(dest, 'readFile').mockImplementation(async (path: string) => {
      const bytes = await original(path);
      if (path !== TAGS_FILE) return bytes;
      const flipped = bytes.slice();
      flipped[0] = flipped[0]! ^ 0xff;
      return flipped;
    });
    const result = await service.migrate(FROM, TO);
    expect(result.failures.map((f) => f.path)).toEqual([TAGS_FILE]);
  });

  it('migrate_SongFileWithChecksumButNoSchemaVersion_ReportsFailure', async () => {
    // UT-PERSIST-STORAGEMIG-24 12 節の 3：schemaVersion の無い曲のファイルは、checksum を作り直しても合わない
    const file = songFile('s4', true) as Record<string, unknown>;
    delete file['schemaVersion'];
    factory.createForRoot(FROM).putJson('songs/s4.tabapp', file);
    const result = await service.migrate(FROM, TO);
    expect(result.failures.map((f) => f.path)).toEqual(['songs/s4.tabapp']);
  });

  it('migrate_SongFileNotJson_ReportsFailure', async () => {
    // UT-PERSIST-STORAGEMIG-11 12 節の 3：checksum を確かめられない曲のファイルは失敗にする
    factory.createForRoot(FROM).putText('songs/broken.tabapp', '{not json');
    const result = await service.migrate(FROM, TO);
    expect(result.failures.map((f) => f.path)).toEqual(['songs/broken.tabapp']);
  });

  it('migrate_CopiesOnlyTreeEntriesMarkedMigrate_IncludingSubfoldersAndThumbnails', async () => {
    // UT-PERSIST-STORAGEMIG-12 13.1 節：songs/ はサブフォルダごと、thumbnails/ も移す。表に無いもの・logs/・一時ファイルは写さない
    const from = factory.createForRoot(FROM);
    from.putJson('songs/Rock/r1.tabapp', { id: 'r1' });
    from.putText(`${THUMBNAILS_DIR}/s1.png`, 'png');
    from.putJson(TUNING_PRESETS_FILE, []);
    from.putJson(STORAGE_SETTINGS_FILE, { storageLocation: { root: '/old', type: 'local' }, mirrorLocations: [] });
    from.putJson(TRASH_INDEX_FILE, []);
    from.putText('songs/s1.tabapp.tmp', 'half');
    from.putText('unknown.json', '{}');
    const result = await service.migrate(FROM, TO);
    const dest = factory.createForRoot(TO);
    expect(result.success).toBe(true);
    expect([...dest.files.keys()].sort()).toEqual(
      [
        'songs/s1.tabapp',
        'songs/s2.tabapp',
        'songs/Rock/r1.tabapp',
        'trash/t1.tabapp',
        TRASH_INDEX_FILE,
        INDEX_FILE,
        `${THUMBNAILS_DIR}/s1.png`,
        TUNING_PRESETS_FILE,
        TAGS_FILE,
        STORAGE_SETTINGS_FILE,
        PREFERENCES_FILE,
      ].sort(),
    );
    expect(result.copied).toBe(11);
  });

  it('migrate_DoesNotDeleteOldFolderFiles', async () => {
    // UT-PERSIST-STORAGEMIG-13 12 節：古いフォルダのファイルは自動で消さない
    const from = factory.createForRoot(FROM);
    const before = [...from.files.keys()].sort();
    await service.migrate(FROM, TO);
    expect([...from.files.keys()].sort()).toEqual(before);
  });

  it('migrate_MissingFilesCountInTotalButNotCopied', async () => {
    // UT-PERSIST-STORAGEMIG-14 12 節：まだ作られていない設定のファイルは写さず、失敗にも数えない
    const result = await service.migrate(FROM, TO);
    // songs 2・trash 1・直下のファイル 6（そのうち index・tags・preferences だけが在る）
    expect(result.total).toBe(9);
    expect(result.copied).toBe(6);
  });

  it('migrate_SourceReadErrorOtherThanNotFound_ReportsFailure', async () => {
    // UT-PERSIST-STORAGEMIG-15 12 節の 5：読めないファイルは失敗に数える（無いファイルとは分ける）
    const source = factory.createForRoot(FROM);
    const original = source.readFile.bind(source);
    vi.spyOn(source, 'readFile').mockImplementation(async (path: string) => {
      if (path === TAGS_FILE) throw Object.assign(new Error('locked'), { code: 'FILE_READ_FAILED' });
      return original(path);
    });
    const result = await service.migrate(FROM, TO);
    expect(result.failures.map((f) => f.path)).toEqual([TAGS_FILE]);
  });
});

describe('paths.ts（13.1 節の木）', () => {
  it('PRIMARY_STORAGE_TREE_MatchesTable_OnlyLogsNotMigrated', () => {
    // UT-PERSIST-STORAGEMIG-16 13.1 節の表：1 行に 1 つのパス、logs/ だけ移さない
    expect(PRIMARY_STORAGE_TREE.map((e) => e.path)).toEqual([
      'songs',
      'trash',
      'trash-index.json',
      'index.json',
      'thumbnails',
      'tuning-presets.json',
      'tags.json',
      'settings.json',
      'preferences.json',
      'logs',
    ]);
    expect(PRIMARY_STORAGE_TREE.filter((e) => !e.migrate).map((e) => e.path)).toEqual([LOGS_DIR]);
    expect(PRIMARY_STORAGE_TREE.every((e) => !e.path.includes(','))).toBe(true);
  });

  it('isSongFileInTree_OnlyTabappUnderSongsOrTrash', () => {
    // UT-PERSIST-STORAGEMIG-17 12 節の 3：checksum を確かめるのは曲のファイルだけ
    expect(isSongFileInTree('songs/a.tabapp')).toBe(true);
    expect(isSongFileInTree('songs/Rock/a.tabapp')).toBe(true);
    expect(isSongFileInTree('trash/a.tabapp')).toBe(true);
    expect(isSongFileInTree('thumbnails/a.tabapp')).toBe(false);
    expect(isSongFileInTree('songs/a.png')).toBe(false);
  });

  it('songIdFromFileName_OnlyNonEmptyIdWithTabappExtension', () => {
    // UT-PERSIST-STORAGEMIG-25 13.1 節：songs/ と trash/ の曲のファイルの名前は {songId}.tabapp
    expect(songIdFromFileName('abc.tabapp')).toBe('abc');
    expect(songIdFromFileName('abc.png')).toBeNull();
    expect(songIdFromFileName('.tabapp')).toBeNull();
    expect(songIdFromFileName('a/b.tabapp')).toBeNull();
  });
});

describe('runStorageMigration', () => {
  function makeDeps(overrides: Partial<StorageMigrationRunDeps> = {}): {
    deps: StorageMigrationRunDeps;
    order: string[];
    report: ReturnType<typeof vi.fn>;
  } {
    const order: string[] = [];
    const report = vi.fn((code: string) => order.push(`report:${code}`));
    const target = (name: string): MigrationLockTarget => ({
      lock: async () => {
        order.push(`lock:${name}`);
      },
      unlock: async () => {
        order.push(`unlock:${name}`);
      },
    });
    const deps: StorageMigrationRunDeps = {
      service: {
        migrate: async (from, to, onProgress) => {
          order.push('migrate');
          return service.migrate(from, to, onProgress);
        },
      },
      lockTargets: [target('w1'), target('w2')],
      switchPrimaryStorage: async (toRoot) => {
        order.push(`switch:${toRoot}`);
      },
      reporter: { report },
      ...overrides,
    };
    return { deps, order, report };
  }

  it('runStorageMigration_Success_LocksMigratesSwitchesThenUnlocksThenFile014', async () => {
    // UT-PERSIST-STORAGEMIG-18 12 節の (b)：ロック → 写す → 切り替えてからロックを解き、そのあとで FILE-014
    const { deps, order, report } = makeDeps();
    const result = await runStorageMigration(deps, FROM, TO);
    expect(result.success).toBe(true);
    expect(order).toEqual([
      'lock:w1',
      'lock:w2',
      'migrate',
      `switch:${TO}`,
      'unlock:w1',
      'unlock:w2',
      'report:FILE-014',
    ]);
    expect(report).toHaveBeenCalledWith('FILE-014');
  });

  it('runStorageMigration_CopyFailure_DoesNotSwitch_UnlocksThenFile013', async () => {
    // UT-PERSIST-STORAGEMIG-19 12 節の 5 と (b)：1 つでも失敗したら切り替えず、古いままロックを解いて FILE-013
    factory.createForRoot(FROM).putText('songs/broken.tabapp', '{not json');
    const { deps, order, report } = makeDeps();
    const result = await runStorageMigration(deps, FROM, TO);
    expect(result.success).toBe(false);
    expect(order).toEqual(['lock:w1', 'lock:w2', 'migrate', 'unlock:w1', 'unlock:w2', 'report:FILE-013']);
    expect(report).toHaveBeenCalledWith('FILE-013', { failedCount: 1, failedPaths: 'songs/broken.tabapp' });
  });

  it('runStorageMigration_LockFails_UnlocksLockedOnes_NoMigrate_File013', async () => {
    // UT-PERSIST-STORAGEMIG-20 12 節の (b)：flush を待てなかったら写さず、ロックした分を解いて FILE-013
    const { deps, order, report } = makeDeps();
    const failing: MigrationLockTarget = {
      lock: async () => {
        throw new Error('flush failed');
      },
      unlock: async () => {
        order.push('unlock:never');
      },
    };
    const result = await runStorageMigration({ ...deps, lockTargets: [deps.lockTargets[0]!, failing] }, FROM, TO);
    expect(result.success).toBe(false);
    expect(result.failures).toEqual([{ path: '', error: 'Error: flush failed' }]);
    expect(order).toEqual(['lock:w1', 'unlock:w1', 'report:FILE-013']);
    expect(report).toHaveBeenCalledWith('FILE-013', { failedCount: 1, failedPaths: '' });
  });

  it('runStorageMigration_SwitchFails_ReportsFailureAfterUnlock', async () => {
    // UT-PERSIST-STORAGEMIG-21 12 節の (b)：切り替えられなかったら失敗として、ロックを解いて FILE-013
    const { deps, order } = makeDeps({
      switchPrimaryStorage: async () => {
        throw new Error('pointer write failed');
      },
    });
    const result = await runStorageMigration(deps, FROM, TO);
    expect(result.success).toBe(false);
    expect(result.copied).toBe(6);
    expect(order.slice(-3)).toEqual(['unlock:w1', 'unlock:w2', 'report:FILE-013']);
  });

  it('runStorageMigration_PassesProgressToMigrate', async () => {
    // UT-PERSIST-STORAGEMIG-22 screens-navigation.md 12.10 節の 9 項目目：進み具合は migrate の onProgress から取る
    const { deps } = makeDeps({ lockTargets: [] });
    const onProgress = vi.fn();
    const result = await runStorageMigration(deps, FROM, TO, onProgress);
    expect(onProgress).toHaveBeenLastCalledWith(result.total, result.total);
  });
});
