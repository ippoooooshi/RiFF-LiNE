/**
 * 主ストレージ保存成功後の非同期ミラーコピー（06_file_io_persistence.md §4.1、data-model-persistence.md §3.2・§9.6）。
 *
 * `syncAfterSave` は fire-and-forget（戻り値を待たせない）。失敗は Warning（FILE-005）としてログのみ。
 * `awaitPending` はウィンドウクローズ・アプリ終了処理から呼び、進行中コピーの完了をタイムアウト付きで待つ（B26）。
 * どちらも例外を外部に投げない（設計上の強制：ミラー失敗が主保存を巻き込まない）。
 */

import type { FileSystemAdapter, FileSystemAdapterFactory } from '@riff-line/shared-types';

import { notificationCenter } from '../errors';

import { MIRROR_AWAIT_PENDING_TIMEOUT_MS, SONGS_DIR } from './constants';
import { warnProvisional } from './log';
import { songFilePath } from './paths';

export class MirrorSyncService {
  /** 進行中のミラーコピー。awaitPending がこれを待つ。 */
  private readonly pending = new Set<Promise<void>>();

  /**
   * @param sourceAdapter アクティブストレージ用アダプタ（コピー元 `songs/{id}.tabapp` を読む）。
   * @param adapterFactory 各ミラー先ルートのアダプタを生成する。
   */
  constructor(
    private readonly sourceAdapter: FileSystemAdapter,
    private readonly adapterFactory: FileSystemAdapterFactory,
  ) {}

  /**
   * 保存済みファイルを各ミラー先へコピーする。呼び出し元をブロックしない（戻り値なし）。
   * @param songId 対象曲。
   * @param mirrorRoots ミラー先ルートの絶対パス配列（`{...}/TabApp` まで含む）。
   */
  syncAfterSave(songId: string, mirrorRoots: string[]): void {
    if (mirrorRoots.length === 0) return;

    const task = this.copyToMirrors(songId, mirrorRoots).catch((error: unknown) => {
      // ここへは来ない想定（copyToMirrors 内で個別に捕捉）だが、契約として握り潰す。
      warnProvisional(`ミラー同期タスクで予期しない失敗: ${songId}`, { error: String(error) });
    });

    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  /**
   * 進行中の全ミラーコピーが完了、またはタイムアウトするまで待つ。
   * タイムアウトしても例外は投げず、単に打ち切って復帰する（終了処理を無期限に止めない）。
   */
  async awaitPending(timeoutMs: number = MIRROR_AWAIT_PENDING_TIMEOUT_MS): Promise<void> {
    if (this.pending.size === 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const result = await Promise.race([Promise.allSettled([...this.pending]).then(() => 'done' as const), timeout]);
    if (timer) clearTimeout(timer);

    if (result === 'timeout') {
      warnProvisional('ミラー同期の完了待ちがタイムアウトしました（終了は継続）。', {
        pending: this.pending.size,
        timeoutMs,
      });
    }
  }

  /** 1 曲を全ミラー先へコピーする。ミラー先ごとに失敗を個別捕捉する。 */
  private async copyToMirrors(songId: string, mirrorRoots: string[]): Promise<void> {
    let data: Uint8Array;
    try {
      data = await this.sourceAdapter.readFile(songFilePath(songId));
    } catch (error) {
      // コピー元が読めなければどのミラー先へも書けない。ユーザーから見れば「ミラーされなかった」ため FILE-005。
      notificationCenter.report('FILE-005', { songId, reason: 'source-read-failed', error: String(error) });
      return;
    }

    await Promise.all(
      mirrorRoots.map(async (root) => {
        try {
          const mirror = this.adapterFactory.createForRoot(root);
          await mirror.ensureDirectory(SONGS_DIR);
          await mirror.writeFile(songFilePath(songId), data);
        } catch (error) {
          // FILE-005（Warning）：ミラー書き込み失敗。主保存は既に完了しているため保険が欠けるだけ
          // （error-logging-foundation.md §9.2）。
          notificationCenter.report('FILE-005', { songId, mirrorRoot: root, error: String(error) });
        }
      }),
    );
  }
}
