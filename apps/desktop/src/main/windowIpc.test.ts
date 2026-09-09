// IT-WIN: window:* IPC 契約の往復（screens-navigation.md §4.1、electron.rule.md IPC 規約）
//
// fake ipcMain でハンドラを捕捉し、各チャンネルを invoke して WindowManager（WindowAdapter）への委譲を確認する。
// electron ランタイムは使わない。

import { WINDOW_CHANNELS, type WindowAdapter } from '@riff-line/shared-types';
import { describe, expect, it, vi } from 'vitest';

import { registerWindowHandlers, type IpcMainLike } from './ipc';

class FakeIpcMain implements IpcMainLike {
  private readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (handler === undefined) return Promise.reject(new Error(`no handler for ${channel}`));
    return Promise.resolve(handler({}, payload));
  }
}

function fakeWindowAdapter(): WindowAdapter {
  return {
    openSongListWindow: vi.fn<() => void>(),
    focusExistingWindow: vi.fn<(songId: string) => boolean>(() => false),
    closeEditWindow: vi.fn<(songId: string) => Promise<void>>(() => Promise.resolve()),
    listOpenEditWindowSongIds: vi.fn<() => string[]>(() => []),
  };
}

describe('registerWindowHandlers', () => {
  it('window:openSong_payloadのsongIdでfocusExistingWindowへ委譲する', async () => {
    // IT-WIN-01 §4.1
    const ipc = new FakeIpcMain();
    const windows = fakeWindowAdapter();
    registerWindowHandlers(ipc, windows);
    await ipc.invoke(WINDOW_CHANNELS.openSong, { songId: 'song-x' });
    expect(windows.focusExistingWindow).toHaveBeenCalledWith('song-x');
  });

  it('window:openSongList_openSongListWindowへ委譲する', async () => {
    // IT-WIN-02 §4.1
    const ipc = new FakeIpcMain();
    const windows = fakeWindowAdapter();
    registerWindowHandlers(ipc, windows);
    await ipc.invoke(WINDOW_CHANNELS.openSongList);
    expect(windows.openSongListWindow).toHaveBeenCalledTimes(1);
  });

  it('ハンドラはビジネスロジックを持たず委譲のみ（戻り値void）', async () => {
    // IT-WIN-03 §4.1（他ハンドラと同方針）
    const ipc = new FakeIpcMain();
    registerWindowHandlers(ipc, fakeWindowAdapter());
    await expect(ipc.invoke(WINDOW_CHANNELS.openSong, { songId: 's' })).resolves.toBeUndefined();
  });
});
