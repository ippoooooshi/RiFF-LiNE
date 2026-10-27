// IT-FS-IPC: `fs:*` / `appconfig:*` IPC 契約の委譲 <!-- req webcorefoundation:cd4cb944.5ef6 --> <!-- req webcorefoundation:c21ba495.e391 -->
// 検証節: web-core-foundation.md 6.3 節、data-model-persistence.md 10.1 節
// IT: web-core-foundation.md 6.3 節、data-model-persistence.md 10.1 節 — fs:* / fs:*At / appconfig:* IPC 契約の往復
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
  FS_CHANNELS.removeEmptyDirectoryAt,
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

describe('registerFsHandlers (単一ルート、data-model-persistence.md 10.1 節)', () => {
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

describe('registerFsAtHandlers (ルート指定付き、data-model-persistence.md 10.1 節の (b))', () => {
  let factory: ElectronFileSystemAdapterFactory;

  beforeEach(() => {
    factory = new ElectronFileSystemAdapterFactory({ retryOnDemandDownload: false });
    registerFsAtHandlers(ipc, factory);
  });

  it('registerFsAtHandlers_RegistersAllNineAtChannels', () => {
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

  it('removeEmptyDirectoryAt_空のフォルダだけを消し_中が空でなければ_ルートの外ならrejectする', async () => {
    // IT-FS-IPC-22 data-model-persistence.md 10.1 節：fs:removeEmptyDirectoryAt は空のフォルダを消し、中が空でなければ FileWriteError。ルートの外（..）は拒む
    await ipc.invoke(FS_CHANNELS.ensureDirectoryAt, { rootPath: root, relativePath: 'songs/Empty' });
    await ipc.invoke(FS_CHANNELS.removeEmptyDirectoryAt, { rootPath: root, relativePath: 'songs/Empty' });
    expect(await ipc.invoke(FS_CHANNELS.existsAt, { rootPath: root, relativePath: 'songs/Empty' })).toBe(false);

    await ipc.invoke(FS_CHANNELS.writeFileAt, { rootPath: root, relativePath: 'songs/a.txt', data: enc.encode('a') });
    await expect(
      ipc.invoke(FS_CHANNELS.removeEmptyDirectoryAt, { rootPath: root, relativePath: 'songs' }),
    ).rejects.toMatchObject({ name: 'FileWriteError' });
    expect(await ipc.invoke(FS_CHANNELS.existsAt, { rootPath: root, relativePath: 'songs/a.txt' })).toBe(true);

    await expect(
      ipc.invoke(FS_CHANNELS.removeEmptyDirectoryAt, { rootPath: join(root, 'songs'), relativePath: '../other' }),
    ).rejects.toThrow(/escapes the storage root/);
  });

  it('removeEmptyDirectoryAt_無いフォルダ_rejectしない', async () => {
    // IT-FS-IPC-23 data-model-persistence.md 10.1 節（2026-10-27 チャット側の決定）：removeEmptyDirectory はフォルダが無くてもエラーにしない（deleteFile と同じ）
    await expect(
      ipc.invoke(FS_CHANNELS.removeEmptyDirectoryAt, { rootPath: root, relativePath: 'songs/Ghost' }),
    ).resolves.toBeUndefined();
  });
});

describe('registerAppConfigHandlers (data-model-persistence.md 10.1 節の (b))', () => {
  let service: ElectronAppLocalConfigService;

  beforeEach(() => {
    service = new ElectronAppLocalConfigService(root);
    registerAppConfigHandlers(
      ipc,
      service,
      () => service.getActiveRoot(),
      () => service.getLocalBackupRoot(),
      () => service.getPreMigrationRoot(),
    );
  });

  it('registerAppConfigHandlers_RegistersAllAppConfigChannels', () => {
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

  it('getPreMigrationRoot_ReturnsUserDataPreMigrationNextToLocalBackup', async () => {
    // IT-FS-IPC-24 data-model-persistence.md 10.1 節：appconfig:getPreMigrationRoot は 8 節の PreMigration/ の場所（LocalBackup/ と並ぶ、honnin-queue 206 番）
    await expect(ipc.invoke(APP_CONFIG_CHANNELS.getPreMigrationRoot)).resolves.toBe(join(root, 'PreMigration'));
  });
});

describe('registerLogHandlers (error-logging-foundation.md 2.4 節、B32)', () => {
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

describe('要求の形の確かめ（web-core-foundation.md 6.2 節「受け取った引数を確かめてから使う」）', () => {
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
    [FS_CHANNELS.removeEmptyDirectoryAt, { rootPath: '/r', relativePath: ['songs'] }],
    [APP_CONFIG_CHANNELS.writePointer, { pointer: { rootAbsolutePath: '/r', storageType: 'dropbox' } }],
    [APP_CONFIG_CHANNELS.writePointer, { pointer: null }],
    [LOG_CHANNELS.append, { level: 'error', code: 'FILE-001' }],
    [LOG_CHANNELS.append, { level: 'info', channel: 'toast', code: 'X', message: 'm', timestamp: 't', context: 'c' }],
  ];

  it('ipcHandlers_形の違う要求は_InvalidIpcPayloadErrorでrejectし委譲しない', async () => {
    // IT-FS-IPC-17 web-core-foundation.md 6.2 節
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
    // IT-FS-IPC-19 web-core-foundation.md 6.2 節・6.3 節（turn 177 に `payload as` を確かめに替え、ack を send から invoke に替えた。同じ形の再発を止める）
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ['ipc.ts', 'autoSaveFlushBridge.ts'])
      expect(readFileSync(join(here, file), 'utf8')).not.toMatch(/payload as /);
    expect(readFileSync(join(here, '..', 'preload', 'preload.ts'), 'utf8')).not.toMatch(/ipcRenderer\.send\(/);
    // web-core-foundation.md 6.3 節「本書にはチャンネルの一覧を持たない」：チャンネルの注が web-core-foundation.md の古い節（作り直す前の 3.x・4.x）を
    // 節の記号（U+00A7）の形で指さない
    const sharedTypes = join(here, '..', '..', '..', '..', 'packages', 'shared-types', 'src', 'index.ts');
    for (const file of [join(here, 'ipc.ts'), join(here, '..', 'preload', 'preload.ts'), sharedTypes])
      expect(readFileSync(file, 'utf8')).not.toMatch(/web-core-foundation\.md \xA7[34]/);
  });

  it('fsAtのチャンネル_相対パスのルートとルートの外を指す相対パスを拒み_外に書かない', async () => {
    // IT-FS-IPC-20 data-model-persistence.md 10.1 節：main は rootPath が絶対パスかを確かめ、ルートの外（..）を指す相対パスを拒む
    registerFsAtHandlers(ipc, new ElectronFileSystemAdapterFactory({ retryOnDemandDownload: false }));
    const inner = join(root, 'inner');
    await ipc.invoke(FS_CHANNELS.ensureDirectoryAt, { rootPath: inner, relativePath: '.' });
    await expect(
      ipc.invoke(FS_CHANNELS.writeFileAt, { rootPath: 'inner', relativePath: 'a.txt', data: enc.encode('x') }),
    ).rejects.toThrow(/absolute/i);
    await expect(
      ipc.invoke(FS_CHANNELS.writeFileAt, { rootPath: inner, relativePath: '../escaped.txt', data: enc.encode('x') }),
    ).rejects.toThrow(/escapes the storage root/);
    await expect(
      ipc.invoke(FS_CHANNELS.renameFileAt, { rootPath: inner, fromRelativePath: 'a', toRelativePath: '../b' }),
    ).rejects.toThrow(/escapes the storage root/);
    const outside = new ElectronFileSystemAdapter(root, { retryOnDemandDownload: false });
    expect(await outside.exists('escaped.txt')).toBe(false);
  });

  it('チャンネルの名前_既存の5つは変えず_fsAtはgetRootPathを除く9つ_appconfigは5つ', () => {
    // IT-FS-IPC-21 data-model-persistence.md 10.1 節の (b)：既存の 5 つの名前を変えず、fs:readFileAt から fs:existsAt までと fs:removeEmptyDirectoryAt の 9 つと appconfig:* を別に足す。
    // appconfig:* は readPointer・writePointer・getActiveRoot・getLocalBackupRoot・getPreMigrationRoot の 5 つ（10.1 節、honnin-queue 206 番）
    expect(BASE_FS_CHANNELS).toEqual([
      'fs:readFile',
      'fs:writeFile',
      'fs:listDirectory',
      'fs:ensureDirectory',
      'fs:getRootPath',
    ]);
    const methods = ['readFile', 'writeFile', 'listDirectory', 'ensureDirectory', 'renameFile', 'deleteFile'];
    expect(AT_FS_CHANNELS).toEqual([...methods, 'copyFile', 'exists', 'removeEmptyDirectory'].map((m) => `fs:${m}At`));
    expect(Object.values(FS_CHANNELS)).toHaveLength(14);
    expect(Object.values(APP_CONFIG_CHANNELS)).toEqual([
      'appconfig:readPointer',
      'appconfig:writePointer',
      'appconfig:getActiveRoot',
      'appconfig:getLocalBackupRoot',
      'appconfig:getPreMigrationRoot',
    ]);
  });

  it('ipcHandlers_エラーの文に要求の値を入れない', async () => {
    // IT-FS-IPC-18 web-core-foundation.md 6.2 節・.claude/rules/typescript.md（例外の文に実ファイルのフルパスを入れない）
    registerFsAtHandlers(ipc, { createForRoot: vi.fn() } as unknown as ElectronFileSystemAdapterFactory);
    const error = await ipc
      .invoke(FS_CHANNELS.readFileAt, { rootPath: '/secret/place', relativePath: 7 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidIpcPayloadError);
    expect((error as Error).message).not.toContain('/secret/place');
    expect((error as InvalidIpcPayloadError).field).toBe('relativePath');
  });
});
