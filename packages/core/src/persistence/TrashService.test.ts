// UT: data-model-persistence.md §3.2・§4.4・§8、06_file_io_persistence.md §7、B9・B29 — TrashService
// 検証観点: moveToTrash / restore、purgeExpired の保持期間境界（29/30/31 日）、permanentlyDelete、
// trash-index.json 破損時の再構築（C0/C1）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { TRASH_INDEX_FILE } from './constants';
import { songFilePath, trashFilePath } from './paths';
import { SongIndexService } from './SongIndexService';
import { TrashService, type TrashEntry } from './TrashService';

const MS_PER_DAY = 86_400_000;
const NOW = Date.parse('2026-06-01T00:00:00.000Z');

let fs: FakeFileSystemAdapter;
let index: SongIndexService;
let trash: TrashService;

function songFileJson(id: string): unknown {
  return {
    schemaVersion: '1.0.0',
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    song: { title: id },
    appMeta: { tags: [], memos: [], sectionMarkers: [], settings: {}, thumbnail: null },
    integrity: { savedAtMonotonic: 0, checksum: 'sha256:x' },
  };
}

beforeEach(() => {
  fs = new FakeFileSystemAdapter();
  fs.dirs.add('songs');
  fs.dirs.add('trash');
  index = new SongIndexService(fs);
  trash = new TrashService(fs, index, () => NOW);
});

describe('TrashService.moveToTrash / restore', () => {
  it('moveToTrash_MovesFileAndRecordsDeletedAtAndUpdatesIndex', async () => {
    fs.putJson(songFilePath('s1'), songFileJson('s1'));
    fs.putJson('index.json', [
      { id: 's1', title: 's1', updatedAt: '', tags: [], thumbnailRef: null, isTrashed: false },
    ]);

    await trash.moveToTrash('s1');

    expect(fs.files.has(songFilePath('s1'))).toBe(false);
    expect(fs.files.has(trashFilePath('s1'))).toBe(true);
    const entries = fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE);
    expect(entries).toEqual([{ songId: 's1', deletedAt: new Date(NOW).toISOString() }]);
    expect(await index.load()).toEqual([]);
  });

  it('restore_MovesBackAndReAddsToIndexAndRemovesTrashEntry', async () => {
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString() }]);

    await trash.restore('s1');

    expect(fs.files.has(songFilePath('s1'))).toBe(true);
    expect(fs.files.has(trashFilePath('s1'))).toBe(false);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toEqual([]);
    expect((await index.load()).map((s) => s.id)).toEqual(['s1']);
  });
});

describe('TrashService.purgeExpired', () => {
  const at = (daysAgo: number): string => new Date(NOW - daysAgo * MS_PER_DAY).toISOString();

  beforeEach(() => {
    for (const id of ['d29', 'd30', 'd31']) fs.putJson(trashFilePath(id), songFileJson(id));
    fs.putJson(TRASH_INDEX_FILE, [
      { songId: 'd29', deletedAt: at(29) },
      { songId: 'd30', deletedAt: at(30) },
      { songId: 'd31', deletedAt: at(31) },
    ]);
  });

  it('purgeExpired_DefaultRetention_PurgesAtOrBeyond30Days', async () => {
    const purged = await trash.purgeExpired();
    expect(purged).toBe(2); // d30（境界）と d31
    expect(fs.files.has(trashFilePath('d29'))).toBe(true);
    expect(fs.files.has(trashFilePath('d30'))).toBe(false);
    expect(fs.files.has(trashFilePath('d31'))).toBe(false);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE).map((e) => e.songId)).toEqual(['d29']);
  });

  it('purgeExpired_CustomRetention_UsesGivenThreshold', async () => {
    expect(await trash.purgeExpired(31)).toBe(1); // d31 のみ
  });

  it('purgeExpired_NothingExpired_ReturnsZeroAndKeepsIndex', async () => {
    expect(await trash.purgeExpired(90)).toBe(0);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toHaveLength(3);
  });
});

describe('TrashService.permanentlyDelete', () => {
  it('permanentlyDelete_RemovesFileAndTrashEntry', async () => {
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString() }]);
    await trash.permanentlyDelete('s1');
    expect(fs.files.has(trashFilePath('s1'))).toBe(false);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toEqual([]);
  });
});

describe('TrashService trash-index.json recovery', () => {
  it('loadIndex_Corrupt_RebuildsFromTrashFolder', async () => {
    fs.putJson(trashFilePath('a'), songFileJson('a'));
    fs.putText(TRASH_INDEX_FILE, 'garbage{');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // moveToTrash 経由で loadIndex を走らせる（再構築 → a を拾う）。
    fs.putJson(songFilePath('b'), songFileJson('b'));
    await trash.moveToTrash('b');

    const entries = fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE);
    expect(entries.map((e) => e.songId).sort()).toEqual(['a', 'b']);
    warn.mockRestore();
  });
});
