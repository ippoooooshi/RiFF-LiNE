/**
 * 再生中の編集反映方式（playback-integration.md §5、A4 対応）。
 *
 * `PlaybackSyncController` は小節境界到達時に dirty トラック集合を渡してくるだけで、
 * 「部分差し替え」か「一旦停止して再開」かはここの実装差し替えで決まる（起動時設定のみで入替可能）。
 * A4（[[13_design_decision_points.md#2]]）が未解決のため **`PauseResumeStrategy` を既定**とする。
 */

import type { AudioSyncContext, AudioSyncStrategy } from './types';

/**
 * 対応トラックのみを差し替える方式（A4 が「部分差し替え対応」で解決した場合に使用）。
 * 他トラックの発音は継続する。
 */
export class PartialReloadStrategy implements AudioSyncStrategy {
  readonly kind = 'partial-reload';

  sync(dirtyTrackIndices: readonly number[], context: AudioSyncContext): void {
    context.synth.reloadTracks(dirtyTrackIndices, context.score);
  }
}

/**
 * 一旦全体を停止し、最新データで即座に再開する方式（部分差し替え非対応時のフォールバック、
 * および Phase 1 検証完了までの既定）。境界での数十 ms の空白は許容する（§5）。
 * 現在位置を保持したまま再ロード→シーク→再生する。
 */
export class PauseResumeStrategy implements AudioSyncStrategy {
  readonly kind = 'pause-resume';

  sync(_dirtyTrackIndices: readonly number[], context: AudioSyncContext): void {
    const { synth, score } = context;
    // 再開位置を控えてから停止する（reloadAll でシンセ内部位置が失われるため）。
    const resumeTick = synth.currentTick;
    const wasPlaying = synth.isPlaying;
    synth.pause();
    synth.reloadAll(score);
    synth.seekTick(resumeTick);
    // 停止中に編集した場合は鳴らし始めない（境界フラッシュは再生中のみ起きる想定だが防御的に確認）。
    if (wasPlaying) synth.play();
  }
}

/**
 * A4 未解決時の既定 `AudioSyncStrategy`（= `PauseResumeStrategy`）。
 * bootstrap は検証結果が出た時点でこの生成箇所だけ差し替える。
 */
export function createDefaultAudioSyncStrategy(): AudioSyncStrategy {
  return new PauseResumeStrategy();
}
