/**
 * 再生エンジン統合（L1〜L3）の公開バレル（playback-integration.md）。
 *
 * 新規エラーコードは追加しない（§4.4 のメトロノーム／カウントイン／タップテンポは通知を伴わない）。
 * `@riff-line/core/playback` サブパスで公開する。
 */

export type {
  TickRange,
  TickMap,
  PlaybackSynth,
  PlaybackPositionEvent,
  PlaybackStateEvent,
  AudioSyncStrategy,
  AudioSyncContext,
  PlaybackViewport,
  PlaybackPreferences,
  PlaybackPreferencesSource,
} from './types';
export { DEFAULT_PLAYBACK_PREFERENCES } from './types';

export { ArrayTickMap, buildBarTickBoundaries } from './tickMap';
export { PlaybackService, type PlaybackServiceOptions, type FrettedNoteRef } from './PlaybackService';
export {
  PlaybackSyncController,
  type PlaybackSyncControllerOptions,
  type CommandAppliedSource,
} from './PlaybackSyncController';
export { PlaybackMixerBinder } from './PlaybackMixerBinder';
export { PartialReloadStrategy, PauseResumeStrategy, createDefaultAudioSyncStrategy } from './AudioSyncStrategy';
export {
  MetronomeService,
  type MetronomeClick,
  type MetronomeClickSink,
  type MetronomeScheduler,
  type MetronomeServiceOptions,
} from './MetronomeService';
export { CountInController, type CountInPlaybackTarget, type CountInContext } from './CountInController';
export {
  TapTempoController,
  type TapTempoControllerDeps,
  type TempoCommandSink,
  TAP_RESET_GAP_MS,
  MIN_TAPS_FOR_ESTIMATE,
  MIN_TAP_SAMPLE_SIZE,
  MAX_TAP_SAMPLE_SIZE,
} from './TapTempoController';
export { PlaybackCursorFollow } from './PlaybackCursorFollow';
