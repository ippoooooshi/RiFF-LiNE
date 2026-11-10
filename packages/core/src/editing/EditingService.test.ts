// UT-EDIT-SVC: editing-core.md 4.8 節・5 節・6 節・7.1 節・8 節 — EditingService
// 検証観点: UI 入力 → 確かめ → コマンド/知らせの振り分け、カーソル前進、和音入力、
//   メモ切り詰め通知、小節上限拒否、音価の合計を拒まない扱い、undo/redo、タイと奏法記号の候補、コード名解決。

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ChordDetectionService } from './ChordDetectionService';
import { ClipboardService } from './ClipboardService';
import { CompositeCommand } from './CompositeCommand';
import { CommandHistory } from './commands/CommandHistory';
import { DeleteNotesCommand } from './commands/DeleteNotesCommand';
import { DeleteSelectionCommand } from './commands/DeleteSelectionCommand';
import { DuplicateSelectionCommand } from './commands/DuplicateSelectionCommand';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { SetRepeatCommand } from './commands/SetRepeatCommand';
import { SetTimeSignatureCommand } from './commands/SetTimeSignatureCommand';
import { CursorController } from './CursorController';
import { EditingService, type BarDeleteConfirmer } from './EditingService';
import { ValidationService } from './ValidationService';
import { getBeat, getVoice, getBar } from './scoreModel';
import {
  DEFAULT_DURATION_SPEC,
  type BeatDurationSpec,
  type CursorPosition,
  type EditTarget,
  type SelectionRange,
} from './types';
import {
  buildEditTarget,
  countUndoable,
  RecordingRenderRequester,
  RecordingReporter,
  scoreJson,
} from '../testing/editingFakes';
import { model } from '@coderline/alphatab';

let target: EditTarget;
let cursor: CursorController;
let render: RecordingRenderRequester;
let reporter: RecordingReporter;
let history: CommandHistory;
let svc: EditingService;

beforeEach(() => {
  target = buildEditTarget();
  cursor = new CursorController();
  render = new RecordingRenderRequester();
  reporter = new RecordingReporter();
  history = new CommandHistory(render, reporter);
  svc = new EditingService(target, cursor, new ValidationService(), history, reporter);
});

describe('EditingService.placeNote', () => {
  it('validInput_ExecutesCommand_AdvancesCursor_Renders', () => {
    svc.placeNote(3, 5);
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(1);
    expect(cursor.position.beatIndex).toBe(1);
    expect(render.calls).toEqual([[0]]);
    expect(history.canUndo()).toBe(true);
  });

  it('EDIT-002: 範囲外のフレット（30）の配置', () => {
    svc.placeNote(3, 30);
    expect(reporter.reports[0]).toMatchObject({ code: 'EDIT-002' });
    expect(history.canUndo()).toBe(false);
    expect(cursor.position.beatIndex).toBe(0);
  });

  it('chordInputMode_AddsToSameBeat_NoAdvance', () => {
    svc.placeNote(3, 5); // beat 0 → cursor advances to 1
    cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    cursor.enterChordInput();
    svc.placeNote(2, 7);
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(2);
    expect(cursor.position.beatIndex).toBe(0); // 和音入力中は進まない
  });

  // <!-- req errorloggingfoundation:03b41f6b.59ab -->
  // <!-- req errorloggingfoundation:03b41f6b.4d72 -->
  // <!-- req errorloggingfoundation:03b41f6b.b293 -->
  // <!-- req errorloggingfoundation:03b41f6b.ca9e -->
  // <!-- req errorloggingfoundation:03b41f6b.ff3f -->
  // <!-- req errorloggingfoundation:03b41f6b.ddb9 -->
  // <!-- req errorloggingfoundation:2194a552.d607 -->
  // <!-- req errorloggingfoundation:2194a552.d529 -->
  // <!-- req errorloggingfoundation:2194a552.8cce -->
  // <!-- req errorloggingfoundation:2194a552.8f10 -->
  // <!-- req errorloggingfoundation:2194a552.e9e7 -->
  it('EDIT-001: 同じ弦への重ねての配置', () => {
    svc.placeNote(3, 5);
    cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    svc.placeNote(3, 9);
    expect(reporter.reports.map((r) => r.code)).toContain('EDIT-001');
  });
});

describe('EditingService.insertRest', () => {
  it('appendsRest_AdvancesCursor', () => {
    svc.insertRest();
    expect(getVoice(getBar(target.score, 0, 0)).beats.length).toBe(2);
    expect(cursor.position.beatIndex).toBe(1);
  });
});

