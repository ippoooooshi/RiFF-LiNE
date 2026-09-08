// UT-EDIT-ATTR: editing-core.md §6.4、04_editing_core.md §5〜§7 — Set{Tie,Slur,Technique,ChordName}Command
// 検証観点: 属性の適用と、undo による Score JSON の完全復元（execute/undo 対称性 C2）。
//   相手 Note が存在しないケースの no-op も検証。

import { beforeEach, describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { PlaceNoteCommand } from './PlaceNoteCommand';
import { SetChordNameCommand, SetSlurCommand, SetTechniqueCommand, SetTieCommand } from './noteAttributeCommands';
import { getBeat } from '../scoreModel';
import type { EditTarget } from '../types';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';

/** bar0 に 3 拍（弦3, フレット 5/7/9）を置いた target を作る。 */
function targetWithThreeNotes(): EditTarget {
  const target = buildEditTarget();
  for (let i = 0; i < 3; i++) {
    new PlaceNoteCommand(
      target,
      { trackIndex: 0, barIndex: 0, beatIndex: i },
      3,
      5 + i * 2,
      model.Duration.Quarter,
    ).execute();
  }
  return target;
}

let target: EditTarget;
let before: string;

beforeEach(() => {
  target = targetWithThreeNotes();
  before = scoreJson(target);
});

describe('SetTieCommand', () => {
  it('setTie_True_MarksDestinationAndLinksOrigin_UndoRestores', () => {
    const cmd = new SetTieCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 1 }, 3, true);
    cmd.execute();
    expect(getBeat(target.score, 0, 0, 1).notes[0]!.isTieDestination).toBe(true);
    cmd.undo();
    expect(getBeat(target.score, 0, 0, 1).notes[0]!.isTieDestination).toBe(false);
    expect(scoreJson(target)).toBe(before);
  });

  it('setTie_NoNoteOnString_IsNoOp', () => {
    const cmd = new SetTieCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 1 }, 6, true);
    cmd.execute();
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });
});

describe('SetSlurCommand', () => {
  it('setSlur_OverRange_LinksFirstAndLast_UndoRestores', () => {
    const cmd = new SetSlurCommand(target, {
      trackIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 0,
      endBeatIndex: 2,
    });
    cmd.execute();
    expect(getBeat(target.score, 0, 0, 2).notes[0]!.isSlurDestination).toBe(true);
    cmd.undo();
    expect(getBeat(target.score, 0, 0, 2).notes[0]!.isSlurDestination).toBe(false);
    expect(scoreJson(target)).toBe(before);
  });

  it('setSlur_SameStartAndEnd_IsNoOp', () => {
    const cmd = new SetSlurCommand(target, {
      trackIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 1,
      endBarIndex: 0,
      endBeatIndex: 1,
    });
    cmd.execute();
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });
});

describe('SetTechniqueCommand', () => {
  it('setTechnique_AppliesPatchKeys_UndoRestoresAll', () => {
    const cmd = new SetTechniqueCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, {
      slideOutType: model.SlideOutType.Shift,
      isPalmMute: true,
      harmonicType: model.HarmonicType.Natural,
    });
    cmd.execute();
    const note = getBeat(target.score, 0, 0, 0).notes[0]!;
    expect(note.slideOutType).toBe(model.SlideOutType.Shift);
    expect(note.isPalmMute).toBe(true);
    expect(note.harmonicType).toBe(model.HarmonicType.Natural);

    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('setTechnique_EmptyPatch_IsNoOp', () => {
    const cmd = new SetTechniqueCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, {});
    cmd.execute();
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });
});

describe('SetChordNameCommand', () => {
  it('setChordName_SetsBeatText_UndoClears', () => {
    const cmd = new SetChordNameCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 'Cmaj7');
    cmd.execute();
    expect(getBeat(target.score, 0, 0, 0).text).toBe('Cmaj7');
    cmd.undo();
    expect(getBeat(target.score, 0, 0, 0).text).toBeNull();
    expect(scoreJson(target)).toBe(before);
  });

  it('setChordName_Null_ClearsExistingText_UndoRestores', () => {
    new SetChordNameCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 'G').execute();
    const withText = scoreJson(target);
    const clear = new SetChordNameCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, null);
    clear.execute();
    expect(getBeat(target.score, 0, 0, 0).text).toBeNull();
    clear.undo();
    expect(scoreJson(target)).toBe(withText);
  });
});
