// UT-PERSIST-MIRROR: `MirrorSyncService`（ミラーの写し・`awaitPending`、B26）
// 検証節: data-model-persistence.md 14.1 節
// 検証観点: 待たずに写す、曲のファイル（サブフォルダを含む同じ相対パス）と index.json の 2 つだけを一時ファイルからの改名で写す、
// 消す処理を持たない、失敗は FILE-005 で外へ投げない、awaitPending は終われば true・過ぎたら false（既定 15 秒）（C0/C1）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationEvent } from '../errors';
import { notificationCenter } from '../errors';
import { FakeFileSystemAdapter, FakeFileSystemAdapterFactory } from '../testing/FakeFileSystemAdapter';

import { INDEX_FILE, MIRROR_AWAIT_PENDING_TIMEOUT_MS, TMP_SUFFIX } from './constants';
import { MirrorSyncService, folderOfSongInIndex } from './MirrorSyncService';
import { songFilePath, thumbnailFilePath } from './paths';

let source: FakeFileSystemAdapter;
let factory: FakeFileSystemAdapterFactory;
let service: MirrorSyncService;
let reported: NotificationEvent[];
let unsubscribe: () => void;

const MIRROR_A = '/mirror-a/TabApp';
const MIRROR_B = '/mirror-b/TabApp';
const INDEX_TEXT = JSON.stringify([{ id: 's1', folder: '' }]);

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

beforeEach(() => {
  source = new FakeFileSystemAdapter({ rootPath: '/active/TabApp' });
  source.putText(songFilePath('s1'), '{"song":true}');
  source.putText(INDEX_FILE, INDEX_TEXT);
  factory = new FakeFileSystemAdapterFactory();
  service = new MirrorSyncService(source, factory);
  reported = [];
  unsubscribe = notificationCenter.subscribe((event) => reported.push(event));
});

afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MirrorSyncService.syncAfterSave', () => {
  it('syncAfterSave_ReturnsSynchronously_ThenCopiesInBackground', async () => {
    // UT-PERSIST-MIRROR-01 14.1 節：保存の後に、設定したミラー先それぞれへ同じ中身を非同期で写す（呼んだ側は待たない）
    const ret = service.syncAfterSave('s1', [MIRROR_A, MIRROR_B]);
    expect(ret).toBeUndefined();
    expect(factory.createForRoot(MIRROR_A).files.size).toBe(0); // まだ写していない（待たずに戻った）

    await service.awaitPending();
    for (const root of [MIRROR_A, MIRROR_B]) {
      expect(factory.createForRoot(root).readText(songFilePath('s1'))).toBe('{"song":true}');
      expect(factory.createForRoot(root).readText(INDEX_FILE)).toBe(INDEX_TEXT);
    }
  });

  it('syncAfterSave_NoMirrors_DoesNothing', async () => {
    // UT-PERSIST-MIRROR-02
    service.syncAfterSave('s1', []);
    await service.awaitPending();
    expect(factory.byRoot.size).toBe(0);
  });

  it('syncAfterSave_MirrorWriteFails_ReportsFile005AndOtherMirrorsStillCopied', async () => {
    // UT-PERSIST-MIRROR-03 14.1 節：ミラー先への書き込みの失敗は Warning の FILE-005。ほかのミラー先は写す
    const badMirror = factory.createForRoot(MIRROR_A);
    vi.spyOn(badMirror, 'writeFile').mockRejectedValue(new Error('offline'));

    service.syncAfterSave('s1', [MIRROR_A, MIRROR_B]);
    await service.awaitPending();

    expect(factory.createForRoot(MIRROR_B).files.has(songFilePath('s1'))).toBe(true);
    const file005 = reported.filter((event) => event.code === 'FILE-005');
    expect(file005).toHaveLength(1);
    expect(file005[0]?.level).toBe('warning');
    expect(file005[0]?.context).toMatchObject({ songId: 's1', mirrorRoot: MIRROR_A });
  });

  it('syncAfterSave_SourceReadFails_ReportsFile005AndSkips', async () => {
    // UT-PERSIST-MIRROR-04
    vi.spyOn(source, 'readFile').mockRejectedValue(new Error('gone'));
    service.syncAfterSave('s1', [MIRROR_A]);
    await service.awaitPending();
    expect(factory.createForRoot(MIRROR_A).files.size).toBe(0);
    const file005 = reported.filter((event) => event.code === 'FILE-005');
    expect(file005).toHaveLength(1);
    expect(file005[0]?.context).toMatchObject({ songId: 's1', reason: 'source-read-failed' });
  });

  it('syncAfterSave_SongInSubfolder_CopiesToSameRelativePathUnderMirror', async () => {
    // UT-PERSIST-MIRROR-08 14.1 節の (b)：songs/{サブフォルダ/}{id}.tabapp を、ミラー先の TabApp/ の下の同じ相対パスへ写す
    source.files.clear();
    source.putText(songFilePath('s1', 'live/2024'), '{"sub":true}');
    source.putText(INDEX_FILE, JSON.stringify([{ id: 's1', folder: 'live/2024' }]));

    service.syncAfterSave('s1', [MIRROR_A]);
    await service.awaitPending();

    const mirror = factory.createForRoot(MIRROR_A);
    expect(mirror.readText('songs/live/2024/s1.tabapp')).toBe('{"sub":true}');
    expect(mirror.files.has(songFilePath('s1'))).toBe(false);
  });

  it('syncAfterSave_WritesBothFilesViaTmpThenRename', async () => {
    // UT-PERSIST-MIRROR-09 14.1 節の (b)：どちらも一時ファイルからの改名で書く
    const mirror = factory.createForRoot(MIRROR_A);
    const write = vi.spyOn(mirror, 'writeFile');
    const rename = vi.spyOn(mirror, 'renameFile');

    service.syncAfterSave('s1', [MIRROR_A]);
    await service.awaitPending();

    expect(write.mock.calls.map((call) => call[0])).toEqual([
      `${songFilePath('s1')}${TMP_SUFFIX}`,
      `${INDEX_FILE}${TMP_SUFFIX}`,
    ]);
    expect(rename.mock.calls).toEqual([
      [`${songFilePath('s1')}${TMP_SUFFIX}`, songFilePath('s1')],
      [`${INDEX_FILE}${TMP_SUFFIX}`, INDEX_FILE],
    ]);
    expect([...mirror.files.keys()].some((path) => path.endsWith(TMP_SUFFIX))).toBe(false);
  });

  it('syncAfterSave_CopiesOnlySongFileAndIndex_NotThumbnails', async () => {
    // UT-PERSIST-MIRROR-10 14.1 節の (b)・9.1 節：写すのは曲のファイルと index.json の 2 つだけ（thumbnails/ は写さない）
    source.putText(thumbnailFilePath('s1'), 'png');
    source.putText(songFilePath('other'), '{"other":true}');

    service.syncAfterSave('s1', [MIRROR_A]);
    await service.awaitPending();

    expect([...factory.createForRoot(MIRROR_A).files.keys()].sort()).toEqual([INDEX_FILE, songFilePath('s1')].sort());
  });

  it('syncAfterSave_MirrorHasExtraSong_DoesNotDeleteIt', async () => {
    // UT-PERSIST-MIRROR-11 14.1 節の (b)：ミラー先から曲のファイルを消す処理は持たない（ゴミ箱へ入れても、ミラー先の曲は残す）
    const mirror = factory.createForRoot(MIRROR_A);
    mirror.putText(songFilePath('trashed'), '{"kept":true}');
    const del = vi.spyOn(mirror, 'deleteFile');

    service.syncAfterSave('s1', [MIRROR_A]);
    await service.awaitPending();

    expect(del).not.toHaveBeenCalled();
    expect(mirror.readText(songFilePath('trashed'))).toBe('{"kept":true}');
    const methods = Object.getOwnPropertyNames(MirrorSyncService.prototype);
    expect(methods.filter((name) => /delete|remove|purge|trash/i.test(name))).toEqual([]);
  });

  it('syncAfterSave_AdapterFactoryThrows_ReportsFile005WithoutThrowing', async () => {
    // UT-PERSIST-MIRROR-12 14.1 節：失敗は中で受けて FILE-005 を出し、外へ投げない（主の保存を犠牲にしない）
    vi.spyOn(factory, 'createForRoot').mockImplementation(() => {
      throw new Error('no such drive');
    });
    expect(() => service.syncAfterSave('s1', [MIRROR_A])).not.toThrow();
    await expect(service.awaitPending()).resolves.toBe(true);
    expect(reported.filter((event) => event.code === 'FILE-005')).toHaveLength(1);
  });

  it('syncAfterSave_IndexNotJson_ReportsFile005SourceReadFailed', async () => {
    // UT-PERSIST-MIRROR-13 写す元の index.json が読めなければ、どのミラー先へも書かずに FILE-005
    source.putText(INDEX_FILE, '{not json');
    service.syncAfterSave('s1', [MIRROR_A]);
    await service.awaitPending();
    expect(factory.createForRoot(MIRROR_A).files.size).toBe(0);
    expect(reported.filter((event) => event.code === 'FILE-005')[0]?.context).toMatchObject({
      reason: 'source-read-failed',
    });
  });
});

