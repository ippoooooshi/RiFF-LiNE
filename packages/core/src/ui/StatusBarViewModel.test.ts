// UT-UI-SB: StatusBarViewModel（screens-navigation.md §4.4、14_visual_design_system.md §4）
// 検証節: screens-navigation.md §4.4（小節位置/拍子/テンポ/カポ/ズーム％の派生表示）
import { describe, expect, it, vi } from 'vitest';

import type { CursorLike } from '../viewmodes/types';

import { StatusBarViewModel, type StatusBarContext } from './StatusBarViewModel';

function makeCursor(): CursorLike & { move: (bar: number) => void } {
  let bar = 0;
  let listener: (() => void) | null = null;
  return {
    get position() {
      return { trackIndex: 0, barIndex: bar, beatIndex: 0 };
    },
    onChange: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    move: (b) => {
      bar = b;
      listener?.();
    },
  };
}

describe('StatusBarViewModel', () => {
  it('StatusBarViewModel_providerとズームから初期状態を組み立てる', () => {
    // UT-UI-SB-01 §4.4
    const ctx: StatusBarContext = { barNumber: 1, timeSignature: '4/4', tempoBpm: 120, capoFret: 2 };
    const vm = new StatusBarViewModel(makeCursor(), { zoomPercent: 180 }, { read: () => ctx });
    expect(vm.getState()).toEqual({ barNumber: 1, timeSignature: '4/4', tempoBpm: 120, capoFret: 2, zoomPercent: 180 });
  });

  it('StatusBarViewModel_カーソル移動でrefreshされonChange発火', () => {
    // UT-UI-SB-02 §4.4（カーソル購読）
    const cursor = makeCursor();
    let bar = 1;
    const vm = new StatusBarViewModel(
      cursor,
      { zoomPercent: 100 },
      { read: () => ({ barNumber: bar, timeSignature: '4/4', tempoBpm: 120, capoFret: 0 }) },
    );
    const onChange = vi.fn();
    vm.onChange(onChange);
    bar = 5;
    cursor.move(4);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(vm.getState().barNumber).toBe(5);
  });

  it('StatusBarViewModel_値が変わらなければonChangeしない', () => {
    // UT-UI-SB-03 §4.4（不要通知の抑止）
    const cursor = makeCursor();
    const vm = new StatusBarViewModel(
      cursor,
      { zoomPercent: 100 },
      { read: () => ({ barNumber: 1, timeSignature: '4/4', tempoBpm: 120, capoFret: 0 }) },
    );
    const onChange = vi.fn();
    vm.onChange(onChange);
    cursor.move(0); // provider の戻り値は不変
    vm.refresh();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('StatusBarViewModel_refreshでズーム変更を取り込む', () => {
    // UT-UI-SB-04 §4.4（ZoomController に購読 API が無いため bootstrap が refresh を呼ぶ）
    const zoom = { zoomPercent: 100 };
    const vm = new StatusBarViewModel(makeCursor(), zoom, {
      read: () => ({ barNumber: 1, timeSignature: '4/4', tempoBpm: 120, capoFret: 0 }),
    });
    zoom.zoomPercent = 150;
    vm.refresh();
    expect(vm.getState().zoomPercent).toBe(150);
  });

  it('StatusBarViewModel_disposeで購読解除', () => {
    // UT-UI-SB-05 §4.4（ライフサイクル）
    const cursor = makeCursor();
    let bar = 1;
    const vm = new StatusBarViewModel(
      cursor,
      { zoomPercent: 100 },
      { read: () => ({ barNumber: bar, timeSignature: '4/4', tempoBpm: 120, capoFret: 0 }) },
    );
    const onChange = vi.fn();
    vm.onChange(onChange);
    vm.dispose();
    bar = 9;
    cursor.move(8);
    expect(onChange).not.toHaveBeenCalled();
  });
});
