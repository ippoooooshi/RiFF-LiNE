/**
 * main のミラーの写しの組み立てとつなぎ（data-model-persistence.md 14.1 節、2026-10-27 本人決定、honnin-queue 214 番）。
 *
 * - `MirrorSyncService`（packages/core）は main に置く。画面の `onSaved`（と曲一覧の「複製」、18 節）は、保存した曲の id を
 * <!-- req datamodelpersistence:7fde5377.7efe --> <!-- req datamodelpersistence:83a56b81.35be -->
 *   IPC の `mirror:syncAfterSave`（要求は `{ songId }`、応答なし）で main に知らせる。画面の側のつなぎは作業パッケージ 8。
 * - main は今の主ストレージのルート（`appconfig:getActiveRoot` と同じ引き方）ごとに `MirrorSyncService` を 1 つ作って使い回す
 *   （ルート → サービスの表）。`shared:changed` の `{ kind: 'storage' }` を受けたら、使うものを新しい主ストレージのルートのものに
 *   替える（12 節・14.1 節の (b)、2026-10-29 本人決定 K1）。写す元のアダプタは `FileSystemAdapterFactory.createForRoot`（同じルートには 1 つだけ）で作る。
 * - ミラー先は、主ストレージの `settings.json` を `StorageConfigService.load()` で読み、`mirrorLocations` の `root` の下の
 *   `TabApp/` とする（`root` は選んだフォルダで、その下に `TabApp/` を作る。11 節・14.1 節）。
 * - 終了：最後のウィンドウが閉じた後（`window-all-closed`）に、表の全部の `awaitPending()` を待ってからアプリを終える。
 *   1 つでも false（既定の 15 秒を過ぎた）なら、Warning の `FILE-015` を main の `MainErrorLogger` の `report` で出す（14.1 節、
 *   error-logging-foundation.md 2.6 節）。ログの 1 行は Webコアの `toLogEntry` が組み立て、ここでは組み立てない。
 *   `FILE-015` は画面に出さないコードなので、ログにだけ残る。
 * - main で出た `FILE-005` は、`MirrorSyncService` を作るときに constructor へ渡す `errors.report`（main.ts が渡す
 *   `MainErrorLogger`）で出し、ログに書いて `notify:fromMain` で窓へ送る。共有の `notificationCenter` を経て渡し直す口は置かない
 *   （data-model-persistence.md 14.1 節の (b)、error-logging-foundation.md 2.6 節、honnin-queue 228 番）。
 *
 * main.ts には分かれ道を置かず（web-core-foundation.md 14.7 節）、判断はここの関数に出す。
 */

import { join } from 'node:path';

import { MirrorSyncService, StorageConfigService } from '@riff-line/core/persistence/mirror';
import type { FileSystemAdapterFactory } from '@riff-line/core/platform';
import { MIRROR_CHANNELS, type MirrorSyncAfterSaveResponse, type SharedChangeNotice } from '@riff-line/shared-types';

import { TABAPP_DIR } from './ElectronAppLocalConfigService';
import type { IpcMainLike } from './ipc';
import { parseSongId } from './ipcPayload';
import type { MainErrorLogger } from './mainErrorLogger';

/** 終了のときのミラーの写しの待ちを打ち切ったときのコード（data-model-persistence.md 14.1 節、Warning）。 */
const MIRROR_WAIT_TIMED_OUT_CODE = 'FILE-015';

/** ミラーへ写せなかったときのコード（data-model-persistence.md 14.1 節、Warning）。 */
const MIRROR_FAILED_CODE = 'FILE-005';

/** 主ストレージのルートの `MirrorSyncService` を引き直せなかったときの `FILE-005` の理由（`context.reason`、14.1 節の (b)）。 */
export const ACTIVE_ROOT_UNAVAILABLE_REASON = 'active-root-unavailable';

export interface MainMirrorSyncDeps {
  /** 主ストレージ・ミラー先のルートごとのアダプタを作る（main では `ElectronFileSystemAdapterFactory`）。 */
  adapterFactory: FileSystemAdapterFactory;
  /** 今の主ストレージのルート（`{...}/TabApp`）。`appconfig:getActiveRoot` と同じ引き方。 */
  resolveActiveRoot: () => Promise<string>;
  /** `settings.json` が無いときの主ストレージ（その PC のアプリの領域。`StorageConfigService` の既定）。 */
  defaultPrimaryRoot: string;
  /**
   * main の `MainErrorLogger`。`MirrorSyncService` の `FILE-005` と、終了のときの待ちを打ち切ったときの `FILE-015` を出す
   * （error-logging-foundation.md 2.6 節、data-model-persistence.md 14.1 節）。
   */
  errors: Pick<MainErrorLogger, 'report'>;
}

