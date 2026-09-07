/**
 * 保存先設定（主ストレージ・ミラー先・ゴミ箱保持日数）の読み書きと検証
 * （06_file_io_persistence.md §2・§4、data-model-persistence.md §3.2・§5）。
 *
 * 実体は `{アクティブなストレージルート}/TabApp/settings.json`。
 */

import type { FileSystemAdapter } from '@riff-line/shared-types';

import type { StorageType } from '../domain/types';

import { DEFAULT_TRASH_RETENTION_DAYS, STORAGE_SETTINGS_FILE } from './constants';
import { readJsonFile, writeJsonFile } from './jsonIo';

/** 1 つのミラー先。 */
export interface MirrorLocation {
  root: string;
  type: StorageType;
}

/** 保存先設定（data-model-persistence.md §5）。 */
export interface StorageConfig {
  primaryRoot: string;
  primaryType: StorageType;
  mirrors: MirrorLocation[];
  trashRetentionDays: number;
}

/** UI 層でそのままエラー表示に使える検証結果。 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 候補フォルダの自動検出（契約のみ。実際の走査は Phase 1 前半、A5 の実機検証と合わせて実装）。 */
export interface StorageLocationDetector {
  detectCandidates(): Promise<{ type: 'icloud' | 'gdrive'; path: string }[]>;
}

/** 何も検出しない既定実装（A5 実装までのプレースホルダ）。 */
export const NullStorageLocationDetector: StorageLocationDetector = {
  detectCandidates: () => Promise.resolve([]),
};

/** パス比較の正規化（末尾スラッシュ・大小文字差を吸収。Windows 前提だが他 OS でも安全側）。 */
function normalizeRoot(root: string): string {
  return root.replace(/[\\/]+$/, '').toLowerCase();
}

export class StorageConfigService {
  /**
   * @param adapter アクティブストレージ用アダプタ。
   * @param defaultPrimaryRoot settings.json が無い初回起動時の主ストレージ（= 解決済みアクティブルート）。
   */
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly defaultPrimaryRoot: string,
  ) {}

  /** settings.json を読む。無ければ既定値（主＝ローカル、ミラーなし、保持 30 日、B9）。 */
  async load(): Promise<StorageConfig> {
    const fallback: StorageConfig = {
      primaryRoot: this.defaultPrimaryRoot,
      primaryType: 'local',
      mirrors: [],
      trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
    };
    const loaded = await readJsonFile<Partial<StorageConfig>>(this.adapter, STORAGE_SETTINGS_FILE, fallback);
    return {
      primaryRoot: typeof loaded.primaryRoot === 'string' ? loaded.primaryRoot : fallback.primaryRoot,
      primaryType: loaded.primaryType ?? fallback.primaryType,
      mirrors: Array.isArray(loaded.mirrors) ? loaded.mirrors : fallback.mirrors,
      trashRetentionDays:
        typeof loaded.trashRetentionDays === 'number' && loaded.trashRetentionDays > 0
          ? loaded.trashRetentionDays
          : fallback.trashRetentionDays,
    };
  }

  async save(config: StorageConfig): Promise<void> {
    await writeJsonFile(this.adapter, STORAGE_SETTINGS_FILE, config);
  }

  /**
   * ミラー設定の妥当性を検証する（06_file_io_persistence.md §4.2 の禁止パターン）。
   * - 主ストレージとミラー先が同一フォルダ → 不可
   * - ミラー先どうしが同一フォルダ（種別違いを含む）→ 不可
   * 例外ではなく ValidationResult を返す（UI でそのまま表示に使うため）。
   */
  validateMirrorConfig(config: StorageConfig): ValidationResult {
    const errors: string[] = [];
    const primary = normalizeRoot(config.primaryRoot);

    const seen = new Map<string, number>();
    config.mirrors.forEach((mirror, index) => {
      const key = normalizeRoot(mirror.root);
      if (key === primary) {
        errors.push(`ミラー${index + 1}が主ストレージと同じフォルダです。別のフォルダを指定してください。`);
      }
      const firstIndex = seen.get(key);
      if (firstIndex !== undefined) {
        errors.push(`ミラー${firstIndex + 1}とミラー${index + 1}が同じフォルダです。`);
      } else {
        seen.set(key, index);
      }
    });

    return { ok: errors.length === 0, errors };
  }
}
