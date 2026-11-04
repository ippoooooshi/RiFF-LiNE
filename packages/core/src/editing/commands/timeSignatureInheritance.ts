/**
 * 継いでいる小節の拍子の値をそろえる（editing-core.md 3.2 節・10 節の (b)）。
 *
 * 置き場所の正は `packages/core/src/editing/scoreModel.ts`（10 節）。作業パッケージ 4 の区切り 2 では scoreModel.ts を
 * 別の作業者が持っていたので、ここに置いて、挿入・削除・拍子の変更のコマンドだけから呼ぶ。
 */

import type { model } from '@coderline/alphatab';

/**
 * 拍子をはっきり入れた小節の一覧（`explicitTimeSignatureBars`）に無い小節の `MasterBar` に、直前の小節と同じ拍子の値を置く。
 * 継ぐ向きの指定（一覧）を作り直す再計算ではなく、変わっていない指定から、alphaTab の `MasterBar` が小節ごとに持つ拍子の値を
 * 写し直すだけの処理とする（10 節の (b)）。1 小節目は継ぐ先が無いので、一覧に無くても値を変えない。
 * `InsertMasterBarCommand`・`DeleteMasterBarCommand`・`SetTimeSignatureCommand` の execute と undo の最後に呼ぶ。
 */
export function resolveInheritedTimeSignatures(score: model.Score, explicitBars: readonly number[]): void {
  const explicit = new Set(explicitBars);
  for (let i = 1; i < score.masterBars.length; i++) {
    // <!-- req editingcore:ecc4866b.79a7 -->
    if (explicit.has(i)) continue;
    const previous = score.masterBars[i - 1]!;
    const masterBar = score.masterBars[i]!;
    // <!-- req editingcore:b13f25dc.54b6 --> <!-- req editingcore:ecc4866b.b8ef -->
    masterBar.timeSignatureNumerator = previous.timeSignatureNumerator;
    masterBar.timeSignatureDenominator = previous.timeSignatureDenominator;
  }
}
