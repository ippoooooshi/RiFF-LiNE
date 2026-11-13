/**
 * タイの自動の候補（editing-core.md 6 節）。
 *
 * 直前の拍と同じ高さの音を続けて置いたときに、タイでつなぐ前の音符を候補として返す純粋な関数。Score は変えない。
 * 同じ高さは、同じ弦で同じフレットのときとする。alphaTab のタイは同じ弦の次の音符をつなぐ（editing-core.md 3.4 節）ので、
 * 弦が違うと同じ高さでもタイでつなげないため。候補を覚えて画面に読ませ、確定で `SetTieCommand` を出すのは `EditingService`。
 */

import type { model } from '@coderline/alphatab';

import { findNoteOnString, voiceBeats } from './scoreModel';
import type { CursorPosition, NoteRef } from './types';

/**
 * 置いた音符 placed の直前の拍の同じ弦に、同じフレットの音符があれば、その前の音符の場所を返す。無ければ null（editing-core.md 6 節）。
 * 直前の拍は、同じパートの同じボイスで 1 つ前の拍とし、小節の最初の拍なら 1 つ前の小節の最後の拍とする（editing-core.md 7.1 節の
 * 「直前の拍」と同じ数え方）。
 */
// <!-- req editingcore:dbeaa35e.7c5a -->
export function findTieCandidate(score: model.Score, placed: NoteRef): NoteRef | null {
  const { position, stringNumber } = placed;
  const placedBeat = voiceBeats(score, position.trackIndex, position.barIndex, position.voiceIndex)[position.beatIndex];
  const placedNote = placedBeat === undefined ? null : findNoteOnString(placedBeat, stringNumber);
  if (placedNote === null) return null;

  const previous = previousBeatPosition(score, position);
  if (previous === null) return null;
  const previousBeat = voiceBeats(score, previous.trackIndex, previous.barIndex, previous.voiceIndex)[
    previous.beatIndex
  ]!;
  // <!-- req editingcore:1815f09f.679d --> <!-- req editingcore:1815f09f.df25 -->
  const previousNote = findNoteOnString(previousBeat, stringNumber);
  // <!-- req editingcore:1815f09f.a3eb -->
  if (previousNote === null || previousNote.fret !== placedNote.fret) return null;
  // <!-- req editingcore:dbeaa35e.a4b5 -->
  return { position: previous, stringNumber };
}

/** 同じパートの同じボイスで 1 つ前の拍の位置。小節の最初の拍なら 1 つ前の小節の最後の拍。曲の最初の拍か、前の小節にそのボイスの拍が無ければ null。 */
function previousBeatPosition(score: model.Score, position: CursorPosition): CursorPosition | null {
  if (position.beatIndex > 0) return { ...position, beatIndex: position.beatIndex - 1 };
  if (position.barIndex === 0) return null;
  const barIndex = position.barIndex - 1;
  const count = voiceBeats(score, position.trackIndex, barIndex, position.voiceIndex).length;
  if (count === 0) return null;
  return { ...position, barIndex, beatIndex: count - 1 };
}
