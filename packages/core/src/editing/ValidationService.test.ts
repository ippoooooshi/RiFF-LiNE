// UT-EDIT-VALID: editing-core.md §7、04_editing_core.md §4・§11 — ValidationService
// 検証観点（C2）: フレット範囲（境界 0/24/-1/25）、重複配置、小節数上限、メモ切り詰め。

import { describe, expect, it } from 'vitest';

import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { ValidationService } from './ValidationService';
import { buildEditTarget } from '../testing/editingFakes';
import { model } from '@coderline/alphatab';

const svc = new ValidationService();
const pos = { trackIndex: 0, barIndex: 0, beatIndex: 0 };

describe('ValidationService.validateNotePlacement', () => {
  it.each([
    [0, true],
    [24, true],
    [12, true],
    [-1, false],
    [25, false],
    [1.5, false],
  ])('fret %s → ok=%s', (fret, ok) => {
    const target = buildEditTarget();
    const result = svc.validateNotePlacement(target, pos, 3, fret);
    expect(result.ok).toBe(ok);
    if (!ok) expect(result).toMatchObject({ code: 'EDIT-002' });
  });

  it('duplicateStringInBeat_ReturnsEDIT001', () => {
    const target = buildEditTarget();
    new PlaceNoteCommand(target, pos, 3, 5, model.Duration.Quarter).execute();
    const result = svc.validateNotePlacement(target, pos, 3, 7);
    expect(result).toMatchObject({ ok: false, code: 'EDIT-001', context: { stringNumber: 3 } });
  });

  it('differentStringInSameBeat_IsOk', () => {
    const target = buildEditTarget();
    new PlaceNoteCommand(target, pos, 3, 5, model.Duration.Quarter).execute();
    expect(svc.validateNotePlacement(target, pos, 2, 7).ok).toBe(true);
  });
});

describe('ValidationService.validateBarInsertion', () => {
  it('underLimit_IsOk', () => {
    expect(svc.validateBarInsertion(buildEditTarget()).ok).toBe(true);
  });

  it('atLimit_ReturnsEDIT003', () => {
    const target = buildEditTarget();
    // masterBars を 2048 まで水増しして境界を突く（Bar 本体は不要。barCount は masterBars.length）。
    while (target.score.masterBars.length < 2048) target.score.addMasterBar(new model.MasterBar());
    const result = svc.validateBarInsertion(target);
    expect(result).toMatchObject({ ok: false, code: 'EDIT-003', context: { max: 2048 } });
  });
});

describe('ValidationService.validateMemoText', () => {
  it('withinLimit_OkAndUnchanged', () => {
    const r = svc.validateMemoText('短いメモ');
    expect(r.value).toBe('短いメモ');
    expect(r.outcome.ok).toBe(true);
  });

  it('overLimit_ClampsTo100AndReturnsEDIT004', () => {
    const long = 'あ'.repeat(150);
    const r = svc.validateMemoText(long);
    expect([...r.value]).toHaveLength(100);
    expect(r.outcome).toMatchObject({ ok: false, code: 'EDIT-004' });
  });
});
