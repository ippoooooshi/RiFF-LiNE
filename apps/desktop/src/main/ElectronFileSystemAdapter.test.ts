// UT / IT: web-core-foundation.md §3.3、data-model-persistence.md §3.3 — ElectronFileSystemAdapter
//
// 実 I/O を OS の一時ディレクトリに対して行い、テスト後に破棄する（tests.rule.md）。
// electron には依存しない（rootPath は DI）。

import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

import { FileNotFoundError, FileReadError, FileWriteError } from '@riff-line/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ElectronFileSystemAdapter, errorCode } from './ElectronFileSystemAdapter';

let root: string;
let adapter: ElectronFileSystemAdapter;
const enc = new TextEncoder();
const dec = new TextDecoder();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'riffline-fs-'));
  // 空ファイルを扱うテストがあるためオンデマンドリトライは既定 off で構築する（§6 は別テストで検証）。
  adapter = new ElectronFileSystemAdapter(root, { retryOnDemandDownload: false });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('constructor', () => {
  it('constructor_RelativeRootPath_Throws', () => {
    expect(() => new ElectronFileSystemAdapter('relative/path')).toThrow(/absolute/i);
  });
});

describe('errorCode', () => {
  it('errorCode_NodeErrorWithStringCode_ReturnsCode', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe('EACCES');
  });

  it('errorCode_CodeIsNotString_ReturnsUndefined', () => {
    expect(errorCode({ code: 42 })).toBeUndefined();
  });

  it('errorCode_NonObjectThrown_ReturnsUndefined', () => {
    expect(errorCode('boom')).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });
});

describe('getRootPath', () => {
  it('getRootPath_ReturnsConfiguredRoot', () => {
    expect(adapter.getRootPath()).toBe(root);
  });
});

