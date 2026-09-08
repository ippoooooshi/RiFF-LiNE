// UT-PART-VALID: part-tuning-management.md §3.1・§3.3・§4.4 — PartValidationService
// 検証観点（C2）: パート数上限（境界 7/8）、カポ範囲（境界 0/12/-1/13/非整数）、
//   プリセット適用の弦数減少判定、基底メソッドの継承。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { PartValidationService } from './PartValidationService';
import { buildEditTarget } from '../testing/editingFakes';

const svc = new PartValidationService();

describe('validatePartCount', () => {
  it('underLimit_IsOk', () => {
    expect(svc.validatePartCount(buildEditTarget()).ok).toBe(true);
  });

  it('atLimit_ReturnsEDIT005', () => {
    const target = buildEditTarget();
    while (target.score.tracks.length < 8) target.score.addTrack(new model.Track());
    const result = svc.validatePartCount(target);
    expect(result).toMatchObject({ ok: false, code: 'EDIT-005', context: { max: 8 } });
  });
});

describe('validateCapoFret', () => {
  it.each([
    [0, true],
    [12, true],
    [5, true],
    [-1, false],
    [13, false],
    [3.5, false],
  ])('capo %s → ok=%s', (capo, ok) => {
    const r = svc.validateCapoFret(capo);
    expect(r.ok).toBe(ok);
    if (!ok) expect(r).toMatchObject({ code: 'EDIT-007' });
  });
});

describe('validateTuningPresetApplication', () => {
  it('increase_IsOk', () => {
    expect(svc.validateTuningPresetApplication(buildEditTarget(), 0, 7).ok).toBe(true);
  });
  it('same_IsOk', () => {
    expect(svc.validateTuningPresetApplication(buildEditTarget(), 0, 6).ok).toBe(true);
  });
  it('decrease_ReturnsEDIT006', () => {
    expect(svc.validateTuningPresetApplication(buildEditTarget(), 0, 5)).toMatchObject({
      ok: false,
      code: 'EDIT-006',
      context: { from: 6, to: 5 },
    });
  });
});

describe('inherited base methods', () => {
  it('validateNotePlacement_stillWorks', () => {
    expect(
      svc.validateNotePlacement(buildEditTarget(), { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, 30),
    ).toMatchObject({ ok: false, code: 'EDIT-002' });
  });
});
