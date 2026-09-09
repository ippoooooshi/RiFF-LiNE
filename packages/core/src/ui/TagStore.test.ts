// UT-UI-TAG: TagStore（screens-navigation.md §3.2・§4.7・§3.5・§6）
// 検証節: screens-navigation.md §3.2（CRUD 契約）、§3.5（TAG-001）、§6（上限バリデーション C2）
import { describe, expect, it, vi } from 'vitest';

import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { MAX_TAG_COUNT, TagStore } from './TagStore';
import type { UiNotificationReporter } from './types';

function makeStore(): { store: TagStore; fs: FakeFileSystemAdapter; report: ReturnType<typeof vi.fn> } {
  const fs = new FakeFileSystemAdapter();
  const report = vi.fn();
  const reporter: UiNotificationReporter = { report };
  return { store: new TagStore(fs, reporter), fs, report };
}

describe('TagStore', () => {
  it('TagStore_未作成_空配列を返す', async () => {
    // UT-UI-TAG-01 §3.2「一覧取得」
    const { store } = makeStore();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('TagStore_create_タグを追加してlistに現れる', async () => {
    // UT-UI-TAG-02 §3.2「作成」
    const { store } = makeStore();
    const created = await store.create('  Rock  ');
    expect(created).not.toBeNull();
    expect(created?.name).toBe('Rock'); // trim される
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it('TagStore_create_空文字はRangeError', async () => {
    // UT-UI-TAG-03 §3.2（バリデーション）
    const { store } = makeStore();
    await expect(store.create('   ')).rejects.toBeInstanceOf(RangeError);
  });

  it('TagStore_create_同名（大小空白無視）は既存タグを返し重複を作らない', async () => {
    // UT-UI-TAG-04 §3.2（重複マスタ回避）
    const { store } = makeStore();
    const a = await store.create('Jazz');
    const b = await store.create(' jazz ');
    expect(b?.id).toBe(a?.id);
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it('TagStore_create_50件到達後の作成はTAG-001でnull（C2境界: 49→50→51）', async () => {
    // UT-UI-TAG-05 §3.5・§6 C2
    const { store, report } = makeStore();
    for (let i = 0; i < MAX_TAG_COUNT - 1; i += 1) {
      const created = await store.create(`tag-${i}`);
      expect(created).not.toBeNull();
    }
    // 49 件 → 50 件目は作成可
    const fiftieth = await store.create('tag-49');
    expect(fiftieth).not.toBeNull();
    expect(report).not.toHaveBeenCalled();
    // 50 件 → 51 件目は拒否（TAG-001）
    const overflow = await store.create('tag-50');
    expect(overflow).toBeNull();
    expect(report).toHaveBeenCalledWith('TAG-001', { limit: MAX_TAG_COUNT });
    await expect(store.list()).resolves.toHaveLength(MAX_TAG_COUNT);
  });

  it('TagStore_rename_名称を変更する / 対象なしは無操作', async () => {
    // UT-UI-TAG-06 §3.2「名称変更」
    const { store } = makeStore();
    const tag = await store.create('old');
    await store.rename(tag!.id, 'new');
    await expect(store.list()).resolves.toEqual([{ id: tag!.id, name: 'new' }]);
    await store.rename('missing', 'x'); // 例外なし
  });

  it('TagStore_rename_空文字はRangeError', async () => {
    // UT-UI-TAG-07 §3.2
    const { store } = makeStore();
    const tag = await store.create('x');
    await expect(store.rename(tag!.id, ' ')).rejects.toBeInstanceOf(RangeError);
  });

  it('TagStore_delete_マスタから除去する / 対象なしは無操作', async () => {
    // UT-UI-TAG-08 §3.2「削除」
    const { store } = makeStore();
    const tag = await store.create('temp');
    await store.delete(tag!.id);
    await expect(store.list()).resolves.toEqual([]);
    await store.delete('missing'); // 例外なし
  });

  it('TagStore_tags.jsonが非配列や壊れた要素_無視して正規化する', async () => {
    // UT-UI-TAG-09 §3.2（読み取りの頑健性）
    const { store, fs } = makeStore();
    fs.putJson('tags.json', { not: 'an array' });
    await expect(store.list()).resolves.toEqual([]);
    fs.putJson('tags.json', [{ id: 'a', name: 'ok' }, { id: 1 }, null, { name: 'no id' }]);
    await expect(store.list()).resolves.toEqual([{ id: 'a', name: 'ok' }]);
  });
});
