// UT-EDIT-CURSOR: editing-core.md §4、04_editing_core.md §1〜§3 — CursorController
// 検証観点: 位置設定/前進、和音入力モード中は前進しない、手動移動で和音モード解除、
//           音価保持、範囲選択、applyOutcome の分岐、onChange 通知（C0/C1）。

import { describe, expect, it, vi } from 'vitest';

import { model } from '@coderline/alphatab';

import { CursorController } from './CursorController';

describe('CursorController — position', () => {
  it('position_DefaultsToOrigin', () => {
    expect(new CursorController().position).toEqual({ trackIndex: 0, barIndex: 0, beatIndex: 0 });
  });

  it('setPosition_ClampsNegativeToZero', () => {
    const c = new CursorController();
    c.setPosition({ trackIndex: -1, barIndex: -3, beatIndex: 2 });
    expect(c.position).toEqual({ trackIndex: 0, barIndex: 0, beatIndex: 2 });
  });

  it('advanceBeat_IncrementsBeatIndex', () => {
    const c = new CursorController();
    c.advanceBeat();
    c.advanceBeat();
    expect(c.position.beatIndex).toBe(2);
  });
});

describe('CursorController — chord input mode', () => {
  it('advanceBeat_WhileChordInput_DoesNotAdvance', () => {
    const c = new CursorController();
    c.enterChordInput();
    c.advanceBeat();
    expect(c.position.beatIndex).toBe(0);
    c.exitChordInput();
    c.advanceBeat();
    expect(c.position.beatIndex).toBe(1);
  });

  it('setPosition_ClearsChordInputMode', () => {
    const c = new CursorController();
    c.enterChordInput();
    expect(c.chordInputMode).toBe(true);
    c.setPosition({ trackIndex: 0, barIndex: 0, beatIndex: 0 });
    expect(c.chordInputMode).toBe(false);
  });
});

describe('CursorController — applyOutcome', () => {
  it('applyOutcome_BeatAdvance_MovesCursor', () => {
    const c = new CursorController();
    c.applyOutcome({ cursorAdvance: 'beat' });
    expect(c.position.beatIndex).toBe(1);
  });

  it('applyOutcome_None_DoesNotMove', () => {
    const c = new CursorController();
    c.applyOutcome({ cursorAdvance: 'none' });
    expect(c.position.beatIndex).toBe(0);
  });

  it('applyOutcome_BeatAdvance_WhileChordInput_DoesNotMove', () => {
    const c = new CursorController();
    c.enterChordInput();
    c.applyOutcome({ cursorAdvance: 'beat' });
    expect(c.position.beatIndex).toBe(0);
  });
});

describe('CursorController — duration & selection', () => {
  it('currentDuration_DefaultsToQuarter_AndCanBeSet', () => {
    const c = new CursorController();
    expect(c.currentDuration).toBe(model.Duration.Quarter);
    c.setDuration(model.Duration.Eighth);
    expect(c.currentDuration).toBe(model.Duration.Eighth);
  });

  it('selection_SetAndClear', () => {
    const c = new CursorController();
    expect(c.selection).toBeNull();
    const range = { trackIndex: 0, startBarIndex: 0, startBeatIndex: 0, endBarIndex: 1, endBeatIndex: 2 };
    c.setSelection(range);
    expect(c.selection).toEqual(range);
    c.clearSelection();
    expect(c.selection).toBeNull();
  });
});

describe('CursorController — onChange', () => {
  it('onChange_FiresOnMutations_UnsubscribeStops', () => {
    const c = new CursorController();
    const listener = vi.fn();
    const off = c.onChange(listener);
    c.advanceBeat();
    c.setDuration(model.Duration.Half);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    c.advanceBeat();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('onChange_ListenerThrow_IsIsolated', () => {
    const c = new CursorController();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    c.onChange(() => {
      throw new Error('boom');
    });
    c.onChange(good);
    expect(() => c.advanceBeat()).not.toThrow();
    expect(good).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
