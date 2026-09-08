// UT: playback-integration.md §4.2・§3.1・§6.1・§7 — PlaybackSyncController
//
// §7 で C2 指定：dirty 管理・境界検知の複合条件（再生中か × ループ有無 × 境界一致）を条件網羅する。
// ループ有無で分岐しない「単一ルール」（§3.1）＝ ループ境界も通常の小節境界と同じ経路で flush される。
//
// 検証観点:
//  - 3 チャンネル購読 / dispose で解除
//  - onCommandApplied：再生中のみ dirty へ追加、停止中は無視、複数コマンドで和集合
//  - 位置イベント：初回は基準記録のみ、同一小節は無反応、小節境界（前進 / ループの後退）で strategy.sync → clear
//  - 境界でも dirty が空なら strategy 呼ばれない
//  - 状態イベント：停止 / 一時停止で dirty クリア

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeSong } from '../testing/editingFixtures';
import { FakeCommandAppliedSource, FakePlaybackSynth, FakeTickMap } from '../testing/playbackFakes';

import { PlaybackSyncController } from './PlaybackSyncController';
import type { AudioSyncStrategy } from './types';

let synth: FakePlaybackSynth;
let history: FakeCommandAppliedSource;
let tickMap: FakeTickMap;
let strategy: AudioSyncStrategy;
let syncMock: ReturnType<typeof createSyncMock>;

function createSyncMock() {
  return vi.fn((_dirty: readonly number[], _context: unknown): void => undefined);
}

const score = makeSong(3).score;

beforeEach(() => {
  synth = new FakePlaybackSynth();
  history = new FakeCommandAppliedSource();
  tickMap = new FakeTickMap(); // 1 小節 = 1000 tick
  syncMock = createSyncMock();
  strategy = { kind: 'pause-resume', sync: syncMock };
});

function makeController(): PlaybackSyncController {
  return new PlaybackSyncController(synth, history, tickMap, { score, strategy });
}

describe('PlaybackSyncController subscription lifecycle', () => {
  it('PlaybackSyncController_Constructor_SubscribesToCommandStateAndPosition', () => {
    // UT: §4.2
    makeController();
    expect(history.listenerCount).toBe(1);
    expect(synth.stateListenerCount).toBe(1);
    expect(synth.positionListenerCount).toBe(1);
  });

  it('PlaybackSyncController_Dispose_UnsubscribesAllAndClearsDirty', () => {
    // UT: §4.2
    const controller = makeController();
    synth.emitState(true);
    history.emit([1]);
    controller.dispose();
    expect(history.listenerCount).toBe(0);
    expect(synth.stateListenerCount).toBe(0);
    expect(synth.positionListenerCount).toBe(0);
    expect(controller.dirtyTrackIndices).toEqual([]);
  });
});

describe('PlaybackSyncController dirty detection (再生中か)', () => {
  it('PlaybackSyncController_CommandAppliedWhilePlaying_AddsAffectedTracksToDirty', () => {
    // UT: §4.2 — 再生中 → dirty へ
    const controller = makeController();
    synth.emitState(true);
    history.emit([2, 0]);
    expect(controller.dirtyTrackIndices).toEqual([0, 2]);
  });

  it('PlaybackSyncController_CommandAppliedWhileNotPlaying_Ignored', () => {
    // UT: §4.2・§3.1 — 停止中は dirty 管理しない
    const controller = makeController();
    history.emit([0, 1]);
    expect(controller.dirtyTrackIndices).toEqual([]);
  });

  it('PlaybackSyncController_MultipleCommands_AccumulatesUnion', () => {
    // UT: §4.2
    const controller = makeController();
    synth.emitState(true);
    history.emit([0]);
    history.emit([1, 2]);
    history.emit([1]);
    expect(controller.dirtyTrackIndices).toEqual([0, 1, 2]);
  });
});

