/**
 * 再生制御ファサード（playback-integration.md §4.1・§3.2・§3.3）。
 *
 * UI へは「再生／停止／シーク／区間ループ／セクションループ／ソロ再生指定／テンポ倍率」という
 * 抽象操作のみを公開する（05_playback_audio.md §1）。編集ウィンドウ（＝開いている曲）ごとに 1 インスタンス。
 * alphaTab の生 API には触れず、`PlaybackSynth` 経由でのみ AlphaSynth を扱う。
 */

import type { model } from '@coderline/alphatab';

import { computeRealMidiPitch } from '../domain/pitch';
import { getStaff, openStringPitch } from '../editing/scoreModel';

import type { PlaybackPositionEvent, PlaybackSynth, TickMap, TickRange } from './types';

export interface PlaybackServiceOptions {
  /** `preWarm()` の SoundFont ロード失敗を握り潰さず通知したい場合のフック（省略時は再 throw）。 */
  onPreWarmError?: (error: unknown) => void;
}

/** 記譜フレット指定のノート（`resolvePlaybackPitch` の入力）。 */
export interface FrettedNoteRef {
  /** alphaTab 規約の弦番号（1 = 最低音弦）。 */
  string: number;
  /** 記譜フレット番号（0〜24）。 */
  fret: number;
}

export class PlaybackService {
  /** ループ有効時の先頭 tick（開始小節の先頭）。無効時は null。 */
  private loopStartTick: number | null = null;
  /** ループ有効時の終端 tick（終了小節の次の小節先頭）。無効時は null。 */
  private loopEndTick: number | null = null;
  /** `preWarm()` の多重起動を防ぐ（1 度だけ SoundFont ロードを開始する）。 */
  private preWarmPromise: Promise<void> | null = null;

  private readonly unsubscribePosition: () => void;

  constructor(
    private readonly synth: PlaybackSynth,
    private readonly tickMap: TickMap,
    private readonly score: model.Score,
    private readonly options: PlaybackServiceOptions = {},
  ) {
    // ループ境界検知→開始小節の先頭へシークし直す（§4.1、05_playback_audio.md §3.1）。
    this.unsubscribePosition = synth.onPositionChanged((event) => this.onPositionChanged(event));
  }

  // ===== 先行初期化（§3.3） =====

  /**
   * AlphaSynth の SoundFont を非同期ロードする（アプリ起動直後・曲一覧表示と並行）。
   * 2 度目以降は最初の呼び出しと同じ Promise を返す（冪等）。
   */
  preWarm(): Promise<void> {
    if (this.preWarmPromise === null) {
      this.preWarmPromise = this.synth.loadSoundFont().catch((error: unknown) => {
        // 失敗しても preWarm 自体は完了扱いにし（再生時に再度ロードが走る）、通知は呼び出し側へ委ねる。
        if (this.options.onPreWarmError) {
          this.options.onPreWarmError(error);
          return;
        }
        throw error;
      });
    }
    return this.preWarmPromise;
  }

  // ===== 再生制御（§4.1） =====

  /** 再生を開始／再開する。 */
  play(): void {
    this.synth.play();
  }

  /** 一時停止する（位置は保持）。 */
  pause(): void {
    this.synth.pause();
  }

  /** 停止する（先頭へ戻る）。 */
  stop(): void {
    this.synth.stop();
  }

  /** 指定小節の先頭へシークする。 */
  seekToBar(barIndex: number): void {
    this.synth.seekTick(this.tickMap.barStartTick(barIndex));
  }

  /** 現在再生中か。 */
  get isPlaying(): boolean {
    return this.synth.isPlaying;
  }

  // ===== ループ（§4.1、05_playback_audio.md §3.1） =====

  /** 区間ループを設定する（開始・終了は小節インデックス、両端含む）。 */
  setRegionLoop(startBarIndex: number, endBarIndex: number): void {
    const start = Math.min(startBarIndex, endBarIndex);
    const end = Math.max(startBarIndex, endBarIndex);
    this.applyLoop(start, end);
  }

