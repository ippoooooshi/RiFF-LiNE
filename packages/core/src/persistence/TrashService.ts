/**
 * ゴミ箱（data-model-persistence.md 17 節、基本設計 06 章 7 節）。
 *
 * 「すぐに消す」ではなく「`trash/` へ移す＋保持期間を過ぎたら起動のときに消す＋戻す道」。
 * `trash-index.json` は `index.json` と同じく `TabApp/` の直下に置く（13.1 節、B29）。壊れていれば `trash/` を見て作り直す。
 * <!-- req datamodelpersistence:790be758.be74 -->
 * 曲のファイルは `trash/{id}.tabapp` にサブフォルダを作らずに置き、元のサブフォルダは `trash-index.json` の `folder` に書く。
 * <!-- req datamodelpersistence:ab55b1a1.c779 -->
 * ゴミ箱へ入れてもサムネイルの写し `thumbnails/{songId}.png` は残し、完全に消すときに消す（9.1 節）。
 */

import type { FileSystemAdapter } from '../platform';

import {
  DEFAULT_TRASH_RETENTION_DAYS,
  SONGS_DIR,
  TRASH_DIR,
  TRASH_EXPIRY_WARNING_DAYS,
  TRASH_INDEX_FILE,
} from './constants';
import { decodeText, isFileNotFound, writeJsonFile } from './jsonIo';
import { warnProvisional } from './log';
import type { PreMigrationService } from './PreMigrationService';
import { songFilePath, songFolderPath, songIdFromFileName, thumbnailFilePath, trashFilePath } from './paths';
import type { SongIndexService } from './SongIndexService';
import { toSongSummary, writeThumbnailCopy, type SongFileForSummary } from './SongIndexService';

const MS_PER_DAY = 86_400_000;

/** `trash-index.json` の 1 件（data-model-persistence.md 17 節）。 */
// <!-- req datamodelpersistence:18f0481c.412d -->
export interface TrashEntry {
  // <!-- req datamodelpersistence:ba5d9ecc.a72c -->
  songId: string;
  /** ゴミ箱に入れた日時（ISO 8601）。5 節の trashedAt はこの値。 */
  // <!-- req datamodelpersistence:15d25b97.c58d -->
  // <!-- req datamodelpersistence:2414202a.5e56 -->
  deletedAt: string;
  // <!-- req datamodelpersistence:15d25b97.37d0 -->
  /** 元のサブフォルダ（SongSummary.folder と同じ形。songs/ の直下なら空の文字列）。 */
  // <!-- req datamodelpersistence:b7571df2.f1f7 -->
  // <!-- req datamodelpersistence:1036e8d0.6c12 -->
  folder: string;
}

/**
 * 完全に消すまでの残りの長さ（ミリ秒）。完全に消す時刻は「削除日時 ＋ 保持期間の日数 × 24 時間」で、
 * そこから今を引く（data-model-persistence.md 17 節の (b)。日付の変わり目やタイムゾーンで揺れないため）。
 * 削除日時が読めなければ NaN（消さず、知らせない）。
 */
// <!-- req datamodelpersistence:c7602c46.c99e -->
export function trashRemainingMs(entry: Pick<TrashEntry, 'deletedAt'>, retentionDays: number, nowMs: number): number {
  // <!-- req datamodelpersistence:bbaadc07.d815 -->
  // <!-- req datamodelpersistence:bbaadc07.193a -->
  return Date.parse(entry.deletedAt) + retentionDays * MS_PER_DAY - nowMs;
}

/**
 * ゴミ箱ダイアログの各行に出す残りの日数（screens-navigation.md 12.8 節）。残りの長さを 24 時間で割って切り上げた数
 * （data-model-persistence.md 17 節の (b)）。
 */
export function trashRemainingDays(entry: Pick<TrashEntry, 'deletedAt'>, retentionDays: number, nowMs: number): number {
  // <!-- req datamodelpersistence:bbaadc07.52f2 -->
  return Math.ceil(trashRemainingMs(entry, retentionDays, nowMs) / MS_PER_DAY);
}

