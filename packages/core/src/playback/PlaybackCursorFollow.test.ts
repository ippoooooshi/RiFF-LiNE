// UT: playback-integration.md §4.5・§6.4、05_playback_audio.md §5 — PlaybackCursorFollow
//
// 検証観点:
//  - 再生位置イベント購読 / dispose で解除
//  - 再生カーソルの小節が表示範囲外なら revealBar を呼ぶ
//  - 表示範囲内なら何もしない（過剰スクロール防止）

import { beforeEach, describe, expect, it } from 'vitest';

import { FakePlaybackSynth, FakeTickMap, RecordingViewport } from '../testing/playbackFakes';

import { PlaybackCursorFollow } from './PlaybackCursorFollow';

let synth: FakePlaybackSynth;
let viewport: RecordingViewport;
let tickMap: FakeTickMap;

beforeEach(() => {
  synth = new FakePlaybackSynth();
  viewport = new RecordingViewport();
  tickMap = new FakeTickMap(); // 1 小節 = 1000 tick
});

describe('PlaybackCursorFollow', () => {
  it('PlaybackCursorFollow_Constructor_SubscribesToPositionEvents', () => {
    new PlaybackCursorFollow(synth, viewport, tickMap);
    expect(synth.positionListenerCount).toBe(1);
  });

  it('PlaybackCursorFollow_Dispose_Unsubscribes', () => {
    const follow = new PlaybackCursorFollow(synth, viewport, tickMap);
    follow.dispose();
    expect(synth.positionListenerCount).toBe(0);
  });

  it('PlaybackCursorFollow_CursorOutsideVisibleRange_CallsRevealBar', () => {
    // UT: §4.5 — 表示範囲外に出たときのみ表示範囲更新 API を呼ぶ
    viewport.visibleBars = new Set([0, 1]);
    new PlaybackCursorFollow(synth, viewport, tickMap);
    synth.emitPosition({ currentTick: 4200 }); // bar 4（範囲外）
    expect(viewport.revealedBars).toEqual([4]);
  });

  it('PlaybackCursorFollow_CursorInsideVisibleRange_DoesNothing', () => {
    // UT: §4.5・05_playback_audio.md §5 — 範囲内なら何もしない
    viewport.visibleBars = new Set([0, 1, 2, 3]);
    new PlaybackCursorFollow(synth, viewport, tickMap);
    synth.emitPosition({ currentTick: 2500 }); // bar 2（範囲内）
    expect(viewport.revealedBars).toEqual([]);
  });

  it('PlaybackCursorFollow_SuccessiveOutOfRangeCursor_RevealsEachNewBar', () => {
    // UT: §4.5 — 追従後に範囲へ加わるので同じ小節は二度 reveal しない
    viewport.visibleBars = new Set([0]);
    new PlaybackCursorFollow(synth, viewport, tickMap);
    synth.emitPosition({ currentTick: 1500 }); // bar 1
    synth.emitPosition({ currentTick: 1600 }); // bar 1（もう可視）
    synth.emitPosition({ currentTick: 2500 }); // bar 2
    expect(viewport.revealedBars).toEqual([1, 2]);
  });
});
