// UT-EDIT-HIST: CommandHistory（元に戻す／やり直し） <!-- req webcorefoundation:5dc1870d.45b1 -->
// 検証節: editing-core.md 2.2 節・2.3 節・2.4 節、基本設計 13 章 C11
// 検証観点（2.3 節の予算の判定・下限の保証・破棄・EDIT-008 の知らせは web-core-foundation.md 14.3 節の C2 の対象）:
//  - execute・undo・redo の順番と、描き直しを操作の最後に 1 回だけ頼むこと（affectedTrackIndices をそのまま渡す）
//  - redo のスタックを空にすること、canUndo・canRedo
//  - まとめ（canMergeWith・mergeWith）で直前の項目と置き換えること
//  - 予算：超えたら古いほうから捨てる・直近の件数の下限を残す・1 つで予算を超えても実行する・EDIT-008 は初めての 1 回だけ
//  - onChange・subscribe・onCommandApplied の順番と外し方、購読の例外の切り離し、dispose

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { allCombinations } from '../../testing/combinations';
// <!-- req editingcore:3ad90622.c55e -->
import { countUndoable, FakeCommand, RecordingRenderRequester, RecordingReporter } from '../../testing/editingFakes';
import type { CommandAppliedEvent } from '../types';

import type { Command } from './Command';
import { CommandHistory, DEFAULT_MEMORY_BUDGET_BYTES, MIN_RETAINED_ENTRIES } from './CommandHistory';

let render: RecordingRenderRequester;
let reporter: RecordingReporter;

beforeEach(() => {
  // <!-- req editingcore:3ad90622.4ffd -->
  render = new RecordingRenderRequester();
  // <!-- req editingcore:3ad90622.ba71 -->
  reporter = new RecordingReporter();
});

const newHistory = (options?: ConstructorParameters<typeof CommandHistory>[2]): CommandHistory =>
  new CommandHistory(render, reporter, options);

const edit008Count = (): number => reporter.reports.filter((r) => r.code === 'EDIT-008').length;

/** 同じ大きさのコマンドを n 個実行し、実行したコマンドを古い順に返す。 */
const executeMany = (history: CommandHistory, n: number, sizeBytes: number): FakeCommand[] => {
  const commands: FakeCommand[] = [];
  for (let i = 0; i < n; i++) {
    const command = new FakeCommand({ kind: `c${i}`, sizeBytes });
    history.execute(command);
    commands.push(command);
  }
  return commands;
};

// <!-- req editingcore:3ad90622.c729 -->
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
    expect(history.undo()).toEqual({ cursorAdvance: 'none' });
    expect(render.calls).toEqual([]);
  });

  it('redo_WhenEmpty_IsNoOp', () => {
    const history = newHistory();
    expect(history.redo()).toEqual({ cursorAdvance: 'none' });
    expect(render.calls).toEqual([]);
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

  it('emptyAffectedTrackIndices_StillRequestsRenderWithEmptyList_AndNotifies', () => {
    // editing-core.md 2.4 節：どの操作でも render(affectedTrackIndices) を頼む（メモのコマンドは []）
    const history = newHistory();
    const onCommandApplied = vi.fn();
    history.onCommandApplied(onCommandApplied);
    history.execute(new FakeCommand({ affectedTrackIndices: [] }));
    expect(render.calls).toEqual([[]]);
    expect(onCommandApplied).toHaveBeenCalledTimes(1);
  });

  it('executeUndoRedo_ReturnTheCommandOutcome', () => {
    const history = newHistory();
    const cmd = new FakeCommand({ cursorAdvanceOnExecute: 'beat' });
    expect(history.execute(cmd)).toEqual({ cursorAdvance: 'beat' });
    expect(history.undo()).toEqual({ cursorAdvance: 'none' });
    expect(history.redo()).toEqual({ cursorAdvance: 'beat' });
  });

  it('executeUndoRedo_RenderOnceAtTheEnd_AfterStacksAreUpdated', () => {
    // editing-core.md 2.4 節：execute() → undo に積む → redo を空にする → render。undo は undo() → redo に積む → render。
    // redo は execute() → undo に積む → render。描き直しは操作の最後に 1 回だけ
    const seen: string[] = [];
    const cmd = new FakeCommand({ affectedTrackIndices: [3] });
    let history: CommandHistory | null = null;
    const spyRender = {
      render: (tracks?: number[]): void => {
        seen.push(
          `${JSON.stringify(tracks)} undo=${history!.canUndo()} redo=${history!.canRedo()} exec=${cmd.executeCount} undone=${cmd.undoCount}`,
        );
      },
    };
    history = new CommandHistory(spyRender, reporter);
    history.execute(new FakeCommand({ affectedTrackIndices: [0] }));
    history.undo(); // redo のスタックに 1 つ置く
    seen.length = 0;

    history.execute(cmd);
    history.undo();
    history.redo();

    expect(seen).toEqual([
      '[3] undo=true redo=false exec=1 undone=0',
      '[3] undo=false redo=true exec=1 undone=1',
      '[3] undo=true redo=false exec=2 undone=1',
    ]);
  });
});

