/**
 * dirty トラック管理・小節境界フラッシュ（playback-integration.md §4.2・§3.1・§6.1）。
 *
 * 「音への反映は次の安全な境界（小節境界。ループ境界もその特殊ケース）まで遅延させる」という
 * **単一ルール**を担う（ループ有無で分岐しない、§3.1）。編集ウィンドウ単位スコープ。
 *
 * - `CommandHistory.onCommandApplied` を購読し、**再生中のときだけ** `affectedTrackIndices` を
 *   dirty 集合へ足す（即時反映しない）。
 * - `PlaybackSynth` の再生位置イベントで小節境界（前回と小節インデックスが変わったか）を検知し、
 *   到達時に dirty があれば `AudioSyncStrategy` 経由で反映して集合をクリアする。
 * - 停止したら dirty 集合を捨てる（停止中は編集の都度そのまま反映される想定のため管理不要）。
 */

import type { model } from '@coderline/alphatab';

import type { CommandAppliedEvent } from '../editing/types';

import type { AudioSyncStrategy, PlaybackPositionEvent, PlaybackStateEvent, PlaybackSynth, TickMap } from './types';

/** `CommandHistory.onCommandApplied` のうち本コントローラが要求する部分だけ。 */
export interface CommandAppliedSource {
  onCommandApplied(listener: (event: CommandAppliedEvent) => void): () => void;
}

export interface PlaybackSyncControllerOptions {
  /** 反映対象の Score（`AudioSyncStrategy` へ渡す）。 */
  score: model.Score;
  /** A4 対応の反映方式。省略時は呼び出し側が `createDefaultAudioSyncStrategy()` を渡す想定。 */
  strategy: AudioSyncStrategy;
}

export class PlaybackSyncController {
  private readonly dirtyTracks = new Set<number>();
  /** 直近の再生位置イベントで判定した小節インデックス。未受信は null。 */
  private lastBarIndex: number | null = null;
  /** `PlaybackSynth` の状態イベントで追う再生中フラグ（`isPlaying` の生読みに頼らず購読で持つ）。 */
  private playing = false;

  private readonly score: model.Score;
  private readonly strategy: AudioSyncStrategy;
  private readonly unsubscribes: Array<() => void> = [];

  constructor(
    private readonly synth: PlaybackSynth,
    history: CommandAppliedSource,
    private readonly tickMap: TickMap,
    options: PlaybackSyncControllerOptions,
  ) {
    this.score = options.score;
    this.strategy = options.strategy;
    this.playing = synth.isPlaying;

    this.unsubscribes.push(history.onCommandApplied((event) => this.onCommandApplied(event)));
    this.unsubscribes.push(synth.onStateChanged((event) => this.onStateChanged(event)));
    this.unsubscribes.push(synth.onPositionChanged((event) => this.onPositionChanged(event)));
  }

  /** 現在 dirty なトラックインデックス（診断・テスト用の昇順コピー）。 */
  get dirtyTrackIndices(): number[] {
    return [...this.dirtyTracks].sort((a, b) => a - b);
  }

  /** 購読を解除する（ウィンドウクローズ時）。 */
  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.dirtyTracks.clear();
  }

  // ===== 内部 =====

  /**
   * コマンド適用通知（§4.2 dirty 検知）。再生中でなければ何もしない
   * （§3.1：停止中は編集が即座に反映されるため dirty 管理自体が不要）。
   */
  private onCommandApplied(event: CommandAppliedEvent): void {
    if (!this.playing) return;
    for (const trackIndex of event.affectedTrackIndices) {
      this.dirtyTracks.add(trackIndex);
    }
  }

  /** 再生状態変化。停止・一時停止で dirty をクリアし、境界判定用の小節インデックスもリセットする。 */
  private onStateChanged(event: PlaybackStateEvent): void {
    this.playing = event.playing;
    if (!event.playing) {
      this.dirtyTracks.clear();
      this.lastBarIndex = null;
    }
  }

  /**
   * 再生位置イベント（§4.2 境界検知＋フラッシュ）。
   * 小節インデックスが前回と変わったら「小節境界（ループ境界を含む）に到達」とみなし、
   * 再生中かつ dirty があれば `AudioSyncStrategy` で反映して集合をクリアする。
   *
   * `event.isSeek` は見ない：ループ再シーク（後退ジャンプ）を境界として拾う必要があり、
   * §3.1 の単一ルール上ループ境界と手動シークを区別しないため。手動スクラブでも中途フラッシュが
   * 起きうるが、既定 `PauseResumeStrategy` では pause→reloadAll→seek(currentTick)→play で
   * 無害（データ欠落なし）。`PartialReloadStrategy` 採用時に副作用が問題になれば `isSeek` の
   * 扱いを A4 の検証結果とあわせて整理する。
   */
  private onPositionChanged(event: PlaybackPositionEvent): void {
    const barIndex = this.tickMap.tickToBarIndex(event.currentTick);

    // 初回イベントは基準の記録のみ（境界判定は次回から）。
    if (this.lastBarIndex === null) {
      this.lastBarIndex = barIndex;
      return;
    }
    if (barIndex === this.lastBarIndex) return;

    this.lastBarIndex = barIndex;

    // dirty はここに到達する時点で「再生中に積まれたもの」だけ（`onCommandApplied` の再生中ガードと
    // `onStateChanged` の停止時クリアで不変条件を保つ）。空なら反映不要。
    if (this.dirtyTracks.size === 0) return;

    this.strategy.sync(this.dirtyTrackIndices, { synth: this.synth, score: this.score });
    this.dirtyTracks.clear();
  }
}
