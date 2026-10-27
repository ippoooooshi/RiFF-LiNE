// UT-PERSIST-IMPORT: `SongImportService`（songs/ の外の .tabapp の取り込み）
// 検証節: data-model-persistence.md 19 節
// UT: data-model-persistence.md 19 節・8 節・15 節・17 節・18 節・9.1 節 — SongImportService・importedSongTitle
// 検証観点: songs/ の直下へ写して index.json に 1 件、確かめで読めなければ写さない（FILE-008・FILE-002・FILE-004）、上限 1000、
// 同じ id のときの 3 つの選択（上書き・別の曲・やめる）、ゴミ箱にだけ在るときは聞かない、曲名の重ならない決まり（C0/C1）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialScore } from '../domain/newSong';
import { CURRENT_SCHEMA_VERSION, SongDocument, createEmptyAppMetadata } from '../domain/SongDocument';
import { SONG_COUNT_LIMIT } from '../domain/validation';
import type { NotificationEvent } from '../errors';
import { notificationCenter } from '../errors';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { ChecksumUtil } from './ChecksumUtil';
import { TRASH_INDEX_FILE } from './constants';
import {
  CorruptSongFileError,
  IntegrityCheckFailedError,
  SongCountLimitError,
  UnsupportedSchemaVersionError,
} from './errors';
import { songFilePath, thumbnailFilePath, trashFilePath } from './paths';
import { SchemaMigrator } from './SchemaMigrator';
import { verifySongFileChecksum } from './songFileCheck';
import {
  SongImportService,
  importedSongTitle,
  type ImportConflict,
  type ImportConflictChoice,
} from './SongImportService';
import { SongIndexService } from './SongIndexService';
import { TrashService, type TrashEntry } from './TrashService';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');
const THUMB_B64 = btoa('incoming-png');

let primary: FakeFileSystemAdapter;
let outside: FakeFileSystemAdapter;
let index: SongIndexService;
let trash: TrashService;
let importer: SongImportService;
let ids: string[];
let reported: NotificationEvent[];
let unsubscribe: () => void;

/** 曲のファイルの中身（チェックサムつき）。 */
function songText(id: string, title: string, withThumbnail = false): string {
  const appMeta = createEmptyAppMetadata();
  const doc = new SongDocument({
    id,
    score: createInitialScore({ title }),
    appMeta: withThumbnail ? { ...appMeta, thumbnail: { encoding: 'base64-png', data: THUMB_B64 } } : appMeta,
  });
  return JSON.stringify(doc.toFileJson());
}

/** index.json の 1 件（SongSummary の形）。 */
function summary(id: string, title: string, folder = '', thumbnailRef: string | null = null): Record<string, unknown> {
  return {
    id,
    title,
    artist: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    tags: [],
    thumbnailRef,
    firstPartInstrumentType: null,
    firstPartTuningName: null,
    folder,
  };
}

function nextId(): string {
  return ids.shift() ?? 'unexpected-id';
}

const neverAsk = vi.fn((): Promise<ImportConflictChoice> => Promise.reject(new Error('should not ask')));

beforeEach(() => {
  primary = new FakeFileSystemAdapter({ rootPath: '/active/TabApp' });
  primary.dirs.add('songs');
  outside = new FakeFileSystemAdapter({ rootPath: '/downloads' });
  index = new SongIndexService(primary);
  ids = ['new-1', 'new-2'];
  trash = new TrashService(primary, index, () => NOW, nextId);
  importer = new SongImportService(primary, new SchemaMigrator(), index, trash, nextId);
  reported = [];
  unsubscribe = notificationCenter.subscribe((event) => reported.push(event));
  neverAsk.mockClear();
});

afterEach(() => {
  unsubscribe();
  vi.restoreAllMocks();
});

