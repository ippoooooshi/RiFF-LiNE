// UT-PERSIST-TRASH: `TrashService`（ゴミ箱へ入れる・戻す・期限で消す・すぐに消す・期限が近い曲）と起動のときの片付け
// 検証節: data-model-persistence.md 17 節・8 節・19 節
// UT: data-model-persistence.md 17 節・9.1 節・13.1 節・19 節、06_file_io_persistence.md 7 節、B9・B29 — TrashService・runStartupCleanup
// 検証観点: moveToTrash / restore（元のサブフォルダ・同じ id のぶつかり）、purgeExpired の保持期間境界（29/30/31 日）、permanentlyDelete、
// findExpiringSoon・listTrashed・残りの日数、trash-index.json 破損時の再構築、起動のときの FILE-007 と PreMigration/ の片付け（C0/C1）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { TRASH_EXPIRY_WARNING_DAYS, TRASH_INDEX_FILE } from './constants';
import { songFilePath, thumbnailFilePath, trashFilePath } from './paths';
import { SongIndexService } from './SongIndexService';
import {
  TrashService,
  runStartupCleanup,
  trashRemainingDays,
  trashRemainingMs,
  type StartupCleanupDeps,
  type TrashEntry,
} from './TrashService';

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
    // UT-PERSIST-TRASH-01
    fs.putJson(songFilePath('s1'), songFileJson('s1'));
    fs.putJson('index.json', [
      { id: 's1', title: 's1', updatedAt: '', tags: [], thumbnailRef: null, isTrashed: false },
    ]);

    await trash.moveToTrash('s1');

    expect(fs.files.has(songFilePath('s1'))).toBe(false);
    expect(fs.files.has(trashFilePath('s1'))).toBe(true);
    const entries = fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE);
    // 17 節：trash-index.json に削除日時と元のサブフォルダ（songs/ の直下なら空の文字列）を書く
    expect(entries).toEqual([{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: '' }]);
    expect(await index.load()).toEqual([]);
  });

  it('restore_MovesBackAndReAddsToIndexAndRemovesTrashEntry', async () => {
    // UT-PERSIST-TRASH-02
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
    // UT-PERSIST-TRASH-03
    const purged = await trash.purgeExpired();
    expect(purged).toBe(2); // d30（境界）と d31
    expect(fs.files.has(trashFilePath('d29'))).toBe(true);
    expect(fs.files.has(trashFilePath('d30'))).toBe(false);
    expect(fs.files.has(trashFilePath('d31'))).toBe(false);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE).map((e) => e.songId)).toEqual(['d29']);
  });

  it('purgeExpired_CustomRetention_UsesGivenThreshold', async () => {
    // UT-PERSIST-TRASH-04
    expect(await trash.purgeExpired(31)).toBe(1); // d31 のみ
  });

  it('purgeExpired_NothingExpired_ReturnsZeroAndKeepsIndex', async () => {
    // UT-PERSIST-TRASH-05
    expect(await trash.purgeExpired(90)).toBe(0);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toHaveLength(3);
  });
});

describe('TrashService.permanentlyDelete', () => {
  it('permanentlyDelete_RemovesFileAndTrashEntry', async () => {
    // UT-PERSIST-TRASH-06
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString() }]);
    await trash.permanentlyDelete('s1');
    expect(fs.files.has(trashFilePath('s1'))).toBe(false);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toEqual([]);
  });
});