describe('CommandHistory — merge（editing-core.md 2.2 節）', () => {
  it('execute_MergeableWithTop_FoldsIntoSingleEntry', () => {
    const history = newHistory();
    history.execute(new FakeCommand({ kind: 'drag' }));
    const second = new FakeCommand({ kind: 'drag', mergeableWithKind: 'drag' });
    history.execute(second);

    expect(second.mergedFrom).toHaveLength(1);
    // まとめても undo は 1 回で戻る
    history.undo();
    expect(second.undoCount).toBe(1);
    expect(history.canUndo()).toBe(false);
  });

  it('execute_NotMergeable_KeepsSeparateEntries', () => {
    const history = newHistory();
    history.execute(new FakeCommand({ kind: 'a' }));
    history.execute(new FakeCommand({ kind: 'b', mergeableWithKind: 'x' }));
    expect(countUndoable(history)).toBe(2);
  });

  it('execute_CanMergeButNoMergeWith_KeepsSeparateEntries', () => {
    const history = newHistory();
    history.execute(new FakeCommand({ kind: 'drag' }));
    const second = new FakeCommand({ kind: 'drag', mergeableWithKind: 'drag' });
    const withoutMerge: Command = {
      kind: second.kind,
      label: second.label,
      affectedTrackIndices: second.affectedTrackIndices,
      execute: () => second.execute(),
      undo: () => second.undo(),
      canMergeWith: (other) => second.canMergeWith(other),
      estimateSizeBytes: () => second.estimateSizeBytes(),
    };
    history.execute(withoutMerge);
    expect(countUndoable(history)).toBe(2);
  });

  it('execute_CommandWithoutCanMergeWith_KeepsSeparateEntries', () => {
    const history = newHistory();
    history.execute(new FakeCommand({ kind: 'a' }));
    const plain: Command = {
      kind: 'a',
      label: 'place-note',
      affectedTrackIndices: [0],
      execute: () => ({ cursorAdvance: 'none' }),
      undo: () => ({ cursorAdvance: 'none' }),
      estimateSizeBytes: () => 1,
    };
    history.execute(plain);
    expect(countUndoable(history)).toBe(2);
  });

  it('execute_Merged_CountsTheOldEntrySizeOnlyOnce', () => {
    // まとめた直前の項目の大きさを合計から引かないと、1000 + 1000 > 1500 で、まとめた項目そのものを捨ててしまう
    const history = newHistory({ memoryBudgetBytes: 1500, minRetainedEntries: 0 });
    history.execute(new FakeCommand({ kind: 'drag', sizeBytes: 1000 }));
    history.execute(new FakeCommand({ kind: 'drag', mergeableWithKind: 'drag', sizeBytes: 1000 }));
    expect(history.canUndo()).toBe(true);
    expect(edit008Count()).toBe(0);
  });
});

