// UT: data-model-persistence.md §3.2・§9.5、B25 — LocalBackupService
// 検証観点: 初回保存では no-op、複製、restore の往復と null、書き込み失敗を握り潰す（C0/C1）。

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
    await service.rotate('s1');
    expect(backup.files.size).toBe(0);
  });

  it('rotate_CurrentFileExists_CopiesOneGeneration', async () => {
    const contents = docFileJson('s1', 'Original');
    source.putText(songFilePath('s1'), contents);
    await service.rotate('s1');
    expect(backup.readText('s1.tabapp')).toBe(contents);
  });

  it('rotate_BackupWriteFails_DoesNotThrow', async () => {
    source.putText(songFilePath('s1'), 'data');
    vi.spyOn(backup, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.rotate('s1')).resolves.toBeUndefined();
  });

  it('rotate_SourceReadFailsNonEnoent_DoesNotThrow', async () => {
    vi.spyOn(source, 'readFile').mockRejectedValueOnce(new Error('EACCES'));
    await expect(service.rotate('s1')).resolves.toBeUndefined();
    expect(backup.files.size).toBe(0);
  });
});

describe('LocalBackupService.restore', () => {
  it('restore_NoBackup_ReturnsNull', async () => {
    expect(await service.restore('s1')).toBeNull();
  });

  it('restore_BackupExists_ReturnsSongDocumentWithFileNameId', async () => {
    backup.putText('s1.tabapp', docFileJson('written-with-other-id', 'Recovered'));
    const restored = await service.restore('s1');
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe('s1');
    expect(restored!.score.title).toBe('Recovered');
  });
});