describe('TrashService trash-index.json recovery', () => {
  it('loadIndex_Corrupt_RebuildsFromTrashFolder', async () => {
    // UT-PERSIST-TRASH-07
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

// ===== 17 節・19 節（元のサブフォルダ・サムネイルの写し・同じ id のぶつかり） =====

const THUMB_B64 = btoa('png-bytes');

/** index.json の 1 件（SongSummary の形）。 */
function summary(id: string, folder = ''): Record<string, unknown> {
  return {
    id,
    title: id,
    artist: '',
    createdAt: '',
    updatedAt: '',
    tags: [],
    thumbnailRef: null,
    firstPartInstrumentType: null,
    firstPartTuningName: null,
    folder,
  };
}

/** サムネイルを持つ曲のファイル。 */
function songFileJsonWithThumbnail(id: string): unknown {
  const base = songFileJson(id) as { appMeta: Record<string, unknown> };
  return { ...base, appMeta: { ...base.appMeta, thumbnail: { encoding: 'base64', data: THUMB_B64 } } };
}

describe('TrashService 17 節：元のサブフォルダとサムネイルの写し', () => {
  it('moveToTrash_SongInSubfolder_MovesFromSubfolderAndRecordsFolder', async () => {
    // UT-PERSIST-TRASH-08 17 節「songs/{サブフォルダ/}{id}.tabapp を trash/{id}.tabapp へ移し、trash-index.json に削除日時と元のサブフォルダを書く」
    fs.putJson(songFilePath('s1', 'live/2024'), songFileJson('s1'));
    fs.putJson('index.json', [summary('s1', 'live/2024')]);

    await trash.moveToTrash('s1');

    expect(fs.files.has(songFilePath('s1', 'live/2024'))).toBe(false);
    expect(fs.files.has(trashFilePath('s1'))).toBe(true);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toEqual([
      { songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: 'live/2024' },
    ]);
    expect(await index.load()).toEqual([]);
  });

  it('moveToTrash_ThumbnailCopy_IsKept', async () => {
    // UT-PERSIST-TRASH-09 9.1 節「ゴミ箱へ入れても写しは残し、ゴミ箱から完全に消したときに消す」
    fs.putJson(songFilePath('s1'), songFileJson('s1'));
    fs.putJson('index.json', [summary('s1')]);
    fs.putText(thumbnailFilePath('s1'), 'png');

    await trash.moveToTrash('s1');

    expect(fs.files.has(thumbnailFilePath('s1'))).toBe(true);
  });

  it('moveToTrash_SameIdAlreadyInTrash_GivesNewIdAndKeepsBoth', async () => {
    // UT-PERSIST-TRASH-10 19 節で songs/ と trash/ に同じ id が並んだ後に songs/ の曲を入れても、ゴミ箱の曲を上書きで消さない
    const ids = vi.fn(() => 'new-1');
    trash = new TrashService(fs, index, () => NOW, ids);
    fs.putText(trashFilePath('s1'), 'old-trashed');
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: '2026-05-30T00:00:00.000Z', folder: '' }]);
    fs.putText(songFilePath('s1'), 'current');
    fs.putJson('index.json', [summary('s1')]);
    fs.putText(thumbnailFilePath('s1'), 'png');

    await trash.moveToTrash('s1');

    expect(fs.readText(trashFilePath('s1'))).toBe('old-trashed');
    expect(fs.readText(trashFilePath('new-1'))).toBe('current');
    expect(fs.readText(thumbnailFilePath('new-1'))).toBe('png');
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE).map((e) => e.songId)).toEqual(['s1', 'new-1']);
    expect(await index.load()).toEqual([]);
  });

  it('restore_OriginalSubfolderExists_RestoresIntoItAndIndexHasFolder', async () => {
    // UT-PERSIST-TRASH-11 17 節「trash/ から songs/ の元のサブフォルダへ戻す」「index.json も直す」
    fs.dirs.add('songs/live');
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: 'live' }]);

    await trash.restore('s1');

    expect(fs.files.has(songFilePath('s1', 'live'))).toBe(true);
    expect(fs.files.has(trashFilePath('s1'))).toBe(false);
    expect((await index.load()).map((s) => [s.id, s.folder])).toEqual([['s1', 'live']]);
  });

  it('restore_OriginalSubfolderGone_RestoresDirectlyUnderSongs', async () => {
    // UT-PERSIST-TRASH-12 17 節「元のサブフォルダが無くなっていれば songs/ の直下へ戻す」
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: 'gone' }]);

    await trash.restore('s1');

    expect(fs.files.has(songFilePath('s1'))).toBe(true);
    expect((await index.load()).map((s) => [s.id, s.folder])).toEqual([['s1', '']]);
  });

  it('restore_SameIdInSongs_RestoresWithNewIdAndKeepsBoth', async () => {
    // UT-PERSIST-TRASH-13 17 節の (b)「戻す先に同じ id の曲が既にあるときは、戻す曲に新しい id を付けて戻す。どちらの曲も消さずに残す」
    trash = new TrashService(
      fs,
      index,
      () => NOW,
      () => 'new-1',
    );
    fs.putJson(songFilePath('s1'), songFileJson('s1'));
    fs.putJson('index.json', [summary('s1')]);
    fs.putText(thumbnailFilePath('s1'), 'songs-thumb');
    fs.putJson(trashFilePath('s1'), songFileJsonWithThumbnail('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: '' }]);

    await trash.restore('s1');

    expect(fs.files.has(songFilePath('s1'))).toBe(true);
    expect(fs.files.has(songFilePath('new-1'))).toBe(true);
    expect((await index.load()).map((s) => s.id).sort()).toEqual(['new-1', 's1']);
    // songs/ の曲の写しはそのまま、戻した曲の写しは新しい id で曲のファイルから作る
    expect(fs.readText(thumbnailFilePath('s1'))).toBe('songs-thumb');
    expect(fs.readText(thumbnailFilePath('new-1'))).toBe('png-bytes');
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toEqual([]);
  });

  it('restore_SameIdButNoThumbnail_WritesNoCopy', async () => {
    // UT-PERSIST-TRASH-14 写しは appMeta.thumbnail があるときだけ作る（9.1 節）
    trash = new TrashService(
      fs,
      index,
      () => NOW,
      () => 'new-1',
    );
    fs.putJson(songFilePath('s1'), songFileJson('s1'));
    fs.putJson('index.json', [summary('s1')]);
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));

    await trash.restore('s1');

    expect(fs.files.has(thumbnailFilePath('new-1'))).toBe(false);
  });

  it('restore_ThumbnailWriteFails_StillRestoresAndWarns', async () => {
    // UT-PERSIST-TRASH-15 写しが書けなくても戻す（曲一覧は曲のファイルから写しを作り直せる、9.1 節）
    trash = new TrashService(
      fs,
      index,
      () => NOW,
      () => 'new-1',
    );
    fs.putJson(songFilePath('s1'), songFileJson('s1'));
    fs.putJson('index.json', [summary('s1')]);
    fs.putJson(trashFilePath('s1'), songFileJsonWithThumbnail('s1'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const realWrite = fs.writeFile.bind(fs);
    vi.spyOn(fs, 'writeFile').mockImplementation((path, data) =>
      path.startsWith('thumbnails/') ? Promise.reject(new Error('disk full')) : realWrite(path, data),
    );

    await expect(trash.restore('s1')).resolves.toBeUndefined();

    expect(fs.files.has(songFilePath('new-1'))).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('restore_RestoredFileUnreadable_WarnsAndStillRemovesTrashEntry', async () => {
    // UT-PERSIST-TRASH-16 index.json に足せなくても、戻したファイルは songs/ に在る（起動のときの作り直しで戻る）
    fs.putText(trashFilePath('s1'), 'not json{');
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: '' }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await trash.restore('s1');

    expect(fs.files.has(songFilePath('s1'))).toBe(true);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('permanentlyDelete_DeletesThumbnailCopy', async () => {
    // UT-PERSIST-TRASH-17 17 節の (b)「曲のファイルと trash-index.json の 1 件に加えて、サムネイルの写しを消す」
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: '' }]);
    fs.putText(thumbnailFilePath('s1'), 'png');

    await trash.permanentlyDelete('s1');

    expect(fs.files.has(trashFilePath('s1'))).toBe(false);
    expect(fs.files.has(thumbnailFilePath('s1'))).toBe(false);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toEqual([]);
  });

  it('permanentlyDelete_SameIdInSongs_KeepsThumbnailAndSongsFile', async () => {
    // UT-PERSIST-TRASH-18 19 節の (b)「同じ id の曲が songs/ にあれば（写しは）消さない。songs/ の曲のものになっているため」
    fs.putJson(songFilePath('s1'), songFileJson('s1'));
    fs.putJson('index.json', [summary('s1')]);
    fs.putText(thumbnailFilePath('s1'), 'png');
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: '' }]);

    await trash.permanentlyDelete('s1');

    expect(fs.files.has(trashFilePath('s1'))).toBe(false);
    expect(fs.files.has(songFilePath('s1'))).toBe(true);
    expect(fs.files.has(thumbnailFilePath('s1'))).toBe(true);
  });

  it('purgeExpired_DeletesThumbnailOnlyWhenNoSameIdInSongs', async () => {
    // UT-PERSIST-TRASH-19 期限で消すときも消し方は permanentlyDelete と同じ（17 節）
    const old = new Date(NOW - 40 * MS_PER_DAY).toISOString();
    fs.putJson(trashFilePath('a'), songFileJson('a'));
    fs.putJson(trashFilePath('b'), songFileJson('b'));
    fs.putJson(TRASH_INDEX_FILE, [
      { songId: 'a', deletedAt: old, folder: '' },
      { songId: 'b', deletedAt: old, folder: '' },
    ]);
    fs.putText(thumbnailFilePath('a'), 'png');
    fs.putText(thumbnailFilePath('b'), 'png');
    fs.putJson(songFilePath('b'), songFileJson('b'));
    fs.putJson('index.json', [summary('b')]);

    expect(await trash.purgeExpired(30)).toBe(2);

    expect(fs.files.has(thumbnailFilePath('a'))).toBe(false);
    expect(fs.files.has(thumbnailFilePath('b'))).toBe(true);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)).toEqual([]);
  });

  it('purgeExpired_RemainingIsDeletedAtPlusDaysTimes24hMinusNow', async () => {
    // UT-PERSIST-TRASH-20 17 節の (b)「完全に消す時刻は削除日時＋保持期間の日数×24 時間」「0 以下なら消す」。保持期間を短く変えたら新しい日数で数える
    fs.putJson(TRASH_INDEX_FILE, [
      { songId: 'edge', deletedAt: new Date(NOW - 7 * MS_PER_DAY + 1).toISOString(), folder: '' },
      { songId: 'past', deletedAt: new Date(NOW - 7 * MS_PER_DAY).toISOString(), folder: '' },
      { songId: 'bad', deletedAt: 'not-a-date', folder: '' },
    ]);

    expect(await trash.purgeExpired(7)).toBe(1);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE).map((e) => e.songId)).toEqual(['edge', 'bad']);
  });

  it('permanentlyDelete_WithOnPermanentlyDeleted_NotifiesDeletedSongIdOnce', async () => {
    // UT-PERSIST-TRASH-35 17 節の (b)「permanentlyDelete と purgeExpired で 1 曲を完全に消すたびにその id で呼ぶ」
    const notified = vi.fn();
    const notifying = new TrashService(fs, index, () => NOW, undefined, notified);
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: '' }]);

    await notifying.permanentlyDelete('s1');

    expect(notified).toHaveBeenCalledTimes(1);
    expect(notified).toHaveBeenCalledWith('s1');
  });

  it('permanentlyDelete_SameIdInSongs_DoesNotNotify', async () => {
    // UT-PERSIST-TRASH-36 17 節の (b)「同じ id の曲が songs/ にあって 13.2 節の 1 件を消さないときは呼ばない」（19 節）
    const notified = vi.fn();
    const notifying = new TrashService(fs, index, () => NOW, undefined, notified);
    fs.putJson(songFilePath('s1'), songFileJson('s1'));
    fs.putJson('index.json', [summary('s1')]);
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: new Date(NOW).toISOString(), folder: '' }]);

    await notifying.permanentlyDelete('s1');

    expect(fs.files.has(trashFilePath('s1'))).toBe(false);
    expect(notified).not.toHaveBeenCalled();
  });

  it('purgeExpired_WithOnPermanentlyDeleted_NotifiesEachExpiredNotInSongsOnly', async () => {
    // UT-PERSIST-TRASH-37 17 節の (b)：期限で消した曲ごとに知らせる。songs/ に同じ id がある曲と、期限の来ていない曲は知らせない
    const notified = vi.fn();
    const notifying = new TrashService(fs, index, () => NOW, undefined, notified);
    const old = new Date(NOW - 40 * MS_PER_DAY).toISOString();
    fs.putJson(trashFilePath('a'), songFileJson('a'));
    fs.putJson(trashFilePath('b'), songFileJson('b'));
    fs.putJson(trashFilePath('c'), songFileJson('c'));
    fs.putJson(trashFilePath('fresh'), songFileJson('fresh'));
    fs.putJson(TRASH_INDEX_FILE, [
      { songId: 'a', deletedAt: old, folder: '' },
      { songId: 'b', deletedAt: old, folder: '' },
      { songId: 'c', deletedAt: old, folder: '' },
      { songId: 'fresh', deletedAt: new Date(NOW).toISOString(), folder: '' },
    ]);
    fs.putJson(songFilePath('b'), songFileJson('b'));
    fs.putJson('index.json', [summary('b')]);

    expect(await notifying.purgeExpired(30)).toBe(3);

    expect(notified.mock.calls).toEqual([['a'], ['c']]);
  });
});

