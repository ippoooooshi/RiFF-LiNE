/**
 * メトロノーム（playback-integration.md §4.4、05_playback_audio.md §6、C1）。
 *
 * 選択中の音色プリセット（`AppPreferencesService` 由来、`PlaybackPreferencesSource`）でクリック音を鳴らす。
 * 1 拍目（小節頭）はどの音色でも共通してピッチを上げる（`accented: true`）。
 * 実際の発音（サンプル再生／合成）はプラットフォーム側の `MetronomeClickSink` に委譲し、
 * 本サービスは「いつ・どのクリックを鳴らすか」のロジックだけを持つ（テスト可能な縫い目）。
 */

import type { PlaybackPreferencesSource, PlaybackSynth } from './types';

/** 1 回のクリック発音要求。 */
export interface MetronomeClick {
  /** 音色プリセット ID（C1）。 */
  presetId: string;
  /** 小節頭のアクセントか（true でピッチを上げる）。 */
  accented: boolean;
  /** 音量（0〜1）。 */
  volume: number;
}

/** クリック音の発音先（プラットフォーム実装／テスト fake が満たす）。 */
export interface MetronomeClickSink {
  playClick(click: MetronomeClick): void;
}

/** 次のクリックまで待つスケジューラ（テストでは即時解決の fake を注入）。 */
export type MetronomeScheduler = (delayMs: number) => Promise<void>;

const defaultScheduler: MetronomeScheduler = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export interface MetronomeServiceOptions {
  scheduler?: MetronomeScheduler;
}

export class MetronomeService {
  private readonly scheduler: MetronomeScheduler;

  constructor(
    private readonly sink: MetronomeClickSink,
    private readonly preferences: PlaybackPreferencesSource,
    options: MetronomeServiceOptions = {},
  ) {
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  /**
   * `measureCount` 小節ぶんのクリックを等間隔で鳴らす（カウントイン等で使う）。
   * 各小節の 1 拍目を `accented` にする。最後のクリックの後は待たない。
   * @throws `measureCount` / `beatsPerMeasure` が 1 未満、または `beatDurationMs` が非正の場合。
   */
  async playPattern(measureCount: number, beatsPerMeasure: number, beatDurationMs: number): Promise<void> {
    if (measureCount < 1 || beatsPerMeasure < 1) {
      throw new RangeError('MetronomeService.playPattern() requires measureCount >= 1 and beatsPerMeasure >= 1.');
    }
    if (!(beatDurationMs > 0)) {
      throw new RangeError('MetronomeService.playPattern() requires beatDurationMs > 0.');
    }

    const prefs = await this.preferences.load();
    const totalBeats = measureCount * beatsPerMeasure;
    for (let beat = 0; beat < totalBeats; beat += 1) {
      this.sink.playClick({
        presetId: prefs.metronomePresetId,
        accented: beat % beatsPerMeasure === 0,
        volume: prefs.metronomeVolume,
      });
      if (beat < totalBeats - 1) {
        await this.scheduler(beatDurationMs);
      }
    }
  }

  /**
   * 再生中の本体メトロノーム（alphaTab 内蔵クリック）の ON/OFF を AlphaSynth へ反映する。
   * 音量は設定値、OFF 時は 0。
   */
  async applyToSynth(synth: PlaybackSynth, enabled: boolean): Promise<void> {
    const prefs = await this.preferences.load();
    synth.setMetronomeVolume(enabled ? prefs.metronomeVolume : 0);
  }
}
