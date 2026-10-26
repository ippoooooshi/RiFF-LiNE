// IT-FS-MIGRATE: data-model-persistence.md 12 節・13.1 節、基本設計 06 章 2.2 節 — 保存先の移行を実 I/O で通す
// 検証節: web-core-foundation.md 14.4 節の結合テストの表（ファイル I/O＋保存先の切り替え）と (b)：一時フォルダを保存先にして CI で回す
// 検証観点:
//  - ElectronFileSystemAdapterFactory で作ったふたつの保存先（os.tmpdir の下）の間で、StorageMigrationService が
//    13.1 節で「移す」としたファイルだけを、バイトが同じまま写す（logs/ と一時ファイルは写さない、古いフォルダは消さない）
//  - runStorageMigration の順（ロック → 写す → 切り替え → ロックを解く → FILE-014／失敗なら切り替えずに FILE-013）

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import {
  ChecksumUtil,
  runStorageMigration,
  StorageMigrationService,
  type MigrationLockTarget,
} from '@riff-line/core/persistence';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ElectronFileSystemAdapterFactory } from './ElectronFileSystemAdapterFactory';

let base: string;
let fromRoot: string;
let toRoot: string;
let factory: ElectronFileSystemAdapterFactory;
let service: StorageMigrationService;

/** integrity.checksum を持つ曲のファイルの中身。`valid` が false なら checksum を中身と合わない値にする。 */
function songFileText(id: string, valid = true): string {
  const schemaVersion = '1.0.0';
  const song = { title: id };
  const appMeta = { sectionMarkers: [], memos: [], tags: [] };
  const checksum = valid ? ChecksumUtil.compute(schemaVersion, song, appMeta as never) : `sha256:${'0'.repeat(64)}`;
  return JSON.stringify({
    schemaVersion,
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    song,
    appMeta,
    integrity: { savedAtMonotonic: 1, checksum },
  });
}

async function put(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = join(root, ...relativePath.split('/'));
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, text);
}