describe('CommandHistory — 履歴の深さ（editing-core.md 2.3 節、C11）', () => {
  it('defaults_Are80MBAnd200Entries', () => {
    expect(DEFAULT_MEMORY_BUDGET_BYTES).toBe(80 * 1024 * 1024);
    expect(MIN_RETAINED_ENTRIES).toBe(200);
  });

  it('defaultBudget_Within80MB_KeepsEverything', () => {
    // 250 件 × 300,000 バイト = 75,000,000 バイト ≦ 80MB
    const history = newHistory();
    executeMany(history, 250, 300_000);
    expect(countUndoable(history)).toBe(250);
    expect(edit008Count()).toBe(0);
  });

  it('defaultBudget_Over80MB_EvictsDownToBudget_AboveTheFloorOf200', () => {
    // 250 件 × 400,000 バイト = 100,000,000 バイト > 80MB。80MB に収まるのは 209 件（200 件の下限より多い）
    const history = newHistory();
    executeMany(history, 250, 400_000);
    expect(countUndoable(history)).toBe(Math.floor(DEFAULT_MEMORY_BUDGET_BYTES / 400_000));
    expect(edit008Count()).toBe(1);
  });

  it('defaultFloor_KeepsLatest200_EvenOverBudget', () => {
    // 201 件 × 1MB：80MB を超えていても、直近 200 件は残す <!-- req webcorefoundation:a26ea86d.b357 --> <!-- req webcorefoundation:c1f9af3d.d8d7 -->
    const history = newHistory();
    executeMany(history, 201, 1024 * 1024);
    expect(countUndoable(history)).toBe(200);
  });

  it('execute_OverBudget_EvictsOldestDownToFloor', () => {
    // 予算 5000、下限 3 件、各 2000：3 件（6000）でも予算を超えるが、下限で止める <!-- req webcorefoundation:c1f9af3d.a188 -->
    const history = newHistory({ memoryBudgetBytes: 5000, minRetainedEntries: 3 });
    const commands = executeMany(history, 6, 2000);
    expect(countUndoable(history)).toBe(3);
    // 捨てたのは古い 3 件（取り消しの対象に残っていない）
    while (history.canUndo()) history.undo();
    expect(commands.map((c) => c.undoCount > 0)).toEqual([false, false, false, true, true, true]);
  });

  // <!-- req editingcore:ec2a0c7e.1c7f -->
  it('execute_OverBudget_StopsOnceWithinBudget', () => {
    // 下限 0 なら、合計が予算に入った所で止める（5000 に入るのは 2 件）
    const history = newHistory({ memoryBudgetBytes: 5000, minRetainedEntries: 0 });
    executeMany(history, 6, 2000);
    expect(countUndoable(history)).toBe(2);
  });

  // <!-- req editingcore:ec2a0c7e.4c59 -->
  it('execute_UnderFloor_NeverEvicts', () => {
    const history = newHistory({ memoryBudgetBytes: 100, minRetainedEntries: 5 });
    executeMany(history, 4, 10_000);
    expect(countUndoable(history)).toBe(4); // 下限より少ないので、予算を超えていても残す
    expect(edit008Count()).toBe(0);
  });

  it('execute_SingleCommandOverBudget_StillExecutesAndKeepsFloor', () => {
    const history = newHistory({ memoryBudgetBytes: 1000, minRetainedEntries: 2 });
    const a = new FakeCommand({ kind: 'a', sizeBytes: 100 });
    const b = new FakeCommand({ kind: 'b', sizeBytes: 100 });
    history.execute(a);
    history.execute(b);
    const huge = new FakeCommand({ kind: 'huge', sizeBytes: 10_000_000 });
    history.execute(huge);
    expect(huge.executeCount).toBe(1); // 実行は拒まない
    expect(countUndoable(history)).toBe(2); // 下限まで縮む（a を捨て、b と huge が残る）
    while (history.canUndo()) history.undo();
    expect([a, b, huge].map((c) => c.undoCount > 0)).toEqual([false, true, true]);
  });

  it('execute_ClearedRedoStack_IsSubtractedFromTheTotal', () => {
    // a・b・c（3000）→ b・c を取り消して redo に置く → d を実行：redo を空にした分を引けば 2000 で予算内
    const history = newHistory({ memoryBudgetBytes: 3000, minRetainedEntries: 0 });
    executeMany(history, 3, 1000);
    history.undo();
    history.undo();
    history.execute(new FakeCommand({ kind: 'd', sizeBytes: 1000 }));
    expect(countUndoable(history)).toBe(2);
    expect(edit008Count()).toBe(0);
  });

  it('execute_RedoStackCountsTowardTheBudget_UntilCleared', () => {
    // undo しても合計は変わらない（2 つのスタックの合計で数える）。undo と redo では捨てない <!-- req webcorefoundation:c2432139.b311 -->
    const history = newHistory({ memoryBudgetBytes: 2500, minRetainedEntries: 0 });
    executeMany(history, 2, 1000);
    history.undo();
    history.redo();
    expect(countUndoable(history)).toBe(2);
    expect(edit008Count()).toBe(0);
  });

  // C2（web-core-foundation.md 14.3 節）：予算を超えたか × 下限の件数を超えているか。捨てるのは両方が真のときだけ <!-- req webcorefoundation:c1f9af3d.61e4 -->
  // <!-- req editingcore:ec2a0c7e.8ad1 --> <!-- req webcorefoundation:c1f9af3d.986f -->
  it.each(allCombinations(['overBudget', 'aboveFloor'] as const))(
    'enforceBudget_C2_overBudget=$overBudget, aboveFloor=$aboveFloor',
    ({ overBudget, aboveFloor }) => {
      // 下限 2 件、各 100。積んだ後の件数は aboveFloor なら 3 件、そうでなければ 2 件。
      // 予算は overBudget なら 150（2 件の 200 でも超える）、そうでなければ 1000
      const history = newHistory({ memoryBudgetBytes: overBudget ? 150 : 1000, minRetainedEntries: 2 }); // <!-- req webcorefoundation:c1f9af3d.4b5a -->
      executeMany(history, aboveFloor ? 3 : 2, 100);
      const expectEvicted = overBudget && aboveFloor;
      expect(countUndoable(history)).toBe(expectEvicted ? 2 : aboveFloor ? 3 : 2);
      expect(edit008Count()).toBe(expectEvicted ? 1 : 0);
    },
  );
});

