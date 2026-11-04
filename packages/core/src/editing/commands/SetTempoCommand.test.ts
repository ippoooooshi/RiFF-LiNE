// UT-EDIT-TEMPO: SetTempoCommand（テンポを入れる・継ぐ状態へ戻す・タップテンポをまとめる）
// 検証節: editing-core.md 2.6 節の表・3.2 節・3.8 節、playback-integration.md 11 節（タップテンポのまとめ方）
// 検証観点（C2）: BPM を入れる／null で継ぐ状態（空）へ戻す、undo で MasterBar のテンポが元に戻る、affectedTrackIndices は全部のパート、
//               isValidTempoBpm の範囲、canMergeWith の条件（型・番号の有無・番号・小節）と mergeWith の引き継ぎ。

import { describe, expect, it } from 'vitest';

import { isValidTempoBpm, MAX_TEMPO_BPM, MIN_TEMPO_BPM, SetTempoCommand } from './SetTempoCommand';
import { InsertBarCommand } from './barCommands';
import { CommandHistory } from './CommandHistory';
import { getMasterBar } from '../scoreModel';
import {
  buildEditTarget,
  countUndoable,
  FakeCommand,
  RecordingRenderRequester,
  RecordingReporter,
  scoreJson,
} from '../../testing/editingFakes';

describe('isValidTempoBpm', () => {
  it.each([
    [MIN_TEMPO_BPM, true],
    [MAX_TEMPO_BPM, true],
    [120, true],
    [MIN_TEMPO_BPM - 1, false],
    [MAX_TEMPO_BPM + 1, false],
    [Number.NaN, false],
    [Infinity, false],
  ])('isValidTempoBpm(%s) === %s', (bpm, expected) => {
    expect(isValidTempoBpm(bpm)).toBe(expected);
  });
});