describe('EditingService memo/section/bar', () => {
  it('EDIT-004: 100 文字を超えるメモ', () => {
    svc.addMemo(0, 'あ'.repeat(120));
    expect(reporter.reports.map((r) => r.code)).toContain('EDIT-004');
    expect([...target.appMeta.memos[0]!.text]).toHaveLength(100);
  });

  it('addMemo_WithinLimit_NoReport', () => {
    svc.addMemo(0, 'ok');
    expect(reporter.reports).toEqual([]);
    expect(target.appMeta.memos[0]!.text).toBe('ok');
  });

  it('EDIT-003: 2048 小節での小節の挿入', () => {
    while (target.score.masterBars.length < 2048) target.score.addMasterBar(new model.MasterBar());
    const barsBefore = target.score.masterBars.length;
    svc.insertBar(1);
    expect(reporter.reports.map((r) => r.code)).toContain('EDIT-003');
    expect(target.score.masterBars.length).toBe(barsBefore);
  });

  it('insertBar_At2048BarsOnSecondPart_ReportsContextWithCountsAndInsertPosition', () => {
    // UT-EDIT-SVC-16 editing-core.md 5 節の表「`context` は、確かめが返す `{ current, count, max }` に、呼ぶ所（`EditingService.insertBar`）が足そうとした位置 `{ trackIndex, barIndex }` を足したもので、その小節を赤枠にする」
    target = buildEditTarget(2);
    svc = new EditingService(target, cursor, new ValidationService(), history, reporter);
    while (target.score.masterBars.length < 2048) target.score.addMasterBar(new model.MasterBar());
    cursor.setPosition({ trackIndex: 1, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    svc.insertBar(5);
    expect(reporter.reports).toEqual([
      { code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048, trackIndex: 1, barIndex: 5 } },
    ]);
    expect(target.score.masterBars).toHaveLength(2048);
    expect(history.canUndo()).toBe(false);
  });

  it('insertBar_AtBeyondLastBar_ReportsLastBarAsBarIndex', () => {
    // UT-EDIT-SVC-17 editing-core.md 5 節の表「呼ぶ所（`EditingService.insertBar`）が足そうとした位置 `{ trackIndex, barIndex }` を足したもので、その小節を赤枠にする」
    while (target.score.masterBars.length < 2048) target.score.addMasterBar(new model.MasterBar());
    svc.insertBar(2048); // 最後の小節の後ろ（末尾に足す位置）
    svc.insertBar(5000);
    svc.insertBar(-3);
    expect(reporter.reports.map((r) => r.context)).toEqual([
      { current: 2048, count: 1, max: 2048, trackIndex: 0, barIndex: 2047 },
      { current: 2048, count: 1, max: 2048, trackIndex: 0, barIndex: 2047 },
      { current: 2048, count: 1, max: 2048, trackIndex: 0, barIndex: 0 },
    ]);
  });

  it('addSectionMarker_ExecutesCommand', () => {
    svc.addSectionMarker(0, 'イントロ');
    expect(target.appMeta.sectionMarkers[0]!.label).toBe('イントロ');
    expect(history.canUndo()).toBe(true);
  });

  it('deleteBar_OnSingleBarSong_IsNoOp', async () => {
    expect(target.score.masterBars).toHaveLength(1);
    await svc.deleteBar(0);
    expect(target.score.masterBars).toHaveLength(1);
    expect(history.canUndo()).toBe(false);
  });

  it('deleteBar_OutOfRange_IsNoOp', async () => {
    svc.insertBar(1); // 2 小節に
    await svc.deleteBar(5);
    await svc.deleteBar(-1);
    expect(target.score.masterBars).toHaveLength(2);
  });

  it('addMemo_DoesNotTriggerScoreRedraw', () => {
    svc.addMemo(0, 'no redraw');
    // editing-core.md 2.4 節：render(affectedTrackIndices) は必ず頼み、メモは [] なので描き直すパートが無い
    expect(render.calls).toEqual([[]]);
  });
});

describe('EditingService.setTempo', () => {
  it('validBpm_Executes', () => {
    svc.setTempo(90);
    expect(history.canUndo()).toBe(true);
  });

  it('outOfRangeBpm_DoesNotExecute', () => {
    svc.setTempo(5);
    svc.setTempo(9999);
    expect(history.canUndo()).toBe(false);
  });

  it('null_ResetsToInherit_Executes', () => {
    svc.setTempo(120);
    svc.setTempo(null);
    expect(countUndoable(history)).toBe(2);
  });
});

describe('EditingService undo/redo', () => {
  it('undo_RevertsPlaceNote_Redo_Reapplies', () => {
    svc.placeNote(3, 5);
    svc.undo();
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(0);
    svc.redo();
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(1);
  });
});

describe('EditingService.chordNameAt', () => {
  it('returnsDetectedName', () => {
    // alphaTab 規約：string 1 = 最低音弦。string5(B) fret1 + string4(G) fret0 + string3(D) fret2 = C major（一番低い音は E、editing-core.md 8 節の分数の形）
    svc.placeNote(5, 1);
    cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    cursor.enterChordInput();
    svc.placeNote(4, 0);
    svc.placeNote(3, 2);
    expect(svc.chordNameAt(0, 0)).toBe('C/E');
  });
});

describe('EditingService ボイス 2 の読み取り', () => {
  const QUARTER: BeatDurationSpec = { duration: model.Duration.Quarter, dots: 0, tuplet: null };
  const v2 = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, voiceIndex: 1, beatIndex });

  it('EditingService_chordNameAtでカーソルがボイス2_2つ目のボイスの拍の和音の名前を返す', () => {
    // UT-EDIT-SVC-01 editing-core.md 3.1 節「カーソルは、選んでいるボイス（`Bar.voices` の 1 つ目か 2 つ目）の拍（`Beat`）の上だけを動く」・4.1 節 CursorPosition.voiceIndex
    // ボイス 2 の拍 0 は C の和音、1 つ目のボイスの拍 0 は弦 3 の音 1 つ
    svc.placeNote(3, 5);
    for (const [stringNumber, fret] of [
      [5, 1],
      [4, 0],
      [3, 2],
    ] as const) {
      new PlaceNoteCommand(target, v2(0), stringNumber, fret, QUARTER).execute();
    }
    cursor.setPosition(v2(0));
    expect(svc.chordNameAt(0, 0)).toBe('C/E');
    cursor.setPosition({ ...v2(0), voiceIndex: 0 });
    expect(svc.chordNameAt(0, 0)).toBeNull();
  });

  it('EditingService_suggestTechniquesでカーソルがボイス2_2つ目のボイスの1つ前の拍から候補を返す', () => {
    // UT-EDIT-SVC-02 editing-core.md 3.1 節「カーソルは、選んでいるボイス（`Bar.voices` の 1 つ目か 2 つ目）の拍（`Beat`）の上だけを動く」・4.1 節 CursorPosition.voiceIndex・7.1 節「直前の拍は、同じパートの同じボイスで 1 つ前の拍」
    // ボイス 2 の拍 0 は弦 3 のフレット 5、1 つ目のボイスの拍 0 は弦 3 のフレット 12
    svc.placeNote(3, 12);
    new PlaceNoteCommand(target, v2(0), 3, 5, QUARTER).execute();
    cursor.setPosition(v2(1));
    svc.placeNote(3, 7);
    expect(svc.suggestTechniques().map((s) => s.kind)).toContain('hammer');
    for (const suggestion of svc.suggestTechniques()) {
      expect(suggestion.target).toEqual({ position: v2(0), stringNumber: 3 });
    }
    // 1 つ目のボイスの拍 1 に置くと、直前の拍は 1 つ目のボイスの拍 0（フレットの差 5 は候補にならない）
    cursor.setPosition({ ...v2(1), voiceIndex: 0 });
    svc.placeNote(3, 7);
    expect(svc.suggestTechniques()).toEqual([]);
  });

  it('EditingService_chordNameAtで2つ目のボイスが無い小節のボイス2_投げずにnullを返す', () => {
    // UT-EDIT-SVC-03 editing-core.md 4.1 節「2 つ目のボイスがまだ無い小節では、ボイス 2 を選んだときのカーソルの位置は拍 0（最後の拍の後ろ）だけとし」
    // 1 つ目のボイスの拍 0 は C の和音
    for (const [stringNumber, fret] of [
      [5, 1],
      [4, 0],
      [3, 2],
    ] as const) {
      new PlaceNoteCommand(target, { ...v2(0), voiceIndex: 0 }, stringNumber, fret, QUARTER).execute();
    }
    expect(getBar(target.score, 0, 0).voices).toHaveLength(1);
    cursor.setPosition(v2(0));
    expect(svc.chordNameAt(0, 0)).toBeNull();
  });

  it('EditingService_suggestTechniquesで2つ目のボイスが無い小節のボイス2_投げずに候補を出さない', () => {
    // UT-EDIT-SVC-04 editing-core.md 4.1 節「2 つ目のボイスがまだ無い小節では、ボイス 2 を選んだときのカーソルの位置は拍 0（最後の拍の後ろ）だけとし」
    // 1 つ目のボイスの拍 0 は弦 3 のフレット 5（同じボイスなら 7 でハンマリングの候補になる差、5 でタイの候補になる）
    svc.placeNote(3, 5);
    expect(getBar(target.score, 0, 0).voices).toHaveLength(1);
    cursor.setPosition(v2(0));
    expect(() => svc.placeNote(3, 7)).not.toThrow();
    expect(svc.suggestTechniques()).toEqual([]);
    cursor.setPosition(v2(1));
    svc.placeNote(3, 5);
    expect(svc.tieCandidate()).toBeNull();
  });
});

