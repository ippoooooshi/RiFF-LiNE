// IT-FS-IPC: `fs:*` / `appconfig:*` IPC 契約の委譲
// 検証節: web-core-foundation.md §4.1、data-model-persistence.md §9.7
// IT: web-core-foundation.md §4.1、data-model-persistence.md §3.3.1 — fs:* / fs:*At / appconfig:* IPC 契約の往復
//
// fake ipcMain でハンドラを捕捉し、各チャンネルを invoke して Adapter / Factory / AppLocalConfigService への
// 委譲を実 I/O（一時ディレクトリ）で確認する。electron ランタイムは使わない。

import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { InvalidIpcPayloadError } from './ipcPayload';

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
    // IT-FS-IPC-01
    expect(new Set(ipc.channels)).toEqual(new Set(BASE_FS_CHANNELS));
  });

  it('getRootPath_ReturnsAdapterRoot', async () => {
    // IT-FS-IPC-02
    await expect(ipc.invoke(FS_CHANNELS.getRootPath)).resolves.toBe(root);
  });

  it('ensureDirectory_then_writeFile_then_readFile', async () => {
    // IT-FS-IPC-03
    await ipc.invoke(FS_CHANNELS.ensureDirectory, { relativePath: 'songs' });
    await ipc.invoke(FS_CHANNELS.writeFile, { relativePath: 'songs/a.txt', data: enc.encode('tab') });
    const bytes = (await ipc.invoke(FS_CHANNELS.readFile, { relativePath: 'songs/a.txt' })) as Uint8Array;
    expect(dec.decode(bytes)).toBe('tab');
  });

  it('readFile_MissingFile_RejectsThroughIpc', async () => {
    // IT-FS-IPC-04
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
    // IT-FS-IPC-05
    expect(new Set(ipc.channels)).toEqual(new Set(AT_FS_CHANNELS));
  });

  it('writeFileAt_then_readFileAt_RoundTripsAtGivenRoot', async () => {
    // IT-FS-IPC-06
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
    // IT-FS-IPC-07
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
    // IT-FS-IPC-08
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
    // IT-FS-IPC-09
    expect(new Set(ipc.channels)).toEqual(new Set(Object.values(APP_CONFIG_CHANNELS)));
  });

  it('readPointer_BeforeWrite_ReturnsNull_thenRoundTripsAfterWrite', async () => {
    // IT-FS-IPC-10
    expect(await ipc.invoke(APP_CONFIG_CHANNELS.readPointer)).toBeNull();

    const pointer: StorageRootPointer = { rootAbsolutePath: 'D:/cloud', storageType: 'gdrive' };
    await ipc.invoke(APP_CONFIG_CHANNELS.writePointer, { pointer });
    expect(await ipc.invoke(APP_CONFIG_CHANNELS.readPointer)).toEqual(pointer);
  });

  it('getActiveRoot_DefaultsToUserDataTabApp', async () => {
    // IT-FS-IPC-11
    await expect(ipc.invoke(APP_CONFIG_CHANNELS.getActiveRoot)).resolves.toBe(join(root, 'TabApp'));
  });

  it('getActiveRoot_AfterPointerWrite_UsesPointerRoot', async () => {
    // IT-FS-IPC-12
    await ipc.invoke(APP_CONFIG_CHANNELS.writePointer, {
      pointer: { rootAbsolutePath: join(root, 'elsewhere'), storageType: 'custom' },
    });
    await expect(ipc.invoke(APP_CONFIG_CHANNELS.getActiveRoot)).resolves.toBe(join(root, 'elsewhere', 'TabApp'));
  });

  it('getLocalBackupRoot_ReturnsUserDataLocalBackup', async () => {
    // IT-FS-IPC-13
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
    // IT-FS-IPC-14
    registerLogHandlers(
      ipc,
      () => undefined,
      () => ({ recovered: false, repeatedCrash: false }),
    );
    expect(new Set(ipc.channels)).toEqual(new Set([LOG_CHANNELS.append, CRASH_CHANNELS.getRecoveryState]));
  });

  it('logAppend_DelegatesEventToOnEventCallback', async () => {
    // IT-FS-IPC-15
    const onEvent = vi.fn<(event: NotificationEvent) => void>();
    registerLogHandlers(ipc, onEvent, () => ({ recovered: false, repeatedCrash: false }));

    await ipc.invoke(LOG_CHANNELS.append, sampleEvent);

    expect(onEvent).toHaveBeenCalledWith(sampleEvent);
  });

  it('crashGetRecoveryState_ReturnsResolverResult', async () => {
    // IT-FS-IPC-16
    const state: CrashRecoveryState = { recovered: true, repeatedCrash: false };
    registerLogHandlers(
      ipc,
      () => undefined,
      () => state,
    );

    await expect(ipc.invoke(CRASH_CHANNELS.getRecoveryState)).resolves.toEqual(state);
  });
});

