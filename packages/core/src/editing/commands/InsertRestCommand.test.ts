// UT-EDIT-INSERTREST: editing-core.md §6.4、04_editing_core.md §2 — InsertRestCommand
// 検証観点: 指定位置へ休符 Beat を挿入 / 末尾へ追加、undo で Score が完全に戻る（C2）。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { InsertRestCommand } from './InsertRestCommand';
import { getVoice, getBar } from '../scoreModel';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';

describe('InsertRestCommand', () => {
  it('insertRest_AtEnd_AppendsRestBeat_UndoRestores', () => {
    const target = buildEditTarget();
    const before = scoreJson(target);
    const beatsBefore = getVoice(getBar(target.score, 0, 0)).beats.length;

    const cmd = new InsertRestCommand(
      target,
      { trackIndex: 0, barIndex: 0, beatIndex: beatsBefore },
      model.Duration.Eighth,
    );
    const outcome = cmd.execute();

    expect(getVoice(getBar(target.score, 0, 0)).beats.length).toBe(beatsBefore + 1);
    expect(outcome.cursorAdvance).toBe('beat');

    cmd.undo();
    expect(getVoice(getBar(target.score, 0, 0)).beats.length).toBe(beatsBefore);
    expect(scoreJson(target)).toBe(before);
  });

  it('insertRest_InMiddle_SplicesAtIndex_UndoRestores', () => {
    const target = buildEditTarget();
    // 末尾に 1 拍足してから index 0 へ挿入
    new InsertRestCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 1 }, model.Duration.Quarter).execute();
    const before = scoreJson(target);

    const cmd = new InsertRestCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, model.Duration.Quarter);
    cmd.execute();
    expect(getVoice(getBar(target.score, 0, 0)).beats[0]!.notes).toHaveLength(0);

    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });
});
