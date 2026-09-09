/**
 * タグマスタ（`tags.json`）の CRUD（screens-navigation.md §3.2・§4.7、00_reference.md §3.2 `TagStore` 行）。
 *
 * [[data-model-persistence.md#7]] が存在を前提にしつつ契約未定義だった `TagStore`（G7）を画面群パッケージで確定する。
 * 実体は `{アクティブなストレージルート}/TabApp/tags.json`。`FileSystemAdapterFactory` は不要（アクティブルート固定）。
 * 既存曲からの参照除去は `AppMetadata.tags` 側の責務で、本 Store は `tags.json` のマスタ操作のみを行う。
 *
 * 命名は `Store`＝「単純なマスタデータの CRUD 窓口」（00_reference.md §7）。
 */

import { canCreateTag, TAG_COUNT_LIMIT } from '../domain/validation';
import { readJsonFile, writeJsonFile } from '../persistence/jsonIo';
import { TAGS_FILE } from '../persistence/constants';
import type { Tag } from '../domain/types';
import type { FileSystemAdapter } from '@riff-line/shared-types';

import type { UiNotificationReporter } from './types';

/** タグ総数の上限（`domain/validation.ts` の `TAG_COUNT_LIMIT` を再輸出。screens-navigation.md §3.5）。 */
export const MAX_TAG_COUNT = TAG_COUNT_LIMIT;

export class TagStore {
  private readonly adapter: FileSystemAdapter;
  private readonly reporter: UiNotificationReporter;

  /**
   * @param adapter アクティブストレージルート（`.../TabApp`）を指す FileSystemAdapter。
   * @param reporter 上限超過時に `TAG-001` を発行する先（`NotificationCenter`）。
   */
  constructor(adapter: FileSystemAdapter, reporter: UiNotificationReporter) {
    this.adapter = adapter;
    this.reporter = reporter;
  }

  /** `tags.json` の全タグを返す。未作成なら空配列（screens-navigation.md §3.2「一覧取得」）。 */
  async list(): Promise<Tag[]> {
    return this.readAll();
  }

  /**
   * タグを新規作成する（screens-navigation.md §3.2「作成」）。
   *
   * - 名前は前後空白を除去。空文字は拒否（`RangeError`）。
   * - 既存タグと同名（大小・空白無視）なら既存タグをそのまま返す（重複マスタを作らない）。
   * - 上限 50 件チェック。超過時は `TAG-001` を発行し `null` を返す（作成しない、C2 対象・screens-navigation.md §6）。
   */
  async create(name: string): Promise<Tag | null> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new RangeError('TagStore.create: name must not be empty.');
    }

    const tags = await this.readAll();

    const existing = tags.find((t) => t.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing !== undefined) return existing;

    // ハードキャップ：50 件到達済みなら作成自体を拒否する（B20、TAG-001＝Error）。
    if (!canCreateTag(tags.length)) {
      this.reporter.report('TAG-001', { limit: MAX_TAG_COUNT });
      return null;
    }

    const created: Tag = { id: crypto.randomUUID(), name: trimmed };
    await this.writeAll([...tags, created]);
    return created;
  }

  /**
   * 既存タグの名称を変更する（screens-navigation.md §3.2「名称変更」）。
   * 対象が無ければ何もしない。空文字への変更は拒否（`RangeError`）。
   */
  async rename(tagId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new RangeError('TagStore.rename: name must not be empty.');
    }
    const tags = await this.readAll();
    const idx = tags.findIndex((t) => t.id === tagId);
    if (idx === -1) return;
    tags[idx] = { id: tagId, name: trimmed };
    await this.writeAll(tags);
  }

  /**
   * タグをマスタから削除する（screens-navigation.md §3.2「削除」）。
   * 対象が無ければ何もしない。既存曲からの参照除去は本 Store の責務外。
   */
  async delete(tagId: string): Promise<void> {
    const tags = await this.readAll();
    const next = tags.filter((t) => t.id !== tagId);
    if (next.length === tags.length) return;
    await this.writeAll(next);
  }

  // ===== 内部ヘルパー =====

  /** `tags.json` を配列として読む。未作成・非配列は空配列に正規化する。 */
  private async readAll(): Promise<Tag[]> {
    const raw = await readJsonFile<unknown>(this.adapter, TAGS_FILE, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t): t is Tag =>
        typeof t === 'object' && t !== null && typeof (t as Tag).id === 'string' && typeof (t as Tag).name === 'string',
    );
  }

  /** `tags.json` へ配列を書き込む。 */
  private async writeAll(tags: Tag[]): Promise<void> {
    await writeJsonFile(this.adapter, TAGS_FILE, tags);
  }
}
