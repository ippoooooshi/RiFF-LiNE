// UT-UI-ERR: uiErrorCodes（screens-navigation.md §3.5、00_reference.md §5）
// 検証節: screens-navigation.md §3.5（TAG-001=Error / SONG-001=Warning / SONG-002=Error）
import { describe, expect, it } from 'vitest';

import { ErrorCodeRegistry } from '../errors';

import { registerUiErrorCodes, UI_ERROR_CODES } from './uiErrorCodes';

describe('uiErrorCodes', () => {
  it('uiErrorCodes_3コードのレベルが実挙動と一致する（B20）', () => {
    // UT-UI-ERR-01 §3.5
    expect(UI_ERROR_CODES['TAG-001']?.level).toBe('error'); // 50件ハードキャップ＝拒否
    expect(UI_ERROR_CODES['SONG-001']?.level).toBe('warning'); // 900件予告＝継続可
    expect(UI_ERROR_CODES['SONG-002']?.level).toBe('error'); // 1000件ハードキャップ＝拒否
  });

  it('uiErrorCodes_registerUiErrorCodesでレジストリへ登録される', () => {
    // UT-UI-ERR-02 §3.5
    const registry = new ErrorCodeRegistry();
    registerUiErrorCodes(registry);
    expect(registry.has('TAG-001')).toBe(true);
    expect(registry.resolve('SONG-002').level).toBe('error');
  });

  it('uiErrorCodes_共有バレル読み込みで共有レジストリに登録済み', async () => {
    // UT-UI-ERR-03 §3.5（ui/index.ts の副作用登録）
    const { errorCodeRegistry } = await import('../errors');
    await import('./index');
    expect(errorCodeRegistry.has('TAG-001')).toBe(true);
    expect(errorCodeRegistry.has('SONG-001')).toBe(true);
    expect(errorCodeRegistry.has('SONG-002')).toBe(true);
  });
});
