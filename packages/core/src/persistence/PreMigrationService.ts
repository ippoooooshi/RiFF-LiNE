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
// <!-- req datamodelpersistence:95c36c45.2598 --> <!-- req datamodelpersistence:95c36c45.1b1e --> <!-- req datamodelpersistence:95c36c45.5920 --> <!-- req datamodelpersistence:95c36c45.e932 --> <!-- req datamodelpersistence:c8048d03.cc6b -->
export const PRE_MIGRATION_DIR = 'PreMigration';

/** 変換する前の版を残す日数（data-model-persistence.md 8 節：残してから 30 日で消す）。 */
// <!-- req datamodelpersistence:95c36c45.b954 --> <!-- req datamodelpersistence:bc3ae193.c4fe -->
export const PRE_MIGRATION_RETENTION_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** `PreMigration/` の中のファイルの名前：`{songId}.{変換する前の schemaVersion}.tabapp`（data-model-persistence.md 8 節）。 */
export function preMigrationFileName(songId: string, schemaVersion: string): string {
  return `${songId}.${schemaVersion}${SONG_FILE_EXT}`;
}

export class PreMigrationService {
  /**
   * @param adapter ルートが `PreMigration/` のフォルダのアダプタ（`LocalBackup/` と並ぶ、その PC のアプリの領域）。
   * @param now テスト用の時刻ソース（既定 Date.now）。
   */
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * 読んだ曲のファイルのバイトを、中身を変えずに `{songId}.{schemaVersion}.tabapp` へ写す（変換の前に呼ぶ）。
   * 書けなければ例外をそのまま投げる（残せないまま変換すると、次の自動保存で変換前の版が失われるため）。
   */
  // <!-- req datamodelpersistence:95c36c45.aedf -->
  async preserve(songId: string, schemaVersion: string, bytes: Uint8Array): Promise<void> {
    await this.adapter.ensureDirectory('.');
    // <!-- req datamodelpersistence:c8048d03.358f -->
    await this.adapter.writeFile(preMigrationFileName(songId, schemaVersion), bytes);
  }

  /**
   * 残してから 30 日を過ぎた変換前の版を消す（アプリを起動したときに 1 回呼ぶ）。
   * 残した時刻は、写したときに書かれたファイルの更新時刻（`DirEntry.modifiedAt`）で見る。
   * @returns 消した数。フォルダがまだ無ければ 0。
   */
  // <!-- req datamodelpersistence:b4d2219b.427c --> <!-- req datamodelpersistence:35fabdec.f944 -->
  async purgeExpired(retentionDays: number = PRE_MIGRATION_RETENTION_DAYS): Promise<number> {
    let entries;
    try {
      entries = await this.adapter.listDirectory('.');
    } catch (error) {
      if (isFileNotFound(error)) return 0;
      throw error;
    }
    const nowMs = this.now();
    let purged = 0;
    for (const entry of entries) {
      if (entry.isDirectory || !entry.name.endsWith(SONG_FILE_EXT)) continue;
      const ageDays = (nowMs - Date.parse(entry.modifiedAt)) / MS_PER_DAY;
      // <!-- req datamodelpersistence:b4d2219b.b849 -->
      if (Number.isFinite(ageDays) && ageDays >= retentionDays) {
        await this.adapter.deleteFile(entry.name);
        purged++;
      }
    }
    return purged;
  }
}
