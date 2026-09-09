// UT-UI-KSR: KeyboardShortcutRouter（screens-navigation.md §4.3、03_screens_ui_pc.md §7）
// 検証節: screens-navigation.md §4.3（ショートカット配線・テキスト入力欄優先）
import { describe, expect, it, vi } from 'vitest';

import { KeyboardShortcutRouter, normalizeCombo, type KeyEventLike } from './KeyboardShortcutRouter';

function key(over: Partial<KeyEventLike>): KeyEventLike {
  return { key: 'a', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over };
}

describe('normalizeCombo', () => {
  it('normalizeCombo_修飾子順を固定しキーを小文字化する', () => {
    // UT-UI-KSR-01 §4.3
    expect(normalizeCombo(key({ key: 'Z', ctrlKey: true }))).toBe('mod+z');
    expect(normalizeCombo(key({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('mod+shift+z');
    expect(normalizeCombo(key({ key: ' ' }))).toBe('space');
    expect(normalizeCombo(key({ key: 'ArrowRight', altKey: true }))).toBe('alt+arrowright');
  });
});

describe('KeyboardShortcutRouter', () => {
  it('KeyboardShortcutRouter_登録済みコンボでハンドラ実行しtrueを返す', () => {
    // UT-UI-KSR-02 §4.3
    const router = new KeyboardShortcutRouter();
    const handler = vi.fn();
    router.register({ id: 'undo', combo: 'mod+z', handler });
    const handled = router.handleKeyEvent(key({ key: 'z', ctrlKey: true }), { isTextInputFocused: false });
    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('KeyboardShortcutRouter_未登録コンボはfalse', () => {
    // UT-UI-KSR-03 §4.3
    const router = new KeyboardShortcutRouter();
    expect(router.handleKeyEvent(key({ key: 'q', ctrlKey: true }), { isTextInputFocused: false })).toBe(false);
  });

  it('KeyboardShortcutRouter_テキスト入力中は既定でアプリ側処理を行わない', () => {
    // UT-UI-KSR-04 §4.3（OS 標準の編集操作を殺さない）
    const router = new KeyboardShortcutRouter();
    const handler = vi.fn();
    router.register({ id: 'copy', combo: 'mod+c', handler });
    const handled = router.handleKeyEvent(key({ key: 'c', ctrlKey: true }), { isTextInputFocused: true });
    expect(handled).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('KeyboardShortcutRouter_allowInTextInputなら入力中でも発火', () => {
    // UT-UI-KSR-05 §4.3（明示許可）
    const router = new KeyboardShortcutRouter();
    const handler = vi.fn();
    router.register({ id: 'save', combo: 'mod+s', handler, allowInTextInput: true });
    expect(router.handleKeyEvent(key({ key: 's', ctrlKey: true }), { isTextInputFocused: true })).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('KeyboardShortcutRouter_同一コンボの再registerで後勝ち / unregisterで解除', () => {
    // UT-UI-KSR-06 §4.3
    const router = new KeyboardShortcutRouter();
    const first = vi.fn();
    const second = vi.fn();
    router.register({ id: 'x', combo: 'mod+k', handler: first });
    router.register({ id: 'x', combo: 'mod+k', handler: second });
    router.handleKeyEvent(key({ key: 'k', ctrlKey: true }), { isTextInputFocused: false });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    router.unregister('mod+k');
    expect(router.handleKeyEvent(key({ key: 'k', ctrlKey: true }), { isTextInputFocused: false })).toBe(false);
    expect(router.registeredCombos()).toEqual([]);
  });
});