describe('EditingService の確かめの呼び方（5 節）', () => {
  it('EditingService_placeNoteを確かめで拒む_例外を投げずコマンドを出さず曲を変えない', () => {
    // UT-EDIT-SVC-05 5 節「拒むときは、EditingService が NotificationReporter.report(code, context) で知らせ、コマンドを出さない（例外を投げない）」
    svc.placeNote(3, 5);
    cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    const before = scoreJson(target);
    expect(() => svc.placeNote(3, 9)).not.toThrow();
    expect(() => svc.placeNote(2, 25)).not.toThrow();
    expect(reporter.reports.map((r) => r.code)).toEqual(['EDIT-001', 'EDIT-002']);
    expect(reporter.reports[0]!.context).toMatchObject({ stringNumber: 3, barIndex: 0, beatIndex: 0 });
    expect(scoreJson(target)).toBe(before);
    expect(countUndoable(history)).toBe(1);
    expect(cursor.position.beatIndex).toBe(0);
  });

  it('EditingService_最後の小節が拍子の長さまで埋まって音符を置く_拒まず今ある拍を捨てず超えたまま持つ', () => {
    // UT-EDIT-SVC-06 5 節の表「小節の音価の合計が拍子の長さを超える｜音符を置くとき…｜確かめない（拒まない）」・「小節の音価の合計が拍子を超えたら、超えたまま持つ」・「新しく音符を置くときも…今ある拍を捨てない」
    for (const fret of [1, 2, 3, 4]) svc.placeNote(3, fret);
    expect(cursor.position).toEqual({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 4 });
    svc.placeNote(3, 5);
    expect(reporter.reports).toEqual([]);
    const beats = getVoice(getBar(target.score, 0, 0)).beats;
    expect(beats.map((b) => b.notes.map((n) => n.fret))).toEqual([[1], [2], [3], [4], [5]]);
    expect(beats.every((b) => b.duration === model.Duration.Quarter)).toBe(true);
  });

  it('EditingService_小節の音価の合計が拍子より短い_拒まず足りない分の休符の拍を足さない', () => {
    // UT-EDIT-SVC-07 5 節「合計が拍子より短いときも、超えたときと同じく拒まない」・「足りない分は、暗黙の休符（4.4 節）で埋まっているものとして扱う」
    svc.placeNote(3, 5);
    expect(reporter.reports).toEqual([]);
    expect(getVoice(getBar(target.score, 0, 0)).beats).toHaveLength(1);
  });
});