describe('TrashService.findExpiringSoon / listTrashed / 残りの日数', () => {
  it('findExpiringSoon_ReturnsIdsWithRemainingAtMostThresholdTimes24h', async () => {
    // UT-PERSIST-TRASH-21 17 節「完全に消すまでの残りが thresholdDays 日以下の曲の id を返す」「残りが 3 × 24 時間以下なら知らせる」
    fs.putJson(TRASH_INDEX_FILE, [
      { songId: 'just3', deletedAt: new Date(NOW - 27 * MS_PER_DAY).toISOString(), folder: '' },
      { songId: 'over3', deletedAt: new Date(NOW - 27 * MS_PER_DAY + 1).toISOString(), folder: '' },
      { songId: 'fresh', deletedAt: new Date(NOW).toISOString(), folder: '' },
      { songId: 'bad', deletedAt: 'not-a-date', folder: '' },
    ]);

    expect(await trash.findExpiringSoon(30, 3)).toEqual(['just3']);
  });

  it('listTrashed_ReturnsEntries_LegacyWithoutFolderIsRoot_InvalidDropped', async () => {
    // UT-PERSIST-TRASH-22 17 節「ゴミ箱の曲の一覧（trash-index.json の中身）」。folder の無い前の形は songs/ の直下として読む
    fs.putJson(TRASH_INDEX_FILE, [
      { songId: 'a', deletedAt: '2026-05-01T00:00:00.000Z', folder: 'live' },
      { songId: 'legacy', deletedAt: '2026-05-02T00:00:00.000Z' },
      { songId: 7, deletedAt: 'x' },
      null,
    ]);

    expect(await trash.listTrashed()).toEqual([
      { songId: 'a', deletedAt: '2026-05-01T00:00:00.000Z', folder: 'live' },
      { songId: 'legacy', deletedAt: '2026-05-02T00:00:00.000Z', folder: '' },
    ]);
  });

  it('listTrashed_NoIndexAndNoTrashFolder_ReturnsEmpty', async () => {
    // UT-PERSIST-TRASH-23 trash-index.json も trash/ も無ければ空の一覧
    fs.dirs.delete('trash');
    expect(await trash.listTrashed()).toEqual([]);
  });

  it('trashRemainingDays_CeilsRemainingDividedBy24h', () => {
    // UT-PERSIST-TRASH-24 17 節「各行に出す残りの日数は、残りの長さを 24 時間で割って切り上げた数」
    const entry = { deletedAt: new Date(NOW - 27 * MS_PER_DAY - 1).toISOString() };
    expect(trashRemainingMs(entry, 30, NOW)).toBe(3 * MS_PER_DAY - 1);
    expect(trashRemainingDays(entry, 30, NOW)).toBe(3);
    expect(trashRemainingDays({ deletedAt: new Date(NOW - 26.5 * MS_PER_DAY).toISOString() }, 30, NOW)).toBe(4);
    expect(trashRemainingDays({ deletedAt: new Date(NOW).toISOString() }, 30, NOW)).toBe(30);
  });

  it('listTrashed_IndexReadFailsOtherThanNotFound_WarnsAndRebuildsFromTrashFolder', async () => {
    // UT-PERSIST-TRASH-30 trash-index.json が読めない（無いのではない）ときも trash/ から作り直す。元のサブフォルダは分からないので直下
    fs.putJson(trashFilePath('a'), songFileJson('a'));
    fs.putJson(TRASH_INDEX_FILE, []);
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('EACCES'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await trash.listTrashed()).toEqual([{ songId: 'a', deletedAt: new Date(0).toISOString(), folder: '' }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('listTrashed_TrashFolderUnreadable_Throws', async () => {
    // UT-PERSIST-TRASH-31 trash/ が在るのに読めないときは、空の一覧にせず投げる（ゴミ箱の曲を「無い」と見せないため）
    vi.spyOn(fs, 'listDirectory').mockRejectedValueOnce(new Error('EACCES'));
    await expect(trash.listTrashed()).rejects.toThrow('EACCES');
  });

  it('TrashService_DefaultClockAndIdMaker_UseDateNowAndRandomUuid', async () => {
    // UT-PERSIST-TRASH-32 既定の時刻は Date.now、新しい id は crypto.randomUUID()（5 節と同じ作り方）
    const plain = new TrashService(fs, index);
    fs.putText(trashFilePath('s1'), 'old-trashed');
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 's1', deletedAt: '2026-05-30T00:00:00.000Z', folder: '' }]);
    fs.putJson(songFilePath('s1'), songFileJson('s1'));
    fs.putJson('index.json', [summary('s1')]);
    const before = Date.now();

    await plain.moveToTrash('s1');

    const added = fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE)[1]!;
    expect(added.songId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Date.parse(added.deletedAt)).toBeGreaterThanOrEqual(before);
  });

  it('listTrashed_IndexNotAnArray_RebuildsSkippingFoldersAndNonSongFiles', async () => {
    // UT-PERSIST-TRASH-33 trash-index.json が配列でなければ壊れているとして trash/ から作り直す。フォルダと .tabapp でないファイルは拾わない
    fs.putJson(trashFilePath('a'), songFileJson('a'));
    fs.putText('trash/readme.txt', 'x');
    fs.putText('trash/sub/b.tabapp', 'x');
    fs.putJson(TRASH_INDEX_FILE, { not: 'array' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await trash.listTrashed()).map((e) => e.songId)).toEqual(['a']);
    warn.mockRestore();
  });

  it('restore_NoTrashIndexEntryForSong_RestoresDirectlyUnderSongs', async () => {
    // UT-PERSIST-TRASH-34 trash-index.json にその曲の 1 件が無い（元のサブフォルダが分からない）ときは songs/ の直下へ戻す
    fs.putJson(trashFilePath('s1'), songFileJson('s1'));
    fs.putJson(TRASH_INDEX_FILE, [{ songId: 'other', deletedAt: new Date(NOW).toISOString(), folder: 'live' }]);

    await trash.restore('s1');

    expect(fs.files.has(songFilePath('s1'))).toBe(true);
    expect(fs.readJson<TrashEntry[]>(TRASH_INDEX_FILE).map((e) => e.songId)).toEqual(['other']);
  });

  it('TRASH_EXPIRY_WARNING_DAYS_Is3', () => {
    // UT-PERSIST-TRASH-25 17 節「TRASH_EXPIRY_WARNING_DAYS = 3」
    expect(TRASH_EXPIRY_WARNING_DAYS).toBe(3);
  });
});

