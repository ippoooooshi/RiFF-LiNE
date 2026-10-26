// UT-FS-IPCADAPTER: `IpcFileSystemAdapter`（renderer 側、B31） <!-- req webcorefoundation:59bcd606.1dab --> <!-- req webcorefoundation:59bcd606.710e --> <!-- req webcorefoundation:8912729c.9639 -->
// 検証節: data-model-persistence.md 10.1 節の (b)
// UT: data-model-persistence.md 10.1 節、B31 — IpcFileSystemAdapter / IpcFileSystemAdapterFactory
// 検証観点: fsAt への委譲（rootPath を前置）、IPC reject からの軽量エラークラス復元、Factory のキャッシュ（C0/C1）。

import { FileNotFoundError, FileReadError, FileWriteError } from '@riff-line/core/platform';
import type { RiffLineFsAtApi } from '@riff-line/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// レンダラーの型の構成は Node.js の型を持たないので、ソースの文は Vite の ?raw で読む。
import ipcFileSystemSource from './ipcFileSystem.ts?raw';
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
    // UT-FS-IPCADAPTER-01
    expect(adapter.getRootPath()).toBe(ROOT);
  });

  it('methods_PrefixRootPathToEveryFsAtCall', async () => {
    // UT-FS-IPCADAPTER-02
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
    // UT-FS-IPCADAPTER-03
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
    // UT-FS-IPCADAPTER-04
    fsAt = fakeFsAt({ readFile: vi.fn().mockRejectedValue(new Error('boom FILE_READ_FAILED boom')) });
    adapter = new IpcFileSystemAdapter(ROOT, fsAt);
    await expect(adapter.readFile('x')).rejects.toBeInstanceOf(FileReadError);
  });

  it('writeFile_IpcRejectsWithFileWriteError_ThrowsFileWriteError', async () => {
    // UT-FS-IPCADAPTER-05
    fsAt = fakeFsAt({ writeFile: vi.fn().mockRejectedValue(new Error('... FileWriteError: Failed to write file: x')) });
    adapter = new IpcFileSystemAdapter(ROOT, fsAt);
    await expect(adapter.writeFile('x', new Uint8Array())).rejects.toBeInstanceOf(FileWriteError);
  });

  it('readFile_IpcRejectsWithUnknownMessage_RethrowsAsIs', async () => {
    // UT-FS-IPCADAPTER-06
    const original = new Error('totally unrelated failure');
    fsAt = fakeFsAt({ readFile: vi.fn().mockRejectedValue(original) });
    adapter = new IpcFileSystemAdapter(ROOT, fsAt);
    await expect(adapter.readFile('x')).rejects.toBe(original);
  });
});

describe('IpcFileSystemAdapterFactory', () => {
  it('createForRoot_CachesPerRoot', () => {
    // UT-FS-IPCADAPTER-07
    const factory = new IpcFileSystemAdapterFactory(fsAt);
    const a1 = factory.createForRoot('/root-a');
    const a2 = factory.createForRoot('/root-a');
    const b = factory.createForRoot('/root-b');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1.getRootPath()).toBe('/root-a');
  });

  it('createForRoot_渡したルートを持つIpcFileSystemAdapterを返し_そのルートを付けてfsAtを呼ぶ', async () => {
    // UT-FS-IPCADAPTER-08 data-model-persistence.md 10.1 節：createForRoot は渡されたルートを持つ IpcFileSystemAdapter を返し、各メソッドはそのルートを付けて fs:*At を呼ぶ
    const factory = new IpcFileSystemAdapterFactory(fsAt);
    const mirror = factory.createForRoot('D:/mirror');
    expect(mirror).toBeInstanceOf(IpcFileSystemAdapter);
    await mirror.exists('songs/a.tabapp');
    expect(fsAt.exists).toHaveBeenCalledWith('D:/mirror', 'songs/a.tabapp');
  });
});