describe('EditingService のタイの候補（6 節）', () => {
  const beat = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });
  const noteAt = (beatIndex: number, stringNumber: number): model.Note =>
    getBeat(target.score, 0, 0, beatIndex).notes.find((n) => n.string === stringNumber)!;

  it('EditingService_直前の拍と同じ弦で同じフレットを置く_タイの候補を覚え曲は変えない', () => {
    // UT-EDIT-SVC-08 6 節「EditingService が音を置いた直後に求めて覚え、画面は EditingService.tieCandidate() で読む」・「候補を確定するまで曲を変えない」
    svc.placeNote(3, 5);
    svc.placeNote(3, 5);
    expect(svc.tieCandidate()).toEqual({ position: beat(0), stringNumber: 3 });
    // タイの終わり（同じ弦の次の音符の isTieDestination、3.4 節）は立てない
    expect(noteAt(1, 3).isTieDestination).toBe(false);
    expect(countUndoable(history)).toBe(2);
  });

  it('EditingService_タイの候補があってsetTie_候補の前の音符にSetTieCommandを出し候補を捨てる', () => {
    // UT-EDIT-SVC-09 6 節「setTie(stringNumber, tied) は、候補があれば候補の前の音符の tieToNext を」変える・「候補を確定すると、前の音符の Note.tieToNext を真にする SetTieCommand を発行する」
    svc.placeNote(3, 5);
    svc.placeNote(3, 5);
    // カーソルは拍 2（拍の無い所）。カーソルの拍に出すと音符が無く何も変わらない
    expect(cursor.position.beatIndex).toBe(2);
    svc.setTie(3, true);
    expect(noteAt(1, 3).isTieDestination).toBe(true);
    expect(svc.tieCandidate()).toBeNull();
    expect(countUndoable(history)).toBe(3);
  });

  it('EditingService_タイの候補が無くてsetTie_カーソルの拍の弦の音符を変える', () => {
    // UT-EDIT-SVC-10 6 節「無ければカーソルの拍の stringNumber の弦の音符の tieToNext を変える」
    svc.placeNote(3, 5);
    svc.placeNote(3, 7);
    expect(svc.tieCandidate()).toBeNull();
    cursor.setPosition(beat(0));
    svc.setTie(3, true);
    expect(noteAt(1, 3).isTieDestination).toBe(true);
  });

  it('EditingService_タイの候補を覚えた後に次の入力_候補を捨て何も付けない', () => {
    // UT-EDIT-SVC-11 6 節「次に音を置く・カーソルを動かす・Esc で候補を消し、何も付けない」・「覚えた候補は…CursorController.onChange・onCommandApplied と dismissSuggestions()（Esc）で捨てる」
    const inputs: [string, () => void][] = [
      ['次に音を置く', () => svc.placeNote(1, 0)],
      ['拒まれた音を置く', () => svc.placeNote(1, 30)],
      ['カーソルを動かす', () => cursor.moveByBeat(target, -1)],
      ['Esc', () => svc.dismissSuggestions()],
      ['取り消し', () => svc.undo()],
      ['別の窓口のコマンド', () => history.execute(new PlaceNoteCommand(target, beat(2), 1, 0, DEFAULT_DURATION_SPEC))],
    ];
    for (const [name, input] of inputs) {
      svc.placeNote(3, 5);
      svc.placeNote(3, 5);
      expect(svc.tieCandidate(), name).not.toBeNull();
      const tieCount = countUndoable(history);
      input();
      expect(svc.tieCandidate(), name).toBeNull();
      // 何も付けない：タイのコマンドは積まれず、タイの終わりも立たない
      expect(countUndoable(history), name).toBeLessThanOrEqual(tieCount + 1);
      for (const b of getVoice(getBar(target.score, 0, 0)).beats) {
        for (const n of b.notes) expect(n.isTieDestination, name).toBe(false);
      }
      target = buildEditTarget();
      cursor = new CursorController();
      history = new CommandHistory(render, reporter);
      svc = new EditingService(target, cursor, new ValidationService(), history, reporter);
    }
  });
});

describe('EditingService.setSlur（6 節）', () => {
  it('EditingService_範囲を選んでsetSlur_タイと別のSetSlurCommandを出し選んでいなければ出さない', () => {
    // UT-EDIT-SVC-15 6 節「範囲を選んだ拍に「スラー付与」をすると、範囲の音符に共通の slurGroupId を付ける SetSlurCommand を発行する」・「スラーはタイと別のコマンドにする」
    svc.placeNote(3, 5);
    svc.placeNote(3, 7);
    svc.setSlur();
    expect(countUndoable(history)).toBe(2);
    cursor.setSelection({
      trackIndex: 0,
      voiceIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 0,
      endBeatIndex: 1,
    });
    svc.setSlur();
    expect(countUndoable(history)).toBe(3);
    const second = getBeat(target.score, 0, 0, 1).notes[0]!;
    expect(second.isSlurDestination).toBe(true);
    expect(second.isTieDestination).toBe(false);
  });
});

describe('EditingService の奏法記号の候補（7.1 節）', () => {
  const beat = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });
  const firstNote = (): model.Note => getBeat(target.score, 0, 0, 0).notes[0]!;

  it('EditingService_直前の拍と同じ弦でフレットが上がる音を置く_候補を求めて覚え自動では付けない', () => {
    // UT-EDIT-SVC-12 7.1 節「音符を置いた直後（PlaceNoteCommand が成り立った後）に、EditingService が…suggestTechniques(score, placed) で候補を 0 から 2 件求めて覚え、画面は EditingService.suggestTechniques() で読んで」・「候補を自動では付けない」・「placeNote・insertRest の戻り値は void のままとする」
    // 拍 0：弦 3 のフレット 5、拍 1：弦 3 のフレット 7 <!-- req webcorefoundation:70d77fab.2f4f -->
    expect(svc.placeNote(3, 5)).toBeUndefined();
    expect(svc.suggestTechniques()).toEqual([]);
    svc.placeNote(3, 7);
    const suggestions = svc.suggestTechniques();
    expect(suggestions.length).toBeLessThanOrEqual(2);
    expect(suggestions.map((s) => s.kind)).toContain('hammer');
    for (const suggestion of suggestions) expect(suggestion.target).toEqual({ position: beat(0), stringNumber: 3 });
    // 示すだけ：前の音符の記号は変わらず、コマンドは音符を置いた 2 つだけ
    expect(firstNote().isHammerPullOrigin).toBe(false);
    expect(firstNote().slideOutType).toBe(model.SlideOutType.None);
    expect(countUndoable(history)).toBe(2);
  });

  it('EditingService_短い音符の後ろに休符を置く_前の音符へのスタッカートの候補を覚える', () => {
    // UT-EDIT-SVC-13 7.1 節「スタッカートの候補は、短い音符の後ろに休符の拍を置いたとき（InsertRestCommand の後）に、前の音符に対して示す」・「EditingService が insertRest の直後に求めて覚え、画面は音符のときと同じ EditingService.suggestTechniques() で読む」
    cursor.setDuration({ duration: model.Duration.Eighth, dots: 0, tuplet: null });
    svc.placeNote(3, 5);
    expect(svc.insertRest()).toBeUndefined();
    const staccato = svc.suggestTechniques().filter((s) => s.kind === 'staccato');
    expect(staccato).toHaveLength(1);
    expect(staccato[0]!.target).toEqual({ position: beat(0), stringNumber: 3 });
    expect(firstNote().isStaccato).toBe(false);
  });

  it('EditingService_奏法記号の候補を覚えた後に次の入力_候補を閉じ何も付けない', () => {
    // UT-EDIT-SVC-14 7.1 節「次の入力（音を置く・カーソルを動かす・Esc）で候補を閉じ、何も付けない」
    const inputs: [string, () => void][] = [
      ['音を置く', () => svc.placeNote(1, 0)],
      ['拒まれた音を置く', () => svc.placeNote(1, 30)],
      ['カーソルを動かす', () => cursor.setPosition(beat(0))],
      ['Esc', () => svc.dismissSuggestions()],
    ];
    for (const [name, input] of inputs) {
      svc.placeNote(3, 5);
      svc.placeNote(3, 7);
      expect(svc.suggestTechniques().length, name).toBeGreaterThan(0);
      input();
      expect(svc.suggestTechniques(), name).toEqual([]);
      expect(firstNote().isHammerPullOrigin, name).toBe(false);
      expect(firstNote().slideOutType, name).toBe(model.SlideOutType.None);
      target = buildEditTarget();
      cursor = new CursorController();
      history = new CommandHistory(render, reporter);
      svc = new EditingService(target, cursor, new ValidationService(), history, reporter);
    }
  });
});

