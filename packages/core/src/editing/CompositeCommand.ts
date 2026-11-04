/**
 * いくつかの `Command` を履歴の 1 つの項目にまとめる（editing-core.md 2.3 節）。
 *
 * 貼り付けや小節の挿入のように、1 回の取り消しで全部戻す操作に使う。置き場所は editing-core.md 2 節の宣言のとおり
 * editing の直下で、2.1 節の import の決まり（画面のモジュール・react・alphaTab の描画と再生の API を import しない）を当てる。
 */

import type { Command, CommandLabelId } from './commands/Command';
import type { CommandOutcome } from './types';

// <!-- req editingcore:bf001374.7472 --> <!-- req editingcore:bf001374.b231 --> <!-- req editingcore:ff8d401a.594d --> <!-- req editingcore:cd299ae2.f27a --> <!-- req editingcore:cd299ae2.58ed --> <!-- req editingcore:cd299ae2.90fa --> <!-- req editingcore:bee5ce00.8d57 -->
export class CompositeCommand implements Command {
  readonly kind: string;
  readonly label: CommandLabelId;
  private readonly children: readonly Command[];

  /**
   * @param kind まとめ全体の種類の名前（例 'insert-bar'）。
   * @param label 取り消し・やり直しで見せるラベルの id。
   * @param children 実行する順に並べた子のコマンド。1 つ以上。
   */
  // <!-- req editingcore:1a6d2e82.7a32 -->
  constructor(kind: string, label: CommandLabelId, children: readonly Command[]) {
    if (children.length === 0) throw new Error('CompositeCommand requires at least one child command');
    this.kind = kind;
    this.label = label;
    this.children = children;
  }

  /** 子の affectedTrackIndices の和集合（editing-core.md 2.3 節）。小さい順に並べる。 */
  get affectedTrackIndices(): readonly number[] {
    const merged = new Set<number>();
    for (const child of this.children) {
      for (const index of child.affectedTrackIndices) merged.add(index);
    }
    return [...merged].sort((a, b) => a - b);
  }

  /** 子を前から順に実行する（editing-core.md 2.3 節）。カーソルは動かさない（2.2 節の CommandOutcome）。 */
  execute(): CommandOutcome {
    for (const child of this.children) {
      child.execute();
    }
    return { cursorAdvance: 'none' };
  }

  /** 子を後ろから順に取り消す（editing-core.md 2.3 節）。 */
  undo(): CommandOutcome {
    for (let i = this.children.length - 1; i >= 0; i--) {
      this.children[i]!.undo();
    }
    return { cursorAdvance: 'none' };
  }

  /** 中のコマンドの推定の大きさの合計（editing-core.md 2.3 節。予算の計算に入れる）。 */
  // <!-- req editingcore:ef358c5f.e57b --> <!-- req editingcore:ef358c5f.3738 -->
  estimateSizeBytes(): number {
    return this.children.reduce((sum, child) => sum + child.estimateSizeBytes(), 0);
  }
}
