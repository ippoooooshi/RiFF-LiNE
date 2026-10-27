// UT-PERSIST-BACKUP: `LocalBackupService`（端末ローカル 1 世代退避、B25）
// 検証節: data-model-persistence.md 20.1 節・15 節
// 検証観点: 初めての保存では何もしない、サブフォルダの曲を含めて 1 世代を退かす、restore の往復と null、失敗で投げない（C0/C1）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialScore } from '../domain/newSong';
import { SongDocument, createEmptyAppMetadata } from '../domain/SongDocument';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { LocalBackupService } from './LocalBackupService';
import { SchemaMigrator } from './SchemaMigrator';
import { songFilePath } from './paths';

let source: FakeFileSystemAdapter;
let backup: FakeFileSystemAdapter;
let service: LocalBackupService;

function docFileJson(id: string, title: string): string {
  const doc = new SongDocument({ id, score: createInitialScore({ title }), appMeta: createEmptyAppMetadata() });
  return JSON.stringify(doc.toFileJson());
}

beforeEach(() => {
  source = new FakeFileSystemAdapter({ rootPath: '/active/TabApp' });
  backup = new FakeFileSystemAdapter({ rootPath: '/userData/LocalBackup' });
  source.dirs.add('songs');
  service = new LocalBackupService(source, backup, new SchemaMigrator());
});

describe('LocalBackupService.rotate', () => {
  it('rotate_NoCurrentFile_DoesNothing', async () => {
    // UT-PERSIST-BACKUP-01
    await service.rotate('s1');
    expect(backup.files.size).toBe(0);
  });

  it('rotate_CurrentFileExists_CopiesOneGeneration', async () => {
    // UT-PERSIST-BACKUP-02
    const contents = docFileJson('s1', 'Original');
    source.putText(songFilePath('s1'), contents);
    await service.rotate('s1');
    expect(backup.readText('s1.tabapp')).toBe(contents);
  });

  it('rotate_BackupWriteFails_DoesNotThrow', async () => {
    // UT-PERSIST-BACKUP-03
    source.putText(songFilePath('s1'), 'data');
    vi.spyOn(backup, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.rotate('s1')).resolves.toBeUndefined();
  });

  it('rotate_SourceReadFailsNonEnoent_DoesNotThrow', async () => {
    // UT-PERSIST-BACKUP-04
    vi.spyOn(source, 'readFile').mockRejectedValueOnce(new Error('EACCES'));
    await expect(service.rotate('s1')).resolves.toBeUndefined();
    expect(backup.files.size).toBe(0);
  });

  it('rotate_SongInSubfolder_BacksUpFileFromIndexFolder', async () => {
    // UT-PERSIST-BACKUP-07 data-model-persistence.md 15 節の 3 と (b)：今の本ファイル songs/{サブフォルダ/}{id}.tabapp を退かす（サブフォルダは index.json の folder）
    const contents = docFileJson('s1', 'InSub');
    source.putText(songFilePath('s1', 'live/2024'), contents);
    const index = { find: vi.fn().mockResolvedValue({ id: 's1', folder: 'live/2024' }) };
    const withIndex = new LocalBackupService(source, backup, new SchemaMigrator(), index);
    await withIndex.rotate('s1');
    expect(index.find).toHaveBeenCalledWith('s1');
    expect(backup.readText('s1.tabapp')).toBe(contents);
  });

  it('rotate_SongNotInIndex_BacksUpFileDirectlyUnderSongs', async () => {
    // UT-PERSIST-BACKUP-08 索引に無い曲は songs/ の直下を見る（folder が空の文字列と同じ）
    source.putText(songFilePath('s1'), 'root');
    const index = { find: vi.fn().mockResolvedValue(undefined) };
    await new LocalBackupService(source, backup, new SchemaMigrator(), index).rotate('s1');
    expect(backup.readText('s1.tabapp')).toBe('root');
  });

  it('rotate_IndexLookupFails_DoesNotThrow', async () => {
    // UT-PERSIST-BACKUP-09 data-model-persistence.md 20.1 節：退かすのに失敗しても主の保存は続ける（投げない）
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const index = { find: vi.fn().mockRejectedValue(new Error('index broken')) };
    await expect(
      new LocalBackupService(source, backup, new SchemaMigrator(), index).rotate('s1'),
    ).resolves.toBeUndefined();
    expect(backup.files.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('LocalBackupService.restore', () => {
  it('restore_NoBackup_ReturnsNull', async () => {
    // UT-PERSIST-BACKUP-05
    expect(await service.restore('s1')).toBeNull();
  });

  it('restore_BackupExists_ReturnsSongDocumentWithFileNameId', async () => {
    // UT-PERSIST-BACKUP-06
    backup.putText('s1.tabapp', docFileJson('written-with-other-id', 'Recovered'));
    const restored = await service.restore('s1');
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe('s1');
    expect(restored!.score.title).toBe('Recovered');
  });

  it('restore_BackupUnreadable_Throws', async () => {
    // UT-PERSIST-BACKUP-10 退かした版が在るのに読めないときは、無いこと（null）と分けて投げる
    vi.spyOn(backup, 'readFile').mockRejectedValueOnce(new Error('EACCES'));
    await expect(service.restore('s1')).rejects.toThrow('EACCES');
  });
});