describe('EditingService のコード名の覚え（8 節）', () => {
  const QUARTER: BeatDurationSpec = { duration: model.Duration.Quarter, dots: 0, tuplet: null };
  const at = (trackIndex: number, beatIndex: number): CursorPosition => ({
    trackIndex,
    barIndex: 0,
    voiceIndex: 0,
    beatIndex,
  });

  /** 拍に C の和音（弦 2 フレット 3・弦 3 フレット 2・弦 4 フレット 0、一番低い音は C3）を、履歴を通さずに置く。 */
  function placeCMajor(position: CursorPosition): void {
    for (const [stringNumber, fret] of [
      [2, 3],
      [3, 2],
      [4, 0],
    ] as const) {
      new PlaceNoteCommand(target, position, stringNumber, fret, QUARTER).execute();
    }
  }

  /** detect を何回呼んだかを数える ChordDetectionService を渡して作り直す。 */
  function rebuildWithCountingChords(partCount: number): { detects: () => number } {
    target = buildEditTarget(partCount);
    const chords = new ChordDetectionService();
    const detect = vi.spyOn(chords, 'detect');
    svc = new EditingService(
      target,
      cursor,
      new ValidationService(),
      history,
      reporter,
      new ClipboardService(),
      null,
      chords,
    );
    return { detects: () => detect.mock.calls.length };
  }

  it('EditingService_同じ拍のコード名を2回読む_コンストラクタで受けた部品で1回だけ推し量り覚えを返す', () => {
    // UT-EDIT-SVC-18 editing-core.md 8 節「結果を覚えるのは `EditingService`（コンストラクタで `ChordDetectionService` を受け、`chordNameAt` で返す。4.8 節）」・「`ChordDetectionService` は覚えを持たない部品のままにし」
    const counter = rebuildWithCountingChords(1);
    placeCMajor(at(0, 0));
    expect(svc.chordNameAt(0, 0)).toBe('C');
    expect(svc.chordNameAt(0, 0)).toBe('C');
    expect(counter.detects()).toBe(1);
    // 推し量れない拍（音が 1 つだけ）も、null を覚える
    new PlaceNoteCommand(target, at(0, 1), 3, 5, QUARTER).execute();
    expect(svc.chordNameAt(0, 1)).toBeNull();
    expect(svc.chordNameAt(0, 1)).toBeNull();
    expect(counter.detects()).toBe(2);
  });

  it('EditingService_覚えた後に同じパートへコマンドが当たる_覚えを捨て次に読むときに推し直す', () => {
    // UT-EDIT-SVC-19 editing-core.md 8 節「確定するたびの推し量りは、`CommandHistory.onCommandApplied`（2.2 節）で、変わったパートの拍の結果を捨て、次に描くときに推し直す形にする」・「拍の音符の並び（和音）が確定するたびに、コード名を推し量る」
    const counter = rebuildWithCountingChords(1);
    placeCMajor(at(0, 0));
    expect(svc.chordNameAt(0, 0)).toBe('C');
    // 弦 5 フレット 0（B3）を足すと Cmaj7
    history.execute(new PlaceNoteCommand(target, at(0, 0), 5, 0, QUARTER));
    expect(counter.detects()).toBe(1);
    expect(svc.chordNameAt(0, 0)).toBe('Cmaj7');
    expect(counter.detects()).toBe(2);
    // 取り消しでも捨てる
    svc.undo();
    expect(svc.chordNameAt(0, 0)).toBe('C');
    expect(counter.detects()).toBe(3);
  });

  it('EditingService_覚えた後に別のパートへコマンドが当たる_覚えたパートの覚えは捨てない', () => {
    // UT-EDIT-SVC-20 editing-core.md 8 節「変わったパートの拍の結果を捨て」
    const counter = rebuildWithCountingChords(2);
    placeCMajor(at(0, 0));
    expect(svc.chordNameAt(0, 0)).toBe('C');
    history.execute(new PlaceNoteCommand(target, at(1, 0), 3, 5, QUARTER));
    expect(svc.chordNameAt(0, 0)).toBe('C');
    expect(counter.detects()).toBe(1);
    // パート 2 の拍は、パート 2 にカーソルを置いて読む
    cursor.setPosition(at(1, 0));
    expect(svc.chordNameAt(0, 0)).toBeNull();
    expect(counter.detects()).toBe(2);
  });

  it('EditingService_setChordNameで手の値を入れて外す_手の値を優先し外すと推し量った名前に戻る', () => {
    // UT-EDIT-SVC-21 editing-core.md 8 節「利用者が手で直すと、`SetChordNameCommand` でその値を入れる」・「欄が空なら推し量った候補を出し、値があれば手で入れた値を優先して出す」・「手での指定の欄の実体は、alphaTab の `Beat.text` とする」
    placeCMajor(at(0, 0));
    expect(svc.chordNameAt(0, 0)).toBe('C');
    cursor.setPosition(at(0, 0));
    svc.setChordName('C(onE)');
    expect(getBeat(target.score, 0, 0, 0).text).toBe('C(onE)');
    expect(svc.chordNameAt(0, 0)).toBe('C(onE)');
    svc.setChordName(null);
    expect(svc.chordNameAt(0, 0)).toBe('C');
    svc.undo();
    expect(svc.chordNameAt(0, 0)).toBe('C(onE)');
  });

  it('EditingService_手の値が入った拍のコード名を読む_推し量った候補も1回だけ求めて組で覚え手の値を出す', () => {
    // UT-EDIT-SVC-23 editing-core.md 8 節「推し量った候補は、拍のコード名の手での指定の欄と組で持つ」・「欄が空なら推し量った候補を出し、値があれば手で入れた値を優先して出す」
    const counter = rebuildWithCountingChords(1);
    placeCMajor(at(0, 0));
    cursor.setPosition(at(0, 0));
    svc.setChordName('C(onE)');
    expect(counter.detects()).toBe(0);
    expect(svc.chordNameAt(0, 0)).toBe('C(onE)');
    // 手での指定の欄に値があっても、推し量った候補を求めて持つ
    expect(counter.detects()).toBe(1);
    expect(svc.chordNameAt(0, 0)).toBe('C(onE)');
    expect(counter.detects()).toBe(1);
  });

  it('EditingService_コード名を推し量って覚える_推し量った結果は曲に書かない', () => {
    // UT-EDIT-SVC-22 editing-core.md 8 節「推し量った結果は曲のファイルに書かない」
    placeCMajor(at(0, 0));
    const before = scoreJson(target);
    expect(svc.chordNameAt(0, 0)).toBe('C');
    expect(scoreJson(target)).toBe(before);
    expect(getBeat(target.score, 0, 0, 0).text).toBeNull();
  });
});

