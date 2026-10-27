/**
 * 起動のときの片付けのつなぎ（data-model-persistence.md 17 節・8 節、2026-10-27 本人決定、honnin-queue 206 番）。
 *
 * 曲一覧ウィンドウのレンダラーが起動した後に 1 回だけ、core の `runStartupCleanup` を呼ぶ：
 * 保持期間（`preferences.json` の `trashRetentionDays`、13.3 節）を過ぎたゴミ箱の曲を消し、残りが 3 日以下の曲があれば
 * Warning の `FILE-007` を出し、`PreMigration/`（場所は `appconfig:getPreMigrationRoot`、10.1 節）の 30 日を過ぎた版を消す。
 * 中身（何を消し、いつ知らせるか）は core に置き、ここはアダプタを組んで渡すだけにする。
 */

import { PreMigrationService, SongIndexService, TrashService, runStartupCleanup } from '@riff-line/core';
import { notificationCenter } from '@riff-line/core/errors';

import { IpcFileSystemAdapter } from './ipcFileSystem';

/** このレンダラーで片付けを始めたか。 */
let started = false;

/**
 * 起動のときの片付けを、このレンダラーで 1 回だけ走らせる（17 節の (b)「起動の処理の中で 1 回だけ呼ぶことで、起動ごとに 1 回までを守る」）。
 * 開発の起動の StrictMode は効果を 2 回呼ぶため、始めた印で 2 回目を止める。失敗しても起動を止めない（reject しない）。
 * @param activeRoot 主ストレージのルート（`appconfig:getActiveRoot`）。
 * @param retentionDays ゴミ箱の保持期間の日数（`preferences.json` の `trashRetentionDays`）。
 */
export function runStartupCleanupOnce(activeRoot: string, retentionDays: number): Promise<void> {
  if (started) return Promise.resolve();
  started = true;
  return (async () => {
    const preMigrationRoot = await window.riffLineApi.appConfig.getPreMigrationRoot();
    const active = new IpcFileSystemAdapter(activeRoot);
    await runStartupCleanup({
      trash: new TrashService(active, new SongIndexService(active)),
      preMigration: new PreMigrationService(new IpcFileSystemAdapter(preMigrationRoot)),
      retentionDays,
      report: (code, context) => notificationCenter.report(code, context),
    });
  })().catch((error: unknown) => {
    console.warn('[startupCleanup] 起動のときの片付けに失敗（次の起動で再試行）:', error);
  });
}
