/**
 * ミキサー値（volume / pan / solo / mute）の AlphaSynth 反映（playback-integration.md §4.3・§6.2）。
 *
 * `CommandHistory.onCommandApplied`（`PlaybackSyncController` と同じ拡張ポイント）を購読し、
 * 通知のたびに Score モデルの現在値を読み取ってチャンネルへ再送する。
 * どのコマンドがミキサー値を変えたかは**分類しない**（冪等・一律再送、§4.3。editing-core.md §3
 * の「分類を試みず一律に扱う」Score 再描画戦略と同じ考え方）。
 * ソロ指定が 1 つ以上あれば、ソロ対象以外は内部的にミュート扱いにする（05_playback_audio.md §2）。
 * 同一トラックに明示 `mute` と `solo` が両立する場合は**明示ミュートを優先**する
 * （13_design_decision_points.md B35 / playback-integration.md §4.3、2026-09-09 設計オーナー裁定。
 * 明示ミュートは絶対操作であり solo は上書きしない＝一般的な DAW 挙動）。
 */

import type { model } from '@coderline/alphatab';

import { getMixer } from '../parts/partModel';

import type { CommandAppliedSource } from './PlaybackSyncController';
import type { PlaybackSynth } from './types';

export class PlaybackMixerBinder {
  private readonly unsubscribe: () => void;

  constructor(
    private readonly synth: PlaybackSynth,
    history: CommandAppliedSource,
    private readonly score: model.Score,
  ) {
    // affectedTrackIndices は「再送のきっかけ」としてのみ使い、実際には全チャンネルを毎回まるごと同期する
    // （ソロ状態はグローバルに効くため部分更新では不整合が起きうる、§4.3 冪等方針）。
    this.unsubscribe = history.onCommandApplied(() => this.syncAll());
  }

  /**
   * 全トラックの volume / pan と、ソロを加味した実効ミュートを AlphaSynth へ送る。
   * bootstrap は再生開始前に一度これを呼んで初期状態を揃えてよい（冪等）。
   */
  syncAll(): void {
    const trackCount = this.score.tracks.length;

    // ソロが 1 つでもあれば「ソロ優先」モード（ソロ対象以外を内部ミュート）。
    let anySolo = false;
    for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
      if (getMixer(this.score, trackIndex).solo) {
        anySolo = true;
        break;
      }
    }

    for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
      const mixer = getMixer(this.score, trackIndex);
      this.synth.setChannelVolume(trackIndex, mixer.volume);
      this.synth.setChannelPan(trackIndex, mixer.pan);
      this.synth.setChannelSolo(trackIndex, mixer.solo);
      // 実効ミュート = 明示ミュート、または「ソロ優先モードでソロ対象外」。
      // 明示ミュートが立っていれば solo 指定に関わらず無音（B35）。
      const effectiveMute = mixer.mute || (anySolo && !mixer.solo);
      this.synth.setChannelMute(trackIndex, effectiveMute);
    }
  }

  /** 購読を解除する（ウィンドウクローズ時）。 */
  dispose(): void {
    this.unsubscribe();
  }
}
