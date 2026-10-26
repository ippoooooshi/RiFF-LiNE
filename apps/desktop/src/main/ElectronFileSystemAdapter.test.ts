// IT-FS-ADAPTER: `ElectronFileSystemAdapter`（実 I/O・エラー正規化） <!-- req webcorefoundation:cd4cb944.6361 --> <!-- req webcorefoundation:cd4cb944.af7e --> <!-- req webcorefoundation:9351044e.96cf -->
// 検証節: web-core-foundation.md 3.2 節、data-model-persistence.md 10.1 節・16 節
// UT / IT: web-core-foundation.md 3.2 節、data-model-persistence.md 10.1 節 — ElectronFileSystemAdapter
//
// 実 I/O を OS の一時ディレクトリに対して行い、テスト後に破棄する（tests.rule.md）。
// electron には依存しない（rootPath は DI）。
// node:fs/promises は実物をそのまま呼ぶ見張り（vi.fn(実物)）に包み、rename を何回呼んだか・消してから移していないかを数える。
// 実物で起こしにくい失敗（stat の EACCES、一覧の中の項目の stat の ENOENT）だけ、その 1 回を差し替える。

import { readFileSync } from 'node:fs';
import {
  chmod,
  copyFile as fsCopyFile,
  mkdir,
  mkdtemp,
  open,
  rename as fsRename,
  rm,
  stat as fsStat,
  unlink as fsUnlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { dirname, join, parse, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileNotFoundError, FileReadError, FileWriteError } from '@riff-line/core';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { ElectronFileSystemAdapter, errorCode, resolveRootPath } from './ElectronFileSystemAdapter';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
    rm: vi.fn(actual.rm),
    copyFile: vi.fn(actual.copyFile),
    stat: vi.fn(actual.stat),
    unlink: vi.fn(actual.unlink),
  };
});

const { open: actualOpen } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

let root: string;
let adapter: ElectronFileSystemAdapter;
const enc = new TextEncoder();
const dec = new TextDecoder();

beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'riffline-fs-'));
  // 空ファイルを扱うテストがあるためオンデマンドリトライは既定 off で構築する（data-model-persistence.md 16 節は別テストで確かめる）。
  adapter = new ElectronFileSystemAdapter(root, { retryOnDemandDownload: false });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('constructor', () => {
  it('constructor_RelativeRootPath_Throws', () => {
    // IT-FS-ADAPTER-01
    expect(() => new ElectronFileSystemAdapter('relative/path')).toThrow(/absolute/i);
  });
});