describe('SongImportService：songs/ に同じ id が無いとき', () => {
  it('importFile_NewSong_CopiesBytesToSongsRootAndAddsOneIndexEntryAndThumbnail', async () => {
    // UT-PERSIST-IMPORT-01 19 節「写す先は songs/ の直下とし、写したら index.json に 1 件を足す」。サムネイルの写しも作る（9.1 節）
    const text = songText('s1', 'Intro', true);
    outside.putText('s1.tabapp', text);

    const result = await importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, neverAsk);

    expect(result).toEqual({ kind: 'imported', songId: 's1' });
    expect(primary.readText(songFilePath('s1'))).toBe(text);
    expect(primary.files.has(`${songFilePath('s1')}.tmp`)).toBe(false);
    expect(primary.readText(thumbnailFilePath('s1'))).toBe('incoming-png');
    const loaded = await index.load();
    expect(loaded.map((s) => [s.id, s.title, s.folder])).toEqual([['s1', 'Intro', '']]);
    expect(neverAsk).not.toHaveBeenCalled();
  });

  it('importFile_SameIdOnlyInTrash_ImportsWithSameIdWithoutAsking', async () => {
    // UT-PERSIST-IMPORT-02 19 節「同じ id の曲がゴミ箱にだけあるときは、ダイアログを出さずに、同じ id のまま取り込む」（honnin-queue 48 番の (2)）
    primary.putText(trashFilePath('s1'), songText('s1', 'Old'));
    primary.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: '' }]);
    outside.putText('s1.tabapp', songText('s1', 'New'));

    const result = await importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, neverAsk);

    expect(result).toEqual({ kind: 'imported', songId: 's1' });
    expect(primary.files.has(songFilePath('s1'))).toBe(true);
    expect(primary.files.has(trashFilePath('s1'))).toBe(true);
    expect(neverAsk).not.toHaveBeenCalled();
  });

  it('importFile_NotJson_ReportsFile008AndDoesNotCopy', async () => {
    // UT-PERSIST-IMPORT-03 19 節「読めなければ写さずに開かず、そのコード（FILE-008）を出す」（8 節の (1)）
    outside.putText('broken.tabapp', '{ not json');

    await expect(
      importer.importFile({ adapter: outside, relativePath: 'broken.tabapp' }, neverAsk),
    ).rejects.toBeInstanceOf(CorruptSongFileError);

    expect(reported.map((e) => e.code)).toEqual(['FILE-008']);
    expect(reported[0]?.context).toEqual({ songId: 'broken.tabapp', reason: 'invalid-json' });
    expect([...primary.files.keys()]).toEqual([]);
  });

  it('importFile_ChecksumMismatch_ReportsFile002AndDoesNotCopy', async () => {
    // UT-PERSIST-IMPORT-04 19 節「8 節と 15 節の確かめ」：チェックサムが合わなければ FILE-002 を出して写さない
    const json = JSON.parse(songText('s1', 'Tampered')) as { integrity: { checksum: string } };
    json.integrity.checksum = 'sha256:0000';
    outside.putText('s1.tabapp', JSON.stringify(json));

    await expect(importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, neverAsk)).rejects.toBeInstanceOf(
      IntegrityCheckFailedError,
    );

    expect(reported.map((e) => e.code)).toEqual(['FILE-002']);
    expect(primary.files.has(songFilePath('s1'))).toBe(false);
  });

  it('importFile_ChecksumMissingOrEmpty_ReportsFile002AndDoesNotCopy', async () => {
    // UT-PERSIST-IMPORT-18 15 節：integrity か integrity.checksum が無いか空の文字列の曲も壊れたファイルとし、FILE-002 を出して写さない
    // （2026-10-28 本人決定、honnin-queue 215 番。取り込みは 19 節「8 節と 15 節の確かめ」で同じ関数を通る）
    const json = JSON.parse(songText('s1', 'NoMark')) as Record<string, unknown>;
    for (const integrity of [undefined, { savedAtMonotonic: 1 }, { savedAtMonotonic: 1, checksum: '' }]) {
      reported = [];
      outside.putText('s1.tabapp', JSON.stringify({ ...json, integrity }));
      await expect(
        importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, neverAsk),
      ).rejects.toBeInstanceOf(IntegrityCheckFailedError);
      expect(reported.map((e) => e.code)).toEqual(['FILE-002']);
      expect(primary.files.has(songFilePath('s1'))).toBe(false);
    }
  });

  it('importFile_NewerMajorVersion_ReportsFile004AndDoesNotCopy', async () => {
    // UT-PERSIST-IMPORT-05 19 節：新しい版のファイル（1 つ目の数が今より大きい）は FILE-004 を出して写さない
    // 15 節の順（形 → チェックサム → 版）なので、チェックサムは 99.0.0 の中身で正しく付ける。
    // チェックサムを確かめずに通す道（前の版の「検証スキップ」の警告）はもう無い（15 節、honnin-queue 215 番）
    outside.putText(
      's1.tabapp',
      JSON.stringify({
        schemaVersion: '99.0.0',
        id: 's1',
        song: {},
        appMeta: {},
        integrity: { checksum: ChecksumUtil.compute('99.0.0', {}, {} as never) },
      }),
    );

    await expect(importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, neverAsk)).rejects.toBeInstanceOf(
      UnsupportedSchemaVersionError,
    );

    expect(reported.map((e) => e.code)).toEqual(['FILE-004']);
    expect(primary.files.has(songFilePath('s1'))).toBe(false);
  });

  it('importFile_AtSongLimit_ThrowsSongCountLimitErrorAndDoesNotCopy', async () => {
    // UT-PERSIST-IMPORT-06 19 節「曲が 1 つ増えるときは、曲の数の上限 1000 を確かめ、上限なら写さずに SONG-002 を出す」（出すのは呼ぶ側、SongCountLimitError）
    primary.putJson(
      'index.json',
      Array.from({ length: SONG_COUNT_LIMIT }, (_, i) => summary(`x${i}`, `t${i}`)),
    );
    outside.putText('s1.tabapp', songText('s1', 'Intro'));

    const error = await importer
      .importFile({ adapter: outside, relativePath: 's1.tabapp' }, neverAsk)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SongCountLimitError);
    expect((error as SongCountLimitError).count).toBe(SONG_COUNT_LIMIT);
    expect(primary.files.has(songFilePath('s1'))).toBe(false);
  });

  it('importFile_NoIdInFile_UsesFileNameThenNewId', async () => {
    // UT-PERSIST-IMPORT-07 5 節：id は曲のファイルの id。無ければファイルの名前 {id}.tabapp から、それも使えなければ新しく作る
    const noId = JSON.parse(songText('ignored', 'NoId')) as Record<string, unknown>;
    delete noId['id'];
    outside.putText('sub/from-name.tabapp', JSON.stringify(noId));
    outside.putText('weird.txt', JSON.stringify(noId));

    const byName = await importer.importFile({ adapter: outside, relativePath: 'sub/from-name.tabapp' }, neverAsk);
    const byNewId = await importer.importFile({ adapter: outside, relativePath: 'weird.txt' }, neverAsk);

    expect(byName).toEqual({ kind: 'imported', songId: 'from-name' });
    expect(byNewId).toEqual({ kind: 'imported', songId: 'new-1' });
  });
});