describe('writeFile / readFile', () => {
  it('writeThenRead_RoundTripsBytes', async () => {
    await adapter.writeFile('note.txt', enc.encode('こんにちは'));
    const bytes = await adapter.readFile('note.txt');
    expect(dec.decode(bytes)).toBe('こんにちは');
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it('readFile_MissingPath_ThrowsFileNotFoundError', async () => {
    await expect(adapter.readFile('missing.txt')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('readFile_TargetIsDirectory_ThrowsFileReadError', async () => {
    // ENOENT 以外の読み取り失敗（ここでは EISDIR）は FileReadError に正規化され、
    // 生の Node エラーは外へ出ない（electron.rule.md「エラー変換」、web-core-foundation.md §3.2）。
    await adapter.ensureDirectory('adir');
    const rejection = adapter.readFile('adir');
    await expect(rejection).rejects.toBeInstanceOf(FileReadError);
    await expect(rejection).rejects.not.toBeInstanceOf(FileNotFoundError);
  });

  it('writeFile_MissingParentDirectory_ThrowsFileWriteError', async () => {
    // 親ディレクトリが無い状態での書き込みは FileWriteError に正規化される
    await expect(adapter.writeFile('nope/deep/file.txt', enc.encode('x'))).rejects.toBeInstanceOf(FileWriteError);
  });

  it('paths_EscapingRoot_AreRejected', async () => {
    await expect(adapter.readFile('../outside.txt')).rejects.toThrow(/escapes the storage root/);
  });
});

describe('ensureDirectory', () => {
  it('ensureDirectory_CreatesNestedDirs', async () => {
    await adapter.ensureDirectory('a/b/c');
    // 直後に書き込めることで存在を確認する
    await adapter.writeFile('a/b/c/f.txt', enc.encode('ok'));
    expect(dec.decode(await adapter.readFile('a/b/c/f.txt'))).toBe('ok');
  });

  it('ensureDirectory_ExistingDir_IsIdempotent', async () => {
    await adapter.ensureDirectory('dup');
    await expect(adapter.ensureDirectory('dup')).resolves.toBeUndefined();
  });
});

describe('listDirectory', () => {
  it('listDirectory_ReturnsDirEntriesWithExpectedShape', async () => {
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'a.txt'), 'hello'); // 5 bytes

    const entries = await adapter.listDirectory('.');
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

    expect(byName['a.txt'].isDirectory).toBe(false);
    expect(byName['a.txt'].sizeBytes).toBe(5);
    expect(typeof byName['a.txt'].modifiedAt).toBe('string');
    expect(() => new Date(byName['a.txt'].modifiedAt).toISOString()).not.toThrow();

    expect(byName['sub'].isDirectory).toBe(true);
    expect(byName['sub'].sizeBytes).toBe(0);
  });

  it('listDirectory_MissingPath_ThrowsFileNotFoundError', async () => {
    await expect(adapter.listDirectory('no-such-dir')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('listDirectory_TargetIsFile_ThrowsFileReadError', async () => {
    // ディレクトリでないパスの一覧要求（ENOTDIR）は FileReadError に正規化される。
    await adapter.writeFile('afile.txt', enc.encode('x'));
    const rejection = adapter.listDirectory('afile.txt');
    await expect(rejection).rejects.toBeInstanceOf(FileReadError);
    await expect(rejection).rejects.not.toBeInstanceOf(FileNotFoundError);
  });
});

describe('renameFile / deleteFile / copyFile / exists (data-model-persistence.md §3.3)', () => {
  it('renameFile_MovesFileWithinRoot', async () => {
    await adapter.ensureDirectory('songs');
    await adapter.ensureDirectory('trash');
    await adapter.writeFile('songs/s.tabapp', enc.encode('song'));
    await adapter.renameFile('songs/s.tabapp', 'trash/s.tabapp');
    await expect(adapter.readFile('songs/s.tabapp')).rejects.toBeInstanceOf(FileNotFoundError);
    expect(dec.decode(await adapter.readFile('trash/s.tabapp'))).toBe('song');
  });

  it('renameFile_MissingSource_ThrowsFileNotFoundError', async () => {
    await expect(adapter.renameFile('nope.txt', 'x.txt')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('renameFile_DestParentMissing_RejectsWithNormalizedError', async () => {
    // 移動先の親ディレクトリ未作成は呼び出し側の前提違反。生の Node エラーは外に出さない。
    await adapter.writeFile('a.txt', enc.encode('a'));
    const rejection = adapter.renameFile('a.txt', 'no/deep/b.txt');
    await expect(rejection).rejects.toBeInstanceOf(Error);
    await expect(rejection).rejects.not.toHaveProperty('errno'); // 生 Node エラーではない
  });

  it('deleteFile_RemovesFile', async () => {
    await adapter.writeFile('gone.txt', enc.encode('x'));
    await adapter.deleteFile('gone.txt');
    expect(await adapter.exists('gone.txt')).toBe(false);
  });

  it('deleteFile_MissingFile_IsIdempotent', async () => {
    await expect(adapter.deleteFile('never.txt')).resolves.toBeUndefined();
  });

  it('copyFile_DuplicatesBytes', async () => {
    await adapter.writeFile('src.txt', enc.encode('payload'));
    await adapter.copyFile('src.txt', 'dst.txt');
    expect(dec.decode(await adapter.readFile('dst.txt'))).toBe('payload');
    // 別ファイル：元も残る
    expect(await adapter.exists('src.txt')).toBe(true);
  });

  it('copyFile_MissingSource_ThrowsFileNotFoundError', async () => {
    await expect(adapter.copyFile('nope.txt', 'x.txt')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('exists_TrueForFileAndDirectory_FalseForMissing', async () => {
    await adapter.ensureDirectory('d');
    await adapter.writeFile('d/f.txt', enc.encode('x'));
    expect(await adapter.exists('d')).toBe(true);
    expect(await adapter.exists('d/f.txt')).toBe(true);
    expect(await adapter.exists('d/missing')).toBe(false);
  });

  it('paths_EscapingRoot_AreRejectedForNewMethods', async () => {
    await expect(adapter.renameFile('../a', 'b')).rejects.toThrow(/escapes the storage root/);
    await expect(adapter.deleteFile('../a')).rejects.toThrow(/escapes the storage root/);
    await expect(adapter.copyFile('../a', 'b')).rejects.toThrow(/escapes the storage root/);
    await expect(adapter.exists('../a')).rejects.toThrow(/escapes the storage root/);
  });
});

describe('readFile on-demand download retry wiring (data-model-persistence.md §6)', () => {
  // リトライ・バックオフの網羅は onDemandRetry.test.ts（注入した wait で高速検証）。ここは配線のみ。
  it('readFile_RetryDisabled_EmptyFile_ReturnsEmptyBytes', async () => {
    await writeFile(join(root, 'empty.txt'), '');
    expect((await adapter.readFile('empty.txt')).length).toBe(0);
  });

  it('readFile_RetryEnabledByDefault_NonEmptyFile_ReturnsImmediately', async () => {
    const retrying = new ElectronFileSystemAdapter(root); // 既定 on
    await writeFile(join(root, 'real.txt'), 'content');
    expect(dec.decode(await retrying.readFile('real.txt'))).toBe('content');
  });
});

describe('writeFile permission failure', () => {
  // Windows では chmod による読み取り専用化が確実に効かないため、POSIX でのみ実行する。
  const maybe = platform() === 'win32' ? it.skip : it;
  maybe('writeFile_ReadOnlyDirectory_ThrowsFileWriteError', async () => {
    await mkdir(join(root, 'ro'));
    await chmod(join(root, 'ro'), 0o500); // r-x------
    try {
      await expect(adapter.writeFile('ro/denied.txt', enc.encode('x'))).rejects.toBeInstanceOf(FileWriteError);
    } finally {
      await chmod(join(root, 'ro'), 0o700);
    }
  });
});
