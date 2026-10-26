/**
 * 1 曲の読み込み・保存を担うアプリケーションサービス（data-model-persistence.md §3.2・§4.1〜§4.3）。
 *
 * SchemaMigrator・ChecksumUtil・FileSystemAdapter・SongIndexService・LocalBackupService を協調させる。
 * ミラー同期の起動は AutoSaveScheduler の責務（シーケンス §4.3）。
 */

import type { FileSystemAdapter } from '../platform';

import { SongDocument, createEmptyAppMetadata } from '../domain/SongDocument';
import { createInitialScore } from '../domain/newSong';
import type { NewSongSetup } from '../domain/types';
import { notificationCenter } from '../errors';

import { ChecksumUtil } from './ChecksumUtil';
import { CorruptSongFileError, IntegrityCheckFailedError, SongNotFoundError } from './errors';
import { decodeText, encodeJson, isFileNotFound } from './jsonIo';
import { warnProvisional } from './log';
import type { PreMigrationService } from './PreMigrationService';
import type { SchemaMigrator } from './SchemaMigrator';
import type { SongIndexService } from './SongIndexService';
import { summarizeSong, writeThumbnailCopy } from './SongIndexService';
import type { LocalBackupService } from './LocalBackupService';
import { songFilePath, songFolderPath, songTmpFilePath } from './paths';

