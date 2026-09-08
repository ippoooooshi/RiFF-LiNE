// UT-PART-CODES: part-tuning-management.md §4.4、00_reference.md §5 — PART_ERROR_CODES
// 検証観点: EDIT-005/006/007 が登録され、レベルが統合表と一致（C1）。

import { describe, expect, it } from 'vitest';

import { ErrorCodeRegistry } from '../errors';

import { PART_ERROR_CODES, registerPartErrorCodes } from './partErrorCodes';

const EXPECTED = {
  'EDIT-005': 'error',
  'EDIT-006': 'warning',
  'EDIT-007': 'error',
} as const;

describe('PART_ERROR_CODES', () => {
  it('containsExactlyEDIT005to007', () => {
    expect(Object.keys(PART_ERROR_CODES).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('levelsMatchIntegrationTable', () => {
    for (const [code, level] of Object.entries(EXPECTED)) {
      expect(PART_ERROR_CODES[code]?.level, code).toBe(level);
      expect(PART_ERROR_CODES[code]?.messageTemplate.length, code).toBeGreaterThan(0);
    }
  });

  it('registerPartErrorCodes_MakesAllResolvable', () => {
    const registry = new ErrorCodeRegistry();
    registerPartErrorCodes(registry);
    for (const code of Object.keys(EXPECTED)) {
      expect(registry.has(code)).toBe(true);
    }
  });
});
