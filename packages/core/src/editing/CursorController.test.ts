// UT-EDIT-CURSOR: CursorController
// 検証節: editing-core.md 3.1 節・4.1 節・4.2 節・4.7 節
// 検証観点（C0・C1）: 位置（ボイスを含む 4 つ）、setPosition と ← → の動き、選んでいる弦、今の入力音価、
//   applyOutcome の小節が埋まったときの送り方、和音の入力の途中の印と exitChordInput の確定、範囲選択、onChange。

import { describe, expect, it, vi } from 'vitest';

import { model } from '@coderline/alphatab';

import { InsertBarCommand } from './commands/barCommands';
import { CursorController } from './CursorController';
import { createRestBeat, ensureSecondVoice, getBar, getVoice, insertBeatAt } from './scoreModel';
import { DEFAULT_DURATION_SPEC, type CursorPosition, type EditTarget } from './types';
import { buildEditTarget } from '../testing/editingFakes';

const Q = model.Duration.Quarter;
const H = model.Duration.Half;

/** bars 小節（4/4、どの小節も全音符の休符 1 つ）の曲。 */
function song(bars: number): EditTarget {
  const target = buildEditTarget();
  for (let i = 1; i < bars; i++) new InsertBarCommand(target, i).execute();
  return target;
}

/** 小節 barIndex のボイス voiceIndex の拍を、durations の長さの休符の拍に置き直す（ボイス 2 が無ければ作る）。 */
function fill(target: EditTarget, barIndex: number, voiceIndex: 0 | 1, durations: model.Duration[]): void {
  const bar = getBar(target.score, 0, barIndex);
  if (voiceIndex === 1) ensureSecondVoice(bar);
  const voice = getVoice(bar, voiceIndex);
  voice.beats.length = 0;
  durations.forEach((duration, i) => insertBeatAt(voice, i, createRestBeat(duration)));
}

const at = (barIndex: number, beatIndex: number, voiceIndex: 0 | 1 = 0): CursorPosition => ({
  trackIndex: 0,
  barIndex,
  voiceIndex,
  beatIndex,
});

const BEAT = { cursorAdvance: 'beat' } as const;

describe('CursorController — 位置', () => {
  it('CursorController_作った直後_曲の頭と1番目の弦と既定の音価', () => {
    // UT-EDIT-CURSOR-01 4.1 節「CursorPosition…voiceIndex: 0 | 1」・4.3 節「既定の入力音価（4 分音符、付点なし、連符なし）」
    const c = new CursorController();
    expect(c.position).toEqual(at(0, 0));
    expect(c.currentString).toBe(1);
    expect(c.currentDuration).toEqual(DEFAULT_DURATION_SPEC);
    expect(c.chordInputMode).toBe(false);
    expect(c.selection).toBeNull();
  });

  it('CursorController_setPosition_負の値を0に丸めボイスを保ち写しを返す', () => {
    // UT-EDIT-CURSOR-02 3.1 節「カーソルの位置は、パート・小節・ボイス・拍の 4 つで表す」
    const c = new CursorController();
    c.setPosition({ trackIndex: -1, barIndex: -3, voiceIndex: 1, beatIndex: 2 });
    expect(c.position).toEqual({ trackIndex: 0, barIndex: 0, voiceIndex: 1, beatIndex: 2 });
    const copy = c.position;
    copy.beatIndex = 9;
    expect(c.position.beatIndex).toBe(2);
  });

  it('CursorController_setPosition_和音の途中の印を捨てボタンの入切は変えない', () => {
    // UT-EDIT-CURSOR-03 4.1 節「和音の入力の途中の印を捨てる（4.7 節。「和音」ボタンの入切は変えない）」
    const target = song(1);
    fill(target, 0, 0, [Q]);
    const c = new CursorController();
    c.enterChordInput();
    c.applyOutcome(BEAT, target);
    c.setPosition(at(0, 0));
    expect(c.chordInputMode).toBe(true);
    c.exitChordInput(target);
    expect(c.position).toEqual(at(0, 0));
  });
});

