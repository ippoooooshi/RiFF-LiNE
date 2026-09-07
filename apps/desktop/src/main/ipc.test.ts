// IT: web-core-foundation.md §4.1 — fs:* IPC 契約の往復
//
// fake ipcMain でハンドラを捕捉し、各チャンネルを invoke して ElectronFileSystemAdapter への
// 委譲を実 I/O（一時ディレクトリ）で確認する。electron ランタイムは使わない。

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FS_CHANNELS } from '@riff-line/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ElectronFileSystemAdapter } from './ElectronFileSystemAdapter';
import { registerFsHandlers, type IpcMainLike } from './ipc';

/** ipcMain.handle を記録し、invoke でハンドラを呼べる最小の fake。 */
class FakeIpcMain implements IpcMainLike {
  private readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>>();

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

let root: string;
let ipc: FakeIpcMain;
const enc = new TextEncoder();
const dec = new TextDecoder();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tabapp-ipc-'));
  ipc = new FakeIpcMain();
  registerFsHandlers(ipc, new ElectronFileSystemAdapter(root));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('registerFsHandlers_RegistersAllContractChannels', () => {
  expect(new Set(ipc.channels)).toEqual(new Set(Object.values(FS_CHANNELS)));
});

describe('fs:* round trip', () => {
  it('getRootPath_ReturnsAdapterRoot', async () => {
    await expect(ipc.invoke(FS_CHANNELS.getRootPath)).resolves.toBe(root);
  });

  it('ensureDirectory_then_writeFile_then_readFile', async () => {
    await ipc.invoke(FS_CHANNELS.ensureDirectory, { relativePath: 'songs' });
    await ipc.invoke(FS_CHANNELS.writeFile, {
      relativePath: 'songs/a.txt',
      data: enc.encode('tab'),
    });
    const bytes = (await ipc.invoke(FS_CHANNELS.readFile, { relativePath: 'songs/a.txt' })) as Uint8Array;
    expect(dec.decode(bytes)).toBe('tab');
  });

  it('listDirectory_ReturnsEntriesForWrittenFiles', async () => {
    await ipc.invoke(FS_CHANNELS.writeFile, { relativePath: 'x.txt', data: enc.encode('12345') });
    const entries = (await ipc.invoke(FS_CHANNELS.listDirectory, { relativePath: '.' })) as Array<{
      name: string;
      isDirectory: boolean;
      sizeBytes: number;
    }>;
    const x = entries.find((e) => e.name === 'x.txt');
    expect(x).toMatchObject({ isDirectory: false, sizeBytes: 5 });
  });

  it('readFile_MissingFile_RejectsThroughIpc', async () => {
    await expect(ipc.invoke(FS_CHANNELS.readFile, { relativePath: 'ghost.txt' })).rejects.toThrow();
  });
});
