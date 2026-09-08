/**
 * カウントイン（playback-integration.md §4.4・§6.3、05_playback_audio.md §6、C2）。
 *
 * 再生開始前に、設定（1 小節／2 小節倍率、`PlaybackPreferencesSource`）に応じた小節数ぶんの
 * `MetronomeService` クリックを鳴らしてから `PlaybackService.play()` を呼ぶ。
 */

import type { MetronomeService } from './MetronomeService';
import type { PlaybackPreferencesSource } from './types';

/** カウントイン後に再生を開始する対象（`PlaybackService` が構造的に充足）。 */
export interface CountInPlaybackTarget {
  play(): void;
}

/** カウントインに必要な現在の拍子・テンポ。 */
export interface CountInContext {
  /** 1 小節あたりの拍数（拍子の分子）。 */
  beatsPerMeasure: number;
  /** 現在のテンポ（BPM）。 */
  bpm: number;
}

export class CountInController {
  /** `start()` 実行中に `cancel()` されたか。クリック列の後の `play()` を抑止する。 */
  private cancelled = false;
  /** 多重 `start()` を防ぐ。 */
  private running = false;

  constructor(
    private readonly metronome: MetronomeService,
    private readonly playback: CountInPlaybackTarget,
    private readonly preferences: PlaybackPreferencesSource,
  ) {}

  /**
   * カウントインのクリックを鳴らし、完了後に再生を開始する。
   * 途中で `cancel()` された場合は再生を開始しない。
   * @throws `bpm` / `beatsPerMeasure` が非正の場合。既に実行中の場合。
   */
  async start(context: CountInContext): Promise<void> {
    if (this.running) {
      throw new Error('CountInController.start() is already running.');
    }
    if (!(context.bpm > 0) || !(context.beatsPerMeasure > 0)) {
      throw new RangeError('CountInController.start() requires bpm > 0 and beatsPerMeasure > 0.');
    }

    this.running = true;
    this.cancelled = false;
    try {
      const prefs = await this.preferences.load();
      // C2：倍率は 1 小節（既定）か 2 小節。範囲外は 1 小節へ丸める。
      const measures = prefs.countInMeasureMultiplier === 2 ? 2 : 1;
      const beatDurationMs = 60000 / context.bpm;

      await this.metronome.playPattern(measures, context.beatsPerMeasure, beatDurationMs);

      if (!this.cancelled) {
        this.playback.play();
      }
    } finally {
      this.running = false;
    }
  }

  /** 進行中のカウントインを中断する（クリック列そのものは `MetronomeService` 側で継続しうる）。 */
  cancel(): void {
    this.cancelled = true;
  }
}
