// UT-PERSIST-FOLDER: `SongFolderService`（曲一覧のフォルダの実体）と、フォルダの名前を確定する決まり
// 検証節: data-model-persistence.md 9.2 節
// 検証観点: 作る（選んでいるフォルダの中／songs/ の直下）・名前を変える（下の曲の folder の先頭を直す）・
// 消す（中が空のときだけ、index.json は変えない）・曲を移す（renameFile と folder の差分、中身は変えない）、
// 使えない 9 文字・末尾の点と空白・予約名（C0/C1）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SongSummary } from '../domain/types';
import { FileWriteError } from '../platform/errors';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { INDEX_FILE } from './constants';
import { SongNotFoundError } from './errors';
import { songFilePath, songFolderPath } from './paths';
import { SongFolderService, finalizeFolderName, removeInvalidFolderNameChars } from './SongFolderService';
import { SongIndexService } from './SongIndexService';

/**
 * フォルダの改名も扱う fake（ElectronFileSystemAdapter の renameFile は fs.rename なのでフォルダも動かせる）。
 * 共通の FakeFileSystemAdapter はファイルだけを動かすので、このテストの中だけで足す。
 * 空のフォルダの削除は共通の fake の removeEmptyDirectory を使う（deleteFile はフォルダを消さない、data-model-persistence.md 10.1 節）。
 */
class FolderAwareFakeAdapter extends FakeFileSystemAdapter {
  override renameFile(from: string, to: string): Promise<void> {
    if (!this.dirs.has(from)) return super.renameFile(from, to);
    for (const dir of [...this.dirs]) {
      if (dir === from || dir.startsWith(`${from}/`)) {
        this.dirs.delete(dir);
        this.dirs.add(`${to}${dir.slice(from.length)}`);
      }
    }
    for (const [path, data] of [...this.files]) {
      if (path.startsWith(`${from}/`)) {
        this.files.delete(path);
        this.files.set(`${to}${path.slice(from.length)}`, data);
      }
    }
    return Promise.resolve();
  }
}

const summary = (id: string, folder: string): SongSummary => ({
  id,
  title: id,
  artist: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tags: [],
  thumbnailRef: null,
  firstPartInstrumentType: 'electric_guitar',
  firstPartTuningName: '',
  folder,
});

let fs: FolderAwareFakeAdapter;
let index: SongIndexService;
let folders: SongFolderService;

beforeEach(() => {
  fs = new FolderAwareFakeAdapter();
  fs.dirs.add('songs');
  index = new SongIndexService(fs);
  folders = new SongFolderService(fs, index);
});

