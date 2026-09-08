// UT: view-modes.md §4.1・§5.1・§5.2 — ViewModeController
//
// 検証観点:
//  - 初期モード適用（defaultViewMode）／コンストラクタでは onChange を発火しない
//  - モード切替：host へ適用、カーソル状態は不変、onChange 発火
//  - フォーカスビューの表示範囲追従：範囲内は何もしない／範囲外（前後どちらも）で取り直す（C2）
//  - パート追従：focus/scroll は trackIndex 変化で再適用、score は再適用しない
//  - focusVisibleRange のコピー返却、onChange 購読解除、dispose

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeCursor, RecordingViewModeRenderHost } from '../testing/viewModeFakes';

import { FOCUS_RANGE_BAR_SPAN, ViewModeController } from './ViewModeController';

let host: RecordingViewModeRenderHost;

beforeEach(() => {
  host = new RecordingViewModeRenderHost();
});

describe('ViewModeController constructor', () => {
  it('ViewModeController_DefaultOptions_AppliesFocusModeWithRangeAroundCursor', () => {
    const cursor = new FakeCursor({ trackIndex: 0, barIndex: 0 });
    const vmc = new ViewModeController(host, cursor);

    expect(vmc.currentMode).toBe('focus');
    expect(host.viewModeCalls).toHaveLength(1);
    expect(host.lastViewMode).toEqual({
      mode: 'focus',
      focusTrackIndex: 0,
      focusRange: { startBarIndex: 0, barCount: FOCUS_RANGE_BAR_SPAN },
    });
  });

  it('ViewModeController_InitialModeScore_AppliesScoreWithoutFocusRange', () => {
    const vmc = new ViewModeController(host, new FakeCursor(), { initialMode: 'score' });
    expect(vmc.currentMode).toBe('score');
    expect(host.lastViewMode).toEqual({ mode: 'score', focusTrackIndex: 0, focusRange: undefined });
  });

  it('ViewModeController_Constructor_DoesNotFireOnChange', () => {
    const onChange = vi.fn();
    new ViewModeController(host, new FakeCursor(), { onChange });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ViewModeController_CustomFocusSpan_RangeUsesThatSpan', () => {
    const cursor = new FakeCursor({ barIndex: 10 });
    const vmc = new ViewModeController(host, cursor, { focusRangeBarSpan: 4 });
    // 10 - floor(4/2) = 8
    expect(vmc.focusVisibleRange).toEqual({ startBarIndex: 8, barCount: 4 });
  });

  it('ViewModeController_NegativeCursorTrackIndex_ClampedToZero', () => {
    new ViewModeController(host, new FakeCursor({ trackIndex: -2 }));
    expect(host.lastViewMode?.focusTrackIndex).toBe(0);
  });
});

describe('ViewModeController.setViewMode', () => {
  it('setViewMode_FocusToScore_AppliesAndFiresOnChangeWithoutTouchingCursor', () => {
    const cursor = new FakeCursor({ trackIndex: 1, barIndex: 3, beatIndex: 2 });
    const onChange = vi.fn();
    const vmc = new ViewModeController(host, cursor, { onChange });

    vmc.setViewMode('score');

    expect(vmc.currentMode).toBe('score');
    expect(host.lastViewMode).toEqual({ mode: 'score', focusTrackIndex: 1, focusRange: undefined });
    expect(onChange).toHaveBeenCalledTimes(1);
    // カーソル状態は不変（editing-core.md §14）
    expect(cursor.position).toEqual({ trackIndex: 1, barIndex: 3, beatIndex: 2 });
  });

  it('setViewMode_SameMode_StillReapplies', () => {
    const vmc = new ViewModeController(host, new FakeCursor());
    vmc.setViewMode('focus');
    expect(host.viewModeCalls).toHaveLength(2); // ctor + 再適用
  });

  it('setViewMode_BackToFocus_RecomputesRangeAroundCurrentCursorBar', () => {
    const cursor = new FakeCursor({ barIndex: 0 });
    const vmc = new ViewModeController(host, cursor, { initialMode: 'scroll' });
    cursor.moveTo({ barIndex: 40 }); // scroll では範囲追従しないので focusRange は初期のまま

    vmc.setViewMode('focus');
    // 40 - 4 = 36
    expect(vmc.focusVisibleRange).toEqual({ startBarIndex: 36, barCount: FOCUS_RANGE_BAR_SPAN });
    expect(host.lastViewMode?.focusRange).toEqual({ startBarIndex: 36, barCount: FOCUS_RANGE_BAR_SPAN });
  });
});

