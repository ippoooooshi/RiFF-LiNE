// UT-EDIT-HIST: editing-core.md §6.2・§10.1・§10.2、04_editing_core.md §8.2、C11 — CommandHistory
// 検証観点（§8.2 により C2 対象）:
//  - execute/undo/redo の順序と再描画呼び出しの一元化（affectedTrackIndices 指定 / fullRedraw）
//  - redoStack のクリア、canUndo/canRedo
//  - 結合（canMergeWith/mergeWith）で 1 エントリに畳む
//  - メモリ予算：超過時に最古から破棄・直近200件下限・単一超過コマンドでも実行継続・EDIT-008 初回のみ
//  - onChange（自動保存トリガ）、subscribe（状態通知）、onCommandApplied（他パッケージ通知）
//  - 購読ハンドラ例外の分離、dispose

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandHistory } from './CommandHistory';
import type { CommandAppliedEvent } from './types';
import { FakeCommand, RecordingRenderRequester, RecordingReporter } from '../testing/editingFakes';

let render: RecordingRenderRequester;
let reporter: RecordingReporter;

beforeEach(() => {
  render = new RecordingRenderRequester();
  reporter = new RecordingReporter();
});

const newHistory = (options?: ConstructorParameters<typeof CommandHistory>[2]): CommandHistory =>
  new CommandHistory(render, reporter, options);