describe('EditingService 範囲選択とクリップボード・小節の削除・拍子とリピート（editing-core.md 9 節・10 節）', () => {
  let clipboard: ClipboardService;
  let confirmer: { confirm: Mock<BarDeleteConfirmer['confirm']> };

  /** 小節 0 の拍 beatIndex（パート 0、ボイス 1 つ目）。 */
  const pos = (beatIndex: number, barIndex = 0): CursorPosition => ({
    trackIndex: 0,
    barIndex,
    voiceIndex: 0,
    beatIndex,
  });
  const range = (startBeatIndex: number, endBeatIndex: number, endBarIndex = 0): SelectionRange => ({
    trackIndex: 0,
    voiceIndex: 0,
    startBarIndex: 0,
    startBeatIndex,
    endBarIndex,
    endBeatIndex,
  });
  const frets = (barIndex = 0): (number | null)[] =>
    getVoice(getBar(target.score, 0, barIndex)).beats.map((b) => b.notes[0]?.fret ?? null);

  beforeEach(() => {
    clipboard = new ClipboardService();
    confirmer = { confirm: vi.fn<BarDeleteConfirmer['confirm']>(async () => 'move-to-previous') };
    svc = new EditingService(target, cursor, new ValidationService(), history, reporter, clipboard, confirmer);
    // 弦 3 に 5・7・9 の 4 分音符の 3 拍
    svc.placeNote(3, 5);
    svc.placeNote(3, 7);
    svc.placeNote(3, 9);
  });

  it('cutSelection_範囲の切り取り_コピーと同じ中身を置き消す側だけをcutのDeleteSelectionCommandで積み取り消しで戻る', () => {
    // UT-EDIT-SVC-24 9 節「切り取りは、コピーと同じ中身をクリップボードへ置く」「消す側だけを、コマンド（DeleteSelectionCommand、ラベルの id は 'cut'）として履歴に積む」「切り取りは、取り消しで元に戻せる」
    const before = scoreJson(target);
    svc.cutSelection(); // 範囲が無ければ何もしない
    expect(clipboard.hasContent()).toBe(false);
    expect(scoreJson(target)).toBe(before);

    cursor.setSelection(range(0, 1));
    const execute = vi.spyOn(history, 'execute');
    svc.cutSelection();
    expect(execute).toHaveBeenCalledTimes(1);
    const command = execute.mock.calls[0]![0];
    expect(command).toBeInstanceOf(DeleteSelectionCommand);
    expect(command.label).toBe('cut');
    expect(frets()).toEqual([null, null, 9]);
    expect(clipboard.getSnapshot()!.beats.map((b) => b.notes.map((n) => n.fret))).toEqual([[5], [7]]);

    svc.undo();
    expect(scoreJson(target)).toBe(before);
    // クリップボードは取り消しで変わらず、貼り付けられる
    cursor.clearSelection();
    cursor.setPosition(pos(3));
    svc.paste();
    expect(frets()).toEqual([5, 7, 9, 5, 7]);
  });

  it('copySelection_範囲のコピー_クリップボードだけを変え履歴に積まない', () => {
    // UT-EDIT-SVC-25 9 節「クリップボードへ置く側は、曲の状態を変えないのでコマンドにしない」
    svc.copySelection(); // 範囲が無ければ何もしない
    expect(clipboard.hasContent()).toBe(false);
    cursor.setSelection(range(1, 2));
    const before = scoreJson(target);
    const execute = vi.spyOn(history, 'execute');
    svc.copySelection();
    expect(execute).not.toHaveBeenCalled();
    expect(scoreJson(target)).toBe(before);
    expect(clipboard.getSnapshot()!.beats.map((b) => b.notes.map((n) => n.fret))).toEqual([[7], [9]]);
  });

  it('copyAtとcutAt_右クリックした音符か休符の拍_1拍の形で写し切り取りはDeleteNotesCommandで消し取り消しで戻る', () => {
    // UT-EDIT-SVC-26 9 節「EditingService.copyAt(at) は…1 拍を…ClipboardService.copyAt でクリップボードへ写す」・「cutAt(at) が、copyAt(at) と同じ中身を
    // クリップボードへ置いたうえで、右クリックした音符か休符の拍を deleteNoteAt(at)（4.5 節）と同じ消し方で消す。消す側だけを DeleteNotesCommand として履歴に積み、取り消しで元に戻る」
    cursor.setPosition(pos(0));
    cursor.enterChordInput();
    svc.placeNote(2, 8); // 拍 0 は弦 3 と弦 2 の和音
    cursor.exitChordInput(target);
    cursor.setPosition(pos(3));
    svc.insertRest(); // 拍 3 は休符の拍
    const execute = vi.spyOn(history, 'execute');

    svc.copyAt({ position: pos(0), stringNumber: 2 });
    expect(execute).not.toHaveBeenCalled();
    expect(clipboard.getSnapshot()!.beats.map((b) => b.notes.map((n) => [n.string, n.fret]))).toEqual([[[2, 8]]]);

    const before = scoreJson(target);
    svc.cutAt({ position: pos(0), stringNumber: 3 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(DeleteNotesCommand);
    expect(getBeat(target.score, 0, 0, 0).notes.map((n) => n.string)).toEqual([2]);
    expect(clipboard.getSnapshot()!.beats.map((b) => b.notes.map((n) => [n.string, n.fret]))).toEqual([[[3, 5]]]);
    svc.undo();
    expect(scoreJson(target)).toBe(before);

    // 休符の拍：拍を取り除いて詰め、音符の無い 1 拍を写す
    svc.cutAt(pos(3));
    expect(frets()).toEqual([5, 7, 9]);
    expect(clipboard.getSnapshot()!.beats).toEqual([
      { duration: DEFAULT_DURATION_SPEC, notes: [], beatTechniques: {} },
    ]);
    svc.undo();
    expect(scoreJson(target)).toBe(before);

    // 音のある拍の位置・音符の無い弦・拍の無い所は、何も消さない（画面からは渡らない）
    execute.mockClear();
    svc.cutAt(pos(1));
    svc.cutAt({ position: pos(1), stringNumber: 6 });
    svc.cutAt(pos(9));
    expect(execute).not.toHaveBeenCalled();
    expect(scoreJson(target)).toBe(before);
  });

  it('duplicateSelection_Ctrl+Dの複製_範囲があればDuplicateSelectionCommandを発行しクリップボードは変えず範囲が無ければ何もしない', () => {
    // UT-EDIT-SVC-27 9 節「Ctrl+D の複製は、DuplicateSelectionCommand(target, range) を発行する。…クリップボードは変えない。範囲が無いときは何もしない」
    const execute = vi.spyOn(history, 'execute');
    svc.duplicateSelection();
    expect(execute).not.toHaveBeenCalled();
    cursor.setSelection(range(0, 1));
    svc.duplicateSelection();
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(DuplicateSelectionCommand);
    expect(frets()).toEqual([5, 7, 5, 7, 9]);
    expect(clipboard.hasContent()).toBe(false);
  });

  it('setDuration_範囲の音価のまとめ変更_拍ごとのSetBeatDurationCommandを1つのCompositeCommandで積み弾かれたら範囲の最初の小節で知らせる', () => {
    // UT-EDIT-SVC-28 9 節「選んだ拍の音価・付点・連符をまとめて変える（4.3 節の SetBeatDurationCommand を拍ごとに作り、CompositeCommand にまとめる）」・
    // 4.3 節「範囲を選んで音価を変えて弾かれたときは { trackIndex, barIndex } を入れ」「範囲が 2 つ以上の小節にまたがるときの barIndex は、範囲の最初の拍の小節とする」
    const spec: BeatDurationSpec = {
      duration: model.Duration.Eighth,
      dots: 1,
      tuplet: { numerator: 3, denominator: 2 },
    };
    const execute = vi.spyOn(history, 'execute');
    // 範囲が無いときは今の入力音価を変えるだけ
    svc.setDuration(spec);
    expect(cursor.currentDuration).toEqual(spec);
    expect(execute).not.toHaveBeenCalled();

    const before = scoreJson(target);
    cursor.setSelection(range(1, 2));
    svc.setDuration(spec);
    expect(execute).toHaveBeenCalledTimes(1);
    const command = execute.mock.calls[0]![0];
    expect(command).toBeInstanceOf(CompositeCommand);
    expect(command.label).toBe('set-beat-duration');
    const beats = getVoice(getBar(target.score, 0, 0)).beats;
    expect(beats.map((b) => [b.duration, b.dots, b.tupletNumerator, b.tupletDenominator])).toEqual([
      [model.Duration.Quarter, 0, 1, 1],
      [model.Duration.Eighth, 1, 3, 2],
      [model.Duration.Eighth, 1, 3, 2],
    ]);
    svc.undo(); // 1 回の取り消しで全部戻る
    expect(scoreJson(target)).toBe(before);

    // 付点の数が範囲の外：知らせてコマンドを出さない
    svc.insertBar(1);
    cursor.setSelection({ ...range(1, 0, 1), startBarIndex: 0 });
    execute.mockClear();
    svc.setDuration({ duration: model.Duration.Quarter, dots: 3 as 0, tuplet: null });
    expect(execute).not.toHaveBeenCalled();
    expect(reporter.reports.at(-1)).toEqual({ code: 'EDIT-012', context: { dots: 3, trackIndex: 0, barIndex: 0 } });

    // 範囲に拍が 1 つも無い（2 つ目のボイスがまだ無い）ときはコマンドを出さない
    cursor.setSelection({ ...range(0, 0), voiceIndex: 1 });
    svc.setDuration(spec);
    expect(execute).not.toHaveBeenCalled();
  });

  it('deleteBar_マーカーもメモも無い小節_確かめずにすぐnoneで発行し返る前に消えている', () => {
    // UT-EDIT-SVC-29 10 節「EditingService.deleteBar(at) は、消す小節にマーカーもメモも無ければ、すぐ DeleteBarCommand(at, 'none') を発行する」
    svc.insertBar(1);
    void svc.deleteBar(1);
    expect(target.score.masterBars).toHaveLength(1);
    expect(confirmer.confirm).not.toHaveBeenCalled();
  });

  it('deleteBar_マーカーかメモのある小節_注入した確かめに数を渡し選ばれた答えで発行し取り消しで戻る', async () => {
    // UT-EDIT-SVC-30 10 節「どちらかがあれば、注入した BarDeleteConfirmer.confirm(context) で Critical のダイアログ（EDIT-017）を出し、
    // 選ばれた答え（'delete' か 'move-to-previous'）を DeleteBarCommand の disposition に渡して発行する」・「小節の削除そのものを取りやめるのは、消した後の取り消し（Ctrl+Z）で行う」
    svc.insertBar(1);
    svc.insertBar(2);
    svc.addSectionMarker(1, 'サビ');
    svc.addMemo(2, 'ここ');
    const before = scoreJson(target);

    await svc.deleteBar(1);
    expect(confirmer.confirm).toHaveBeenLastCalledWith({ barIndex: 1, markerCount: 1, memoCount: 0 });
    expect(target.score.masterBars).toHaveLength(2);
    expect(target.appMeta.sectionMarkers.map((m) => m.barId)).toEqual(['0']); // 直前の小節へ移る
    svc.undo();
    expect(scoreJson(target)).toBe(before);
    expect(target.appMeta.sectionMarkers.map((m) => m.barId)).toEqual(['1']);

    confirmer.confirm.mockResolvedValueOnce('delete');
    await svc.deleteBar(2);
    expect(confirmer.confirm).toHaveBeenLastCalledWith({ barIndex: 2, markerCount: 0, memoCount: 1 });
    expect(target.appMeta.memos).toEqual([]);
  });

  it('deleteBar_確かめの口を渡していない窓でマーカーのある小節_Errorで落とし消さない', async () => {
    // UT-EDIT-SVC-31 10 節「注入した BarDeleteConfirmer.confirm(context)」（注入が無いのはアプリの組み立ての不具合）
    svc = new EditingService(target, cursor, new ValidationService(), history, reporter);
    svc.insertBar(1);
    svc.addSectionMarker(1, 'A');
    await expect(svc.deleteBar(1)).rejects.toThrow('BarDeleteConfirmer is not injected');
    expect(target.score.masterBars).toHaveLength(2);
  });

  it('setTimeSignature_値は確かめてから発行しEDIT-010は知らせてコマンドを出さずnullは継ぐ状態へ戻す', () => {
    // UT-EDIT-SVC-32 10 節「拍子の範囲の確かめは ValidationService.validateTimeSignature（EDIT-010）」・「SetTimeSignatureCommand は null を渡すと継ぐ状態へ戻せ」
    svc.insertBar(1);
    const execute = vi.spyOn(history, 'execute');
    svc.setTimeSignature(1, { numerator: 0, denominator: 4 });
    expect(execute).not.toHaveBeenCalled();
    expect(reporter.reports.at(-1)).toEqual({ code: 'EDIT-010', context: { numerator: 0, denominator: 4 } });

    svc.setTimeSignature(1, { numerator: 3, denominator: 4 });
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(SetTimeSignatureCommand);
    expect(target.score.masterBars[1]!.timeSignatureNumerator).toBe(3);
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 1]);
    svc.setTimeSignature(1, null);
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect(target.score.masterBars[1]!.timeSignatureNumerator).toBe(target.score.masterBars[0]!.timeSignatureNumerator);
  });

  it('setRepeat_EDIT-011は知らせて拒みEDIT-015は知らせたうえで発行し開始は知らせずに発行する', () => {
    // UT-EDIT-SVC-33 10 節「回数の確かめは ValidationService.validateRepeat（範囲の外は EDIT-011 で拒み、対応する開始の無い終わりは EDIT-015 で知らせたうえで発行する）」
    const execute = vi.spyOn(history, 'execute');
    svc.setRepeat(0, { repeatCount: 11 });
    expect(execute).not.toHaveBeenCalled();
    expect(reporter.reports.at(-1)).toEqual({ code: 'EDIT-011', context: { repeatCount: 11 } });

    svc.setRepeat(0, { repeatCount: 3 });
    expect(reporter.reports.at(-1)).toEqual({ code: 'EDIT-015', context: { barIndex: 0, repeatCount: 3 } });
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(SetRepeatCommand);
    expect(target.score.masterBars[0]!.repeatCount).toBe(3);

    const reportsBefore = reporter.reports.length;
    svc.setRepeat(0, { isRepeatStart: true });
    expect(reporter.reports).toHaveLength(reportsBefore);
    expect(target.score.masterBars[0]!.isRepeatStart).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('paste_クリップボードが空か拍が0個_何も発行しない', () => {
    // UT-EDIT-SVC-34 9 節「その後で、貼り付け先…へカーソルを動かして貼り付けられる」（写したものが無ければ貼るものが無い）
    const execute = vi.spyOn(history, 'execute');
    svc.paste();
    clipboard.copy(target, { ...range(0, 0), voiceIndex: 1 }); // 2 つ目のボイスがまだ無いので拍が 0 個
    svc.paste();
    expect(execute).not.toHaveBeenCalled();
  });

  it('マーカーとメモの変更と削除_EditとDeleteのコマンドを発行しマーカーは全部のパートを描き直しメモは描き直さない', () => {
    // UT-EDIT-SVC-35 10 節「変えるのは EditSectionMarkerCommand(target, markerId, label)、消すのは DeleteSectionMarkerCommand(target, markerId)」・
    // 「3 つのマーカーのコマンドの affectedTrackIndices は全部のパートとする…メモのコマンドは []」
    svc.addSectionMarker(0, 'A');
    svc.addMemo(0, 'メモ');
    const markerId = target.appMeta.sectionMarkers[0]!.id;
    const memoId = target.appMeta.memos[0]!.id;
    render.calls.length = 0;
    svc.editSectionMarker(markerId, 'B');
    expect(target.appMeta.sectionMarkers[0]!.label).toBe('B');
    const reportsBefore = reporter.reports.length;
    svc.editMemo(memoId, 'ok');
    expect(reporter.reports).toHaveLength(reportsBefore);
    expect(target.appMeta.memos[0]!.text).toBe('ok');
    svc.editMemo(memoId, 'い'.repeat(101));
    expect(reporter.reports.at(-1)).toMatchObject({ code: 'EDIT-004' });
    expect([...target.appMeta.memos[0]!.text]).toHaveLength(100);
    svc.deleteSectionMarker(markerId);
    svc.deleteMemo(memoId);
    expect(target.appMeta.sectionMarkers).toEqual([]);
    expect(target.appMeta.memos).toEqual([]);
    expect(render.calls).toEqual([[0], [], [], [0], []]);
  });
});