describe('ViewModeController focus-range following (view-modes.md §5.2, C2)', () => {
  it('cursorMove_WithinFocusRange_DoesNothing', () => {
    const cursor = new FakeCursor({ barIndex: 0 }); // range [0,7]
    new ViewModeController(host, cursor);
    cursor.moveTo({ barIndex: 7 }); // 上端ちょうど＝範囲内
    expect(host.viewModeCalls).toHaveLength(1); // ctor のみ、追従なし
  });

  it('cursorMove_BeyondUpperEdge_RecomputesRange', () => {
    const cursor = new FakeCursor({ barIndex: 0 }); // range [0,7]
    const vmc = new ViewModeController(host, cursor);
    cursor.moveTo({ barIndex: 8 }); // 範囲外（上）
    expect(vmc.focusVisibleRange).toEqual({ startBarIndex: 4, barCount: 8 });
    expect(host.viewModeCalls).toHaveLength(2);
  });

  it('cursorMove_BelowLowerEdge_RecomputesRange', () => {
    const cursor = new FakeCursor({ barIndex: 20 }); // range [16,23]
    const vmc = new ViewModeController(host, cursor);
    cursor.moveTo({ barIndex: 15 }); // 範囲外（下）
    expect(vmc.focusVisibleRange).toEqual({ startBarIndex: 11, barCount: 8 });
    expect(host.viewModeCalls).toHaveLength(2);
  });

  it('cursorMove_OutOfRange_ClampsStartToZero', () => {
    const cursor = new FakeCursor({ barIndex: 20 });
    const vmc = new ViewModeController(host, cursor);
    cursor.moveTo({ barIndex: 1 });
    expect(vmc.focusVisibleRange).toEqual({ startBarIndex: 0, barCount: 8 });
  });

  it('cursorMove_InScrollMode_DoesNotFollowBarRange', () => {
    const cursor = new FakeCursor({ barIndex: 0 });
    new ViewModeController(host, cursor, { initialMode: 'scroll' });
    cursor.moveTo({ barIndex: 500 });
    expect(host.viewModeCalls).toHaveLength(1);
  });
});

describe('ViewModeController part following', () => {
  it('cursorTrackChange_InFocusMode_ReappliesWithNewTrack', () => {
    const cursor = new FakeCursor({ trackIndex: 0, barIndex: 2 });
    new ViewModeController(host, cursor);
    cursor.moveTo({ trackIndex: 2 }); // bar は範囲内のまま、パートだけ変更
    expect(host.viewModeCalls).toHaveLength(2);
    expect(host.lastViewMode?.focusTrackIndex).toBe(2);
  });

  it('cursorTrackChange_InScrollMode_ReappliesSingleTrack', () => {
    const cursor = new FakeCursor({ trackIndex: 0 });
    new ViewModeController(host, cursor, { initialMode: 'scroll' });
    cursor.moveTo({ trackIndex: 1 });
    expect(host.lastViewMode).toEqual({ mode: 'scroll', focusTrackIndex: 1, focusRange: undefined });
  });

  it('cursorTrackChange_InScoreMode_DoesNotReapply', () => {
    const cursor = new FakeCursor({ trackIndex: 0 });
    new ViewModeController(host, cursor, { initialMode: 'score' });
    cursor.moveTo({ trackIndex: 3 });
    expect(host.viewModeCalls).toHaveLength(1); // score は全パート表示、追従不要
  });

  it('cursorTrackChange_ThenSwitchToFocus_UsesLatestTrack', () => {
    const cursor = new FakeCursor({ trackIndex: 0 });
    const vmc = new ViewModeController(host, cursor, { initialMode: 'score' });
    cursor.moveTo({ trackIndex: 3 }); // score 中でも内部追従先は更新される
    vmc.setViewMode('focus');
    expect(host.lastViewMode?.focusTrackIndex).toBe(3);
  });

  it('cursorMove_SamePosition_NoReapply', () => {
    const cursor = new FakeCursor({ trackIndex: 1, barIndex: 2 });
    new ViewModeController(host, cursor);
    cursor.moveTo({ trackIndex: 1, barIndex: 2 });
    expect(host.viewModeCalls).toHaveLength(1);
  });
});