describe('folderOfSongInIndex', () => {
  it('folderOfSongInIndex_VariousIndexShapes_ReturnsFolderOrEmpty', () => {
    // UT-PERSIST-MIRROR-14 15 節の (b)：サブフォルダは index.json の folder で決め、無ければ songs/ の直下
    expect(folderOfSongInIndex(encode(JSON.stringify([{ id: 's1', folder: 'a/b' }])), 's1')).toBe('a/b');
    expect(folderOfSongInIndex(encode(JSON.stringify({ id: 's1' })), 's1')).toBe('');
    expect(folderOfSongInIndex(encode(JSON.stringify([null, 3, { id: 's1', folder: 'x' }])), 's1')).toBe('x');
    expect(folderOfSongInIndex(encode(JSON.stringify([{ id: 's1', folder: 7 }])), 's1')).toBe('');
    expect(folderOfSongInIndex(encode(JSON.stringify([{ id: 's2', folder: 'y' }])), 's1')).toBe('');
    expect(() => folderOfSongInIndex(encode('{'), 's1')).toThrow(SyntaxError);
  });
});

describe('MirrorSyncService.awaitPending', () => {
  it('awaitPending_NothingPending_ResolvesTrue', async () => {
    // UT-PERSIST-MIRROR-05 14.1 節：終われば true
    await expect(service.awaitPending(10)).resolves.toBe(true);
  });

  it('awaitPending_WaitsForInFlightCopies_ThenResolvesTrue', async () => {
    // UT-PERSIST-MIRROR-06
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mirror = factory.createForRoot(MIRROR_A);
    const realWrite = mirror.writeFile.bind(mirror);
    vi.spyOn(mirror, 'writeFile').mockImplementation(async (path, data) => {
      await gate;
      await realWrite(path, data);
    });

    service.syncAfterSave('s1', [MIRROR_A]);
    let result: boolean | undefined;
    const waiting = service.awaitPending(5000).then((value) => {
      result = value;
    });
    await Promise.resolve();
    expect(result).toBeUndefined();

    release();
    await waiting;
    expect(result).toBe(true);
  });

  it('awaitPending_Timeout_ResolvesFalseWithoutThrowingOrLogging', async () => {
    // UT-PERSIST-MIRROR-07 14.1 節：過ぎても投げず false で解決する。ログ（FILE-015）は呼んだ main が書くので、ここでは書かない
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(factory.createForRoot(MIRROR_A), 'writeFile').mockImplementation(() => new Promise<void>(() => {}));

    service.syncAfterSave('s1', [MIRROR_A]);
    const waiting = service.awaitPending(15000);
    await vi.advanceTimersByTimeAsync(15000);
    await expect(waiting).resolves.toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(reported).toEqual([]);
  });

  it('awaitPending_NoArgument_UsesMirrorAwaitPendingTimeout', async () => {
    // UT-PERSIST-MIRROR-15 14.1 節の (b)：引数を省いたときは MIRROR_AWAIT_PENDING_TIMEOUT_MS（15000）を使う
    expect(MIRROR_AWAIT_PENDING_TIMEOUT_MS).toBe(15000);
    vi.useFakeTimers();
    vi.spyOn(factory.createForRoot(MIRROR_A), 'writeFile').mockImplementation(() => new Promise<void>(() => {}));

    service.syncAfterSave('s1', [MIRROR_A]);
    let result: boolean | undefined;
    void service.awaitPending().then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(MIRROR_AWAIT_PENDING_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(false);
  });

  it('awaitPending_AfterCopiesFinish_PendingIsEmptyAgain', async () => {
    // UT-PERSIST-MIRROR-16 終わった写しは待つ対象から外れる（次の awaitPending はすぐ true）
    service.syncAfterSave('s1', [MIRROR_A]);
    await service.awaitPending();
    vi.useFakeTimers();
    await expect(service.awaitPending(1)).resolves.toBe(true);
  });
});
