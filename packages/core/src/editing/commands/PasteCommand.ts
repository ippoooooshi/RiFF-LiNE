/**
 * クリップボードの拍を、貼り付け先のパートのカーソルの位置へ挿入する（editing-core.md 2.6 節の表・9 節、基本設計 04 章 9 節）。
 *
 * `CompositeCommand`（2.3 節）を継ぎ、子として、クリップボードの拍ごとに、休符の拍を挿入する `InsertRestCommand` と、
 * その拍へ音符を置く `PlaceNoteCommand`（音符ごと）を、挿入する順に並べる（9 節）。1 回の取り消しで貼り付け全体が戻る。
 * 挿入するので今ある拍を上書きせず、小節の音価の合計が拍子を超えても拒まない（5 節）。
 *
 * 弦の数の確かめ（B3 の決まり）は子を作る前に行い、捨てた音符の子は作らない：
 *  - 貼り付け先の弦の数が足りない → はみ出す弦の音符を捨て、Warning（`EDIT-009`）で知らせる
 *  - 貼り付け先の弦の数が多い → 余った弦を使わないだけ。知らせない
 * 知らせは子を作るとき（コマンドを作るとき）に 1 回だけ出すので、取り消しの後のやり直しで出し直さない。
 *
 * チューニングの違うパートへ貼るときは、フレットの数を保って写す（9 節）。
 */

import type { ClipboardSnapshot } from '../ClipboardService';
import { CompositeCommand } from '../CompositeCommand';
import { getBar, getVoice, stringCount } from '../scoreModel';
import type { BeatDurationSpec, CursorPosition, EditTarget } from '../types';
import type { Command } from './Command';
import type { NotificationReporter } from './CommandHistory';
import { InsertRestCommand } from './InsertRestCommand';
import { PlaceNoteCommand } from './PlaceNoteCommand';

/** 子のコマンドを、クリップボードの拍の順に作る。はみ出す弦の音符は子を作らず、その数を返す。 */
function buildChildren(
  target: EditTarget,
  position: CursorPosition,
  snapshot: ClipboardSnapshot,
): { children: Command[]; droppedCount: number; strings: number } {
  const strings = stringCount(target.score, position.trackIndex);
  const beats = getVoice(getBar(target.score, position.trackIndex, position.barIndex)).beats;
  // カーソルが最後の拍の後ろより先を指していても、拍は最後の拍の後ろから続けて挿入する
  const start = Math.min(position.beatIndex, beats.length);
  const children: Command[] = [];
  let droppedCount = 0;
  snapshot.beats.forEach((clip, offset) => {
    const at: CursorPosition = { ...position, beatIndex: start + offset };
    const spec: BeatDurationSpec = { duration: clip.duration, dots: 0, tuplet: null };
    // <!-- req editingcore:45e79c28.5d6e -->
    children.push(new InsertRestCommand(target, at, spec));
    for (const note of clip.notes) {
      if (note.string < 1 || note.string > strings) {
        droppedCount += 1;
        continue;
      }
      // 休符の拍へ置くと音符の拍に変わり、2 つ目からは和音として足す（PlaceNoteCommand の 3 通り）
      children.push(new PlaceNoteCommand(target, at, note.string, note.fret, spec));
    }
  });
  return { children, droppedCount, strings };
}

// <!-- req editingcore:45e79c28.156c --> <!-- req editingcore:45e79c28.f017 --> <!-- req editingcore:b4686279.4d38 -->
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
    if (droppedCount > 0) reporter.report('EDIT-009', { droppedCount, targetStringCount: strings });
  }
}
