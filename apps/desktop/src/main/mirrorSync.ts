/**
 * main のミラーの写しの組み立てとつなぎ（data-model-persistence.md 14.1 節、2026-10-27 本人決定、honnin-queue 214 番）。
 *
 * - `MirrorSyncService`（packages/core）は main に置く。画面の `onSaved`（と曲一覧の「複製」、18 節）は、保存した曲の id を
 * <!-- req datamodelpersistence:7fde5377.7efe --> <!-- req datamodelpersistence:83a56b81.35be -->
 *   IPC の `mirror:syncAfterSave`（要求は `{ songId }`、応答なし）で main に知らせる。画面の側のつなぎは作業パッケージ 8。
 * - main は今の主ストレージのルート（`appconfig:getActiveRoot` と同じ引き方）ごとに `MirrorSyncService` を 1 つ作って使い回す
 *   （ルート → サービスの表）。写す元のアダプタは `FileSystemAdapterFactory.createForRoot`（同じルートには 1 つだけ）で作る。
 * - ミラー先は、主ストレージの `settings.json` を `StorageConfigService.load()` で読み、`mirrorLocations` の `root` の下の
 *   `TabApp/` とする（`root` は選んだフォルダで、その下に `TabApp/` を作る。11 節・14.1 節）。
 * - 終了：最後のウィンドウが閉じた後（`window-all-closed`）に、表の全部の `awaitPending()` を待ってからアプリを終える。
 *   1 つでも false（既定の 15 秒を過ぎた）なら、Warning の `FILE-015` を main の `MainErrorLogger` の `report` で出す（14.1 節、
 *   error-logging-foundation.md 2.6 節）。ログの 1 行は Webコアの `toLogEntry` が組み立て、ここでは組み立てない。
 *   `FILE-015` は画面に出さないコードなので、ログにだけ残る。
 * - main で出た `FILE-005`（`MirrorSyncService` の中で main のプロセスの共有の `notificationCenter` に出す）は、main.ts が
 *   `forwardSharedNotifications`（mainErrorLogger.ts）で `MainErrorLogger` へ渡し、ログに書いて `notify:fromMain` で窓へ送る
 *   （error-logging-foundation.md 2.6 節、2026-10-29 本人決定 K5）。
 *
 * main.ts には分かれ道を置かず（web-core-foundation.md 14.7 節）、判断はここの関数に出す。
 */

import { join } from 'node:path';

import { MirrorSyncService, StorageConfigService } from '@riff-line/core/persistence/mirror';
import type { FileSystemAdapterFactory } from '@riff-line/core/platform';
import { MIRROR_CHANNELS, type MirrorSyncAfterSaveResponse } from '@riff-line/shared-types';

import { TABAPP_DIR } from './ElectronAppLocalConfigService';
import type { IpcMainLike } from './ipc';
import { parseSongId } from './ipcPayload';
import type { MainErrorLogger } from './mainErrorLogger';

/** 終了のときのミラーの写しの待ちを打ち切ったときのコード（data-model-persistence.md 14.1 節、Warning）。 */
const MIRROR_WAIT_TIMED_OUT_CODE = 'FILE-015';

export interface MainMirrorSyncDeps {
  /** 主ストレージ・ミラー先のルートごとのアダプタを作る（main では `ElectronFileSystemAdapterFactory`）。 */
  adapterFactory: FileSystemAdapterFactory;
  /** 今の主ストレージのルート（`{...}/TabApp`）。`appconfig:getActiveRoot` と同じ引き方。 */
  resolveActiveRoot: () => Promise<string>;
  /** `settings.json` が無いときの主ストレージ（その PC のアプリの領域。`StorageConfigService` の既定）。 */
  defaultPrimaryRoot: string;
  /** main の `MainErrorLogger`。終了のときの待ちを打ち切ったら `FILE-015` を出す（error-logging-foundation.md 2.6 節）。 */
  errors: Pick<MainErrorLogger, 'report'>;
}

/** main が持つミラーの写し（主ストレージのルート → `MirrorSyncService` の表）。 */
// <!-- req datamodelpersistence:ef984f9d.fdb6 -->
export class MainMirrorSync {
  private readonly services = new Map<string, MirrorSyncService>();

  constructor(private readonly deps: MainMirrorSyncDeps) {}

  /** 主ストレージのルートの `MirrorSyncService`。同じルートには 1 つだけ作って使い回す。 */
  // <!-- req datamodelpersistence:ef984f9d.d1fe -->
  serviceFor(activeRoot: string): MirrorSyncService {
    const source = this.deps.adapterFactory.createForRoot(activeRoot);
    const key = source.getRootPath();
    let service = this.services.get(key);
    if (service === undefined) {
      service = new MirrorSyncService(source, this.deps.adapterFactory);
      this.services.set(key, service);
    }
    return service;
  }