// <!-- req datamodelpersistence:58680ff3.89bf -->
export class TrashService {
  /**
   * @param adapter 主ストレージのアダプタ。
   * @param indexService `index.json` の直し（ゴミ箱へ入れたら外し、戻したら足す。9.1 節）と、`songs/` に同じ id の曲があるかの確かめ。
   * @param now テスト用の時刻ソース（既定 Date.now）。
   * @param newId 新しい id の作り方（既定 crypto.randomUUID、5 節と同じ作り方）。
   * @param onPermanentlyDeleted 完全に消した曲の id の知らせ（data-model-persistence.md 17 節の (b)、honnin-queue 216 番）。
   *   `permanentlyDelete` と `purgeExpired` で 1 曲を完全に消すたびに呼ぶ。同じ id の曲が `songs/` にあって
   *   13.2 節の `window-bounds.json` の 1 件を消さないときは呼ばない。受けたレンダラーが `appconfig:deleteWindowBounds`（10.1 節）を呼ぶ。
   */
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly indexService: SongIndexService,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => crypto.randomUUID(),
    // <!-- req datamodelpersistence:1e90db94.b154 -->
    private readonly onPermanentlyDeleted?: (songId: string) => void,
  ) {}

  /**
   * 曲をゴミ箱へ入れる（data-model-persistence.md 17 節）。`songs/{サブフォルダ/}{id}.tabapp` を `trash/{id}.tabapp` へ
   * 改名 1 回で移し（10.1 節）、`trash-index.json` に削除日時と元のサブフォルダを書いてから、`index.json` からその曲を外す。
   * ゴミ箱に同じ id の曲がもう在るとき（19 節の取り込みで並んだとき）は、入れる曲に新しい id を付けて移す（ゴミ箱の曲を上書きで消さないため）。
   */
  // <!-- req datamodelpersistence:7e2bf72f.2b69 -->
  // <!-- req datamodelpersistence:f3c02b80.99b4 -->
  async moveToTrash(songId: string): Promise<void> {
    const folder = (await this.indexService.find(songId))?.folder ?? '';
    await this.adapter.ensureDirectory(TRASH_DIR);
    const entries = await this.loadIndex();
    const taken = entries.some((e) => e.songId === songId) || (await this.adapter.exists(trashFilePath(songId)));
    const trashId = taken ? this.newId() : songId;
    // <!-- req datamodelpersistence:feeb91c5.1233 -->
    // <!-- req datamodelpersistence:77532627.6a3a -->
    await this.adapter.renameFile(songFilePath(songId, folder), trashFilePath(trashId));
    if (trashId !== songId) await this.copyThumbnailIfExists(songId, trashId);

    const next = entries.filter((e) => e.songId !== trashId);
    // <!-- req datamodelpersistence:8188d376.d28c -->
    // <!-- req datamodelpersistence:790be758.8e9e -->
    // <!-- req datamodelpersistence:77532627.f140 -->
    // <!-- req datamodelpersistence:77532627.81b8 -->
    // <!-- req datamodelpersistence:c7602c46.cc2c -->
    next.push({ songId: trashId, deletedAt: new Date(this.now()).toISOString(), folder });
    await this.saveIndex(next);

    // <!-- req datamodelpersistence:8af93d68.51b7 -->
    // <!-- req datamodelpersistence:77532627.a13e -->
    await this.indexService.remove(songId);
  }

  /**
   * ゴミ箱から戻す（data-model-persistence.md 17 節）。`trash/` から `songs/` の元のサブフォルダへ戻し、元のサブフォルダが
   * 無くなっていれば `songs/` の直下へ戻す。`index.json` も直す。
   * `songs/` に同じ id の曲が既にあるとき（19 節の取り込み）は、戻す曲に新しい id を付けて戻す（どちらの曲も消さずに残すため）。
   * そのときサムネイルの写しは `songs/` の曲のものなので、戻す曲の写しを新しい id で曲のファイルから作る。
   */
  // <!-- req datamodelpersistence:6bacc3ed.2f8f -->
  // <!-- req datamodelpersistence:d864d63d.d6c6 -->
  // <!-- req datamodelpersistence:ac8fe057.d971 -->
  async restore(songId: string): Promise<void> {
    const entries = await this.loadIndex();
    const folder = await this.restorableFolder(entries.find((e) => e.songId === songId)?.folder ?? '');
    const clash = (await this.indexService.find(songId)) !== undefined;
    // <!-- req datamodelpersistence:5174cdbc.f4b3 -->
    // <!-- req datamodelpersistence:efc112d7.1d93 -->
    const targetId = clash ? this.newId() : songId;
    // <!-- req datamodelpersistence:5174cdbc.91b7 -->
    const target = songFilePath(targetId, folder);

    await this.adapter.ensureDirectory(SONGS_DIR);
    await this.adapter.renameFile(trashFilePath(songId), target);
    await this.saveIndex(entries.filter((e) => e.songId !== songId));

    // 戻した曲のファイルを読んで index.json に足す。読めなくても、起動のときの作り直し（9.1 節）で戻る。
    let fileJson: SongFileForSummary;
    try {
      fileJson = JSON.parse(decodeText(await this.adapter.readFile(target))) as SongFileForSummary;
      // <!-- req datamodelpersistence:688b1f5f.0b3c -->
      // <!-- req datamodelpersistence:5174cdbc.7fbc -->
      await this.indexService.upsert(toSongSummary({ ...fileJson, id: targetId }, folder));
    } catch (error) {
      warnProvisional(`戻した曲の index への反映に失敗（起動のときの作り直しで戻る）: ${targetId}`, {
        error: String(error),
      });
      return;
    }
    const thumbnail = fileJson.appMeta?.thumbnail;
    if (targetId === songId || thumbnail == null) return;
    try {
      await writeThumbnailCopy(this.adapter, targetId, thumbnail.data);
    } catch (error) {
      // 写しが無くても、曲一覧は曲のファイルの appMeta.thumbnail から作り直せる（SongIndexService.rebuildThumbnailCopy）。
      warnProvisional(`戻した曲のサムネイルの写しの書き込みに失敗: ${targetId}`, { error: String(error) });
    }
  }

  /** 保持期間を過ぎた曲を消し、消した数を返す（data-model-persistence.md 17 節。アプリの起動のときに 1 回呼ぶ）。 */
  // <!-- req datamodelpersistence:a1b477f0.5f22 -->
  // <!-- req datamodelpersistence:c7602c46.0251 -->
  async purgeExpired(retentionDays: number = DEFAULT_TRASH_RETENTION_DAYS): Promise<number> {
    const entries = await this.loadIndex();
    const nowMs = this.now();
    // 残りが 0 以下で消す。保持期間を短く変えたときも、渡された新しい日数で数える（17 節の (b)）。
    // <!-- req datamodelpersistence:8188d376.7fbc -->
    // <!-- req datamodelpersistence:bbaadc07.7cdf -->
    const expired = entries.filter((e) => trashRemainingMs(e, retentionDays, nowMs) <= 0);
    if (expired.length === 0) return 0;

    const inSongs = await this.songIdsInSongs();
    // <!-- req datamodelpersistence:1e90db94.e1b4 -->
    for (const entry of expired) await this.deleteTrashedFiles(entry.songId, inSongs);
    await this.saveIndex(entries.filter((e) => !expired.includes(e)));
    return expired.length;
  }

  /**
   * ゴミ箱の画面からすぐに完全に消す（data-model-persistence.md 17 節）。曲のファイルと `trash-index.json` の 1 件と
   * サムネイルの写しを消す。同じ id の曲が `songs/` にあるときは、写しは `songs/` の曲のものなので消さない（19 節）。
   */
  // <!-- req datamodelpersistence:5f4edb28.a289 -->
  // <!-- req datamodelpersistence:1e90db94.4342 -->
  async permanentlyDelete(songId: string): Promise<void> {
    const entries = await this.loadIndex();
    // <!-- req datamodelpersistence:1e90db94.abfd -->
    await this.deleteTrashedFiles(songId, await this.songIdsInSongs());
    // <!-- req datamodelpersistence:1e90db94.b60a -->
    // <!-- req datamodelpersistence:c5fc4753.e275 -->
    await this.saveIndex(entries.filter((e) => e.songId !== songId));
  }

  /** 完全に消すまでの残りが thresholdDays 日（× 24 時間）以下の曲の id を返す（data-model-persistence.md 17 節、`FILE-007`）。 */
  // <!-- req datamodelpersistence:67901c8d.0314 -->
  // <!-- req datamodelpersistence:1036e8d0.01d0 -->
  async findExpiringSoon(retentionDays: number, thresholdDays: number): Promise<string[]> {
    const nowMs = this.now();
    const thresholdMs = thresholdDays * MS_PER_DAY;
    // <!-- req datamodelpersistence:bbaadc07.d544 -->
    return (await this.loadIndex())
      .filter((e) => trashRemainingMs(e, retentionDays, nowMs) <= thresholdMs)
      .map((e) => e.songId);
  }

  // <!-- req datamodelpersistence:c5fc4753.0e5e -->
  /** ゴミ箱の曲の一覧（`trash-index.json` の中身）。ここに在る曲が 5 節の isTrashed の真の曲。 */
  // <!-- req datamodelpersistence:1e7178e5.6427 -->
  async listTrashed(): Promise<TrashEntry[]> {
    return this.loadIndex();
  }

  // ===== 内部 =====

  /** 元のサブフォルダがまだ在ればそれを、無くなっていれば `songs/` の直下（空の文字列）を返す。 */
  private async restorableFolder(folder: string): Promise<string> {
    if (folder === '') return '';
    // <!-- req datamodelpersistence:5174cdbc.4990 -->
    return (await this.adapter.exists(songFolderPath(folder))) ? folder : '';
  }

  /** `songs/` に在る曲（`index.json`）の id。 */
  private async songIdsInSongs(): Promise<ReadonlySet<string>> {
    return new Set((await this.indexService.load()).map((s) => s.id));
  }

  // <!-- req datamodelpersistence:c5fc4753.e48d -->
  /**
   * `trash/{id}.tabapp` を消し、同じ id の曲が `songs/` に無ければサムネイルの写しも消して、完全に消した曲の id を知らせる
   * （17 節の (b)。`songs/` に同じ id の曲があるときは、写しも `window-bounds.json` の 1 件もその曲のものなので知らせない、19 節）。
   */
  private async deleteTrashedFiles(songId: string, inSongs: ReadonlySet<string>): Promise<void> {
    // <!-- req datamodelpersistence:1e90db94.6be5 -->
    await this.adapter.deleteFile(trashFilePath(songId));
    // <!-- req datamodelpersistence:ab55b1a1.0a62 -->
    // <!-- req datamodelpersistence:1e90db94.d4a2 -->
    // <!-- req datamodelpersistence:c5fc4753.9513 -->
    // <!-- req datamodelpersistence:1e90db94.0a17 -->
    if (inSongs.has(songId)) return;
    await this.adapter.deleteFile(thumbnailFilePath(songId));
    // <!-- req datamodelpersistence:08b9ca6a.9c7a -->
    // <!-- req datamodelpersistence:1e90db94.bb65 -->
    this.onPermanentlyDeleted?.(songId);
  }

  /** サムネイルの写しが在れば、新しい id の名前で写す。 */
  private async copyThumbnailIfExists(fromId: string, toId: string): Promise<void> {
    if (await this.adapter.exists(thumbnailFilePath(fromId))) {
      await this.adapter.copyFile(thumbnailFilePath(fromId), thumbnailFilePath(toId));
    }
  }

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
      return parsed.flatMap(toTrashEntry);
    } catch (error) {
      warnProvisional('trash-index.json が破損しています。trash/ から再構築します。', { error: String(error) });
      return this.rebuildIndexFromTrashFolder();
    }
  }

  private async saveIndex(entries: TrashEntry[]): Promise<void> {
    await writeJsonFile(this.adapter, TRASH_INDEX_FILE, entries);
  }

  /** trash/ を走査して trash-index.json を作り直す。削除日時はファイルの更新時刻で代え、元のサブフォルダは分からないので直下とする。 */
  private async rebuildIndexFromTrashFolder(): Promise<TrashEntry[]> {
    let dir;
    try {
      // <!-- req datamodelpersistence:8188d376.45eb -->
      dir = await this.adapter.listDirectory(TRASH_DIR);
    } catch (error) {
      if (isFileNotFound(error)) return [];
      throw error;
    }
    const entries: TrashEntry[] = [];
    for (const item of dir) {
      const songId = item.isDirectory ? null : songIdFromFileName(item.name);
      if (songId !== null) entries.push({ songId, deletedAt: item.modifiedAt, folder: '' });
    }
    return entries;
  }
}

