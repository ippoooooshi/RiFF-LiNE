/**
 * リピートを付ける・外す（editing-core.md 2.6 節の表・3.10 節・10 節、G26 の是正）。
 *
 * リピートは alphaTab の `MasterBar.isRepeatStart`・`MasterBar.repeatCount` で持つ（3.10 節、data-model-persistence.md 6.1 節）。
 * patch で指定したキーだけを変え、`undo` は指定したキーの前の値を戻す（10 節）。
 * 開始を付けるのは `{ isRepeatStart: true }`、外すのは `{ isRepeatStart: false }`、終わりの回数を付けるか変えるのは `{ repeatCount: n }`、
 * 外すのは `{ repeatCount: 0 }`。回数の確かめ（`EDIT-011`・`EDIT-015`）は `ValidationService.validateRepeat` が発行の前に行う。
 */

import type { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { allTrackIndices, getMasterBar } from '../scoreModel';
import type { CommandOutcome, EditTarget } from '../types';
import type { Command } from './Command';

/** リピートの変える項目（editing-core.md 10 節）。指定したキーだけを変える。 */
export interface RepeatPatch {
  isRepeatStart?: boolean;
  repeatCount?: number;
}

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

// <!-- req editingcore:6a9db0f2.0cad -->
export class SetRepeatCommand implements Command {
  readonly kind = 'set-repeat';
  readonly label = 'set-repeat';
  /** 全部のパート（リピートは曲共通の MasterBar が持つ）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly barIndex: number;
  private readonly patch: RepeatPatch;
  private before: RepeatPatch | null = null;

  constructor(target: EditTarget, barIndex: number, patch: RepeatPatch) {
    this.score = target.score;
    this.barIndex = barIndex;
    this.patch = patch;
    // <!-- req editingcore:6a9db0f2.6571 -->
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const masterBar = getMasterBar(this.score, this.barIndex);
    const before: RepeatPatch = {};
    if (this.patch.isRepeatStart !== undefined) {
      before.isRepeatStart = masterBar.isRepeatStart;
      masterBar.isRepeatStart = this.patch.isRepeatStart;
    }
    if (this.patch.repeatCount !== undefined) {
      before.repeatCount = masterBar.repeatCount;
      masterBar.repeatCount = this.patch.repeatCount;
    }
    this.before = before;
    // alphaTab のリピートのまとまり（RepeatGroup）は Score.finish では作り直されないので、変えた後に組み直す
    this.score.rebuildRepeatGroups();
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.before !== null) {
      const masterBar = getMasterBar(this.score, this.barIndex);
      if (this.before.isRepeatStart !== undefined) masterBar.isRepeatStart = this.before.isRepeatStart;
      if (this.before.repeatCount !== undefined) masterBar.repeatCount = this.before.repeatCount;
      this.score.rebuildRepeatGroups();
    }
    this.before = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
