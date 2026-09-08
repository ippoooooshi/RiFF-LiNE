// UT-EDIT-TEMPO: editing-core.md §6.4、要件4.1 — SetTempoCommand
// 検証観点: BPM 設定 / null で継承へ戻す、undo で MasterBar のテンポ自動化が完全復元、
//           affectedTrackIndices は全パート、isValidTempoBpm の範囲判定（C2）。

import { describe, expect, it } from 'vitest';

import { isValidTempoBpm, MAX_TEMPO_BPM, MIN_TEMPO_BPM, SetTempoCommand } from './SetTempoCommand';
import { getMasterBar } from '../scoreModel';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';

describe('isValidTempoBpm', () => {
  it.each([
    [MIN_TEMPO_BPM, true],
    [MAX_TEMPO_BPM, true],
    [120, true],
    [MIN_TEMPO_BPM - 1, false],
    [MAX_TEMPO_BPM + 1, false],
    [Number.NaN, false],
    [Infinity, false],
  ])('isValidTempoBpm(%s) === %s', (bpm, expected) => {
    expect(isValidTempoBpm(bpm)).toBe(expected);
  });
});

describe('SetTempoCommand', () => {
  it('setTempo_SetsAutomation_UndoRemovesIt', () => {
    const target = buildEditTarget();
    const before = scoreJson(target);

    const cmd = new SetTempoCommand(target, 0, 90);
    cmd.execute();
    expect(getMasterBar(target.score, 0).tempoAutomations).toHaveLength(1);
    expect(getMasterBar(target.score, 0).tempoAutomations[0]!.value).toBe(90);

    cmd.undo();
    expect(getMasterBar(target.score, 0).tempoAutomations).toHaveLength(0);
    expect(scoreJson(target)).toBe(before);
  });

  it('setTempo_Null_ClearsExistingAutomation_UndoRestores', () => {
    const target = buildEditTarget();
    new SetTempoCommand(target, 0, 140).execute();
    const withTempo = scoreJson(target);

    const clear = new SetTempoCommand(target, 0, null);
    clear.execute();
    expect(getMasterBar(target.score, 0).tempoAutomations).toHaveLength(0);
    clear.undo();
    expect(scoreJson(target)).toBe(withTempo);
  });

  it('affectedTrackIndices_IsAllParts', () => {
    const target = buildEditTarget(3);
    const cmd = new SetTempoCommand(target, 0, 100);
    expect([...cmd.affectedTrackIndices]).toEqual([0, 1, 2]);
  });
});