describe('SetTempoCommand', () => {
  it('setTempo_SetsAutomation_UndoRemovesIt', () => {
    // UT-EDIT-TEMPO-01 3.2 節「テンポを変える小節にだけ tempoAutomations を置く」
    const target = buildEditTarget();
    const before = scoreJson(target);

    const cmd = new SetTempoCommand(target, 0, 90);
    cmd.execute();
    expect(getMasterBar(target.score, 0).tempoAutomations).toHaveLength(1);
    expect(getMasterBar(target.score, 0).tempoAutomations[0]!.value).toBe(90);

    cmd.undo();
    expect(getMasterBar(target.score, 0).tempoAutomations).toHaveLength(0);
    expect(scoreJson(target)).toBe(before);
  });

  it('setTempo_Null_ClearsExistingAutomation_UndoRestores', () => {
    // UT-EDIT-TEMPO-02 3.2 節「継ぐ状態へ戻すときはその小節の tempoAutomations を空にする」
    const target = buildEditTarget();
    new SetTempoCommand(target, 0, 140).execute();
    const withTempo = scoreJson(target);

    const clear = new SetTempoCommand(target, 0, null);
    clear.execute();
    expect(getMasterBar(target.score, 0).tempoAutomations).toHaveLength(0);
    clear.undo();
    expect(scoreJson(target)).toBe(withTempo);
  });

  it('affectedTrackIndices_IsAllParts', () => {
    // UT-EDIT-TEMPO-03 2.6 節の表「SetTempoCommand の範囲は全部のパート」
    const target = buildEditTarget(3);
    const cmd = new SetTempoCommand(target, 0, 100);
    expect([...cmd.affectedTrackIndices]).toEqual([0, 1, 2]);
    expect(cmd.kind).toBe('set-tempo');
    expect(cmd.label).toBe('set-tempo');
    expect(cmd.estimateSizeBytes()).toBeGreaterThan(0);
  });

  it('SetTempoCommand_置かない小節_直前のテンポが続き空のまま', () => {
    // UT-EDIT-TEMPO-04 3.2 節「置かない小節は直前のテンポが続く」（値を置くのは指定した小節だけ）
    const target = buildEditTarget();
    new InsertBarCommand(target, 1).execute();
    new SetTempoCommand(target, 0, 150).execute();
    expect(getMasterBar(target.score, 1).tempoAutomations).toHaveLength(0);
  });

  it('SetTempoCommand_取り消しからやり直す_同じ結果になる', () => {
    // UT-EDIT-TEMPO-05 2.3 節「execute と undo の対称性」
    const target = buildEditTarget();
    const before = scoreJson(target);
    const cmd = new SetTempoCommand(target, 0, 88);
    cmd.execute();
    const after = scoreJson(target);
    cmd.undo();
    cmd.execute();
    expect(scoreJson(target)).toBe(after);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('SetTempoCommand_実行の前の取り消し_継ぐ状態にする', () => {
    // UT-EDIT-TEMPO-06 2.2 節（前の値を控えていないときは、継ぐ状態の空にする）
    const target = buildEditTarget();
    new SetTempoCommand(target, 0, 120).undo();
    expect(getMasterBar(target.score, 0).tempoAutomations).toHaveLength(0);
  });

  it.each([
    ['同じ小節で同じ番号', 0, 7, 7, true],
    ['番号が違う', 0, 7, 8, false],
    ['小節が違う', 1, 7, 7, false],
  ])('SetTempoCommand_canMergeWith_%s', (_name, otherBar, thisSession, otherSession, expected) => {
    // UT-EDIT-TEMPO-07 2.6 節「同じ小節で同じ番号のものだけを canMergeWith でまとめる」
    const target = buildEditTarget();
    new InsertBarCommand(target, 1).execute();
    const older = new SetTempoCommand(target, otherBar, 100, otherSession);
    const newer = new SetTempoCommand(target, 0, 110, thisSession);
    expect(newer.canMergeWith(older)).toBe(expected);
  });

  it('SetTempoCommand_canMergeWith_番号が無いものと別の種類はまとめない', () => {
    // UT-EDIT-TEMPO-08 playback-integration.md 11 節「テンポの数値の入力から出す SetTempoCommand は番号を持たず、まとめない」
    const target = buildEditTarget();
    expect(new SetTempoCommand(target, 0, 110).canMergeWith(new SetTempoCommand(target, 0, 100))).toBe(false);
    expect(new SetTempoCommand(target, 0, 110, 1).canMergeWith(new FakeCommand({ kind: 'set-tempo' }))).toBe(false);
  });

  it('SetTempoCommand_タップを続けて叩く_履歴の1つにまとまり取り消すと叩き始める前のテンポに戻る', () => {
    // UT-EDIT-TEMPO-09 playback-integration.md 11 節「取り消すと叩き始める前のテンポに戻る」
    const target = buildEditTarget();
    new SetTempoCommand(target, 0, 96).execute();
    const beforeTapping = scoreJson(target);
    const history = new CommandHistory(new RecordingRenderRequester(), new RecordingReporter());

    history.execute(new SetTempoCommand(target, 0, 120, 1));
    history.execute(new SetTempoCommand(target, 0, 124, 1));
    history.execute(new SetTempoCommand(target, 0, 122, 1));
    expect(countUndoable(history)).toBe(1);
    expect(getMasterBar(target.score, 0).tempoAutomations[0]!.value).toBe(122);

    history.undo();
    expect(scoreJson(target)).toBe(beforeTapping);
    history.redo();
    expect(getMasterBar(target.score, 0).tempoAutomations[0]!.value).toBe(122);
  });

  it('SetTempoCommand_mergeWith_別の種類や実行していないものからは引き継がない', () => {
    // UT-EDIT-TEMPO-10 2.2 節「mergeWith は other（古いほう）を this に取り込む」（取り込むものが無いときは自分の値のまま）
    const target = buildEditTarget();
    new SetTempoCommand(target, 0, 90).execute();
    const newer = new SetTempoCommand(target, 0, 100, 1);
    newer.execute();
    newer.mergeWith(new FakeCommand());
    newer.mergeWith(new SetTempoCommand(target, 0, 80, 1));
    newer.undo();
    expect(getMasterBar(target.score, 0).tempoAutomations[0]!.value).toBe(90);
  });
});
