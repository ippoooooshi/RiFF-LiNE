// UT-UI-PPA: PlaybackPreferencesAdapter（screens-navigation.md §3.1・§3.4、playback-integration.md §4.4）
// 検証節: playback-integration.md §4.4（MetronomeService/CountInController/TapTempoController の設定値入力元）
import { describe, expect, it } from 'vitest';

import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { AppPreferencesService } from './AppPreferencesService';
import { PlaybackPreferencesAdapter } from './PlaybackPreferencesAdapter';
import { DEFAULT_APP_PREFERENCES } from './types';

describe('PlaybackPreferencesAdapter', () => {
  it('PlaybackPreferencesAdapter_AppPreferencesを再生設定の形へ写す', async () => {
    // UT-UI-PPA-01 §3.4（値の入力元の明確化）
    const fs = new FakeFileSystemAdapter();
    const prefsService = new AppPreferencesService(fs);
    await prefsService.save({
      ...DEFAULT_APP_PREFERENCES,
      metronomePresetId: 'wood',
      metronomeVolume: 0.3,
      countInMeasureMultiplier: 2,
      tapTempoSampleSize: 6,
    });

    const adapter = new PlaybackPreferencesAdapter(prefsService);
    await expect(adapter.load()).resolves.toEqual({
      metronomePresetId: 'wood',
      metronomeVolume: 0.3,
      countInMeasureMultiplier: 2,
      tapTempoSampleSize: 6,
    });
  });

  it('PlaybackPreferencesAdapter_未保存なら組み込み既定値に対応する', async () => {
    // UT-UI-PPA-02 §3.1（既定値）
    const adapter = new PlaybackPreferencesAdapter(new AppPreferencesService(new FakeFileSystemAdapter()));
    await expect(adapter.load()).resolves.toEqual({
      metronomePresetId: DEFAULT_APP_PREFERENCES.metronomePresetId,
      metronomeVolume: DEFAULT_APP_PREFERENCES.metronomeVolume,
      countInMeasureMultiplier: DEFAULT_APP_PREFERENCES.countInMeasureMultiplier,
      tapTempoSampleSize: DEFAULT_APP_PREFERENCES.tapTempoSampleSize,
    });
  });
});
