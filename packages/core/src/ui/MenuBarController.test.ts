// UT-UI-MB: MenuBarController（screens-navigation.md §4.2・§3.6）
// 検証節: screens-navigation.md §4.2（メニュー構成とサービス配線）、§3.6（B19 エクスポート/印刷の無効化）
import { describe, expect, it, vi } from 'vitest';

import { MenuBarController, type MenuItemDescriptor } from './index';

/** ツリーを平坦化して id→descriptor に。 */
function flatten(items: MenuItemDescriptor[]): Map<string, MenuItemDescriptor> {
  const map = new Map<string, MenuItemDescriptor>();
  for (const item of items) {
    if (item.id !== undefined) map.set(item.id, item);
    if (item.submenu !== undefined) for (const [k, v] of flatten(item.submenu)) map.set(k, v);
  }
  return map;
}

describe('MenuBarController', () => {
  it('MenuBarController_buildTemplate_主要メニューを含む', () => {
    // UT-UI-MB-01 §4.2
    const template = new MenuBarController({}).buildTemplate();
    expect(template.map((m) => m.id)).toEqual(['file', 'edit', 'view', 'playback', 'help']);
  });

  it('MenuBarController_action未配線の項目はenabled:false', () => {
    // UT-UI-MB-02 §4.2（配線されていないメニューは無効表示）
    const items = flatten(new MenuBarController({}).buildTemplate());
    expect(items.get('edit.undo')?.enabled).toBe(false);
    expect(items.get('edit.undo')?.action).toBeUndefined();
  });

  it('MenuBarController_action配線済みの項目はenabled:trueでactionを持つ', () => {
    // UT-UI-MB-03 §4.2
    const undo = vi.fn();
    const items = flatten(new MenuBarController({ 'edit.undo': undo }).buildTemplate());
    expect(items.get('edit.undo')?.enabled).toBe(true);
    items.get('edit.undo')?.action?.();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('MenuBarController_エクスポート/印刷は既定で無効（B19）', () => {
    // UT-UI-MB-04 §3.6 B19
    const items = flatten(new MenuBarController({ 'file.export': vi.fn(), 'file.print': vi.fn() }).buildTemplate());
    expect(items.get('file.export')?.enabled).toBe(false);
    expect(items.get('file.print')?.enabled).toBe(false);
    expect(items.get('file.export')?.accelerator).toBe('CmdOrCtrl+E');
  });

  it('MenuBarController_optionsでエクスポート/印刷を有効化できる（Phase 2 接続点）', () => {
    // UT-UI-MB-05 §3.6 B19（Phase 2 で解除）
    const items = flatten(
      new MenuBarController(
        { 'file.export': vi.fn(), 'file.print': vi.fn() },
        { exportEnabled: true, printEnabled: true },
      ).buildTemplate(),
    );
    expect(items.get('file.export')?.enabled).toBe(true);
    expect(items.get('file.print')?.enabled).toBe(true);
  });

  it('MenuBarController_invoke_配線済みはtrue・未配線はfalse', () => {
    // UT-UI-MB-06 §4.2
    const redo = vi.fn();
    const controller = new MenuBarController({ 'edit.redo': redo });
    expect(controller.invoke('edit.redo')).toBe(true);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(controller.invoke('edit.undo')).toBe(false);
  });
});
