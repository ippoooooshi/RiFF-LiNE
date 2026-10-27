// UT-PERSIST-REPO: `SongRepository`（読み書き・整合性検証）
// 検証節: data-model-persistence.md 7 節・8 節・9.1 節・15 節・18 節
// UT: data-model-persistence.md 15 節・20 節、B25 — SongRepository
// 検証観点: create→load 往復、SongNotFoundError、IntegrityCheckFailedError、
// アトミック書き込み（tmp→rename）、保存直前の LocalBackupService.rotate（C0/C1）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_SCHEMA_VERSION, createEmptyAppMetadata } from '../domain/SongDocument';
import type { SongSummary } from '../domain/types';
import { SONG_COUNT_LIMIT } from '../domain/validation';
import type { NotificationEvent } from '../errors';
import { notificationCenter } from '../errors';
import { FileReadError } from '../platform/errors';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { ChecksumUtil } from './ChecksumUtil';
import { INDEX_FILE } from './constants';
import {
  CorruptSongFileError,
  IntegrityCheckFailedError,
  SongCountLimitError,
  SongNotFoundError,
  UnsupportedSchemaVersionError,
} from './errors';
import { LocalBackupService } from './LocalBackupService';
import { PreMigrationService } from './PreMigrationService';
import { SchemaMigrator } from './SchemaMigrator';
import { SongIndexService } from './SongIndexService';
import { SongRepository, duplicateSongTitle } from './SongRepository';
import { songFilePath, songTmpFilePath } from './paths';

let fs: FakeFileSystemAdapter;
let backup: FakeFileSystemAdapter;
let migrator: SchemaMigrator;
let index: SongIndexService;
let localBackup: LocalBackupService;
let repo: SongRepository;

beforeEach(() => {
  fs = new FakeFileSystemAdapter({ rootPath: '/active/TabApp' });
  backup = new FakeFileSystemAdapter({ rootPath: '/userData/LocalBackup' });
  migrator = new SchemaMigrator();
  index = new SongIndexService(fs);
  localBackup = new LocalBackupService(fs, backup, migrator);
  repo = new SongRepository(fs, migrator, index, localBackup);
});