describe('removeInvalidFolderNameChars / finalizeFolderName', () => {
  it('removeInvalidFolderNameChars_RemovesTheNineCharacters', () => {
    // UT-PERSIST-FOLDER-01 9.2 節：\ / : * ? " < > | は入らない（貼り付けた文字も除く）
    expect(removeInvalidFolderNameChars('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('finalizeFolderName_TrimsTrailingDotsAndSpaces', () => {
    // UT-PERSIST-FOLDER-02 9.2 節 (b)：確定するときは末尾の点と空白を取り除く
    expect(finalizeFolderName('Live . . ')).toBe('Live');
    expect(finalizeFolderName(' Live')).toBe(' Live');
    expect(finalizeFolderName('a.b')).toBe('a.b');
  });

  it('finalizeFolderName_EmptyAfterTrimming_ReturnsNull', () => {
    // UT-PERSIST-FOLDER-03 9.2 節 (b)：取り除いて空になれば作らない／前の名前のまま
    expect(finalizeFolderName('')).toBeNull();
    expect(finalizeFolderName(' .. ')).toBeNull();
    expect(finalizeFolderName('??')).toBeNull();
  });

  it('finalizeFolderName_ReservedNames_AppendUnderscore', () => {
    // UT-PERSIST-FOLDER-04 9.2 節 (b)：予約名は後ろに _ を足す（大文字と小文字を区別せず、後ろに . と文字が続くものも含む）
    expect(finalizeFolderName('CON')).toBe('CON_');
    expect(finalizeFolderName('nul')).toBe('nul_');
    expect(finalizeFolderName('Com1')).toBe('Com1_');
    expect(finalizeFolderName('LPT9')).toBe('LPT9_');
    // 後ろに . と文字が続く名前は、最初の . の前に _ を足す（2026-10-27 本人決定、honnin-queue 208 番）
    expect(finalizeFolderName('aux.txt')).toBe('aux_.txt');
    expect(finalizeFolderName('PRN.')).toBe('PRN_');
  });

  it('finalizeFolderName_NotReserved_KeepsName', () => {
    // UT-PERSIST-FOLDER-05 予約名に似ているが違うもの（COM0・LPT10・CONSOLE）はそのまま
    expect(finalizeFolderName('COM0')).toBe('COM0');
    expect(finalizeFolderName('LPT10')).toBe('LPT10');
    expect(finalizeFolderName('CONSOLE')).toBe('CONSOLE');
  });

  it('finalizeFolderName_ReservedNameFollowedByDot_InsertsUnderscoreBeforeFirstDot', () => {
    // UT-PERSIST-FOLDER-18 9.2 節 (b)：後ろに . と文字が続く予約名は、最初の . の前に _ を足す（「aux.txt」→「aux_.txt」、2026-10-27 本人決定）
    expect(finalizeFolderName('aux.txt')).toBe('aux_.txt');
    expect(finalizeFolderName('Con.a.b')).toBe('Con_.a.b');
    expect(finalizeFolderName('COM1.tar.gz')).toBe('COM1_.tar.gz');
    expect(finalizeFolderName('lpt9.Live ')).toBe('lpt9_.Live');
    // 予約名で始まるが予約名でないもの・予約名が . の後ろにあるものは変えない
    expect(finalizeFolderName('CONSOLE.txt')).toBe('CONSOLE.txt');
    expect(finalizeFolderName('Live.CON')).toBe('Live.CON');
  });
});

describe('SongFolderService', () => {
  it('createFolder_NoSelection_CreatesUnderSongsRoot', async () => {
    // UT-PERSIST-FOLDER-06 9.2 節：選んでいなければ songs/ の直下に作る（ensureDirectory）
    const ensure = vi.spyOn(fs, 'ensureDirectory');
    expect(await folders.createFolder('', 'Live')).toBe('Live');
    expect(ensure).toHaveBeenCalledWith('songs/Live');
    expect(fs.dirs.has('songs/Live')).toBe(true);
  });

  it('createFolder_InSelectedFolder_CreatesNestedWithFinalizedName', async () => {
    // UT-PERSIST-FOLDER-07 9.2 節：選んでいるフォルダの中に作る。名前は確定の決まりを通す
    expect(await folders.createFolder('Live', 'CON ')).toBe('Live/CON_');
    expect(fs.dirs.has('songs/Live/CON_')).toBe(true);
  });

  it('createFolder_EmptyName_DoesNotCreate', async () => {
    // UT-PERSIST-FOLDER-08 9.2 節 (b)：取り除いて空になれば作らない
    const ensure = vi.spyOn(fs, 'ensureDirectory');
    expect(await folders.createFolder('', ' . ')).toBeNull();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('renameFolder_RenamesDirectoryAndRewritesFolderPrefixOfSongsBelow', async () => {
    // UT-PERSIST-FOLDER-09 9.2 節：renameFile で名前を変え、その下にある曲の全部の folder の先頭を新しいパスに直す
    fs.putJson(songFilePath('a', 'Live'), { id: 'a' });
    fs.putJson(songFilePath('b', 'Live/2026'), { id: 'b' });
    fs.putJson(INDEX_FILE, [summary('a', 'Live'), summary('b', 'Live/2026'), summary('c', '')]);
    const rename = vi.spyOn(fs, 'renameFile');

    expect(await folders.renameFolder('Live', 'Concert')).toBe('Concert');

    expect(rename).toHaveBeenCalledWith('songs/Live', 'songs/Concert');
    expect(fs.files.has(songFilePath('b', 'Concert/2026'))).toBe(true);
    expect((await index.load()).map((s) => s.folder)).toEqual(['Concert', 'Concert/2026', '']);
  });

  it('renameFolder_NestedFolder_KeepsParent', async () => {
    // UT-PERSIST-FOLDER-10 入れ子のフォルダは親を変えずに名前だけを変える
    await fs.ensureDirectory('songs/Live/old');
    fs.putJson(INDEX_FILE, [summary('a', 'Live/old')]);
    expect(await folders.renameFolder('Live/old', 'new')).toBe('Live/new');
    expect(fs.dirs.has('songs/Live/new')).toBe(true);
    expect((await index.find('a'))?.folder).toBe('Live/new');
  });

  it('renameFolder_EmptyOrSameName_KeepsPreviousName', async () => {
    // UT-PERSIST-FOLDER-11 9.2 節 (b)：取り除いて空になれば前の名前のまま。同じ名前なら何もしない
    fs.dirs.add('songs/Live');
    const rename = vi.spyOn(fs, 'renameFile');
    expect(await folders.renameFolder('Live', '...')).toBe('Live');
    expect(await folders.renameFolder('Live', 'Live.')).toBe('Live');
    expect(rename).not.toHaveBeenCalled();
  });

  it('deleteFolder_Empty_DeletesAndLeavesIndexUnchanged', async () => {
    // UT-PERSIST-FOLDER-12 9.2 節：消すのは中が空のときだけで、空のフォルダを消しても index.json は変わらない
    fs.dirs.add('songs/Empty');
    fs.putJson(INDEX_FILE, [summary('a', '')]);
    const before = fs.readText(INDEX_FILE);
    expect(await folders.deleteFolder('Empty')).toBe(true);
    expect(fs.dirs.has('songs/Empty')).toBe(false);
    expect(fs.readText(INDEX_FILE)).toBe(before);
  });

  it('deleteFolder_HasSongOrSubfolder_DoesNotDelete', async () => {
    // UT-PERSIST-FOLDER-13 中に曲かフォルダがあれば消さない
    fs.putJson(songFilePath('a', 'Live'), { id: 'a' });
    await fs.ensureDirectory('songs/Outer/Inner');
    const del = vi.spyOn(fs, 'deleteFile');
    const rmdir = vi.spyOn(fs, 'removeEmptyDirectory');
    expect(await folders.deleteFolder('Live')).toBe(false);
    expect(await folders.deleteFolder('Outer')).toBe(false);
    expect(del).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
  });

  it('moveSong_MovesFileAndUpdatesFolderOnly', async () => {
    // UT-PERSIST-FOLDER-14 9.2 節：renameFile で動かし、index.json のその曲の folder を差分で直す。中身は変えない
    fs.putText(songFilePath('a'), '{"id":"a","body":"unchanged"}');
    fs.putJson(INDEX_FILE, [summary('a', ''), summary('b', '')]);
    await folders.moveSong('a', 'Live/2026');
    expect(fs.files.has(songFilePath('a'))).toBe(false);
    expect(fs.readText(songFilePath('a', 'Live/2026'))).toBe('{"id":"a","body":"unchanged"}');
    const list = await index.load();
    expect(list).toEqual([summary('a', 'Live/2026'), summary('b', '')]);
  });

  it('moveSong_BackToRoot_And_SameFolderNoop', async () => {
    // UT-PERSIST-FOLDER-15 直下へ戻す。同じフォルダへは何もしない
    fs.putText(songFilePath('a', 'Live'), 'x');
    fs.putJson(INDEX_FILE, [summary('a', 'Live')]);
    const rename = vi.spyOn(fs, 'renameFile');
    await folders.moveSong('a', 'Live');
    expect(rename).not.toHaveBeenCalled();
    await folders.moveSong('a', '');
    expect(fs.files.has(songFilePath('a'))).toBe(true);
    expect((await index.find('a'))?.folder).toBe('');
  });

  it('moveSong_NotInIndex_ThrowsSongNotFoundError', async () => {
    // UT-PERSIST-FOLDER-16
    fs.putJson(INDEX_FILE, []);
    await expect(folders.moveSong('nope', 'Live')).rejects.toBeInstanceOf(SongNotFoundError);
  });

  it('songFolderPath_RootIsSongsDir', () => {
    // UT-PERSIST-FOLDER-17 paths.ts：直下は songs、サブフォルダは songs/{folder}
    expect(songFolderPath('')).toBe('songs');
    expect(songFolderPath('a/b')).toBe('songs/a/b');
    expect(songFilePath('x', 'a/b')).toBe('songs/a/b/x.tabapp');
    expect(songFilePath('x')).toBe('songs/x.tabapp');
  });

  it('deleteFolder_Empty_UsesRemoveEmptyDirectoryNotDeleteFile', async () => {
    // UT-PERSIST-FOLDER-19 9.2 節・10.1 節：空のフォルダを消すのは removeEmptyDirectory。deleteFile はフォルダを消さない
    await fs.ensureDirectory('songs/Live/Empty');
    const del = vi.spyOn(fs, 'deleteFile');
    const rmdir = vi.spyOn(fs, 'removeEmptyDirectory');
    expect(await folders.deleteFolder('Live/Empty')).toBe(true);
    expect(rmdir).toHaveBeenCalledWith('songs/Live/Empty');
    expect(del).not.toHaveBeenCalled();
    expect(fs.dirs.has('songs/Live')).toBe(true);
  });

  it('deleteFolder_RemoveEmptyDirectoryFails_PropagatesFileWriteError', async () => {
    // UT-PERSIST-FOLDER-20 10.1 節：中を確かめた後に中身が入ったなど removeEmptyDirectory が FileWriteError を投げたら、消したことにせず伝える
    fs.dirs.add('songs/Race');
    vi.spyOn(fs, 'removeEmptyDirectory').mockRejectedValueOnce(new FileWriteError('songs/Race'));
    await expect(folders.deleteFolder('Race')).rejects.toBeInstanceOf(FileWriteError);
    expect(fs.dirs.has('songs/Race')).toBe(true);
  });
});
