/**
 * `songs/` の外にある `.tabapp` の取り込み（data-model-persistence.md 19 節、基本設計 06 章 11 節）。
 *
 * エクスプローラーでダブルクリックした曲のファイルが保存先の `songs/` の外にあるとき、曲一覧に出てこない曲を作らないように、
 * 曲のファイルとして読めるかを 8 節と 15 節の確かめで見てから `songs/` の直下へ写し、`index.json` に 1 件を足す。
 * 同じ id の曲が `songs/` に既にあるときは、選んでもらう関数（12.12 節のダイアログ。作るのは作業パッケージ 8）に聞き、
 * <!-- req datamodelpersistence:efc112d7.ddb5 -->
 * 「上書きする」「別の曲として取り込む」「やめる」の 3 つを受ける。ゴミ箱にだけあるときは聞かずに同じ id で取り込む。
 *
 * <!-- req datamodelpersistence:8db5ad15.0b88 -->
 * パスが `songs/` の中か外かの見分けと、取り込んだ曲を開く所（`WindowAdapter.focusExistingWindow`・`openEditWindow`）は呼ぶ側が受け持つ。
 */

import type { FileSystemAdapter } from '../platform';

import { SongDocument } from '../domain/SongDocument';
import type { SongSummary } from '../domain/types';
import { evaluateSongCount } from '../domain/validation';

import { SONGS_DIR } from './constants';
import { SongCountLimitError } from './errors';
import { encodeJson, writeFileAtomically } from './jsonIo';
import { warnProvisional } from './log';
import { songFilePath, songIdFromFileName, thumbnailFilePath } from './paths';
import type { SchemaMigrator } from './SchemaMigrator';
import { parseSongFileJson, verifySongFileChecksum } from './songFileCheck';
import type { SongIndexService } from './SongIndexService';
import { toSongSummary, writeThumbnailCopy } from './SongIndexService';
import { duplicateSongTitle } from './SongRepository';
import type { TrashService } from './TrashService';

/** 同じ id の曲が `songs/` にあるときの選択（data-model-persistence.md 19 節、2026-10-06 本人決定、honnin-queue 41 番）。 */
export type ImportConflictChoice = 'overwrite' | 'import-as-new' | 'cancel';

/** 選択を聞くときに渡す中身。ダイアログは両方の更新日時を並べて見せる（12.12 節）。 */
export interface ImportConflict {
  songId: string;
  /** いま `songs/` にある曲の名前と更新日時（`index.json` の値）。 */
  existingTitle: string;
  existingUpdatedAt: string;
  /** 取り込む曲の名前と更新日時（曲のファイルの `integrity.savedAtMonotonic` から作る、7 節）。 */
  incomingTitle: string;
  incomingUpdatedAt: string;
}

// <!-- req datamodelpersistence:8db5ad15.a346 -->
/** 取り込みの結果。`imported` の `songId` が開く曲。`cancelled` は「やめる」で、写さず開かない。 */
// <!-- req datamodelpersistence:6f77e86c.f7b9 -->
export type ImportResult = { kind: 'imported'; songId: string } | { kind: 'cancelled' };

/**
 * 「別の曲として取り込む」ときの名前（data-model-persistence.md 19 節）。同じ名前の曲が無ければそのまま、あれば 18 節の複製と同じ
 * 決まり（「<曲名> のコピー」と空いている数、honnin-queue 40 番）で重ならない名前にする。決まりは複製の関数 `duplicateSongTitle` 1 つに持つ。
 * @param title 取り込む曲の名前。
 * @param existingTitles `index.json` の `title` の全部（ゴミ箱の曲は数えない）。
 */
export function importedSongTitle(title: string, existingTitles: readonly string[]): string {
  // <!-- req datamodelpersistence:1865f720.2037 -->
  return existingTitles.includes(title) ? duplicateSongTitle(title, existingTitles) : title;
}

