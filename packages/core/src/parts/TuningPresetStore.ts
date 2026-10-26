/**
 * 利用者が作ったチューニングプリセットのファイル（`tuning-presets.json`）を読み書きする
 * （data-model-persistence.md 13.4 節・13.1 節、part-tuning-management.md 3.4 節）。
 *
 * 曲に属さないアプリ全体のデータ。アクティブストレージルート（`.../TabApp`）の `FileSystemAdapter` を注入して使う。
 * ファイルは利用者のプリセットだけを持ち、1 件は `StoredTuningPreset`（`TuningPreset` に消した印の 2 つの項目を足した形）。
 * 組み込みのプリセットはアプリに同梱し、このファイルに入れない（`TuningPresetService` の `BUILTIN_TUNING_PRESETS`）。
 */

import type { FileSystemAdapter } from '../platform';

import type { StoredTuningPreset } from '../domain/types';
import { TUNING_PRESETS_FILE } from '../persistence/constants';
import { readJsonFile, writeJsonFile } from '../persistence/jsonIo';

/** 利用者のプリセットとして読める 1 件か（組み込みの印が付いたもの・形の違うものは除く）。 */
function isUserPreset(value: unknown): value is StoredTuningPreset {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<StoredTuningPreset>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    p.builtin !== true &&
    Array.isArray(p.stringPitches) &&
    p.stringPitches.every((n) => typeof n === 'number')
  );
}

// data-model-persistence.md 13.4 節：tuning-presets.json は利用者が作ったチューニングプリセット（設定ダイアログの 13 項目目）だけを持つ <!-- req datamodelpersistence:b81b3c3b.fe1e --> <!-- req datamodelpersistence:fbc8ce54.ee83 --> <!-- req datamodelpersistence:6394dbd7.adfd -->
export class TuningPresetStore {
  constructor(private readonly adapter: FileSystemAdapter) {}

  /** 利用者のプリセットの一覧（消した印のあるものも含む）。ファイルが無ければ空の配列。 */
  async load(): Promise<StoredTuningPreset[]> {
    const raw = await readJsonFile<unknown>(this.adapter, TUNING_PRESETS_FILE, []);
    return Array.isArray(raw) ? raw.filter(isUserPreset) : [];
  }

  /** 利用者のプリセットの一覧を丸ごと書く。組み込みのプリセットが混ざっていても、ファイルには入れない（13.4 節）。 */
  // data-model-persistence.md 13.4 節：組み込みのプリセットは tuning-presets.json に入れない <!-- req datamodelpersistence:fbc8ce54.c415 -->
  async save(presets: readonly StoredTuningPreset[]): Promise<void> {
    await writeJsonFile(
      this.adapter,
      TUNING_PRESETS_FILE,
      presets.filter((preset) => !preset.builtin),
    );
  }
}