describe('SongRepository.create + load', () => {
  it('create_PersistsImmediately_AndLoadRoundTrips', async () => {
    // UT-PERSIST-REPO-01
    const created = await repo.create({ title: 'Fresh' });
    expect(fs.files.has(songFilePath(created.id))).toBe(true);

    const loaded = await repo.load(created.id);
    expect(loaded.id).toBe(created.id);
    expect(loaded.score.title).toBe('Fresh');
    // index.json にも 1 件登録されている。
    expect(fs.readJson<unknown[]>(INDEX_FILE)).toHaveLength(1);
  });

  it('create_GeneratesUniqueIds', async () => {
    // UT-PERSIST-REPO-02
    const a = await repo.create({ title: 'A' });
    const b = await repo.create({ title: 'B' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('SongRepository.load', () => {
  it('load_MissingFile_ThrowsSongNotFoundError', async () => {
    // UT-PERSIST-REPO-03
    await expect(repo.load('nope')).rejects.toBeInstanceOf(SongNotFoundError);
  });

  it('load_ChecksumMismatch_ThrowsIntegrityCheckFailedError', async () => {
    // UT-PERSIST-REPO-04
    const created = await repo.create({ title: 'Tampered' });
    // 保存済みファイルを直接書き換えてチェックサムを不一致にする。
    const raw = fs.readJson<{ song: { title: string } }>(songFilePath(created.id));
    raw.song.title = 'Tampered!!';
    fs.putJson(songFilePath(created.id), raw);

    await expect(repo.load(created.id)).rejects.toBeInstanceOf(IntegrityCheckFailedError);
  });

  it('load_NoChecksumStored_LoadsWithWarning', async () => {
    // UT-PERSIST-REPO-05
    fs.dirs.add('songs');
    fs.putJson(songFilePath('legacy'), {
      schemaVersion: '1.0.0',
      id: 'legacy',
      createdAt: '2026-01-01T00:00:00.000Z',
      song: { title: 'Legacy' },
      appMeta: { tags: [], memos: [], sectionMarkers: [], settings: {}, thumbnail: null },
      integrity: { savedAtMonotonic: 0, checksum: '' },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = await repo.load('legacy');
    expect(doc.score.title).toBe('Legacy');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('load_UsesFileNameAsIdOfRecord', async () => {
    // UT-PERSIST-REPO-06
    const created = await repo.create({ title: 'Rename me' });
    const raw = fs.readJson<{ id: string }>(songFilePath(created.id));
    raw.id = 'stale-embedded-id';
    fs.putJson(songFilePath(created.id), raw);
    // チェックサムは id を含まない { schemaVersion, song, appMeta } なので依然一致する。
    const loaded = await repo.load(created.id);
    expect(loaded.id).toBe(created.id);
  });
});

describe('SongRepository.save', () => {
  it('save_WritesAtomicallyViaTmpThenRename', async () => {
    // UT-PERSIST-REPO-07
    const created = await repo.create({ title: 'Atomic' });
    const renameSpy = vi.spyOn(fs, 'renameFile');
    const writeSpy = vi.spyOn(fs, 'writeFile');

    await repo.save(created);

    const tmp = songTmpFilePath(created.id);
    const final = songFilePath(created.id);
    // tmp へ書き、tmp→final へ rename する。書き込み順が rename より前。
    const tmpWriteIndex = writeSpy.mock.calls.findIndex(([p]) => p === tmp);
    expect(tmpWriteIndex).toBeGreaterThanOrEqual(0);
    expect(ArrayBuffer.isView(writeSpy.mock.calls[tmpWriteIndex]![1])).toBe(true);
    expect(renameSpy).toHaveBeenCalledWith(tmp, final);
    // 一時ファイルは残っていない。
    expect(fs.files.has(tmp)).toBe(false);
  });

  it('save_RotatesLocalBackupBeforeWriting', async () => {
    // UT-PERSIST-REPO-08
    const created = await repo.create({ title: 'V1' });
    const rotateSpy = vi.spyOn(localBackup, 'rotate');

    created.score.title = 'V2';
    await repo.save(created);

    expect(rotateSpy).toHaveBeenCalledWith(created.id);
    // 直前世代（V1）がバックアップに退避されている。
    const backupJson = JSON.parse(backup.readText(`${created.id}.tabapp`)) as { song: { title: string } };
    expect(backupJson.song.title).toBe('V1');
  });
});

// data-model-persistence.md 8 節：形の確かめ（FILE-008）・版の移行・変換する前の版を残す（PreMigration/）
describe('SongRepository.load と 8 節（形の確かめ・版の移行・変換する前の版）', () => {
  let reported: NotificationEvent[];
  let unsubscribe: () => void;
  let premig: FakeFileSystemAdapter;
  let preMigration: PreMigrationService;
  let repoWithPreMigration: SongRepository;

  beforeEach(() => {
    reported = [];
    unsubscribe = notificationCenter.subscribe((event) => reported.push(event));
    premig = new FakeFileSystemAdapter({ rootPath: '/userData/PreMigration' });
    preMigration = new PreMigrationService(premig);
    repoWithPreMigration = new SongRepository(fs, migrator, index, localBackup, preMigration);
    // load は index.json の folder から曲の場所を決める（data-model-persistence.md 9.2 節）。索引が読める状態から始め、
    // 索引の作り直しの SONG-003（9.1 節）をここで確かめる 8 節の知らせに混ぜない。
    fs.putJson(INDEX_FILE, []);
  });

  afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
  });

  function codes(): string[] {
    return reported.map((event) => event.code);
  }

  /** 新しい曲を作り、その曲のファイルを 1.0.0 の形（settings の 2 つの項目が無い・チェックサムは 1.0.0 で計算）に書き換える。 */
  async function writeVersion100Song(): Promise<string> {
    const created = await repo.create({ title: 'Old' });
    const raw = fs.readJson<{
      schemaVersion: string;
      song: unknown;
      appMeta: { settings: Record<string, unknown> } & Record<string, unknown>;
      integrity: { checksum: string };
    }>(songFilePath(created.id));
    raw.schemaVersion = '1.0.0';
    delete raw.appMeta.settings['explicitTimeSignatureBars'];
    delete raw.appMeta.settings['partPresetIds'];
    raw.integrity.checksum = ChecksumUtil.compute('1.0.0', raw.song, raw.appMeta as never);
    fs.putJson(songFilePath(created.id), raw);
    reported = [];
    return created.id;
  }

  /**
   * 1 つ目の数が今の版より小さい曲（0.9.0 の形・チェックサムは 0.9.0 で計算）を書き、0.9.0 → 1.0.0 の変換の関数を register する。
   * 変換の関数を当てるのは 1 つ目の数が上がるときだけ（data-model-persistence.md 8 節の (b)）なので、PreMigration/ へ写す曲はこの形で作る。
   */
  async function writeOlderMajorSong(): Promise<string> {
    const created = await repo.create({ title: 'Older major' });
    const raw = fs.readJson<{
      schemaVersion: string;
      song: unknown;
      appMeta: unknown;
      integrity: { checksum: string };
    }>(songFilePath(created.id));
    raw.schemaVersion = '0.9.0';
    raw.integrity.checksum = ChecksumUtil.compute('0.9.0', raw.song, raw.appMeta as never);
    fs.putJson(songFilePath(created.id), raw);
    migrator.register('0.9.0', '1.0.0', (json) => ({ ...(json as object), schemaVersion: '1.0.0' }));
    reported = [];
    return created.id;
  }

  it('load_InvalidJson_ThrowsCorruptWithFile008Only', async () => {
    // UT-PERSIST-REPO-09 data-model-persistence.md 8 節 (1)：JSON として読めなければ壊れたファイル（SongRepository.load が受け持つ）
    fs.putText(songFilePath('broken'), '{ "schemaVersion": "1.1.0", ');
    const error = await repo.load('broken').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CorruptSongFileError);
    expect((error as CorruptSongFileError).reason).toBe('invalid-json');
    expect(codes()).toEqual(['FILE-008']);
  });

  it('load_TopLevelNotObject_ThrowsCorruptWithFile008Only', async () => {
    // UT-PERSIST-REPO-10 data-model-persistence.md 8 節 (2)：いちばん上がオブジェクトでなければ壊れたファイル。FILE-004 は出さない
    for (const text of ['null', '[{"schemaVersion":"1.1.0"}]', '42']) {
      reported = [];
      fs.putText(songFilePath('notobj'), text);
      await expect(repo.load('notobj')).rejects.toBeInstanceOf(CorruptSongFileError);
      expect(codes()).toEqual(['FILE-008']);
    }
  });

  it('load_SchemaVersionMissingOrEmpty_ThrowsCorruptWithFile008Only', async () => {
    // UT-PERSIST-REPO-11 data-model-persistence.md 8 節 (3)：schemaVersion が空でない文字列でなければ壊れたファイル。FILE-004 は出さない
    for (const value of [{ song: {} }, { schemaVersion: '', song: {} }, { schemaVersion: 1, song: {} }]) {
      reported = [];
      fs.putJson(songFilePath('nover'), value);
      await expect(repo.load('nover')).rejects.toBeInstanceOf(CorruptSongFileError);
      expect(codes()).toEqual(['FILE-008']);
    }
  });

  it('load_NewerVersion_ThrowsUnsupportedWithFile004Only', async () => {
    // UT-PERSIST-REPO-12 data-model-persistence.md 8 節：形が正しく今より新しい版のときだけ FILE-004
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.putJson(songFilePath('future'), { schemaVersion: '9.0.0', song: {}, appMeta: {}, integrity: {} });
    await expect(repoWithPreMigration.load('future')).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);
    expect(codes()).toEqual(['FILE-004']);
    // 今より新しい版は変換しないので、変換する前の版も残さない
    expect(premig.files.size).toBe(0);
  });

  it('load_Version100_MigratedBeforeExpandingWithSettingsPer64', async () => {
    // UT-PERSIST-REPO-13 data-model-persistence.md 8 節：1.0.0 の曲は変換を終えてから曲をメモリに広げる。6.4 節の補い方で settings を補う
    const id = await writeVersion100Song();
    const doc = await repo.load(id);
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.appMeta.settings.partPresetIds).toEqual(doc.score.tracks.map(() => null));
    expect(doc.appMeta.settings.partPresetIds).toHaveLength(1);
    expect(doc.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect(codes()).toEqual([]);
  });

  it('load_Version100_NextSaveOverwritesWithCurrentVersion', async () => {
    // UT-PERSIST-REPO-14 data-model-persistence.md 8 節：変換した曲は、次の自動保存のときに今の版で上書きする（一括の変換は持たない）
    const id = await writeVersion100Song();
    expect(fs.readJson<{ schemaVersion: string }>(songFilePath(id)).schemaVersion).toBe('1.0.0');
    const doc = await repo.load(id);
    // 読んだだけではファイルを書き換えない
    expect(fs.readJson<{ schemaVersion: string }>(songFilePath(id)).schemaVersion).toBe('1.0.0');
    await repo.save(doc);
    const saved = fs.readJson<{ schemaVersion: string; appMeta: { settings: Record<string, unknown> } }>(
      songFilePath(id),
    );
    expect(saved.schemaVersion).toBe('1.1.0');
    expect(saved.appMeta.settings['partPresetIds']).toEqual([null]);
    // 上書きした曲は、そのまま読み直せる（チェックサムが今の版で合う）
    await expect(repo.load(id)).resolves.toBeDefined();
  });

  it('load_OlderMajor_CopiesUnchangedBytesToPreMigrationBeforeMigrating', async () => {
    // UT-PERSIST-REPO-15 data-model-persistence.md 8 節：変換の前に、読んだ曲のファイルを中身を変えずに
    // PreMigration/{songId}.{変換する前の schemaVersion}.tabapp へ写す（写すのは変換の関数を当てる、1 つ目の数が上がるときだけなので 0.9.0 の曲で確かめる）
    const id = await writeOlderMajorSong();
    const original = fs.files.get(songFilePath(id))!;
    const order: string[] = [];
    vi.spyOn(preMigration, 'preserve').mockImplementation(async (...args) => {
      order.push('preserve');
      await PreMigrationService.prototype.preserve.apply(preMigration, args);
    });
    const migrateSpy = vi.spyOn(migrator, 'migrate').mockImplementation((json, current) => {
      order.push('migrate');
      return SchemaMigrator.prototype.migrate.call(migrator, json, current);
    });
    await repoWithPreMigration.load(id);
    expect(order).toEqual(['preserve', 'migrate']);
    expect(premig.files.get(`${id}.0.9.0.tabapp`)).toEqual(original);
    migrateSpy.mockRestore();
  });

  it('load_CurrentVersion_DoesNotCopyToPreMigration', async () => {
    // UT-PERSIST-REPO-16 data-model-persistence.md 8 節：変換しない曲（今の版）は写さない
    const created = await repo.create({ title: 'Now' });
    await repoWithPreMigration.load(created.id);
    expect(premig.files.size).toBe(0);
  });

  it('load_PreMigrationWriteFails_DoesNotMigrateOrOpen', async () => {
    // UT-PERSIST-REPO-17 data-model-persistence.md 8 節：変換の不具合で曲を失わないように、PreMigration/ へ写せなかったときは変換せず、曲を開かない
    const id = await writeOlderMajorSong();
    vi.spyOn(premig, 'writeFile').mockRejectedValue(new Error('disk full'));
    const migrateSpy = vi.spyOn(migrator, 'migrate');
    await expect(repoWithPreMigration.load(id)).rejects.toThrow('disk full');
    expect(migrateSpy).not.toHaveBeenCalled();
    migrateSpy.mockRestore();
  });

  it('load_ChecksumMismatchOnOldVersion_DoesNotCopyToPreMigration', async () => {
    // UT-PERSIST-REPO-18 data-model-persistence.md 8 節：integrity.checksum を確かめてから版を移す。合わなければ写さず FILE-002
    const id = await writeOlderMajorSong();
    const raw = fs.readJson<{ song: { title: string } }>(songFilePath(id));
    raw.song.title = 'Tampered';
    fs.putJson(songFilePath(id), raw);
    await expect(repoWithPreMigration.load(id)).rejects.toBeInstanceOf(IntegrityCheckFailedError);
    expect(codes()).toEqual(['FILE-002']);
    expect(premig.files.size).toBe(0);
  });

  it('load_CorruptFile_DoesNotCopyToPreMigration', async () => {
    // UT-PERSIST-REPO-19 data-model-persistence.md 8 節：版を調べる前に形を確かめる。壊れたファイルは写さない
    fs.putText(songFilePath('broken'), 'not json');
    await expect(repoWithPreMigration.load('broken')).rejects.toBeInstanceOf(CorruptSongFileError);
    fs.putJson(songFilePath('broken'), { schemaVersion: '' });
    await expect(repoWithPreMigration.load('broken')).rejects.toBeInstanceOf(CorruptSongFileError);
    expect(premig.files.size).toBe(0);
    expect(codes()).toEqual(['FILE-008', 'FILE-008']);
  });

  it('load_SameMajorOlderMinor_OpensWithoutCopyingToPreMigration', async () => {
    // UT-PERSIST-REPO-30 data-model-persistence.md 8 節の (b)：写すのは変換の関数を当てるとき（1 つ目の数が上がるとき）だけ。
    // 1.0.0 の曲は 2 つ目の数の違いなので、写さずに読むときの整えで 6.4 節の補い方をして開く（honnin-queue 211 番）
    const id = await writeVersion100Song();
    const preserve = vi.spyOn(preMigration, 'preserve');
    const doc = await repoWithPreMigration.load(id);
    expect(preserve).not.toHaveBeenCalled();
    expect(premig.files.size).toBe(0);
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.appMeta.settings.partPresetIds).toEqual([null]);
    expect(codes()).toEqual([]);
  });

  it('load_SameMajorNewerMinor_OpensWithoutFile004OrCopy', async () => {
    // UT-PERSIST-REPO-31 data-model-persistence.md 8 節：1 つ目の数が同じなら、2 つ目の数が今の版より大きくても FILE-004 にせず、写さずに開く
    const created = await repo.create({ title: 'Newer minor' });
    const raw = fs.readJson<{
      schemaVersion: string;
      song: unknown;
      appMeta: unknown;
      integrity: { checksum: string };
    }>(songFilePath(created.id));
    raw.schemaVersion = '1.9.0';
    raw.integrity.checksum = ChecksumUtil.compute('1.9.0', raw.song, raw.appMeta as never);
    fs.putJson(songFilePath(created.id), raw);
    reported = [];
    const doc = await repoWithPreMigration.load(created.id);
    expect(doc.score.title).toBe('Newer minor');
    expect(premig.files.size).toBe(0);
    expect(codes()).toEqual([]);
  });

  it('load_SameMajorNewerMinor_RemembersIdUntilAllowEditing', async () => {
    // UT-PERSIST-REPO-32 data-model-persistence.md 8 節（honnin-queue 213 番）：2 つ目の数が今の版より大きい曲を読んだら、その id を覚える
    // （isNewerVersion）。allowEditing で外す。今の版の曲は覚えない
    const created = await repo.create({ title: 'Newer minor' });
    const other = await repo.create({ title: 'Current' });
    const raw = fs.readJson<{
      schemaVersion: string;
      song: unknown;
      appMeta: unknown;
      integrity: { checksum: string };
    }>(songFilePath(created.id));
    raw.schemaVersion = '1.2.0';
    raw.integrity.checksum = ChecksumUtil.compute('1.2.0', raw.song, raw.appMeta as never);
    fs.putJson(songFilePath(created.id), raw);

    expect(repo.isNewerVersion(created.id)).toBe(false);
    await repo.load(created.id);
    await repo.load(other.id);
    expect(repo.isNewerVersion(created.id)).toBe(true);
    expect(repo.isNewerVersion(other.id)).toBe(false);
    // 読むだけの曲は保存の前の状態のまま（load はファイルを書き換えない）
    expect(fs.readJson<{ schemaVersion: string }>(songFilePath(created.id)).schemaVersion).toBe('1.2.0');

    repo.allowEditing(created.id);
    expect(repo.isNewerVersion(created.id)).toBe(false);
    // 覚えていない曲の allowEditing は何もしない
    repo.allowEditing('unknown');
    expect(repo.isNewerVersion('unknown')).toBe(false);
  });

  it('load_PreMigrationWriteFails_ReportsFile001AndRethrows', async () => {
    // UT-PERSIST-REPO-33 data-model-persistence.md 8 節（honnin-queue 212 番）：PreMigration/ へ写せなかったときは変換せず、曲を開かず、
    // Error の FILE-001 を出す（文言は今のまま）。投げるのは写せなかった例外そのもの
    const id = await writeOlderMajorSong();
    const failure = new Error('disk full');
    vi.spyOn(premig, 'writeFile').mockRejectedValue(failure);
    const migrateSpy = vi.spyOn(migrator, 'migrate');
    const error = await repoWithPreMigration.load(id).catch((e: unknown) => e);
    expect(error).toBe(failure);
    expect(migrateSpy).not.toHaveBeenCalled();
    expect(reported.map((event) => [event.code, event.level])).toEqual([['FILE-001', 'error']]);
    expect(reported[0]!.message).toBe('保存に失敗しました。保存先の空き容量・アクセス権を確認してください。');
    expect(reported[0]!.context).toMatchObject({ songId: id, reason: 'pre-migration-copy-failed' });
  });
});

// data-model-persistence.md 9.1 節：曲のファイルを書いた後に upsert を呼ぶ 1 つの経路と、サムネイルの写し
describe('SongRepository.save と 9.1 節（索引の直しとサムネイルの写し）', () => {
  /** PNG の先頭 8 バイト（シグネチャ）。 */
  const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const PNG_BASE64 = btoa(String.fromCharCode(...PNG_BYTES));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function indexEntry(id: string): SongSummary {
    return fs.readJson<SongSummary[]>(INDEX_FILE).find((s) => s.id === id)!;
  }

  it('save_UpsertsTenItemSummaryAfterWritingSongFile', async () => {
    // UT-PERSIST-REPO-20 9.1 節 (b)：曲のファイルを書いた後に SongRepository.save が upsert を呼ぶ。9 節の 10 項目
    const created = await repo.create({
      title: 'Song',
      parts: [{ name: 'Bass', instrumentType: 'bass', tuning: [43, 38, 33, 28] }],
    });
    created.score.artist = 'Artist';
    created.score.tracks[0]!.staves[0]!.stringTuning.name = 'Standard';
    created.appMeta.tags.push({ tagId: 'tag-1' });
    const renameSpy = vi.spyOn(fs, 'renameFile');
    const upsertSpy = vi.spyOn(index, 'upsert');

    await repo.save(created);

    // 曲のファイルの改名が、索引の書き込みより先。
    const order = renameSpy.mock.calls.map(([, to]) => to);
    expect(order.indexOf(songFilePath(created.id))).toBeLessThan(order.indexOf(INDEX_FILE));
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const saved = fs.readJson<{ integrity: { savedAtMonotonic: number } }>(songFilePath(created.id));
    expect(indexEntry(created.id)).toEqual({
      id: created.id,
      title: 'Song',
      artist: 'Artist',
      createdAt: created.createdAt,
      updatedAt: new Date(saved.integrity.savedAtMonotonic).toISOString(),
      tags: ['tag-1'],
      thumbnailRef: null,
      firstPartInstrumentType: 'bass',
      firstPartTuningName: 'Standard',
      folder: '',
    });
  });

  it('save_ThumbnailSet_WritesPngCopyAfterSongFileAndSetsThumbnailRef', async () => {
    // UT-PERSIST-REPO-21 9.1 節 (b)：base64 を PNG のバイト列に戻して一時ファイルからの改名で書き、thumbnailRef を thumbnails/{songId}.png に。
    // 写しは曲のファイル（正）を書き終えた後に作る
    const created = await repo.create({ title: 'Thumb' });
    created.appMeta.thumbnail = { encoding: 'base64-png', data: PNG_BASE64 };
    const renameSpy = vi.spyOn(fs, 'renameFile');

    await repo.save(created);

    expect([...fs.files.get(`thumbnails/${created.id}.png`)!]).toEqual(PNG_BYTES);
    const targets = renameSpy.mock.calls.map(([, to]) => to);
    expect(targets).toEqual([songFilePath(created.id), `thumbnails/${created.id}.png`, INDEX_FILE]);
    expect(renameSpy).toHaveBeenCalledWith(`thumbnails/${created.id}.png.tmp`, `thumbnails/${created.id}.png`);
    expect(indexEntry(created.id).thumbnailRef).toBe(`thumbnails/${created.id}.png`);
  });

  it('save_ThumbnailUnchangedSinceLastSave_DoesNotRewriteCopy', async () => {
    // UT-PERSIST-REPO-22 9.1 節 (b)：写しは appMeta.thumbnail が前の保存から変わったときに書く
    const created = await repo.create({ title: 'Same' });
    created.appMeta.thumbnail = { encoding: 'base64-png', data: PNG_BASE64 };
    await repo.save(created);
    const writeSpy = vi.spyOn(fs, 'writeFile');

    await repo.save(created);
    expect(writeSpy.mock.calls.some(([p]) => p.startsWith('thumbnails/'))).toBe(false);

    created.appMeta.thumbnail = { encoding: 'base64-png', data: btoa('changed') };
    await repo.save(created);
    expect(writeSpy.mock.calls.filter(([p]) => p.startsWith('thumbnails/'))).toHaveLength(1);
    expect(new TextDecoder().decode(fs.files.get(`thumbnails/${created.id}.png`))).toBe('changed');
  });

  it('save_ThumbnailNull_NoCopyAndThumbnailRefNull', async () => {
    // UT-PERSIST-REPO-23 9.1 節 (b)：appMeta.thumbnail が null なら写しを作らず、thumbnailRef も null
    const created = await repo.create({ title: 'NoThumb' });
    expect(fs.files.has(`thumbnails/${created.id}.png`)).toBe(false);
    expect(indexEntry(created.id).thumbnailRef).toBeNull();

    created.appMeta.thumbnail = { encoding: 'base64-png', data: PNG_BASE64 };
    await repo.save(created);
    created.appMeta.thumbnail = null;
    await repo.save(created);
    expect(indexEntry(created.id).thumbnailRef).toBeNull();

    // null を挟んだあとに同じ画像に戻したときは、前の保存（null）から変わったので書き直す。
    fs.files.delete(`thumbnails/${created.id}.png`);
    created.appMeta.thumbnail = { encoding: 'base64-png', data: PNG_BASE64 };
    await repo.save(created);
    expect(fs.files.has(`thumbnails/${created.id}.png`)).toBe(true);
  });

  it('save_SongInSubfolder_WritesInItsFolderAndKeepsFolder', async () => {
    // UT-PERSIST-REPO-24 5 節：曲のファイルの場所は id と index.json の songs/ からの相対フォルダで決まる
    const created = await repo.create({ title: 'Moved' });
    const entries = fs.readJson<SongSummary[]>(INDEX_FILE).map((s) => ({ ...s, folder: 'live/2026' }));
    fs.putJson(INDEX_FILE, entries);
    fs.files.delete(songFilePath(created.id));

    await repo.save(created);

    expect(fs.files.has(songFilePath(created.id, 'live/2026'))).toBe(true);
    expect(fs.files.has(songFilePath(created.id))).toBe(false);
    expect(indexEntry(created.id).folder).toBe('live/2026');
  });

  it('save_ThumbnailCopyFails_SaveContinuesAndRetriesNextSave', async () => {
    // UT-PERSIST-REPO-25 写しを書けなくても、曲のファイルと索引の直しは続ける（写しは appMeta.thumbnail から作り直せる）
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const created = await repo.create({ title: 'Broken thumb' });
    created.appMeta.thumbnail = { encoding: 'base64-png', data: PNG_BASE64 };
    const original = fs.writeFile.bind(fs);
    const writeSpy = vi
      .spyOn(fs, 'writeFile')
      .mockImplementation((p, data) =>
        p.startsWith('thumbnails/') ? Promise.reject(new Error('disk full')) : original(p, data),
      );

    await repo.save(created);
    expect(warn).toHaveBeenCalled();
    expect(indexEntry(created.id).thumbnailRef).toBe(`thumbnails/${created.id}.png`);

    writeSpy.mockImplementation(original);
    await repo.save(created);
    expect(fs.files.has(`thumbnails/${created.id}.png`)).toBe(true);
  });
});

describe('SongRepository.load（読み込みの失敗とサブフォルダ）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('load_ReadFailsOtherThanNotFound_RethrowsAsIs', async () => {
    // UT-PERSIST-REPO-26 ファイルが無い以外の読み込みの失敗は SongNotFoundError に替えず、そのまま呼び出し元へ伝える
    const created = await repo.create({ title: 'Unreadable' });
    const original = fs.readFile.bind(fs);
    vi.spyOn(fs, 'readFile').mockImplementation((p) =>
      p === songFilePath(created.id) ? Promise.reject(new FileReadError(p)) : original(p),
    );
    const error = await repo.load(created.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileReadError);
    expect(error).not.toBeInstanceOf(SongNotFoundError);
  });

  it('load_SongInSubfolder_ReadsFromIndexFolder', async () => {
    // UT-PERSIST-REPO-27 data-model-persistence.md 9.2 節：曲は songs/ の下のサブフォルダに置かれる。load は index.json の folder から場所を決める
    const created = await repo.create({ title: 'In folder' });
    const bytes = fs.files.get(songFilePath(created.id))!;
    fs.files.set(songFilePath(created.id, 'live/2026'), bytes);
    fs.files.delete(songFilePath(created.id));
    fs.putJson(
      INDEX_FILE,
      fs.readJson<SongSummary[]>(INDEX_FILE).map((s) => ({ ...s, folder: 'live/2026' })),
    );

    const loaded = await repo.load(created.id);

    expect(loaded.id).toBe(created.id);
    expect(loaded.score.title).toBe('In folder');
  });

  it('load_NotInIndex_ReadsSongsRoot', async () => {
    // UT-PERSIST-REPO-28 data-model-persistence.md 9.2 節：索引に無い曲は save と同じく songs/ の直下を読む
    const created = await repo.create({ title: 'Unindexed' });
    fs.putJson(INDEX_FILE, []);

    const loaded = await repo.load(created.id);

    expect(loaded.score.title).toBe('Unindexed');
  });

  it('load_AppMetaMissing_VerifiesChecksumWithEmptyAppMeta', async () => {
    // UT-PERSIST-REPO-29 data-model-persistence.md 7 節・8 節：appMeta が無い曲は空の appMeta とみなしてチェックサムを確かめ、
    // 読むときに既定の値で補う
    const created = await repo.create({ title: 'No meta' });
    const raw = fs.readJson<{
      schemaVersion: string;
      song: unknown;
      appMeta?: unknown;
      integrity: { checksum: string };
    }>(songFilePath(created.id));
    delete raw.appMeta;
    raw.integrity.checksum = ChecksumUtil.compute(raw.schemaVersion, raw.song, createEmptyAppMetadata());
    fs.putJson(songFilePath(created.id), raw);

    const loaded = await repo.load(created.id);

    expect(loaded.score.title).toBe('No meta');
    expect(loaded.appMeta.tags).toEqual([]);
    expect(loaded.appMeta.thumbnail).toBeNull();
  });
});

// data-model-persistence.md 18 節：曲の複製（SongRepository.duplicate）
describe('SongRepository.duplicate（18 節）', () => {
  const PNG_BASE64 = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function indexEntries(): SongSummary[] {
    return fs.readJson<SongSummary[]>(INDEX_FILE);
  }

  /** 索引の folder を書き換え、曲のファイルをそのサブフォルダへ移す。 */
  function moveToFolder(songId: string, folder: string): void {
    const bytes = fs.files.get(songFilePath(songId))!;
    fs.files.delete(songFilePath(songId));
    fs.putText(songFilePath(songId, folder), new TextDecoder().decode(bytes));
    fs.putJson(
      INDEX_FILE,
      indexEntries().map((s) => (s.id === songId ? { ...s, folder } : s)),
    );
  }

  it('duplicate_WritesNewIdInSameFolderWithCopyTitleAndKeepsSongAndAppMeta', async () => {
    // UT-PERSIST-REPO-34 18 節：元の曲を読み、新しい id で同じサブフォルダへ書く。title は「<元の曲名> のコピー」、createdAt は複製した時刻。
    // song の本体と appMeta はそのまま引き継ぎ、index.json に新しい SongSummary を足す（folder も元の曲の値）。元の曲は変えない
    const source = await repo.create({ title: 'Song' });
    source.score.artist = 'Artist';
    source.appMeta.tags.push({ tagId: 'tag-1' });
    await repo.save(source);
    moveToFolder(source.id, 'live/2026');
    const originalBytes = fs.files.get(songFilePath(source.id, 'live/2026'))!;
    const renameSpy = vi.spyOn(fs, 'renameFile');
    const before = Date.now();

    const copy = await repo.duplicate(source.id);

    expect(copy.id).not.toBe(source.id);
    expect(copy.score.title).toBe('Song のコピー');
    expect(Date.parse(copy.createdAt)).toBeGreaterThanOrEqual(before);
    expect(copy.createdAt).not.toBe(source.createdAt);
    // 15 節のアトミックな書き込み：一時ファイルから本ファイルへ改名する
    expect(renameSpy).toHaveBeenCalledWith(
      `${songFilePath(copy.id, 'live/2026')}.tmp`,
      songFilePath(copy.id, 'live/2026'),
    );
    expect(fs.files.has(songFilePath(copy.id))).toBe(false);
    const loaded = await repo.load(copy.id);
    expect(loaded.score.title).toBe('Song のコピー');
    expect(loaded.score.tracks).toHaveLength(source.score.tracks.length);
    expect(loaded.appMeta).toEqual(source.appMeta);
    expect(fs.files.get(songFilePath(source.id, 'live/2026'))).toEqual(originalBytes);
    const added = indexEntries().find((s) => s.id === copy.id)!;
    expect(added).toMatchObject({
      title: 'Song のコピー',
      artist: 'Artist',
      folder: 'live/2026',
      tags: ['tag-1'],
      createdAt: copy.createdAt,
    });
    expect(indexEntries()).toHaveLength(2);
  });

  it('duplicateSongTitle_TakenNames_AddsSmallestFreeNumber', async () => {
    // UT-PERSIST-REPO-35 18 節：同じ名前の曲が既にあれば「のコピー 2」「のコピー 3」と、空いているいちばん小さい数を足す。
    // 同じ名前があるかは index.json の title だけで調べる
    expect(duplicateSongTitle('A', [])).toBe('A のコピー');
    expect(duplicateSongTitle('A', ['A のコピー'])).toBe('A のコピー 2');
    expect(duplicateSongTitle('A', ['A のコピー', 'A のコピー 2', 'A のコピー 4'])).toBe('A のコピー 3');
    expect(duplicateSongTitle('A', ['A のコピー 2'])).toBe('A のコピー');

    const source = await repo.create({ title: 'Tune' });
    const first = await repo.duplicate(source.id);
    const second = await repo.duplicate(source.id);
    const third = await repo.duplicate(source.id);
    expect([first.score.title, second.score.title, third.score.title]).toEqual([
      'Tune のコピー',
      'Tune のコピー 2',
      'Tune のコピー 3',
    ]);
  });

  it('duplicate_WithThumbnail_CopiesPngWithCopyFileAndDoesNotRegenerate', async () => {
    // UT-PERSIST-REPO-36 18 節・9.1 節：サムネイルは作り直さず、thumbnails/{元id}.png を copyFile で thumbnails/{新id}.png へ写す
    const source = await repo.create({ title: 'Thumb' });
    source.appMeta.thumbnail = { encoding: 'base64-png', data: PNG_BASE64 };
    await repo.save(source);
    const copySpy = vi.spyOn(fs, 'copyFile');
    const writeSpy = vi.spyOn(fs, 'writeFile');

    const copy = await repo.duplicate(source.id);

    expect(copySpy).toHaveBeenCalledWith(`thumbnails/${source.id}.png`, `thumbnails/${copy.id}.png`);
    expect(writeSpy.mock.calls.some(([p]) => p.startsWith('thumbnails/'))).toBe(false);
    expect(fs.files.get(`thumbnails/${copy.id}.png`)).toEqual(fs.files.get(`thumbnails/${source.id}.png`));
    expect(indexEntries().find((s) => s.id === copy.id)!.thumbnailRef).toBe(`thumbnails/${copy.id}.png`);
    // 写した後の保存では、同じ画像の写しを書き直さない
    await repo.save(copy);
    expect(writeSpy.mock.calls.some(([p]) => p.startsWith('thumbnails/'))).toBe(false);
  });

  it('duplicate_ThumbnailCopyFails_DuplicateContinuesWithWarning', async () => {
    // UT-PERSIST-REPO-37 写しを写せなくても、曲のファイルと索引の直しは続ける（写しは appMeta.thumbnail から作り直せる）
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = await repo.create({ title: 'Lost thumb' });
    source.appMeta.thumbnail = { encoding: 'base64-png', data: PNG_BASE64 };
    await repo.save(source);
    fs.files.delete(`thumbnails/${source.id}.png`);

    const copy = await repo.duplicate(source.id);

    expect(warn).toHaveBeenCalled();
    expect(fs.files.has(songFilePath(copy.id))).toBe(true);
    expect(indexEntries().some((s) => s.id === copy.id)).toBe(true);
    // 次の保存で appMeta.thumbnail から写しを書く
    await repo.save(copy);
    expect(fs.files.has(`thumbnails/${copy.id}.png`)).toBe(true);
  });

  it('duplicate_WithoutThumbnail_DoesNotCopyPng', async () => {
    // UT-PERSIST-REPO-38 9.1 節：appMeta.thumbnail が null の曲は写しが無いので写さず、thumbnailRef も null
    const source = await repo.create({ title: 'Plain' });
    const copySpy = vi.spyOn(fs, 'copyFile');
    const copy = await repo.duplicate(source.id);
    expect(copySpy).not.toHaveBeenCalled();
    expect(indexEntries().find((s) => s.id === copy.id)!.thumbnailRef).toBeNull();
  });

  it('duplicate_AtSongCountLimit_ThrowsWithoutWriting', async () => {
    // UT-PERSIST-REPO-39 18 節：曲の数の上限 1000 の確かめの対象に入れ、上限に達していれば複製を拒む（SONG-002 は呼ぶ側が出す）
    const source = await repo.create({ title: 'Full' });
    const base = indexEntries()[0]!;
    fs.putJson(INDEX_FILE, [
      base,
      ...Array.from({ length: SONG_COUNT_LIMIT - 1 }, (_, i) => ({ ...base, id: `other-${i}`, title: `S${i}` })),
    ]);
    const filesBefore = new Set(fs.files.keys());

    const error = await repo.duplicate(source.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SongCountLimitError);
    expect((error as SongCountLimitError).count).toBe(SONG_COUNT_LIMIT);
    expect(new Set(fs.files.keys())).toEqual(filesBefore);

    // 1 つ空けば複製できる
    fs.putJson(INDEX_FILE, indexEntries().slice(0, SONG_COUNT_LIMIT - 1));
    await expect(repo.duplicate(source.id)).resolves.toBeDefined();
  });

  it('duplicate_SourceNotInIndex_WritesCopyInSongsRoot', async () => {
    // UT-PERSIST-REPO-41 18 節・9.2 節：元の曲が songs/ の直下なら複製も直下に置く（索引に無い曲は load と同じく直下とみなす）
    const source = await repo.create({ title: 'Loose' });
    fs.putJson(INDEX_FILE, []);
    const copy = await repo.duplicate(source.id);
    expect(fs.files.has(songFilePath(copy.id))).toBe(true);
    expect(indexEntries()).toEqual([expect.objectContaining({ id: copy.id, title: 'Loose のコピー', folder: '' })]);
  });

  it('duplicate_MissingSong_ThrowsSongNotFoundWithoutWriting', async () => {
    // UT-PERSIST-REPO-40 18 節：元の曲を読めなければ何も書かない
    fs.putJson(INDEX_FILE, []);
    const filesBefore = new Set(fs.files.keys());
    await expect(repo.duplicate('nope')).rejects.toBeInstanceOf(SongNotFoundError);
    expect(new Set(fs.files.keys())).toEqual(filesBefore);
  });
});
