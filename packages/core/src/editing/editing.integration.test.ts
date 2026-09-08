// IT-EDIT: editing-core.md §11・§13 DoD — タブ譜編集コアの結合シナリオ
// 検証観点:
//  - ステップ入力→和音→タイ→奏法→コード検出→Undo/Redo→範囲コピー&ペースト→小節挿入削除 の通し
//  - 複数編集ウィンドウ（CommandHistory 2 インスタンス）の Undo/Redo 独立性（§6.2 スコープ訂正）
//  - onCommandApplied が全経路で発火
//  - 2048 小節フィクスチャでの小節追加拒否（EDIT-003）

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { CommandHistory } from './CommandHistory';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { getBeat, getVoice, getBar, barCount } from './scoreModel';
import type { CommandAppliedEvent } from './types';
import { RecordingRenderRequester, RecordingReporter, scoreJson } from '../testing/editingFakes';
import { makeEditingRig, makeSong, makeSongWithBars } from '../testing/editingFixtures';

describe('編集コア 通しシナリオ', () => {
  it('stepInput_Chord_Tie_Technique_Chord_Undo_Redo_Paste_BarOps', () => {
    const rig = makeEditingRig(makeSong());
    const applied: CommandAppliedEvent[] = [];
    rig.history.onCommandApplied((e) => applied.push(e));

    // ステップ入力：bar0 に 3 音
    rig.service.placeNote(3, 5);
    rig.service.placeNote(3, 7);
    rig.service.placeNote(3, 9);
    expect(getVoice(getBar(rig.target.score, 0, 0)).beats.length).toBe(3);
    expect(rig.cursor.position.beatIndex).toBe(3);

    // 和音入力：beat0 へ戻って弦2を追加
    rig.cursor.setPosition({ trackIndex: 0, barIndex: 0, beatIndex: 0 });
    rig.cursor.enterChordInput();
    rig.service.placeNote(2, 5);
    expect(getBeat(rig.target.score, 0, 0, 0).notes).toHaveLength(2);
    rig.cursor.exitChordInput();

    // タイ：beat1 の弦3を直前へタイ
    rig.cursor.setPosition({ trackIndex: 0, barIndex: 0, beatIndex: 1 });
    rig.service.setTie(3, true);
    expect(getBeat(rig.target.score, 0, 0, 1).notes[0]!.isTieDestination).toBe(true);

    // 奏法記号：beat2 の弦3へパームミュート
    rig.cursor.setPosition({ trackIndex: 0, barIndex: 0, beatIndex: 2 });
    rig.service.setTechnique(3, { isPalmMute: true });
    expect(getBeat(rig.target.score, 0, 0, 2).notes[0]!.isPalmMute).toBe(true);

    const afterEdits = scoreJson(rig.target);

    // Undo x2 → Redo x2 で完全復元
    rig.service.undo();
    rig.service.undo();
    rig.service.redo();
    rig.service.redo();
    expect(scoreJson(rig.target)).toBe(afterEdits);

    // 範囲コピー & 別位置へペースト
    rig.cursor.setSelection({
      trackIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 0,
      endBeatIndex: 1,
    });
    rig.service.copySelection();
    rig.cursor.setPosition({ trackIndex: 0, barIndex: 0, beatIndex: 3 });
    rig.service.paste();
    expect(getVoice(getBar(rig.target.score, 0, 0)).beats.length).toBe(5);
    rig.service.undo(); // paste を戻す
    expect(getVoice(getBar(rig.target.score, 0, 0)).beats.length).toBe(3);

    // 小節挿入 → 削除
    rig.service.insertBar(1);
    expect(barCount(rig.target.score)).toBe(2);
    rig.service.deleteBar(1, 'delete');
    expect(barCount(rig.target.score)).toBe(1);

    // 全経路で onCommandApplied が発火している
    expect(applied.some((e) => e.phase === 'execute')).toBe(true);
    expect(applied.some((e) => e.phase === 'undo')).toBe(true);
    expect(applied.some((e) => e.phase === 'redo')).toBe(true);
  });

  it('multipleEditWindows_HaveIndependentUndoStacks', () => {
    const a = makeEditingRig(makeSong());
    const b = makeEditingRig(makeSong());

    a.service.placeNote(3, 5);
    a.service.placeNote(3, 7);
    b.service.placeNote(1, 1);

    expect(a.history.undoDepth).toBe(2);
    expect(b.history.undoDepth).toBe(1);

    // b で Undo しても a には影響しない
    b.service.undo();
    expect(b.history.canUndo()).toBe(false);
    expect(a.history.undoDepth).toBe(2);
    expect(getBeat(a.target.score, 0, 0, 0).notes).toHaveLength(1);
    expect(getBeat(b.target.score, 0, 0, 0).notes).toHaveLength(0);
  });

  it('barInsertion_At2048_IsRejected_WithEDIT003', () => {
    const rig = makeEditingRig(makeSongWithBars(2048));
    const before = barCount(rig.target.score);
    rig.service.insertBar(10);
    expect(barCount(rig.target.score)).toBe(before);
    expect(rig.reporter.reports.map((r) => r.code)).toContain('EDIT-003');
  });

  it('memoryBudget_EvictionKeepsFloor_AndNotifiesOnce_WithRealCommands', () => {
    const target = makeSong();
    const render = new RecordingRenderRequester();
    const reporter = new RecordingReporter();
    // 予算を極小にして通常の PlaceNoteCommand でもエビクションを誘発する（C11）。
    const history = new CommandHistory(render, reporter, { memoryBudgetBytes: 2000, minRetainedEntries: 3 });
    for (let i = 0; i < 10; i++) {
      history.execute(
        new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, 5, model.Duration.Quarter),
      );
    }
    expect(history.undoDepth).toBe(3); // 下限を維持
    expect(reporter.reports.filter((r) => r.code === 'EDIT-008')).toHaveLength(1);
  });
});
