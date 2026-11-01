// IT-FS-IPC: `fs:*` / `appconfig:*` IPC 契約の委譲 <!-- req webcorefoundation:52194499.5ef6 --> <!-- req webcorefoundation:77710e17.e391 -->
// 検証節: web-core-foundation.md 6.3 節、data-model-persistence.md 10.1 節、error-logging-foundation.md 2.4 節（log:* ・crash:* ・app:* の受け口）
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
  APP_CHANNELS,
  APP_CONFIG_CHANNELS,
  CRASH_CHANNELS,
  FS_CHANNELS,
  LOG_CHANNELS,
  NOTIFY_CHANNELS,
  SHARED_CHANGE_KINDS_WITHOUT_ID,
  SHARED_CHANNELS,
  WINDOW_CHANNELS,
  type CrashRecoveryState,
  type LogEntry,
  type SharedChangeNotice,
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
  registerSharedChangeHandlers,
  type IpcMainLike,
  type LogHandlerDeps,
  type SharedChangeTargetWindow,
} from './ipc';
import { InvalidIpcPayloadError } from './ipcPayload';

/** ipcMain.handle を記録し、invoke でハンドラを呼べる最小の fake。 */
class FakeIpcMain implements IpcMainLike {
  private readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  invoke(channel: string, payload?: unknown, event: unknown = {}): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler registered for ${channel}`);
    // 同期で投げたハンドラも、Electron の invoke と同じく reject として返す
    return new Promise((resolve) => resolve(handler(event, payload)));
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
      (songId) => service.deleteWindowBounds(songId),
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

  it('deleteWindowBounds_window-bounds.jsonからその曲の1件だけを除きほかを残す', async () => {
    // IT-FS-IPC-25 data-model-persistence.md 10.1 節「appconfig:deleteWindowBounds（要求は曲の id、応答は無し）は、main が window-bounds.json を読んでその曲の 1 件だけを除き」
    await service.writeWindowBounds('song-a', { x: 1, y: 2, width: 3, height: 4 });
    await service.writeWindowBounds('song-b', { x: 5, y: 6, width: 7, height: 8 });

    await expect(ipc.invoke(APP_CONFIG_CHANNELS.deleteWindowBounds, { songId: 'song-a' })).resolves.toBeUndefined();

    expect(await service.readWindowBounds('song-a')).toBeNull();
    expect(await service.readWindowBounds('song-b')).toEqual({ x: 5, y: 6, width: 7, height: 8 });
  });

  it('claimStartupCleanup_起動してから初めての呼び出しだけtrue_2回目からfalse', async () => {
    // IT-FS-IPC-26 data-model-persistence.md 10.1 節「アプリを起動してから初めて呼ばれたときだけ true を返し、2 回目からは false を返す」。
    // 17 節の (b)：印は main に持つので、曲一覧ウィンドウ（レンダラー）を開き直しても true は 2 度返らない
    await expect(ipc.invoke(APP_CONFIG_CHANNELS.claimStartupCleanup)).resolves.toBe(true);
    await expect(ipc.invoke(APP_CONFIG_CHANNELS.claimStartupCleanup)).resolves.toBe(false);
    await expect(ipc.invoke(APP_CONFIG_CHANNELS.claimStartupCleanup)).resolves.toBe(false);
  });

  it('deleteWindowBounds_曲のidが空でない文字列でない要求_rejectし消さない', async () => {
    // IT-FS-IPC-27 web-core-foundation.md 6.2 節「受け取った引数を確かめてから使う」：songId が空でない文字列でなければ拒む
    await service.writeWindowBounds('song-a', { x: 1, y: 2, width: 3, height: 4 });
    const deleteSpy = vi.spyOn(service, 'deleteWindowBounds');

    for (const payload of [undefined, 'song-a', { songId: '' }, { songId: 3 }, { id: 'song-a' }]) {
      await expect(ipc.invoke(APP_CONFIG_CHANNELS.deleteWindowBounds, payload)).rejects.toBeInstanceOf(
        InvalidIpcPayloadError,
      );
    }

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(await service.readWindowBounds('song-a')).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});

/** 送り手の窓の fake（main では BrowserWindow）。 */
interface FakeWindow {
  readonly id: number;
}

/** registerLogHandlers に渡すものの fake。`senderWindow` は IPC のイベントの `sender` を窓として返す。 */
function makeLogDeps(
  state: CrashRecoveryState = { recovered: false, repeatedCrash: false, logFolder: '/fake/TabApp/logs' },
) {
  const deps = {
    logger: {
      append: vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve()),
      getLogFolderAbsolutePath: vi.fn(() => '/fake/TabApp/logs'),
    },
    ring: { push: vi.fn<(entry: LogEntry) => void>() },
    senderWindow: vi.fn((event: unknown): FakeWindow | null => (event as { sender?: FakeWindow }).sender ?? null),
    crashRecovery: {
      consumeRecoveryState: vi.fn((_window: FakeWindow | null) => state),
      reloadAfterRenderError: vi.fn<(window: FakeWindow) => void>(),
    },
    openPath: vi.fn<(path: string) => Promise<string>>(() => Promise.resolve('')),
  } satisfies LogHandlerDeps<FakeWindow>;
  return deps;
}

describe('registerLogHandlers (error-logging-foundation.md 2.4 節、B32)', () => {
  const sampleEntry: LogEntry = {
    timestamp: '2026-09-08T00:00:00.000Z',
    level: 'error',
    code: 'FILE-001',
    message: '保存に失敗しました。',
    context: { songId: 's1', error: { name: 'Error', message: 'x' } },
    stack: 'Error: x\n    at save',
  };

  it('registerLogHandlers_log:append・crash:getRecoveryState・window:reloadAfterRenderError・app:openLogFolderを登録する', () => {
    // IT-FS-IPC-14 2.4 節の IPC の一覧（notify:fromMain は main→renderer なので受け口は無い）
    registerLogHandlers(ipc, makeLogDeps());
    expect(new Set(ipc.channels)).toEqual(
      new Set([
        LOG_CHANNELS.append,
        CRASH_CHANNELS.getRecoveryState,
        WINDOW_CHANNELS.reloadAfterRenderError,
        APP_CHANNELS.openLogFolder,
      ]),
    );
  });

  it('logAppend_受けたLogEntryをそのままLogRingBuffer.pushとLogger.appendに渡す', async () => {
    // IT-FS-IPC-15 2.4 節「main の registerLogHandlers は受けた LogEntry をそのまま Logger.append(entry) と LogRingBuffer.push(entry) に渡すだけで、組み立ては行わない」
    const deps = makeLogDeps();
    registerLogHandlers(ipc, deps);

    await ipc.invoke(LOG_CHANNELS.append, sampleEntry);

    expect(deps.ring.push).toHaveBeenCalledTimes(1);
    expect(deps.logger.append).toHaveBeenCalledTimes(1);
    expect(deps.ring.push.mock.calls[0]![0]).toBe(sampleEntry);
    expect(deps.logger.append.mock.calls[0]![0]).toBe(sampleEntry);
  });

  it('crashGetRecoveryState_送り手の窓をconsumeRecoveryStateに渡しその結果を返す', async () => {
    // IT-FS-IPC-16 2.3 節「crash:getRecoveryState の受け口が送り手の窓（BrowserWindow.fromWebContents(event.sender)）を渡す」
    const state: CrashRecoveryState = { recovered: true, repeatedCrash: false, logFolder: '/fake/TabApp/logs' };
    const deps = makeLogDeps(state);
    registerLogHandlers(ipc, deps);
    const window: FakeWindow = { id: 7 };

    await expect(ipc.invoke(CRASH_CHANNELS.getRecoveryState, undefined, { sender: window })).resolves.toEqual(state);

    expect(deps.crashRecovery.consumeRecoveryState).toHaveBeenCalledWith(window);
  });

  it('crashGetRecoveryState_送り手が窓でない_nullを渡す', async () => {
    // IT-FS-IPC-28 2.3 節：窓が渡されないときは未復旧・回数 0 として返す（CrashRecoveryController の受け持ち）
    const deps = makeLogDeps();
    registerLogHandlers(ipc, deps);

    await ipc.invoke(CRASH_CHANNELS.getRecoveryState);

    expect(deps.crashRecovery.consumeRecoveryState).toHaveBeenCalledWith(null);
  });

  it('windowReloadAfterRenderError_送り手の窓をreloadAfterRenderErrorに渡す_窓でなければ呼ばない', async () => {
    // IT-FS-IPC-29 2.4 節「main は CrashRecoveryController.reloadAfterRenderError でそのウィンドウを loadURL で読み込み直す」
    const deps = makeLogDeps();
    registerLogHandlers(ipc, deps);
    const window: FakeWindow = { id: 3 };

    await expect(
      ipc.invoke(WINDOW_CHANNELS.reloadAfterRenderError, undefined, { sender: window }),
    ).resolves.toBeUndefined();
    expect(deps.crashRecovery.reloadAfterRenderError).toHaveBeenCalledTimes(1);
    expect(deps.crashRecovery.reloadAfterRenderError).toHaveBeenCalledWith(window);

    await ipc.invoke(WINDOW_CHANNELS.reloadAfterRenderError);
    expect(deps.crashRecovery.reloadAfterRenderError).toHaveBeenCalledTimes(1);
    // 読み込み直しはクラッシュではない（回数も recovered も触らない）ので、状態を引く口は呼ばない（2.5 節の (b)）
    expect(deps.crashRecovery.consumeRecoveryState).not.toHaveBeenCalled();
  });

  it('appOpenLogFolder_Logger.getLogFolderAbsolutePathのフォルダをopenPathで開く', async () => {
    // IT-FS-IPC-30 2.4 節「app:openLogFolder（renderer→main、Logger.getLogFolderAbsolutePath() のフォルダを shell.openPath で開く）」
    const deps = makeLogDeps();
    registerLogHandlers(ipc, deps);

    await expect(ipc.invoke(APP_CHANNELS.openLogFolder)).resolves.toBeUndefined();

    expect(deps.openPath).toHaveBeenCalledTimes(1);
    expect(deps.openPath).toHaveBeenCalledWith('/fake/TabApp/logs');
  });

  it('appOpenLogFolder_開けない_rejectし文にフォルダの場所を入れない', async () => {
    // IT-FS-IPC-31 shell.openPath は失敗の文を返す。.claude/rules/typescript.md（例外の文に実ファイルのフルパスを入れない）
    const deps = makeLogDeps();
    deps.openPath.mockResolvedValue('Failed to open /fake/TabApp/logs');
    registerLogHandlers(ipc, deps);

    const error = await ipc.invoke(APP_CHANNELS.openLogFolder).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('/fake/TabApp');
  });
});

describe('registerSharedChangeHandlers（web-core-foundation.md 6.3 節、2026-10-29 本人決定 K1）', () => {
  /** 配る先の窓の fake。 */
  function fakeWindow(options: { destroyed?: boolean; contentsDestroyed?: boolean; sendThrows?: boolean } = {}) {
    const send = vi.fn<(channel: string, ...args: unknown[]) => void>(() => {
      if (options.sendThrows === true) throw new Error('render frame was disposed');
    });
    return {
      isDestroyed: () => options.destroyed === true,
      webContents: { isDestroyed: () => options.contentsDestroyed === true, send },
    } satisfies SharedChangeTargetWindow;
  }

  it('sharedChanged_送った窓を除く全部の窓へ同じチャンネルで配りmainの受け口にも渡す', async () => {
    // IT-FS-IPC-32 6.3 節「変えた窓が main へ送り、main が送った窓を除く全部の窓へこの形で配る」
    const sender = fakeWindow();
    const others = [fakeWindow(), fakeWindow()];
    const onNotice = vi.fn<(notice: SharedChangeNotice) => void>();
    registerSharedChangeHandlers(ipc, { targetWindows: () => [sender, ...others], onNotice });

    await expect(
      ipc.invoke(SHARED_CHANNELS.changed, { kind: 'song', id: 'song-1' }, { sender: sender.webContents }),
    ).resolves.toBeUndefined();

    expect(sender.webContents.send).not.toHaveBeenCalled();
    for (const window of others) {
      expect(window.webContents.send).toHaveBeenCalledTimes(1);
      expect(window.webContents.send).toHaveBeenCalledWith(SHARED_CHANNELS.changed, { kind: 'song', id: 'song-1' });
    }
    expect(onNotice).toHaveBeenCalledWith({ kind: 'song', id: 'song-1' });
  });

  it('sharedChanged_受けた窓の読み直しを待たない_mainの受け口の終わりも待たない', async () => {
    // IT-FS-IPC-33 6.3 節「送った窓は、受けた窓の読み直しを待たない」
    let settled = false;
    registerSharedChangeHandlers(ipc, {
      targetWindows: () => [fakeWindow()],
      onNotice: () => void new Promise(() => undefined),
    });

    await ipc.invoke(SHARED_CHANNELS.changed, { kind: 'storage' }).then(() => {
      settled = true;
    });

    expect(settled).toBe(true);
  });

  it('sharedChanged_破棄済みの窓は飛ばし_sendが投げても次の窓へ配る', async () => {
    // IT-FS-IPC-34 破棄した窓・送れない窓で残りの窓へ届かなくならないようにする
    const gone = fakeWindow({ destroyed: true });
    const contentsGone = fakeWindow({ contentsDestroyed: true });
    const throwing = fakeWindow({ sendThrows: true });
    const alive = fakeWindow();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerSharedChangeHandlers(ipc, {
      targetWindows: () => [gone, contentsGone, throwing, alive],
      onNotice: vi.fn(),
    });

    await expect(ipc.invoke(SHARED_CHANNELS.changed, { kind: 'tags' })).resolves.toBeUndefined();

    expect(gone.webContents.send).not.toHaveBeenCalled();
    expect(contentsGone.webContents.send).not.toHaveBeenCalled();
    expect(throwing.webContents.send).toHaveBeenCalledTimes(1);
    expect(alive.webContents.send).toHaveBeenCalledWith(SHARED_CHANNELS.changed, { kind: 'tags' });
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('sharedChanged_知らない欄_確かめた欄だけを配る', async () => {
    // IT-FS-IPC-35 6.3 節「何が変わったかだけを送り、ファイルの中身は送らない」
    const other = fakeWindow();
    const onNotice = vi.fn<(notice: SharedChangeNotice) => void>();
    registerSharedChangeHandlers(ipc, { targetWindows: () => [other], onNotice });

    await ipc.invoke(SHARED_CHANNELS.changed, { kind: 'preferences', content: '{"theme":"x"}' });
    await ipc.invoke(SHARED_CHANNELS.changed, { kind: 'song', id: 's1', title: 'secret' });

    expect(other.webContents.send.mock.calls.map((call) => call[1])).toEqual([
      { kind: 'preferences' },
      { kind: 'song', id: 's1' },
    ]);
    expect(onNotice.mock.calls.map(([notice]) => notice)).toEqual([
      { kind: 'preferences' },
      { kind: 'song', id: 's1' },
    ]);
  });

  it('sharedChanged_idの無いkind_7つを全部受け付ける', async () => {
    // IT-FS-IPC-36 data-model-persistence.md 12 節・13.1 節の kind（trash・tuningPresets・tags・storage・storageLockStart・storageLockEnd・preferences）
    const onNotice = vi.fn<(notice: SharedChangeNotice) => void>();
    registerSharedChangeHandlers(ipc, { targetWindows: () => [], onNotice });

    for (const kind of SHARED_CHANGE_KINDS_WITHOUT_ID) await ipc.invoke(SHARED_CHANNELS.changed, { kind });

    expect(onNotice.mock.calls.map(([notice]) => notice.kind)).toEqual([
      'trash',
      'tuningPresets',
      'tags',
      'storage',
      'storageLockStart',
      'storageLockEnd',
      'preferences',
    ]);
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
    // error-logging-foundation.md 2.4 節：log:append は LogEntry（level は 4 つのどれか・context は省けない・stack は文字）
    [LOG_CHANNELS.append, { level: 'fatal', code: 'X', message: 'm', timestamp: 't', context: {} }],
    [LOG_CHANNELS.append, { level: 'info', code: 'X', message: 'm', timestamp: 't' }],
    [LOG_CHANNELS.append, { level: 'error', code: 'X', message: 'm', timestamp: 't', context: {}, stack: 1 }],
    // web-core-foundation.md 6.3 節：shared:changed は知っている kind だけ。song は空でない id を持つ
    [SHARED_CHANNELS.changed, undefined],
    [SHARED_CHANNELS.changed, { kind: 'index' }],
    [SHARED_CHANNELS.changed, { kind: 3 }],
    [SHARED_CHANNELS.changed, { kind: 'song' }],
    [SHARED_CHANNELS.changed, { kind: 'song', id: '' }],
  ];

  it('ipcHandlers_形の違う要求は_InvalidIpcPayloadErrorでrejectし委譲しない', async () => {
    // IT-FS-IPC-17 web-core-foundation.md 6.2 節
    const factory = { createForRoot: vi.fn() };
    const logDeps = makeLogDeps();
    const onNotice = vi.fn();
    const target = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } };
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
      () => Promise.resolve(),
    );
    registerLogHandlers(ipc, logDeps);
    registerSharedChangeHandlers(ipc, { targetWindows: () => [target], onNotice });

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
    expect(logDeps.ring.push).not.toHaveBeenCalled();
    expect(logDeps.logger.append).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    expect(target.webContents.send).not.toHaveBeenCalled();
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

  it('チャンネルの名前_既存の5つは変えず_fsAtはgetRootPathを除く9つ_appconfigは7つ', () => {
    // IT-FS-IPC-21 data-model-persistence.md 10.1 節の (b)：既存の 5 つの名前を変えず、fs:readFileAt から fs:existsAt までと fs:removeEmptyDirectoryAt の 9 つと appconfig:* を別に足す。
    // appconfig:* は readPointer・writePointer・getActiveRoot・getLocalBackupRoot・getPreMigrationRoot の 5 つ（10.1 節、honnin-queue 206 番）に、
    // 同じ群へ足した deleteWindowBounds・claimStartupCleanup の 2 つ（10.1 節、2026-10-28、honnin-queue 216 番）
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
      'appconfig:deleteWindowBounds',
      'appconfig:claimStartupCleanup',
    ]);
  });

  it('チャンネルの名前_エラー・ログ基盤と共有の知らせ', () => {
    // IT-FS-IPC-37 error-logging-foundation.md 2.4 節の IPC の一覧（log:append・crash:getRecoveryState・freeze:recovered・
    // window:reloadAfterRenderError・notify:fromMain・app:openLogFolder）と、web-core-foundation.md 6.3 節の shared:changed
    expect(LOG_CHANNELS.append).toBe('log:append');
    expect(CRASH_CHANNELS.getRecoveryState).toBe('crash:getRecoveryState');
    expect(WINDOW_CHANNELS.reloadAfterRenderError).toBe('window:reloadAfterRenderError');
    expect(NOTIFY_CHANNELS.fromMain).toBe('notify:fromMain');
    expect(APP_CHANNELS.openLogFolder).toBe('app:openLogFolder');
    expect(SHARED_CHANNELS.changed).toBe('shared:changed');
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
