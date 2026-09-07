// IT: web-core-foundation.md §4.1、data-model-persistence.md §3.3.1 — fs:* / fs:*At / appconfig:* IPC 契約の往復
//
// fake ipcMain でハンドラを捕捉し、各チャンネルを invoke して Adapter / Factory / AppLocalConfigService への
// 委譲を実 I/O（一時ディレクトリ）で確認する。electron ランタイムは使わない。

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APP_CONFIG_CHANNELS,
  CRASH_CHANNELS,
  FS_CHANNELS,
  LOG_CHANNELS,
  type CrashRecoveryState,
  type NotificationEvent,
  type StorageRootPointer,
} from '@riff-line/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ElectronAppLocalConfigService } from './ElectronAppLocalConfigService';
import { ElectronFileSystemAdapter } from './ElectronFileSystemAdapter';
import { ElectronFileSystemAdapterFactory } from './ElectronFileSystemAdapterFactory';
import {
  registerAppConfigHandlers,
  registerFsAtHandlers,
  registerFsHandlers,
  registerLogHandlers,
  type IpcMainLike,
} from './ipc';

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

const BASE_FS_CHANNELS = [
  FS_CHANNELS.readFile,
  FS_CHANNELS.writeFile,
  FS_CHANNELS.listDirectory,
  FS_CHANNELS.ensureDirectory,
  FS_CHANNELS.getRootPath,
];
const AT_FS_CHANNELS = [
  FS_CHANNELS.readFileAt,
  FS_CHANNELS.writeFileAt,
  FS_CHANNELS.listDirectoryAt,
  FS_CHANNELS.ensureDirectoryAt,
  FS_CHANNELS.renameFileAt,
  FS_CHANNELS.deleteFileAt,
  FS_CHANNELS.copyFileAt,
  FS_CHANNELS.existsAt,
];

let root: string;
let ipc: FakeIpcMain;
const enc = new TextEncoder();
const dec = new TextDecoder();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tabapp-ipc-'));
  ipc = new FakeIpcMain();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('registerFsHandlers (単一ルート、web-core-foundation.md §4.1)', () => {
  beforeEach(() => {
    registerFsHandlers(ipc, new ElectronFileSystemAdapter(root, { retryOnDemandDownload: false }));
  });

  it('registerFsHandlers_RegistersExactlyTheFiveBaseChannels', () => {
    expect(new Set(ipc.channels)).toEqual(new Set(BASE_FS_CHANNELS));
  });

  it('getRootPath_ReturnsAdapterRoot', async () => {
    await expect(ipc.invoke(FS_CHANNELS.getRootPath)).resolves.toBe(root);
  });

  it('ensureDirectory_then_writeFile_then_readFile', async () => {
    await ipc.invoke(FS_CHANNELS.ensureDirectory, { relativePath: 'songs' });
    await ipc.invoke(FS_CHANNELS.writeFile, { relativePath: 'songs/a.txt', data: enc.encode('tab') });
    const bytes = (await ipc.invoke(FS_CHANNELS.readFile, { relativePath: 'songs/a.txt' })) as Uint8Array;
    expect(dec.decode(bytes)).toBe('tab');
  });

  it('readFile_MissingFile_RejectsThroughIpc', async () => {
    await expect(ipc.invoke(FS_CHANNELS.readFile, { relativePath: 'ghost.txt' })).rejects.toThrow();
  });
});

describe('registerFsAtHandlers (ルート指定付き、data-model-persistence.md §3.3.1)', () => {
  let factory: ElectronFileSystemAdapterFactory;

  beforeEach(() => {
    factory = new ElectronFileSystemAdapterFactory({ retryOnDemandDownload: false });
    registerFsAtHandlers(ipc, factory);
  });

  it('registerFsAtHandlers_RegistersAllEightAtChannels', () => {
    expect(new Set(ipc.channels)).toEqual(new Set(AT_FS_CHANNELS));
  });

  it('writeFileAt_then_readFileAt_RoundTripsAtGivenRoot', async () => {
    await ipc.invoke(FS_CHANNELS.ensureDirectoryAt, { rootPath: root, relativePath: 'songs' });
    await ipc.invoke(FS_CHANNELS.writeFileAt, {
      rootPath: root,
      relativePath: 'songs/x.tabapp',
      data: enc.encode('X'),
    });
    const bytes = (await ipc.invoke(FS_CHANNELS.readFileAt, {
      rootPath: root,
      relativePath: 'songs/x.tabapp',
    })) as Uint8Array;
    expect(dec.decode(bytes)).toBe('X');
  });

  it('renameFileAt_copyFileAt_deleteFileAt_existsAt_Delegate', async () => {
    await ipc.invoke(FS_CHANNELS.writeFileAt, { rootPath: root, relativePath: 'a.txt', data: enc.encode('a') });
    await ipc.invoke(FS_CHANNELS.renameFileAt, { rootPath: root, fromRelativePath: 'a.txt', toRelativePath: 'b.txt' });
    expect(await ipc.invoke(FS_CHANNELS.existsAt, { rootPath: root, relativePath: 'a.txt' })).toBe(false);
    expect(await ipc.invoke(FS_CHANNELS.existsAt, { rootPath: root, relativePath: 'b.txt' })).toBe(true);

    await ipc.invoke(FS_CHANNELS.copyFileAt, { rootPath: root, fromRelativePath: 'b.txt', toRelativePath: 'c.txt' });
    expect(await ipc.invoke(FS_CHANNELS.existsAt, { rootPath: root, relativePath: 'c.txt' })).toBe(true);

    await ipc.invoke(FS_CHANNELS.deleteFileAt, { rootPath: root, relativePath: 'c.txt' });
    expect(await ipc.invoke(FS_CHANNELS.existsAt, { rootPath: root, relativePath: 'c.txt' })).toBe(false);
  });

  it('listDirectoryAt_ReturnsEntries', async () => {
    await ipc.invoke(FS_CHANNELS.writeFileAt, { rootPath: root, relativePath: 'y.txt', data: enc.encode('12345') });
    const entries = (await ipc.invoke(FS_CHANNELS.listDirectoryAt, { rootPath: root, relativePath: '.' })) as {
      name: string;
      sizeBytes: number;
    }[];
    expect(entries.find((e) => e.name === 'y.txt')).toMatchObject({ sizeBytes: 5 });
  });
});