describe('CommandHistory — execute / undo / redo', () => {
  it('execute_RunsCommandPushesUndoAndRendersAffectedTracks', () => {
    const history = newHistory();
    const cmd = new FakeCommand({ affectedTrackIndices: [1, 2] });
    history.execute(cmd);

    expect(cmd.executeCount).toBe(1);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(render.calls).toEqual([[1, 2]]);
  });

  it('undo_ThenRedo_RestoresState', () => {
    const history = newHistory();
    const cmd = new FakeCommand();
    history.execute(cmd);
    history.undo();
    expect(cmd.undoCount).toBe(1);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    history.redo();
    expect(cmd.executeCount).toBe(2);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it('undo_WhenEmpty_IsNoOp', () => {
    const history = newHistory();
    expect(() => history.undo()).not.toThrow();
    expect(render.calls).toEqual([]);
  });

  it('redo_WhenEmpty_IsNoOp', () => {
    const history = newHistory();
    expect(() => history.redo()).not.toThrow();
  });

  it('execute_AfterUndo_ClearsRedoStack', () => {
    const history = newHistory();
    history.execute(new FakeCommand({ kind: 'a' }));
    history.execute(new FakeCommand({ kind: 'b' }));
    history.undo();
    expect(history.canRedo()).toBe(true);
    history.execute(new FakeCommand({ kind: 'c' }));
    expect(history.canRedo()).toBe(false);
  });

  it('setFullRedraw_MakesRenderUseWholeScore', () => {
    const history = newHistory();
    history.setFullRedraw(true);
    history.execute(new FakeCommand({ affectedTrackIndices: [0] }));
    expect(render.calls).toEqual([undefined]);
  });

  it('emptyAffectedTrackIndices_SkipsRender_ButStillNotifies', () => {
    const history = newHistory();
    const onCommandApplied = vi.fn();
    history.onCommandApplied(onCommandApplied);
    history.execute(new FakeCommand({ affectedTrackIndices: [] }));
    expect(render.calls).toEqual([]); // 譜面再描画不要（メモ系）
    expect(onCommandApplied).toHaveBeenCalledTimes(1); // 適用通知・自動保存トリガは走る
  });

  it('emptyAffectedTrackIndices_WithFullRedraw_StillRendersWhole', () => {
    const history = newHistory();
    history.setFullRedraw(true);
    history.execute(new FakeCommand({ affectedTrackIndices: [] }));
    expect(render.calls).toEqual([undefined]);
  });
});

describe('CommandHistory — merge', () => {
  it('execute_MergeableWithTop_FoldsIntoSingleEntry', () => {
    const history = newHistory();
    history.execute(new FakeCommand({ kind: 'drag' }));
    const second = new FakeCommand({ kind: 'drag', mergeableWithKind: 'drag' });
    history.execute(second);

    expect(history.undoDepth).toBe(1);
    expect(second.mergedFrom).toHaveLength(1);
    // 畳んでも undo は 1 回で戻る
    history.undo();
    expect(second.undoCount).toBe(1);
    expect(history.canUndo()).toBe(false);
  });

  it('execute_NotMergeable_KeepsSeparateEntries', () => {
    const history = newHistory();
    history.execute(new FakeCommand({ kind: 'a' }));
    history.execute(new FakeCommand({ kind: 'b', mergeableWithKind: 'x' }));
    expect(history.undoDepth).toBe(2);
  });
});

describe('CommandHistory — memory budget (C11)', () => {
  it('execute_OverBudget_EvictsOldestDownToFloor', () => {
    // 予算 5KB、下限 3 件、各コマンド 2KB。
    const history = newHistory({ memoryBudgetBytes: 5000, minRetainedEntries: 3 });
    for (let i = 0; i < 6; i++) history.execute(new FakeCommand({ kind: `c${i}`, sizeBytes: 2000 }));
    // 6 件 push だが下限 3 件までしか縮まない（3×2000=6000 > 5000 でも下限で打ち切り）
    expect(history.undoDepth).toBe(3);
    expect(history.estimatedSizeBytes).toBe(6000);
  });

  it('execute_UnderFloor_NeverEvicts', () => {
    const history = newHistory({ memoryBudgetBytes: 100, minRetainedEntries: 5 });
    for (let i = 0; i < 4; i++) history.execute(new FakeCommand({ sizeBytes: 10_000 }));
    expect(history.undoDepth).toBe(4); // 下限未満なので予算超過でも保持
  });

  it('execute_SingleCommandOverBudget_StillExecutesAndKeepsFloor', () => {
    const history = newHistory({ memoryBudgetBytes: 1000, minRetainedEntries: 2 });
    history.execute(new FakeCommand({ kind: 'a', sizeBytes: 100 }));
    history.execute(new FakeCommand({ kind: 'b', sizeBytes: 100 }));
    const huge = new FakeCommand({ kind: 'huge', sizeBytes: 10_000_000 });
    history.execute(huge);
    expect(huge.executeCount).toBe(1); // 実行は拒否しない
    expect(history.undoDepth).toBe(2); // 下限まで縮む（a を破棄、b と huge が残る）
  });

  it('eviction_ReportsEDIT008_OnlyOnce', () => {
    const history = newHistory({ memoryBudgetBytes: 3000, minRetainedEntries: 1 });
    for (let i = 0; i < 10; i++) history.execute(new FakeCommand({ kind: `c${i}`, sizeBytes: 2000 }));
    const edit008 = reporter.reports.filter((r) => r.code === 'EDIT-008');
    expect(edit008).toHaveLength(1);
    expect(edit008[0]?.context).toMatchObject({ evictedCount: expect.any(Number) });
  });

  it('noEviction_NoEDIT008', () => {
    const history = newHistory();
    history.execute(new FakeCommand({ sizeBytes: 100 }));
    expect(reporter.reports).toEqual([]);
  });
});

describe('CommandHistory — subscriptions', () => {
  it('onChange_FiresOnEveryApply', () => {
    const onChange = vi.fn();
    const history = newHistory({ onChange });
    history.execute(new FakeCommand());
    history.undo();
    history.redo();
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('subscribe_FiresOnStateChange_Unsubscribe', () => {
    const history = newHistory();
    const listener = vi.fn();
    const off = history.subscribe(listener);
    history.execute(new FakeCommand());
    history.undo();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    history.redo();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('onCommandApplied_DeliversPhaseKindAndTracks', () => {
    const history = newHistory();
    const events: CommandAppliedEvent[] = [];
    history.onCommandApplied((e) => events.push(e));
    history.execute(new FakeCommand({ kind: 'place-note', affectedTrackIndices: [0] }));
    history.undo();
    history.redo();
    expect(events.map((e) => e.phase)).toEqual(['execute', 'undo', 'redo']);
    expect(events[0]).toEqual({ phase: 'execute', kind: 'place-note', affectedTrackIndices: [0] });
  });

  it('listenerThrow_IsIsolated_OthersStillRun', () => {
    const history = newHistory();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const goodApplied = vi.fn();
    const goodState = vi.fn();
    history.onCommandApplied(() => {
      throw new Error('boom1');
    });
    history.onCommandApplied(goodApplied);
    history.subscribe(() => {
      throw new Error('boom2');
    });
    history.subscribe(goodState);

    expect(() => history.execute(new FakeCommand())).not.toThrow();
    expect(goodApplied).toHaveBeenCalled();
    expect(goodState).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('dispose_ClearsStacksAndListeners', () => {
    const history = newHistory();
    const listener = vi.fn();
    history.subscribe(listener);
    history.execute(new FakeCommand());
    history.dispose();
    expect(history.canUndo()).toBe(false);
    expect(history.estimatedSizeBytes).toBe(0);
    history.execute(new FakeCommand());
    expect(listener).toHaveBeenCalledTimes(1); // dispose 後の execute では呼ばれない
  });
});
