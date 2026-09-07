// UT: data-model-persistence.md §3.2・§4.1〜§4.3、B25 — SongRepository
// 検証観点: create→load 往復、SongNotFoundError、IntegrityCheckFailedError、
// アトミック書き込み（tmp→rename）、保存直前の LocalBackupService.rotate（C0/C1）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { INDEX_FILE } from './constants';
import { IntegrityCheckFailedError, SongNotFoundError } from './errors';
import { LocalBackupService } from './LocalBackupService';
import { SchemaMigrator } from './SchemaMigrator';
import { SongIndexService } from './SongIndexService';
import { SongRepository } from './SongRepository';
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
    const created = await repo.create({ title: 'Fresh' });
    expect(fs.files.has(songFilePath(created.id))).toBe(true);

    const loaded = await repo.load(created.id);
    expect(loaded.id).toBe(created.id);
    expect(loaded.score.title).toBe('Fresh');
    // index.json にも 1 件登録されている。
    expect(fs.readJson<unknown[]>(INDEX_FILE)).toHaveLength(1);
  });

  it('create_GeneratesUniqueIds', async () => {
    const a = await repo.create({ title: 'A' });
    const b = await repo.create({ title: 'B' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('SongRepository.load', () => {
  it('load_MissingFile_ThrowsSongNotFoundError', async () => {
    await expect(repo.load('nope')).rejects.toBeInstanceOf(SongNotFoundError);
  });

  it('load_ChecksumMismatch_ThrowsIntegrityCheckFailedError', async () => {
    const created = await repo.create({ title: 'Tampered' });
    // 保存済みファイルを直接書き換えてチェックサムを不一致にする。
    const raw = fs.readJson<{ song: { title: string } }>(songFilePath(created.id));
    raw.song.title = 'Tampered!!';
    fs.putJson(songFilePath(created.id), raw);

    await expect(repo.load(created.id)).rejects.toBeInstanceOf(IntegrityCheckFailedError);
  });

  it('load_NoChecksumStored_LoadsWithWarning', async () => {
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
