// IT-VIEW: view-modes.md §6・§8 DoD — 表示モードの結合シナリオ
//
// 検証観点:
//  - 実 CursorController + ViewModeController + ZoomController を bootstrap 相当に結線
//  - フォーカス／全体スクロール／スコア表示を行き来してもカーソル位置・入力音価が保持される
//  - モードごとに独立したズーム（B16）がモード往復で保たれる
//  - 複数編集ウィンドウ相当のインスタンスで表示モード・ズームが独立
//  - 実カーソル移動でフォーカスビューの表示範囲が追従する

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { CursorController } from '../editing';
import { RecordingViewModeRenderHost } from '../testing/viewModeFakes';

import { ViewModeController } from './ViewModeController';
import { ZoomController } from './ZoomController';

/** bootstrap 相当の結線（1 編集ウィンドウ分）。 */
function wireWindow(initialMode: 'focus' | 'scroll' | 'score' = 'focus') {
  const host = new RecordingViewModeRenderHost();
  const cursor = new CursorController();
  const viewMode = new ViewModeController(host, cursor, { initialMode });
  const zoom = new ZoomController(host, () => viewMode.currentMode);
  // モード切替のたびに切替先モードのズームを再適用する（view-modes.md §5.1）。
  viewMode.onChange(() => zoom.reapplyForCurrentMode());
  return { host, cursor, viewMode, zoom };
}

describe('表示モード 通しシナリオ', () => {
  it('modeRoundTrip_preservesCursorPositionAndDuration', () => {
    const w = wireWindow('focus');
    w.cursor.setPosition({ trackIndex: 1, barIndex: 5, beatIndex: 2 });
    w.cursor.setDuration(model.Duration.Sixteenth);

    w.viewMode.setViewMode('scroll');
    w.viewMode.setViewMode('score');
    w.viewMode.setViewMode('focus');

    expect(w.cursor.position).toEqual({ trackIndex: 1, barIndex: 5, beatIndex: 2 });
    expect(w.cursor.currentDuration).toBe(model.Duration.Sixteenth);
  });

  it('zoomIsIndependentPerMode_acrossModeRoundTrip', () => {
    const w = wireWindow('focus');
    w.zoom.setZoom(220); // focus
    w.viewMode.setViewMode('score');
    w.zoom.setZoom(60); // score
    w.viewMode.setViewMode('focus');

    expect(w.zoom.zoomPercent).toBe(220);
    expect(w.host.lastZoom).toBe(2.2); // focus へ戻った時の再適用
    w.viewMode.setViewMode('score');
    expect(w.zoom.zoomPercent).toBe(60);
  });

  it('multipleWindows_modeAndZoomIndependent', () => {
    const a = wireWindow('focus');
    const b = wireWindow('focus');

    a.viewMode.setViewMode('score');
    a.zoom.setZoom(300);
    b.zoom.setZoom(45);

    expect(a.viewMode.currentMode).toBe('score');
    expect(b.viewMode.currentMode).toBe('focus');
    expect(a.zoom.zoomPercentOf('score')).toBe(300);
    expect(b.zoom.zoomPercentOf('focus')).toBe(45);
  });

  it('realCursorAdvance_followsFocusRangeWhenLeavingWindow', () => {
    const w = wireWindow('focus'); // span 8 → range [0,7]
    const callsAfterWire = w.host.viewModeCalls.length;

    // 範囲内の移動では追従しない
    w.cursor.setPosition({ trackIndex: 0, barIndex: 7, beatIndex: 0 });
    expect(w.host.viewModeCalls).toHaveLength(callsAfterWire);

    // 範囲外へ出ると追従して再適用される
    w.cursor.setPosition({ trackIndex: 0, barIndex: 12, beatIndex: 0 });
    expect(w.viewMode.focusVisibleRange).toEqual({ startBarIndex: 8, barCount: 8 });
    expect(w.host.viewModeCalls.length).toBe(callsAfterWire + 1);
    expect(w.host.lastViewMode?.focusRange).toEqual({ startBarIndex: 8, barCount: 8 });
  });

  it('switchAwayFromFocus_thenCursorMoves_noFollowUntilBackToFocus', () => {
    const w = wireWindow('focus');
    w.viewMode.setViewMode('scroll');
    const calls = w.host.viewModeCalls.length;

    w.cursor.setPosition({ trackIndex: 0, barIndex: 300, beatIndex: 0 });
    expect(w.host.viewModeCalls).toHaveLength(calls); // scroll では範囲追従しない

    w.viewMode.setViewMode('focus'); // 戻ると現在カーソル中心で取り直す
    expect(w.viewMode.focusVisibleRange.startBarIndex).toBe(296);
  });
});