describe('CommandHistory — EDIT-008 の知らせ（editing-core.md 2.3 節）', () => {
  it('EDIT-008: 使えるメモリを超える取り消しの履歴', () => {
    const history = newHistory({ memoryBudgetBytes: 3000, minRetainedEntries: 1 });
    executeMany(history, 10, 2000);
    const edit008 = reporter.reports.filter((r) => r.code === 'EDIT-008');
    expect(edit008).toHaveLength(1);
    expect(edit008[0]?.context).toEqual({ evictedCount: 1 });
  });

  it('noEviction_NoEDIT008', () => {
    const history = newHistory();
    history.execute(new FakeCommand({ sizeBytes: 100 }));
    expect(reporter.reports).toEqual([]);
  });

  it('EDIT008_AfterUndoAndRedo_StillOnlyOnce', () => {
    const history = newHistory({ memoryBudgetBytes: 150, minRetainedEntries: 1 });
    executeMany(history, 2, 100); // 1 回目の破棄
    history.undo();
    history.redo();
    executeMany(history, 2, 100); // 2 回目・3 回目の破棄
    expect(edit008Count()).toBe(1);
  });

  it('EDIT008_IsCountedPerHistory', () => {
    // 編集ウィンドウ（CommandHistory）ごとに初めての 1 回を数える
    const first = newHistory({ memoryBudgetBytes: 150, minRetainedEntries: 1 });
    const second = newHistory({ memoryBudgetBytes: 150, minRetainedEntries: 1 });
    executeMany(first, 3, 100);
    executeMany(second, 3, 100);
    expect(edit008Count()).toBe(2);
  });

  // C2（web-core-foundation.md 14.3 節）：破棄が起きたか × この履歴で初めての 1 回か。知らせるのは両方が真のときだけ <!-- req webcorefoundation:c2432139.1bdb -->
  // <!-- req editingcore:ec2a0c7e.7512 --> <!-- req webcorefoundation:c2432139.6694 -->
  it.each(allCombinations(['evicted', 'first'] as const))(
    'EDIT008_C2_evicted=$evicted, first=$first',
    ({ evicted, first }) => {
      // 予算 150、下限 1 件、各 100。
      const history = newHistory({ memoryBudgetBytes: 150, minRetainedEntries: 1 });
      if (first) {
        history.execute(new FakeCommand({ sizeBytes: 100 })); // 1 件（100）：破棄しない
      } else {
        executeMany(history, 2, 100); // 2 件目で 1 件捨てる（ここで 1 回目の知らせ）
      }
      expect(edit008Count()).toBe(first ? 0 : 1);
      const before = edit008Count();
      // evicted なら 100 を足して 200 > 150 で 1 件捨てる。そうでなければ 10 を足して 110 ≦ 150
      history.execute(new FakeCommand({ sizeBytes: evicted ? 100 : 10 }));
      expect(countUndoable(history)).toBe(evicted ? 1 : 2);
      expect(edit008Count() - before).toBe(evicted && first ? 1 : 0); // <!-- req webcorefoundation:c2432139.3207 -->
    },
  );
});

