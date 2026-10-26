// UT-PERSIST-INDEX: `SongIndexService`（`index.json` と再構築）
// 検証節: data-model-persistence.md 9 節・9.1 節
// UT: data-model-persistence.md 9 節・9.1 節、06_file_io_persistence.md 10 節 — SongIndexService
// 検証観点: SongSummary の 10 項目、load / upsert / remove の差分と一時ファイルからの改名、
// index.json 欠落・破損時の rebuild（サブフォルダを含む）と SONG-003、サムネイルの写しの書き方と作り直し（C0/C1）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileReadError } from '../platform/errors';

import { SongDocument, createEmptyAppMetadata } from '../domain/SongDocument';
import { STANDARD_BASS_TUNING, createInitialScore } from '../domain/newSong';
import type { SongSummary } from '../domain/types';
import { notificationCenter } from '../errors';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { INDEX_FILE } from './constants';
import { songFilePath, thumbnailFilePath } from './paths';
import { SongIndexService, summarizeSong, toSongSummary, writeThumbnailCopy } from './SongIndexService';

let fs: FakeFileSystemAdapter;
let service: SongIndexService;

const summary = (id: string, title: string, folder = ''): SongSummary => ({
  id,
  title,
  artist: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tags: [],
  thumbnailRef: null,
  firstPartInstrumentType: 'electric_guitar',
  firstPartTuningName: '',
  folder,
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

/** PNG の先頭 8 バイト（シグネチャ）を base64 にしたもの。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_BASE64 = btoa(String.fromCharCode(...PNG_SIGNATURE));

/** 実際の Score から作った曲のファイル（ベース 1 本、チューニング名 Drop D）。 */
function bassSongFile(id: string, thumbnail: string | null = null): unknown {
  const score = createInitialScore({
    title: 'Bass Song',
    parts: [{ name: 'Bass', instrumentType: 'bass', tuning: [...STANDARD_BASS_TUNING] }],
  });
  score.artist = 'Someone';
  score.tracks[0]!.staves[0]!.stringTuning.name = 'Drop D';
  const appMeta = createEmptyAppMetadata();
  appMeta.thumbnail = thumbnail === null ? null : { encoding: 'base64-png', data: thumbnail };
  const doc = new SongDocument({ id, score, appMeta, createdAt: '2025-12-31T00:00:00.000Z' });
  return doc.toFileJson(Date.parse('2026-02-03T04:05:06.000Z'));
}

beforeEach(() => {
  fs = new FakeFileSystemAdapter();
  fs.dirs.add('songs');
  service = new SongIndexService(fs);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toSongSummary', () => {
  it('toSongSummary_ExtractsLightweightFields', () => {
    // UT-PERSIST-INDEX-01
    const s = toSongSummary({
      id: 'a',
      song: { title: 'Hello' },
      appMeta: { tags: [{ tagId: 'x' }, { tagId: 'y' }], thumbnail: { encoding: 'base64-png', data: 'z' } },
      integrity: { savedAtMonotonic: 0 },
    });
    expect(s).toEqual({
      id: 'a',
      title: 'Hello',
      artist: '',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      tags: ['x', 'y'],
      thumbnailRef: 'thumbnails/a.png',
      firstPartInstrumentType: null,
      firstPartTuningName: null,
      folder: '',
    });
  });

  it('toSongSummary_MissingTitle_UsesPlaceholder', () => {
    // UT-PERSIST-INDEX-02
    expect(toSongSummary({ id: 'a' }).title).toBe('(無題)');
  });

  it('toSongSummary_RealScore_HasTenItemsFromScoreAndFile', () => {
    // UT-PERSIST-INDEX-14 9 節：artist・createdAt・先頭のパートの代表値・folder を足した 10 項目
    const s = toSongSummary(bassSongFile('b1') as Parameters<typeof toSongSummary>[0], 'live/2026');
    expect(s).toEqual({
      id: 'b1',
      title: 'Bass Song',
      artist: 'Someone',
      createdAt: '2025-12-31T00:00:00.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z',
      tags: [],
      thumbnailRef: null,
      firstPartInstrumentType: 'bass',
      firstPartTuningName: 'Drop D',
      folder: 'live/2026',
    });
  });

  it('summarizeSong_NoParts_RepresentativeValuesAreNull', () => {
    // UT-PERSIST-INDEX-15 9 節 (b)：パートが 0 の曲では代表値の 2 つを null にする
    const score = createInitialScore({ title: 'Empty' });
    score.tracks.length = 0;
    const s = summarizeSong({
      id: 'e',
      createdAt: '2026-01-01T00:00:00.000Z',
      score,
      appMeta: undefined,
      savedAtMonotonic: undefined,
      folder: '',
    });
    expect(s.firstPartInstrumentType).toBeNull();
    expect(s.firstPartTuningName).toBeNull();
    expect(s.tags).toEqual([]);
    expect(s.thumbnailRef).toBeNull();
    // 保存した時刻が無いときは 1970-01-01。
    expect(s.updatedAt).toBe(new Date(0).toISOString());
  });

  it('summarizeSong_GuitarProgramAndUnknownProgram', () => {
    // UT-PERSIST-INDEX-16 part-tuning-management.md 2.1 節：プログラム 30 はエレキギター、どちらでもない番号は null
    const score = createInitialScore({ title: 'G' });
    const base = { id: 'g', createdAt: undefined, score, appMeta: undefined, savedAtMonotonic: Number.NaN, folder: '' };
    expect(summarizeSong(base).firstPartInstrumentType).toBe('electric_guitar');
    expect(summarizeSong(base).updatedAt).toBe(new Date(0).toISOString());
    score.tracks[0]!.playbackInfo.program = 0;
    expect(summarizeSong(base).firstPartInstrumentType).toBeNull();
  });

  it('summarizeSong_FirstTrackWithoutStaff_TuningNameNull', () => {
    // UT-PERSIST-INDEX-28 先頭のパートに譜表が無いときは、チューニングの名前を読めないので null
    const score = createInitialScore({ title: 'NoStaff' });
    score.tracks[0]!.staves.length = 0;
    const s = summarizeSong({
      id: 'n',
      createdAt: undefined,
      score,
      appMeta: undefined,
      savedAtMonotonic: 0,
      folder: '',
    });
    expect(s.firstPartTuningName).toBeNull();
    expect(s.firstPartInstrumentType).toBe('electric_guitar');
  });
});

describe('SongIndexService', () => {
  it('load_MissingIndex_RebuildsFromSongsFolder', async () => {
    // UT-PERSIST-INDEX-03
    fs.putJson('songs/s1.tabapp', songFile('s1', 'One'));
    fs.putJson('songs/s2.tabapp', songFile('s2', 'Two'));

    const list = await service.load();
    expect(list.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(list.find((s) => s.id === 's1')!.title).toBe('One');
    // 再構築結果が index.json に書き戻されている。
    expect(fs.readJson<SongSummary[]>(INDEX_FILE)).toHaveLength(2);
  });

  it('load_ValidIndex_ReturnsParsed', async () => {
    // UT-PERSIST-INDEX-04
    fs.putJson(INDEX_FILE, [summary('s1', 'One')]);
    expect(await service.load()).toEqual([summary('s1', 'One')]);
  });

  it('load_CorruptIndex_FallsBackToRebuild', async () => {
    // UT-PERSIST-INDEX-05
    fs.putText(INDEX_FILE, '{ not json');
    fs.putJson('songs/s9.tabapp', songFile('s9', 'Nine'));
    const list = await service.load();
    expect(list.map((s) => s.id)).toEqual(['s9']);
  });

  it('load_IndexNotArray_FallsBackToRebuild', async () => {
    // UT-PERSIST-INDEX-06
    fs.putJson(INDEX_FILE, { nope: true });
    expect(await service.load()).toEqual([]);
  });

  it('load_NonEnoentReadError_ReportsSong003AndFallsBackToRebuild', async () => {
    // UT-PERSIST-INDEX-07 9.1 節：読めないときは作り直して SONG-003
    const report = vi.spyOn(notificationCenter, 'report');
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new FileReadError(INDEX_FILE));
    fs.putJson('songs/s7.tabapp', songFile('s7', 'Seven'));
    const list = await service.load();
    expect(list.map((s) => s.id)).toEqual(['s7']);
    expect(report).toHaveBeenCalledWith('SONG-003', { songCount: 1 });
  });

  it('rebuildFromSongsFolder_ListDirectoryNonEnoentError_Rethrows', async () => {
    // UT-PERSIST-INDEX-08
    vi.spyOn(fs, 'listDirectory').mockRejectedValueOnce(new FileReadError('songs'));
    await expect(service.rebuildFromSongsFolder()).rejects.toBeInstanceOf(FileReadError);
  });

  it('upsert_AddsThenUpdatesInPlace', async () => {
    // UT-PERSIST-INDEX-09
    await service.upsert(summary('s1', 'One'));
    await service.upsert(summary('s2', 'Two'));
    await service.upsert({ ...summary('s1', 'One!'), title: 'One!' });

    const list = await service.load();
    expect(list).toHaveLength(2);
    // 替えた 1 件は元の位置のまま（差分で直す）。
    expect(list.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(list.find((s) => s.id === 's1')!.title).toBe('One!');
  });

  it('remove_DropsEntry', async () => {
    // UT-PERSIST-INDEX-10
    fs.putJson(INDEX_FILE, [summary('s1', 'One'), summary('s2', 'Two')]);
    await service.remove('s1');
    expect((await service.load()).map((s) => s.id)).toEqual(['s2']);
  });

  it('remove_MissingEntry_NoError', async () => {
    // UT-PERSIST-INDEX-11
    fs.putJson(INDEX_FILE, [summary('s1', 'One')]);
    await expect(service.remove('nope')).resolves.toBeUndefined();
  });

  it('rebuildFromSongsFolder_SkipsCorruptSongFiles', async () => {
    // UT-PERSIST-INDEX-12
    fs.putJson('songs/ok.tabapp', songFile('ok', 'OK'));
    fs.putText('songs/broken.tabapp', 'not json at all');
    fs.putText('songs/readme.txt', 'not a song');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const list = await service.rebuildFromSongsFolder();
    expect(list.map((s) => s.id)).toEqual(['ok']);
  });

  it('rebuildFromSongsFolder_NoSongsDir_ReturnsEmptyAndWritesEmptyIndex', async () => {
    // UT-PERSIST-INDEX-13
    const bare = new FakeFileSystemAdapter();
    const svc = new SongIndexService(bare);
    expect(await svc.rebuildFromSongsFolder()).toEqual([]);
    expect(bare.readJson<SongSummary[]>(INDEX_FILE)).toEqual([]);
  });

  it('load_UnreadableIndex_ReportsSong003WithRebuiltSongCount', async () => {
    // UT-PERSIST-INDEX-17 9.1 節：SONG-003 の context に作り直した曲の数
    const report = vi.spyOn(notificationCenter, 'report');
    fs.putText(INDEX_FILE, '{ broken');
    fs.putJson('songs/a.tabapp', songFile('a', 'A'));
    fs.putJson('songs/f/b.tabapp', songFile('b', 'B'));
    await service.load();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('SONG-003', { songCount: 2 });
  });

  it('load_ValidIndex_DoesNotReportSong003', async () => {
    // UT-PERSIST-INDEX-18
    const report = vi.spyOn(notificationCenter, 'report');
    fs.putJson(INDEX_FILE, [summary('s1', 'One')]);
    await service.load();
    expect(report).not.toHaveBeenCalled();
  });

  it('rebuildFromSongsFolder_WalksSubfoldersAndSetsRelativeFolder', async () => {
    // UT-PERSIST-INDEX-19 9.2 節：songs/ の下のサブフォルダ（入れ子を含む）を全部読み、folder に songs/ からの相対パスを入れる
    fs.putJson('songs/root.tabapp', songFile('root', 'Root'));
    fs.putJson('songs/live/l1.tabapp', songFile('l1', 'L1'));
    fs.putJson('songs/live/2026/deep.tabapp', songFile('deep', 'Deep'));
    fs.dirs.add('songs/empty');
    const list = await service.rebuildFromSongsFolder();
    const byId = new Map(list.map((s) => [s.id, s.folder]));
    expect(byId).toEqual(
      new Map([
        ['root', ''],
        ['l1', 'live'],
        ['deep', 'live/2026'],
      ]),
    );
  });

  it('rebuildFromSongsFolder_UpdatedAtComesFromSavedAtMonotonicNotFileTime', async () => {
    // UT-PERSIST-INDEX-20 7 節：作り直すときもファイルの更新時刻ではなく savedAtMonotonic から作る（G66）
    fs.putJson('songs/s1.tabapp', songFile('s1', 'One'));
    const [s] = await service.rebuildFromSongsFolder();
    expect(s!.updatedAt).toBe(new Date(1700000000000).toISOString());
  });

  it('rebuildFromSongsFolder_SubfolderListError_Rethrows', async () => {
    // UT-PERSIST-INDEX-21 songs/ が無いときだけ空にし、サブフォルダが読めないときは投げる
    fs.putJson('songs/f/a.tabapp', songFile('a', 'A'));
    const original = fs.listDirectory.bind(fs);
    vi.spyOn(fs, 'listDirectory').mockImplementation((path) =>
      path === 'songs/f'
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'FILE_NOT_FOUND' }))
        : original(path),
    );
    await expect(service.rebuildFromSongsFolder()).rejects.toThrow('gone');
  });

  it('upsertAndRemove_WriteViaTmpThenRename', async () => {
    // UT-PERSIST-INDEX-22 9.1 節：直した後の一覧を一時ファイルからの改名で書く
    fs.putJson(INDEX_FILE, []);
    const writeSpy = vi.spyOn(fs, 'writeFile');
    const renameSpy = vi.spyOn(fs, 'renameFile');
    await service.upsert(summary('s1', 'One'));
    await service.remove('s1');
    expect(writeSpy.mock.calls.map(([p]) => p)).toEqual([`${INDEX_FILE}.tmp`, `${INDEX_FILE}.tmp`]);
    expect(renameSpy.mock.calls).toEqual([
      [`${INDEX_FILE}.tmp`, INDEX_FILE],
      [`${INDEX_FILE}.tmp`, INDEX_FILE],
    ]);
    expect(fs.files.has(`${INDEX_FILE}.tmp`)).toBe(false);
  });

  it('find_ReturnsEntryOrUndefined', async () => {
    // UT-PERSIST-INDEX-23
    fs.putJson(INDEX_FILE, [summary('s1', 'One', 'live')]);
    expect((await service.find('s1'))?.folder).toBe('live');
    expect(await service.find('nope')).toBeUndefined();
  });

  it('replaceFolderPrefix_RewritesFolderAndDescendantsOnly', async () => {
    // UT-PERSIST-INDEX-24 9.2 節：その下にある曲の全部の folder の先頭を新しいパスに直す
    fs.putJson(INDEX_FILE, [
      summary('a', 'A', 'live'),
      summary('b', 'B', 'live/2026'),
      summary('c', 'C', 'lively'),
      summary('d', 'D', ''),
    ]);
    expect(await service.replaceFolderPrefix('live', 'concert')).toBe(2);
    const folders = (await service.load()).map((s) => [s.id, s.folder]);
    expect(folders).toEqual([
      ['a', 'concert'],
      ['b', 'concert/2026'],
      ['c', 'lively'],
      ['d', ''],
    ]);
  });

  it('writeThumbnailCopy_DecodesBase64ToPngBytesViaTmpThenRename', async () => {
    // UT-PERSIST-INDEX-25 9.1 節：base64 を PNG のバイト列に戻して thumbnails/{songId}.png へ一時ファイルからの改名で書く
    const renameSpy = vi.spyOn(fs, 'renameFile');
    await writeThumbnailCopy(fs, 's1', PNG_BASE64);
    expect([...fs.files.get('thumbnails/s1.png')!]).toEqual(PNG_SIGNATURE);
    expect(renameSpy).toHaveBeenCalledWith('thumbnails/s1.png.tmp', 'thumbnails/s1.png');
    expect(thumbnailFilePath('s1')).toBe('thumbnails/s1.png');
  });

  it('rebuildThumbnailCopy_ReadsSongInItsFolderAndRewritesCopy', async () => {
    // UT-PERSIST-INDEX-26 9.1 節：写しが見つからないとき、曲のファイルの appMeta.thumbnail から作り直す
    fs.putJson(INDEX_FILE, [summary('b1', 'B', 'live')]);
    fs.putJson(songFilePath('b1', 'live'), bassSongFile('b1', PNG_BASE64));
    expect(await service.rebuildThumbnailCopy('b1')).toBe(true);
    expect([...fs.files.get('thumbnails/b1.png')!]).toEqual(PNG_SIGNATURE);
  });

  it('rebuildThumbnailCopy_NoThumbnailInSong_ReturnsFalseAndWritesNothing', async () => {
    // UT-PERSIST-INDEX-27 曲のファイルの appMeta.thumbnail が null なら写しを作らない（索引に無い曲は songs/ の直下を読む）
    fs.putJson(INDEX_FILE, []);
    fs.putJson(songFilePath('b2'), bassSongFile('b2'));
    expect(await service.rebuildThumbnailCopy('b2')).toBe(false);
    expect(fs.files.has('thumbnails/b2.png')).toBe(false);
  });
});
