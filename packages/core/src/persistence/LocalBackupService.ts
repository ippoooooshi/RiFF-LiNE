/**
 * 保存の直前の 1 世代ぶんを端末のローカルに退かす安全網（data-model-persistence.md 20.1 節・15 節、B25）。
 *
 * 利用者が意識して使う世代のバックアップではなく、`SongRepository.save()` の中だけで使う、外に出さない作りの上の安全網。
 * 退かす先は主ストレージ・ミラー先とは別の、ローカル既定パスの `LocalBackup/`（Electron では `app.getPath('userData')/LocalBackup`）で、
 * 複数の PC の同期の対象に入れない（data-model-persistence.md 14.3 節）。
 * `restore()` は FILE-002（チェックサムが合わない）と FILE-008（壊れたファイル）のダイアログで「戻す」を選んだときに使う。
 */

import type { FileSystemAdapter } from '../platform';

import { SongDocument } from '../domain/SongDocument';

import { isFileNotFound } from './jsonIo';
import { warnProvisional } from './log';
import type { SchemaMigrator } from './SchemaMigrator';
import { parseSongFileJson } from './songFileCheck';
import type { SongIndexService } from './SongIndexService';
import { SONG_FILE_EXT } from './constants';
import { songFilePath } from './paths';

// <!-- req datamodelpersistence:ec1560b0.58e7 -->
// <!-- req datamodelpersistence:ec1560b0.3344 -->
export class LocalBackupService {
  /**
   * @param sourceAdapter 主ストレージのアダプタ（退かす元 `songs/{サブフォルダ/}{id}.tabapp` を読む）。
   * @param backupAdapter 端末のローカルだけの場所のアダプタ（退かす先 `{id}.tabapp` を書く）。
   * @param migrator restore() で古い版の写しを開くためのマイグレータ。
   * @param index 曲のサブフォルダ（`index.json` の `folder`、data-model-persistence.md 15 節の (b)）を引く索引。
   *   渡さなければ `songs/` の直下を見る。
   */
  constructor(
    private readonly sourceAdapter: FileSystemAdapter,
    private readonly backupAdapter: FileSystemAdapter,
    private readonly migrator: SchemaMigrator,
    private readonly index?: Pick<SongIndexService, 'find'>,
  ) {}

  /** 退かす先のルートからのパス（サブフォルダを作らずに平らに置く。id は曲ごとに違う）。 */
  private backupPath(songId: string): string {
    return `${songId}${SONG_FILE_EXT}`;
  }

  /**
   * 保存の直前に、今の本ファイルを 1 世代だけ退かす。本ファイルが無ければ何もしない。
   * 退かすのに失敗しても投げない（写しの失敗で保存の全体を失敗させない、data-model-persistence.md 20.1 節）。
   */
  async rotate(songId: string): Promise<void> {
    let current: Uint8Array;
    try {
      const folder = (await this.index?.find(songId))?.folder ?? '';
      current = await this.sourceAdapter.readFile(songFilePath(songId, folder));
    } catch (error) {
      if (isFileNotFound(error)) return; // 初めての保存。
      warnProvisional(`ローカルバックアップの複製元読み込みに失敗（スキップ）: ${songId}`, { error: String(error) });
      return;
    }
    try {
      await this.backupAdapter.ensureDirectory('.');
      await this.backupAdapter.writeFile(this.backupPath(songId), current);
    } catch (error) {
      warnProvisional(`ローカルバックアップの書き込みに失敗（保存は継続）: ${songId}`, { error: String(error) });
    }
  }

  /**
   * 退かした版を読んで返す。無ければ null（data-model-persistence.md 20.1 節）。
   * id はファイルの名前（引数の songId）を最後の正とする。
   * 退かした版が在るのに壊れているときは、曲を開くとき（8 節）と同じく `FILE-008` を出して `CorruptSongFileError` を投げる
   * （JSON の読み取りの `SyntaxError` をそのまま外へ出さない）。
   * @throws CorruptSongFileError 退かした版が JSON として読めない・形が壊れている（`FILE-008`）。
   * @throws UnsupportedSchemaVersionError 退かした版が今のアプリより新しい版（`FILE-004`）。
   */
  // <!-- req datamodelpersistence:237a4084.0137 -->
  async restore(songId: string): Promise<SongDocument | null> {
    let bytes: Uint8Array;
    try {
      bytes = await this.backupAdapter.readFile(this.backupPath(songId));
    } catch (error) {
      if (isFileNotFound(error)) return null;
      throw error;
    }
    const json = parseSongFileJson(bytes, songId);
    const migrated = this.migrator.migrate(json);
    // SongDocument.id は読み取り専用なので、ファイルの名前の id に替えて作る。
    return SongDocument.fromFileJson({ ...migrated, id: songId });
  }
}