/** ルートの下の全ファイルを `/` 区切りの相対パスで並べる。 */
async function listAll(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

/** 古い保存先に、13.1 節の木の全部（移さない logs/ と、残った一時ファイルも）を置く。 */
async function seedOldStorage(): Promise<void> {
  await put(fromRoot, 'songs/s1.tabapp', songFileText('s1'));
  await put(fromRoot, 'songs/Rock/r1.tabapp', songFileText('r1'));
  await put(fromRoot, 'songs/s1.tabapp.tmp', 'half-written');
  await put(fromRoot, 'trash/t1.tabapp', songFileText('t1'));
  await put(fromRoot, 'trash-index.json', '[{"songId":"t1","deletedAt":"2026-01-02T00:00:00.000Z"}]');
  await put(fromRoot, 'index.json', '[]');
  await put(fromRoot, 'thumbnails/s1.png', 'png-bytes');
  await put(fromRoot, 'tuning-presets.json', '[]');
  await put(fromRoot, 'tags.json', '[{"id":"a","name":"Rock"}]');
  await put(fromRoot, 'settings.json', '{"storageLocation":{"root":"x","type":"local"},"mirrorLocations":[]}');
  await put(fromRoot, 'preferences.json', '{"trashRetentionDays":30}');
  await put(fromRoot, 'logs/app-20260101.log', '{"level":"info"}');
}

const MIGRATED = [
  'index.json',
  'preferences.json',
  'settings.json',
  'songs/Rock/r1.tabapp',
  'songs/s1.tabapp',
  'tags.json',
  'thumbnails/s1.png',
  'trash-index.json',
  'trash/t1.tabapp',
  'tuning-presets.json',
];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'riffline-migrate-'));
  fromRoot = join(base, 'old', 'TabApp');
  toRoot = join(base, 'new', 'TabApp');
  factory = new ElectronFileSystemAdapterFactory({ retryOnDemandDownload: false });
  service = new StorageMigrationService(factory);
  await seedOldStorage();
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('StorageMigrationService × ElectronFileSystemAdapterFactory（実 I/O）', () => {
  it('migrate_RealFolders_CopiesMigratedFilesByteForByte_SkipsLogsAndTmp_KeepsOldFolder', async () => {
    // IT-FS-MIGRATE-01 12 節の 2〜3・13.1 節：新しい保存先の TabApp/ がまだ無くても作って写す
    const before = await listAll(fromRoot);
    const result = await service.migrate(fromRoot, toRoot);

    expect(result).toEqual({ success: true, copied: MIGRATED.length, total: MIGRATED.length, failures: [] });
    expect(await listAll(toRoot)).toEqual(MIGRATED);
    for (const path of MIGRATED) {
      const from = await readFile(join(fromRoot, ...path.split('/')));
      const to = await readFile(join(toRoot, ...path.split('/')));
      expect(to.equals(from), path).toBe(true);
    }
    // 古いフォルダのファイルは自動で消さない（logs/ も古い保存先にそのまま残る）
    expect(await listAll(fromRoot)).toEqual(before);
  });

  it('runStorageMigration_RealFolders_Success_SwitchesBeforeUnlock_ThenFile014', async () => {
    // IT-FS-MIGRATE-02 12 節の (b)：flush を待ってロック → 写す → 切り替えてからロックを解き、そのあとで FILE-014
    const order: string[] = [];
    const window: MigrationLockTarget = {
      lock: async () => {
        order.push('lock');
      },
      unlock: async () => {
        order.push('unlock');
      },
    };
    const report = vi.fn((code: string) => order.push(code));
    const progress: [number, number][] = [];

    const result = await runStorageMigration(
      {
        service,
        lockTargets: [window],
        switchPrimaryStorage: async (root) => {
          order.push(`switch:${root === toRoot}`);
        },
        reporter: { report },
      },
      fromRoot,
      toRoot,
      (done, total) => progress.push([done, total]),
    );

    expect(result.success).toBe(true);
    expect(order).toEqual(['lock', 'switch:true', 'unlock', 'FILE-014']);
    expect(progress.at(-1)).toEqual([MIGRATED.length, MIGRATED.length]);
  });

  it('runStorageMigration_RealFolders_ChecksumMismatch_DoesNotSwitch_File013', async () => {
    // IT-FS-MIGRATE-03 12 節の 3・5：読み戻した曲のファイルの integrity.checksum が合わなければ、切り替えずに FILE-013
    await put(fromRoot, 'songs/bad.tabapp', songFileText('bad', false));
    const switchPrimaryStorage = vi.fn(async () => {});
    const report = vi.fn();

    const result = await runStorageMigration(
      { service, lockTargets: [], switchPrimaryStorage, reporter: { report } },
      fromRoot,
      toRoot,
    );

    expect(result.success).toBe(false);
    expect(result.failures.map((f) => f.path)).toEqual(['songs/bad.tabapp']);
    expect(switchPrimaryStorage).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('FILE-013', { failedCount: 1, failedPaths: 'songs/bad.tabapp' });
    // 古いフォルダの曲はそのまま
    expect(await readFile(join(fromRoot, 'songs', 'bad.tabapp'), 'utf8')).toBe(songFileText('bad', false));
  });

  it('migrate_RealFolders_DestinationNotWritable_AllFail', async () => {
    // IT-FS-MIGRATE-04 12 節の 5：新しい保存先に書けなければ全部を失敗に数え、success は false
    await writeFile(join(base, 'blocked'), 'not a folder');
    const result = await service.migrate(fromRoot, join(base, 'blocked', 'TabApp'));
    expect(result.success).toBe(false);
    expect(result.copied).toBe(0);
    expect(result.failures.map((f) => f.path).sort()).toEqual(MIGRATED);
  });
});
