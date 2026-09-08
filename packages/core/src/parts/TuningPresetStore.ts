/**
 * ユーザー定義チューニングプリセットの永続化（`tuning-presets.json`、part-tuning-management.md §4.2）。
 *
 * Song 非依存のグローバルデータ。アクティブストレージルートの `FileSystemAdapter` を注入して使う。
 * 組み込みプリセットはファイルに含めない（`TuningPresetService` がハードコードで持つ）。
 */

import type { FileSystemAdapter } from '@riff-line/shared-types';

import type { TuningPreset } from '../domain/types';
import { TUNING_PRESETS_FILE } from '../persistence/constants';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** platform/errors.ts の FileNotFoundError（code:'FILE_NOT_FOUND'）か。 */
function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'FILE_NOT_FOUND';
}

export class TuningPresetStore {
  constructor(private readonly adapter: FileSystemAdapter) {}

  /** ユーザー定義プリセット一覧（論理削除分も含む。無ければ空配列）。 */
  async load(): Promise<TuningPreset[]> {
    try {
      const bytes = await this.adapter.readFile(TUNING_PRESETS_FILE);
      const parsed = JSON.parse(decoder.decode(bytes)) as unknown;
      return Array.isArray(parsed) ? (parsed as TuningPreset[]) : [];
    } catch (error) {
      if (isFileNotFound(error)) return [];
      throw error;
    }
  }

  /** ユーザー定義プリセット一覧を丸ごと書き出す。 */
  async save(presets: TuningPreset[]): Promise<void> {
    await this.adapter.writeFile(TUNING_PRESETS_FILE, encoder.encode(`${JSON.stringify(presets, null, 2)}\n`));
  }
}
