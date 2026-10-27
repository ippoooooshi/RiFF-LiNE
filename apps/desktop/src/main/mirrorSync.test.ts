// IT-FS-MIRROR: main のミラーの写し（mirrorSync.ts の MainMirrorSync・registerMirrorHandlers・quitAfterMirrorSync）
// 検証節: data-model-persistence.md 14.1 節（2026-10-27 本人決定、honnin-queue 214 番）、screens-navigation.md 4.4 節
// IT: fake ipcMain でハンドラを捕捉し、mirror:syncAfterSave を invoke して、主ストレージ（一時ディレクトリ）の曲のファイルと index.json が
// settings.json の mirrorLocations の下の TabApp/ へ写ることを実 I/O で確かめる。終了のときの写しの待ちと FILE-015 のログも確かめる。

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LogEntry } from '@riff-line/core/errors';
import { MIRROR_CHANNELS } from '@riff-line/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ElectronFileSystemAdapterFactory } from './ElectronFileSystemAdapterFactory';
import type { IpcMainLike } from './ipc';
import { InvalidIpcPayloadError } from './ipcPayload';
import {
  MainMirrorSync,
  mirrorWaitTimedOutLogEntry,
  quitAfterMirrorSync,
  setUpMirrorSync,
  type MainMirrorSyncDeps,
} from './mirrorSync';

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

let base: string;
let activeRoot: string;
let mirrorBase: string;
let factory: ElectronFileSystemAdapterFactory;
let ipc: FakeIpcMain;
let logged: LogEntry[];
let deps: MainMirrorSyncDeps;

/** 主ストレージの TabApp/ に曲のファイルと index.json と settings.json を置く。 */
async function putSource(root: string, songId: string, mirrorRoots: string[]): Promise<void> {
  await mkdir(join(root, 'songs'), { recursive: true });
  await writeFile(join(root, 'songs', `${songId}.tabapp`), `{"id":"${songId}"}`);
  await writeFile(join(root, 'index.json'), JSON.stringify([{ id: songId, folder: '' }]));
  await writeFile(
    join(root, 'settings.json'),
    JSON.stringify({
      storageLocation: { root: base, type: 'local' },
      mirrorLocations: mirrorRoots.map((r) => ({ root: r, type: 'custom' })),
    }),
  );
}

