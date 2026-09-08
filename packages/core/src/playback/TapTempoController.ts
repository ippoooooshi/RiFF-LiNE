/**
 * タップテンポ（playback-integration.md §4.4、05_playback_audio.md §6）。
 *
 * UI ボタンの連続クリック間隔（直近 3〜4 回の平均、`PlaybackPreferencesSource` の感度パラメータ）から
 * BPM を算出し、`SetTempoCommand`（editing-core.md §6.4）を対象曲の `CommandHistory` 経由で発行する。
 * UI ボタン自体はパッケージ8。本コントローラはロジックのみ。
 */

import { MAX_TEMPO_BPM, MIN_TEMPO_BPM, SetTempoCommand, isValidTempoBpm } from '../editing/commands/SetTempoCommand';
import type { Command, EditTarget } from '../editing/types';

/** タップ間隔がこれを超えたら「別フレーズの叩き直し」とみなし履歴をリセットする（ms）。 */
export const TAP_RESET_GAP_MS = 2000;
/** BPM 推定に最低限必要なタップ数（＝間隔 1 つ）。 */
export const MIN_TAPS_FOR_ESTIMATE = 2;
/** 感度パラメータ（平均するタップ数）の許容範囲。 */
export const MIN_TAP_SAMPLE_SIZE = 2;
export const MAX_TAP_SAMPLE_SIZE = 8;

/** `CommandHistory.execute` のうち本コントローラが要求する部分だけ。 */
export interface TempoCommandSink {
  execute(command: Command): unknown;
}

export interface TapTempoControllerDeps {
  /** テンポ更新コマンドの発行先（対象曲の `CommandHistory`）。 */
  history: TempoCommandSink;
  /** `SetTempoCommand` が変更を加える対象（対象曲）。 */
  target: EditTarget;
  /** 感度パラメータの供給元（`AppPreferencesService` 由来）。 */
  preferences: { load(): Promise<{ tapTempoSampleSize: number }> };
  /** 現在時刻（ms）。テストで差し替える。既定 `performance.now`／`Date.now`。 */
  now?: () => number;
}

export class TapTempoController {
  /** 直近のタップ時刻（ms、古い順）。最大 `sampleSize` 件へ丸める。 */
  private readonly taps: number[] = [];
  /** 直近の推定 BPM（未確定は null）。 */
  private estimate: number | null = null;
  /** 平均に使うタップ数。`refreshPreferences()` で更新。既定 4。 */
  private sampleSize = 4;

  private readonly now: () => number;

  constructor(private readonly deps: TapTempoControllerDeps) {
    this.now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** 現在の推定 BPM（`tap()` の戻り値と同じ。未確定は null）。 */
  get currentBpm(): number | null {
    return this.estimate;
  }

  /**
   * 感度パラメータ（平均タップ数）を設定から読み直す。UI 側は設定保存時などに呼ぶ。
   * 範囲外は `[MIN_TAP_SAMPLE_SIZE, MAX_TAP_SAMPLE_SIZE]` にクランプする。
   */
  async refreshPreferences(): Promise<void> {
    const prefs = await this.deps.preferences.load();
    const requested = Math.floor(prefs.tapTempoSampleSize);
    this.sampleSize = Math.min(
      MAX_TAP_SAMPLE_SIZE,
      Math.max(MIN_TAP_SAMPLE_SIZE, Number.isFinite(requested) ? requested : 4),
    );
  }

  /**
   * 1 回タップする。前回タップから `TAP_RESET_GAP_MS` を超えていたら履歴をリセットしてから記録する。
   * タップが 2 回以上たまったら直近 `sampleSize` 件の平均間隔から BPM を推定して返す（範囲外はクランプ）。
   * まだ推定できない場合は null。
   */
  tap(): number | null {
    const timestamp = this.now();
    const previous = this.taps[this.taps.length - 1];
    if (previous !== undefined && timestamp - previous > TAP_RESET_GAP_MS) {
      this.taps.length = 0;
      this.estimate = null;
    }

    this.taps.push(timestamp);
    // 直近 sampleSize 件だけ保持する（それより古いタップは平均に含めない）。
    if (this.taps.length > this.sampleSize) {
      this.taps.splice(0, this.taps.length - this.sampleSize);
    }

    if (this.taps.length < MIN_TAPS_FOR_ESTIMATE) {
      return null;
    }

    // 連続する間隔の平均 → BPM。
    let intervalSum = 0;
    for (let i = 1; i < this.taps.length; i += 1) {
      intervalSum += this.taps[i]! - this.taps[i - 1]!;
    }
    const averageIntervalMs = intervalSum / (this.taps.length - 1);
    const rawBpm = 60000 / averageIntervalMs;
    this.estimate = Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, Math.round(rawBpm)));
    return this.estimate;
  }

  /**
   * 現在の推定 BPM で指定小節のテンポを更新するコマンドを発行する。
   * 推定が未確定、または算出値が入力可能範囲外なら発行せず false を返す。
   */
  commit(barIndex: number): boolean {
    if (this.estimate === null || !isValidTempoBpm(this.estimate)) {
      return false;
    }
    this.deps.history.execute(new SetTempoCommand(this.deps.target, barIndex, this.estimate));
    return true;
  }

  /** タップ履歴と推定値を捨てる。 */
  reset(): void {
    this.taps.length = 0;
    this.estimate = null;
  }
}