describe('SongImportService：songs/ に同じ id があるとき（3 つの選択）', () => {
  beforeEach(() => {
    primary.putText(songFilePath('s1', 'live'), songText('s1', 'Current'));
    primary.putText(thumbnailFilePath('s1'), 'current-png');
    primary.putJson('index.json', [summary('s1', 'Current', 'live', thumbnailFilePath('s1'))]);
  });

  it('importFile_SameIdInSongs_AsksWithBothTitlesAndUpdatedAt_CancelChangesNothing', async () => {
    // UT-PERSIST-IMPORT-08 19 節「上書きする・別の曲として取り込む・やめるを選ぶダイアログを出し、両方の更新日時を並べて見せる」「やめる：写さず、開かない」
    outside.putText('s1.tabapp', songText('s1', 'Incoming'));
    const ask = vi.fn((_conflict: ImportConflict): Promise<ImportConflictChoice> => Promise.resolve('cancel'));

    const result = await importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, ask);

    expect(result).toEqual({ kind: 'cancelled' });
    expect(ask).toHaveBeenCalledTimes(1);
    const conflict = ask.mock.calls[0]![0];
    expect(conflict).toMatchObject({
      songId: 's1',
      existingTitle: 'Current',
      existingUpdatedAt: '2026-02-01T00:00:00.000Z',
      incomingTitle: 'Incoming',
    });
    expect(Number.isNaN(Date.parse(conflict.incomingUpdatedAt))).toBe(false);
    expect(primary.readText(songFilePath('s1', 'live'))).toContain('Current');
    expect(primary.files.has(songFilePath('s1'))).toBe(false);
  });

  it('importFile_Overwrite_MovesCurrentToTrashWithNewIdThenCopiesIncomingWithSameId', async () => {
    // UT-PERSIST-IMPORT-09 19 節「上書きする：いまの曲は消さずにゴミ箱へ移してから、取り込む曲を同じ id で写す」
    // (b)「ゴミ箱へ移すいまの曲には新しい id を付けてから移す」。サムネイルの写しも新しい id で残す（9.1 節）
    const text = songText('s1', 'Incoming');
    outside.putText('s1.tabapp', text);

    const result = await importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, () =>
      Promise.resolve('overwrite'),
    );

    expect(result).toEqual({ kind: 'imported', songId: 's1' });
    expect(primary.readText(songFilePath('s1'))).toBe(text);
    expect(primary.files.has(songFilePath('s1', 'live'))).toBe(false);
    expect(primary.readText(trashFilePath('new-1'))).toContain('Current');
    expect(primary.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toEqual([
      { songId: 'new-1', deletedAt: new Date(NOW).toISOString(), folder: 'live' },
    ]);
    expect(primary.readText(thumbnailFilePath('new-1'))).toBe('current-png');
    // 取り込んだ曲はサムネイルを持たないので、前の曲の写しを残さない
    expect(primary.files.has(thumbnailFilePath('s1'))).toBe(false);
    expect((await index.load()).map((s) => [s.id, s.title, s.folder])).toEqual([['s1', 'Incoming', '']]);
  });

  it('importFile_OverwriteAtSongLimit_IsAllowedBecauseCountDoesNotGrow', async () => {
    // UT-PERSIST-IMPORT-10 19 節：上限を確かめるのは曲が 1 つ増えるときだけ。上書きは数が変わらない
    primary.putJson('index.json', [
      summary('s1', 'Current', 'live'),
      ...Array.from({ length: SONG_COUNT_LIMIT - 1 }, (_, i) => summary(`x${i}`, `t${i}`)),
    ]);
    outside.putText('s1.tabapp', songText('s1', 'Incoming'));

    const result = await importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, () =>
      Promise.resolve('overwrite'),
    );

    expect(result).toEqual({ kind: 'imported', songId: 's1' });
    expect((await index.load()).filter((s) => s.id === 's1').map((s) => s.title)).toEqual(['Incoming']);
  });

  it('importFile_OverwriteWithoutThumbnailCopy_StillMovesToTrash', async () => {
    // UT-PERSIST-IMPORT-11 写しが無い曲を上書きしても止まらない
    primary.files.delete(thumbnailFilePath('s1'));
    primary.putJson('index.json', [summary('s1', 'Current', 'live', null)]);
    outside.putText('s1.tabapp', songText('s1', 'Incoming', true));

    await importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, () => Promise.resolve('overwrite'));

    expect(primary.files.has(trashFilePath('new-1'))).toBe(true);
    expect(primary.files.has(thumbnailFilePath('new-1'))).toBe(false);
    expect(primary.readText(thumbnailFilePath('s1'))).toBe('incoming-png');
  });

  it('importFile_ImportAsNew_GivesNewIdAndNonClashingTitle', async () => {
    // UT-PERSIST-IMPORT-12 19 節「別の曲として取り込む：新しい id を付けて写す。曲名は、同じ名前の曲があれば 18 節の決まりで重ならないようにする」
    outside.putText('s1.tabapp', songText('s1', 'Current', true));

    const result = await importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, () =>
      Promise.resolve('import-as-new'),
    );

    expect(result).toEqual({ kind: 'imported', songId: 'new-1' });
    expect(primary.readText(songFilePath('s1', 'live'))).toContain('Current');
    expect(primary.files.has(songFilePath('new-1'))).toBe(true);
    expect(primary.readText(thumbnailFilePath('new-1'))).toBe('incoming-png');
    expect(primary.readText(thumbnailFilePath('s1'))).toBe('current-png');
    const loaded = await index.load();
    expect(loaded.map((s) => [s.id, s.title]).sort()).toEqual([
      ['new-1', 'Current のコピー'],
      ['s1', 'Current'],
    ]);
    // 名前を書き換えた曲は今の版で書き直し、チェックサムも書き直す（開ける）
    const reread = JSON.parse(primary.readText(songFilePath('new-1'))) as {
      schemaVersion: string;
      song: unknown;
      appMeta: unknown;
      integrity: { checksum: string };
    };
    expect(reread.integrity.checksum.startsWith('sha256:')).toBe(true);
    expect(reread.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() => verifySongFileChecksum(reread, reread.schemaVersion, 'new-1')).not.toThrow();
  });

  it('importFile_ImportAsNewWithDefaultIdMaker_UsesRandomUuid', async () => {
    // UT-PERSIST-IMPORT-13 5 節：新しい id は crypto.randomUUID() で作る（版 4 の UUID）
    const withDefaultIds = new SongImportService(primary, new SchemaMigrator(), index, trash);
    outside.putText('s1.tabapp', songText('s1', 'Other'));

    const result = await withDefaultIds.importFile({ adapter: outside, relativePath: 's1.tabapp' }, () =>
      Promise.resolve('import-as-new'),
    );

    expect(result.kind === 'imported' ? result.songId : '').toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('importFile_ImportAsNewWithDifferentTitle_KeepsTitle', async () => {
    // UT-PERSIST-IMPORT-14 同じ名前の曲が無ければ名前はそのまま
    outside.putText('s1.tabapp', songText('s1', 'Other'));

    await importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, () => Promise.resolve('import-as-new'));

    expect((await index.load()).find((s) => s.id === 'new-1')?.title).toBe('Other');
  });

  it('importFile_ImportAsNewAtSongLimit_ThrowsAndDoesNotCopy', async () => {
    // UT-PERSIST-IMPORT-15 別の曲として取り込むと曲が 1 つ増えるので、上限なら写さない
    primary.putJson('index.json', [
      summary('s1', 'Current', 'live'),
      ...Array.from({ length: SONG_COUNT_LIMIT - 1 }, (_, i) => summary(`x${i}`, `t${i}`)),
    ]);
    outside.putText('s1.tabapp', songText('s1', 'Incoming'));

    await expect(
      importer.importFile({ adapter: outside, relativePath: 's1.tabapp' }, () => Promise.resolve('import-as-new')),
    ).rejects.toBeInstanceOf(SongCountLimitError);
    expect(primary.files.has(songFilePath('new-1'))).toBe(false);
  });

  it('importFile_ThumbnailCopyFails_WarnsAndStillImports', async () => {
    // UT-PERSIST-IMPORT-16 写しが書けなくても取り込む（曲一覧は曲のファイルから写しを作り直せる、9.1 節）
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const realWrite = primary.writeFile.bind(primary);
    vi.spyOn(primary, 'writeFile').mockImplementation((path, data) =>
      path.startsWith('thumbnails/') ? Promise.reject(new Error('disk full')) : realWrite(path, data),
    );
    outside.putText('s2.tabapp', songText('s2', 'Fresh', true));

    const result = await importer.importFile({ adapter: outside, relativePath: 's2.tabapp' }, neverAsk);

    expect(result).toEqual({ kind: 'imported', songId: 's2' });
    expect((await index.load()).some((s) => s.id === 's2')).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});

describe('importedSongTitle（18 節の決まり）', () => {
  it('importedSongTitle_NoSameTitle_KeepsTitle_OtherwiseCopyWithSmallestFreeNumber', () => {
    // UT-PERSIST-IMPORT-17 19 節「同じ名前の曲があれば 18 節の決まり（「<曲名> のコピー」と空いている数）で重ならないようにする」
    expect(importedSongTitle('A', ['B'])).toBe('A');
    expect(importedSongTitle('A', ['A'])).toBe('A のコピー');
    expect(importedSongTitle('A', ['A', 'A のコピー', 'A のコピー 3'])).toBe('A のコピー 2');
  });
});