describe('CursorController — ← と →（moveByBeat）', () => {
  it('CursorController_moveByBeat左_同じ小節の前の拍へ', () => {
    // UT-EDIT-CURSOR-04 4.1 節「← は、選んでいるボイスの拍を 1 つずつ前へ動く」
    const target = song(1);
    fill(target, 0, 0, [Q, Q, Q]);
    const c = new CursorController();
    c.setPosition(at(0, 2));
    c.moveByBeat(target, -1);
    expect(c.position).toEqual(at(0, 1));
  });

  it('CursorController_moveByBeat左_小節の最初の拍から前の小節の最後の拍へ', () => {
    // UT-EDIT-CURSOR-05 4.1 節「小節の最初の拍で ← を押すと前の小節の最後の拍へ移り」・「2 つ目のボイスがまだ無い小節では…拍 0」
    const target = song(2);
    fill(target, 0, 0, [Q, Q, Q]);
    const c = new CursorController();
    c.setPosition(at(1, 0));
    c.moveByBeat(target, -1);
    expect(c.position).toEqual(at(0, 2));

    fill(target, 1, 1, [Q]);
    c.setPosition(at(1, 0, 1));
    c.moveByBeat(target, -1);
    expect(c.position).toEqual(at(0, 0, 1));
  });

  it('CursorController_moveByBeat左_曲の最初の拍では動かない', () => {
    // UT-EDIT-CURSOR-06 4.1 節「曲の最初の拍では動かない」
    const target = song(1);
    const c = new CursorController();
    c.moveByBeat(target, -1);
    expect(c.position).toEqual(at(0, 0));
  });

  it('CursorController_moveByBeat右_最後より前の拍では同じ小節の次の拍へ', () => {
    // UT-EDIT-CURSOR-07 4.1 節「それより前の拍では、同じ小節の次の拍へ移る」
    const target = song(1);
    fill(target, 0, 0, [Q, Q]);
    const c = new CursorController();
    c.moveByBeat(target, 1);
    expect(c.position).toEqual(at(0, 1));
  });

  it('CursorController_moveByBeat右_最後の拍で空きがあれば最後の拍の後ろへ', () => {
    // UT-EDIT-CURSOR-08 4.1 節「→ は、小節の最後の拍にいるときは、空きがあれば最後の拍の後ろへ」
    const target = song(2);
    fill(target, 0, 0, [Q, Q]);
    const c = new CursorController();
    c.setPosition(at(0, 1));
    c.moveByBeat(target, 1);
    expect(c.position).toEqual(at(0, 2));
    // 最後の拍の後ろで空きがあるときは動かない（休符を置くのは EditingService.stepRight）
    c.moveByBeat(target, 1);
    expect(c.position).toEqual(at(0, 2));
  });

  it('CursorController_moveByBeat右_埋まった小節では次の小節の頭へ最後の小節では動かない', () => {
    // UT-EDIT-CURSOR-09 4.1 節「埋まっていれば次の小節の頭…へ移る」（最後の小節で足すのは EditingService.stepRight）
    const target = song(2);
    fill(target, 0, 0, [H, H]);
    fill(target, 1, 0, [H, H]);
    const c = new CursorController();
    c.setPosition(at(0, 1));
    c.moveByBeat(target, 1);
    expect(c.position).toEqual(at(1, 0));
    c.setPosition(at(0, 2));
    c.moveByBeat(target, 1);
    expect(c.position).toEqual(at(1, 0));
    c.setPosition(at(1, 1));
    c.moveByBeat(target, 1);
    expect(c.position).toEqual(at(1, 1));
  });

  it('CursorController_moveByBeat_和音の途中の印を捨てる', () => {
    // UT-EDIT-CURSOR-10 4.7 節「← やクリックでカーソルを手で動かしたとき（setPosition と ← の moveByBeat）は、確定せずに途中の印を捨てる」
    const target = song(1);
    fill(target, 0, 0, [Q, Q, Q]);
    const c = new CursorController();
    c.setPosition(at(0, 2));
    c.enterChordInput();
    c.applyOutcome(BEAT, target);
    c.moveByBeat(target, -1);
    c.exitChordInput(target);
    expect(c.position).toEqual(at(0, 1));
  });
});

describe('CursorController — 選んでいる弦と今の入力音価', () => {
  it('CursorController_setString_値を持ち1より小さければ1で止める', () => {
    // UT-EDIT-CURSOR-11 4.1 節「選んでいる弦（1 が最も低い弦…）」「一番低い弦と一番高い弦で止める」
    const c = new CursorController();
    c.setString(4);
    expect(c.currentString).toBe(4);
    c.setString(0);
    expect(c.currentString).toBe(1);
  });

  it('CursorController_setDuration_音価を変えるだけで和音の確定も進めもしない', () => {
    // UT-EDIT-CURSOR-12 4.7 節「CursorController.setDuration は今の入力音価を変えるだけで、確定も進めもしない」
    const target = song(1);
    fill(target, 0, 0, [Q]);
    const c = new CursorController();
    c.enterChordInput();
    c.applyOutcome(BEAT, target);
    const spec = { duration: model.Duration.Eighth, dots: 1 as const, tuplet: { numerator: 3, denominator: 2 } };
    c.setDuration(spec);
    expect(c.currentDuration).toEqual(spec);
    expect(c.position).toEqual(at(0, 0));
    c.exitChordInput(target);
    expect(c.position).toEqual(at(0, 1));
  });
});

