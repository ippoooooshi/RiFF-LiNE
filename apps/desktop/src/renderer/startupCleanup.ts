/**
 * 起動のときの片付けのつなぎ（data-model-persistence.md 17 節・8 節、2026-10-27 本人決定、honnin-queue 206 番）。
 *
 * 曲一覧ウィンドウのレンダラーが起動した後に 1 回だけ、core の `runStartupCleanup` を呼ぶ：
 * 保持期間（`preferences.json` の `trashRetentionDays`、13.3 節）を過ぎたゴミ箱の曲を消し、残りが 3 日以下の曲があれば
 * Warning の `FILE-007` を出し、`PreMigration/`（場所は `appconfig:getPreMigrationRoot`、10.1 節）の 30 日を過ぎた版を消す。
 * 中身（何を消し、いつ知らせるか）は core に置き、ここはアダプタを組んで渡すだけにする。
 *
 * 17 節の (b)（2026-10-28）：1 回だけにする印は main に持つ。片付けを始める前に `appconfig:claimStartupCleanup` を呼び、
 * `true` が返ったときだけ片付ける（曲一覧ウィンドウを閉じて開き直しても、同じ起動で 2 度は片付けない）。
 * 期限で完全に消した曲は、`TrashService` の `onPermanentlyDeleted` の知らせを受けて `appconfig:deleteWindowBounds` で
 * main に `window-bounds.json` のその曲の 1 件を消させる（13.2 節、honnin-queue 216 番）。
 */

import { PreMigrationService, SongIndexService, TrashService, runStartupCleanup } from '@riff-line/core';
import { notificationCenter } from '@riff-line/core/errors';

import { IpcFileSystemAdapter } from './ipcFileSystem';

/** このレンダラーで片付けを始めたか（開発の起動の StrictMode が効果を 2 回呼ぶのを止める）。 */
let started = false;

/**
 * 完全に消した曲の `window-bounds.json` の 1 件を main に消させる（17 節の (b)・10.1 節）。
 * 消せなくても片付けは続ける（残った 1 件は、同じ id の曲を開いたときの窓の位置に使われるだけ）。
 */
export function deleteWindowBoundsOf(songId: string): void {
  // <!-- req datamodelpersistence:08b9ca6a.6c30 -->
  // <!-- req datamodelpersistence:1e90db94.b5a2 -->
  window.riffLineApi.appConfig.deleteWindowBounds(songId).catch((error: unknown) => {
    console.warn('[startupCleanup] 完全に消した曲の窓の位置の記録を消せなかった:', error);
  });
}

/**
 * 起動のときの片付けを、このアプリの起動で 1 回だけ走らせる（17 節の (b)「起動の処理の中で 1 回だけ呼ぶことで、起動ごとに 1 回までを守る」）。
 * main の `appconfig:claimStartupCleanup` が `false` を返したら（この起動で既に片付けた）何もしない。
 * 失敗しても起動を止めない（reject しない）。
 * @param activeRoot 主ストレージのルート（`appconfig:getActiveRoot`）。
 * @param retentionDays ゴミ箱の保持期間の日数（`preferences.json` の `trashRetentionDays`）。
 */
export function runStartupCleanupOnce(activeRoot: string, retentionDays: number): Promise<void> {
  // <!-- req datamodelpersistence:c5a5fe49.2943 -->
  if (started) return Promise.resolve();
  // <!-- req datamodelpersistence:c5a5fe49.180a -->
  started = true;
  return (async () => {
    // <!-- req datamodelpersistence:c5a5fe49.3fa3 -->
    // <!-- req datamodelpersistence:c5a5fe49.ebd1 -->
    // <!-- req datamodelpersistence:c5a5fe49.55e5 -->
    if (!(await window.riffLineApi.appConfig.claimStartupCleanup())) return;
    // <!-- req datamodelpersistence:451906e2.23d8 -->
    const preMigrationRoot = await window.riffLineApi.appConfig.getPreMigrationRoot();
    const active = new IpcFileSystemAdapter(activeRoot);
    await runStartupCleanup({
      trash: new TrashService(active, new SongIndexService(active), undefined, undefined, deleteWindowBoundsOf),
      preMigration: new PreMigrationService(new IpcFileSystemAdapter(preMigrationRoot)),
      retentionDays,
      report: (code, context) => notificationCenter.report(code, context),
    });
  })().catch((error: unknown) => {
    console.warn('[startupCleanup] 起動のときの片付けに失敗（次の起動で再試行）:', error);
  });
}
