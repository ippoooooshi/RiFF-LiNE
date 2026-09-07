/**
 * ゴミ箱操作（06_file_io_persistence.md §7、data-model-persistence.md §3.2・§4.4）。
 *
 * 「即時物理削除」ではなく「論理削除（trash/ へ移動）＋期限付き自動パージ＋復元導線」。
 * `trash-index.json` は `index.json` と対称で TabApp/ 直下に置く（B29）。破損時は trash/ 走査で再構築する。
 */

import type { FileSystemAdapter } from '@riff-line/shared-types';

import { DEFAULT_TRASH_RETENTION_DAYS, SONGS_DIR, TRASH_DIR, TRASH_INDEX_FILE } from './constants';
import { decodeText, isFileNotFound, writeJsonFile } from './jsonIo';
import { warnProvisional } from './log';
import { songFilePath, songIdFromFileName, trashFilePath } from './paths';
import type { SongIndexService } from './SongIndexService';
import { toSongSummary } from './SongIndexService';

const MS_PER_DAY = 86_400_000;

/** `trash-index.json` の 1 エントリ。 */
export interface TrashEntry {
  songId: string;
  /** ゴミ箱へ移動した時刻（ISO 8601）。 */
  deletedAt: string;
}

export class TrashService {
  /**
   * @param adapter アクティブストレージ用アダプタ。
   * @param indexService `index.json` の更新（ゴミ箱移動で除去、復元で再追加）。
   * @param now テスト用の時刻ソース（既定 Date.now）。
   */
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly indexService: SongIndexService,
    private readonly now: () => number = Date.now,
  ) {}

  /** 曲をゴミ箱へ移動する。 */
  async moveToTrash(songId: string): Promise<void> {
    await this.adapter.ensureDirectory(TRASH_DIR);
    await this.adapter.renameFile(songFilePath(songId), trashFilePath(songId));

    const entries = await this.loadIndex();
    const next = entries.filter((e) => e.songId !== songId);
    next.push({ songId, deletedAt: new Date(this.now()).toISOString() });
    await this.saveIndex(next);

    await this.indexService.remove(songId);
  }

  /** ゴミ箱から曲を復元する。 */
  async restore(songId: string): Promise<void> {
    await this.adapter.ensureDirectory(SONGS_DIR);
    await this.adapter.renameFile(trashFilePath(songId), songFilePath(songId));

    const entries = await this.loadIndex();
    await this.saveIndex(entries.filter((e) => e.songId !== songId));

    // 復元したファイルを読んで index.json へ再登録する。
    try {
      const bytes = await this.adapter.readFile(songFilePath(songId));
      const fileJson = JSON.parse(decodeText(bytes)) as Parameters<typeof toSongSummary>[0];
      await this.indexService.upsert(toSongSummary({ ...fileJson, id: songId }));
    } catch (error) {
      warnProvisional(`復元した曲の index 反映に失敗（起動時の再構築で回復可能）: ${songId}`, { error: String(error) });
    }
  }

  /**
   * 保持期間を過ぎたゴミ箱エントリを物理削除する（アプリ起動時に 1 回呼ぶ）。
   * @param retentionDays 保持日数（既定 30、B9）。
   * @returns 実際に削除した件数。
   */
  async purgeExpired(retentionDays: number = DEFAULT_TRASH_RETENTION_DAYS): Promise<number> {
    const entries = await this.loadIndex();
    const nowMs = this.now();

    const kept: TrashEntry[] = [];
    let purged = 0;
    for (const entry of entries) {
      const ageDays = (nowMs - Date.parse(entry.deletedAt)) / MS_PER_DAY;
      if (Number.isFinite(ageDays) && ageDays >= retentionDays) {
        await this.adapter.deleteFile(trashFilePath(entry.songId));
        purged++;
      } else {
        kept.push(entry);
      }
    }

    if (purged > 0) await this.saveIndex(kept);
    return purged;
  }

  /** ゴミ箱画面からの即時完全削除。 */
  async permanentlyDelete(songId: string): Promise<void> {
    await this.adapter.deleteFile(trashFilePath(songId));
    const entries = await this.loadIndex();
    await this.saveIndex(entries.filter((e) => e.songId !== songId));
  }

  // ===== 内部：trash-index.json =====

  private async loadIndex(): Promise<TrashEntry[]> {
    let bytes: Uint8Array;
    try {
      bytes = await this.adapter.readFile(TRASH_INDEX_FILE);
    } catch (error) {
      if (isFileNotFound(error)) return this.rebuildIndexFromTrashFolder();
      warnProvisional('trash-index.json の読み込みに失敗。trash/ から再構築します。', { error: String(error) });
      return this.rebuildIndexFromTrashFolder();
    }
    try {
      const parsed = JSON.parse(decodeText(bytes)) as unknown;
      if (!Array.isArray(parsed)) throw new Error('trash-index.json is not an array');
      return parsed as TrashEntry[];
    } catch (error) {
      warnProvisional('trash-index.json が破損しています。trash/ から再構築します。', { error: String(error) });
      return this.rebuildIndexFromTrashFolder();
    }
  }

  private async saveIndex(entries: TrashEntry[]): Promise<void> {
    await writeJsonFile(this.adapter, TRASH_INDEX_FILE, entries);
  }

  /** trash/ を走査して trash-index.json を再構築する。削除日時が不明なものはファイル更新時刻で代用する。 */
  private async rebuildIndexFromTrashFolder(): Promise<TrashEntry[]> {
    let dir;
    try {
      dir = await this.adapter.listDirectory(TRASH_DIR);
    } catch (error) {
      if (isFileNotFound(error)) return [];
      throw error;
    }
    const entries: TrashEntry[] = [];
    for (const item of dir) {
      const songId = item.isDirectory ? null : songIdFromFileName(item.name);
      if (songId !== null) entries.push({ songId, deletedAt: item.modifiedAt });
    }
    return entries;
  }
}
