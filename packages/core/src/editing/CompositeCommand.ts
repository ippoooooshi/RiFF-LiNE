/**
 * 複数の `Command` を 1 つの履歴エントリとして束ねる（editing-core.md §6.3、04_editing_core.md §9・§10）。
 *
 * `execute` は登録順、`undo` は逆順。`affectedTrackIndices` は内包コマンドの合併集合。
 * `InsertBarCommand` / `DeleteBarCommand` / `PasteCommand` がこの形で実装される。
 */

import type { Command, CommandOutcome } from './types';

export class CompositeCommand implements Command {
  readonly kind: string;
  readonly label: string;
  private readonly children: readonly Command[];

  /**
   * @param kind 束ね全体の安定識別子（例：`'insert-bar'`）。
   * @param label Undo/Redo 履歴に見せるラベル。
   * @param children 実行順に並んだ子コマンド。1 つ以上。
   */
  constructor(kind: string, label: string, children: readonly Command[]) {
    if (children.length === 0) throw new Error('CompositeCommand requires at least one child command');
    this.kind = kind;
    this.label = label;
    this.children = children;
  }

  get affectedTrackIndices(): readonly number[] {
    const merged = new Set<number>();
    for (const child of this.children) {
      for (const index of child.affectedTrackIndices) merged.add(index);
    }
    return [...merged].sort((a, b) => a - b);
  }

  /** 子を登録順に実行する。カーソル前進は最後の子の結果に従う。 */
  execute(): CommandOutcome {
    let outcome: CommandOutcome = { cursorAdvance: 'none' };
    for (const child of this.children) {
      outcome = child.execute();
    }
    return outcome;
  }

  /** 子を逆順に取り消す。 */
  undo(): CommandOutcome {
    for (let i = this.children.length - 1; i >= 0; i--) {
      this.children[i]!.undo();
    }
    return { cursorAdvance: 'none' };
  }

  /** 内包する全子コマンドの推定サイズ合計（§6.2 の予算計算）。 */
  estimateSizeBytes(): number {
    return this.children.reduce((sum, child) => sum + child.estimateSizeBytes(), 0);
  }
}
