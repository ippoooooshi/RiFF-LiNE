// UT-ERR-CODES: error-logging-foundation.md §4、00_reference.md §5 — CORE_ERROR_CODES / registerCoreErrorCodes
// 検証観点: 8 コードすべてが登録され、レベルが統合表（§5）と一致すること（C0/C1）。

import { describe, expect, it } from 'vitest';

import { CORE_ERROR_CODES, registerCoreErrorCodes } from './coreErrorCodes';
import { ErrorCodeRegistry } from './ErrorCodeRegistry';
import type { NotificationLevel } from './types';

/** 00_reference.md §5「エラーコード統合表」の登録パッケージ = 3（本パッケージ）の行。 */
const EXPECTED: Record<string, NotificationLevel> = {
  'FILE-001': 'error',
  'FILE-002': 'critical',
  'FILE-003': 'error',
  'FILE-004': 'critical',
  'FILE-005': 'warning',
  'SYS-001': 'warning',
  'SYS-002': 'critical',
  'RENDER-001': 'error',
};

describe('CORE_ERROR_CODES', () => {
  it('CORE_ERROR_CODES_ContainsExactlyTheEightPackageThreeCodes', () => {
    expect(Object.keys(CORE_ERROR_CODES).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('CORE_ERROR_CODES_LevelsMatchIntegrationTable', () => {
    for (const [code, level] of Object.entries(EXPECTED)) {
      expect(CORE_ERROR_CODES[code]?.level, code).toBe(level);
      expect(CORE_ERROR_CODES[code]?.messageTemplate.length, code).toBeGreaterThan(0);
    }
  });
});

describe('registerCoreErrorCodes', () => {
  it('registerCoreErrorCodes_RegistersAllCodesResolvable', () => {
    const registry = new ErrorCodeRegistry();
    registerCoreErrorCodes(registry);
    for (const code of Object.keys(EXPECTED)) {
      expect(registry.has(code), code).toBe(true);
      expect(registry.resolve(code).level, code).toBe(EXPECTED[code]);
    }
  });
});