/** `trash-index.json` の 1 件を読む。`folder` を持たない前の形の 1 件は `songs/` の直下とし、形の違う 1 件は捨てる。 */
function toTrashEntry(value: unknown): TrashEntry[] {
  if (typeof value !== 'object' || value === null) return [];
  const { songId, deletedAt, folder } = value as Record<string, unknown>;
  if (typeof songId !== 'string' || typeof deletedAt !== 'string') return [];
  return [{ songId, deletedAt, folder: typeof folder === 'string' ? folder : '' }];
}

/** 起動のときの片付けに要るもの（data-model-persistence.md 17 節・8 節）。 */
export interface StartupCleanupDeps {
  trash: Pick<TrashService, 'purgeExpired' | 'findExpiringSoon'>;
  /** ルートが `PreMigration/` のフォルダの変換する前の版（8 節）。 */
  preMigration: Pick<PreMigrationService, 'purgeExpired'>;
  /** `preferences.json` の `trashRetentionDays`（13.3 節）。 */
  retentionDays: number;
  /** 知らせを出す（`notificationCenter.report`）。 */
  report(code: string, context: Record<string, unknown>): void;
}

/**
 * アプリの起動のときに 1 回だけ呼ぶ片付け（data-model-persistence.md 17 節・8 節、honnin-queue 206 番）。
 * 保持期間を過ぎたゴミ箱の曲を消し（`purgeExpired`）、その後で残りが `TRASH_EXPIRY_WARNING_DAYS` 日以下の曲があれば
 * Warning の `FILE-007` を `{ count }` で出す。あわせて `PreMigration/` の 30 日を過ぎた版を消す。
 * 起動の処理の中で 1 回だけ呼ぶことで、知らせを起動ごとに 1 回までにする。どれが失敗しても起動を止めない（投げない）。
 */
