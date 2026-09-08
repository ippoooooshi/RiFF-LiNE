/**
 * 再生カーソルの表示範囲追従（playback-integration.md §4.5・§6.4、05_playback_audio.md §5）。
 *
 * alphaTab の再生位置イベント（Beat 単位）を購読し、再生カーソルが現在の表示範囲外へ出たときのみ
 * `PlaybackViewport`（= `ViewModeController` の表示範囲更新 API、view-modes.md §9）を呼ぶ。
 * 範囲内にある間は何もしない（過剰スクロールによるちらつき防止）。
 */

import type { PlaybackPositionEvent, PlaybackSynth, PlaybackViewport, TickMap } from './types';

export class PlaybackCursorFollow {
  private readonly unsubscribe: () => void;

  constructor(
    synth: PlaybackSynth,
    private readonly viewport: PlaybackViewport,
    private readonly tickMap: TickMap,
  ) {
    this.unsubscribe = synth.onPositionChanged((event) => this.onPositionChanged(event));
  }

  /** 購読を解除する（ウィンドウクローズ時）。 */
  dispose(): void {
    this.unsubscribe();
  }

  // ===== 内部 =====

  /** 再生位置に対応する小節が表示範囲外なら、その小節を表示範囲へ入れる。 */
  private onPositionChanged(event: PlaybackPositionEvent): void {
    const barIndex = this.tickMap.tickToBarIndex(event.currentTick);
    if (!this.viewport.isBarVisible(barIndex)) {
      this.viewport.revealBar(barIndex);
    }
  }
}
