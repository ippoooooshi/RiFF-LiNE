// UT-ERR-CODES: error-logging-foundation.md §4、00_reference.md §5 — CORE_ERROR_CODES / registerCoreErrorCodes
// 検証観点: EXPECTED のコードすべてが登録され、レベルが統合表（§5）と一致すること（C0/C1）。
// FILE-009〜011 は data-model-persistence.md 14.2 節（validateMirrorConfig の errors と infos）、FILE-012〜014 は 12 節（保存先の移行）、
// FILE-015 は 14.1 節（終了のときのミラーの写しの待ちの打ち切り）。

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
  'FILE-008': 'critical',
  'FILE-009': 'error',
  'FILE-010': 'error',
  'FILE-011': 'info',
  'FILE-012': 'critical',
  'FILE-013': 'critical',
  'FILE-014': 'info',
  // data-model-persistence.md 14.1 節：終了のときのミラーの写しの待ちの打ち切りは Warning の FILE-015
  'FILE-015': 'warning',
  'SONG-003': 'warning',
  'SYS-001': 'warning',
  'SYS-002': 'critical',
  'RENDER-001': 'error',
};

describe('CORE_ERROR_CODES', () => {
  it('CORE_ERROR_CODES_ContainsExactlyTheExpectedCodes', () => {
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
