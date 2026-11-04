/**
 * 曲のファイルを新しい版へ変換する前の版を残す（data-model-persistence.md 8 節、13.2 節の `PreMigration/`）。
 *
 * 変換の不具合で曲を失わないように、変換の前に、読んだ曲のファイルを中身を変えずに
 * `PreMigration/{songId}.{変換する前の schemaVersion}.tabapp` へ写す。置き場所はその PC のアプリの領域で、
 * `LocalBackup/` と並ぶフォルダ（Electron では `app.getPath('userData')/PreMigration`）。
 * `LocalBackup/` は保存の直前に 1 世代だけを入れ替える（`LocalBackupService.rotate`）ので、同じフォルダに置くと
 * 変換した曲を保存したときに変換前の版が消えうるため、別のフォルダにする。
 * 残した版は、残してから 30 日を過ぎたものを、アプリを起動したときに消す（`purgeExpired`。ゴミ箱の期限を過ぎた曲を
 * 起動のときに消すのと同じ時機）。
 *
 * アダプタの受け方は `LocalBackupService` と同じで、ルートが `PreMigration/` のフォルダのアダプタを受ける。
 */

import type { FileSystemAdapter } from '../platform';

import { SONG_FILE_EXT } from './constants';
import { isFileNotFound } from './jsonIo';

/** ローカル既定パスの木で `LocalBackup/` と並ぶ、変換する前の版を置くフォルダの名前（data-model-persistence.md 13.2 節）。 */
// <!-- req datamodelpersistence:f9a03db9.9501 --> <!-- req datamodelpersistence:f9a03db9.cc35 --> <!-- req datamodelpersistence:bc3ae193.73dd -->
// <!-- req datamodelpersistence:abac385d.2598 --> <!-- req datamodelpersistence:abac385d.1b1e --> <!-- req datamodelpersistence:abac385d.5920 --> <!-- req datamodelpersistence:abac385d.e932 --> <!-- req datamodelpersistence:c8048d03.cc6b -->
export const PRE_MIGRATION_DIR = 'PreMigration'; // <!-- req datamodelpersistence:1b4c2b44.80f5 -->

/** 変換する前の版を残す日数（data-model-persistence.md 8 節：残してから 30 日で消す）。 */
// <!-- req datamodelpersistence:abac385d.b954 --> <!-- req datamodelpersistence:bc3ae193.c4fe -->
export const PRE_MIGRATION_RETENTION_DAYS = 30; // <!-- req datamodelpersistence:1b4c2b44.89e9 -->

const MS_PER_DAY = 86_400_000;

/** `PreMigration/` の中のファイルの名前：`{songId}.{変換する前の schemaVersion}.tabapp`（data-model-persistence.md 8 節）。 */
export function preMigrationFileName(songId: string, schemaVersion: string): string {
  // <!-- req datamodelpersistence:1b4c2b44.eb15 -->
  return `${songId}.${schemaVersion}${SONG_FILE_EXT}`; // <!-- req datamodelpersistence:1b4c2b44.9546 -->
}

export class PreMigrationService {
  // <!-- req datamodelpersistence:1b4c2b44.0d82 --> // <!-- req datamodelpersistence:1b4c2b44.1731 -->
  /**
   * @param adapter ルートが `PreMigration/` のフォルダのアダプタ（`LocalBackup/` と並ぶ、その PC のアプリの領域）。
   * @param now テスト用の時刻ソース（既定 Date.now）。
   */
  constructor(
    // <!-- req datamodelpersistence:1b4c2b44.bb01 -->
    private readonly adapter: FileSystemAdapter, // <!-- req datamodelpersistence:a187d247.af26 -->
    private readonly now: () => number = Date.now, // <!-- req datamodelpersistence:a187d247.29d1 --> // <!-- req datamodelpersistence:a187d247.6fc4 -->
  ) {}

  /**
   * 読んだ曲のファイルのバイトを、中身を変えずに `{songId}.{schemaVersion}.tabapp` へ写す（変換の前に呼ぶ）。
   * 書けなければ例外をそのまま投げる（残せないまま変換すると、次の自動保存で変換前の版が失われるため）。
   */
  // <!-- req datamodelpersistence:abac385d.aedf -->
  async preserve(songId: string, schemaVersion: string, bytes: Uint8Array): Promise<void> {
    // <!-- req datamodelpersistence:1b4c2b44.d83d -->
    await this.adapter.ensureDirectory('.');
    // <!-- req datamodelpersistence:c8048d03.358f -->
    await this.adapter.writeFile(preMigrationFileName(songId, schemaVersion), bytes); // <!-- req datamodelpersistence:1d3827c4.a066 --> // <!-- req datamodelpersistence:1d3827c4.8819 -->
  }

  /**
   * 残してから 30 日を過ぎた変換前の版を消す（アプリを起動したときに 1 回呼ぶ）。
   * 残した時刻は、写したときに書かれたファイルの更新時刻（`DirEntry.modifiedAt`）で見る。
   * @returns 消した数。フォルダがまだ無ければ 0。
   */
  // <!-- req datamodelpersistence:b4d2219b.427c --> <!-- req datamodelpersistence:35fabdec.f944 -->
  async purgeExpired(retentionDays: number = PRE_MIGRATION_RETENTION_DAYS): Promise<number> {
    // <!-- req datamodelpersistence:1b4c2b44.dd35 -->
    let entries;
    try {
      entries = await this.adapter.listDirectory('.');
    } catch (error) {
      if (isFileNotFound(error)) return 0; // <!-- req datamodelpersistence:4fb7cd78.b920 -->
      throw error;
    }
    const nowMs = this.now();
    let purged = 0;
    for (const entry of entries) {
      if (entry.isDirectory || !entry.name.endsWith(SONG_FILE_EXT)) continue;
      const ageDays = (nowMs - Date.parse(entry.modifiedAt)) / MS_PER_DAY;
      // <!-- req datamodelpersistence:b4d2219b.b849 -->
      if (Number.isFinite(ageDays) && ageDays >= retentionDays) {
        // <!-- req datamodelpersistence:4fb7cd78.d39d -->
        await this.adapter.deleteFile(entry.name);
        purged++;
      }
    }
    return purged; // <!-- req datamodelpersistence:4fb7cd78.e86f -->
  }
}
