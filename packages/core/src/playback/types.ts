/**
 * 再生エンジン統合（L1〜L3 Webコア）の共通型・境界インターフェース（playback-integration.md §3〜§5）。
 *
 * 各モジュール（`PlaybackService` / `PlaybackSyncController` / `PlaybackMixerBinder` /
 * `MetronomeService` / `CountInController` / `TapTempoController` / `PlaybackCursorFollow`）は
 * alphaTab の生 `AlphaSynth` / `AlphaTabApi` に直接結合せず、ここで定義する最小契約にのみ依存する
 * （editing の `RenderRequester`、viewmodes の `ViewModeRenderHost` と同じ「テスト可能な縫い目」方針）。
 * 生 API との配線（`PlaybackSynth` の実体・`preWarm` の起動シーケンス挿入）は bootstrap（パッケージ8）／
 * Phase 1 実機検証の責務。
 */

import type { model } from '@coderline/alphatab';

// ===== AlphaSynth の薄い窓口 =====

/** midi tick の半開区間 `[startTick, endTick)`。alphaTab `PlaybackRange` と構造同一。 */
export interface TickRange {
  startTick: number;
  endTick: number;
}

/** alphaTab の再生位置イベント（Beat 単位で発火、05_playback_audio.md §5）。 */
export interface PlaybackPositionEvent {
  /** 現在の再生位置（midi tick）。 */
  currentTick: number;
  /** 曲全体の長さ（midi tick）。 */
  endTick: number;
  /** 現在の再生位置（ミリ秒）。 */
  currentTimeMs: number;
  /** 曲全体の長さ（ミリ秒）。 */
  endTimeMs: number;
  /** シークによる位置変化か（自前のループ再シーク等を無限ループさせないための判別）。 */
  isSeek: boolean;
}

/** alphaTab の再生状態変化イベント。 */
export interface PlaybackStateEvent {
  /** 再生中なら true、一時停止／停止なら false。 */
  playing: boolean;
  /** 停止（先頭へ戻る）なら true、単なる一時停止なら false。 */
  stopped: boolean;
}

/**
 * AlphaSynth を扱う唯一の薄い窓口（playback-integration.md「alphaTab 連携の注意」）。
 * 生 `AlphaSynth` はこのインターフェースの実装（bootstrap／Phase 1）に閉じ込め、
 * 本パッケージの他モジュールへは漏らさない。
 */
export interface PlaybackSynth {
  /** 再生中か。 */
  readonly isPlaying: boolean;
  /** 現在の再生位置（midi tick）。 */
  readonly currentTick: number;

  play(): void;
  pause(): void;
  stop(): void;
  /** 指定 tick へシークする。 */
  seekTick(tick: number): void;

  /** ループ／部分再生範囲を設定する（`null` で全曲）。 */
  setPlaybackRange(range: TickRange | null): void;
  /** ループ再生の ON/OFF。 */
  setLooping(looping: boolean): void;
  /** 基準テンポに対する再生倍率（減速再生。1 = 等倍、`> 0`）。 */
  setPlaybackSpeed(speed: number): void;
  /** メトロノーム音量（0 で無音）。 */
  setMetronomeVolume(volume: number): void;

  /** トラック（パート）チャンネルの音量。alphaTab の 0〜16 レンジ。 */
  setChannelVolume(trackIndex: number, volume: number): void;
  /** トラックチャンネルのパン（バランス）。 */
  setChannelPan(trackIndex: number, pan: number): void;
  /** トラックチャンネルのミュート。 */
  setChannelMute(trackIndex: number, mute: boolean): void;
  /** トラックチャンネルのソロ。 */
  setChannelSolo(trackIndex: number, solo: boolean): void;

  /** 指定トラックのみ最新の Score データで差し替える（`PartialReloadStrategy` 用）。 */
  reloadTracks(trackIndices: readonly number[], score: model.Score): void;
  /** 曲全体を最新の Score データで再ロードする（`PauseResumeStrategy` 用）。 */
  reloadAll(score: model.Score): void;

