// UT-UI-TB: ToolbarViewModel（screens-navigation.md §4.4）
// 検証節: screens-navigation.md §4.4（Undo/Redo・再生系ボタン状態、パネル表示トグル）
import { describe, expect, it, vi } from 'vitest';

import { ToolbarViewModel, type HistoryStateSource, type PlaybackStateSource } from './ToolbarViewModel';

/** CommandHistory の購読部分だけの fake。 */
function makeHistory(): HistoryStateSource & { fire: () => void; setFlags: (u: boolean, r: boolean) => void } {
  let listener: (() => void) | null = null;
  let canU = false;
  let canR = false;
  return {
    canUndo: () => canU,
    canRedo: () => canR,
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    fire: () => listener?.(),
    setFlags: (u, r) => {
      canU = u;
      canR = r;
    },
  };
}

function makePlayback(): PlaybackStateSource & { fire: () => void; set: (p: boolean) => void } {
  let listener: (() => void) | null = null;
  let playing = false;
  return {
    get isPlaying() {
      return playing;
    },
    onStateChanged: (l) => {
      listener = l;
      return () => undefined;
    },
    fire: () => listener?.(),
    set: (p) => {
      playing = p;
    },
  };
}

describe('ToolbarViewModel', () => {
  it('ToolbarViewModel_history購読でUndo/Redo活性を反映しonChangeを発火', () => {
    // UT-UI-TB-01 §4.4
    const history = makeHistory();
    const vm = new ToolbarViewModel(history);
    const onChange = vi.fn();
    vm.onChange(onChange);

    expect(vm.getState().canUndo).toBe(false);
    history.setFlags(true, false);
    history.fire();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(vm.getState()).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('ToolbarViewModel_再生状態源がある場合isPlayingを反映', () => {
    // UT-UI-TB-02 §4.4（再生系ボタン状態）
    const playback = makePlayback();
    const vm = new ToolbarViewModel(makeHistory(), playback);
    expect(vm.getState().isPlaying).toBe(false);
    playback.set(true);
    playback.fire();
    expect(vm.getState().isPlaying).toBe(true);
  });

  it('ToolbarViewModel_playback未配線ならisPlayingは常にfalse', () => {
    // UT-UI-TB-03 §4.4（null 分岐）
    const vm = new ToolbarViewModel(makeHistory(), null);
    expect(vm.getState().isPlaying).toBe(false);
  });

  it('ToolbarViewModel_togglePanelで表示反転しonChange発火', () => {
    // UT-UI-TB-04 §4.4（パネル表示トグル）
    const vm = new ToolbarViewModel(makeHistory());
    const onChange = vi.fn();
    vm.onChange(onChange);
    vm.togglePanel('mixer');
    expect(vm.getState().panels.mixer).toBe(true);
    vm.togglePanel('mixer');
    expect(vm.getState().panels.mixer).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ToolbarViewModel_setPanelVisibleは変化なしなら通知しない', () => {
    // UT-UI-TB-05 §4.4（不要通知の抑止）
    const vm = new ToolbarViewModel(makeHistory());
    const onChange = vi.fn();
    vm.onChange(onChange);
    vm.setPanelVisible('tuning', false); // 既定 false のまま
    expect(onChange).not.toHaveBeenCalled();
    vm.setPanelVisible('tuning', true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ToolbarViewModel_disposeで購読解除しonChangeが呼ばれなくなる', () => {
    // UT-UI-TB-06 §4.4（ライフサイクル）
    const history = makeHistory();
    const vm = new ToolbarViewModel(history);
    const onChange = vi.fn();
    vm.onChange(onChange);
    vm.dispose();
    history.setFlags(true, true);
    history.fire();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ToolbarViewModel_onChangeの戻り値で個別解除できる', () => {
    // UT-UI-TB-07 §4.4
    const vm = new ToolbarViewModel(makeHistory());
    const onChange = vi.fn();
    const off = vm.onChange(onChange);
    off();
    vm.togglePanel('fretboard');
    expect(onChange).not.toHaveBeenCalled();
  });
});