describe('CursorController — applyOutcome', () => {
  it('CursorController_applyOutcome_noneでは動かない', () => {
    // UT-EDIT-CURSOR-13 2.2 節「PlaceNoteCommand と InsertRestCommand の execute は 'beat'、それ以外と undo は 'none'」
    const target = song(1);
    const c = new CursorController();
    c.applyOutcome({ cursorAdvance: 'none' }, target);
    expect(c.position).toEqual(at(0, 0));
  });

  it('CursorController_applyOutcome_小節が埋まっていなければ同じ小節の次の拍へ', () => {
    // UT-EDIT-CURSOR-14 4.1 節「埋まっていなければ、同じ小節の次の拍（beatIndex + 1）へ進める」
    const target = song(2);
    fill(target, 0, 0, [Q, Q, Q]);
    const c = new CursorController();
    c.setPosition(at(0, 2));
    c.applyOutcome(BEAT, target);
    expect(c.position).toEqual(at(0, 3));
  });

  it('CursorController_applyOutcome_小節が埋まったら次の小節の頭へ', () => {
    // UT-EDIT-CURSOR-15 4.1 節「音か休符を置いて小節が埋まったら、カーソルを次の小節の頭（拍 0）へ送る」
    const target = song(2);
    fill(target, 0, 0, [Q, Q, Q, Q]);
    const c = new CursorController();
    c.setPosition(at(0, 3));
    c.applyOutcome(BEAT, target);
    expect(c.position).toEqual(at(1, 0));
  });

  it('CursorController_applyOutcome_最後の小節が埋まったら足された小節の頭へ足されていなければ次の拍へ', () => {
    // UT-EDIT-CURSOR-16 4.1 節「埋まったのが曲の最後の小節なら、小節を 1 つ足し…その頭へ送る」（次の位置は target の Score から読む）
    const target = song(1);
    fill(target, 0, 0, [H, H]);
    const c = new CursorController();
    c.setPosition(at(0, 1));
    c.applyOutcome(BEAT, target);
    expect(c.position).toEqual(at(0, 2));
    new InsertBarCommand(target, 1).execute();
    c.setPosition(at(0, 1));
    c.applyOutcome(BEAT, target);
    expect(c.position).toEqual(at(1, 0));
  });

  it('CursorController_applyOutcome_和音のボタンが入っていれば進めずexitChordInputで確定して進める', () => {
    // UT-EDIT-CURSOR-17 4.7 節「applyOutcome は 'beat' を受けても進めず、置いた拍を「和音の入力の途中」として覚える」
    //   「確定すると…置いた拍から 1 つ進める。進め方は 4.1 節の、音を置いたときと同じ」
    const target = song(2);
    fill(target, 0, 0, [H, H]);
    const c = new CursorController();
    c.setPosition(at(0, 1));
    c.enterChordInput();
    c.applyOutcome(BEAT, target);
    c.applyOutcome(BEAT, target);
    expect(c.position).toEqual(at(0, 1));
    c.exitChordInput(target);
    expect(c.chordInputMode).toBe(false);
    expect(c.position).toEqual(at(1, 0));
  });

  it('CursorController_exitChordInput_途中でなければ動かずボタンだけ切る', () => {
    // UT-EDIT-CURSOR-18 4.7 節「途中でなければ、ボタンを切っても音価を選んでも動かない」
    const target = song(1);
    const c = new CursorController();
    c.enterChordInput();
    expect(c.chordInputMode).toBe(true);
    c.exitChordInput(target);
    expect(c.chordInputMode).toBe(false);
    expect(c.position).toEqual(at(0, 0));
  });

  it('CursorController_applyOutcome_選んでいるボイスの拍で埋まったかを数える', () => {
    // UT-EDIT-CURSOR-19 3.1 節「カーソルは、選んでいるボイス（Bar.voices の 1 つ目か 2 つ目）の拍（Beat）の上だけを動く」
    const target = song(2);
    fill(target, 0, 0, [model.Duration.Whole]);
    fill(target, 0, 1, [Q]);
    const c = new CursorController();
    c.setPosition(at(0, 0, 1));
    c.applyOutcome(BEAT, target);
    expect(c.position).toEqual(at(0, 1, 1));
  });
});

describe('CursorController — 範囲選択と知らせ', () => {
  it('CursorController_selection_付けて外せる', () => {
    // UT-EDIT-CURSOR-20 4.1 節「selection・setSelection・clearSelection」
    const c = new CursorController();
    const range = {
      trackIndex: 0,
      voiceIndex: 0 as const,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 1,
      endBeatIndex: 2,
    };
    c.setSelection(range);
    expect(c.selection).toEqual(range);
    c.clearSelection();
    expect(c.selection).toBeNull();
  });

  it('CursorController_onChange_変わるたびに知らせ解除で止まり投げた購読を切り離す', () => {
    // UT-EDIT-CURSOR-21 4.2 節「CursorController.onChange…に登録して受け、← とクリックのように CursorController を直に呼ぶ動き」
    const target = song(1);
    const c = new CursorController();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listener = vi.fn();
    c.onChange(() => {
      throw new Error('boom');
    });
    const off = c.onChange(listener);
    c.setPosition(at(0, 0));
    c.moveByBeat(target, 1);
    c.setString(2);
    c.setDuration(DEFAULT_DURATION_SPEC);
    c.enterChordInput();
    c.exitChordInput(target);
    expect(listener).toHaveBeenCalledTimes(6);
    expect(consoleError).toHaveBeenCalled();
    off();
    c.setString(3);
    expect(listener).toHaveBeenCalledTimes(6);
    consoleError.mockRestore();
  });
});
