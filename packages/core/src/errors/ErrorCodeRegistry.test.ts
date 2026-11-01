// UT-ERR-REG: error-logging-foundation.md 2.1 節 — ErrorCodeRegistry
// 検証観点: register / resolve / has、未登録コードでの UnknownErrorCodeError、再登録の後勝ち、
// 8 つのドメインの外のコードと showOnScreen: false で logOnlyReason が空の定義の InvalidErrorCodeError（C0/C1）。

import { describe, expect, it } from 'vitest';

import { ERROR_DOMAINS, ErrorCodeRegistry } from './ErrorCodeRegistry';
import { InvalidErrorCodeError, UnknownErrorCodeError } from './errors';
import type { ErrorCodeDefinition, NotificationLevel } from './types';

/** 投げた InvalidErrorCodeError を返す（投げなければ失敗）。 */
function invalidOf(action: () => void): InvalidErrorCodeError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidErrorCodeError);
    return error as InvalidErrorCodeError;
  }
  throw new Error('InvalidErrorCodeError was not thrown');
}

/** そのレベルの定義を作る。Critical は型で title と buttons を省けないので足す（2.1 節）。 */
function definitionAt(level: NotificationLevel, rest: { showOnScreen?: boolean }): ErrorCodeDefinition {
  return level === 'critical'
    ? { level, title: 't', messageTemplate: 'm', buttons: { confirm: '閉じる' }, ...rest }
    : { level, messageTemplate: 'm', ...rest };
}

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
      expect((error as UnknownErrorCodeError).name).toBe('UnknownErrorCodeError');
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
    const critical = { level: 'critical', title: 't', messageTemplate: 'new', buttons: { confirm: '閉じる' } } as const;
    registry.register('FILE-001', critical);
    expect(registry.resolve('FILE-001')).toEqual(critical);
  });
});

describe('ErrorCodeRegistry — ドメインの検査（2.1 節）', () => {
  it('ERROR_DOMAINS_IsExactlyTheEightDomains', () => {
    expect([...ERROR_DOMAINS]).toEqual(['EDIT', 'PLAY', 'FILE', 'EXPORT', 'SYS', 'RENDER', 'TAG', 'SONG']);
  });

  it.each(ERROR_DOMAINS)('register_%sDomain_Accepted', (domain) => {
    const registry = new ErrorCodeRegistry();
    registry.register(`${domain}-001`, { level: 'info', messageTemplate: 'm' });
    expect(registry.has(`${domain}-001`)).toBe(true);
  });

  it.each(['NET-001', 'UI-001', 'T-INFO', 'X', 'file-001', 'FILE-1', 'FILE-0001', 'FILE001', ''])(
    'register_CodeOutsideDomains_%s_ThrowsInvalidErrorCodeError',
    (code) => {
      const registry = new ErrorCodeRegistry();
      const error = invalidOf(() => registry.register(code, { level: 'info', messageTemplate: 'm' }));
      expect(error.invalidCode).toBe(code);
      expect(error.reason).toBe('domain');
      expect(error.code).toBe('INVALID_ERROR_CODE');
      expect(error.name).toBe('InvalidErrorCodeError');
      expect(registry.has(code)).toBe(false);
    },
  );
});

describe('ErrorCodeRegistry — showOnScreen と logOnlyReason の検査（2.1 節）', () => {
  const levels: NotificationLevel[] = ['info', 'warning', 'error', 'critical'];

  it.each(levels)('register_%sShowOnScreenFalseWithoutReason_ThrowsInvalidErrorCodeError', (level) => {
    const registry = new ErrorCodeRegistry();
    const error = invalidOf(() => registry.register('SYS-901', definitionAt(level, { showOnScreen: false })));
    expect(error.reason).toBe('logOnlyReason');
    expect(error.invalidCode).toBe('SYS-901');
    expect(registry.has('SYS-901')).toBe(false);
  });

  it.each(['', '   '])('register_ShowOnScreenFalseWithBlankReason_%j_ThrowsInvalidErrorCodeError', (reason) => {
    const registry = new ErrorCodeRegistry();
    const error = invalidOf(() =>
      registry.register('SYS-901', {
        level: 'error',
        messageTemplate: 'm',
        showOnScreen: false,
        logOnlyReason: reason,
      }),
    );
    expect(error.reason).toBe('logOnlyReason');
  });

  it('register_ShowOnScreenFalseWithReason_Accepted', () => {
    const registry = new ErrorCodeRegistry();
    registry.register('SYS-901', {
      level: 'warning',
      messageTemplate: 'm',
      showOnScreen: false,
      logOnlyReason: '出す画面が無いため',
    });
    expect(registry.resolve('SYS-901').showOnScreen).toBe(false);
  });

  it('register_ShowOnScreenTrueOrOmittedWithoutReason_Accepted', () => {
    const registry = new ErrorCodeRegistry();
    registry.register('SYS-901', { level: 'info', messageTemplate: 'm', showOnScreen: true });
    registry.register('SYS-902', { level: 'info', messageTemplate: 'm' });
    expect(registry.has('SYS-901')).toBe(true);
    expect(registry.has('SYS-902')).toBe(true);
  });
});