  /**
   * セクションループを設定する。`sectionStartBarIndex` のセクションマーカーが示す範囲
   * （次のセクション開始小節の手前、無ければ曲末まで）を自動的にループ範囲にする。
   */
  setSectionLoop(sectionStartBarIndex: number): void {
    const masterBars = this.score.masterBars;
    const start = Math.min(Math.max(0, Math.floor(sectionStartBarIndex)), masterBars.length - 1);
    let end = masterBars.length - 1;
    for (let barIndex = start + 1; barIndex < masterBars.length; barIndex += 1) {
      // 次のセクションマーカー（`MasterBar.section` が非 null）の手前までが 1 セクション。
      if (masterBars[barIndex]?.section != null) {
        end = barIndex - 1;
        break;
      }
    }
    this.applyLoop(start, end);
  }

  /** ループを解除する（全曲再生へ戻す）。 */
  clearLoop(): void {
    this.loopStartTick = null;
    this.loopEndTick = null;
    this.synth.setLooping(false);
    this.synth.setPlaybackRange(null);
  }

  // ===== ソロ再生・テンポ倍率（§4.1、05_playback_audio.md §2・§4） =====

  /** ソロ再生するトラックを指定する（空配列でソロ解除）。指定外はチャンネルソロを OFF にする。 */
  setSoloTracks(trackIndices: readonly number[]): void {
    const soloSet = new Set(trackIndices);
    for (let trackIndex = 0; trackIndex < this.score.tracks.length; trackIndex += 1) {
      this.synth.setChannelSolo(trackIndex, soloSet.has(trackIndex));
    }
  }

  /**
   * 基準テンポに対する再生倍率を設定する（減速再生。1 = 等倍）。
   * @throws `factor` が 0 以下・非有限の場合。
   */
  setTempoFactor(factor: number): void {
    if (!(factor > 0)) {
      throw new RangeError(`PlaybackService.setTempoFactor() requires factor > 0 (got: ${String(factor)}).`);
    }
    this.synth.setPlaybackSpeed(factor);
  }

  // ===== カポ実音変換（§3.2、B18） =====

  /**
   * 記譜フレットを再生用の実 MIDI ピッチへ変換する（`computeRealMidiPitch`、譜面表示は変えない）。
   * 開放弦ピッチは弦番号規約（G22）に従い `openStringPitch` で解決する。
   */
  resolvePlaybackPitch(trackIndex: number, note: FrettedNoteRef): number {
    const staff = getStaff(this.score, trackIndex);
    return computeRealMidiPitch(openStringPitch(staff, note.string), staff.capo, note.fret);
  }

  /** 購読を解除する（ウィンドウクローズ時）。 */
  dispose(): void {
    this.unsubscribePosition();
  }

  // ===== 内部 =====

  /** 小節レンジ [start, end]（両端含む）を tick レンジ [startTick, endTick) へ変換してループを張る。 */
  private applyLoop(startBarIndex: number, endBarIndex: number): void {
    this.loopStartTick = this.tickMap.barStartTick(startBarIndex);
    this.loopEndTick = this.tickMap.barStartTick(endBarIndex + 1);
    const range: TickRange = { startTick: this.loopStartTick, endTick: this.loopEndTick };
    this.synth.setPlaybackRange(range);
    this.synth.setLooping(true);
  }

  /**
   * 再生位置イベント。ループ有効中に終端 tick へ達したら開始小節の先頭へシークし直す（§4.1）。
   * シーク由来のイベント（自分の再シーク・UI 操作）は無視して無限ループを防ぐ。
   */
  private onPositionChanged(event: PlaybackPositionEvent): void {
    if (this.loopStartTick === null || this.loopEndTick === null) return;
    if (event.isSeek) return;
    if (event.currentTick >= this.loopEndTick) {
      this.synth.seekTick(this.loopStartTick);
    }
  }
}