  /** 主ストレージの `settings.json` の `mirrorLocations` から、ミラー先の `TabApp/` のルートを引く。 */
  async mirrorRootsFor(activeRoot: string): Promise<string[]> {
    const config = new StorageConfigService(
      this.deps.adapterFactory.createForRoot(activeRoot),
      this.deps.defaultPrimaryRoot,
    );
    // <!-- req datamodelpersistence:ef984f9d.e9d0 -->
    const settings = await config.load();
    return settings.mirrorLocations.map((location) => join(location.root, TABAPP_DIR));
  }

  /** 保存した曲の写しを始めさせる（`mirror:syncAfterSave` の中身）。写しの終わりは待たない。 */
  async syncAfterSave(songId: string): Promise<void> {
    const activeRoot = await this.deps.resolveActiveRoot(); // <!-- req datamodelpersistence:0636b892.de27 --> // <!-- req datamodelpersistence:ef984f9d.cb1e -->
    const mirrorRoots = await this.mirrorRootsFor(activeRoot);
    // <!-- req datamodelpersistence:ef984f9d.2d71 -->
    this.serviceFor(activeRoot).syncAfterSave(songId, mirrorRoots);
  }

  /**
   * 表の全部の `awaitPending()` を待つ。全部が終われば true、1 つでも `timeoutMs`（省くと 15 秒）を過ぎたら false。
   * @param timeoutMs 待つ上限（ms）。省くと `MIRROR_AWAIT_PENDING_TIMEOUT_MS`（`awaitPending` の既定）。
   */
  async awaitAllPending(timeoutMs?: number): Promise<boolean> {
    // <!-- req datamodelpersistence:25f2e3af.bcb9 -->
    const results = await Promise.all([...this.services.values()].map((service) => service.awaitPending(timeoutMs)));
    return results.every((done) => done);
  }

  /** 表の全部の写しを待ち、打ち切ったら Warning の `FILE-015` を `MainErrorLogger` で出す（ログにだけ残る。画面には出さない）。 */
  async finishPending(timeoutMs?: number): Promise<void> {
    // <!-- req 00:69604054.065d -->
    if (await this.awaitAllPending(timeoutMs)) return;
    // <!-- req errorloggingfoundation:24d6e022.c1e4 -->
    // <!-- req errorloggingfoundation:14eaf20a.0c99 -->
    // <!-- req errorloggingfoundation:41aaadda.ea48 -->
    // <!-- req 00:69604054.3aa6 -->
    // <!-- req datamodelpersistence:25f2e3af.5af5 -->
    this.deps.errors.report(MIRROR_WAIT_TIMED_OUT_CODE);
  }
}

/** `mirror:syncAfterSave` のハンドラを登録する。要求の形を確かめてから使う（web-core-foundation.md 6.2 節）。 */
export function registerMirrorHandlers(ipcMain: IpcMainLike, mirrorSync: Pick<MainMirrorSync, 'syncAfterSave'>): void {
  ipcMain.handle(MIRROR_CHANNELS.syncAfterSave, async (_event, payload): Promise<MirrorSyncAfterSaveResponse> => {
    const { songId } = parseSongId(MIRROR_CHANNELS.syncAfterSave, payload);
    await mirrorSync.syncAfterSave(songId);
  });
}

/** main のミラーの写しを組み立て、`mirror:syncAfterSave` を受け付ける（main.ts の起動の手順から 1 回呼ぶ）。 */
export function setUpMirrorSync(ipcMain: IpcMainLike, deps: MainMirrorSyncDeps): MainMirrorSync {
  const mirrorSync = new MainMirrorSync(deps);
  registerMirrorHandlers(ipcMain, mirrorSync);
  return mirrorSync;
}

/**
 * 最後のウィンドウが閉じた後（`window-all-closed`）の終了の処理（data-model-persistence.md 14.1 節、screens-navigation.md 4.4 節）。
 * main が持つ全部の `MirrorSyncService` の写しを待ってからアプリを終える。まだ組み立てていなければ（起動の途中）、待たずに終える。
 * 待ちやログが失敗しても、アプリは終える。
 */
// <!-- req datamodelpersistence:25f2e3af.f037 -->
export async function quitAfterMirrorSync(
  mirrorSync: MainMirrorSync | undefined,
  quit: () => void,
  timeoutMs?: number,
): Promise<void> {
  try {
    // <!-- req datamodelpersistence:25f2e3af.0b9e -->
    await mirrorSync?.finishPending(timeoutMs);
  } catch (error) {
    // 終了を止めない。主ストレージへの保存は終わっているので、ログを書けなかったことだけをコンソールに残す。
    console.error('[mirrorSync] 終了のときの写しの待ちに失敗しました:', error);
  }
  quit();
}