describe('registerAppConfigHandlers (data-model-persistence.md §3.3.1)', () => {
  let service: ElectronAppLocalConfigService;

  beforeEach(() => {
    service = new ElectronAppLocalConfigService(root);
    registerAppConfigHandlers(
      ipc,
      service,
      () => service.getActiveRoot(),
      () => service.getLocalBackupRoot(),
    );
  });

  it('registerAppConfigHandlers_RegistersAllFourChannels', () => {
    expect(new Set(ipc.channels)).toEqual(new Set(Object.values(APP_CONFIG_CHANNELS)));
  });

  it('readPointer_BeforeWrite_ReturnsNull_thenRoundTripsAfterWrite', async () => {
    expect(await ipc.invoke(APP_CONFIG_CHANNELS.readPointer)).toBeNull();

    const pointer: StorageRootPointer = { rootAbsolutePath: 'D:/cloud', storageType: 'gdrive' };
    await ipc.invoke(APP_CONFIG_CHANNELS.writePointer, { pointer });
    expect(await ipc.invoke(APP_CONFIG_CHANNELS.readPointer)).toEqual(pointer);
  });

  it('getActiveRoot_DefaultsToUserDataTabApp', async () => {
    await expect(ipc.invoke(APP_CONFIG_CHANNELS.getActiveRoot)).resolves.toBe(join(root, 'TabApp'));
  });

  it('getActiveRoot_AfterPointerWrite_UsesPointerRoot', async () => {
    await ipc.invoke(APP_CONFIG_CHANNELS.writePointer, {
      pointer: { rootAbsolutePath: join(root, 'elsewhere'), storageType: 'custom' },
    });
    await expect(ipc.invoke(APP_CONFIG_CHANNELS.getActiveRoot)).resolves.toBe(join(root, 'elsewhere', 'TabApp'));
  });

  it('getLocalBackupRoot_ReturnsUserDataLocalBackup', async () => {
    await expect(ipc.invoke(APP_CONFIG_CHANNELS.getLocalBackupRoot)).resolves.toBe(join(root, 'LocalBackup'));
  });
});

describe('registerLogHandlers (error-logging-foundation.md §2、B32)', () => {
  const sampleEvent: NotificationEvent = {
    level: 'error',
    channel: 'highlight',
    code: 'FILE-001',
    message: '保存に失敗しました。',
    context: { songId: 's1' },
    timestamp: '2026-09-08T00:00:00.000Z',
  };

  it('registerLogHandlers_RegistersLogAppendAndCrashGetRecoveryStateChannels', () => {
    registerLogHandlers(
      ipc,
      () => undefined,
      () => ({ recovered: false, repeatedCrash: false }),
    );
    expect(new Set(ipc.channels)).toEqual(new Set([LOG_CHANNELS.append, CRASH_CHANNELS.getRecoveryState]));
  });

  it('logAppend_DelegatesEventToOnEventCallback', async () => {
    const onEvent = vi.fn<(event: NotificationEvent) => void>();
    registerLogHandlers(ipc, onEvent, () => ({ recovered: false, repeatedCrash: false }));

    await ipc.invoke(LOG_CHANNELS.append, sampleEvent);

    expect(onEvent).toHaveBeenCalledWith(sampleEvent);
  });

  it('crashGetRecoveryState_ReturnsResolverResult', async () => {
    const state: CrashRecoveryState = { recovered: true, repeatedCrash: false };
    registerLogHandlers(
      ipc,
      () => undefined,
      () => state,
    );

    await expect(ipc.invoke(CRASH_CHANNELS.getRecoveryState)).resolves.toEqual(state);
  });
});
