// IT-FS-IPC: main のサムネイルの写しの作り直し（thumbnailRegenerate.ts の regenerateThumbnail・registerThumbnailHandlers）
// 検証節: data-model-persistence.md 9.1 節（2026-11-04 sub 2、T22 A）、web-core-foundation.md 6.2 節・6.3 節
// IT: fake ipcMain でハンドラを捕捉し、thumbnail:regenerate（要求 { songId }、応答 boolean）を invoke して、主ストレージ（一時ディレクトリ）の
// 曲のファイルの appMeta.thumbnail から thumbnails/{songId}.png が一時ファイルからの改名で書かれることを実 I/O で確かめる。
// 番号は ipc.test.ts の IT-FS-IPC の続き（39 から）。

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { THUMBNAIL_CHANNELS } from '@riff-line/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ElectronFileSystemAdapterFactory } from './ElectronFileSystemAdapterFactory';
import type { IpcMainLike } from './ipc';
import { InvalidIpcPayloadError } from './ipcPayload';
import { regenerateThumbnail, registerThumbnailHandlers, type ThumbnailRegenerateDeps } from './thumbnailRegenerate';

/** ipcMain.handle を記録し、invoke でハンドラを呼べる最小の fake。 */
class FakeIpcMain implements IpcMainLike {
  private readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  invoke(channel: string, payload?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler registered for ${channel}`);
    return Promise.resolve(handler({}, payload));
  }

  get channels(): string[] {
    return [...this.handlers.keys()];
  }
}

/** PNG の先頭 8 バイト（シグネチャ）を base64 にしたもの。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_BASE64 = Buffer.from(PNG_SIGNATURE).toString('base64');

let base: string;
let activeRoot: string;
let ipc: FakeIpcMain;
let deps: ThumbnailRegenerateDeps;

/** 主ストレージの TabApp/ に、曲のファイル（appMeta.thumbnail だけ持つ）と index.json を置く。 */
async function putSong(songId: string, thumbnail: string | null, folder = ''): Promise<void> {
  const dir = folder === '' ? join(activeRoot, 'songs') : join(activeRoot, 'songs', folder);
  await mkdir(dir, { recursive: true });
  const appMeta = { thumbnail: thumbnail === null ? null : { encoding: 'base64-png', data: thumbnail } };
  await writeFile(join(dir, `${songId}.tabapp`), JSON.stringify({ id: songId, appMeta }));
  await writeFile(join(activeRoot, 'index.json'), JSON.stringify([{ id: songId, folder }]));
}

async function thumbnailFiles(): Promise<string[]> {
  try {
    return await readdir(join(activeRoot, 'thumbnails'));
  } catch {
    return [];
  }
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'tabapp-thumb-'));
  activeRoot = join(base, 'TabApp');
  await mkdir(activeRoot, { recursive: true });
  ipc = new FakeIpcMain();
  deps = {
    adapterFactory: new ElectronFileSystemAdapterFactory({ retryOnDemandDownload: false }),
    resolveActiveRoot: () => Promise.resolve(activeRoot),
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Windows では消す途中に一時的な ENOTEMPTY・EBUSY が出ることがあるので、Node の rm の読み直しに任せる
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('thumbnail:regenerate（data-model-persistence.md 9.1 節）', () => {
  it('regenerate_SongHasThumbnail_WritesPngCopyViaTmpRenameAndReturnsTrue', async () => {
    // IT-FS-IPC-39 9.1 節：曲一覧のレンダラー→main の invoke 1 本 thumbnail:regenerate（要求 { songId: string }）。main はその曲のファイルを
    // 読んで appMeta.thumbnail の base64 を PNG のバイト列に戻し、一時ファイルからの改名で thumbnails/{songId}.png に書いてから true
    await putSong('s1', PNG_BASE64, 'live');
    registerThumbnailHandlers(ipc, deps);
    expect(ipc.channels).toEqual([THUMBNAIL_CHANNELS.regenerate]);
    expect(THUMBNAIL_CHANNELS.regenerate).toBe('thumbnail:regenerate');

    await expect(ipc.invoke(THUMBNAIL_CHANNELS.regenerate, { songId: 's1' })).resolves.toBe(true);

    expect([...(await readFile(join(activeRoot, 'thumbnails', 's1.png')))]).toEqual(PNG_SIGNATURE);
    expect(await thumbnailFiles()).toEqual(['s1.png']); // 一時ファイル（.tmp）は残らない
  });

  it('regenerate_SongFileUnreadable_ReturnsFalseWithoutWriting', async () => {
    // IT-FS-IPC-40 9.1 節：曲のファイルが読めない（無い・JSON でない）なら写さずに false
    registerThumbnailHandlers(ipc, deps);
    await expect(ipc.invoke(THUMBNAIL_CHANNELS.regenerate, { songId: 'missing' })).resolves.toBe(false);
    await mkdir(join(activeRoot, 'songs'), { recursive: true });
    await writeFile(join(activeRoot, 'songs', 'broken.tabapp'), '{ not json');
    await expect(ipc.invoke(THUMBNAIL_CHANNELS.regenerate, { songId: 'broken' })).resolves.toBe(false);
    expect(await thumbnailFiles()).toEqual([]);
  });

  it('regenerate_ThumbnailNull_ReturnsFalseWithoutWriting', async () => {
    // IT-FS-IPC-41 9.1 節：appMeta.thumbnail が null なら写さずに false
    await putSong('s2', null);
    registerThumbnailHandlers(ipc, deps);
    await expect(ipc.invoke(THUMBNAIL_CHANNELS.regenerate, { songId: 's2' })).resolves.toBe(false);
    expect(await thumbnailFiles()).toEqual([]);
  });

  it('regenerate_CannotWriteCopyOrResolveRoot_ReturnsFalseWithoutThrowing', async () => {
    // IT-FS-IPC-42 写しを作れなかった（写しを書けない・主ストレージのルートを引けない）ときも、応答は写しを作れたかの false で投げない
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await putSong('s3', '%%%not-base64%%%');
    await expect(regenerateThumbnail(deps, 's3')).resolves.toBe(false);
    const rootless: ThumbnailRegenerateDeps = {
      ...deps,
      resolveActiveRoot: () => Promise.reject(new Error('no pointer')),
    };
    await expect(regenerateThumbnail(rootless, 's3')).resolves.toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
    expect(await thumbnailFiles()).toEqual([]);
  });

  it('regenerate_InvalidPayload_RejectsBeforeTouchingFiles', async () => {
    // IT-FS-IPC-43 web-core-foundation.md 6.2 節：main の IPC のハンドラは、受け取った引数を確かめてから使う。
    // 曲の id はファイルの名前に使うので、空の文字列と区切り（/・\）を含むものも拒む
    const resolveActiveRoot = vi.fn(deps.resolveActiveRoot);
    registerThumbnailHandlers(ipc, { ...deps, resolveActiveRoot });
    for (const payload of [
      undefined,
      null,
      [],
      's1',
      {},
      { songId: 1 },
      { songId: '' },
      { songId: '../s1' },
      { songId: 'a\\b' },
    ]) {
      await expect(ipc.invoke(THUMBNAIL_CHANNELS.regenerate, payload)).rejects.toBeInstanceOf(InvalidIpcPayloadError);
    }
    expect(resolveActiveRoot).not.toHaveBeenCalled();
  });
});