  /** 同梱 SoundFont を非同期ロードする（`preWarm`、§3.3）。冪等であること。 */
  loadSoundFont(): Promise<void>;

  /** 再生位置イベントの購読。戻り値で解除。 */
  onPositionChanged(listener: (event: PlaybackPositionEvent) => void): () => void;
  /** 再生状態イベントの購読。戻り値で解除。 */
  onStateChanged(listener: (event: PlaybackStateEvent) => void): () => void;
}

// ===== tick ↔ 小節の対応 =====

/**
 * midi tick と小節インデックス（0 始まり）の相互変換（境界検知・シーク先の解決に使う）。
 * 実体は alphaTab の `MidiTickLookup` または `MasterBar.calculateDuration()` から構築する
 * （`ArrayTickMap.fromScore`）。
 */
export interface TickMap {
  /** `tick` が属する小節インデックス（0 始まり）。範囲外は 0／最終小節へクランプ。 */
  tickToBarIndex(tick: number): number;
  /** 小節先頭の tick。`barIndex === barCount` は曲末の tick を返す（ループ終端指定に使う）。 */
  barStartTick(barIndex: number): number;
}

// ===== 編集反映方式（A4、§5） =====

/** `AudioSyncStrategy.sync` の実行文脈。 */
export interface AudioSyncContext {
  synth: PlaybackSynth;
  score: model.Score;
}

/**
 * 再生中に dirty になったトラックを AlphaSynth へ反映する方式（playback-integration.md §5、A4 対応）。
 * `PlaybackSyncController` は起動時設定でどちらの実装を使うかを受け取るだけ（設定切替のみで入替可能）。
 */
export interface AudioSyncStrategy {
  /** 実装識別子（設定・診断用）。 */
  readonly kind: 'partial-reload' | 'pause-resume';
  /** 小節境界到達時に呼ばれる。`dirtyTrackIndices` は 1 件以上。 */
  sync(dirtyTrackIndices: readonly number[], context: AudioSyncContext): void;
}

// ===== カーソル自動追従 =====

/**
 * `PlaybackCursorFollow` が要求する表示範囲コントローラの最小契約（`ViewModeController` が構造的に充足、
 * view-modes.md §9 の「表示範囲更新 API」）。
 */
export interface PlaybackViewport {
  /** `barIndex` が現在の表示範囲に入っているか。 */
  isBarVisible(barIndex: number): boolean;
  /** `barIndex` を表示範囲へ入れる（範囲内なら何もしない冪等実装が前提）。 */
  revealBar(barIndex: number): void;
}

// ===== 設定値（AppPreferencesService 由来、§4.4） =====

/**
 * メトロノーム／カウントイン／タップテンポが参照する設定値（playback-integration.md §4.4）。
 * bootstrap（パッケージ8）が `AppPreferencesService.load()` の戻り値からこの形へ写して供給する。
 */
export interface PlaybackPreferences {
  /** メトロノーム音色プリセット ID（C1）。 */
  metronomePresetId: string;
  /** メトロノーム音量（0〜1）。 */
  metronomeVolume: number;
  /** カウントイン小節数倍率（C2、1 小節 or 2 小節）。 */
  countInMeasureMultiplier: 1 | 2;
  /** タップテンポで平均する直近タップ数（3〜4 目安、§4.4）。 */
  tapTempoSampleSize: number;
}

/** `AppPreferencesService.load()` と同形の非同期取得口（テストでは fake を注入）。 */
export interface PlaybackPreferencesSource {
  load(): Promise<PlaybackPreferences>;
}

/** 設定未保存時の組み込み既定値（§4.4、C1＝アコースティック系／C2＝1 小節）。 */
export const DEFAULT_PLAYBACK_PREFERENCES: PlaybackPreferences = {
  metronomePresetId: 'acoustic',
  metronomeVolume: 0.8,
  countInMeasureMultiplier: 1,
  tapTempoSampleSize: 4,
};
