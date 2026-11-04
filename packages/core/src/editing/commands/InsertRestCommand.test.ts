// UT-EDIT-INSERTREST: InsertRestCommand
// 検証節: editing-core.md 2.4 節・2.6 節・3.3 節・4.4 節
// 検証観点: 指定した位置へ渡した音価の休符の拍を挿入する / 末尾へ足す、undo で Score が元に戻る（C2）。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { InsertRestCommand } from './InsertRestCommand';
import { getBar, getVoice } from '../scoreModel';
import type { BeatDurationSpec } from '../types';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';

const QUARTER: BeatDurationSpec = { duration: model.Duration.Quarter, dots: 0, tuplet: null };

// <!-- req editingcore:dc08ff11.07bf -->
describe('InsertRestCommand', () => {
  it('InsertRestCommand_末尾_渡した音価の休符の拍を足し逆参照を張りundoで外す', () => {
    // UT-EDIT-INSERTREST-01 2.6 節「InsertRestCommand は休符の拍を挿入する」「そのパート」・3.3 節「休符は、音符を持たない Beat」・2.4 節「insertBeatAt」
    const target = buildEditTarget();
    const before = scoreJson(target);
    const voice = getVoice(getBar(target.score, 0, 0));
    const beatsBefore = voice.beats.length;

    const cmd = new InsertRestCommand(
      target,
      { trackIndex: 0, barIndex: 0, beatIndex: beatsBefore },
      { duration: model.Duration.Eighth, dots: 2, tuplet: { numerator: 5, denominator: 4 } },
    );
    expect(cmd.kind).toBe('insert-rest');
    expect(cmd.label).toBe('insert-rest');
    expect(cmd.affectedTrackIndices).toEqual([0]);
    expect(cmd.execute().cursorAdvance).toBe('beat');

    expect(voice.beats.length).toBe(beatsBefore + 1);
    const rest = voice.beats[beatsBefore]!;
    expect(rest.notes).toHaveLength(0);
    expect(rest.isRest).toBe(true);
    expect(rest.voice).toBe(voice);
    expect([rest.duration, rest.dots, rest.tupletNumerator, rest.tupletDenominator]).toEqual([
      model.Duration.Eighth,
      2,
      5,
      4,
    ]);

    expect(cmd.undo().cursorAdvance).toBe('none');
    expect(voice.beats.length).toBe(beatsBefore);
    expect(scoreJson(target)).toBe(before);
  });

  it('InsertRestCommand_途中の位置_その位置へ挟みundoで戻る', () => {
    // UT-EDIT-INSERTREST-02 4.4 節「InsertRestCommand で休符の拍…をはっきり作り」（カーソルの位置へ挿入）
    const target = buildEditTarget();
    new InsertRestCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 1 }, QUARTER).execute();
    const before = scoreJson(target);
    const voice = getVoice(getBar(target.score, 0, 0));
    const first = voice.beats[0];

    const cmd = new InsertRestCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, QUARTER);
    cmd.execute();
    expect(voice.beats[0]!.notes).toHaveLength(0);
    expect(voice.beats[1]).toBe(first);

    cmd.undo();
    expect(scoreJson(target)).toBe(before);
    cmd.execute();
    const redone = scoreJson(target);
    cmd.undo();
    cmd.execute();
    expect(scoreJson(target)).toBe(redone);
    expect(voice.beats[0]!.notes).toHaveLength(0);
  });

  it('InsertRestCommand_連符でない音価_分子と分母を1にする', () => {
    // UT-EDIT-INSERTREST-03 4.3 節「null は連符でない（alphaTab では分子と分母が 1）」
    const target = buildEditTarget();
    new InsertRestCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 1 }, QUARTER).execute();
    const rest = getVoice(getBar(target.score, 0, 0)).beats[1]!;
    expect([rest.tupletNumerator, rest.tupletDenominator]).toEqual([1, 1]);
    expect(rest.hasTuplet).toBe(false);
  });

  it('InsertRestCommand_estimateSizeBytes_差分だけの小さな定数', () => {
    // UT-EDIT-INSERTREST-04 2.3 節「各コマンドは、原則として変更の差分だけを持ち」
    const cmd = new InsertRestCommand(buildEditTarget(), { trackIndex: 0, barIndex: 0, beatIndex: 0 }, QUARTER);
    expect(cmd.estimateSizeBytes()).toBeLessThan(2048);
  });
});
