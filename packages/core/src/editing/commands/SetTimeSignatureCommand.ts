/**
 * 既存の小節の拍子を変える（editing-core.md 2.6 節の表・3.2 節・10 節、G26 の是正）。
 *
 * 拍子の実体は alphaTab の `MasterBar`（`Score.masterBars`）の `timeSignatureNumerator`・`timeSignatureDenominator` が持つ（3.2 節）。
 * 直前の小節から継いでいるか、はっきり入れたかの印は `appMeta.settings.explicitTimeSignatureBars` で持つ。
 * 値を入れたら一覧に足し、`null` で継ぐ状態へ戻したら一覧から外す（`SetTempoCommand` と対称、10 節）。
 * 書き換えた後の一覧は小さい順に並べ、継いでいる小節の値は `resolveInheritedTimeSignatures` で execute と undo の最後にそろえる。
 * 拍子を縮めて小節の合計が拍子を超えても、今ある拍は捨てない（B38）。
 */

import type { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { allTrackIndices, getMasterBar } from '../scoreModel';
import type { CommandOutcome, EditTarget } from '../types';
import type { Command } from './Command';
import { resolveInheritedTimeSignatures } from './timeSignatureInheritance';

/** 拍子（editing-core.md 10 節）。範囲の確かめは `ValidationService.validateTimeSignature`（`EDIT-010`）。 */
export interface TimeSignatureSpec {
  numerator: number;
  denominator: number;
}

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

// <!-- req editingcore:fe1d757b.03ff -->
export class SetTimeSignatureCommand implements Command {
  readonly kind = 'set-time-signature';
  readonly label = 'set-time-signature';
  /** 全部のパート（拍子は曲共通の MasterBar が持つ、3.2 節）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly explicitBars: number[];
  private readonly barIndex: number;
  private readonly signature: TimeSignatureSpec | null;
  private before: { explicitBars: number[]; numerator: number; denominator: number } | null = null;

  /** @param signature null なら継ぐ状態へ戻す。1 小節目は継ぐ先が無いので、null を渡しても一覧から外さない（3.2 節）。 */
  constructor(target: EditTarget, barIndex: number, signature: TimeSignatureSpec | null) {
    this.score = target.score;
    this.explicitBars = target.appMeta.settings.explicitTimeSignatureBars;
    this.barIndex = barIndex;
    this.signature = signature;
    // <!-- req editingcore:fe1d757b.6833 -->
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const masterBar = getMasterBar(this.score, this.barIndex);
    this.before = {
      explicitBars: [...this.explicitBars],
      numerator: masterBar.timeSignatureNumerator,
      denominator: masterBar.timeSignatureDenominator,
    };

    // <!-- req editingcore:e7b133d1.5519 -->
    const others = this.explicitBars.filter((index) => index !== this.barIndex);
    if (this.signature !== null) {
      // 値を入れたら一覧に足す
      // <!-- req editingcore:fe1d757b.2730 --> <!-- req editingcore:af3f1af2.64eb -->
      masterBar.timeSignatureNumerator = this.signature.numerator;
      // <!-- req editingcore:af3f1af2.b2e8 -->
      masterBar.timeSignatureDenominator = this.signature.denominator;
      // <!-- req editingcore:e7b133d1.6e86 -->
      others.push(this.barIndex);
      // <!-- req editingcore:e7b133d1.fd3a -->
    } else if (this.barIndex === 0) {
      // 1 小節目は、いつも一覧に入れる
      others.push(this.barIndex);
    }
    // null で継ぐ状態へ戻したら一覧から外す（others に足さない）。書き換えた後の一覧は小さい順に並べる
    // <!-- req editingcore:e7b133d1.9181 --> <!-- req editingcore:e7b133d1.2405 -->
    this.explicitBars.splice(0, this.explicitBars.length, ...others.sort((a, b) => a - b));
    resolveInheritedTimeSignatures(this.score, this.explicitBars);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.before !== null) {
      const masterBar = getMasterBar(this.score, this.barIndex);
      masterBar.timeSignatureNumerator = this.before.numerator;
      masterBar.timeSignatureDenominator = this.before.denominator;
      // undo で一覧を変更の前に戻す
      // <!-- req editingcore:e7b133d1.7683 -->
      this.explicitBars.splice(0, this.explicitBars.length, ...this.before.explicitBars);
      resolveInheritedTimeSignatures(this.score, this.explicitBars);
    }
    this.before = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
