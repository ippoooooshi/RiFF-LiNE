/**
 * 保存直前の 1 世代分を端末ローカルに退避する安全ネット（data-model-persistence.md §3.2・§9.5、B25）。
 *
 * ユーザー向けの世代管理バックアップ機能ではなく、`SongRepository.save()` から書き込み直前にのみ
 * 呼ばれる非公開の補助機構。退避先は主ストレージ・ミラー先とは別の、OS 標準のアプリローカル領域
 * （Electron では `app.getPath('userData')/LocalBackup`）で、複数端末間の同期スコープには含めない。
 * FILE-002（整合性エラー）のリカバリダイアログから `restore()` が使われる。
 */

import type { FileSystemAdapter } from '@riff-line/shared-types';

import { SongDocument } from '../domain/SongDocument';

import { decodeText, isFileNotFound } from './jsonIo';
import { warnProvisional } from './log';
import type { SchemaMigrator } from './SchemaMigrator';
import { SONG_FILE_EXT } from './constants';
import { songFilePath } from './paths';

export class LocalBackupService {
  /**
   * @param sourceAdapter アクティブストレージ用アダプタ（退避元 `songs/{id}.tabapp` を読む）。
   * @param backupAdapter 端末ローカル専用領域のアダプタ（退避先 `{id}.tabapp` を書く）。
   * @param migrator restore() で旧バージョンのバックアップを開くためのマイグレータ。
   */
  constructor(
    private readonly sourceAdapter: FileSystemAdapter,
    private readonly backupAdapter: FileSystemAdapter,
    private readonly migrator: SchemaMigrator,
  ) {}

  /** 退避先のルート相対パス（フラット配置）。 */
  private backupPath(songId: string): string {
    return `${songId}${SONG_FILE_EXT}`;
  }

  /**
   * 現行の曲ファイルを 1 世代だけ複製する（保存の直前に呼ぶ）。
   * - 複製元が無い（初回保存）場合は何もしない。
   * - 複製先への書き込みに失敗しても例外を投げない（バックアップの失敗で主保存を止めない、§3.2）。
   */
  async rotate(songId: string): Promise<void> {
    let current: Uint8Array;
    try {
      current = await this.sourceAdapter.readFile(songFilePath(songId));
    } catch (error) {
      if (isFileNotFound(error)) return; // 初回保存。
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
   * 退避先から SongDocument を復元する。退避が無ければ null。
   * id はファイル名（引数 songId）を最終的な真実とする。
   */
  async restore(songId: string): Promise<SongDocument | null> {
    let bytes: Uint8Array;
    try {
      bytes = await this.backupAdapter.readFile(this.backupPath(songId));
    } catch (error) {
      if (isFileNotFound(error)) return null;
      throw error;
    }
    const json = JSON.parse(decodeText(bytes)) as unknown;
    const migrated = this.migrator.migrate(json);
    const doc = SongDocument.fromFileJson(migrated);
    doc.id = songId;
    return doc;
  }
}
