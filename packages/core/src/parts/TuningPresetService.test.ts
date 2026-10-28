// UT-PART-PRESET: part-tuning-management.md §3.5・§4.2・§7 — TuningPresetService / TuningPresetStore
// 検証観点（C1）: 組み込み＋ユーザー一覧（論理削除除外）、作成、論理削除、復元、
//   purgeExpired の境界（7日/20件）、適用、スナップショット、
//   tuning-presets.json の中身（data-model-persistence.md 13.4 節：利用者のプリセットだけ、StoredTuningPreset）。

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

// data-model-persistence.md 13.4 節：tuning-presets.json は利用者が作ったプリセットだけを持ち、1 件は StoredTuningPreset
describe('TuningPresetStore (tuning-presets.json)', () => {
  it('TuningPresetStore_load_NoFile_ReturnsEmpty', async () => {
    await expect(store.load()).resolves.toEqual([]);
  });

  it('TuningPresetStore_save_BuiltinPresetsAreNotWritten', async () => {
    const user = { id: 'user-1', name: 'Mine', builtin: false, stringPitches: [64, 59, 55, 50, 45, 40] };
    await store.save([BUILTIN_TUNING_PRESETS[0]!, user]);
    expect(fs.readJson<unknown[]>('tuning-presets.json')).toEqual([user]);
  });

  it('TuningPresetStore_saveAndLoad_KeepsDeletedMarks', async () => {
    const deleted = {
      id: 'user-2',
      name: 'Old',
      builtin: false,
      stringPitches: [43, 38, 33, 28],
      isDeleted: true,
      deletedAt: '2026-09-01T00:00:00.000Z',
    };
    await store.save([deleted]);
    await expect(store.load()).resolves.toEqual([deleted]);
  });

  it('TuningPresetStore_load_SkipsBuiltinAndMalformedEntries', async () => {
    const user = { id: 'user-3', name: 'Ok', builtin: false, stringPitches: [62, 57, 55, 50, 45, 38] };
    fs.putJson('tuning-presets.json', [
      user,
      { ...BUILTIN_TUNING_PRESETS[0]! },
      null,
      'text',
      { id: 'x', name: 'no pitches', builtin: false },
      { id: 'y', name: 'bad pitches', builtin: false, stringPitches: ['E'] },
      { id: 1, name: 'bad id', builtin: false, stringPitches: [] },
      { id: 'z', name: 2, builtin: false, stringPitches: [] },
    ]);
    await expect(store.load()).resolves.toEqual([user]);
    fs.putJson('tuning-presets.json', { not: 'an array' });
    await expect(store.load()).resolves.toEqual([]);
  });

  it('TuningPresetStore_load_ReadErrorOtherThanNotFound_Propagates', async () => {
    fs.putText('tuning-presets.json', '{broken');
    await expect(store.load()).rejects.toThrow();
  });
});
