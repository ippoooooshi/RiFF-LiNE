// UT-UI-APS: AppPreferencesService（screens-navigation.md §3.1・§4.6・§6）
// 検証節: screens-navigation.md §3.1（格納先・既定値・正規化）、§6（上限バリデーション C2）
import { describe, expect, it } from 'vitest';

import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { AppPreferencesService } from './AppPreferencesService';
import { DEFAULT_APP_PREFERENCES } from './types';

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
});
