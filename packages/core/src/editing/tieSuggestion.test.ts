// UT-EDIT-ATTR: findTieCandidate（タイの自動の候補）
// 検証節: editing-core.md 6 節（候補は直前の拍の同じ弦に同じフレットの音符があればその前の音符。純粋な関数）

import { beforeEach, describe, expect, it } from 'vitest';

import { InsertBarCommand } from './commands/barCommands';
import { InsertRestCommand } from './commands/InsertRestCommand';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { findTieCandidate } from './tieSuggestion';
import { DEFAULT_DURATION_SPEC, type CursorPosition, type EditTarget } from './types';
import { buildEditTarget, scoreJson } from '../testing/editingFakes';

let target: EditTarget;

const at = (barIndex: number, beatIndex: number, voiceIndex: 0 | 1 = 0): CursorPosition => ({
  trackIndex: 0,
  barIndex,
  voiceIndex,
  beatIndex,
});

function place(position: CursorPosition, stringNumber: number, fret: number): void {
  new PlaceNoteCommand(target, position, stringNumber, fret, DEFAULT_DURATION_SPEC).execute();
}

beforeEach(() => {
  target = buildEditTarget();
});

describe('findTieCandidate', () => {
  it('findTieCandidate_直前の拍の同じ弦に同じフレット_前の音符を返す', () => {
    // UT-EDIT-ATTR-60 6 節「直前の拍の同じ弦に同じフレットの音符があれば、その前の音符を返す」
    place(at(0, 0), 3, 5);
    place(at(0, 1), 3, 5);
    expect(findTieCandidate(target.score, { position: at(0, 1), stringNumber: 3 })).toEqual({
      position: at(0, 0),
      stringNumber: 3,
    });
  });

  it('findTieCandidate_同じ弦で違うフレット_nullを返す', () => {
    // UT-EDIT-ATTR-61 6 節「同じ高さは、同じ弦で同じフレットのときとする」
    place(at(0, 0), 3, 5);
    place(at(0, 1), 3, 7);
    expect(findTieCandidate(target.score, { position: at(0, 1), stringNumber: 3 })).toBeNull();
  });

  it('findTieCandidate_違う弦で同じ高さ_nullを返す', () => {
    // UT-EDIT-ATTR-62 6 節「弦が違うと同じ高さでもタイでつなげない」
    // 標準チューニングで弦 3 のフレット 5 と弦 4 の開放は同じ G
    place(at(0, 0), 3, 5);
    place(at(0, 1), 4, 0);
    expect(findTieCandidate(target.score, { position: at(0, 1), stringNumber: 4 })).toBeNull();
  });

  it('findTieCandidate_直前の拍が休符_nullを返す', () => {
    // UT-EDIT-ATTR-63 6 節「直前の拍と同じ高さの音を続けて置いたとき」。2 つ前の同じ音は見ない
    place(at(0, 0), 3, 5);
    new InsertRestCommand(target, at(0, 1), DEFAULT_DURATION_SPEC).execute();
    place(at(0, 2), 3, 5);
    expect(findTieCandidate(target.score, { position: at(0, 2), stringNumber: 3 })).toBeNull();
  });

  it('findTieCandidate_小節の最初の拍_1つ前の小節の最後の拍の音符を返す', () => {
    // UT-EDIT-ATTR-64 6 節・7.1 節「直前の拍は、同じパートの同じボイスで 1 つ前の拍とし、小節をまたいでも数える」
    new InsertBarCommand(target, 1).execute();
    place(at(0, 0), 2, 3);
    place(at(0, 1), 3, 5);
    place(at(1, 0), 3, 5);
    expect(findTieCandidate(target.score, { position: at(1, 0), stringNumber: 3 })).toEqual({
      position: at(0, 1),
      stringNumber: 3,
    });
  });

  it('findTieCandidate_曲の最初の拍_nullを返す', () => {
    // UT-EDIT-ATTR-65 6 節。曲の最初の拍には直前の拍が無い
    place(at(0, 0), 3, 5);
    expect(findTieCandidate(target.score, { position: at(0, 0), stringNumber: 3 })).toBeNull();
  });

  it('findTieCandidate_前の小節にそのボイスの拍が無い_nullを返す', () => {
    // UT-EDIT-ATTR-66 6 節。2 つ目のボイスがまだ無い小節には、ボイス 2 の拍が無い（4.1 節）
    new InsertBarCommand(target, 1).execute();
    place(at(0, 0), 3, 5);
    place(at(1, 0, 1), 3, 5);
    expect(findTieCandidate(target.score, { position: at(1, 0, 1), stringNumber: 3 })).toBeNull();
  });

  it('findTieCandidate_置いた所に音符が無い_nullを返す', () => {
    // UT-EDIT-ATTR-67 6 節。拍の無い位置と、拍に指定した弦の音符が無い位置は、置いた音符にならない
    place(at(0, 0), 3, 5);
    place(at(0, 1), 3, 5);
    expect(findTieCandidate(target.score, { position: at(0, 2), stringNumber: 3 })).toBeNull();
    expect(findTieCandidate(target.score, { position: at(0, 1), stringNumber: 2 })).toBeNull();
  });

  it('findTieCandidate_候補を求めても_Scoreを変えない', () => {
    // UT-EDIT-ATTR-68 6 節「候補を確定するまで曲を変えない」・「純粋な関数」
    place(at(0, 0), 3, 5);
    place(at(0, 1), 3, 5);
    const before = scoreJson(target);
    findTieCandidate(target.score, { position: at(0, 1), stringNumber: 3 });
    expect(scoreJson(target)).toBe(before);
  });
});