/** パスの最後の部分（ファイルの名前）。区切りは `/` と `\` のどちらも受ける。 */
function baseName(relativePath: string): string {
  return relativePath.slice(Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\')) + 1);
}

/** 取り込む曲の id。曲のファイルの `id`（5 節）を使い、無ければファイルの名前、それも使えなければ新しく作る。 */
function incomingSongId(parsed: unknown, fileName: string, newId: () => string): string {
  const id = (parsed as { id?: unknown }).id;
  if (typeof id === 'string' && id.length > 0 && !/[/\\]/.test(id)) return id;
  return songIdFromFileName(fileName) ?? newId();
}

export class SongImportService {
  /**
   * @param adapter 主ストレージのアダプタ（写す先の `songs/`）。
   * @param migrator 形と版の確かめ（8 節）。
   * @param indexService `index.json`（同じ id の曲があるか・1 件を足す、9.1 節）。
   * @param trash 上書きのときに、いまの曲をゴミ箱へ移す（17 節）。
   * @param newId 新しい id の作り方（既定 crypto.randomUUID、5 節と同じ作り方）。
   */
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly migrator: SchemaMigrator,
    private readonly indexService: SongIndexService,
    private readonly trash: Pick<TrashService, 'moveToTrash'>,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /**
   * `songs/` の外にある曲のファイルを取り込む（data-model-persistence.md 19 節）。
   * @param source 取り込むファイルのフォルダをルートとするアダプタと、その中の相対パス。
   * @param askConflict 同じ id の曲が `songs/` にあるときに選択を聞く関数（12.12 節のダイアログ）。
   * @throws CorruptSongFileError 壊れたファイル（`FILE-008` を出した後）。写さない。
   * @throws IntegrityCheckFailedError チェックサムが合わない（`FILE-002` を出した後）。写さない。
   * @throws UnsupportedSchemaVersionError 新しい版のファイル（`FILE-004` を出した後）。写さない。
   * <!-- req datamodelpersistence:8db5ad15.1fe0 -->
   * @throws SongCountLimitError 曲が 1 つ増えるのに上限（1000）に達している。写さない（呼ぶ側が `SONG-002` を出す）。
   */
  async importFile(
    source: { adapter: FileSystemAdapter; relativePath: string },
    askConflict: (conflict: ImportConflict) => Promise<ImportConflictChoice>,
  ): Promise<ImportResult> {
    const bytes = await source.adapter.readFile(source.relativePath);
    const fileName = baseName(source.relativePath);
    // 知らせの文脈にはファイルの名前だけを入れる（フルパスをログに残さない）
    const parsed = parseSongFileJson(bytes, fileName);
    const songId = incomingSongId(parsed, fileName, this.newId);
    // <!-- req datamodelpersistence:8db5ad15.1371 -->
    // 8 節と 15 節の確かめ：形（FILE-008）→ チェックサム（FILE-002）→ 版（FILE-004）。どれかで投げれば写さない
    // <!-- req datamodelpersistence:8db5ad15.af6b -->
    const schemaVersion = this.migrator.checkShape(parsed);
    verifySongFileChecksum(parsed as Parameters<typeof verifySongFileChecksum>[0], schemaVersion, songId);
    const migrated = { ...this.migrator.migrate(parsed), id: songId };
    const incoming = toSongSummary(migrated, '');

    const summaries = await this.indexService.load();
    // <!-- req datamodelpersistence:efc112d7.0edd -->
    const existing = summaries.find((s) => s.id === songId);
    if (existing === undefined) {
      // <!-- req datamodelpersistence:efc112d7.35ea -->
      // songs/ に無い（ゴミ箱にだけある曲も含む、honnin-queue 48 番の (2)）：聞かずに同じ id で取り込む
      this.assertCanAddSong(summaries.length);
      // <!-- req datamodelpersistence:efc112d7.5706 -->
      await this.writeSong(songId, bytes, migrated.appMeta.thumbnail, incoming);
      return { kind: 'imported', songId };
    }

    // <!-- req datamodelpersistence:cf94ee10.a685 -->
    const choice = await askConflict({
      songId,
      existingTitle: existing.title,
      existingUpdatedAt: existing.updatedAt,
      incomingTitle: incoming.title,
      incomingUpdatedAt: incoming.updatedAt,
    });
    // <!-- req datamodelpersistence:6f77e86c.0fc9 -->
    if (choice === 'cancel') return { kind: 'cancelled' };

    if (choice === 'overwrite') {
      // いまの曲は消さずにゴミ箱へ移してから、取り込む曲を同じ id で写す（曲の数は変わらない）
      // <!-- req datamodelpersistence:d864d63d.00bd -->
      await this.moveExistingToTrashWithNewId(existing);
      // <!-- req datamodelpersistence:d864d63d.3f05 -->
      await this.writeSong(songId, bytes, migrated.appMeta.thumbnail, incoming);
      return { kind: 'imported', songId };
    }

    // 別の曲として取り込む：新しい id を付け、同じ名前の曲があれば 18 節の決まりで重ならない名前にする
    this.assertCanAddSong(summaries.length);
    // <!-- req datamodelpersistence:1865f720.07ff -->
    const document = SongDocument.fromFileJson({ ...migrated, id: this.newId() });
    document.score.title = importedSongTitle(
      incoming.title,
      summaries.map((s) => s.title),
    );
    const fileJson = document.toFileJson();
    const summary = toSongSummary(fileJson, '');
    await this.writeSong(document.id, encodeJson(fileJson), fileJson.appMeta.thumbnail, summary);
    return { kind: 'imported', songId: document.id };
  }

  /** 曲が 1 つ増えるときの上限の確かめ（要件 5.3、19 節）。上限なら写さない。 */
  private assertCanAddSong(currentCount: number): void {
    // <!-- req datamodelpersistence:8db5ad15.848c -->
    if (evaluateSongCount(currentCount) === 'limit') throw new SongCountLimitError(currentCount);
  }

  /**
   * 上書きのとき、いまの曲に新しい id を付けてからゴミ箱へ移す（19 節の (b)：ゴミ箱と songs/ に同じ id が並ぶと、戻すときにぶつかるため）。
   * 曲のファイルを同じサブフォルダのまま新しい id の名前に改め、サムネイルの写しも新しい id の名前で残し（9.1 節）、
   * `index.json` を新しい id に直してから `TrashService.moveToTrash` に渡す。
   */
  private async moveExistingToTrashWithNewId(existing: SongSummary): Promise<void> {
    const renamedId = this.newId();
    // <!-- req datamodelpersistence:d864d63d.bdd1 -->
    await this.adapter.renameFile(songFilePath(existing.id, existing.folder), songFilePath(renamedId, existing.folder));
    const hasThumbnail = await this.adapter.exists(thumbnailFilePath(existing.id));
    if (hasThumbnail) await this.adapter.copyFile(thumbnailFilePath(existing.id), thumbnailFilePath(renamedId));
    await this.indexService.upsert({
      ...existing,
      id: renamedId,
      thumbnailRef: existing.thumbnailRef === null ? null : thumbnailFilePath(renamedId),
    });
    await this.indexService.remove(existing.id);
    await this.trash.moveToTrash(renamedId);
  }

  /** `songs/` の直下へ一時ファイルからの改名で書き（15 節）、サムネイルの写しを直し（9.1 節）、`index.json` に足す。 */
  private async writeSong(
    songId: string,
    bytes: Uint8Array,
    thumbnail: { data: string } | null,
    summary: SongSummary,
  ): Promise<void> {
    await this.adapter.ensureDirectory(SONGS_DIR);
    // <!-- req datamodelpersistence:8db5ad15.ab35 -->
    await writeFileAtomically(this.adapter, songFilePath(songId), bytes);
    try {
      if (thumbnail === null) {
        // 前の曲の写しが残っていれば、取り込んだ曲のものではないので消す
        await this.adapter.deleteFile(thumbnailFilePath(songId));
      } else {
        await writeThumbnailCopy(this.adapter, songId, thumbnail.data);
      }
    } catch (error) {
      // 写しが無くても、曲一覧は曲のファイルの appMeta.thumbnail から作り直せる（SongIndexService.rebuildThumbnailCopy）。
      warnProvisional(`取り込んだ曲のサムネイルの写しを直せませんでした（取り込みは継続）: ${songId}`, {
        error: String(error),
      });
    }
    // <!-- req datamodelpersistence:8db5ad15.6d83 -->
    // <!-- req datamodelpersistence:c5fc4753.bb16 -->
    await this.indexService.upsert(summary);
  }
}
