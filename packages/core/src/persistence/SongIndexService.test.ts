// UT: data-model-persistence.md §3.2、06_file_io_persistence.md §10 — SongIndexService
// 検証観点: load / upsert / remove、index.json 欠落・破損時の rebuild フォールバック（C0/C1）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileReadError } from '../platform/errors';

import type { SongSummary } from '../domain/types';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { INDEX_FILE } from './constants';
import { SongIndexService, toSongSummary } from './SongIndexService';

let fs: FakeFileSystemAdapter;
let service: SongIndexService;

const summary = (id: string, title: string): SongSummary => ({
  id,
  title,
  updatedAt: '2026-01-01T00:00:00.000Z',
  tags: [],
  thumbnailRef: null,
  isTrashed: false,
});

function songFile(id: string, title: string): unknown {
  return {
    schemaVersion: '1.0.0',
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    song: { title },
    appMeta: { tags: [{ tagId: 't1' }], memos: [], sectionMarkers: [], settings: {}, thumbnail: null },
    integrity: { savedAtMonotonic: 1700000000000, checksum: 'sha256:x' },
  };
}

beforeEach(() => {
  fs = new FakeFileSystemAdapter();
  fs.dirs.add('songs');
  service = new SongIndexService(fs);
});

describe('toSongSummary', () => {
  it('toSongSummary_ExtractsLightweightFields', () => {
    const s = toSongSummary({
      id: 'a',
      song: { title: 'Hello' },
      appMeta: { tags: [{ tagId: 'x' }, { tagId: 'y' }], thumbnail: { encoding: 'base64-png', data: 'z' } },
      integrity: { savedAtMonotonic: 0 },
    });
    expect(s).toEqual({
      id: 'a',
      title: 'Hello',
      updatedAt: new Date(0).toISOString(),
      tags: ['x', 'y'],
      thumbnailRef: 'a',
      isTrashed: false,
    });
  });

  it('toSongSummary_MissingTitle_UsesPlaceholder', () => {
    expect(toSongSummary({ id: 'a' }).title).toBe('(無題)');
  });
});

describe('SongIndexService', () => {
  it('load_MissingIndex_RebuildsFromSongsFolder', async () => {
    fs.putJson('songs/s1.tabapp', songFile('s1', 'One'));
    fs.putJson('songs/s2.tabapp', songFile('s2', 'Two'));

    const list = await service.load();
    expect(list.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(list.find((s) => s.id === 's1')!.title).toBe('One');
    // 再構築結果が index.json に書き戻されている。
    expect(fs.readJson<SongSummary[]>(INDEX_FILE)).toHaveLength(2);
  });

  it('load_ValidIndex_ReturnsParsed', async () => {
    fs.putJson(INDEX_FILE, [summary('s1', 'One')]);
    expect(await service.load()).toEqual([summary('s1', 'One')]);
  });

  it('load_CorruptIndex_FallsBackToRebuild', async () => {
    fs.putText(INDEX_FILE, '{ not json');
    fs.putJson('songs/s9.tabapp', songFile('s9', 'Nine'));
    const list = await service.load();
    expect(list.map((s) => s.id)).toEqual(['s9']);
  });

  it('load_IndexNotArray_FallsBackToRebuild', async () => {
    fs.putJson(INDEX_FILE, { nope: true });
    expect(await service.load()).toEqual([]);
  });

  it('load_NonEnoentReadError_WarnsAndFallsBackToRebuild', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new FileReadError(INDEX_FILE));
    fs.putJson('songs/s7.tabapp', songFile('s7', 'Seven'));
    const list = await service.load();
    expect(list.map((s) => s.id)).toEqual(['s7']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rebuildFromSongsFolder_ListDirectoryNonEnoentError_Rethrows', async () => {
    vi.spyOn(fs, 'listDirectory').mockRejectedValueOnce(new FileReadError('songs'));
    await expect(service.rebuildFromSongsFolder()).rejects.toBeInstanceOf(FileReadError);
  });

  it('upsert_AddsThenUpdatesInPlace', async () => {
    await service.upsert(summary('s1', 'One'));
    await service.upsert(summary('s2', 'Two'));
    await service.upsert({ ...summary('s1', 'One!'), title: 'One!' });

    const list = await service.load();
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.id === 's1')!.title).toBe('One!');
  });

  it('remove_DropsEntry', async () => {
    fs.putJson(INDEX_FILE, [summary('s1', 'One'), summary('s2', 'Two')]);
    await service.remove('s1');
    expect((await service.load()).map((s) => s.id)).toEqual(['s2']);
  });

  it('remove_MissingEntry_NoError', async () => {
    fs.putJson(INDEX_FILE, [summary('s1', 'One')]);
    await expect(service.remove('nope')).resolves.toBeUndefined();
  });

  it('rebuildFromSongsFolder_SkipsCorruptSongFiles', async () => {
    fs.putJson('songs/ok.tabapp', songFile('ok', 'OK'));
    fs.putText('songs/broken.tabapp', 'not json at all');
    const list = await service.rebuildFromSongsFolder();
    expect(list.map((s) => s.id)).toEqual(['ok']);
  });

  it('rebuildFromSongsFolder_NoSongsDir_ReturnsEmptyAndWritesEmptyIndex', async () => {
    const bare = new FakeFileSystemAdapter();
    const svc = new SongIndexService(bare);
    expect(await svc.rebuildFromSongsFolder()).toEqual([]);
    expect(bare.readJson<SongSummary[]>(INDEX_FILE)).toEqual([]);
  });
});