/** main が持つミラーの写し（主ストレージのルート → `MirrorSyncService` の表）。 */
// <!-- req datamodelpersistence:779b936e.fdb6 -->
export class MainMirrorSync {
  private readonly services = new Map<string, MirrorSyncService>();

  /** 使う `MirrorSyncService` とその主ストレージのルート。初めて写すときに引いて決め、`storage` の知らせで替える（14.1 節の (b)、K1）。 */
  private active: { root: string; service: MirrorSyncService } | undefined;

  constructor(private readonly deps: MainMirrorSyncDeps) {}

  /** 今の主ストレージのルートを引き、使う `MirrorSyncService` をそのルートのもの（表から使い回す）にする。 */
  private async useActiveRoot(): Promise<{ root: string; service: MirrorSyncService }> {
    const root = await this.deps.resolveActiveRoot();
    this.active = { root, service: this.serviceFor(root) };
    return this.active;
  }

  /**
   * `shared:changed` の知らせを受ける（data-model-persistence.md 12 節・14.1 節の (b)、K1）。`storage` なら新しい主ストレージの
   * ルートを引き、使う `MirrorSyncService` をそのルートのものに替える。前のルートのものは表に残し、終了のときに待つ。
   * 新しいルートを引けなければ、前のルートのものを使い続けず、使うものを空にする。次の `syncAfterSave` で引き直す
   * （初めて写すときと同じ。前のルートに残った古い曲をミラーへ写さないため、data-model-persistence.md 14.1 節の (b)、2026-11-02 チャット側の決定）。
   */
  async onSharedChange(notice: SharedChangeNotice): Promise<void> {
    // <!-- req datamodelpersistence:779b936e.cb1e --> <!-- req datamodelpersistence:0636b892.de27 -->
    if (notice.kind !== 'storage') return;
    this.active = undefined;
    try {
      await this.useActiveRoot();
    } catch (error) {
      console.error(
        '[mirrorSync] 新しい主ストレージのルートを引けなかったので、使う写しのサービスを空にし、次の写しで引き直します:',
        error,
      );
    }
  }

  /** 主ストレージのルートの `MirrorSyncService`。同じルートには 1 つだけ作って使い回す。 */
  // <!-- req datamodelpersistence:779b936e.d1fe -->
  serviceFor(activeRoot: string): MirrorSyncService {
    const source = this.deps.adapterFactory.createForRoot(activeRoot);
    const key = source.getRootPath();
    let service = this.services.get(key);
    if (service === undefined) {
      // 14.1 節の (b)：FILE-005 は MainErrorLogger の report で出す（共有の notificationCenter を通さない、honnin-queue 228 番）
      // <!-- req datamodelpersistence:e97ad6f9.4fc5 -->
      // <!-- req datamodelpersistence:779b936e.04ad -->
      // <!-- req datamodelpersistence:779b936e.ae00 -->
      // <!-- req errorloggingfoundation:f784b298.04ad -->
      service = new MirrorSyncService(source, this.deps.adapterFactory, (code, context) =>
        // <!-- req datamodelpersistence:779b936e.b682 -->
        // <!-- req errorloggingfoundation:f784b298.4899 -->
        // <!-- req errorloggingfoundation:b7de7add.0940 -->
        this.deps.errors.report(code, context),
      );
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
    // <!-- req datamodelpersistence:779b936e.e9d0 -->
    const settings = await config.load();
    return settings.mirrorLocations.map((location) => join(location.root, TABAPP_DIR));
  }

  /**
   * 保存した曲の写しを始めさせる（`mirror:syncAfterSave` の中身）。写しの終わりは待たない。
   * 使うものが空（初めて写すとき・`storage` の知らせで引けなかった後）なら今の主ストレージのルートを引き直す。そこでも引けなければ
   * 写さずに、Warning の `FILE-005` を `MainErrorLogger.report` で出し（`context` に `songId` と理由）、投げない
   * （data-model-persistence.md 14.1 節の (b)、2026-11-02 チャット側の決定）。
   */
  async syncAfterSave(songId: string): Promise<void> {
    let active = this.active;
    if (active === undefined) {
      try {
        active = await this.useActiveRoot();
      } catch (error) {
        this.deps.errors.report(MIRROR_FAILED_CODE, {
          songId,
          reason: ACTIVE_ROOT_UNAVAILABLE_REASON,
          error: String(error),
        });
        return;
      }
    }
    const mirrorRoots = await this.mirrorRootsFor(active.root);
    // <!-- req datamodelpersistence:779b936e.2d71 -->
    active.service.syncAfterSave(songId, mirrorRoots);
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
    // <!-- req 00:69604054.3aa6 -->
    // <!-- req datamodelpersistence:25f2e3af.5af5 -->
    // <!-- req errorloggingfoundation:f784b298.0c99 -->
    // <!-- req errorloggingfoundation:b7de7add.6235 -->
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