describe('runStartupCleanup（17 節・8 節、起動のときに 1 回）', () => {
  function deps(overrides: Partial<StartupCleanupDeps> = {}): StartupCleanupDeps & {
    order: string[];
    report: ReturnType<typeof vi.fn>;
  } {
    const order: string[] = [];
    return {
      order,
      trash: {
        purgeExpired: vi.fn((days: number) => {
          order.push(`purge:${days}`);
          return Promise.resolve(0);
        }),
        findExpiringSoon: vi.fn((days: number, threshold: number) => {
          order.push(`find:${days}:${threshold}`);
          return Promise.resolve(['x', 'y']);
        }),
      },
      preMigration: {
        purgeExpired: vi.fn(() => {
          order.push('premig');
          return Promise.resolve(0);
        }),
      },
      retentionDays: 14,
      report: vi.fn(),
      ...overrides,
    } as StartupCleanupDeps & { order: string[]; report: ReturnType<typeof vi.fn> };
  }

  it('runStartupCleanup_PurgesThenFindsWithWarningDays_ReportsFILE007Count_AndPurgesPreMigration', async () => {
    // UT-PERSIST-TRASH-26 17 節の (b)「purgeExpired の後で findExpiringSoon(retentionDays, TRASH_EXPIRY_WARNING_DAYS) を 1 回だけ呼び、1 件以上なら report('FILE-007', { count })」。8 節「30 日を過ぎたものは起動したときに消す」
    const d = deps();
    await runStartupCleanup(d);
    expect(d.order).toEqual(['purge:14', 'find:14:3', 'premig']);
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.report).toHaveBeenCalledWith('FILE-007', { count: 2 });
  });

  it('runStartupCleanup_NoneExpiringSoon_DoesNotReport', async () => {
    // UT-PERSIST-TRASH-27 1 件以上のときだけ知らせる
    const d = deps();
    d.trash.findExpiringSoon = vi.fn(() => Promise.resolve([]));
    await runStartupCleanup(d);
    expect(d.report).not.toHaveBeenCalled();
  });

  it('runStartupCleanup_EveryStepFails_DoesNotThrowAndRunsTheRest', async () => {
    // UT-PERSIST-TRASH-28 片付けの失敗で起動を止めない。1 つが失敗してもほかは走る
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps();
    d.trash.purgeExpired = vi.fn(() => Promise.reject(new Error('purge')));
    d.trash.findExpiringSoon = vi.fn(() => Promise.reject(new Error('find')));
    const premig = vi.fn(() => Promise.reject(new Error('premig')));
    d.preMigration = { purgeExpired: premig };

    await expect(runStartupCleanup(d)).resolves.toBeUndefined();

    expect(d.trash.findExpiringSoon).toHaveBeenCalled();
    expect(premig).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('runStartupCleanup_WithRealTrashService_PurgesExpiredAndWarnsOnlyForNearOnes', async () => {
    // UT-PERSIST-TRASH-29 17 節：保持期間 30 日で、31 日前の曲は消え、28 日前の曲（残り 2 日）だけを FILE-007 で数える
    fs.putJson(trashFilePath('old'), songFileJson('old'));
    fs.putJson(trashFilePath('near'), songFileJson('near'));
    fs.putJson(trashFilePath('new'), songFileJson('new'));
    fs.putJson(TRASH_INDEX_FILE, [
      { songId: 'old', deletedAt: new Date(NOW - 31 * MS_PER_DAY).toISOString(), folder: '' },
      { songId: 'near', deletedAt: new Date(NOW - 28 * MS_PER_DAY).toISOString(), folder: '' },
      { songId: 'new', deletedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(), folder: '' },
    ]);
    const report = vi.fn();

    await runStartupCleanup({
      trash,
      preMigration: { purgeExpired: () => Promise.resolve(0) },
      retentionDays: 30,
      report,
    });

    expect(fs.files.has(trashFilePath('old'))).toBe(false);
    expect(report).toHaveBeenCalledWith('FILE-007', { count: 1 });
  });
});
