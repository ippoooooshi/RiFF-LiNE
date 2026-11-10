/**
 * クリップボードの拍を、貼り付け先のパートのカーソルの位置へ挿入する（editing-core.md 2.6 節の表・9 節、基本設計 04 章 9 節）。
 *
 * `CompositeCommand`（2.3 節）を継ぎ、子として、クリップボードの拍ごとに、休符の拍を挿入する `InsertRestCommand`、
 * その拍へ音符を置く `PlaceNoteCommand`（音符ごと）、Note の奏法記号を写す `SetTechniqueCommand`（奏法記号のある音符ごと）、
 * Beat の奏法記号を写す `SetBeatTechniqueCommand`（あるときだけ）を、挿入する順に並べる（9 節）。1 回の取り消しで貼り付け全体が戻る。
 * 1 つのコマンドの形から、この形に直した（10 節、B33 の 2026-10-16 本人決定）。
 * 挿入するので今ある拍を上書きせず、小節の音価の合計が拍子を超えても拒まない（5 節）。貼り付け先はコピーした元と別のパートでもよい。
 *
 * 貼り付け先のパートの弦本数とチューニングとの合い方は、子を作る前に確かめる（B3 の決まり）。捨てた音符の子は作らない：
 *  - 貼り付け先の弦の数が足りない → はみ出す弦の音符を捨て、Warning（`EDIT-009`）で知らせる
 *  - 貼り付け先の弦の数が多い → 余った弦を使わないだけ。知らせない
 *  - チューニングが違う → フレットの数を保って写す（鳴る音の高さは貼り付け先の弦のチューニングで変わる、honnin-queue 54 番）。
 *    フレットの数の範囲（0 から 24、5 節）はどのパートでも同じなので、フレットの数で範囲の外になる音は無く、確かめで捨てる音は無い
 * 知らせは子を作るとき（コマンドを作るとき）に 1 回だけ出すので、取り消しの後のやり直しで出し直さない。
 */

import type { ClipboardSnapshot } from '../ClipboardService';
import { CompositeCommand } from '../CompositeCommand';
import { stringCount, voiceBeats } from '../scoreModel';
import type { CursorPosition, EditTarget } from '../types';
import type { Command } from './Command';
import type { NotificationReporter } from './CommandHistory';
import { InsertRestCommand } from './InsertRestCommand';
import { SetBeatTechniqueCommand, SetTechniqueCommand } from './noteAttributeCommands';
import { PlaceNoteCommand } from './PlaceNoteCommand';

