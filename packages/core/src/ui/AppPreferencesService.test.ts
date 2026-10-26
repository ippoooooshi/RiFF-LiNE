// UT-UI-APS: AppPreferencesService（screens-navigation.md §3.1・§4.6・§6）
// 検証節: screens-navigation.md §3.1（格納先・既定値・正規化）、§6（上限バリデーション C2）
import { describe, expect, it } from 'vitest';

import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { AppPreferencesService } from './AppPreferencesService';
import { DEFAULT_APP_PREFERENCES, SONG_LIST_SORT_KEYS } from './types';

function makeService(): { service: AppPreferencesService; fs: FakeFileSystemAdapter } {
  const fs = new FakeFileSystemAdapter();
  return { service: new AppPreferencesService(fs), fs };
}

describe('AppPreferencesService', () => {
  it('AppPreferencesService_未保存_既定値を返す', async () => {
    // UT-UI-APS-01 §3.1「既定値」行
    const { service } = makeService();
    await expect(service.load()).resolves.toEqual(DEFAULT_APP_PREFERENCES);
  });

  it('AppPreferencesService_保存して読み直す_同じ値になる', async () => {
    // UT-UI-APS-02 §5.4
    const { service } = makeService();
    const next = {
      ...DEFAULT_APP_PREFERENCES,
      songListLayout: 'list' as const,
      onboardingSeen: true,
      metronomeVolume: 0.5,
    };
    await service.save(next);
    await expect(service.load()).resolves.toEqual(next);
  });

  it('AppPreferencesService_preferences.jsonへ書く_パスが分離されている', async () => {
    // UT-UI-APS-03 §3.1（settings.json とは別ファイル）
    const { service, fs } = makeService();
    await service.save(DEFAULT_APP_PREFERENCES);
    expect(fs.files.has('preferences.json')).toBe(true);
    expect(fs.files.has('settings.json')).toBe(false);
  });

  it('AppPreferencesService_未知キーと型不一致_既定値へ落とす', async () => {
    // UT-UI-APS-04 §3.1（正規化）
    const { service, fs } = makeService();
    fs.putJson('preferences.json', {
      songListLayout: 'weird',
      metronomePresetId: 'nope',
      extra: 1,
      onboardingSeen: 'yes',
    });
    const loaded = await service.load();
    expect(loaded.songListLayout).toBe('grid');
    expect(loaded.metronomePresetId).toBe('acoustic');
    expect(loaded.onboardingSeen).toBe(false);
    expect((loaded as unknown as Record<string, unknown>)['extra']).toBeUndefined();
  });

  it('AppPreferencesService_ズーム倍率が範囲外_クランプする（C2境界）', async () => {
    // UT-UI-APS-05 §6 C2（zoomScaleByMode 上限・下限）
    const { service, fs } = makeService();
    fs.putJson('preferences.json', { zoomScaleByMode: { focus: 5, scroll: 999, score: 100 } });
    const loaded = await service.load();
    expect(loaded.zoomScaleByMode.focus).toBe(25); // 下限
    expect(loaded.zoomScaleByMode.scroll).toBe(400); // 上限
    expect(loaded.zoomScaleByMode.score).toBe(100); // 範囲内はそのまま
  });

  it('AppPreferencesService_タップテンポ感度が範囲外_クランプして整数化（C2境界）', async () => {
    // UT-UI-APS-06 §6 C2（tapTempoSampleSize 2〜8）
    const { service, fs } = makeService();
    fs.putJson('preferences.json', { tapTempoSampleSize: 1 });
    expect((await service.load()).tapTempoSampleSize).toBe(2);
    fs.putJson('preferences.json', { tapTempoSampleSize: 12 });
    expect((await service.load()).tapTempoSampleSize).toBe(8);
    fs.putJson('preferences.json', { tapTempoSampleSize: 4.6 });
    expect((await service.load()).tapTempoSampleSize).toBe(5);
  });

  it('AppPreferencesService_音量が範囲外_0〜1にクランプ（C2境界）', async () => {
    // UT-UI-APS-07 §6 C2（metronomeVolume / partDefaultVolume）
    const { service, fs } = makeService();
    fs.putJson('preferences.json', { metronomeVolume: -0.5, partDefaultVolume: 3 });
    const loaded = await service.load();
    expect(loaded.metronomeVolume).toBe(0);
    expect(loaded.partDefaultVolume).toBe(1);
  });

  it('AppPreferencesService_countInMeasureMultiplier_1か2のみ', async () => {
    // UT-UI-APS-08 §3.1（1|2 型）
    const { service, fs } = makeService();
    fs.putJson('preferences.json', { countInMeasureMultiplier: 2 });
    expect((await service.load()).countInMeasureMultiplier).toBe(2);
    fs.putJson('preferences.json', { countInMeasureMultiplier: 3 });
    expect((await service.load()).countInMeasureMultiplier).toBe(1);
  });

  it('AppPreferencesService_save時も正規化する_不正値は保存されない', async () => {
    // UT-UI-APS-09 §3.1（save も normalize を通す）
    const { service, fs } = makeService();
    await service.save({ ...DEFAULT_APP_PREFERENCES, metronomeVolume: 99 });
    expect(fs.readJson<{ metronomeVolume: number }>('preferences.json').metronomeVolume).toBe(1);
  });

  it('AppPreferencesService_保持期間が無い_既定の30日にする', async () => {
    // UT-UI-APS-10 data-model-persistence.md 13.3 節：ゴミ箱の保持期間は preferences.json に持ち、無ければ既定の 30
    const { service, fs } = makeService();
    fs.putJson('preferences.json', { onboardingSeen: true });
    expect((await service.load()).trashRetentionDays).toBe(30);
    await service.save({ ...DEFAULT_APP_PREFERENCES, trashRetentionDays: 60 });
    expect(fs.readJson<{ trashRetentionDays: number }>('preferences.json').trashRetentionDays).toBe(60);
    expect(fs.files.has('settings.json')).toBe(false);
  });

  it('AppPreferencesService_保持期間が5つの値のどれでもない_長いほうの値へ読み替える', async () => {
    // UT-UI-APS-11 data-model-persistence.md 13.3 節：下回らないいちばん小さい値、90 を超えるなら 90、数でなければ 30
    const { service, fs } = makeService();
    const cases: [unknown, number][] = [
      [7, 7],
      [14, 14],
      [90, 90],
      [8, 14],
      [31, 60],
      [61, 90],
      [0, 7],
      [-3, 7],
      [91, 90],
      [365, 90],
      ['30', 30],
      [null, 30],
    ];
    for (const [stored, expected] of cases) {
      fs.putJson('preferences.json', { trashRetentionDays: stored });
      expect((await service.load()).trashRetentionDays, String(stored)).toBe(expected);
    }
  });

  it('AppPreferencesService_保持期間がNaN_既定の30日にして保存する', async () => {
    // UT-UI-APS-12 data-model-persistence.md 13.3 節：数でない値（NaN）は既定の 30（save も同じ読み替えを通す）
    const { service, fs } = makeService();
    await service.save({ ...DEFAULT_APP_PREFERENCES, trashRetentionDays: Number.NaN as 30 });
    expect(fs.readJson<{ trashRetentionDays: number }>('preferences.json').trashRetentionDays).toBe(30);
  });

  it('AppPreferencesService_並べ替え_キーと向きを1つの項目songListSortで保存して読み直す', async () => {
    // UT-UI-APS-13 data-model-persistence.md 13.3 節の (b)：{ key, direction } の 1 つの項目 songListSort、キーは 6.2 節の 6 つ
    const { service, fs } = makeService();
    for (const key of SONG_LIST_SORT_KEYS) {
      for (const direction of ['asc', 'desc'] as const) {
        await service.save({ ...DEFAULT_APP_PREFERENCES, songListSort: { key, direction } });
        expect(fs.readJson<{ songListSort: unknown }>('preferences.json').songListSort).toEqual({ key, direction });
        expect((await service.load()).songListSort).toEqual({ key, direction });
      }
    }
    expect(SONG_LIST_SORT_KEYS).toHaveLength(6);
  });

  it('AppPreferencesService_並べ替えが無いか片方が不正_2つとも既定で補う', async () => {
    // UT-UI-APS-14 13.3 節：無い項目は既定で補う。キーと向きは 2 つそろって 1 つなので、片方だけ古い値を残さない
    const { service, fs } = makeService();
    const cases: unknown[] = [
      undefined,
      null,
      'title',
      { key: 'title' },
      { key: 'title', direction: 'up' },
      { key: 'status', direction: 'asc' },
      { direction: 'asc' },
    ];
    for (const stored of cases) {
      fs.putJson('preferences.json', stored === undefined ? {} : { songListSort: stored });
      expect((await service.load()).songListSort, JSON.stringify(stored)).toEqual(DEFAULT_APP_PREFERENCES.songListSort);
    }
  });

  it('AppPreferencesService_古いpreferences.json_無い項目を既定で補い在る値は残す', async () => {
    // UT-UI-APS-15 13.3 節：読んだファイルに無い項目は、既定の値で補う（古い preferences.json もそのまま読める）
    const { service, fs } = makeService();
    fs.putJson('preferences.json', { songListLayout: 'list', onboardingSeen: true });
    await expect(service.load()).resolves.toEqual({
      ...DEFAULT_APP_PREFERENCES,
      songListLayout: 'list',
      onboardingSeen: true,
    });
  });

  it('AppPreferencesService_初めの値のidが文字列_そのまま残し文字列でなければnull', async () => {
    // UT-UI-APS-16 13.3 節：設定ダイアログの 1 項目目の値（チューニングと音色の初めの値）を preferences.json に持つ
    const { service, fs } = makeService();
    fs.putJson('preferences.json', {
      defaultTuningPresetId: 'builtin-guitar-drop-d',
      defaultInstrumentSoundId: 'bass',
    });
    const loaded = await service.load();
    expect(loaded.defaultTuningPresetId).toBe('builtin-guitar-drop-d');
    expect(loaded.defaultInstrumentSoundId).toBe('bass');
    fs.putJson('preferences.json', { defaultTuningPresetId: 3, defaultInstrumentSoundId: false });
    const fallback = await service.load();
    expect(fallback.defaultTuningPresetId).toBeNull();
    expect(fallback.defaultInstrumentSoundId).toBeNull();
  });
});
