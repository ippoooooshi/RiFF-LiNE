/**
 * 1 曲の読み込み・保存を担うアプリケーションサービス（data-model-persistence.md §3.2・§4.1〜§4.3）。
 *
 * SchemaMigrator・ChecksumUtil・FileSystemAdapter・SongIndexService・LocalBackupService を協調させる。
 * ミラー同期の起動は AutoSaveScheduler の責務（シーケンス §4.3）。
 */

import type { FileSystemAdapter } from '@riff-line/shared-types';

import { SongDocument, createEmptyAppMetadata } from '../domain/SongDocument';
import { createInitialScore } from '../domain/newSong';
import type { NewSongSetup } from '../domain/types';
import { notificationCenter } from '../errors';

import { ChecksumUtil } from './ChecksumUtil';
import { SONGS_DIR } from './constants';
import { IntegrityCheckFailedError, SongNotFoundError } from './errors';
import { decodeText, encodeJson, isFileNotFound } from './jsonIo';
import { warnProvisional } from './log';
import type { SchemaMigrator } from './SchemaMigrator';
import type { SongIndexService } from './SongIndexService';
import { toSongSummary } from './SongIndexService';
import type { LocalBackupService } from './LocalBackupService';
import { songFilePath, songTmpFilePath } from './paths';

export class SongRepository {
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly migrator: SchemaMigrator,
    private readonly indexService: SongIndexService,
    private readonly localBackup: LocalBackupService,
  ) {}

  /**
   * 曲を読み込む。
   * @throws SongNotFoundError ファイルが存在しない。
   * @throws IntegrityCheckFailedError チェックサム不一致（Critical=FILE-002、呼び出し元へ伝播）。
   * @throws UnsupportedSchemaVersionError 未知のスキーマバージョン（Critical=FILE-004）。
   */
  async load(songId: string): Promise<SongDocument> {
    let bytes: Uint8Array;
    try {
      bytes = await this.adapter.readFile(songFilePath(songId));
    } catch (error) {
      if (isFileNotFound(error)) throw new SongNotFoundError(songId, { cause: error });
      throw error;
    }

    const raw = JSON.parse(decodeText(bytes)) as {
      schemaVersion?: string;
      song?: unknown;
      appMeta?: unknown;
      integrity?: { checksum?: string };
    };

    // マイグレーション前の生の内容でチェックサムを検証する（§4.2 の順序）。
    const stored = raw.integrity?.checksum ?? '';
    if (stored.startsWith('sha256:')) {
      const recomputed = ChecksumUtil.compute(
        raw.schemaVersion ?? '',
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

    const migrated = this.migrator.migrate(raw);
    const doc = SongDocument.fromFileJson(migrated);
    doc.id = songId; // ファイル名を id の最終的な真実とする。
    return doc;
  }

  /**
   * 曲をアトミックに保存する（§4.3）。
   * 手順：LocalBackupService.rotate → integrity 確定 → tmp へ書き込み → rename → index 更新。
   */
  async save(document: SongDocument): Promise<void> {
    // 現行スキーマバージョンへ揃える（マイグレーション後の初回保存で上書き、§4.2）。
    await this.adapter.ensureDirectory(SONGS_DIR);

    // 書き込み直前に旧本体を 1 世代退避する（B25）。失敗しても save は継続（rotate 側で握り潰す）。
    await this.localBackup.rotate(document.id);

    const fileJson = document.toFileJson();
    const bytes = encodeJson(fileJson);

    const tmp = songTmpFilePath(document.id);
    const final = songFilePath(document.id);
    await this.adapter.writeFile(tmp, bytes);
    await this.adapter.renameFile(tmp, final);

    await this.indexService.upsert(toSongSummary({ ...fileJson, id: document.id }));
  }

  /**
   * 新規曲を作成し、初回保存まで行って SongDocument を返す。
   * 初回保存しておくことで、以降の編集前にクラッシュ・再起動しても曲一覧に現れる。
   */
  async create(initialSetup: NewSongSetup): Promise<SongDocument> {
    const doc = new SongDocument({
      id: crypto.randomUUID(),
      score: createInitialScore(initialSetup),
      appMeta: createEmptyAppMetadata(),
    });
    await this.save(doc);
    return doc;
  }
}