/** ミラー先のアダプタの ensureDirectory を終わらないようにする（写しが進んだまま終わらない形）。 */
function hangMirror(mirrorTabApp: string): void {
  vi.spyOn(factory.createForRoot(mirrorTabApp), 'ensureDirectory').mockImplementation(() => new Promise(() => {}));
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'tabapp-mirror-'));
  activeRoot = join(base, 'TabApp');
  mirrorBase = join(base, 'mirror');
  factory = new ElectronFileSystemAdapterFactory({ retryOnDemandDownload: false });
  ipc = new FakeIpcMain();
  logged = [];
  deps = {
    adapterFactory: factory,
    resolveActiveRoot: () => Promise.resolve(activeRoot),
    defaultPrimaryRoot: base,
    log: { append: (entry) => void logged.push(entry) },
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Windows では消す途中に一時的な ENOTEMPTY・EBUSY が出ることがあるので、Node の rm の読み直しに任せる
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('mirror:syncAfterSave（data-model-persistence.md 14.1 節）', () => {
  it('syncAfterSave_CopiesSongAndIndexToMirrorTabApp', async () => {
    // IT-FS-MIRROR-01 14.1 節：画面が IPC の mirror:syncAfterSave（要求は { songId }、応答なし）で知らせ、main がミラー先を
    // StorageConfigService.load() から引いて写す。ミラー先は mirrorLocations の root の下の TabApp/
    await putSource(activeRoot, 's1', [mirrorBase]);
    const mirrorSync = setUpMirrorSync(ipc, deps);
    expect(ipc.channels).toEqual([MIRROR_CHANNELS.syncAfterSave]);
    expect(MIRROR_CHANNELS.syncAfterSave).toBe('mirror:syncAfterSave');

    await expect(ipc.invoke(MIRROR_CHANNELS.syncAfterSave, { songId: 's1' })).resolves.toBeUndefined();
    await expect(mirrorSync.awaitAllPending()).resolves.toBe(true);

    const mirrorTabApp = join(mirrorBase, 'TabApp');
    expect(await readFile(join(mirrorTabApp, 'songs', 's1.tabapp'), 'utf8')).toBe('{"id":"s1"}');
    expect(await readFile(join(mirrorTabApp, 'index.json'), 'utf8')).toBe(
      await readFile(join(activeRoot, 'index.json'), 'utf8'),
    );
  });

  it('syncAfterSave_InvalidPayload_RejectsWithoutStartingCopy', async () => {
    // IT-FS-MIRROR-02 web-core-foundation.md 6.2 節：main の IPC のハンドラは、受け取った引数を確かめてから使う
    const mirrorSync = setUpMirrorSync(ipc, deps);
    const sync = vi.spyOn(mirrorSync, 'syncAfterSave');
    for (const payload of [undefined, null, {}, { songId: 1 }, ['s1']]) {
      await expect(ipc.invoke(MIRROR_CHANNELS.syncAfterSave, payload)).rejects.toBeInstanceOf(InvalidIpcPayloadError);
    }
    expect(sync).not.toHaveBeenCalled();
  });

  it('serviceFor_SameRootReusesOneServicePerActiveRoot', async () => {
    // IT-FS-MIRROR-03 14.1 節の (b)：main は今の主ストレージのルートごとに MirrorSyncService を 1 つ作って使い回す
    const mirrorSync = new MainMirrorSync(deps);
    const first = mirrorSync.serviceFor(activeRoot);
    expect(mirrorSync.serviceFor(`${activeRoot}/`)).toBe(first);
    expect(mirrorSync.serviceFor(join(base, 'other', 'TabApp'))).not.toBe(first);

    // 主ストレージを切り替えた後の写しは、切り替えた後のルートのサービスが受け持つ
    const switched = join(base, 'switched', 'TabApp');
    await putSource(switched, 's2', [mirrorBase]);
    activeRoot = switched;
    const target = mirrorSync.serviceFor(switched);
    const sync = vi.spyOn(target, 'syncAfterSave');
    await mirrorSync.syncAfterSave('s2');
    expect(sync).toHaveBeenCalledWith('s2', [join(mirrorBase, 'TabApp')]);
    await expect(mirrorSync.awaitAllPending()).resolves.toBe(true);
  });

  it('syncAfterSave_NoMirrorLocationsOrNoSettings_WritesNothing', async () => {
    // IT-FS-MIRROR-04 11 節：ミラー先は 0 個以上。0 個なら写さない（settings.json が無ければ既定のミラー先 0 個）
    const mirrorSync = new MainMirrorSync(deps);
    await expect(mirrorSync.mirrorRootsFor(activeRoot)).resolves.toEqual([]);
    await putSource(activeRoot, 's1', []);
    await mirrorSync.syncAfterSave('s1');
    await expect(mirrorSync.awaitAllPending()).resolves.toBe(true);
    await expect(readFile(join(mirrorBase, 'TabApp', 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('終了のときの写しの待ち（data-model-persistence.md 14.1 節、screens-navigation.md 4.4 節）', () => {
  it('quitAfterMirrorSync_WaitsForPendingCopyThenQuitsWithoutLog', async () => {
    // IT-FS-MIRROR-05 14.1 節：最後のウィンドウが閉じた後に、main が持つ全部の MirrorSyncService の awaitPending() を待ってからアプリを終える
    await putSource(activeRoot, 's1', [mirrorBase]);
    const mirror = factory.createForRoot(join(mirrorBase, 'TabApp'));
    const realEnsure = mirror.ensureDirectory.bind(mirror);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(mirror, 'ensureDirectory').mockImplementation(async (path) => {
      await gate;
      return realEnsure(path);
    });
    const mirrorSync = new MainMirrorSync(deps);
    await mirrorSync.syncAfterSave('s1');
    const songCopy = join(mirrorBase, 'TabApp', 'songs', 's1.tabapp');
    const quit = vi.fn();

    const quitting = quitAfterMirrorSync(mirrorSync, quit);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // 写しが進んでいる間は終えない
    expect(quit).not.toHaveBeenCalled();
    release();
    await quitting;

    expect(quit).toHaveBeenCalledTimes(1);
    expect(await readFile(songCopy, 'utf8')).toBe('{"id":"s1"}');
    expect(logged).toEqual([]);
  });

  it('quitAfterMirrorSync_PendingPastTimeout_LogsFile015WarningThenQuits', async () => {
    // IT-FS-MIRROR-06 14.1 節：待つのは既定で 15 秒までで、過ぎたら Warning の FILE-015 を main のログに書いて終える（画面には出さない）
    await putSource(activeRoot, 's1', [mirrorBase]);
    hangMirror(join(mirrorBase, 'TabApp'));
    const mirrorSync = new MainMirrorSync(deps);
    await mirrorSync.syncAfterSave('s1');
    const order: string[] = [];
    deps.log.append = (entry) => void order.push(`log:${entry.code}:${entry.level}`);
    const quit = vi.fn(() => void order.push('quit'));

    await quitAfterMirrorSync(mirrorSync, quit, 20);

    expect(order).toEqual(['log:FILE-015:warning', 'quit']);
  });

  it('awaitAllPending_OneOfSeveralRootsTimesOut_ReturnsFalse', async () => {
    // IT-FS-MIRROR-07 14.1 節：表の全部を待ち、1 つでも false なら false
    const slowRoot = join(base, 'slow', 'TabApp');
    const slowMirror = join(base, 'slowMirror');
    await putSource(activeRoot, 's1', [mirrorBase]);
    await putSource(slowRoot, 's2', [slowMirror]);
    hangMirror(join(slowMirror, 'TabApp'));
    const mirrorSync = new MainMirrorSync(deps);
    const fastRoot = activeRoot;
    await mirrorSync.syncAfterSave('s1');
    activeRoot = slowRoot;
    await mirrorSync.syncAfterSave('s2');
    // 終わる方の写しは、既定の上限（15 秒）まで待てば終わる。20ms の待ちだけに頼ると、重いときに終わる前に後片付けが走って崩れるため先に待つ
    await expect(mirrorSync.serviceFor(fastRoot).awaitPending()).resolves.toBe(true);

    await expect(mirrorSync.awaitAllPending(20)).resolves.toBe(false);
    // 終わる方の写しは終わっている
    expect(await readFile(join(mirrorBase, 'TabApp', 'songs', 's1.tabapp'), 'utf8')).toBe('{"id":"s1"}');
  });

  it('quitAfterMirrorSync_NotSetUpOrLogFails_StillQuits', async () => {
    // IT-FS-MIRROR-08 起動の途中（まだ組み立てていない）なら待たずに終える。ログを書けなくてもアプリは終える
    const quit = vi.fn();
    await quitAfterMirrorSync(undefined, quit);
    expect(quit).toHaveBeenCalledTimes(1);

    await putSource(activeRoot, 's1', [mirrorBase]);
    hangMirror(join(mirrorBase, 'TabApp'));
    const failing = new MainMirrorSync({ ...deps, log: { append: () => Promise.reject(new Error('log down')) } });
    await failing.syncAfterSave('s1');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await quitAfterMirrorSync(failing, quit, 20);
    expect(quit).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalled();
  });

  it('mirrorWaitTimedOutLogEntry_IsFile015WarningWithRegisteredMessage', () => {
    // IT-FS-MIRROR-09 14.1 節：ログは Warning の FILE-015（2026-10-06 チャット側の決定、honnin-queue 46 番）。文言は登録した文
    const now = new Date('2026-10-27T01:02:03.000Z');
    expect(mirrorWaitTimedOutLogEntry(now)).toEqual({
      timestamp: '2026-10-27T01:02:03.000Z',
      level: 'warning',
      code: 'FILE-015',
      message: 'ミラー先への写しが終わる前にアプリを終了しました（主ストレージへの保存は終わっています）。',
    });
    expect(mirrorWaitTimedOutLogEntry().code).toBe('FILE-015');
  });
});