describe('ViewModeController subscription & lifecycle', () => {
  it('focusVisibleRange_ReturnsCopy', () => {
    const vmc = new ViewModeController(host, new FakeCursor());
    const a = vmc.focusVisibleRange;
    a.startBarIndex = 999;
    expect(vmc.focusVisibleRange.startBarIndex).toBe(0);
  });

  it('onChange_SubscribeAndUnsubscribe', () => {
    const cursor = new FakeCursor();
    const vmc = new ViewModeController(host, cursor);
    const listener = vi.fn();
    const off = vmc.onChange(listener);

    vmc.setViewMode('score');
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    vmc.setViewMode('focus');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('onChange_ListenerThrows_DoesNotBreakOthers', () => {
    const vmc = new ViewModeController(host, new FakeCursor());
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    vmc.onChange(() => {
      throw new Error('boom');
    });
    vmc.onChange(good);

    vmc.setViewMode('score');
    expect(good).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it('dispose_UnsubscribesFromCursorAndClearsListeners', () => {
    const cursor = new FakeCursor({ barIndex: 0 });
    const vmc = new ViewModeController(host, cursor);
    const listener = vi.fn();
    vmc.onChange(listener);

    vmc.dispose();
    cursor.moveTo({ barIndex: 100 }); // 追従しない
    expect(host.viewModeCalls).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

// view-modes.md §9・§4.1（パッケージ7 が呼ぶ「表示範囲更新 API」の非破壊追加）
describe('ViewModeController.isBarVisible / revealBar', () => {
  it('ViewModeController_IsBarVisibleFocusMode_UsesFocusRange', () => {
    // UT: §9 — focus は現在の表示範囲で判定
    const vmc = new ViewModeController(host, new FakeCursor({ barIndex: 10 }), { focusRangeBarSpan: 4 });
    // 範囲は bar 8..11
    expect(vmc.isBarVisible(8)).toBe(true);
    expect(vmc.isBarVisible(11)).toBe(true);
    expect(vmc.isBarVisible(7)).toBe(false);
    expect(vmc.isBarVisible(12)).toBe(false);
  });

  it('ViewModeController_IsBarVisibleScrollOrScore_AlwaysTrue', () => {
    // UT: §9 — scroll / score は曲全体がスクロール可能
    const scroll = new ViewModeController(host, new FakeCursor(), { initialMode: 'scroll' });
    const score = new ViewModeController(host, new FakeCursor(), { initialMode: 'score' });
    expect(scroll.isBarVisible(999)).toBe(true);
    expect(score.isBarVisible(999)).toBe(true);
  });

  it('ViewModeController_RevealBarOutOfFocusRange_RecentersAndAppliesAndEmits', () => {
    // UT: §9・§4.1 — 範囲外の小節を表示範囲へ入れる
    const onChange = vi.fn();
    const vmc = new ViewModeController(host, new FakeCursor({ barIndex: 0 }), {
      focusRangeBarSpan: 4,
      onChange,
    });
    const callsBefore = host.viewModeCalls.length;
    vmc.revealBar(20);
    expect(vmc.focusVisibleRange).toEqual({ startBarIndex: 18, barCount: 4 });
    expect(host.viewModeCalls.length).toBe(callsBefore + 1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(vmc.isBarVisible(20)).toBe(true);
  });

  it('ViewModeController_RevealBarInsideFocusRange_NoOp', () => {
    // UT: §9 — 範囲内なら何もしない（冪等・過剰スクロール防止）
    const onChange = vi.fn();
    const vmc = new ViewModeController(host, new FakeCursor({ barIndex: 10 }), {
      focusRangeBarSpan: 8,
      onChange,
    });
    const callsBefore = host.viewModeCalls.length;
    vmc.revealBar(10);
    expect(host.viewModeCalls.length).toBe(callsBefore);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ViewModeController_RevealBarInNonFocusMode_NoOp', () => {
    // UT: §9 — scroll / score では表示範囲更新しない
    const onChange = vi.fn();
    const vmc = new ViewModeController(host, new FakeCursor(), { initialMode: 'scroll', onChange });
    const callsBefore = host.viewModeCalls.length;
    vmc.revealBar(500);
    expect(host.viewModeCalls.length).toBe(callsBefore);
    expect(onChange).not.toHaveBeenCalled();
  });
});