describe('IpcFileSystemAdapter のエラーの復元（全メソッドと全経路）', () => {
  it('全メソッド_IPCがrejectする_軽量エラークラスに直し相対パスを持たせる', async () => {
    // UT-FS-IPCADAPTER-09 data-model-persistence.md 10.1 節：IPC 越しでも各メソッドのエラーの型（FileNotFoundError・FileReadError・FileWriteError）を変えない
    const notFound = (): Promise<never> => Promise.reject(new Error('FileNotFoundError: File not found'));
    const readFailed = (): Promise<never> => Promise.reject(new Error('FileReadError: Failed to read'));
    const writeFailed = (): Promise<never> => Promise.reject(new Error('FileWriteError: Failed to write file'));
    fsAt = fakeFsAt({
      listDirectory: vi.fn(notFound),
      ensureDirectory: vi.fn(writeFailed),
      renameFile: vi.fn(notFound),
      deleteFile: vi.fn(writeFailed),
      copyFile: vi.fn(writeFailed),
      exists: vi.fn(readFailed),
    });
    adapter = new IpcFileSystemAdapter(ROOT, fsAt);
    await expect(adapter.listDirectory('d')).rejects.toMatchObject({ name: 'FileNotFoundError', path: 'd' });
    await expect(adapter.ensureDirectory('e')).rejects.toMatchObject({ name: 'FileWriteError', path: 'e' });
    await expect(adapter.renameFile('from', 'to')).rejects.toMatchObject({ name: 'FileNotFoundError', path: 'from' });
    await expect(adapter.deleteFile('x')).rejects.toMatchObject({ name: 'FileWriteError', path: 'x' });
    await expect(adapter.copyFile('src', 'dst')).rejects.toMatchObject({ name: 'FileWriteError', path: 'src' });
    await expect(adapter.exists('q')).rejects.toBeInstanceOf(FileReadError);
  });

  it('復元_codeの欄_文のコード_文のクラス名のどれでも当てる', async () => {
    // UT-FS-IPCADAPTER-10 data-model-persistence.md 10.1 節：main が投げた軽量エラークラスを、code の欄・FILE_* の文字・クラス名のどれからでも直す
    const cases: ReadonlyArray<readonly [unknown, new (...args: never[]) => Error]> = [
      [Object.assign(new Error('x'), { code: 'FILE_NOT_FOUND' }), FileNotFoundError],
      [new Error('boom FILE_NOT_FOUND'), FileNotFoundError],
      [new Error('FileNotFoundError: x'), FileNotFoundError],
      [Object.assign(new Error('x'), { code: 'FILE_WRITE_FAILED' }), FileWriteError],
      [new Error('boom FILE_WRITE_FAILED'), FileWriteError],
      [new Error('FileWriteError: x'), FileWriteError],
      [Object.assign(new Error('x'), { code: 'FILE_READ_FAILED' }), FileReadError],
      [new Error('boom FILE_READ_FAILED'), FileReadError],
      [new Error('FileReadError: x'), FileReadError],
    ];
    for (const [rejection, expected] of cases) {
      adapter = new IpcFileSystemAdapter(ROOT, fakeFsAt({ readFile: vi.fn().mockRejectedValue(rejection) }));
      const error = await adapter.readFile('p').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(expected);
      expect((error as Error & { cause?: unknown }).cause).toBe(rejection);
    }
  });

  it('復元_Errorでない値でrejectする_その文のErrorにして投げる', async () => {
    // UT-FS-IPCADAPTER-11 data-model-persistence.md 10.1 節：当てはまらない失敗は軽量エラークラスに化けさせない
    for (const [rejection, message] of [
      ['plain text', 'plain text'],
      [null, 'null'],
    ] as const) {
      adapter = new IpcFileSystemAdapter(ROOT, fakeFsAt({ readFile: vi.fn().mockRejectedValue(rejection) }));
      const error = await adapter.readFile('p').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(FileNotFoundError);
      expect((error as Error).message).toBe(message);
    }
  });
});

describe('preload の呼び口だけに頼る（data-model-persistence.md 10.1 節の (b)）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('既定の呼び口_window.riffLineApi.fsAtを使う', async () => {
    // UT-FS-IPCADAPTER-12 data-model-persistence.md 10.1 節：どちらも preload が出す window.riffLineApi の呼び口だけに頼る
    vi.stubGlobal('window', { riffLineApi: { fsAt } });
    await new IpcFileSystemAdapter(ROOT).readFile('a');
    await new IpcFileSystemAdapterFactory().createForRoot('/r').writeFile('b', new Uint8Array([2]));
    expect(fsAt.readFile).toHaveBeenCalledWith(ROOT, 'a');
    expect(fsAt.writeFile).toHaveBeenCalledWith('/r', 'b', new Uint8Array([2]));
  });

  it('ipcFileSystemのimport_electronとNode.jsの組み込みモジュールを読まない', () => {
    // UT-FS-IPCADAPTER-13 data-model-persistence.md 10.1 節：electron と Node.js の組み込みモジュールを import しない
    const source = ipcFileSystemSource;
    expect(source).toContain('export class IpcFileSystemAdapter ');
    const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(specifiers)).toEqual(new Set(['@riff-line/core/platform']));
    expect(source).not.toMatch(/require\(/);
  });
});
