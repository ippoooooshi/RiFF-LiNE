/**
 * 主ストレージの切替（移行）（06_file_io_persistence.md §2.2、data-model-persistence.md §3.2・§5）。
 *
 * 移行元・移行先それぞれのアダプタを FileSystemAdapterFactory で生成し、
 * `songs/`・`trash/`・各インデックス/設定ファイルを 1 件ずつ read → write → 照合の順でコピーする。
 * 1 件でも失敗すれば `success = false` とし、アクティブパスの切替は行わない（呼び出し元＝設定画面の責務）。
 * `logs/` は移行対象に含めない（C14）。
 */

import type { FileSystemAdapter, FileSystemAdapterFactory } from '@riff-line/shared-types';

import { MIGRATION_TARGET_FILES, SONGS_DIR, TRASH_DIR } from './constants';
import { isFileNotFound } from './jsonIo';

export interface MigrationFailure {
  path: string;
  error: string;
}

export interface MigrationResult {
  success: boolean;
  /** コピーに成功したファイル数。 */
  copied: number;
  /** コピー対象の総数。 */
  total: number;
  failures: MigrationFailure[];
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class StorageMigrationService {
  constructor(private readonly adapterFactory: FileSystemAdapterFactory) {}

  /**
   * @param fromRoot 移行元ルート（`{...}/TabApp` まで）。
   * @param toRoot 移行先ルート。
   * @param onProgress 進捗コールバック（done / total）。
   */
  async migrate(
    fromRoot: string,
    toRoot: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<MigrationResult> {
    const source = this.adapterFactory.createForRoot(fromRoot);
    const dest = this.adapterFactory.createForRoot(toRoot);

    // コピー対象の一覧を作る（songs/・trash/ 配下の実ファイル ＋ 直下のインデックス/設定ファイル）。
    const targets: string[] = [
      ...(await this.listFolderFiles(source, SONGS_DIR)),
      ...(await this.listFolderFiles(source, TRASH_DIR)),
      ...MIGRATION_TARGET_FILES,
    ];

    const failures: MigrationFailure[] = [];
    let copied = 0;
    let done = 0;

    for (const relativePath of targets) {
      try {
        await this.copyOne(source, dest, relativePath);
        copied++;
      } catch (error) {
        if (isFileNotFound(error)) {
          // 元に存在しない任意ファイル（ミラー未使用時の一部設定等）は対象外として黙認する。
        } else {
          failures.push({ path: relativePath, error: String(error) });
        }
      }
      onProgress?.(++done, targets.length);
    }

    return { success: failures.length === 0, copied, total: targets.length, failures };
  }

  /** フォルダ配下の実ファイルをルート相対パスで列挙する。フォルダ自体が無ければ空。 */
  private async listFolderFiles(adapter: FileSystemAdapter, dir: string): Promise<string[]> {
    try {
      const entries = await adapter.listDirectory(dir);
      return entries.filter((e) => !e.isDirectory).map((e) => `${dir}/${e.name}`);
    } catch (error) {
      if (isFileNotFound(error)) return [];
      throw error;
    }
  }

  /** 1 ファイルを read → ensureDirectory → write → 読み戻して照合。 */
  private async copyOne(source: FileSystemAdapter, dest: FileSystemAdapter, relativePath: string): Promise<void> {
    const data = await source.readFile(relativePath);

    const slash = relativePath.lastIndexOf('/');
    if (slash > 0) await dest.ensureDirectory(relativePath.slice(0, slash));

    await dest.writeFile(relativePath, data);

    const readBack = await dest.readFile(relativePath);
    if (!bytesEqual(data, readBack)) {
      throw new Error(`照合不一致: ${relativePath}`);
    }
  }
}
