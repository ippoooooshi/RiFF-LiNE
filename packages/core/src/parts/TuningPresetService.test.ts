// UT-PART-PRESET: part-tuning-management.md §3.5・§4.2・§7 — TuningPresetService / TuningPresetStore
// 検証観点（C1）: 組み込み＋ユーザー一覧（論理削除除外）、作成、論理削除、復元、
//   purgeExpired の境界（7日/20件）、適用、スナップショット。

import { beforeEach, describe, expect, it } from 'vitest';

import { CommandHistory } from '../editing';
import type { EditTarget } from '../editing';

import { BUILTIN_TUNING_PRESETS, TuningPresetService } from './TuningPresetService';
import { TuningPresetStore } from './TuningPresetStore';
import { getTuning } from './partModel';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';
import { buildEditTarget, RecordingRenderRequester, RecordingReporter } from '../testing/editingFakes';

let fs: FakeFileSystemAdapter;
let store: TuningPresetStore;
let reporter: RecordingReporter;
let now: Date;
let svc: TuningPresetService;

beforeEach(() => {
  fs = new FakeFileSystemAdapter();
  store = new TuningPresetStore(fs);
  reporter = new RecordingReporter();
  now = new Date('2026-09-08T00:00:00.000Z');
  svc = new TuningPresetService(store, reporter, () => now);
});

describe('list / create', () => {
  it('list_EmptyStore_ReturnsBuiltinsOnly', async () => {
    expect(await svc.list()).toEqual([...BUILTIN_TUNING_PRESETS]);
  });

  it('create_ThenList_IncludesUserPreset', async () => {
    const created = await svc.create('マイチューニング', [64, 59, 55, 50, 45, 38]);
    expect(created.builtin).toBe(false);
    expect(created.id.startsWith('user-')).toBe(true);
    const list = await svc.list();
    expect(list.find((p) => p.id === created.id)?.name).toBe('マイチューニング');
  });
});

describe('logical delete / restore', () => {
  it('delete_HidesFromList_ButKeptInStore', async () => {
    const p = await svc.create('tmp', [64, 59, 55, 50, 45, 40]);
    await svc.delete(p.id);
    expect((await svc.list()).some((x) => x.id === p.id)).toBe(false);
    expect((await svc.listIncludingDeleted()).find((x) => x.id === p.id)?.isDeleted).toBe(true);
  });

  it('restore_BringsBackToList', async () => {
    const p = await svc.create('tmp', [64, 59, 55, 50, 45, 40]);
    await svc.delete(p.id);
    await svc.restore(p.id);
    const back = (await svc.listIncludingDeleted()).find((x) => x.id === p.id)!;
    expect(back.isDeleted).toBeUndefined();
    expect(back.deletedAt).toBeUndefined();
    expect((await svc.list()).some((x) => x.id === p.id)).toBe(true);
  });

  it('delete_BuiltinId_IsIgnored', async () => {
    await svc.delete('builtin-guitar-standard');
    expect((await svc.list()).some((x) => x.id === 'builtin-guitar-standard')).toBe(true);
  });
});

describe('purgeExpired (B27 境界)', () => {
  /** n 件の論理削除済みプリセットを、deletedAt を daysAgo 日前でファイルへ直接用意する。 */
  async function seedDeleted(specs: { daysAgo: number }[]): Promise<void> {
    const presets = specs.map((s, i) => ({
      id: `user-${i}`,
      name: `d${i}`,
      builtin: false,
      stringPitches: [64, 59, 55, 50, 45, 40],
      isDeleted: true,
      deletedAt: new Date(now.getTime() - s.daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    }));
    await store.save(presets);
  }

  it('under7Days_and_under20_NoPurge', async () => {
    await seedDeleted(Array.from({ length: 19 }, () => ({ daysAgo: 6 })));
    expect(await svc.purgeExpired()).toBe(0);
  });

  it('exactly7Days_IsPurged', async () => {
    await seedDeleted([{ daysAgo: 7 }, { daysAgo: 6 }]);
    expect(await svc.purgeExpired()).toBe(1);
  });

  it('over20Entries_PurgesOldestExcess', async () => {
    // 21 件、いずれも日数では残る（数分前）。件数超過分（1 件）を最古から物理パージ。
    const seeded = Array.from({ length: 21 }, (_v, i) => ({
      id: `user-${i}`,
      name: `d${i}`,
      builtin: false,
      stringPitches: [64, 59, 55, 50, 45, 40],
      isDeleted: true,
      deletedAt: new Date(now.getTime() - (100 - i) * 60 * 1000).toISOString(), // i が小さいほど古い
    }));
    await store.save(seeded);
    expect(await svc.purgeExpired()).toBe(1);
    const left = await svc.listIncludingDeleted();
    expect(left).toHaveLength(20);
    expect(left.some((p) => p.id === 'user-0')).toBe(false); // 最古が消える
  });
});

describe('applyPreset / snapshot', () => {
  it('applyPreset_ExecutesApplyTuningPresetCommand', async () => {
    const target: EditTarget = buildEditTarget();
    const history = new CommandHistory(new RecordingRenderRequester(), reporter);
    const dropD = BUILTIN_TUNING_PRESETS.find((p) => p.id === 'builtin-guitar-drop-d')!;

    svc.applyPreset(target, history, 0, dropD);
    expect(getTuning(target.score, 0)).toEqual(dropD.stringPitches);
    expect(history.canUndo()).toBe(true);
  });

  it('snapshotTuningFrom_ReturnsCurrentTuning', () => {
    const target = buildEditTarget();
    expect(svc.snapshotTuningFrom(target, 0)).toEqual({ stringPitches: [64, 59, 55, 50, 45, 40] });
  });
});
