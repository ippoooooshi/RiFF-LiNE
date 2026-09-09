/**
 * `AppPreferencesService` → `PlaybackPreferencesSource` の橋渡し（screens-navigation.md §3.1・§3.4、
 * playback-integration.md §4.4 の非破壊追記、00_reference.md §3.7）。
 *
 * `MetronomeService` / `CountInController` / `TapTempoController` は `PlaybackPreferencesSource.load()` から
 * 設定値を得る契約（playback-integration.md §4.4）。その入力元を本パッケージが新設した `AppPreferencesService`
 * に結ぶのがこのアダプタ。playback パッケージの型（`PlaybackPreferences`）へ形を合わせるだけで、値は決めない。
 */

import type { PlaybackPreferences, PlaybackPreferencesSource } from '../playback/types';

import type { AppPreferencesService } from './AppPreferencesService';

export class PlaybackPreferencesAdapter implements PlaybackPreferencesSource {
  private readonly preferences: AppPreferencesService;

  constructor(preferences: AppPreferencesService) {
    this.preferences = preferences;
  }

  /**
   * `AppPreferences` のうち再生系（メトロノーム音色 / 音量・カウントイン倍率・タップテンポ感度）を
   * `PlaybackPreferences` の形へ写して返す（playback-integration.md §4.4）。
   */
  async load(): Promise<PlaybackPreferences> {
    const prefs = await this.preferences.load();
    return {
      metronomePresetId: prefs.metronomePresetId,
      metronomeVolume: prefs.metronomeVolume,
      countInMeasureMultiplier: prefs.countInMeasureMultiplier,
      tapTempoSampleSize: prefs.tapTempoSampleSize,
    };
  }
}
