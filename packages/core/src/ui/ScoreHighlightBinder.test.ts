// UT-UI-SHB: ScoreHighlightBinder（screens-navigation.md §4.5・§4.5.1・§5.3）
// 検証節: screens-navigation.md §4.5（context からハイライト要求を組み立てる）、§4.5.1（ScoreRenderHost 拡張呼び出し）
import { describe, expect, it, vi } from 'vitest';

import type { NotificationEvent } from '../errors';

import { ScoreHighlightBinder, type ScoreHighlightHost } from './ScoreHighlightBinder';

function makeHost(): { host: ScoreHighlightHost; show: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } {
  const show = vi.fn();
  const clear = vi.fn();
  return { host: { showErrorHighlight: show, clearErrorHighlight: clear }, show, clear };
}

function event(context?: Record<string, unknown>): NotificationEvent {
  return context !== undefined
    ? { level: 'error', channel: 'highlight', code: 'EDIT-001', message: 'm', context, timestamp: 't' }
    : { level: 'error', channel: 'highlight', code: 'EDIT-001', message: 'm', timestamp: 't' };
}

describe('ScoreHighlightBinder', () => {
  it('ScoreHighlightBinder_barIndexあり_trackIndexとbarCountの既定でハイライト要求', () => {
    // UT-UI-SHB-01 §4.5
    const { host, show } = makeHost();
    new ScoreHighlightBinder(host).handle(event({ barIndex: 3 }));
    expect(show).toHaveBeenCalledWith({ trackIndex: 0, startBarIndex: 3, barCount: 1, code: 'EDIT-001' });
  });

  it('ScoreHighlightBinder_trackIndexとbarCountを反映する', () => {
    // UT-UI-SHB-02 §4.5
    const { host, show } = makeHost();
    new ScoreHighlightBinder(host).handle(event({ barIndex: 10, trackIndex: 2, barCount: 4 }));
    expect(show).toHaveBeenCalledWith({ trackIndex: 2, startBarIndex: 10, barCount: 4, code: 'EDIT-001' });
  });

  it('ScoreHighlightBinder_context値が文字列でも数値として扱う', () => {
    // UT-UI-SHB-03 §4.5（慣例フィールドの型揺れ吸収）
    const { host, show } = makeHost();
    new ScoreHighlightBinder(host).handle(event({ barIndex: '5', trackIndex: '1' }));
    expect(show).toHaveBeenCalledWith({ trackIndex: 1, startBarIndex: 5, barCount: 1, code: 'EDIT-001' });
  });

  it('ScoreHighlightBinder_barIndexなし（TAG-001等）_ハイライトせず既存を解除', () => {
    // UT-UI-SHB-04 §4.5（譜面に紐付かない Error）
    const { host, show, clear } = makeHost();
    new ScoreHighlightBinder(host).handle(event({ tagCount: 51 }));
    expect(show).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('ScoreHighlightBinder_context自体なし_解除のみ', () => {
    // UT-UI-SHB-05 §4.5（分岐網羅）
    const { host, show, clear } = makeHost();
    new ScoreHighlightBinder(host).handle(event());
    expect(show).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('ScoreHighlightBinder_負のbarIndex_無効として解除扱い', () => {
    // UT-UI-SHB-06 §4.5（範囲外ガード）
    const { host, show, clear } = makeHost();
    new ScoreHighlightBinder(host).handle(event({ barIndex: -1 }));
    expect(show).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });
});
