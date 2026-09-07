// UT / IT: web-core-foundation.md §3.3 — ElectronFileSystemAdapter
//
// 実 I/O を OS の一時ディレクトリに対して行い、テスト後に破棄する（tests.rule.md）。
// electron には依存しない（rootPath は DI）。

import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

import { FileNotFoundError, FileWriteError } from '@tab-app/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ElectronFileSystemAdapter } from './ElectronFileSystemAdapter';

let root: string;
let adapter: ElectronFileSystemAdapter;
const enc = new TextEncoder();
const dec = new TextDecoder();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tabapp-fs-'));
  adapter = new ElectronFileSystemAdapter(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('constructor', () => {
  it('constructor_RelativeRootPath_Throws', () => {
    expect(() => new ElectronFileSystemAdapter('relative/path')).toThrow(/absolute/i);
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
