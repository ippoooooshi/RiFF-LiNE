/**
 * 再生エンジン統合パッケージのテスト用フェイク（tests.rule.md「alphaTab・I/O は fake で差し替え」）。
 * 本番コードからは import しない（`src/index.ts` バレルにも含めない）。
 */

import type { model } from '@coderline/alphatab';

import type { CommandAppliedEvent } from '../editing/types';
import type { MetronomeClick, MetronomeClickSink } from '../playback/MetronomeService';
import type { CommandAppliedSource } from '../playback/PlaybackSyncController';
import type { Command, EditTarget } from '../editing/types';
import type { TempoCommandSink } from '../playback/TapTempoController';
import type {
  PlaybackPositionEvent,
  PlaybackPreferences,
  PlaybackPreferencesSource,
  PlaybackStateEvent,
  PlaybackSynth,
  PlaybackViewport,
  TickMap,
  TickRange,
} from '../playback/types';
import { DEFAULT_PLAYBACK_PREFERENCES } from '../playback/types';

/** 記録できる `PlaybackSynth` 代役。位置／状態イベントをテストから発火できる。 */
export class FakePlaybackSynth implements PlaybackSynth {
  isPlaying = false;
  currentTick = 0;

  readonly calls: string[] = [];
  readonly seekTicks: number[] = [];
  readonly playbackRanges: Array<TickRange | null> = [];
  readonly loopingValues: boolean[] = [];
  readonly playbackSpeeds: number[] = [];
  readonly metronomeVolumes: number[] = [];
  readonly channelVolume = new Map<number, number>();
  readonly channelPan = new Map<number, number>();
  readonly channelMute = new Map<number, boolean>();
  readonly channelSolo = new Map<number, boolean>();
  readonly reloadTracksCalls: Array<{ trackIndices: number[]; score: model.Score }> = [];
  readonly reloadAllCalls: model.Score[] = [];
  loadSoundFontCallCount = 0;
  /** `loadSoundFont` を reject させたい場合にセットする。 */
  loadSoundFontError: unknown = null;

  private readonly positionListeners = new Set<(event: PlaybackPositionEvent) => void>();
  private readonly stateListeners = new Set<(event: PlaybackStateEvent) => void>();

  play(): void {
    this.calls.push('play');
    this.isPlaying = true;
  }

  pause(): void {
    this.calls.push('pause');
    this.isPlaying = false;
  }

  stop(): void {
    this.calls.push('stop');
    this.isPlaying = false;
    this.currentTick = 0;
  }

  seekTick(tick: number): void {
    this.calls.push(`seekTick:${tick}`);
    this.seekTicks.push(tick);
    this.currentTick = tick;
  }

  setPlaybackRange(range: TickRange | null): void {
    this.playbackRanges.push(range === null ? null : { ...range });
  }

  setLooping(looping: boolean): void {
    this.loopingValues.push(looping);
  }

  setPlaybackSpeed(speed: number): void {
    this.playbackSpeeds.push(speed);
  }

  setMetronomeVolume(volume: number): void {
    this.metronomeVolumes.push(volume);
  }

  setChannelVolume(trackIndex: number, volume: number): void {
    this.channelVolume.set(trackIndex, volume);
  }

  setChannelPan(trackIndex: number, pan: number): void {
    this.channelPan.set(trackIndex, pan);
  }

  setChannelMute(trackIndex: number, mute: boolean): void {
    this.channelMute.set(trackIndex, mute);
  }

  setChannelSolo(trackIndex: number, solo: boolean): void {
    this.channelSolo.set(trackIndex, solo);
  }

  reloadTracks(trackIndices: readonly number[], score: model.Score): void {
    this.reloadTracksCalls.push({ trackIndices: [...trackIndices], score });
  }

  reloadAll(score: model.Score): void {
    this.reloadAllCalls.push(score);
  }

  async loadSoundFont(): Promise<void> {
    this.loadSoundFontCallCount += 1;
    if (this.loadSoundFontError !== null) {
      throw this.loadSoundFontError;
    }
  }

  onPositionChanged(listener: (event: PlaybackPositionEvent) => void): () => void {
    this.positionListeners.add(listener);
    return () => this.positionListeners.delete(listener);
  }