describe('errorCode', () => {
  it('errorCode_NodeErrorWithStringCode_ReturnsCode', () => {
    // IT-FS-ADAPTER-02
    expect(errorCode(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe('EACCES');
  });

  it('errorCode_CodeIsNotString_ReturnsUndefined', () => {
    // IT-FS-ADAPTER-03
    expect(errorCode({ code: 42 })).toBeUndefined();
  });

  it('errorCode_NonObjectThrown_ReturnsUndefined', () => {
    // IT-FS-ADAPTER-04
    expect(errorCode('boom')).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });
});

describe('getRootPath', () => {
  it('getRootPath_ReturnsConfiguredRoot', () => {
    // IT-FS-ADAPTER-05
    expect(adapter.getRootPath()).toBe(root);
  });
});

describe('writeFile / readFile', () => {
  it('writeThenRead_RoundTripsBytes', async () => {
    // IT-FS-ADAPTER-06
    await adapter.writeFile('note.txt', enc.encode('こんにちは'));
    const bytes = await adapter.readFile('note.txt');
    expect(dec.decode(bytes)).toBe('こんにちは');
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it('readFile_MissingPath_ThrowsFileNotFoundError', async () => {
    // IT-FS-ADAPTER-07
    await expect(adapter.readFile('missing.txt')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('readFile_TargetIsDirectory_ThrowsFileReadError', async () => {
    // IT-FS-ADAPTER-08
    // ENOENT 以外の読み取り失敗（ここでは EISDIR）は FileReadError に正規化され、
    // 生の Node エラーは外へ出ない（electron.rule.md「エラー変換」、00_reference.md 3.1 節の軽量エラークラス）。
    await adapter.ensureDirectory('adir');
    const rejection = adapter.readFile('adir');
    await expect(rejection).rejects.toBeInstanceOf(FileReadError);
    await expect(rejection).rejects.not.toBeInstanceOf(FileNotFoundError);
  });

  it('writeFile_MissingParentDirectory_ThrowsFileWriteError', async () => {
    // IT-FS-ADAPTER-09
    // 親ディレクトリが無い状態での書き込みは FileWriteError に正規化される
    await expect(adapter.writeFile('nope/deep/file.txt', enc.encode('x'))).rejects.toBeInstanceOf(FileWriteError);
  });

  it('paths_EscapingRoot_AreRejected', async () => {
    // IT-FS-ADAPTER-10
    await expect(adapter.readFile('../outside.txt')).rejects.toThrow(/escapes the storage root/);
  });
});

describe('ensureDirectory', () => {
  it('ensureDirectory_CreatesNestedDirs', async () => {
    // IT-FS-ADAPTER-11
    await adapter.ensureDirectory('a/b/c');
    // 直後に書き込めることで存在を確認する
    await adapter.writeFile('a/b/c/f.txt', enc.encode('ok'));
    expect(dec.decode(await adapter.readFile('a/b/c/f.txt'))).toBe('ok');
  });

  it('ensureDirectory_ExistingDir_IsIdempotent', async () => {
    // IT-FS-ADAPTER-12
    await adapter.ensureDirectory('dup');
    await expect(adapter.ensureDirectory('dup')).resolves.toBeUndefined();
  });
});

describe('listDirectory', () => {
  it('listDirectory_ReturnsDirEntriesWithExpectedShape', async () => {
    // IT-FS-ADAPTER-13
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
    // IT-FS-ADAPTER-14
    await expect(adapter.listDirectory('no-such-dir')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('listDirectory_TargetIsFile_ThrowsFileReadError', async () => {
    // IT-FS-ADAPTER-15
    // ディレクトリでないパスの一覧要求（ENOTDIR）は FileReadError に正規化される。
    await adapter.writeFile('afile.txt', enc.encode('x'));
    const rejection = adapter.listDirectory('afile.txt');
    await expect(rejection).rejects.toBeInstanceOf(FileReadError);
    await expect(rejection).rejects.not.toBeInstanceOf(FileNotFoundError);
  });

  it('listDirectory_EntryStatFailsWithENOENT_ThrowsFileReadError', async () => {
    // IT-FS-ADAPTER-43 data-model-persistence.md 10 節：フォルダは在るが中の項目の stat で一覧を作れない（読んだ後に項目が消えた・壊れたシンボリックリンク）ときは FileReadError（FileNotFoundError にしない）
    await adapter.ensureDirectory('songs');
    await writeFile(join(root, 'songs', 'vanished.txt'), 'x');
    vi.mocked(fsStat).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const rejection = adapter.listDirectory('songs');
    await expect(rejection).rejects.toBeInstanceOf(FileReadError);
    await expect(rejection).rejects.not.toBeInstanceOf(FileNotFoundError);
    expect(vi.mocked(fsStat)).toHaveBeenCalledWith(join(root, 'songs', 'vanished.txt'));
  });
});

describe('renameFile / deleteFile / copyFile / exists (data-model-persistence.md 10.1 節)', () => {
  it('renameFile_MovesFileWithinRoot', async () => {
    // IT-FS-ADAPTER-16
    await adapter.ensureDirectory('songs');
    await adapter.ensureDirectory('trash');
    await adapter.writeFile('songs/s.tabapp', enc.encode('song'));
    await adapter.renameFile('songs/s.tabapp', 'trash/s.tabapp');
    await expect(adapter.readFile('songs/s.tabapp')).rejects.toBeInstanceOf(FileNotFoundError);
    expect(dec.decode(await adapter.readFile('trash/s.tabapp'))).toBe('song');
  });

  it('renameFile_MissingSource_ThrowsFileNotFoundError', async () => {
    // IT-FS-ADAPTER-17
    await expect(adapter.renameFile('nope.txt', 'x.txt')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('renameFile_DestParentMissing_RejectsWithNormalizedError', async () => {
    // IT-FS-ADAPTER-18
    // 移動先の親ディレクトリ未作成は呼び出し側の前提違反。生の Node エラーは外に出さない。
    await adapter.writeFile('a.txt', enc.encode('a'));
    const rejection = adapter.renameFile('a.txt', 'no/deep/b.txt');
    await expect(rejection).rejects.toBeInstanceOf(Error);
    await expect(rejection).rejects.not.toHaveProperty('errno'); // 生 Node エラーではない
  });

  it('deleteFile_RemovesFile', async () => {
    // IT-FS-ADAPTER-19
    await adapter.writeFile('gone.txt', enc.encode('x'));
    await adapter.deleteFile('gone.txt');
    expect(await adapter.exists('gone.txt')).toBe(false);
  });

  it('deleteFile_MissingFile_IsIdempotent', async () => {
    // IT-FS-ADAPTER-20
    await expect(adapter.deleteFile('never.txt')).resolves.toBeUndefined();
  });

  it('copyFile_DuplicatesBytes', async () => {
    // IT-FS-ADAPTER-21
    await adapter.writeFile('src.txt', enc.encode('payload'));
    await adapter.copyFile('src.txt', 'dst.txt');
    expect(dec.decode(await adapter.readFile('dst.txt'))).toBe('payload');
    // 別ファイル：元も残る
    expect(await adapter.exists('src.txt')).toBe(true);
  });

  it('copyFile_MissingSource_ThrowsFileWriteError', async () => {
    // IT-FS-ADAPTER-22 data-model-persistence.md 10.1 節：copyFile は写せなければ FileWriteError（写す前が無いときも分けない）
    const error = await adapter.copyFile('nope.txt', 'x.txt').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileWriteError);
    expect(error).not.toBeInstanceOf(FileNotFoundError);
    expect(await adapter.exists('x.txt')).toBe(false);
  });

  it('exists_TrueForFileAndDirectory_FalseForMissing', async () => {
    // IT-FS-ADAPTER-23
    await adapter.ensureDirectory('d');
    await adapter.writeFile('d/f.txt', enc.encode('x'));
    expect(await adapter.exists('d')).toBe(true);
    expect(await adapter.exists('d/f.txt')).toBe(true);
    expect(await adapter.exists('d/missing')).toBe(false);
  });

  it('paths_EscapingRoot_AreRejectedForNewMethods', async () => {
    // IT-FS-ADAPTER-24
    await expect(adapter.renameFile('../a', 'b')).rejects.toThrow(/escapes the storage root/);
    await expect(adapter.deleteFile('../a')).rejects.toThrow(/escapes the storage root/);
    await expect(adapter.copyFile('../a', 'b')).rejects.toThrow(/escapes the storage root/);
    await expect(adapter.exists('../a')).rejects.toThrow(/escapes the storage root/);
  });
});

describe('readFile on-demand download retry wiring (data-model-persistence.md 16 節)', () => {
  // リトライ・バックオフの網羅は onDemandRetry.test.ts（注入した wait で高速検証）。ここは配線のみ。
  it('readFile_RetryDisabled_EmptyFile_ReturnsEmptyBytes', async () => {
    // IT-FS-ADAPTER-25
    await writeFile(join(root, 'empty.txt'), '');
    expect((await adapter.readFile('empty.txt')).length).toBe(0);
  });

  it('readFile_RetryEnabledByDefault_NonEmptyFile_ReturnsImmediately', async () => {
    // IT-FS-ADAPTER-26
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

type HandleSpies = { writeFile: MockInstance; sync: MockInstance; close: MockInstance };

/**
 * 次の 1 回の open が返す FileHandle の writeFile・sync・close に見張りを付ける（中身は実物を呼ぶ）。
 * FileHandle の close はインスタンスの欄なので、prototype ではなく開いたものに付ける。
 */
function spyOnNextFileHandle(onSync?: () => Promise<void>): HandleSpies {
  const spies = {} as HandleSpies;
  vi.mocked(open).mockImplementationOnce(async (...args: Parameters<typeof open>) => {
    const handle = await actualOpen(...args);
    spies.writeFile = vi.spyOn(handle, 'writeFile');
    spies.sync = onSync ? vi.spyOn(handle, 'sync').mockImplementationOnce(onSync) : vi.spyOn(handle, 'sync');
    spies.close = vi.spyOn(handle, 'close');
    return handle;
  });
  return spies;
}

describe('writeFile のディスクへの書き出し（data-model-persistence.md 10.1 節・15 節の (b)、G74 の (6)）', () => {
  it('writeFile_書き終えたら_閉じる前にFileHandle.syncを呼ぶ', async () => {
    // IT-FS-ADAPTER-27 data-model-persistence.md 10.1 節：書き終えたら、閉じる前に FileHandle.sync() でディスクへ書き出す
    const spies = spyOnNextFileHandle();
    await adapter.writeFile('songs.tmp', enc.encode('body'));
    expect(spies.sync).toHaveBeenCalledTimes(1);
    expect(spies.close).toHaveBeenCalledTimes(1);
    expect(spies.writeFile.mock.invocationCallOrder[0]).toBeLessThan(spies.sync.mock.invocationCallOrder[0]!);
    expect(spies.sync.mock.invocationCallOrder[0]).toBeLessThan(spies.close.mock.invocationCallOrder[0]!);
    expect(dec.decode(await adapter.readFile('songs.tmp'))).toBe('body');
  });

  it('writeFile_syncが失敗_FileWriteErrorを投げてファイルを閉じる', async () => {
    // IT-FS-ADAPTER-28 data-model-persistence.md 10.1 節：書けなければ FileWriteError（ディスクへの書き出しの失敗も書けないに入る）
    const spies = spyOnNextFileHandle(() => Promise.reject(Object.assign(new Error('EIO'), { code: 'EIO' })));
    await expect(adapter.writeFile('songs.tmp', enc.encode('body'))).rejects.toBeInstanceOf(FileWriteError);
    expect(spies.close).toHaveBeenCalledTimes(1);
  });
});

describe('renameFile の置き換え（data-model-persistence.md 10.1 節）', () => {
  it('renameFile_移す後に在る_rename1回で置き換え_消してから移さない', async () => {
    // IT-FS-ADAPTER-29 data-model-persistence.md 10.1 節：移す後のパスにファイルが既に在れば rename 1 回でアトミックに置き換える。消してから移す・写してから消すにしない
    await adapter.writeFile('song.tabapp', enc.encode('old'));
    await adapter.writeFile('song.tabapp.tmp', enc.encode('new'));
    vi.clearAllMocks();
    await adapter.renameFile('song.tabapp.tmp', 'song.tabapp');
    expect(dec.decode(await adapter.readFile('song.tabapp'))).toBe('new');
    expect(await adapter.exists('song.tabapp.tmp')).toBe(false);
    expect(vi.mocked(fsRename)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rm)).not.toHaveBeenCalled();
    expect(vi.mocked(fsUnlink)).not.toHaveBeenCalled();
    expect(vi.mocked(fsCopyFile)).not.toHaveBeenCalled();
  });

  it('renameFile_移す後の親のフォルダが無い_FileWriteErrorを投げる', async () => {
    // IT-FS-ADAPTER-30 data-model-persistence.md 10.1 節：移す前は在るが移せないときは FileWriteError（ENOENT でも FileNotFoundError にしない）
    await adapter.writeFile('a.txt', enc.encode('a'));
    const rejection = adapter.renameFile('a.txt', 'no/deep/b.txt');
    await expect(rejection).rejects.toBeInstanceOf(FileWriteError);
    expect(await adapter.exists('a.txt')).toBe(true);
  });

  it('renameFile_移す後が中身のあるフォルダ_FileWriteErrorを投げる', async () => {
    // IT-FS-ADAPTER-31 data-model-persistence.md 10.1 節：移せなければ FileWriteError（ENOENT 以外の失敗）
    await adapter.writeFile('a.txt', enc.encode('a'));
    await adapter.ensureDirectory('full');
    await adapter.writeFile('full/x.txt', enc.encode('x'));
    await expect(adapter.renameFile('a.txt', 'full')).rejects.toBeInstanceOf(FileWriteError);
  });

  it('renameFile_移す前も移す後の親も無い_FileNotFoundErrorを投げる', async () => {
    // IT-FS-ADAPTER-32 data-model-persistence.md 10.1 節：移す前が無ければ FileNotFoundError（移す後の親が無くても、移す前が無いほうを知らせる）
    await expect(adapter.renameFile('ghost.txt', 'no/deep/x.txt')).rejects.toBeInstanceOf(FileNotFoundError);
  });
});

describe('作れない・消せない・写せない・調べられない（data-model-persistence.md 10.1 節）', () => {
  it('ensureDirectory_途中がファイル_FileWriteErrorを投げる', async () => {
    // IT-FS-ADAPTER-33 data-model-persistence.md 10.1 節：作れなければ FileWriteError
    await adapter.writeFile('afile', enc.encode('x'));
    await expect(adapter.ensureDirectory('afile/sub')).rejects.toBeInstanceOf(FileWriteError);
  });

  it('deleteFile_対象がフォルダ_FileWriteErrorを投げる', async () => {
    // IT-FS-ADAPTER-34 data-model-persistence.md 10.1 節：消せなければ FileWriteError
    await adapter.ensureDirectory('adir');
    await expect(adapter.deleteFile('adir')).rejects.toBeInstanceOf(FileWriteError);
    expect(await adapter.exists('adir')).toBe(true);
  });

  it('copyFile_写す後がフォルダ_FileWriteErrorを投げる', async () => {
    // IT-FS-ADAPTER-35 data-model-persistence.md 10.1 節：写せなければ FileWriteError
    await adapter.writeFile('src.txt', enc.encode('x'));
    await adapter.ensureDirectory('dst');
    await expect(adapter.copyFile('src.txt', 'dst')).rejects.toBeInstanceOf(FileWriteError);
  });

  it('exists_statがEACCES_FileReadErrorを投げる', async () => {
    // IT-FS-ADAPTER-36 data-model-persistence.md 10.1 節：調べられなければ FileReadError（無いとして false にしない）
    vi.mocked(fsStat).mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(adapter.exists('locked.txt')).rejects.toBeInstanceOf(FileReadError);
  });
});

describe('ルートの確かめ（data-model-persistence.md 10.1 節の (b)）', () => {
  it('resolveRootPath_末尾の区切りと..をそろえる_相対パスは投げる', () => {
    // IT-FS-ADAPTER-37 data-model-persistence.md 10.1 節：main は rootPath が絶対パスかを確かめる。同じフォルダは同じ鍵にする
    expect(resolveRootPath(root + sep)).toBe(root);
    expect(resolveRootPath(join(root, 'sub', '..'))).toBe(root);
    expect(() => resolveRootPath('relative/root')).toThrow(/absolute/i);
  });

  it('constructor_相対パスのルート_エラーの文にパスを入れない', () => {
    // IT-FS-ADAPTER-38 data-model-persistence.md 10.1 節・.claude/rules/typescript.md（例外の文に実ファイルのパスを入れない）
    let thrown: unknown;
    try {
      new ElectronFileSystemAdapter('secret-place/TabApp');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain('secret-place');
  });

  it('ルートの末尾に区切り_ルートそのものを指す.を読める', async () => {
    // IT-FS-ADAPTER-39 data-model-persistence.md 10.1 節：ルートの外は拒むが、ルートそのものは拒まない
    const withSep = new ElectronFileSystemAdapter(root + sep, { retryOnDemandDownload: false });
    await withSep.writeFile('a.txt', enc.encode('a'));
    expect(withSep.getRootPath()).toBe(root);
    expect((await withSep.listDirectory('.')).map((e) => e.name)).toEqual(['a.txt']);
  });

  it('ルートがドライブの根_その下の相対パスを読める', async () => {
    // IT-FS-ADAPTER-40 data-model-persistence.md 10.1 節：区切りで終わるルート（ドライブの根）でも、ルートの中を外と取り違えない
    const driveRoot = parse(root).root;
    const atDriveRoot = new ElectronFileSystemAdapter(driveRoot, { retryOnDemandDownload: false });
    expect(atDriveRoot.getRootPath()).toBe(driveRoot);
    expect(await atDriveRoot.exists(relative(driveRoot, root).split(sep).join('/'))).toBe(true);
  });

  it('paths_絶対パスを相対パスとして渡す_ルートの外として拒む', async () => {
    // IT-FS-ADAPTER-41 data-model-persistence.md 10.1 節：ルートの外を指す相対パスを拒み、選んでいないフォルダの外を読み書きさせない
    const outside = join(tmpdir(), 'riffline-outside.txt');
    await expect(adapter.writeFile(outside, enc.encode('x'))).rejects.toThrow(/escapes the storage root/);
    await expect(adapter.writeFile('songs/../../x.txt', enc.encode('x'))).rejects.toThrow(/escapes the storage root/);
  });

  it('このファイルの import_クラウドのAPIを呼ばずnodeのfsとpathだけ', () => {
    // IT-FS-ADAPTER-42 data-model-persistence.md 10 節：同期フォルダは main が Node.js の fs で読み書きし、クラウドの API・認証・ネットワークを持たない
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ElectronFileSystemAdapter.ts'), 'utf8');
    const specifiers = [...source.matchAll(/from \x27([^\x27]+)\x27/g)].map((m) => m[1]);
    expect(new Set(specifiers)).toEqual(
      new Set(['node:fs/promises', 'node:path', '@riff-line/core/platform', './onDemandRetry']),
    );
    expect(source).not.toMatch(/https?:\/{2}/);
  });
});