export async function runStartupCleanup(deps: StartupCleanupDeps): Promise<void> {
  try {
    await deps.trash.purgeExpired(deps.retentionDays);
  } catch (error) {
    warnProvisional('起動のときのゴミ箱の期限切れの曲の削除に失敗（次の起動で再試行）', { error: String(error) });
  }
  try {
    // <!-- req datamodelpersistence:c5a5fe49.6ca6 -->
    const expiringSoon = await deps.trash.findExpiringSoon(deps.retentionDays, TRASH_EXPIRY_WARNING_DAYS);
    // <!-- req datamodelpersistence:c5a5fe49.8250 -->
    // <!-- req datamodelpersistence:c5a5fe49.7317 -->
    // <!-- req datamodelpersistence:c5a5fe49.dfd4 -->
    if (expiringSoon.length > 0) deps.report('FILE-007', { count: expiringSoon.length });
  } catch (error) {
    warnProvisional('起動のときのゴミ箱の期限の確かめに失敗', { error: String(error) });
  }
  try {
    // <!-- req datamodelpersistence:451906e2.8956 -->
    await deps.preMigration.purgeExpired();
  } catch (error) {
    warnProvisional('起動のときの PreMigration/ の古い版の削除に失敗（次の起動で再試行）', { error: String(error) });
  }
}