  onStateChanged(listener: (event: PlaybackStateEvent) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  // ===== テスト操作 =====

  /** 再生位置イベントを発火する（`currentTick` も更新）。 */
  emitPosition(partial: Partial<PlaybackPositionEvent> & { currentTick: number }): void {
    this.currentTick = partial.currentTick;
    const event: PlaybackPositionEvent = {
      currentTick: partial.currentTick,
      endTick: partial.endTick ?? 100000,
      currentTimeMs: partial.currentTimeMs ?? 0,
      endTimeMs: partial.endTimeMs ?? 0,
      isSeek: partial.isSeek ?? false,
    };
    for (const listener of [...this.positionListeners]) listener(event);
  }

  /** 再生状態イベントを発火する（`isPlaying` も更新）。 */
  emitState(playing: boolean, stopped = !playing): void {
    this.isPlaying = playing;
    for (const listener of [...this.stateListeners]) listener({ playing, stopped });
  }

  get positionListenerCount(): number {
    return this.positionListeners.size;
  }

  get stateListenerCount(): number {
    return this.stateListeners.size;
  }
}

/** 明示した境界配列で tick⇔小節を変換する `TickMap` 代役。 */
export class FakeTickMap implements TickMap {
  /** 小節先頭 tick（昇順、長さ = 小節数 + 1）。既定は 1 小節 1000 tick を 8 小節。 */
  constructor(private readonly boundaries: readonly number[] = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]) {}

  tickToBarIndex(tick: number): number {
    const lastBar = this.boundaries.length - 2;
    if (tick <= 0) return 0;
    for (let barIndex = 0; barIndex <= lastBar; barIndex += 1) {
      if (tick < (this.boundaries[barIndex + 1] ?? Number.POSITIVE_INFINITY)) return barIndex;
    }
    return lastBar;
  }

  barStartTick(barIndex: number): number {
    const clamped = Math.min(Math.max(0, Math.floor(barIndex)), this.boundaries.length - 1);
    return this.boundaries[clamped] ?? 0;
  }
}

/** `CommandHistory.onCommandApplied` 代役。テストから通知を流せる。 */
export class FakeCommandAppliedSource implements CommandAppliedSource {
  private readonly listeners = new Set<(event: CommandAppliedEvent) => void>();

  onCommandApplied(listener: (event: CommandAppliedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** コマンド適用通知を発火する。 */
  emit(affectedTrackIndices: number[], phase: CommandAppliedEvent['phase'] = 'execute', kind = 'fake'): void {
    for (const listener of [...this.listeners]) listener({ phase, kind, affectedTrackIndices });
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

/** 固定の設定値を返す `PlaybackPreferencesSource` 代役。 */
export class FakePlaybackPreferences implements PlaybackPreferencesSource {
  private prefs: PlaybackPreferences;
  loadCallCount = 0;

  constructor(overrides: Partial<PlaybackPreferences> = {}) {
    this.prefs = { ...DEFAULT_PLAYBACK_PREFERENCES, ...overrides };
  }

  async load(): Promise<PlaybackPreferences> {
    this.loadCallCount += 1;
    return { ...this.prefs };
  }

  /** テスト中に設定値を差し替える。 */
  set(overrides: Partial<PlaybackPreferences>): void {
    this.prefs = { ...this.prefs, ...overrides };
  }
}

/** クリック発音要求を記録する `MetronomeClickSink` 代役。 */
export class RecordingMetronomeSink implements MetronomeClickSink {
  readonly clicks: MetronomeClick[] = [];

  playClick(click: MetronomeClick): void {
    this.clicks.push({ ...click });
  }
}

/** 待ち時間を記録しつつ即座に解決するスケジューラ。 */
export function createImmediateScheduler(): { schedule: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    schedule: async (ms: number) => {
      delays.push(ms);
    },
  };
}

/** `PlaybackViewport` 代役。可視判定を制御し、`revealBar` 呼び出しを記録する。 */
export class RecordingViewport implements PlaybackViewport {
  readonly revealedBars: number[] = [];
  /** 可視とみなす小節の集合。null なら常に可視。 */
  visibleBars: Set<number> | null = null;

  isBarVisible(barIndex: number): boolean {
    return this.visibleBars === null ? true : this.visibleBars.has(barIndex);
  }

  revealBar(barIndex: number): void {
    this.revealedBars.push(barIndex);
    if (this.visibleBars !== null) this.visibleBars.add(barIndex);
  }
}

/** 発行された `Command` を記録する `TempoCommandSink` 代役。 */
export class RecordingTempoCommandSink implements TempoCommandSink {
  readonly executed: Command[] = [];

  execute(command: Command): unknown {
    this.executed.push(command);
    return { cursorAdvance: 'none' };
  }
}

/** `EditTarget` は editing のフィクスチャに委譲する（重複生成を避ける）。 */
export type { EditTarget };