describe('要求の形の確かめ（web-core-foundation.md §6.2「受け取った引数を確かめてから使う」）', () => {
  /** 形の違う要求を渡すと invoke が InvalidIpcPayloadError で reject し、アダプタにもコールバックにも届かないこと。 */
  const bad: ReadonlyArray<readonly [channel: string, payload: unknown]> = [
    [FS_CHANNELS.readFile, undefined],
    [FS_CHANNELS.readFile, { relativePath: 1 }],
    [FS_CHANNELS.writeFile, { relativePath: 'a.txt', data: 'text' }],
    [FS_CHANNELS.listDirectory, ['.']],
    [FS_CHANNELS.ensureDirectory, null],
    [FS_CHANNELS.readFileAt, { relativePath: 'a.txt' }],
    [FS_CHANNELS.writeFileAt, { rootPath: '/r', relativePath: 'a.txt', data: [1, 2] }],
    [FS_CHANNELS.listDirectoryAt, { rootPath: 3, relativePath: '.' }],
    [FS_CHANNELS.ensureDirectoryAt, 'songs'],
    [FS_CHANNELS.renameFileAt, { rootPath: '/r', fromRelativePath: 'a.txt' }],
    [FS_CHANNELS.deleteFileAt, {}],
    [FS_CHANNELS.copyFileAt, { rootPath: '/r', fromRelativePath: 'a', toRelativePath: null }],
    [FS_CHANNELS.existsAt, { rootPath: '/r' }],
    [APP_CONFIG_CHANNELS.writePointer, { pointer: { rootAbsolutePath: '/r', storageType: 'dropbox' } }],
    [APP_CONFIG_CHANNELS.writePointer, { pointer: null }],
    [LOG_CHANNELS.append, { level: 'error', code: 'FILE-001' }],
    [LOG_CHANNELS.append, { level: 'info', channel: 'toast', code: 'X', message: 'm', timestamp: 't', context: 'c' }],
  ];

  it('ipcHandlers_形の違う要求は_InvalidIpcPayloadErrorでrejectし委譲しない', async () => {
    // IT-FS-IPC-17 §6.2
    const factory = { createForRoot: vi.fn() };
    const onEvent = vi.fn();
    const adapter = new ElectronFileSystemAdapter(root, { retryOnDemandDownload: false });
    const readSpy = vi.spyOn(adapter, 'readFile');
    registerFsHandlers(ipc, adapter);
    registerFsAtHandlers(ipc, factory as unknown as ElectronFileSystemAdapterFactory);
    registerAppConfigHandlers(
      ipc,
      new ElectronAppLocalConfigService(root),
      () => root,
      () => root,
    );
    registerLogHandlers(ipc, onEvent, () => ({ recovered: false, repeatedCrash: false }));

    const notRejected: string[] = [];
    for (const [channel, payload] of bad) {
      const result = await ipc.invoke(channel, payload).then(
        () => 'resolved',
        (e: unknown) => (e instanceof InvalidIpcPayloadError ? 'invalid' : 'other'),
      );
      if (result !== 'invalid') notRejected.push(`${channel}:${result}`);
    }
    expect(notRejected).toEqual([]);
    expect(readSpy).not.toHaveBeenCalled();
    expect(factory.createForRoot).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('ipcHandlers_要求をasで型付けするだけの書き方と_preloadのsendが戻らない', () => {
    // IT-FS-IPC-19 §6.2・§6.3（turn 177 に `payload as` を確かめに替え、ack を send から invoke に替えた。同じ形の再発を止める）
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ['ipc.ts', 'autoSaveFlushBridge.ts'])
      expect(readFileSync(join(here, file), 'utf8')).not.toMatch(/payload as /);
    expect(readFileSync(join(here, '..', 'preload', 'preload.ts'), 'utf8')).not.toMatch(/ipcRenderer\.send\(/);
    // §6.3「本書にはチャンネルの一覧を持たない」：チャンネルの注が web-core-foundation.md の古い節（作り直す前の §3.x・§4.x）を指さない
    const sharedTypes = join(here, '..', '..', '..', '..', 'packages', 'shared-types', 'src', 'index.ts');
    for (const file of [join(here, 'ipc.ts'), join(here, '..', 'preload', 'preload.ts'), sharedTypes])
      expect(readFileSync(file, 'utf8')).not.toMatch(/web-core-foundation\.md §[34]/);
  });

  it('ipcHandlers_エラーの文に要求の値を入れない', async () => {
    // IT-FS-IPC-18 §6.2・.claude/rules/typescript.md（例外の文に実ファイルのフルパスを入れない）
    registerFsAtHandlers(ipc, { createForRoot: vi.fn() } as unknown as ElectronFileSystemAdapterFactory);
    const error = await ipc
      .invoke(FS_CHANNELS.readFileAt, { rootPath: '/secret/place', relativePath: 7 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidIpcPayloadError);
    expect((error as Error).message).not.toContain('/secret/place');
    expect((error as InvalidIpcPayloadError).field).toBe('relativePath');
  });
});