describe('CommandHistory — 購読（editing-core.md 2.2 節）', () => {
  it('onChange_FiresOnEveryApply', () => {
    const onChange = vi.fn();
    const history = newHistory({ onChange });
    history.execute(new FakeCommand());
    history.undo();
    history.redo();
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('afterApply_OrderIsRenderThenOnChangeThenAppliedThenSubscribe', () => {
    const order: string[] = [];
    const history = new CommandHistory({ render: () => order.push('render') }, reporter, {
      onChange: () => order.push('onChange'),
    });
    history.subscribe(() => order.push('subscribe'));
    history.onCommandApplied(() => order.push('applied'));
    history.execute(new FakeCommand());
    history.undo();
    history.redo();
    expect(order).toEqual([
      ...['render', 'onChange', 'applied', 'subscribe'],
      ...['render', 'onChange', 'applied', 'subscribe'],
      ...['render', 'onChange', 'applied', 'subscribe'],
    ]);
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

  it('onCommandApplied_Unsubscribe_StopsDelivery', () => {
    const history = newHistory();
    const listener = vi.fn();
    const off = history.onCommandApplied(listener);
    history.execute(new FakeCommand());
    off();
    history.undo();
    expect(listener).toHaveBeenCalledTimes(1);
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
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('dispose_ClearsStacksAndListeners', () => {
    const history = newHistory();
    const listener = vi.fn();
    history.subscribe(listener);
    history.execute(new FakeCommand());
    history.execute(new FakeCommand());
    history.undo();
    history.dispose();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    history.execute(new FakeCommand());
    expect(listener).toHaveBeenCalledTimes(3); // dispose の後の execute では呼ばれない
  });

  it('dispose_ResetsTheSizeTotal', () => {
    // dispose で合計を 0 に戻さないと、次の 1000 で 2000 > 1500 になり、積んだばかりの項目を捨てる
    const history = newHistory({ memoryBudgetBytes: 1500, minRetainedEntries: 0 });
    history.execute(new FakeCommand({ sizeBytes: 1000 }));
    history.dispose();
    history.execute(new FakeCommand({ sizeBytes: 1000 }));
    expect(history.canUndo()).toBe(true);
    expect(edit008Count()).toBe(0);
  });
});
