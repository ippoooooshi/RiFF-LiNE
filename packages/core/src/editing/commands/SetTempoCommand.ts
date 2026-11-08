/**
 * 小節のテンポ（BPM）を変える（editing-core.md 2.6 節の表・3.2 節・3.8 節、要件 4.1「数値直接入力＋タップテンポ」）。
 *
 * テンポは曲共通で、実体は alphaTab の `MasterBar.tempoAutomations` が持つ（3.2 節）。テンポを変える小節にだけ
 * `tempoAutomations` を置き、置かない小節は直前のテンポが続く。継ぐ状態へ戻すとき（`bpm` が null）は、その小節の
 * `tempoAutomations` を空にする（3.2 節の (b)）。
 *
 * 発行元は数値の直接入力と `TapTempoController`（playback-integration.md 6.4 節・11 節）。タップテンポが続けて叩いた分は
 * 同じ `tapSessionId` を持ち、同じ小節で同じ番号のものだけを `canMergeWith` で履歴の 1 つにまとめる。取り消すと叩き始める前の
 * テンポに戻る。数値の入力から出すものは番号を持たず、まとめない。
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { allTrackIndices, getMasterBar } from '../scoreModel';
import type { CommandOutcome, EditTarget } from '../types';
import type { Command } from './Command';

/** 実装時に確定してよい BPM 入力範囲（一般的な楽曲テンポの外側を弾く）。 */
export const MIN_TEMPO_BPM = 20;
export const MAX_TEMPO_BPM = 400;

/** BPM が入力可能範囲内か（`EditingService` が呼ぶ。範囲外は発行しない）。 */
export function isValidTempoBpm(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm >= MIN_TEMPO_BPM && bpm <= MAX_TEMPO_BPM;
}

// <!-- req editingcore:f9c09b25.452f --> <!-- req editingcore:bdac6e6b.a482 --> <!-- req editingcore:bdac6e6b.a0fb -->
// <!-- req editingcore:029804ea.a2d1 --> <!-- req editingcore:029804ea.6bfd -->
export class SetTempoCommand implements Command {
  readonly kind = 'set-tempo';
  readonly label = 'set-tempo';
  /** 全部のパート（テンポは曲共通の MasterBar が持つ）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly barIndex: number;
  private readonly bpm: number | null;
  private readonly tapSessionId: number | undefined;
  /** 変える前の `tempoAutomations`。まとめたときは、まとめた中で一番古いコマンドの変える前の値を引き継ぐ。 */
  private previous: model.Automation[] | null = null;

  /**
   * @param bpm null なら継ぐ状態へ戻す（その小節の `tempoAutomations` を空にする）。
   * @param tapSessionId タップテンポが続けて叩いた分に付ける番号。同じ小節で同じ番号のものだけをまとめる。
   */
  // <!-- req editingcore:efdff50a.9ec9 --> <!-- req editingcore:efdff50a.50f7 --> <!-- req editingcore:efdff50a.b234 --> <!-- req editingcore:efdff50a.5018 -->
  constructor(target: EditTarget, barIndex: number, bpm: number | null, tapSessionId?: number) {
    this.score = target.score;
    this.barIndex = barIndex;
    this.bpm = bpm;
    this.tapSessionId = tapSessionId;
    // <!-- req editingcore:f9c09b25.0a04 -->
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const masterBar = getMasterBar(this.score, this.barIndex);
    this.previous ??= [...masterBar.tempoAutomations];
    // <!-- req editingcore:f9c09b25.8b04 --> <!-- req editingcore:af3f1af2.2c14 --> <!-- req editingcore:0dce4f92.dc89 -->
    // <!-- req datamodelpersistence:806faf90.2c14 --> <!-- req webcorefoundation:b751fe7e.cd03 -->
    // <!-- req editingcore:029804ea.702f -->
    masterBar.tempoAutomations =
      // <!-- req editingcore:b13f25dc.5fac --> <!-- req editingcore:0dce4f92.c3e1 --> <!-- req editingcore:0dce4f92.cbc8 --> <!-- req editingcore:0dce4f92.2108 --> <!-- req editingcore:0dce4f92.25e1 -->
      this.bpm === null ? [] : [model.Automation.buildTempoAutomation(false, 0, this.bpm, this.bpm, true)];
    return { cursorAdvance: 'none' };
  }

  undo(): CommandOutcome {
    const masterBar = getMasterBar(this.score, this.barIndex);
    masterBar.tempoAutomations = this.previous ?? [];
    return { cursorAdvance: 'none' };
  }

  /** 同じ小節で、同じタップの番号を持つ `SetTempoCommand` だけをまとめる（番号を持たないものはまとめない）。 */
  canMergeWith(other: Command): boolean {
    return (
      other instanceof SetTempoCommand &&
      this.tapSessionId !== undefined &&
      other.tapSessionId === this.tapSessionId &&
      other.barIndex === this.barIndex
    );
  }

  /** 古いほう（other）の変える前の値を引き継ぎ、1 回の取り消しで叩き始める前のテンポに戻す。 */
  mergeWith(other: Command): void {
    if (other instanceof SetTempoCommand && other.previous !== null) this.previous = other.previous;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
