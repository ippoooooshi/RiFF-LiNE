/**
 * 対象 Bar のテンポ（BPM）を設定する（editing-core.md §6.4、要件4.1「数値直接入力＋タップテンポ」）。
 *
 * 発行元は将来の数値直接入力 UI（パッケージ8）と `TapTempoController`（playback-integration.md §4.4）の両方。
 * `null` を渡すと当該 Bar のテンポ自動化を取り除き「直前から継承」状態へ戻す（B5 と同じ継承の考え方）。
 *
 * alphaTab では `MasterBar.tempoAutomations`（`AutomationType.Tempo`）で表現される。空配列＝継承。
 * `affectedTrackIndices` は全パート（Bar は全パート共通構造、editing-core.md §6.4）。
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { allTrackIndices, getMasterBar } from '../scoreModel';
import type { Command, CommandOutcome, EditTarget } from '../types';

/** 実装時に確定してよい BPM 入力範囲（editing-core.md §6.4）。一般的な楽曲テンポの外側を弾く。 */
export const MIN_TEMPO_BPM = 20;
export const MAX_TEMPO_BPM = 400;

/** BPM が入力可能範囲内か（`EditingService` が呼ぶ。範囲外は発行しない）。 */
export function isValidTempoBpm(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm >= MIN_TEMPO_BPM && bpm <= MAX_TEMPO_BPM;
}

export class SetTempoCommand implements Command {
  readonly kind = 'set-tempo';
  readonly label = 'テンポ';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly barIndex: number;
  private readonly bpm: number | null;
  private previous: model.Automation[] | null = null;

  constructor(target: EditTarget, barIndex: number, bpm: number | null) {
    this.score = target.score;
    this.barIndex = barIndex;
    this.bpm = bpm;
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const masterBar = getMasterBar(this.score, this.barIndex);
    this.previous = [...masterBar.tempoAutomations];
    masterBar.tempoAutomations =
      this.bpm === null ? [] : [model.Automation.buildTempoAutomation(false, 0, this.bpm, this.bpm, true)];
    return { cursorAdvance: 'none' };
  }

  undo(): CommandOutcome {
    const masterBar = getMasterBar(this.score, this.barIndex);
    masterBar.tempoAutomations = this.previous ?? [];
    this.previous = null;
    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
