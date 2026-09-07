// UT-ERR-REG: error-logging-foundation.md §2.1 — ErrorCodeRegistry
// 検証観点: register / resolve / has、未登録コードでの UnknownErrorCodeError、再登録の後勝ち（C0/C1）。

import { describe, expect, it } from 'vitest';

import { ErrorCodeRegistry } from './ErrorCodeRegistry';
import { UnknownErrorCodeError } from './errors';

describe('ErrorCodeRegistry', () => {
  it('ErrorCodeRegistry_RegisterThenResolve_ReturnsDefinition', () => {
    const registry = new ErrorCodeRegistry();
    registry.register('EDIT-001', { level: 'error', messageTemplate: '重複配置です。' });

    expect(registry.resolve('EDIT-001')).toEqual({ level: 'error', messageTemplate: '重複配置です。' });
  });

  it('ErrorCodeRegistry_ResolveUnknownCode_ThrowsUnknownErrorCodeError', () => {
    const registry = new ErrorCodeRegistry();
    expect(() => registry.resolve('NOPE-999')).toThrow(UnknownErrorCodeError);
    try {
      registry.resolve('NOPE-999');
    } catch (error) {
      expect((error as UnknownErrorCodeError).unknownCode).toBe('NOPE-999');
      expect((error as UnknownErrorCodeError).code).toBe('UNKNOWN_ERROR_CODE');
    }
  });

  it('ErrorCodeRegistry_Has_ReflectsRegistration', () => {
    const registry = new ErrorCodeRegistry();
    expect(registry.has('SYS-001')).toBe(false);
    registry.register('SYS-001', { level: 'warning', messageTemplate: 'x' });
    expect(registry.has('SYS-001')).toBe(true);
  });

  it('ErrorCodeRegistry_ReRegister_LastWins', () => {
    const registry = new ErrorCodeRegistry();
    registry.register('FILE-001', { level: 'error', messageTemplate: 'old' });
    registry.register('FILE-001', { level: 'critical', messageTemplate: 'new' });
    expect(registry.resolve('FILE-001')).toEqual({ level: 'critical', messageTemplate: 'new' });
  });
});