export class SongRepository {
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly migrator: SchemaMigrator,
    private readonly indexService: SongIndexService,
    private readonly localBackup: LocalBackupService,
    /** 変換する前の版を残す先（data-model-persistence.md 8 節の `PreMigration/`）。渡さなければ写さない。 */
    private readonly preMigration?: PreMigrationService,
  ) {}

  /**
   * 曲を読み込む（data-model-persistence.md 8 節）。
   * 本ファイルを `index.json` の `folder`（data-model-persistence.md 9.2 節）から決めた場所で読み、形を確かめ、`integrity.checksum` を確かめてから版を移し、曲をメモリに広げる。
   * 今の版より古い曲は、変換の前に読んだバイトをそのまま `PreMigration/` へ写す（`preMigration` を渡したとき）。
   * 変換した曲は次の自動保存で今の版で上書きされる（`save` が `SongDocument.schemaVersion` を書く）。
   * @throws SongNotFoundError ファイルが存在しない。
   * @throws CorruptSongFileError 壊れたファイル（JSON として読めない・いちばん上がオブジェクトでない・
   *   `schemaVersion` が空でない文字列でない。Critical=FILE-008）。
   * @throws IntegrityCheckFailedError チェックサム不一致（Critical=FILE-002、呼び出し元へ伝播）。
   * @throws UnsupportedSchemaVersionError 今より新しい版（Critical=FILE-004）。
   */
  async load(songId: string): Promise<SongDocument> {
    // data-model-persistence.md 9.2 節：曲は songs/ の下のサブフォルダにも置かれるので、index.json の folder から場所を決める。
    // 索引に無い曲は save と同じく songs/ の直下を読む（無ければ SongNotFoundError）。
    const folder = (await this.indexService.find(songId))?.folder ?? '';
    let bytes: Uint8Array;
    try {
      bytes = await this.adapter.readFile(songFilePath(songId, folder));
    } catch (error) {
      if (isFileNotFound(error)) throw new SongNotFoundError(songId, { cause: error });
      throw error;
    }

    // data-model-persistence.md 8 節 (1)：JSON として読めなければ壊れたファイル（FILE-008）。FILE-004 は出さない
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeText(bytes));
    } catch (error) {
      notificationCenter.report('FILE-008', { songId, reason: 'invalid-json' });
      throw new CorruptSongFileError('invalid-json', { cause: error });
    }

    // data-model-persistence.md 8 節 (2)(3)：版を調べる前に形を確かめる（SchemaMigrator が受け持つ）
    const schemaVersion = this.migrator.checkShape(parsed);
    const raw = parsed as {
      song?: unknown;
      appMeta?: unknown;
      integrity?: { checksum?: string };
    };

    // マイグレーション前の生の内容でチェックサムを検証する（§4.2 の順序）。
    const stored = raw.integrity?.checksum ?? '';
    if (stored.startsWith('sha256:')) {
      const recomputed = ChecksumUtil.compute(
        schemaVersion,
        raw.song,
        (raw.appMeta ?? createEmptyAppMetadata()) as never,
      );
      if (recomputed !== stored) {
        // error-logging-foundation.md §9.2：Critical=FILE-002 を発行。文言の「復元しますか？」に
        // 対応する実手段は呼び出し元が LocalBackupService.restore(songId) で提供する（B25）。
        notificationCenter.report('FILE-002', { songId });
        throw new IntegrityCheckFailedError(songId);
      }
    } else {
      warnProvisional(`integrity.checksum が無い曲を読み込みました（検証スキップ）: ${songId}`);
    }

    // data-model-persistence.md 8 節：変換するときは、変換の前に読んだ曲のファイルを中身を変えずに PreMigration/ へ写す
    if (this.preMigration !== undefined && this.migrator.needsMigration(schemaVersion)) {
      await this.preMigration.preserve(songId, schemaVersion, bytes);
    }

    // data-model-persistence.md 8 節：変換を終えてから、曲をメモリ上に広げる
    const migrated = this.migrator.migrate(raw);
    // ファイル名を id の最終的な真実とする（SongDocument.id は読み取り専用なので、id を替えて作る）。
    return SongDocument.fromFileJson({ ...migrated, id: songId });
  }

  /**
   * 曲ごとの、前の保存で写しを書いたときの `appMeta.thumbnail.data`。変わったときだけ写しを書き直す（data-model-persistence.md 9.1 節）。
   * アプリを起動してから初めての保存では、前の値が無いので書く。
   */
  private readonly lastThumbnailData = new Map<string, string>();

  /**
   * 曲をアトミックに保存する（§4.3）。
   * 手順：LocalBackupService.rotate → integrity 確定 → tmp へ書き込み → rename → サムネイルの写し → index 更新。
   * 曲のファイルの場所は、id と `index.json` が持つ `songs/` からの相対フォルダで決まる（data-model-persistence.md 5 節）。
   * 索引に無い曲（新しい曲）は `songs/` の直下に置く。
   * 曲の編集による索引の直しは、曲のファイルを書いた後にここで `upsert` を呼ぶ 1 つの経路で行う（data-model-persistence.md 9.1 節）。
   */
  async save(document: SongDocument): Promise<void> {
    const folder = (await this.indexService.find(document.id))?.folder ?? '';
    // 現行スキーマバージョンへ揃える（マイグレーション後の初回保存で上書き、§4.2）。
    await this.adapter.ensureDirectory(songFolderPath(folder));

    // 書き込み直前に旧本体を 1 世代退避する（B25）。失敗しても save は継続（rotate 側で握り潰す）。
    await this.localBackup.rotate(document.id);

    const fileJson = document.toFileJson();
    // data-model-persistence.md 3 節：保存は自前の版つきの構造化 JSON（SongFileJson）をそのまま書き、保存のたびに alphaTex へ変換しない <!-- req datamodelpersistence:c5f62f5c.17eb --> <!-- req datamodelpersistence:da091b1d.3765 --> <!-- req datamodelpersistence:8145c582.b55f -->
    const bytes = encodeJson(fileJson);

    const tmp = songTmpFilePath(document.id, folder);
    const final = songFilePath(document.id, folder);
    await this.adapter.writeFile(tmp, bytes);
    await this.adapter.renameFile(tmp, final);

    // data-model-persistence.md 9.1 節：写しは曲のファイル（正）を書き終えた後に、その正の appMeta.thumbnail から作る。
    // appMeta.thumbnail が null なら写しを作らず、thumbnailRef も null にする（summarizeSong）。
    const thumbnail = fileJson.appMeta.thumbnail;
    if (thumbnail === null) {
      this.lastThumbnailData.delete(document.id);
    } else if (this.lastThumbnailData.get(document.id) !== thumbnail.data) {
      try {
        await writeThumbnailCopy(this.adapter, document.id, thumbnail.data);
        this.lastThumbnailData.set(document.id, thumbnail.data);
      } catch (error) {
        // 写しが無くても、曲一覧は曲のファイルの appMeta.thumbnail から作り直せる（SongIndexService.rebuildThumbnailCopy）。
        warnProvisional(`サムネイルの写しの書き込みに失敗（保存は継続）: ${document.id}`, { error: String(error) });
      }
    }

    await this.indexService.upsert(
      summarizeSong({
        id: document.id,
        createdAt: fileJson.createdAt,
        score: document.score,
        appMeta: fileJson.appMeta,
        savedAtMonotonic: fileJson.integrity.savedAtMonotonic,
        folder,
      }),
    );
  }

  /**
   * 新規曲を作成し、初回保存まで行って SongDocument を返す。
   * 初回保存しておくことで、以降の編集前にクラッシュ・再起動しても曲一覧に現れる。
   */
  async create(initialSetup: NewSongSetup): Promise<SongDocument> {
    const doc = new SongDocument({
      // data-model-persistence.md 5 節：id は版 4 の UUID を crypto.randomUUID() で作る <!-- req datamodelpersistence:fbd2e0bc.17cc -->
      id: crypto.randomUUID(),
      score: createInitialScore(initialSetup),
      appMeta: createEmptyAppMetadata(),
    });
    await this.save(doc);
    return doc;
  }
}