describe('PlaybackSyncController boundary flush (境界一致 × dirty)', () => {
  function primeDirty(controller: PlaybackSyncController, tracks: number[]): void {
    synth.emitState(true);
    history.emit(tracks);
    synth.emitPosition({ currentTick: 200 }); // bar 0：初回イベントで基準記録
    expect(syncMock).not.toHaveBeenCalled();
    void controller;
  }

  it('PlaybackSyncController_FirstPositionEvent_RecordsBaselineWithoutFlush', () => {
    // UT: §4.2 — 初回は基準記録のみ（C2：境界一致=判定不能）
    const controller = makeController();
    synth.emitState(true);
    history.emit([1]);
    synth.emitPosition({ currentTick: 500 });
    expect(syncMock).not.toHaveBeenCalled();
    expect(controller.dirtyTrackIndices).toEqual([1]);
  });

  it('PlaybackSyncController_SameBarPositionEvent_NoFlush', () => {
    // UT: §4.2 — 境界不一致（同一小節）
    const controller = makeController();
    primeDirty(controller, [1]);
    synth.emitPosition({ currentTick: 800 }); // まだ bar 0
    expect(syncMock).not.toHaveBeenCalled();
    expect(controller.dirtyTrackIndices).toEqual([1]);
  });

  it('PlaybackSyncController_ForwardBarBoundaryWithDirty_FlushesViaStrategyAndClears', () => {
    // UT: §4.2・§3.1 — 再生中 × 境界一致（前進）× dirty 有
    const controller = makeController();
    primeDirty(controller, [2, 0]);
    synth.emitPosition({ currentTick: 1200 }); // bar 0 → bar 1
    expect(syncMock).toHaveBeenCalledWith([0, 2], { synth, score });
    expect(controller.dirtyTrackIndices).toEqual([]);
  });

  it('PlaybackSyncController_LoopBoundaryBackwardJumpWithDirty_AlsoFlushes', () => {
    // UT: §3.1 — ループ境界（後退ジャンプ）も同じ単一ルールで flush される
    const controller = makeController();
    synth.emitState(true);
    history.emit([1]);
    synth.emitPosition({ currentTick: 3500 }); // bar 3：基準
    history.emit([1]); // 再生中の追加編集
    synth.emitPosition({ currentTick: 100, isSeek: true }); // ループ先頭へ後退（bar 3 → bar 0）
    expect(syncMock).toHaveBeenCalledWith([1], { synth, score });
    expect(controller.dirtyTrackIndices).toEqual([]);
  });

  it('PlaybackSyncController_BarBoundaryWithoutDirty_StrategyNotCalled', () => {
    // UT: §4.2 — 再生中 × 境界一致 × dirty 無
    makeController();
    synth.emitState(true);
    synth.emitPosition({ currentTick: 200 }); // bar 0 基準
    synth.emitPosition({ currentTick: 1200 }); // bar 1
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe('PlaybackSyncController state changes', () => {
  it('PlaybackSyncController_Stopped_ClearsDirtyAndBaseline', () => {
    // UT: §4.2 — 停止で dirty を捨てる
    const controller = makeController();
    synth.emitState(true);
    history.emit([0, 1]);
    synth.emitState(false, true);
    expect(controller.dirtyTrackIndices).toEqual([]);
    // 再度再生 → 新しい基準から動作する（前回の lastBarIndex を引きずらない）
    synth.emitState(true);
    history.emit([2]);
    synth.emitPosition({ currentTick: 200 });
    synth.emitPosition({ currentTick: 1200 });
    expect(syncMock).toHaveBeenCalledWith([2], { synth, score });
  });

  it('PlaybackSyncController_Paused_ClearsDirty', () => {
    // UT: §4.2
    const controller = makeController();
    synth.emitState(true);
    history.emit([1]);
    synth.emitState(false, false); // pause
    expect(controller.dirtyTrackIndices).toEqual([]);
  });
});
