// UT: data-model-persistence.md §3.3.1、B31 — IpcFileSystemAdapter / IpcFileSystemAdapterFactory
// 検証観点: fsAt への委譲（rootPath を前置）、IPC reject からの軽量エラークラス復元、Factory のキャッシュ（C0/C1）。

import { FileNotFoundError, FileReadError, FileWriteError } from '@riff-line/core/platform';
import type { RiffLineFsAtApi } from '@riff-line/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IpcFileSystemAdapter, IpcFileSystemAdapterFactory } from './ipcFileSystem';

const ROOT = '/some/root/TabApp';

function fakeFsAt(overrides: Partial<RiffLineFsAtApi> = {}): RiffLineFsAtApi {
  return {
    readFile: vi.fn().mockResolvedValue(new Uint8Array([1])),
    writeFile: vi.fn().mockResolvedValue(undefined),
    listDirectory: vi.fn().mockResolvedValue([]),
    ensureDirectory: vi.fn().mockResolvedValue(undefined),
    renameFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

let fsAt: RiffLineFsAtApi;
let adapter: IpcFileSystemAdapter;

beforeEach(() => {
  fsAt = fakeFsAt();
  adapter = new IpcFileSystemAdapter(ROOT, fsAt);
});

describe('IpcFileSystemAdapter delegation', () => {
  it('getRootPath_ReturnsConstructedRoot', () => {
    expect(adapter.getRootPath()).toBe(ROOT);
  });

  it('methods_PrefixRootPathToEveryFsAtCall', async () => {
    const data = new Uint8Array([9]);
    await adapter.readFile('a');
    await adapter.writeFile('a', data);
    await adapter.listDirectory('.');
    await adapter.ensureDirectory('songs');
    await adapter.renameFile('a', 'b');
    await adapter.deleteFile('a');
    await adapter.copyFile('a', 'b');
    await adapter.exists('a');

    expect(fsAt.readFile).toHaveBeenCalledWith(ROOT, 'a');
    expect(fsAt.writeFile).toHaveBeenCalledWith(ROOT, 'a', data);
    expect(fsAt.listDirectory).toHaveBeenCalledWith(ROOT, '.');
    expect(fsAt.ensureDirectory).toHaveBeenCalledWith(ROOT, 'songs');
    expect(fsAt.renameFile).toHaveBeenCalledWith(ROOT, 'a', 'b');
    expect(fsAt.deleteFile).toHaveBeenCalledWith(ROOT, 'a');
    expect(fsAt.copyFile).toHaveBeenCalledWith(ROOT, 'a', 'b');
    expect(fsAt.exists).toHaveBeenCalledWith(ROOT, 'a');
  });
});

describe('IpcFileSystemAdapter error reconstruction', () => {
  it('readFile_IpcRejectsWithFileNotFoundMessage_ThrowsFileNotFoundError', async () => {
    fsAt = fakeFsAt({
      readFile: vi
        .fn()
        .mockRejectedValue(
          new Error("Error invoking remote method 'fs:readFileAt': FileNotFoundError: File not found: songs/x.tabapp"),
        ),
    });
    adapter = new IpcFileSystemAdapter(ROOT, fsAt);
    await expect(adapter.readFile('songs/x.tabapp')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('readFile_IpcRejectsWithFileReadCode_ThrowsFileReadError', async () => {
    fsAt = fakeFsAt({ readFile: vi.fn().mockRejectedValue(new Error('boom FILE_READ_FAILED boom')) });
    adapter = new IpcFileSystemAdapter(ROOT, fsAt);
    await expect(adapter.readFile('x')).rejects.toBeInstanceOf(FileReadError);
  });

  it('writeFile_IpcRejectsWithFileWriteError_ThrowsFileWriteError', async () => {
    fsAt = fakeFsAt({ writeFile: vi.fn().mockRejectedValue(new Error('... FileWriteError: Failed to write file: x')) });
    adapter = new IpcFileSystemAdapter(ROOT, fsAt);
    await expect(adapter.writeFile('x', new Uint8Array())).rejects.toBeInstanceOf(FileWriteError);
  });

  it('readFile_IpcRejectsWithUnknownMessage_RethrowsAsIs', async () => {
    const original = new Error('totally unrelated failure');
    fsAt = fakeFsAt({ readFile: vi.fn().mockRejectedValue(original) });
    adapter = new IpcFileSystemAdapter(ROOT, fsAt);
    await expect(adapter.readFile('x')).rejects.toBe(original);
  });
});

describe('IpcFileSystemAdapterFactory', () => {
  it('createForRoot_CachesPerRoot', () => {
    const factory = new IpcFileSystemAdapterFactory(fsAt);
    const a1 = factory.createForRoot('/root-a');
    const a2 = factory.createForRoot('/root-a');
    const b = factory.createForRoot('/root-b');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1.getRootPath()).toBe('/root-a');
  });
});
