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
// 開始を付ける・外すのは { isRepeatStart: true | false }、終わりの回数を付けるか変えるのは { repeatCount: n }（2 から 10）、外すのは { repeatCount: 0 }
export interface RepeatPatch {
  isRepeatStart?: boolean; // <!-- req editingcore:22eefbec.7827 --> <!-- req editingcore:13ef4f29.16e3 --> <!-- req editingcore:13ef4f29.d6df -->
  repeatCount?: number; // <!-- req editingcore:22eefbec.2007 --> <!-- req editingcore:13ef4f29.5ab6 --> <!-- req editingcore:13ef4f29.d195 -->
}

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

// <!-- req editingcore:6a9db0f2.0cad -->
// <!-- req editingcore:6a9db0f2.a23d --> <!-- req editingcore:41947410.271f --> <!-- req datamodelpersistence:60a46f26.bd80 --> <!-- req datamodelpersistence:60a46f26.8ef5 -->
// <!-- req editingcore:32d0d431.6643 --> <!-- req editingcore:13ef4f29.9a80 -->
export class SetRepeatCommand implements Command {
  readonly kind = 'set-repeat';
  readonly label = 'set-repeat';
  /** 全部のパート（リピートは曲共通の MasterBar が持つ）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly barIndex: number;
  private readonly patch: RepeatPatch;
  private before: RepeatPatch | null = null;

  // <!-- req editingcore:503a83ac.4dab -->
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
      // <!-- req datamodelpersistence:60a46f26.d88c -->
      masterBar.isRepeatStart = this.patch.isRepeatStart;
    }
    if (this.patch.repeatCount !== undefined) {
      before.repeatCount = masterBar.repeatCount;
      // <!-- req datamodelpersistence:60a46f26.d30b -->
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
      // patch で指定したキーの前の値だけを戻す（10 節）
      // <!-- req editingcore:13ef4f29.d606 -->
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
