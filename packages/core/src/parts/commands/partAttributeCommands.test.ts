// UT-PART-ATTR: part-tuning-management.md §5・§6.3 — SetPart{Volume,Pan,Solo,Mute,Color},SetCapoFret
// 検証観点（C2）: 各属性の適用と undo による Score JSON 完全復元、ドラッグ結合（volume/pan）で
//   1エントリに畳んでも undo で「開始前」まで戻ること、色 HEX の往復。

import { describe, expect, it } from 'vitest';

import {
  SetCapoFretCommand,
  SetPartColorCommand,
  SetPartMuteCommand,
  SetPartPanCommand,
  SetPartSoloCommand,
  SetPartVolumeCommand,
} from './partAttributeCommands';
import { getColorHex, getCapo, getMixer } from '../partModel';
import { buildEditTarget, scoreJson } from '../../testing/editingFakes';

describe('mixer commands', () => {
  it('setVolume_ChangesAndUndoRestores', () => {
    const target = buildEditTarget();
    const before = scoreJson(target);
    const cmd = new SetPartVolumeCommand(target.score, 0, 3);
    cmd.execute();
    expect(getMixer(target.score, 0).volume).toBe(3);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('setSolo_setMute_Toggle_UndoRestores', () => {
    const target = buildEditTarget();
    const before = scoreJson(target);
    const solo = new SetPartSoloCommand(target.score, 0, true);
    const mute = new SetPartMuteCommand(target.score, 0, true);
    solo.execute();
    mute.execute();
    expect(getMixer(target.score, 0)).toMatchObject({ solo: true, mute: true });
    mute.undo();
    solo.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('volumeMerge_DragChain_FoldsToStartValue', () => {
    const target = buildEditTarget();
    const start = getMixer(target.score, 0).volume;

    const c1 = new SetPartVolumeCommand(target.score, 0, 10);
    const c2 = new SetPartVolumeCommand(target.score, 0, 12);
    c1.execute();
    c2.execute();
    // c2 が c1 を取り込む（CommandHistory.execute 相当の手動再現）
    expect(c2.canMergeWith(c1)).toBe(true);
    c2.mergeWith(c1);

    // 畳んだ後の undo は「ドラッグ開始前」へ戻る
    c2.undo();
    expect(getMixer(target.score, 0).volume).toBe(start);
  });

  it('panMerge_OnlyMergesSamePartSameField', () => {
    const target = buildEditTarget();
    const pan = new SetPartPanCommand(target.score, 0, 5);
    const vol = new SetPartVolumeCommand(target.score, 0, 5);
    expect(pan.canMergeWith(vol)).toBe(false);
  });
});

describe('SetPartColorCommand', () => {
  it('setColor_HexRoundTrip_UndoRestores', () => {
    const target = buildEditTarget();
    const beforeHex = getColorHex(target.score, 0);
    const cmd = new SetPartColorCommand(target.score, 0, '#123abc');
    cmd.execute();
    expect(getColorHex(target.score, 0)).toBe('#123abc');
    cmd.undo();
    expect(getColorHex(target.score, 0)).toBe(beforeHex);
  });
});

describe('SetCapoFretCommand', () => {
  it('setCapo_ChangesAndUndoRestores', () => {
    const target = buildEditTarget();
    const before = scoreJson(target);
    const cmd = new SetCapoFretCommand(target.score, 0, 4);
    cmd.execute();
    expect(getCapo(target.score, 0)).toBe(4);
    cmd.undo();
    expect(getCapo(target.score, 0)).toBe(0);
    expect(scoreJson(target)).toBe(before);
  });
});