/** 子のコマンドを、クリップボードの拍の順に作る。はみ出す弦の音符は子を作らず、その数を返す。 */
// <!-- req editingcore:d0f44358.71c7 --> <!-- req editingcore:d0f44358.4d15 --> <!-- req editingcore:2ec0c39e.fd3a -->
function buildChildren(
  target: EditTarget,
  position: CursorPosition,
  snapshot: ClipboardSnapshot,
): { children: Command[]; droppedCount: number; strings: number } {
  const strings = stringCount(target.score, position.trackIndex);
  // 2 つ目のボイスがまだ無い小節のボイス 2 は拍が 0 個のボイスと同じに数え、子が置くときにボイスを作る（4.1 節）
  const beats = voiceBeats(target.score, position.trackIndex, position.barIndex, position.voiceIndex);
  // カーソルが最後の拍の後ろより先を指していても、拍は最後の拍の後ろから続けて挿入する
  const start = Math.min(position.beatIndex, beats.length);
  const children: Command[] = [];
  let droppedCount = 0;
  // 貼り付け先のパートの、カーソルのある小節と拍の前へ、クリップボードの拍を順に挿入する（今ある拍は後ろへずれ、上書きしない）
  // <!-- req editingcore:5169e1de.f1b0 --> <!-- req editingcore:5169e1de.4edf --> <!-- req editingcore:005fc877.6d59 --> <!-- req editingcore:005fc877.4b2c -->
  // <!-- req editingcore:005fc877.19f7 --> <!-- req editingcore:7a2abc92.4b22 --> <!-- req editingcore:7a2abc92.ebb6 --> <!-- req editingcore:2ec0c39e.f432 -->
  // <!-- req editingcore:d0f44358.6fc1 -->
  snapshot.beats.forEach((clip, offset) => {
    const at: CursorPosition = { ...position, beatIndex: start + offset };
    // <!-- req editingcore:45e79c28.5d6e --> <!-- req editingcore:2ec0c39e.96b6 -->
    children.push(new InsertRestCommand(target, at, clip.duration));
    for (const note of clip.notes) {
      // 弦の数が足りないときは、はみ出す弦の音符を捨て、その子を作らない。多いときは余った弦を使わないだけで、知らせない
      // <!-- req editingcore:3f84e2be.fbfc --> <!-- req editingcore:2ec0c39e.b74b --> <!-- req editingcore:7059f7f4.e953 --> <!-- req editingcore:7059f7f4.71ad -->
      // <!-- req editingcore:488b9e35.122f --> <!-- req editingcore:7282de01.d85e -->
      if (note.string < 1 || note.string > strings) {
        droppedCount += 1;
        continue;
      }
      // 休符の拍へ置くと音符の拍に変わり、2 つ目からは和音として足す（PlaceNoteCommand の 3 通り）。
      // フレットの数を保って写す（チューニングの違うパートでも同じ数。0 から 24 はどのパートでも同じなので範囲の外にならない）
      // <!-- req editingcore:2ec0c39e.5263 --> <!-- req editingcore:7059f7f4.83dc --> <!-- req editingcore:7059f7f4.30d1 -->
      // <!-- req editingcore:7059f7f4.f659 --> <!-- req editingcore:7059f7f4.c84d -->
      children.push(new PlaceNoteCommand(target, at, note.string, note.fret, clip.duration));
      // <!-- req editingcore:2ec0c39e.6a46 -->
      if (Object.keys(note.techniques).length > 0) {
        children.push(new SetTechniqueCommand(target, at, note.string, note.techniques));
      }
    }
    // <!-- req editingcore:2ec0c39e.d511 -->
    if (Object.keys(clip.beatTechniques).length > 0) {
      children.push(new SetBeatTechniqueCommand(target, at, clip.beatTechniques));
    }
  });
  return { children, droppedCount, strings };
}

// <!-- req editingcore:45e79c28.156c --> <!-- req editingcore:45e79c28.f017 --> <!-- req editingcore:b4686279.4d38 -->
// <!-- req editingcore:2ec0c39e.c8ec --> <!-- req editingcore:2ec0c39e.52eb --> <!-- req editingcore:22e5779d.3c83 --> <!-- req editingcore:22e5779d.a394 -->
// <!-- req editingcore:c819007d.5075 --> <!-- req editingcore:c819007d.61ae --> <!-- req editingcore:e7a453aa.661d --> <!-- req editingcore:e7a453aa.a1f6 -->
export class PasteCommand extends CompositeCommand {
  /**
   * kind 'paste'。子は 9 節の箇条の順。はみ出す弦の音符は子を作らず、EDIT-009 を reporter で知らせる。
   * affectedTrackIndices は子の和集合で、貼り付け先のパート（2.6 節の表）。
   */
  // <!-- req editingcore:98f5ed96.4d43 -->
  constructor(
    target: EditTarget,
    position: CursorPosition,
    snapshot: ClipboardSnapshot,
    reporter: NotificationReporter,
  ) {
    const { children, droppedCount, strings } = buildChildren(target, position, snapshot);
    // <!-- req editingcore:45e79c28.aa56 -->
    super('paste', 'paste', children);
    // <!-- req editingcore:3f84e2be.0cfd --> <!-- req editingcore:7059f7f4.6889 -->
    if (droppedCount > 0) reporter.report('EDIT-009', { droppedCount, targetStringCount: strings });
  }
}
