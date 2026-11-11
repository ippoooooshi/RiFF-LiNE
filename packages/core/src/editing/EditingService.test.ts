// UT-EDIT-SVC: editing-core.md 4.8 節・5 節・6 節・7.1 節・8 節 — EditingService
// 検証観点: UI 入力 → 確かめ → コマンド/知らせの振り分け、カーソル前進、和音入力、
//   メモ切り詰め通知、小節上限拒否、音価の合計を拒まない扱い、undo/redo、タイと奏法記号の候補、コード名解決、
//   2 つ目のボイスを持つ小節と持たない小節が並ぶ曲の描く前の作り直しと保存・開き直し（web-core-foundation.md 12.1 節）。

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ChordDetectionService } from './ChordDetectionService';
import { ClipboardService } from './ClipboardService';
import { CompositeCommand } from './CompositeCommand';
import { InsertBarCommand } from './commands/barCommands';
import type { Command } from './commands/Command';
import { CommandHistory } from './commands/CommandHistory';
import { DeleteNotesCommand } from './commands/DeleteNotesCommand';
import { DeleteSelectionCommand } from './commands/DeleteSelectionCommand';
import { DuplicateSelectionCommand } from './commands/DuplicateSelectionCommand';
import { InsertRestCommand } from './commands/InsertRestCommand';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { SetRepeatCommand } from './commands/SetRepeatCommand';
import { SetTimeSignatureCommand } from './commands/SetTimeSignatureCommand';
import { CursorController } from './CursorController';
import { EditingService, TWO_DIGIT_FRET_WINDOW_MS, type BarDeleteConfirmer } from './EditingService';
import { ValidationService } from './ValidationService';
import { SetBeatTechniqueCommand } from './commands/noteAttributeCommands';
import { findNoteOnString, getBeat, getVoice, getBar, getMasterBar } from './scoreModel';
import {
  DEFAULT_DURATION_SPEC,
  tupletSpecFor,
  type BeatDurationSpec,
  type CursorPosition,
  type EditTarget,
  type NoteRef,
  type SelectionRange,
} from './types';
import {
  buildEditTarget,
  countUndoable,
  RecordingRenderRequester,
  RecordingReporter,
  scoreJson,
} from '../testing/editingFakes';
import { rebuildBeforeRender } from '../testing/noteAttributeFixtures';
import { createEmptyAppMetadata, SongDocument } from '../domain/SongDocument';
import { midi, model, Settings } from '@coderline/alphatab';

let target: EditTarget;
let cursor: CursorController;
let render: RecordingRenderRequester;
let reporter: RecordingReporter;
let history: CommandHistory;
let svc: EditingService;

/** 小節を消すときの確かめの口（editing-core.md 4.8 節で必ず渡す）。確かめを見ないテストで渡す、'delete' を返すもの。 */
const stubConfirmer = (): BarDeleteConfirmer => ({ confirm: async () => 'delete' });

beforeEach(() => {
  target = buildEditTarget();
  cursor = new CursorController();
  render = new RecordingRenderRequester();
  reporter = new RecordingReporter();
  history = new CommandHistory(render, reporter);
  svc = new EditingService(target, cursor, new ValidationService(), history, reporter, undefined, stubConfirmer());
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
    // 新しい曲の 1 小節目は全音符の休符で埋まっていて、そこへ挿すと最後の小節が埋まって小節を足す（4.1 節）ので、拍を空にしてから挿す
    getVoice(getBar(target.score, 0, 0)).beats.length = 0;
    svc.insertRest();
    expect(getVoice(getBar(target.score, 0, 0)).beats.length).toBe(1);
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
    svc = new EditingService(target, cursor, new ValidationService(), history, reporter, undefined, stubConfirmer());
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
    svc.setTempo(0, 90);
    expect(history.canUndo()).toBe(true);
  });

  it('outOfRangeBpm_DoesNotExecute', () => {
    svc.setTempo(0, 5);
    svc.setTempo(0, 9999);
    expect(history.canUndo()).toBe(false);
  });

  it('null_ResetsToInherit_Executes', () => {
    svc.setTempo(0, 120);
    svc.setTempo(0, null);
    expect(countUndoable(history)).toBe(2);
  });

  it('EditingService_setTempoで小節を指定_カーソルの小節でなく指定した小節のテンポを変える', () => {
    // UT-EDIT-SVC-82 editing-core.md 4.8 節「setTempo(barIndex: number, bpm: number | null): void;」
    svc.insertBar(1);
    cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    svc.setTempo(1, 150);
    expect(getMasterBar(target.score, 1).tempoAutomations[0]?.value).toBe(150);
    expect(getMasterBar(target.score, 0).tempoAutomations).toHaveLength(0);
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
    expect(svc.chordNameAt({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 })).toBe('C/E');
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
    expect(svc.chordNameAt(v2(0))).toBe('C/E');
    expect(svc.chordNameAt({ ...v2(0), voiceIndex: 0 })).toBeNull();
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
    expect(svc.chordNameAt(v2(0))).toBeNull();
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
    // 最後の小節が埋まったので小節が足され、その頭へ送られている（4.1 節）。埋まった 1 小節目の最後の拍の後ろへ戻して置く
    expect(cursor.position).toEqual({ trackIndex: 0, barIndex: 1, voiceIndex: 0, beatIndex: 0 });
    cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 4 });
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
      svc = new EditingService(target, cursor, new ValidationService(), history, reporter, undefined, stubConfirmer());
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
      svc = new EditingService(target, cursor, new ValidationService(), history, reporter, undefined, stubConfirmer());
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
      stubConfirmer(),
      chords,
    );
    return { detects: () => detect.mock.calls.length };
  }

  it('EditingService_同じ拍のコード名を2回読む_コンストラクタで受けた部品で1回だけ推し量り覚えを返す', () => {
    // UT-EDIT-SVC-18 editing-core.md 8 節「結果を覚えるのは `EditingService`（コンストラクタで `ChordDetectionService` を受け、`chordNameAt` で返す。4.8 節）」・「`ChordDetectionService` は覚えを持たない部品のままにし」
    const counter = rebuildWithCountingChords(1);
    placeCMajor(at(0, 0));
    expect(svc.chordNameAt(at(0, 0))).toBe('C');
    expect(svc.chordNameAt(at(0, 0))).toBe('C');
    expect(counter.detects()).toBe(1);
    // 推し量れない拍（音が 1 つだけ）も、null を覚える
    new PlaceNoteCommand(target, at(0, 1), 3, 5, QUARTER).execute();
    expect(svc.chordNameAt(at(0, 1))).toBeNull();
    expect(svc.chordNameAt(at(0, 1))).toBeNull();
    expect(counter.detects()).toBe(2);
  });

  it('EditingService_覚えた後に同じパートへコマンドが当たる_覚えを捨て次に読むときに推し直す', () => {
    // UT-EDIT-SVC-19 editing-core.md 8 節「確定するたびの推し量りは、`CommandHistory.onCommandApplied`（2.2 節）で、変わったパートの拍の結果を捨て、次に描くときに推し直す形にする」・「拍の音符の並び（和音）が確定するたびに、コード名を推し量る」
    const counter = rebuildWithCountingChords(1);
    placeCMajor(at(0, 0));
    expect(svc.chordNameAt(at(0, 0))).toBe('C');
    // 弦 5 フレット 0（B3）を足すと Cmaj7
    history.execute(new PlaceNoteCommand(target, at(0, 0), 5, 0, QUARTER));
    expect(counter.detects()).toBe(1);
    expect(svc.chordNameAt(at(0, 0))).toBe('Cmaj7');
    expect(counter.detects()).toBe(2);
    // 取り消しでも捨てる
    svc.undo();
    expect(svc.chordNameAt(at(0, 0))).toBe('C');
    expect(counter.detects()).toBe(3);
  });

  it('EditingService_覚えた後に別のパートへコマンドが当たる_覚えたパートの覚えは捨てない', () => {
    // UT-EDIT-SVC-20 editing-core.md 8 節「変わったパートの拍の結果を捨て」
    const counter = rebuildWithCountingChords(2);
    placeCMajor(at(0, 0));
    expect(svc.chordNameAt(at(0, 0))).toBe('C');
    history.execute(new PlaceNoteCommand(target, at(1, 0), 3, 5, QUARTER));
    expect(svc.chordNameAt(at(0, 0))).toBe('C');
    expect(counter.detects()).toBe(1);
    // パート 2 の拍は、パート 2 の位置を渡して読む
    expect(svc.chordNameAt(at(1, 0))).toBeNull();
    expect(counter.detects()).toBe(2);
  });

  it('EditingService_chordNameAtに別のパートの拍の位置を渡す_カーソルのパートでなく渡した位置の拍のコード名を返す', () => {
    // UT-EDIT-SVC-83 editing-core.md 4.8 節「chordNameAt(position: CursorPosition): string | null;」
    rebuildWithCountingChords(2);
    placeCMajor(at(1, 0));
    cursor.setPosition(at(0, 0));
    expect(svc.chordNameAt(at(1, 0))).toBe('C');
    expect(svc.chordNameAt(at(0, 0))).toBeNull();
    expect(cursor.position).toEqual(at(0, 0));
  });

  it('EditingService_setChordNameで手の値を入れて外す_手の値を優先し外すと推し量った名前に戻る', () => {
    // UT-EDIT-SVC-21 editing-core.md 8 節「利用者が手で直すと、`SetChordNameCommand` でその値を入れる」・「欄が空なら推し量った候補を出し、値があれば手で入れた値を優先して出す」・「手での指定の欄の実体は、alphaTab の `Beat.text` とする」
    placeCMajor(at(0, 0));
    expect(svc.chordNameAt(at(0, 0))).toBe('C');
    cursor.setPosition(at(0, 0));
    svc.setChordName('C(onE)');
    expect(getBeat(target.score, 0, 0, 0).text).toBe('C(onE)');
    expect(svc.chordNameAt(at(0, 0))).toBe('C(onE)');
    svc.setChordName(null);
    expect(svc.chordNameAt(at(0, 0))).toBe('C');
    svc.undo();
    expect(svc.chordNameAt(at(0, 0))).toBe('C(onE)');
  });

  it('EditingService_手の値が入った拍のコード名を読む_推し量った候補も1回だけ求めて組で覚え手の値を出す', () => {
    // UT-EDIT-SVC-23 editing-core.md 8 節「推し量った候補は、拍のコード名の手での指定の欄と組で持つ」・「欄が空なら推し量った候補を出し、値があれば手で入れた値を優先して出す」
    const counter = rebuildWithCountingChords(1);
    placeCMajor(at(0, 0));
    cursor.setPosition(at(0, 0));
    svc.setChordName('C(onE)');
    expect(counter.detects()).toBe(0);
    expect(svc.chordNameAt(at(0, 0))).toBe('C(onE)');
    // 手での指定の欄に値があっても、推し量った候補を求めて持つ
    expect(counter.detects()).toBe(1);
    expect(svc.chordNameAt(at(0, 0))).toBe('C(onE)');
    expect(counter.detects()).toBe(1);
  });

  it('EditingService_コード名を推し量って覚える_推し量った結果は曲に書かない', () => {
    // UT-EDIT-SVC-22 editing-core.md 8 節「推し量った結果は曲のファイルに書かない」
    placeCMajor(at(0, 0));
    const before = scoreJson(target);
    expect(svc.chordNameAt(at(0, 0))).toBe('C');
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

  it('deleteBar_確かめの口は省けずnullも渡せない型_渡した口の答えでマーカーのある小節を消す', async () => {
    // UT-EDIT-SVC-31 10 節「注入した BarDeleteConfirmer.confirm(context)」・4.8 節「barDeleteConfirmer: BarDeleteConfirmer」
    //   （null を許さない型。渡し忘れと null は型の検査〈tsc -b〉で止まる。下の 2 つは型の検査だけのために作り、呼ばない）
    const withoutConfirmer = (): EditingService =>
      // @ts-expect-error 4.8 節：barDeleteConfirmer は省けない
      new EditingService(target, cursor, new ValidationService(), history, reporter);
    const withNullConfirmer = (): EditingService =>
      // @ts-expect-error 4.8 節：barDeleteConfirmer は null を許さない
      new EditingService(target, cursor, new ValidationService(), history, reporter, undefined, null);
    expect([withoutConfirmer, withNullConfirmer]).toHaveLength(2);
    svc = new EditingService(target, cursor, new ValidationService(), history, reporter, undefined, stubConfirmer());
    svc.insertBar(1);
    svc.addSectionMarker(1, 'A');
    await svc.deleteBar(1);
    expect(target.score.masterBars).toHaveLength(1);
    expect(target.appMeta.sectionMarkers).toEqual([]);
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

  it('deleteNotesとdeleteNoteAt_選択範囲がある_どの入口もdelete-selectionのDeleteSelectionCommandを積みクリップボードは変えず取り消しで戻る', () => {
    // UT-EDIT-SVC-36 4.5 節「選択範囲があるときは、どの入口も 9 節の DeleteSelectionCommand を出す」・9 節「選択範囲の削除は、クリップボードを変えない」
    // 「label は切り取りなら 'cut'、削除なら 'delete-selection'」・「選択範囲の削除は、取り消しで元に戻せる」
    clipboard.copy(target, range(2, 2));
    const clip = clipboard.getSnapshot();
    const before = scoreJson(target);
    cursor.setSelection(range(0, 1));
    const execute = vi.spyOn(history, 'execute');

    svc.deleteNotes();
    expect(execute).toHaveBeenCalledTimes(1);
    const command = execute.mock.calls[0]![0];
    expect(command).toBeInstanceOf(DeleteSelectionCommand);
    expect(command.label).toBe('delete-selection');
    expect(frets()).toEqual([null, null, 9]);
    expect(clipboard.getSnapshot()).toBe(clip);
    svc.undo();
    expect(scoreJson(target)).toBe(before);

    // 右クリックと消しゴム（音符を指しても拍を指しても）も、選択範囲があれば範囲を消す
    svc.deleteNoteAt({ position: pos(2), stringNumber: 3 });
    svc.undo();
    svc.deleteNoteAt(pos(2));
    expect(execute.mock.calls.slice(1).map(([c]) => [c.constructor, c.label])).toEqual([
      [DeleteSelectionCommand, 'delete-selection'],
      [DeleteSelectionCommand, 'delete-selection'],
    ]);
    expect(frets()).toEqual([null, null, 9]);
    expect(clipboard.getSnapshot()).toBe(clip);
  });

  it('deleteNotes_選択範囲が無い_カーソルの拍の選んでいる弦の音符か休符の拍をDeleteNotesCommandで消し無ければ何もしない', () => {
    // UT-EDIT-SVC-37 4.5 節「選択範囲が無いときは、どれも同じ DeleteNotesCommand を出す」・「無ければカーソルの拍の選んでいる弦の音符とする。
    // 選択範囲が無く、カーソルの拍が休符の拍なら、その拍を restBeats に渡して取り除く」
    cursor.setPosition(pos(3));
    svc.insertRest(); // 拍 3 は休符の拍
    const execute = vi.spyOn(history, 'execute');

    cursor.setPosition(pos(1));
    cursor.setString(2); // 拍 1 の音符は弦 3 だけ
    svc.deleteNotes();
    cursor.setPosition(pos(9)); // 拍の無い所
    svc.deleteNotes();
    expect(execute).not.toHaveBeenCalled();

    cursor.setPosition(pos(1));
    cursor.setString(3);
    svc.deleteNotes();
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(DeleteNotesCommand);
    // 音が残らない拍は同じ長さの休符の拍として残る（4.5 節）
    expect(frets()).toEqual([5, null, 9, null]);

    cursor.setPosition(pos(3));
    svc.deleteNotes();
    expect(execute.mock.calls[1]![0]).toBeInstanceOf(DeleteNotesCommand);
    expect(frets()).toEqual([5, null, 9]);
    svc.undo();
    svc.undo();
    expect(frets()).toEqual([5, 7, 9, null]);
  });

  it('deleteNoteAt_選択範囲が無い_音符はその音符を休符の拍はその拍を消し音のある拍を渡されたら何もしない', () => {
    // UT-EDIT-SVC-38 4.5 節「右クリックのメニューの「削除」と消しゴムモードのクリックは EditingService.deleteNoteAt(at) を呼ぶ」・
    // 「deleteNoteAt(at) に拍（CursorPosition）を渡すのは、その拍が休符の拍のときだけとし、restBeats に渡して取り除く。音のある拍を渡されたときは何もしない」
    cursor.setPosition(pos(3));
    svc.insertRest();
    const execute = vi.spyOn(history, 'execute');

    svc.deleteNoteAt(pos(1)); // 音のある拍
    svc.deleteNoteAt({ position: pos(1), stringNumber: 6 }); // 音符の無い弦
    expect(execute).not.toHaveBeenCalled();

    svc.deleteNoteAt({ position: pos(0), stringNumber: 3 });
    svc.deleteNoteAt(pos(3));
    expect(execute.mock.calls.map(([c]) => c.constructor)).toEqual([DeleteNotesCommand, DeleteNotesCommand]);
    expect(frets()).toEqual([null, 7, 9]);
  });

  it('copyAtとcutAt_音のある拍の位置を渡された_クリップボードを変えず何も消さない', () => {
    // UT-EDIT-SVC-39 9 節の (b)「音のある拍の空いた弦を右クリックしたときは「コピー」「切り取り」を押せない（10.2 節）ので、copyAt・cutAt に音のある拍は渡らない」
    // （前提が崩れたときは、cutAt の消す側の deleteNoteAt と同じく何もしない。4.5 節「音のある拍を渡されたときは何もしない」）
    svc.copyAt({ position: pos(2), stringNumber: 3 });
    const clip = clipboard.getSnapshot();
    const before = scoreJson(target);
    svc.copyAt(pos(1));
    expect(clipboard.getSnapshot()).toBe(clip);
    svc.cutAt(pos(1));
    expect(clipboard.getSnapshot()).toBe(clip);
    expect(scoreJson(target)).toBe(before);
  });
});

// ---- 2 つ目のボイスを持つ小節と持たない小節が並ぶ曲（web-core-foundation.md 12.1 節、editing-core.md 4.1 節の (b)） ----

describe('2 つ目のボイスを持つ小節と持たない小節が並ぶ曲', () => {
  /** 小節を barCount 個にする（足した小節は 2 つ目のボイスを持たない）。 */
  function withBars(barCount: number): void {
    for (let i = 1; i < barCount; i++) new InsertBarCommand(target, i).execute();
    rebuildBeforeRender(target.score);
  }

  /** ボイス 2 の拍 0 に音を置く。 */
  function placeOnSecondVoice(barIndex: number): void {
    cursor.setPosition({ trackIndex: 0, barIndex, voiceIndex: 1, beatIndex: 0 });
    svc.placeNote(1, 3);
  }

  /** 選択範囲の削除で、小節 barIndex のボイス 2 の拍を全部消す。 */
  function deleteSecondVoiceOf(barIndex: number): void {
    cursor.setSelection({
      trackIndex: 0,
      voiceIndex: 1,
      startBarIndex: barIndex,
      startBeatIndex: 0,
      endBarIndex: barIndex,
      endBeatIndex: 99,
    });
    svc.deleteNotes();
  }

  const bars = (score: model.Score = target.score): model.Bar[] => score.tracks[0]!.staves[0]!.bars;

  /** 小節ごとの [ボイスの数]:[2 つ目のボイスの拍の数]（無ければ -1）。 */
  const shape = (score: model.Score = target.score): string =>
    bars(score)
      .map((b) => `${b.voices.length}:${b.voices[1]?.beats.length ?? -1}`)
      .join(' ');

  /** 曲の中に無い拍を指す前後の拍のつながりの数（補って外した拍を指したまま残っていないか）。 */
  function linksToMissingBeats(score: model.Score = target.score): number {
    const all = new Set(bars(score).flatMap((b) => b.voices.flatMap((v) => v.beats)));
    let count = 0;
    for (const beat of all) {
      if (beat.previousBeat !== null && !all.has(beat.previousBeat)) count++;
      if (beat.nextBeat !== null && !all.has(beat.nextBeat)) count++;
    }
    return count;
  }

  /** alphaTab の MIDI の作り（MidiFileGenerator）を通し、出来た MIDI の出来事の数を返す。 */
  function generateMidi(score: model.Score = target.score): number {
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    return file.tracks.reduce((sum, t) => sum + t.events.length, 0);
  }

  const secondVoiceBeat = (barIndex: number): model.Beat => bars()[barIndex]!.voices[1]!.beats[0]!;

  it('描く前の作り直し_1小節目にだけ2つ目のボイス_落ちず形を変えず外した拍を指すつながりも残さない', () => {
    // UT-EDIT-SVC-40 web-core-foundation.md 12.1 節「2 つ目のボイスを持つ小節と持たない小節が並ぶ曲も描けるように、rebuildDerivedLinks は
    // (1) の前に padEmptyVoices で…(2) の後に unpadEmptyVoices で補った拍とボイスを外し、外した拍を指したままの前後の拍のつながりを、
    // 補う前と同じ形に繋ぎ直す」（前のターンの再現のア-1：次の小節に 2 つ目のボイスが無く Voice._chain で落ちていた）
    withBars(3);
    placeOnSecondVoice(0);
    expect(shape()).toBe('2:1 1:-1 1:-1');
    expect(() => rebuildBeforeRender(target.score)).not.toThrow();
    expect(shape()).toBe('2:1 1:-1 1:-1');
    expect(linksToMissingBeats()).toBe(0);
    // 後ろに 2 つ目のボイスの拍が無いので、次の拍は無い
    expect(secondVoiceBeat(0).nextBeat).toBeNull();
    // 1 つ目のボイスのつながりは finish が張ったまま
    expect(bars()[0]!.voices[0]!.beats.at(-1)!.nextBeat).toBe(bars()[1]!.voices[0]!.beats[0]);
    expect(generateMidi()).toBeGreaterThan(0);
  });

  it('描く前の作り直し_2つ目のボイスの間に小節を足す_足した小節を飛ばして前後の拍を繋ぎ直す', () => {
    // UT-EDIT-SVC-41 12.1 節（再現のア-4：1・2 小節目に置いた後、間に足した小節に 2 つ目のボイスが無く落ちていた）。
    // 小節を足すコマンドはボイス 2 を作らないまま（editing-core.md 4.1 節の (b)）
    withBars(2);
    placeOnSecondVoice(0);
    placeOnSecondVoice(1);
    new InsertBarCommand(target, 1).execute();
    expect(shape()).toBe('2:1 1:-1 2:1');
    expect(() => rebuildBeforeRender(target.score)).not.toThrow();
    expect(shape()).toBe('2:1 1:-1 2:1');
    expect(linksToMissingBeats()).toBe(0);
    expect(secondVoiceBeat(0).nextBeat).toBe(secondVoiceBeat(2));
    expect(secondVoiceBeat(2).previousBeat).toBe(secondVoiceBeat(0));
    expect(generateMidi()).toBeGreaterThan(0);
  });

  it('範囲の削除_真ん中の小節の2つ目のボイスを2回消す_2回目でVoiceを外し描く前の作り直しが通りundoで戻る', () => {
    // UT-EDIT-SVC-42 editing-core.md 4.1 節の (b)「範囲の削除や音符の削除で 2 つ目のボイスの拍が 0 個になったときも、同じコマンドの中で
    // その小節の Bar.voices から 2 つ目の Voice を外し、undo で同じ位置に戻す」（再現のイ-1 の 2 回目：拍 0 個のボイスで落ちていた）
    withBars(3);
    placeOnSecondVoice(0);
    placeOnSecondVoice(1);
    placeOnSecondVoice(2);
    deleteSecondVoiceOf(1);
    expect(shape()).toBe('2:1 2:1 2:1');
    deleteSecondVoiceOf(1);
    expect(shape()).toBe('2:1 1:-1 2:1');
    expect(() => rebuildBeforeRender(target.score)).not.toThrow();
    expect(linksToMissingBeats()).toBe(0);
    expect(secondVoiceBeat(0).nextBeat).toBe(secondVoiceBeat(2));
    expect(generateMidi()).toBeGreaterThan(0);
    svc.undo();
    expect(shape()).toBe('2:1 2:1 2:1');
    expect(() => rebuildBeforeRender(target.score)).not.toThrow();
  });

  it('範囲の削除_最後の小節の2つ目のボイスを全部消す_描く前の作り直しが通る', () => {
    // UT-EDIT-SVC-43 4.1 節の (b)・12.1 節（再現のイ-3：1 つ前の小節の最後の拍から次へつなぐところで落ちていた）
    withBars(3);
    placeOnSecondVoice(0);
    placeOnSecondVoice(1);
    placeOnSecondVoice(2);
    deleteSecondVoiceOf(2);
    deleteSecondVoiceOf(2);
    expect(shape()).toBe('2:1 2:1 1:-1');
    expect(() => rebuildBeforeRender(target.score)).not.toThrow();
    expect(linksToMissingBeats()).toBe(0);
    expect(secondVoiceBeat(1).nextBeat).toBeNull();
  });

  it('undo_2小節目の2つ目のボイスを置いたのを戻す_描く前の作り直しが通る', () => {
    // UT-EDIT-SVC-44 12.1 節（再現のウ-2：1 小節目から先の小節にボイスが無く落ちていた）
    withBars(2);
    placeOnSecondVoice(0);
    placeOnSecondVoice(1);
    rebuildBeforeRender(target.score);
    svc.undo();
    expect(shape()).toBe('2:1 1:-1');
    expect(() => rebuildBeforeRender(target.score)).not.toThrow();
    expect(linksToMissingBeats()).toBe(0);
    expect(secondVoiceBeat(0).nextBeat).toBeNull();
  });

  it('undo_真ん中の小節にだけ2つ目のボイスが残る_描く前の作り直しが通る', () => {
    // UT-EDIT-SVC-45 12.1 節（再現のウ-4：2 小節目だけ残り 3 小節目へつなぐところで落ちていた）
    withBars(3);
    placeOnSecondVoice(1);
    placeOnSecondVoice(0);
    svc.undo();
    expect(shape()).toBe('1:-1 2:1 1:-1');
    expect(() => rebuildBeforeRender(target.score)).not.toThrow();
    expect(linksToMissingBeats()).toBe(0);
    expect(secondVoiceBeat(1).previousBeat).toBeNull();
    expect(secondVoiceBeat(1).nextBeat).toBeNull();
    expect(generateMidi()).toBeGreaterThan(0);
  });

  it('保存して開き直す_2つ目のボイスを持つ小節と持たない小節_落ちず開き直した曲のボイスと拍の数が保存の前と同じ', () => {
    // UT-EDIT-SVC-46 12.1 節「保存（scoreToJson）も書き出す前に padEmptyVoices で補い、書き出した後に unpadEmptyVoices で外して、
    // 曲の中の形を保存の前と変えない。開き直し（jsonToScore）は、読み込んだ後に stripEmptyVoices で…保存の前と同じ形に戻す」
    // （再現の「保存して開き直す」：jsonToScore の中の finish で落ちていた）
    withBars(3);
    placeOnSecondVoice(0);
    placeOnSecondVoice(2);
    deleteSecondVoiceOf(2);
    rebuildBeforeRender(target.score);
    const counts = (score: model.Score): number[][] => bars(score).map((b) => b.voices.map((v) => v.beats.length));
    const beforeSave = counts(target.score);
    expect(shape()).toBe('2:1 1:-1 2:1');

    const doc = new SongDocument({ id: 'song-1', score: target.score, appMeta: createEmptyAppMetadata() });
    const file = doc.toFileJson(0);
    // 保存の後も、曲の中の形は保存の前と同じ
    expect(counts(target.score)).toEqual(beforeSave);
    expect(linksToMissingBeats()).toBe(0);

    let reopened: model.Score | undefined;
    expect(() => {
      reopened = SongDocument.fromFileJson(file).score;
    }).not.toThrow();
    expect(counts(reopened!)).toEqual(beforeSave);
    expect(linksToMissingBeats(reopened!)).toBe(0);
    // 2 つ目のボイスの休符の拍（音を消して残った拍）は外さない
    expect(bars(reopened!)[2]!.voices[1]!.beats[0]!.isEmpty).toBe(false);
    expect(() => rebuildBeforeRender(reopened!)).not.toThrow();
    expect(generateMidi(reopened!)).toBeGreaterThan(0);
  });
});

describe('EditingService.placeDigit（4.2 節の数字キーと 2 桁のフレット）', () => {
  let clock: number;
  const beat = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });
  const fretsOf = (stringNumber: number): (number | null)[] =>
    getVoice(getBar(target.score, 0, 0)).beats.map((b) => b.notes.find((n) => n.string === stringNumber)?.fret ?? null);

  beforeEach(() => {
    clock = 0;
    svc = new EditingService(
      target,
      cursor,
      new ValidationService(),
      history,
      reporter,
      undefined,
      stubConfirmer(),
      undefined,
      () => clock,
    );
  });

  it('EditingService_placeDigit_選んでいる弦のカーソルの拍にその数のフレットの音をすぐ置く', () => {
    // UT-EDIT-SVC-47 4.2 節「数字キー…を押すと、選んでいる弦の、カーソルの拍に、その数のフレットの音をすぐ置く（PlaceNoteCommand）」
    cursor.setString(4);
    svc.placeDigit(7);
    expect(fretsOf(4)).toEqual([7]);
    expect(cursor.position).toEqual(beat(1));
    expect(countUndoable(history)).toBe(1);
  });

  it('EditingService_placeDigit_1秒ちょうどで2桁が10から24_書き換えカーソルは動かさず1回の取り消しで全部戻る', () => {
    // UT-EDIT-SVC-48 4.2 節「置いてから 1 秒以内に次の数字を押し、前の数字と合わせた 2 桁が 10 から 24 になるときは…書き換える（SetNoteFretCommand）」・
    // 「書き換えた後も、カーソルは 1 つ目の数字で進んだ位置のまま動かさない」・「1 回の取り消しで 2 桁の入力が全部戻り」
    const before = scoreJson(target);
    svc.placeDigit(1);
    clock = TWO_DIGIT_FRET_WINDOW_MS;
    svc.placeDigit(2);
    expect(fretsOf(1)).toEqual([12]);
    expect(cursor.position).toEqual(beat(1));
    expect(countUndoable(history)).toBe(1);
    expect(reporter.reports).toEqual([]);
    svc.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('EditingService_placeDigit_1秒を過ぎて次の数字_新しい音として今のカーソルの拍に置く', () => {
    // UT-EDIT-SVC-49 4.2 節「1 秒を過ぎてから押したときは、新しい音として今のカーソルの拍に置く」・4.2 節の (b)「TWO_DIGIT_FRET_WINDOW_MS = 1000」
    expect(TWO_DIGIT_FRET_WINDOW_MS).toBe(1000);
    svc.placeDigit(1);
    clock = TWO_DIGIT_FRET_WINDOW_MS + 1;
    svc.placeDigit(2);
    expect(fretsOf(1)).toEqual([1, 2]);
    expect(cursor.position).toEqual(beat(2));
    expect(countUndoable(history)).toBe(2);
  });

  it.each([
    [1, 0, [10]],
    [2, 4, [24]],
    [2, 5, [2, 5]],
    [3, 5, [3, 5]],
    [0, 7, [0, 7]],
  ])('EditingService_placeDigit_%sの後に%s_2桁が10から24のときだけ書き換える', (first, second, expected) => {
    // UT-EDIT-SVC-50 4.2 節「2 桁が 10 から 24 にならないとき（3 の後の 5、0 の後の 7）と…は、新しい音として今のカーソルの拍に置く」
    svc.placeDigit(first);
    clock = 500;
    svc.placeDigit(second);
    expect(fretsOf(1)).toEqual(expected);
  });

  it('EditingService_placeDigit_書き換えた後の3つ目の数字_新しい音として置く', () => {
    // UT-EDIT-SVC-51 4.2 節の (b)「別のコマンドを出したときは、覚えを捨てる」・「自分が出した PlaceNoteCommand の知らせで捨てた後に、置いた音符を覚え直す」
    // （覚え直すのは PlaceNoteCommand のときだけなので、SetNoteFretCommand の知らせで捨てた後は覚えが無い）
    svc.placeDigit(1);
    svc.placeDigit(2);
    svc.placeDigit(3);
    expect(fretsOf(1)).toEqual([12, 3]);
    expect(cursor.position).toEqual(beat(2));
  });

  it('EditingService_placeDigit_和音の入力の途中_同じ拍の音を書き換える', () => {
    // UT-EDIT-SVC-52 4.2 節「置いた音のフレットをその 2 桁に書き換える」・4.7 節「ボタンが入っている間は…音を置いてもカーソルを次の拍へ進めない」
    cursor.enterChordInput();
    svc.placeDigit(1);
    svc.placeDigit(5);
    expect(fretsOf(1)).toEqual([15]);
    expect(cursor.position).toEqual(beat(0));
  });

  it('EditingService_placeDigit_次の数字の前に覚えを捨てる操作_書き換えず新しい音として扱う', () => {
    // UT-EDIT-SVC-53 4.2 節の (b)「カーソルを動かす・音価を選ぶ・別のコマンドを出したときは、覚えを捨てる」・
    // 「← とクリックのように CursorController を直に呼ぶ動きと、ほかの窓口が出したコマンドでも捨てる」
    const inputs: [string, () => void][] = [
      ['クリック（同じ位置）', () => cursor.setPosition(cursor.position)],
      ['←', () => cursor.moveByBeat(target, -1)],
      ['弦を変える', () => cursor.setString(2)],
      ['音価を選ぶ（EditingService）', () => svc.setDuration(DEFAULT_DURATION_SPEC)],
      ['音価を選ぶ（CursorController）', () => cursor.setDuration(DEFAULT_DURATION_SPEC)],
      ['別の窓口のコマンド', () => history.execute(new PlaceNoteCommand(target, beat(1), 6, 0, DEFAULT_DURATION_SPEC))],
      ['取り消しとやり直し', () => (svc.undo(), svc.redo())],
    ];
    for (const [name, input] of inputs) {
      svc.placeDigit(1);
      input();
      svc.placeDigit(2);
      // 拍 0 の弦 1 の音は 1 のまま（12 に書き換えない）
      expect(fretsOf(1)[0], name).toBe(1);
      target = buildEditTarget();
      cursor = new CursorController();
      history = new CommandHistory(render, reporter);
      svc = new EditingService(
        target,
        cursor,
        new ValidationService(),
        history,
        reporter,
        undefined,
        stubConfirmer(),
        undefined,
        () => clock,
      );
    }
  });

  it('EditingService_placeDigit_置くのを確かめで拒む_覚えずカーソルも動かさない', () => {
    // UT-EDIT-SVC-54 4.2 節「確かめで拒んだときは動かさない」・5 節「拒むときは…知らせ、コマンドを出さない」
    svc.placeDigit(1);
    cursor.setPosition(beat(0));
    svc.placeDigit(3); // 同じ弦に音符があり EDIT-001
    expect(reporter.reports.map((r) => r.code)).toEqual(['EDIT-001']);
    cursor.setPosition(beat(1));
    svc.placeDigit(0.5); // 覚えが無いので書き換えず、新しい音としても EDIT-002
    expect(reporter.reports.map((r) => r.code)).toEqual(['EDIT-001', 'EDIT-002']);
    svc.placeDigit(1);
    svc.placeDigit(0.5); // 2 桁が整数にならないので書き換えない
    expect(fretsOf(1)).toEqual([1, 1]);
    expect(reporter.reports.map((r) => r.code)).toEqual(['EDIT-001', 'EDIT-002', 'EDIT-002']);
  });

  it('EditingService_placeDigit_書き換えた後_書き換えた音符でタイの候補を求め直す', () => {
    // UT-EDIT-SVC-55 4.2 節の (b)「利用者には 1 つの音を置いた操作に見える」・6 節「EditingService が音を置いた直後に求めて覚え」
    svc.placeNote(1, 12);
    svc.placeDigit(1);
    expect(svc.tieCandidate()).toBeNull();
    svc.placeDigit(2);
    expect(svc.tieCandidate()).toEqual({ position: beat(0), stringNumber: 1 });
  });

  describe('覚えを捨てる知らせが届かないまま、カーソルの位置か弦だけが変わったとき', () => {
    /** onChange に登録しても知らせないカーソル（捨て損ねた状態を作るため。動き自体は CursorController のまま）。 */
    class SilentCursorController extends CursorController {
      override onChange(): () => void {
        return () => undefined;
      }
    }
    let silent: SilentCursorController;

    beforeEach(() => {
      silent = new SilentCursorController();
      svc = new EditingService(
        target,
        silent,
        new ValidationService(),
        history,
        reporter,
        undefined,
        stubConfirmer(),
        undefined,
        () => clock,
      );
    });

    it('EditingService_placeDigit_窓の内でもカーソルの位置が置いた直後と違う_書き換えず新しい音として置く', () => {
      // UT-EDIT-SVC-109 4.2 節の (b)「前の数字を押した時刻…と、置いた音符の位置と弦を覚えておき、次の数字のときに比べる」
      silent.enterChordInput();
      svc.placeDigit(1);
      expect(silent.position).toEqual(beat(0));
      silent.setPosition(beat(1));
      clock = 500;
      svc.placeDigit(2);
      expect(fretsOf(1)).toEqual([1, 2]);
      expect(countUndoable(history)).toBe(2);
    });

    it('EditingService_placeDigit_窓の内でも選んでいる弦が置いた音符の弦と違う_書き換えず新しい音として置く', () => {
      // UT-EDIT-SVC-110 4.2 節の (b)「前の数字を押した時刻…と、置いた音符の位置と弦を覚えておき、次の数字のときに比べる」
      svc.placeDigit(1);
      silent.setString(2);
      clock = 500;
      svc.placeDigit(2);
      expect(fretsOf(1)).toEqual([1, null]);
      expect(fretsOf(2)).toEqual([null, 2]);
      expect(silent.position).toEqual(beat(2));
    });
  });

  it('EditingService_時計を渡さない_Date.nowで窓を測る', () => {
    // UT-EDIT-SVC-63 4.2 節の (b)「前の数字を押した時刻（注入した時計の now(): number）」（渡さないときの時計）
    const now = vi.spyOn(Date, 'now');
    svc = new EditingService(target, cursor, new ValidationService(), history, reporter, undefined, stubConfirmer());
    now.mockReturnValue(10_000);
    svc.placeDigit(1);
    now.mockReturnValue(10_000 + TWO_DIGIT_FRET_WINDOW_MS + 1);
    svc.placeDigit(2);
    now.mockReturnValue(10_000 + TWO_DIGIT_FRET_WINDOW_MS + 2);
    svc.placeDigit(3);
    expect(fretsOf(1)).toEqual([1, 23]);
    expect(now).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });

  it('EditingService_placeDigit_最後の小節を1つ目の数字で埋めて小節を足した後の2つ目_足した小節のまとまりに重ね1回の取り消しとやり直しで両方', () => {
    // UT-EDIT-SVC-76 4.2 節「書き換えは、前の PlaceNoteCommand と履歴の 1 つの項目にまとめる（…その PlaceNoteCommand と InsertBarCommand を
    //   まとめた CompositeCommand（531 行）のときだけ真を返す）。1 回の取り消しで 2 桁の入力が全部戻り」・「書き換えた後も、カーソルは
    //   1 つ目の数字で進んだ位置のまま動かさない」
    for (const fret of [5, 6, 7]) svc.placeNote(3, fret);
    const before = scoreJson(target);
    const undoable = countUndoable(history);
    svc.placeDigit(1);
    expect(target.score.masterBars).toHaveLength(2);
    clock = 500;
    svc.placeDigit(2);
    expect(fretsOf(1)).toEqual([null, null, null, 12]);
    expect(target.score.masterBars).toHaveLength(2);
    expect(cursor.position).toEqual({ trackIndex: 0, barIndex: 1, voiceIndex: 0, beatIndex: 0 });
    expect(countUndoable(history)).toBe(undoable + 1);
    svc.undo();
    expect(scoreJson(target)).toBe(before);
    expect(target.score.masterBars).toHaveLength(1);
    // やり直しは足した小節を作り直すので、拍と小節の中身で確かめる（作り直した Bar の id は変わる）
    svc.redo();
    expect(fretsOf(1)).toEqual([null, null, null, 12]);
    expect(target.score.masterBars).toHaveLength(2);
  });

  it('EditingService_placeDigit_パートが2つの曲で1と2を打つ_小節を足したまとまりに重ねたら両方のパートを描き直し置いただけなら今のパートだけ', () => {
    // UT-EDIT-SVC-81 4.2 節「SetNoteFretCommand…affectedTrackIndices は [position.trackIndex]。CompositeCommand に重ねたあとは、取り込んだ
    //   まとまりの affectedTrackIndices との和集合」・2.3 節「affectedTrackIndices は children の和集合」
    target = buildEditTarget(2);
    svc = new EditingService(
      target,
      cursor,
      new ValidationService(),
      history,
      reporter,
      undefined,
      stubConfirmer(),
      undefined,
      () => clock,
    );
    const applied: (readonly number[])[] = [];
    history.onCommandApplied((event) => applied.push(event.affectedTrackIndices));

    // 最後の小節の最後の拍で 1 を置いて小節が足され、2 で 2 桁目が重なる
    for (const fret of [5, 6, 7]) svc.placeNote(3, fret);
    svc.placeDigit(1);
    expect(target.score.masterBars).toHaveLength(2);
    svc.placeDigit(2);
    expect(fretsOf(1)).toEqual([null, null, null, 12]);
    expect(applied.at(-1)).toEqual([0, 1]);
    expect(render.calls.at(-1)).toEqual([0, 1]);
    svc.undo();
    expect(target.score.masterBars).toHaveLength(1);
    expect(applied.at(-1)).toEqual([0, 1]);
    expect(render.calls.at(-1)).toEqual([0, 1]);

    // 小節を足さない所（最初の拍）で 1 と 2 を打つと、重ねる相手は置いた音符だけで、今のパートだけのまま
    cursor.setPosition(beat(0));
    svc.placeDigit(1);
    svc.placeDigit(2);
    expect(fretsOf(1)).toEqual([12, null, null]);
    expect(applied.at(-1)).toEqual([0]);
    expect(render.calls.at(-1)).toEqual([0]);
  });
});

describe('EditingService.setDuration（範囲が無いときの確かめ、4.3 節）', () => {
  it('EditingService_setDurationで範囲が無く弾かれる_barIndexを入れずに知らせ今の入力音価を変えない', () => {
    // UT-EDIT-SVC-56 4.3 節「入力ツールバーの連符の「任意」の欄…に入れた数を確かめて弾かれたときは barIndex を入れず」・「発行の前に ValidationService.validateBeatDuration(spec) で確かめる」
    svc.setDuration({ duration: model.Duration.Eighth, dots: 0, tuplet: tupletSpecFor(13) });
    expect(reporter.reports.at(-1)).toEqual({ code: 'EDIT-016', context: { tupletNumerator: 13 } });
    svc.setDuration({ duration: model.Duration.Eighth, dots: 3 as 0, tuplet: null });
    expect(reporter.reports.at(-1)).toEqual({ code: 'EDIT-012', context: { dots: 3 } });
    expect(cursor.currentDuration).toEqual(DEFAULT_DURATION_SPEC);
    expect(countUndoable(history)).toBe(0);

    const quintuplet: BeatDurationSpec = { duration: model.Duration.Sixteenth, dots: 0, tuplet: tupletSpecFor(5) };
    svc.setDuration(quintuplet);
    expect(cursor.currentDuration).toEqual(quintuplet);
    expect(reporter.reports).toHaveLength(2);
    expect(countUndoable(history)).toBe(0);
  });
});

describe('EditingService.stepRight（→ キー、4.1 節・4.4 節）', () => {
  const at = (barIndex: number, beatIndex: number): CursorPosition => ({
    trackIndex: 0,
    barIndex,
    voiceIndex: 0,
    beatIndex,
  });
  const beatCount = (barIndex: number): number => getVoice(getBar(target.score, 0, barIndex)).beats.length;
  /**
   * 1 小節目を 4 分音符 4 つで埋め、曲の最後の小節のままにする。「和音」ボタンを入れて置くと、置いたときには小節を足さない
   * （4.7 節の (b)「最後の小節が和音で埋まり、確定で小節を足すときは」）ので、ボタンを入れて置き、途中の印を手で動かして捨ててから切る。
   */
  const fillLastBarWithQuarters = (): void => {
    cursor.enterChordInput();
    for (const fret of [1, 2, 3, 4]) {
      cursor.setPosition(at(0, fret - 1));
      svc.placeNote(3, fret);
    }
    cursor.setPosition(at(0, 0));
    cursor.exitChordInput(target);
    expect(beatCount(0)).toBe(4);
    expect(target.score.masterBars.length).toBe(1);
  };

  it('EditingService_stepRightで最後の拍の後ろに空きがある_今の入力音価の休符を置いて進む', () => {
    // UT-EDIT-SVC-57 4.1 節「カーソルが小節の最後の拍の後ろ（beatIndex が beats.length）にいるとき、小節に空きがあれば、そこに今の入力音価の休符を置いて進む（InsertRestCommand）」
    svc.placeNote(3, 5);
    cursor.setDuration({ duration: model.Duration.Eighth, dots: 0, tuplet: null });
    expect(cursor.position).toEqual(at(0, 1));
    svc.stepRight();
    const rest = getBeat(target.score, 0, 0, 1);
    expect(rest.notes).toHaveLength(0);
    expect(rest.duration).toBe(model.Duration.Eighth);
    expect(cursor.position).toEqual(at(0, 2));
    expect(countUndoable(history)).toBe(2);
  });

  it('EditingService_stepRightで最後の拍より前と空きのある最後の拍_コマンドを出さず次の拍と最後の拍の後ろへ', () => {
    // UT-EDIT-SVC-58 4.1 節の (b)「→ は、小節の最後の拍にいるときは、空きがあれば最後の拍の後ろへ…それより前の拍では、同じ小節の次の拍へ移る」
    svc.placeNote(3, 5);
    svc.placeNote(3, 7);
    cursor.setPosition(at(0, 0));
    const before = countUndoable(history);
    svc.stepRight();
    expect(cursor.position).toEqual(at(0, 1));
    svc.stepRight();
    expect(cursor.position).toEqual(at(0, 2));
    expect(countUndoable(history)).toBe(before);
    expect(beatCount(0)).toBe(2);
  });

  it('EditingService_stepRightで埋まった小節の次に小節がある_次の小節の頭へ移り小節を足さない', () => {
    // UT-EDIT-SVC-59 4.1 節「埋まっていれば次の小節の頭へ移り」
    svc.insertBar(1);
    const bars = target.score.masterBars.length;
    cursor.setPosition(at(0, 0)); // 全音符の休符の拍 1 つで埋まっている
    svc.stepRight();
    expect(cursor.position).toEqual(at(1, 0));
    expect(target.score.masterBars.length).toBe(bars);
  });

  it('EditingService_stepRightで埋まった最後の小節_InsertBarCommandの1つの項目で小節を足してその頭へ移り1回の取り消しで戻る', () => {
    // UT-EDIT-SVC-60 4.1 節「最後の小節なら上と同じく小節を 1 つ足して移る（足すのは InsertBarCommand の 1 つの履歴の項目で、1 回の取り消しで戻る）」
    const execute = vi.spyOn(history, 'execute');
    const before = scoreJson(target);
    // 拍 0（最後の拍）と、最後の拍の後ろの両方で足す
    svc.stepRight();
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(InsertBarCommand);
    expect(target.score.masterBars.length).toBe(2);
    expect(cursor.position).toEqual(at(1, 0));
    expect(countUndoable(history)).toBe(1);
    svc.undo();
    expect(scoreJson(target)).toBe(before);

    fillLastBarWithQuarters();
    cursor.setPosition(at(0, 4));
    svc.stepRight();
    expect(target.score.masterBars.length).toBe(2);
    expect(cursor.position).toEqual(at(1, 0));
  });

  it('EditingService_stepRightで小節を足す確かめが拒む_知らせて小節を足さずカーソルを動かさない', () => {
    // UT-EDIT-SVC-61 4.8 節「どのメソッドも、確かめ（5 節）で拒むときは report で知らせてコマンドを出さず」・5 節の表の EDIT-003 の行
    class FullValidation extends ValidationService {
      override validateBarInsertion(): ReturnType<ValidationService['validateBarInsertion']> {
        return { ok: false, code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048 } };
      }
    }
    svc = new EditingService(target, cursor, new FullValidation(), history, reporter, undefined, stubConfirmer());
    svc.stepRight();
    expect(reporter.reports).toEqual([
      { code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048, trackIndex: 0, barIndex: 0 } },
    ]);
    expect(target.score.masterBars.length).toBe(1);
    expect(cursor.position).toEqual(at(0, 0));
  });

  it('EditingService_stepRightで和音の入力の途中_次の拍へ移り途中の印を残さない', () => {
    // UT-EDIT-SVC-62 4.7 節「和音の入力を終える（確定する）操作は…→ キー（EditingService.stepRight）」・(b)「→ で確定したときは、ボタンを入れたままにし」
    cursor.enterChordInput();
    svc.placeNote(3, 5);
    svc.placeNote(2, 7);
    expect(cursor.position).toEqual(at(0, 0));
    svc.stepRight();
    expect(cursor.position).toEqual(at(0, 1));
    expect(cursor.chordInputMode).toBe(true);
    // 途中の印は残っていないので、ボタンを切っても動かない
    cursor.exitChordInput(target);
    expect(cursor.position).toEqual(at(0, 1));
  });

  /**
   * 1 小節目を 4 分音符 4 つで埋める（「和音」ボタンを切ったまま）。最後の小節が埋まるので、4 つ目を置いたときに小節が 1 つ足される
   * （4.1 節）。
   */
  const fillFirstBarWithQuarters = (): void => {
    for (const fret of [1, 2, 3, 4]) {
      cursor.setPosition(at(0, fret - 1));
      svc.placeNote(3, fret);
    }
    expect(beatCount(0)).toBe(4);
    expect(target.score.masterBars.length).toBe(2);
  };
  /**
   * 埋まった 1 小節目の最後の拍（4 拍目）で、「和音」ボタンを入れて音を足す（和音の入力の途中にする）。途中の拍の和音は、小節が埋まって
   * いても同じ小節の次の拍へ進む（4.1 節「途中の拍に置いたときは…」。UT-EDIT-SVC-80）ので、ここでは最後の拍に置く。
   */
  const chordOnLastBeat = (): void => {
    cursor.setPosition(at(0, 3));
    cursor.enterChordInput();
    svc.placeNote(2, 7);
    expect(cursor.position).toEqual(at(0, 3));
    expect(getBeat(target.score, 0, 0, 3).notes).toHaveLength(2);
  };

  it('EditingService_stepRightで埋まった小節の最後の拍の和音を確定_次の小節の頭へ移りボタンは入ったまま', () => {
    // UT-EDIT-SVC-64 4.7 節「確定すると、和音の入力の途中なら、置いた拍から 1 つ進める。進め方は 4.1 節の、音を置いたときと同じとする
    // （小節が埋まれば次の小節の頭…）」・(b)「→ で確定したときは、ボタンを入れたままにし」
    fillFirstBarWithQuarters();
    chordOnLastBeat();
    const bars = target.score.masterBars.length;
    svc.stepRight();
    expect(cursor.position).toEqual(at(1, 0));
    expect(cursor.chordInputMode).toBe(true);
    expect(target.score.masterBars.length).toBe(bars);
    // 途中の印は残っていないので、ボタンを切っても動かない
    cursor.exitChordInput(target);
    expect(cursor.position).toEqual(at(1, 0));
  });

  it('EditingService_stepRightで埋まった最後の小節の最後の拍の和音を確定_小節を1つ足してその頭へ移り1回の取り消しで小節だけ戻る', () => {
    // UT-EDIT-SVC-65 4.7 節「進め方は 4.1 節の、音を置いたときと同じとする（…最後の小節なら小節を足す）」・4.1 節「足すのは InsertBarCommand の
    // 1 つの履歴の項目で、1 回の取り消しで戻る」・4.7 節の (b)「→ で確定したときは、ボタンを入れたままにし」
    fillLastBarWithQuarters();
    chordOnLastBeat();
    const beforeStep = scoreJson(target);
    const undoable = countUndoable(history);
    const execute = vi.spyOn(history, 'execute');
    svc.stepRight();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(InsertBarCommand);
    expect(target.score.masterBars.length).toBe(2);
    expect(cursor.position).toEqual(at(1, 0));
    expect(cursor.chordInputMode).toBe(true);
    expect(countUndoable(history)).toBe(undoable + 1);
    svc.undo();
    expect(scoreJson(target)).toBe(beforeStep);
    expect(getBeat(target.score, 0, 0, 3).notes).toHaveLength(2);
  });

  it('EditingService_stepRightで和音の途中で最後の小節を足す確かめが拒む_知らせて確定した和音の拍に留めボタンは入ったまま', () => {
    // UT-EDIT-SVC-66 4.8 節「どのメソッドも、確かめ（5 節）で拒むときは report で知らせてコマンドを出さず」・5 節の表の EDIT-003 の行・
    //   4.7 節の (b)「小節を足すことを EDIT-003 で拒んだときは、EDIT-003 を知らせ、カーソルは確定した和音の拍に留める（531 行とそろえる」
    class FullValidation extends ValidationService {
      override validateBarInsertion(): ReturnType<ValidationService['validateBarInsertion']> {
        return { ok: false, code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048 } };
      }
    }
    svc = new EditingService(target, cursor, new FullValidation(), history, reporter, undefined, stubConfirmer());
    fillLastBarWithQuarters();
    chordOnLastBeat();
    const undoable = countUndoable(history);
    svc.stepRight();
    expect(reporter.reports).toEqual([
      { code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048, trackIndex: 0, barIndex: 0 } },
    ]);
    expect(target.score.masterBars.length).toBe(1);
    expect(cursor.position).toEqual(at(0, 3));
    expect(cursor.chordInputMode).toBe(true);
    expect(countUndoable(history)).toBe(undoable);
    // 確定したので、もう和音の入力の途中ではなく、ボタンを切っても動かない
    cursor.exitChordInput(target);
    expect(cursor.position).toEqual(at(0, 3));
  });

  it('EditingService_stepRightでボタンが入っていて和音の途中でない_今までの→の動きのままでボタンは入ったまま', () => {
    // UT-EDIT-SVC-67 4.7 節「途中でなければ、ボタンを切っても音価を選んでも動かない（→ は 4.1 節のとおり動く）」・4.1 節の (b)
    fillFirstBarWithQuarters();
    cursor.setPosition(at(0, 1));
    cursor.enterChordInput();
    const undoable = countUndoable(history);
    // 埋まった小節の途中の拍では、同じ小節の次の拍へ（コマンドを出さない）
    svc.stepRight();
    expect(cursor.position).toEqual(at(0, 2));
    expect(cursor.chordInputMode).toBe(true);
    expect(countUndoable(history)).toBe(undoable);
    // 埋まった最後の小節の最後の拍では、今までどおり小節を足してその頭へ
    cursor.setPosition(at(1, 0));
    svc.stepRight();
    expect(target.score.masterBars.length).toBe(3);
    expect(cursor.position).toEqual(at(2, 0));
    expect(cursor.chordInputMode).toBe(true);
  });

  it('EditingService_stepRightでボタンが入っていて途中でなく空きがある_1回で休符を置いて次へ進み途中にしない', () => {
    // UT-EDIT-SVC-75 4.7 節「途中でなければ…（→ は 4.1 節のとおり動く）」・4.1 節「小節に空きがあれば、そこに今の入力音価の休符を置いて進む」
    //   ・4.7 節「置いた拍を「和音の入力の途中」として覚える」は音を置いたとき（休符は音ではない）
    svc.placeNote(3, 5);
    cursor.enterChordInput();
    expect(cursor.position).toEqual(at(0, 1));
    svc.stepRight();
    expect(getBeat(target.score, 0, 0, 1).notes).toHaveLength(0);
    expect(cursor.position).toEqual(at(0, 2));
    expect(cursor.chordInputMode).toBe(true);
    // 休符は途中として覚えていないので、もう 1 回の → でも次の休符を置いて進む
    svc.stepRight();
    expect(beatCount(0)).toBe(3);
    expect(cursor.position).toEqual(at(0, 3));
  });
});

describe('EditingService の最後の小節が埋まるときの小節の足し方と音価の選択での和音の確定（4.1 節・4.7 節）', () => {
  const at = (barIndex: number, beatIndex: number): CursorPosition => ({
    trackIndex: 0,
    barIndex,
    voiceIndex: 0,
    beatIndex,
  });
  const beatCount = (barIndex: number): number => getVoice(getBar(target.score, 0, barIndex)).beats.length;
  /** 1 小節目に 4 分音符を 3 つ置く（4 つ目で埋まる）。カーソルは拍 3。 */
  const placeThreeQuarters = (): void => {
    for (const fret of [1, 2, 3]) svc.placeNote(3, fret);
    expect(cursor.position).toEqual(at(0, 3));
    expect(target.score.masterBars.length).toBe(1);
  };

  it('EditingService_placeNoteで最後の小節が埋まる_置く音と小節を1つの項目にして足した小節の頭へ送り1回の取り消しとやり直しで両方', () => {
    // UT-EDIT-SVC-68 4.1 節「埋まったのが曲の最後の小節なら、小節を 1 つ足し（InsertBarCommand、10 節）、その頭へ送る」
    //   ・「置くコマンド（PlaceNoteCommand か InsertRestCommand）と InsertBarCommand を 1 つの CompositeCommand にまとめて発行する。
    //   1 回の取り消しで、置いた音か休符と、足した小節の両方が戻る」
    placeThreeQuarters();
    const before = scoreJson(target);
    const undoable = countUndoable(history);
    const execute = vi.spyOn(history, 'execute');
    svc.placeNote(3, 4);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(CompositeCommand);
    expect(target.score.masterBars.length).toBe(2);
    expect(getBeat(target.score, 0, 0, 3).notes.map((n) => n.fret)).toEqual([4]);
    expect(cursor.position).toEqual(at(1, 0));
    expect(countUndoable(history)).toBe(undoable + 1);
    svc.undo();
    expect(scoreJson(target)).toBe(before);
    expect(target.score.masterBars.length).toBe(1);
    expect(beatCount(0)).toBe(3);
    svc.redo();
    expect(target.score.masterBars.length).toBe(2);
    expect(getBeat(target.score, 0, 0, 3).notes.map((n) => n.fret)).toEqual([4]);
  });

  it('EditingService_insertRestで最後の小節が埋まる_休符と小節を1つの項目にして足した小節の頭へ送り1回の取り消しとやり直しで両方', () => {
    // UT-EDIT-SVC-69 4.1 節「EditingService.placeNote と insertRest は、置く前に最後の小節が埋まるかを数え、埋まるなら置くコマンド
    //   （PlaceNoteCommand か InsertRestCommand）と InsertBarCommand を 1 つの CompositeCommand にまとめて発行する」
    placeThreeQuarters();
    const before = scoreJson(target);
    const undoable = countUndoable(history);
    svc.insertRest();
    expect(target.score.masterBars.length).toBe(2);
    expect(getBeat(target.score, 0, 0, 3).notes).toHaveLength(0);
    expect(cursor.position).toEqual(at(1, 0));
    expect(countUndoable(history)).toBe(undoable + 1);
    svc.undo();
    expect(scoreJson(target)).toBe(before);
    svc.redo();
    expect(target.score.masterBars.length).toBe(2);
    expect(beatCount(0)).toBe(4);
  });

  it('EditingService_placeNoteとinsertRestで最後の小節が埋まらない_小節を足さず置くコマンドだけを出す', () => {
    // UT-EDIT-SVC-70 4.1 節「埋まっていなければ、同じ小節の次の拍（beatIndex + 1）へ進める」・「埋まるなら…まとめて発行する」の裏
    const execute = vi.spyOn(history, 'execute');
    svc.placeNote(3, 1);
    svc.insertRest();
    expect(execute.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'PlaceNoteCommand',
      'InsertRestCommand',
    ]);
    expect(target.score.masterBars.length).toBe(1);
    expect(cursor.position).toEqual(at(0, 2));
  });

  it('EditingService_placeNoteとinsertRestで最後の小節が埋まり小節を足す確かめが拒む_知らせて置くコマンドだけを出し置いた拍に留める', () => {
    // UT-EDIT-SVC-71 4.8 節「どのメソッドも、確かめ（5 節）で拒むときは report で知らせて」・5 節の表の EDIT-003 の行
    //   ・4.1 節「小節を足すことを EDIT-003（小節数の上限）で拒んだときは、EDIT-003 を知らせ、置くコマンドだけを発行して、
    //   カーソルは置いた拍に留める」
    class FullValidation extends ValidationService {
      override validateBarInsertion(): ReturnType<ValidationService['validateBarInsertion']> {
        return { ok: false, code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048 } };
      }
    }
    svc = new EditingService(target, cursor, new FullValidation(), history, reporter, undefined, stubConfirmer());
    placeThreeQuarters();
    const execute = vi.spyOn(history, 'execute');
    svc.placeNote(3, 4);
    expect(reporter.reports).toEqual([
      { code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048, trackIndex: 0, barIndex: 0 } },
    ]);
    expect(target.score.masterBars.length).toBe(1);
    expect(beatCount(0)).toBe(4);
    expect(cursor.position).toEqual(at(0, 3));
    svc.undo();
    expect(beatCount(0)).toBe(3);
    cursor.setPosition(at(0, 3));
    svc.insertRest();
    expect(reporter.reports).toHaveLength(2);
    expect(beatCount(0)).toBe(4);
    expect(getBeat(target.score, 0, 0, 3).notes).toHaveLength(0);
    expect(cursor.position).toEqual(at(0, 3));
    expect(execute.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'PlaceNoteCommand',
      'InsertRestCommand',
    ]);
  });

  it('EditingService_setDurationで和音の入力の途中_音価を変えて置いた拍から次の拍へ進めボタンは入ったまま', () => {
    // UT-EDIT-SVC-72 4.7 節「和音の入力を終える（確定する）操作は…音価を選ぶ（setDuration）」・「setDuration は…無ければ
    //   CursorController.setDuration(spec) で今の入力音価を変えたうえで、和音の入力の途中なら確定する」・(b)「音価を選んで確定したときと…
    //   ボタンを入れたままにし」
    cursor.enterChordInput();
    svc.placeNote(3, 5);
    svc.placeNote(2, 7);
    expect(cursor.position).toEqual(at(0, 0));
    const eighth: BeatDurationSpec = { duration: model.Duration.Eighth, dots: 0, tuplet: null };
    svc.setDuration(eighth);
    expect(cursor.currentDuration).toEqual(eighth);
    expect(cursor.position).toEqual(at(0, 1));
    expect(cursor.chordInputMode).toBe(true);
    // 確定したので途中の印は残っておらず、次の拍で続けて和音を入れられる
    svc.placeNote(3, 8);
    svc.placeNote(2, 10);
    expect(cursor.position).toEqual(at(0, 1));
    expect(getBeat(target.score, 0, 0, 1).notes).toHaveLength(2);
    expect(getBeat(target.score, 0, 0, 1).duration).toBe(model.Duration.Eighth);
  });

  it('EditingService_setDurationで和音の入力の途中でない_音価だけを変えカーソルは動かない', () => {
    // UT-EDIT-SVC-73 4.7 節「途中でなければ、ボタンを切っても音価を選んでも動かない」
    const eighth: BeatDurationSpec = { duration: model.Duration.Eighth, dots: 0, tuplet: null };
    cursor.enterChordInput();
    svc.setDuration(eighth);
    expect(cursor.position).toEqual(at(0, 0));
    expect(cursor.chordInputMode).toBe(true);
    cursor.exitChordInput(target);
    svc.placeNote(3, 5);
    expect(cursor.position).toEqual(at(0, 1));
    svc.setDuration(DEFAULT_DURATION_SPEC);
    expect(cursor.currentDuration).toEqual(DEFAULT_DURATION_SPEC);
    expect(cursor.position).toEqual(at(0, 1));
  });

  it('EditingService_setDurationで最後の小節が和音で埋まって確定_小節を足す項目を置いた音とは別に1つ積んで足した小節の頭へ', () => {
    // UT-EDIT-SVC-74 4.7 節「進め方は 4.1 節の、音を置いたときと同じとする（…最後の小節なら小節を足す）」・(b)「最後の小節が和音で埋まり、
    //   確定で小節を足すときは、InsertBarCommand を 1 つの履歴の項目として発行する（1 回の取り消しで戻る）」
    placeThreeQuarters();
    cursor.enterChordInput();
    svc.placeNote(3, 4);
    svc.placeNote(2, 6);
    expect(cursor.position).toEqual(at(0, 3));
    expect(target.score.masterBars.length).toBe(1);
    const undoable = countUndoable(history);
    const execute = vi.spyOn(history, 'execute');
    svc.setDuration(DEFAULT_DURATION_SPEC);
    expect(execute.mock.calls.map(([command]) => command)).toEqual([expect.any(InsertBarCommand)]);
    expect(target.score.masterBars.length).toBe(2);
    expect(cursor.position).toEqual(at(1, 0));
    expect(countUndoable(history)).toBe(undoable + 1);
    svc.undo();
    expect(target.score.masterBars.length).toBe(1);
    expect(getBeat(target.score, 0, 0, 3).notes).toHaveLength(2);
  });

  const HALF: BeatDurationSpec = { duration: model.Duration.Half, dots: 0, tuplet: null };
  /** 小節 barIndex のボイス 1 に、4 分の音・4 分の休符・4 分の音を置く（コマンドを直に履歴へ。3/4 で埋まっていない）。 */
  const noteRestNote = (barIndex: number): void => {
    history.execute(new PlaceNoteCommand(target, at(barIndex, 0), 3, 1, DEFAULT_DURATION_SPEC));
    history.execute(new InsertRestCommand(target, at(barIndex, 1), DEFAULT_DURATION_SPEC));
    history.execute(new PlaceNoteCommand(target, at(barIndex, 2), 3, 3, DEFAULT_DURATION_SPEC));
    expect(beatCount(barIndex)).toBe(3);
  };

  it('EditingService_最後の小節の途中の拍に置いて埋まる_小節を足さず同じ小節の次の拍へ', () => {
    // UT-EDIT-SVC-77 4.1 節「「埋まったら」は、置いた拍がその小節のそのボイスの最後の拍で、置いた後に小節が埋まっているときとする。
    //   途中の拍に置いたときは、小節が埋まっていても同じ小節の次の拍へ進める」・531 行（「埋まる」は同じ読み方）
    noteRestNote(0);
    const execute = vi.spyOn(history, 'execute');
    // 途中の休符の拍に 2 分の音を置くと 4/4 で埋まるが、置いた拍は最後の拍ではない
    cursor.setPosition(at(0, 1));
    cursor.setDuration(HALF);
    svc.placeNote(3, 5);
    expect(getBeat(target.score, 0, 0, 1).duration).toBe(model.Duration.Half);
    expect(target.score.masterBars.length).toBe(1);
    expect(cursor.position).toEqual(at(0, 2));
    // 途中の拍の前に休符を挿入して埋まっても（あふれても）、挿入した拍は最後の拍ではない
    cursor.setPosition(at(0, 1));
    cursor.setDuration(DEFAULT_DURATION_SPEC);
    svc.insertRest();
    expect(beatCount(0)).toBe(4);
    expect(target.score.masterBars.length).toBe(1);
    expect(cursor.position).toEqual(at(0, 2));
    expect(execute.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'PlaceNoteCommand',
      'InsertRestCommand',
    ]);
  });

  it('EditingService_最後でない埋まった小節の途中の拍に置く_次の小節の頭へ送らず同じ小節の次の拍へ', () => {
    // UT-EDIT-SVC-78 4.1 節「途中の拍に置いたときは、小節が埋まっていても同じ小節の次の拍へ進める」
    history.execute(new InsertBarCommand(target, 1));
    noteRestNote(0);
    cursor.setPosition(at(0, 1));
    cursor.setDuration(HALF);
    svc.placeNote(3, 5);
    expect(cursor.position).toEqual(at(0, 2));
    cursor.setPosition(at(0, 0));
    cursor.setDuration(DEFAULT_DURATION_SPEC);
    svc.insertRest();
    expect(cursor.position).toEqual(at(0, 1));
    expect(target.score.masterBars.length).toBe(2);
  });

  it('EditingService_最後の小節の最後の拍に置いて埋まる_小節を足しその頭へ', () => {
    // UT-EDIT-SVC-79 4.1 節「埋まったのが曲の最後の小節なら、小節を 1 つ足し（InsertBarCommand、10 節）、その頭へ送る」
    //   （最後の拍の後ろに足すときは UT-EDIT-SVC-68。ここは最後の拍そのもの〈休符の拍〉に置いて音価が変わり埋まるとき）
    history.execute(new PlaceNoteCommand(target, at(0, 0), 3, 1, DEFAULT_DURATION_SPEC));
    history.execute(new PlaceNoteCommand(target, at(0, 1), 3, 2, DEFAULT_DURATION_SPEC));
    history.execute(new InsertRestCommand(target, at(0, 2), DEFAULT_DURATION_SPEC));
    cursor.setPosition(at(0, 2));
    cursor.setDuration(HALF);
    const execute = vi.spyOn(history, 'execute');
    svc.placeNote(3, 5);
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(CompositeCommand);
    expect(target.score.masterBars.length).toBe(2);
    expect(cursor.position).toEqual(at(1, 0));
  });

  it('EditingService_埋まった最後の小節の途中の拍の和音を確定_小節を足さず同じ小節の次の拍へ', () => {
    // UT-EDIT-SVC-80 4.7 節「確定すると、和音の入力の途中なら、置いた拍から 1 つ進める。進め方は 4.1 節の、音を置いたときと同じとする」
    //   ・4.1 節「途中の拍に置いたときは、小節が埋まっていても同じ小節の次の拍へ進める」（→ と音価の選択の 2 つの確定）
    for (const beatIndex of [0, 1, 2, 3]) {
      history.execute(new PlaceNoteCommand(target, at(0, beatIndex), 3, beatIndex, DEFAULT_DURATION_SPEC));
    }
    cursor.enterChordInput();
    cursor.setPosition(at(0, 1));
    svc.placeNote(2, 7);
    expect(cursor.position).toEqual(at(0, 1));
    svc.stepRight();
    expect(cursor.position).toEqual(at(0, 2));
    svc.placeNote(2, 8);
    svc.setDuration(DEFAULT_DURATION_SPEC);
    expect(cursor.position).toEqual(at(0, 3));
    expect(target.score.masterBars.length).toBe(1);
    expect(getBeat(target.score, 0, 0, 1).notes).toHaveLength(2);
    expect(getBeat(target.score, 0, 0, 2).notes).toHaveLength(2);
  });
});

describe('EditingService.exitChordInput（「和音」のボタンを切る確定、4.7 節）', () => {
  const at = (barIndex: number, beatIndex: number): CursorPosition => ({
    trackIndex: 0,
    barIndex,
    voiceIndex: 0,
    beatIndex,
  });
  /** 1 小節目を 4 分音符 4 つで埋め、ボタンを入れて拍 `beatIndex` に和音の 2 つ目の音を置く（和音の入力の途中にする）。 */
  const chordOnFilledBar = (beatIndex: number): void => {
    for (const i of [0, 1, 2, 3]) {
      history.execute(new PlaceNoteCommand(target, at(0, i), 3, i, DEFAULT_DURATION_SPEC));
    }
    cursor.enterChordInput();
    cursor.setPosition(at(0, beatIndex));
    svc.placeNote(2, 7);
    expect(cursor.position).toEqual(at(0, beatIndex));
  };

  it('EditingService_exitChordInputで最後の小節の最後の拍の和音を確定_小節を1つの項目で足してその頭へ移りボタンは切れ1回の取り消しで小節だけ戻る', () => {
    // UT-EDIT-SVC-84 4.7 節「和音の入力を終える（確定する）操作は、ボタンを切る（exitChordInput）…の 3 つとする」・「確定すると、和音の入力の
    //   途中なら、置いた拍から 1 つ進める。進め方は 4.1 節の、音を置いたときと同じとする（小節が埋まれば次の小節の頭、最後の小節なら小節を足す）」
    //   ・4.7 節の (b)「最後の小節が和音で埋まり、確定で小節を足すときは、InsertBarCommand を 1 つの履歴の項目として発行する（1 回の取り消しで戻る）」
    chordOnFilledBar(3);
    const before = scoreJson(target);
    const undoable = countUndoable(history);
    const execute = vi.spyOn(history, 'execute');
    svc.exitChordInput();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(InsertBarCommand);
    expect(target.score.masterBars.length).toBe(2);
    expect(cursor.position).toEqual(at(1, 0));
    expect(cursor.chordInputMode).toBe(false);
    expect(countUndoable(history)).toBe(undoable + 1);
    svc.undo();
    expect(scoreJson(target)).toBe(before);
    expect(getBeat(target.score, 0, 0, 3).notes).toHaveLength(2);
  });

  it('EditingService_exitChordInputで和音の途中で最後の小節を足す確かめが拒む_EDIT-003を知らせて確定した和音の拍に留めボタンは切れる', () => {
    // UT-EDIT-SVC-85 4.7 節の (b)「小節を足すことを EDIT-003 で拒んだときは、EDIT-003 を知らせ、カーソルは確定した和音の拍に留める」
    class FullValidation extends ValidationService {
      override validateBarInsertion(): ReturnType<ValidationService['validateBarInsertion']> {
        return { ok: false, code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048 } };
      }
    }
    svc = new EditingService(target, cursor, new FullValidation(), history, reporter, undefined, stubConfirmer());
    chordOnFilledBar(3);
    const undoable = countUndoable(history);
    svc.exitChordInput();
    expect(reporter.reports).toEqual([
      { code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048, trackIndex: 0, barIndex: 0 } },
    ]);
    expect(target.score.masterBars.length).toBe(1);
    expect(cursor.position).toEqual(at(0, 3));
    expect(cursor.chordInputMode).toBe(false);
    expect(countUndoable(history)).toBe(undoable);
  });

  it('EditingService_exitChordInputで最後でない埋まった小節の最後の拍と途中の拍_次の小節の頭と同じ小節の次の拍へ進め小節を足さない', () => {
    // UT-EDIT-SVC-86 4.7 節「進め方は 4.1 節の、音を置いたときと同じとする（小節が埋まれば次の小節の頭…）」・4.1 節「途中の拍に置いたときは、
    //   小節が埋まっていても同じ小節の次の拍へ進める」
    history.execute(new InsertBarCommand(target, 1));
    chordOnFilledBar(3);
    svc.exitChordInput();
    expect(cursor.position).toEqual(at(1, 0));
    expect(target.score.masterBars.length).toBe(2);
    cursor.enterChordInput();
    cursor.setPosition(at(0, 1));
    svc.placeNote(2, 8);
    svc.exitChordInput();
    expect(cursor.position).toEqual(at(0, 2));
    expect(target.score.masterBars.length).toBe(2);
    expect(cursor.chordInputMode).toBe(false);
  });

  it('EditingService_exitChordInputで和音の入力の途中でない_ボタンを切るだけでカーソルは動かずコマンドを出さない', () => {
    // UT-EDIT-SVC-87 4.7 節「途中でなければ、ボタンを切っても音価を選んでも動かない」
    chordOnFilledBar(3);
    cursor.setPosition(at(0, 3));
    const execute = vi.spyOn(history, 'execute');
    svc.exitChordInput();
    expect(cursor.position).toEqual(at(0, 3));
    expect(cursor.chordInputMode).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('EditingService.moveNote（音符を動かす、4.6 節）', () => {
  const EIGHTH: BeatDurationSpec = { duration: model.Duration.Eighth, dots: 0, tuplet: null };
  const at = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });
  const ref = (beatIndex: number, stringNumber: number): NoteRef => ({ position: at(beatIndex), stringNumber });
  /** 1 小節目の拍 0〜3 に、弦 3 のフレット 10〜13 の 4 分音符を置く。 */
  const placeFourQuarters = (): void => {
    for (const i of [0, 1, 2, 3]) {
      history.execute(new PlaceNoteCommand(target, at(i), 3, i + 10, DEFAULT_DURATION_SPEC));
    }
  };

  it('EditingService_moveNoteで別の拍の別の弦へ動かす_move-noteのまとまり1つでフレットを保ち元の拍は同じ長さの休符で残り1回の取り消しで戻る', () => {
    // UT-EDIT-SVC-88 4.6 節「EditingService.moveNote(from: NoteRef, to: NoteRef) が、元の音符を消す DeleteNotesCommand と、行き先に置く
    //   PlaceNoteCommand を CompositeCommand（kind は 'move-note'）にまとめて出す。1 回の取り消しで元に戻る」・「別の弦へ動かしたときは、
    //   フレットの数を保つ」・「動かした結果、元の拍に音が残らないときは、その拍を同じ長さの休符の拍として残す」
    placeFourQuarters();
    const before = scoreJson(target);
    const undoable = countUndoable(history);
    const execute = vi.spyOn(history, 'execute');
    svc.moveNote(ref(1, 3), ref(2, 2));
    expect(execute).toHaveBeenCalledTimes(1);
    const command = execute.mock.calls[0]![0] as CompositeCommand;
    expect(command).toBeInstanceOf(CompositeCommand);
    expect(command.kind).toBe('move-note');
    expect(command.children.map((child) => child.constructor)).toEqual([DeleteNotesCommand, PlaceNoteCommand]);
    expect(countUndoable(history)).toBe(undoable + 1);
    expect(getVoice(getBar(target.score, 0, 0)).beats).toHaveLength(4);
    const source = getBeat(target.score, 0, 0, 1);
    expect(source.notes).toHaveLength(0);
    expect(source.duration).toBe(model.Duration.Quarter);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 2), 2)?.fret).toBe(11);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 2), 3)?.fret).toBe(12);
    expect(reporter.reports).toEqual([]);
    svc.undo();
    expect(scoreJson(target)).toBe(before);
  });

  it('EDIT-001: 音符を動かす行き先の同じ拍の同じ弦に音符がある', () => {
    // UT-EDIT-SVC-89 4.6 節「行き先の同じ拍・同じ弦に音符があるときは EDIT-001 で拒み、動かさない（5 節）」・4.8 節「確かめ（5 節）で拒むときは
    //   report で知らせてコマンドを出さず（例外を投げない）」
    placeFourQuarters();
    const before = scoreJson(target);
    const execute = vi.spyOn(history, 'execute');
    expect(() => svc.moveNote(ref(1, 3), ref(2, 3))).not.toThrow();
    expect(reporter.reports.map((r) => r.code)).toEqual(['EDIT-001']);
    expect(execute).not.toHaveBeenCalled();
    expect(scoreJson(target)).toBe(before);
  });

  it('EditingService_moveNoteで同じ拍の別の弦へ動かす_拍の長さを変えずに弦だけ替え元と同じ所や音符の無い所からは何もしない', () => {
    // UT-EDIT-SVC-90 4.6 節「行き先は、ドラッグを離した所の拍と弦とする」・「別の弦へ動かしたときは、フレットの数を保つ」
    placeFourQuarters();
    svc.moveNote(ref(1, 3), ref(1, 5));
    const beat = getBeat(target.score, 0, 0, 1);
    expect(beat.notes.map((note) => [note.string, note.fret])).toEqual([[5, 11]]);
    expect(beat.duration).toBe(model.Duration.Quarter);
    expect(getVoice(getBar(target.score, 0, 0)).beats).toHaveLength(4);
    const after = scoreJson(target);
    const execute = vi.spyOn(history, 'execute');
    svc.moveNote(ref(1, 5), ref(1, 5));
    svc.moveNote(ref(1, 3), ref(2, 2));
    svc.moveNote(ref(9, 3), ref(2, 2));
    expect(execute).not.toHaveBeenCalled();
    expect(reporter.reports).toEqual([]);
    expect(scoreJson(target)).toBe(after);
  });

  it('EditingService_moveNoteで休符の拍と拍の無い所へ動かす_休符の拍は自分の長さのまま拍の無い所は元の拍の長さで置く', () => {
    // UT-EDIT-SVC-91 4.6 節「行き先は、ドラッグを離した所の拍と弦とする」・4.5 節「拍の長さを変えずに休符の拍…にする」
    history.execute(new PlaceNoteCommand(target, at(0), 3, 5, DEFAULT_DURATION_SPEC));
    history.execute(new InsertRestCommand(target, at(1), EIGHTH));
    svc.moveNote(ref(0, 3), ref(1, 2));
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(0);
    expect(getBeat(target.score, 0, 0, 0).duration).toBe(model.Duration.Quarter);
    expect(getBeat(target.score, 0, 0, 1).duration).toBe(model.Duration.Eighth);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 1), 2)?.fret).toBe(5);
    svc.moveNote(ref(1, 2), ref(2, 1));
    expect(getVoice(getBar(target.score, 0, 0)).beats).toHaveLength(3);
    expect(getBeat(target.score, 0, 0, 2).duration).toBe(model.Duration.Eighth);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 2), 1)?.fret).toBe(5);
  });

  it('EditingService_moveNote_出すCompositeCommandの履歴の名前はmove-note', () => {
    // UT-EDIT-SVC-100 4.6 節「履歴の名前（label）も 'move-note' とし（2.6 節の CommandLabelId の並びに足し」
    placeFourQuarters();
    const execute = vi.spyOn(history, 'execute');
    svc.moveNote(ref(1, 3), ref(2, 2));
    const command = execute.mock.calls[0]![0] as CompositeCommand;
    expect(command.kind).toBe('move-note');
    expect(command.label).toBe('move-note');
  });
});

describe('EditingService.setBeatTechnique（Beat の奏法記号、4.8 節・7.3 節）', () => {
  it('EditingService_setBeatTechnique_カーソルの拍のBeatの奏法記号をSetBeatTechniqueCommandで変え取り消しで戻る', () => {
    // UT-EDIT-SVC-92 editing-core.md 4.8 節「setBeatTechnique(patch: BeatTechniquePatch): void;」
    svc.placeNote(3, 5);
    cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    const execute = vi.spyOn(history, 'execute');
    svc.setBeatTechnique({ slap: true });
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(SetBeatTechniqueCommand);
    expect(getBeat(target.score, 0, 0, 0).slap).toBe(true);
    svc.undo();
    expect(getBeat(target.score, 0, 0, 0).slap).toBe(false);
  });
});

describe('EditingService の音のある拍に足す和音と小節を足せないときのカーソル（4.1 節・4.2 節・4.7 節、277・283・286 番の決め直し）', () => {
  const at = (barIndex: number, beatIndex: number): CursorPosition => ({
    trackIndex: 0,
    barIndex,
    voiceIndex: 0,
    beatIndex,
  });
  const beatCount = (barIndex: number): number => getVoice(getBar(target.score, 0, barIndex)).beats.length;
  class FullValidation extends ValidationService {
    override validateBarInsertion(): ReturnType<ValidationService['validateBarInsertion']> {
      return { ok: false, code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048 } };
    }
  }
  const EDIT_003_REPORT = {
    code: 'EDIT-003',
    context: { current: 2048, count: 1, max: 2048, trackIndex: 0, barIndex: 0 },
  };
  /** 1 小節目の拍 0 から count - 1 に、弦 3 のフレット 0 からの 4 分音符を置く（コマンドを直に履歴へ）。 */
  const quarters = (count: number, barIndex = 0): void => {
    for (let i = 0; i < count; i++) {
      history.execute(new PlaceNoteCommand(target, at(barIndex, i), 3, i, DEFAULT_DURATION_SPEC));
    }
  };

  it('EditingService_ボタンが切れていて音のある拍に別の弦の音を足す_カーソルをその拍に留め休符の拍と最後の拍の後ろでは進む', () => {
    // UT-EDIT-SVC-93 4.2 節「音のある拍に別の弦の音を足して和音にしたとき（4.7 節）は、「和音」ボタンが切れていても、カーソルをその拍に留める」
    //   ・4.7 節「ただし、音のある拍に別の弦の音を足して和音にしたときは、ボタンが切れていても進めない」
    //   ・(b)「PlaceNoteCommand の戻り値を 'beat' のままにし」
    svc.placeNote(3, 5);
    svc.placeNote(3, 7);
    expect(cursor.position).toEqual(at(0, 2));
    cursor.setPosition(at(0, 0));
    const execute = vi.spyOn(history, 'execute');
    svc.placeNote(2, 8);
    expect(cursor.position).toEqual(at(0, 0));
    expect(execute.mock.results[0]!.value).toEqual(expect.objectContaining({ cursorAdvance: 'beat' }));
    // 続けて 3 本目の弦に足しても、同じ拍に留まる
    svc.placeNote(1, 10);
    expect(cursor.position).toEqual(at(0, 0));
    expect(
      getBeat(target.score, 0, 0, 0)
        .notes.map((n) => n.string)
        .sort(),
    ).toEqual([1, 2, 3]);
    expect(beatCount(0)).toBe(2);
    expect(cursor.chordInputMode).toBe(false);
    // 最後の拍の後ろに置くとき（上の 2 つ目の音）と、休符の拍に置くときは今のまま進む
    cursor.setPosition(at(0, 2));
    svc.insertRest();
    cursor.setPosition(at(0, 2));
    svc.placeNote(2, 3);
    expect(cursor.position).toEqual(at(0, 3));
    expect(getBeat(target.score, 0, 0, 2).notes).toHaveLength(1);
  });

  it('EditingService_ボタンが切れていて埋まった小節の最後の拍に足して和音にする_次の小節へ送らず小節も足さず置くコマンドだけを出す', () => {
    // UT-EDIT-SVC-94 4.2 節「拍の音価が変わらないので、小節が埋まっていても次の小節へ送らず、小節も足さない」
    //   ・4.1 節の小節を足す CompositeCommand にしない（最後の拍に足して和音にしても、小節を足さない）
    quarters(4);
    cursor.setPosition(at(0, 3));
    const execute = vi.spyOn(history, 'execute');
    svc.placeNote(2, 7);
    expect(execute.mock.calls.map(([command]) => command.constructor.name)).toEqual(['PlaceNoteCommand']);
    expect(target.score.masterBars.length).toBe(1);
    expect(cursor.position).toEqual(at(0, 3));
    expect(getBeat(target.score, 0, 0, 3).notes).toHaveLength(2);
    // 最後でない埋まった小節の最後の拍でも、次の小節の頭へ送らない
    history.execute(new InsertBarCommand(target, 1));
    cursor.setPosition(at(0, 3));
    svc.placeNote(1, 9);
    expect(cursor.position).toEqual(at(0, 3));
    expect(target.score.masterBars.length).toBe(2);
  });

  it('EditingService_placeDigitでボタンが切れていて音のある拍に別の弦の音を足す_1桁目で留まり2桁目の書き換えでも動かない', () => {
    // UT-EDIT-SVC-95 4.2 節の (b)「EditingService.placeNote と placeDigit が、ボタンが切れていて、置く前の拍に音があり、置く弦に音が無いときに
    //   applyOutcome を呼ばない」・4.2 節「書き換えた後も、カーソルは 1 つ目の数字で進んだ位置のまま動かさない」
    let clock = 0;
    svc = new EditingService(
      target,
      cursor,
      new ValidationService(),
      history,
      reporter,
      undefined,
      stubConfirmer(),
      undefined,
      () => clock,
    );
    quarters(1);
    cursor.setPosition(at(0, 0));
    cursor.setString(2);
    const undoable = countUndoable(history);
    svc.placeDigit(1);
    expect(cursor.position).toEqual(at(0, 0));
    clock = 500;
    svc.placeDigit(2);
    expect(cursor.position).toEqual(at(0, 0));
    expect(findNoteOnString(getBeat(target.score, 0, 0, 0), 2)?.fret).toBe(12);
    expect(countUndoable(history)).toBe(undoable + 1);
  });

  it('EditingService_ボタンが入っていて音のある拍に足す_今までどおり途中の印を覚えて確定で進む', () => {
    // UT-EDIT-SVC-96 4.2 節の (b)「ボタンが入っているときは 642 行のとおり applyOutcome が途中の印を覚える」
    //   ・「戻り値を 'none' にすると、ボタンが入っているときに音のある拍へ足した音で途中の印が付かず、確定しても進まなくなる」
    quarters(2);
    cursor.enterChordInput();
    cursor.setPosition(at(0, 0));
    svc.placeNote(2, 7);
    expect(cursor.position).toEqual(at(0, 0));
    svc.exitChordInput();
    expect(cursor.position).toEqual(at(0, 1));
  });

  it('EditingService_setDurationの和音の確定で最後の小節を足す確かめが拒む_EDIT-003を知らせて確定した和音の拍に留めボタンは入ったまま', () => {
    // UT-EDIT-SVC-97 4.7 節の (b)「小節を足すことを EDIT-003 で拒んだときは、EDIT-003 を知らせ、カーソルは確定した和音の拍に留める」
    //   （和音の確定の 3 つのうち音価の選択。→ は UT-EDIT-SVC-66、ボタンを切るのは UT-EDIT-SVC-85）
    svc = new EditingService(target, cursor, new FullValidation(), history, reporter, undefined, stubConfirmer());
    quarters(4);
    cursor.enterChordInput();
    cursor.setPosition(at(0, 3));
    svc.placeNote(2, 7);
    const undoable = countUndoable(history);
    svc.setDuration(DEFAULT_DURATION_SPEC);
    expect(reporter.reports).toEqual([EDIT_003_REPORT]);
    expect(target.score.masterBars.length).toBe(1);
    expect(cursor.position).toEqual(at(0, 3));
    expect(cursor.chordInputMode).toBe(true);
    expect(countUndoable(history)).toBe(undoable);
  });

  it('EditingService_stepRightで休符を置いて最後の小節が埋まり小節を足す確かめが拒む_EDIT-003を知らせて休符だけを置き休符の拍に留める', () => {
    // UT-EDIT-SVC-98 4.1 節「小節を足すことを EDIT-003 で拒んだときは、EDIT-003 を知らせ、休符を置いて最後の小節が埋まったときは
    //   休符だけを置いてカーソルを置いた休符の拍に留め」（何も置かずに次の小節へ移るときは UT-EDIT-SVC-61）
    svc = new EditingService(target, cursor, new FullValidation(), history, reporter, undefined, stubConfirmer());
    quarters(3);
    cursor.setPosition(at(0, 3));
    const execute = vi.spyOn(history, 'execute');
    svc.stepRight();
    expect(reporter.reports).toEqual([EDIT_003_REPORT]);
    expect(execute.mock.calls.map(([command]) => command.constructor.name)).toEqual(['InsertRestCommand']);
    expect(beatCount(0)).toBe(4);
    expect(getBeat(target.score, 0, 0, 3).notes).toHaveLength(0);
    expect(target.score.masterBars.length).toBe(1);
    expect(cursor.position).toEqual(at(0, 3));
  });
});

describe('2 連符と 4 連符の分母（4.3 節、275 番の決め直し）を alphaTab に渡すときと保存して読み直すとき', () => {
  const EIGHTH_2_3: BeatDurationSpec = { duration: model.Duration.Eighth, dots: 0, tuplet: tupletSpecFor(2) };
  const EIGHTH_4_3: BeatDurationSpec = { duration: model.Duration.Eighth, dots: 0, tuplet: tupletSpecFor(4) };
  /** 1 小節目のボイス 1 の拍の [連符の分子, 分母, 鳴らす長さ（tick）]。 */
  const tuplets = (score: model.Score): [number, number, number][] =>
    score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats.map((b) => [
      b.tupletNumerator,
      b.tupletDenominator,
      b.playbackDuration,
    ]);
  // 8 分音符は 480 tick。alphaTab は連符の長さを tick × 分母 ÷ 分子 で出す（2:3 なら 720、4:3 なら 360）
  const EXPECTED: [number, number, number][] = [
    [2, 3, 720],
    [2, 3, 720],
    [4, 3, 360],
    [4, 3, 360],
    [4, 3, 360],
    [4, 3, 360],
  ];

  it('連符_2連符と4連符を置いて描く前の作り直しとMIDIの作りを通し保存して読み直す_分母3と長さが保たれる', () => {
    // UT-EDIT-SVC-99 4.3 節「ただし 2 と 4 は分母を 3 とする（2:3・4:3。2 連符・4 連符は、3 つ分の長さに 2 つ・4 つの音を入れる記譜の慣習のため」
    //   ・「3 つの要素は、新しく置くコマンド（PlaceNoteCommand と InsertRestCommand）にも…同じ形（BeatDurationSpec）で渡す」
    svc.setDuration(EIGHTH_2_3);
    svc.placeNote(3, 1);
    svc.placeNote(3, 2);
    svc.setDuration(EIGHTH_4_3);
    for (const fret of [3, 4, 5, 6]) svc.placeNote(3, fret);
    expect(reporter.reports).toEqual([]);

    // alphaTab に渡す（描く前の作り直しと MIDI の作り）
    rebuildBeforeRender(target.score);
    expect(tuplets(target.score)).toEqual(EXPECTED);
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(target.score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    expect(file.tracks.reduce((sum, t) => sum + t.events.length, 0)).toBeGreaterThan(0);

    // 保存して読み直す
    const doc = new SongDocument({ id: 'song-1', score: target.score, appMeta: createEmptyAppMetadata() });
    const reopened = SongDocument.fromFileJson(doc.toFileJson(0)).score;
    rebuildBeforeRender(reopened);
    expect(tuplets(reopened)).toEqual(EXPECTED);
  });
});

describe('EditingService のカーソルと選択範囲を動かす窓口（4.1 節・4.7 節・4.8 節・9 節、288 番）', () => {
  const at = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });
  /** 1 小節目の拍 0 から count - 1 に、弦 3 のフレット 0 からの 4 分音符を置く（コマンドを直に履歴へ）。 */
  const quarters = (count: number): void => {
    for (let i = 0; i < count; i++) {
      history.execute(new PlaceNoteCommand(target, at(i), 3, i, DEFAULT_DURATION_SPEC));
    }
  };
  /** 時計を差し替えた EditingService を作る（2 桁のフレットの窓、4.2 節）。 */
  const withClock = (clock: { now: number }): EditingService =>
    new EditingService(
      target,
      cursor,
      new ValidationService(),
      history,
      reporter,
      undefined,
      stubConfirmer(),
      undefined,
      () => clock.now,
    );

  it('EditingService_setPosition_CursorControllerのsetPositionに渡しコマンドを出さない', () => {
    // UT-EDIT-SVC-101 4.8 節「setPosition(position: CursorPosition): void;」「CursorController.setPosition…に渡し」
    quarters(3);
    const setPosition = vi.spyOn(cursor, 'setPosition');
    const execute = vi.spyOn(history, 'execute');
    svc.setPosition(at(2));
    expect(setPosition).toHaveBeenCalledWith(at(2));
    expect(cursor.position).toEqual(at(2));
    expect(execute).not.toHaveBeenCalled();
  });

  it('EditingService_stepLeft_CursorControllerのmoveByBeatに-1で渡し前の拍へ動き曲の最初の拍では動かない', () => {
    // UT-EDIT-SVC-102 4.8 節「stepLeft(): void;」「moveByBeat(target, -1) に渡し」・4.1 節「← は、選んでいるボイスの拍を 1 つずつ前へ動く」
    //   「曲の最初の拍では動かない」
    quarters(3);
    cursor.setPosition(at(2));
    const moveByBeat = vi.spyOn(cursor, 'moveByBeat');
    const execute = vi.spyOn(history, 'execute');
    svc.stepLeft();
    expect(moveByBeat).toHaveBeenCalledWith(target, -1);
    expect(cursor.position).toEqual(at(1));
    svc.stepLeft();
    svc.stepLeft();
    expect(cursor.position).toEqual(at(0));
    expect(execute).not.toHaveBeenCalled();
  });

  it('EditingService_setStringとenterChordInput_CursorControllerの同じ名前のメソッドに渡す', () => {
    // UT-EDIT-SVC-103 4.8 節「setString(stringNumber: number): void; enterChordInput(): void;」「CursorController の同じ名前のメソッドに渡す」
    const setString = vi.spyOn(cursor, 'setString');
    const enterChordInput = vi.spyOn(cursor, 'enterChordInput');
    svc.setString(4);
    expect(setString).toHaveBeenCalledWith(4);
    expect(cursor.currentString).toBe(4);
    svc.enterChordInput();
    expect(enterChordInput).toHaveBeenCalledTimes(1);
    expect(cursor.chordInputMode).toBe(true);
  });

  it('EditingService_setSelectionとbeginSelectionとextendSelectionとclearSelection_CursorControllerの同じ名前のメソッドに渡す', () => {
    // UT-EDIT-SVC-104 4.8 節「setSelection(range: SelectionRange): void; beginSelection(at: CursorPosition): void;
    //   extendSelection(at: CursorPosition): void; clearSelection(): void; // 9 節。CursorController の同じ名前のメソッドに渡す」
    quarters(4);
    const range: SelectionRange = {
      trackIndex: 0,
      voiceIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 1,
      endBarIndex: 0,
      endBeatIndex: 2,
    };
    const spies = (['setSelection', 'beginSelection', 'extendSelection', 'clearSelection'] as const).map((name) =>
      vi.spyOn(cursor, name),
    );
    svc.setSelection(range);
    expect(spies[0]).toHaveBeenCalledWith(range);
    expect(cursor.selection).toEqual(range);
    svc.beginSelection(at(3));
    expect(spies[1]).toHaveBeenCalledWith(at(3));
    expect(cursor.selection).toEqual({ ...range, startBeatIndex: 3, endBeatIndex: 3 });
    svc.extendSelection(at(0));
    expect(spies[2]).toHaveBeenCalledWith(at(0));
    expect(cursor.selection).toEqual({ ...range, startBeatIndex: 0, endBeatIndex: 3 });
    svc.clearSelection();
    expect(spies[3]).toHaveBeenCalledTimes(1);
    expect(cursor.selection).toBeNull();
  });

  it('EditingService_和音の入力の途中でsetPositionで動かす_途中の印を捨てボタンを切っても確定の分を進めず置いた音とボタンは残る', () => {
    // UT-EDIT-SVC-105 4.7 節の (b)「和音の入力の途中で、← やクリックでカーソルを手で動かしたとき（EditingService.setPosition…）は、
    //   確定せずに途中の印を捨てる（進めない）」「その拍に置いた音はそのまま残り、「和音」ボタンの入切も変えない」
    quarters(2);
    svc.enterChordInput();
    svc.setPosition(at(0));
    svc.placeNote(2, 7);
    expect(cursor.position).toEqual(at(0));
    const undoable = countUndoable(history);
    svc.setPosition(at(0));
    expect(cursor.chordInputMode).toBe(true);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 0), 2)?.fret).toBe(7);
    expect(countUndoable(history)).toBe(undoable);
    // 途中の印が残っていれば、ボタンを切ると置いた拍から 1 つ進む（at(1)）。捨てたので動かない
    svc.exitChordInput();
    expect(cursor.position).toEqual(at(0));
  });

  it('EditingService_和音の入力の途中でstepLeftで動かす_途中の印を捨てボタンを切っても確定の分を進めず置いた音とボタンは残る', () => {
    // UT-EDIT-SVC-106 4.7 節の (b)「和音の入力の途中で、← やクリックでカーソルを手で動かしたとき（…← の EditingService.stepLeft。
    //   中で CursorController.setPosition と moveByBeat を呼ぶ、4.8 節）は、確定せずに途中の印を捨てる（進めない）」
    quarters(3);
    svc.enterChordInput();
    svc.setPosition(at(1));
    svc.placeNote(2, 7);
    expect(cursor.position).toEqual(at(1));
    svc.stepLeft();
    expect(cursor.position).toEqual(at(0));
    expect(cursor.chordInputMode).toBe(true);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 1), 2)?.fret).toBe(7);
    // 途中の印が残っていれば、ボタンを切ると置いた拍 1 から 1 つ進む（at(2)）。捨てたので動かない
    svc.exitChordInput();
    expect(cursor.position).toEqual(at(0));
  });

  it('EditingService_数字キーの後にsetPositionで動かす_2桁のフレットの覚えを捨て1秒以内の次の数字は新しい音になる', () => {
    // UT-EDIT-SVC-107 4.2 節の (b)「クリックのようにカーソルだけを動かす窓口（stepLeft・setPosition、4.8 節）…でも捨てる」
    //   ・4.2 節「1 秒を過ぎてから押したときは、新しい音として今のカーソルの拍に置く」と同じく新しい音になる
    const clock = { now: 0 };
    svc = withClock(clock);
    quarters(3);
    svc.setString(1);
    svc.setPosition(at(1));
    svc.placeDigit(1);
    expect(cursor.position).toEqual(at(1));
    svc.setPosition(at(2));
    clock.now = 500;
    svc.placeDigit(2);
    // 覚えが残っていれば、拍 1 の音が 12 に書き換わる
    expect(findNoteOnString(getBeat(target.score, 0, 0, 1), 1)?.fret).toBe(1);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 2), 1)?.fret).toBe(2);
    expect(reporter.reports).toEqual([]);
  });

  it('EditingService_数字キーの後にstepLeftで動かす_2桁のフレットの覚えを捨て1秒以内の次の数字は新しい音になる', () => {
    // UT-EDIT-SVC-108 4.2 節の (b)「← …のようにカーソルだけを動かす窓口（stepLeft・setPosition、4.8 節）…でも捨てる」
    const clock = { now: 0 };
    svc = withClock(clock);
    quarters(3);
    svc.setString(1);
    svc.setPosition(at(1));
    svc.placeDigit(1);
    expect(cursor.position).toEqual(at(1));
    svc.stepLeft();
    clock.now = 500;
    svc.placeDigit(2);
    // 覚えが残っていれば、拍 1 の音が 12 に書き換わる
    expect(findNoteOnString(getBeat(target.score, 0, 0, 1), 1)?.fret).toBe(1);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 0), 1)?.fret).toBe(2);
    expect(reporter.reports).toEqual([]);
  });
});

describe('EditingService の画面の出来事の行き着く先とコマンドの渡し方（1 節・2.1 節・4.8 節）', () => {
  const at = (beatIndex: number): CursorPosition => ({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });
  /** 1 小節目の拍 0 と拍 1 に弦 3 の 4 分音符（フレット 5 と 7）を置き、カーソルを拍 0、選ぶ弦を 3 にする。 */
  const twoQuarters = (): void => {
    svc.placeNote(3, 5);
    svc.placeNote(3, 7);
    cursor.setPosition(at(0));
    cursor.setString(3);
  };

  /**
   * 画面のクリックとキーが呼ぶ EditingService の窓口（screens-navigation.md 9.2 節・10.1 節・10.2 節・10.4 節）。
   * `from` は、呼ぶ前にカーソルを置く拍（無ければ拍 0）。
   */
  const screenEvents: { name: string; from?: number; act: () => void }[] = [
    { name: '譜面の左クリックでsetPosition', act: () => svc.setPosition(at(1)) },
    {
      name: '左クリックのドラッグを離してmoveNote',
      act: () => svc.moveNote({ position: at(0), stringNumber: 3 }, { position: at(1), stringNumber: 2 }),
    },
    {
      name: '右クリックの削除か消しゴムのクリックでdeleteNoteAt',
      act: () => svc.deleteNoteAt({ position: at(1), stringNumber: 3 }),
    },
    { name: '休符のボタンのクリックでinsertRest', act: () => svc.insertRest() },
    { name: '←キーでstepLeft', from: 1, act: () => svc.stepLeft() },
    { name: '→キーでstepRight', act: () => svc.stepRight() },
    { name: '↑↓キーでsetString', act: () => svc.setString(4) },
    { name: '数字キーでplaceDigit', from: 2, act: () => svc.placeDigit(3) },
    { name: 'DeleteキーとBackspaceキーでdeleteNotes', act: () => svc.deleteNotes() },
  ];

  for (const { name, from, act } of screenEvents) {
    it(`EditingService_${name}_カーソルを動かすかコマンドを発行するかのどちらかに行き着く`, () => {
      // UT-EDIT-SVC-111 1 節「画面の出来事（クリックとキー）は、EditingService の中で、カーソルを動かすかコマンドを発行するかのどちらかに
      //   必ず行き着かせる」
      twoQuarters();
      if (from !== undefined) cursor.setPosition(at(from));
      const execute = vi.spyOn(history, 'execute');
      const before = JSON.stringify({ position: cursor.position, string: cursor.currentString });
      act();
      const moved = JSON.stringify({ position: cursor.position, string: cursor.currentString }) !== before;
      const issued = execute.mock.calls.length > 0;
      expect(moved || issued).toBe(true);
      expect(reporter.reports).toEqual([]);
    });
  }

  /** コマンドを発行する窓口と、作るコマンドの kind（2.1 節・4.8 節）。 */
  const issuing: { name: string; kind: string; act: () => void }[] = [
    { name: 'placeNote', kind: 'place-note', act: () => svc.placeNote(2, 3) },
    { name: 'placeDigit', kind: 'place-note', act: () => (cursor.setPosition(at(2)), svc.placeDigit(4)) },
    { name: 'insertRest', kind: 'insert-rest', act: () => (cursor.setPosition(at(2)), svc.insertRest()) },
    {
      name: 'stepRightで最後の拍の後ろに空きがある',
      kind: 'insert-rest',
      act: () => (cursor.setPosition(at(2)), svc.stepRight()),
    },
    { name: 'deleteNotes', kind: 'delete-notes', act: () => svc.deleteNotes() },
    { name: 'deleteNoteAt', kind: 'delete-notes', act: () => svc.deleteNoteAt({ position: at(1), stringNumber: 3 }) },
    {
      name: 'moveNote',
      kind: 'move-note',
      act: () => svc.moveNote({ position: at(0), stringNumber: 3 }, { position: at(1), stringNumber: 2 }),
    },
    { name: 'setTie', kind: 'set-tie', act: () => svc.setTie(3, true) },
    { name: 'setTechnique', kind: 'set-technique', act: () => svc.setTechnique(3, { isPalmMute: true }) },
    { name: 'setBeatTechnique', kind: 'set-beat-technique', act: () => svc.setBeatTechnique({ slap: true }) },
    { name: 'setChordName', kind: 'set-chord-name', act: () => svc.setChordName('C') },
    { name: 'setTempo', kind: 'set-tempo', act: () => svc.setTempo(0, 100) },
    { name: 'insertBar', kind: 'insert-bar', act: () => svc.insertBar(1) },
  ];

  for (const { name, kind, act } of issuing) {
    it(`EditingService_${name}_作ったコマンドをCommandHistory.executeに1回渡し曲はそのコマンドで変わり取り消しで戻る`, () => {
      // UT-EDIT-SVC-112 2.1 節「画面が呼べるのは EditingService のメソッドだけで、EditingService がコマンドを作って
      //   CommandHistory.execute に渡す」
      twoQuarters();
      const before = scoreJson(target);
      const execute = vi.spyOn(history, 'execute');
      act();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0]![0].kind).toBe(kind);
      expect(scoreJson(target)).not.toBe(before);
      history.undo();
      expect(scoreJson(target)).toBe(before);
    });

    it(`EditingService_${name}_履歴がコマンドを実行しない_曲は変わらずコマンドのexecuteで初めて変わる`, () => {
      // UT-EDIT-SVC-113 2.1 節「Score を変えるのは Command.execute() と Command.undo() の中だけとする。EditingService も
      //   CommandHistory も Score を直接は変えない」
      twoQuarters();
      const before = scoreJson(target);
      const issued: Command[] = [];
      vi.spyOn(history, 'execute').mockImplementation((command) => {
        issued.push(command);
        return { cursorAdvance: 'none' };
      });
      act();
      expect(issued).toHaveLength(1);
      expect(scoreJson(target)).toBe(before);
      issued[0]!.execute();
      expect(scoreJson(target)).not.toBe(before);
    });
  }
});

describe('EditingService.stepRight の → の動きの理由（4.1 節の (b)）', () => {
  const at = (barIndex: number, beatIndex: number): CursorPosition => ({
    trackIndex: 0,
    barIndex,
    voiceIndex: 0,
    beatIndex,
  });
  const beatCount = (barIndex: number): number => getVoice(getBar(target.score, 0, barIndex)).beats.length;
  class FullValidation extends ValidationService {
    override validateBarInsertion(): ReturnType<ValidationService['validateBarInsertion']> {
      return { ok: false, code: 'EDIT-003', context: { current: 2048, count: 1, max: 2048 } };
    }
  }
  const rebuild = (validation: ValidationService): void => {
    target = buildEditTarget();
    cursor = new CursorController();
    reporter = new RecordingReporter();
    history = new CommandHistory(render, reporter);
    svc = new EditingService(target, cursor, validation, history, reporter, undefined, stubConfirmer());
  };

  it('EditingService_音を置いて←で戻りstepRight_休符を置かずに置いた音の後ろへ戻り何も無い所でだけ休符を置く', () => {
    // UT-EDIT-SVC-114 4.1 節の (b)「休符を置くのは何も無い所だけにして、置いた音の後ろへ → で戻れるようにするため」
    svc.placeNote(3, 5);
    svc.stepLeft();
    expect(cursor.position).toEqual(at(0, 0));
    const execute = vi.spyOn(history, 'execute');
    svc.stepRight();
    expect(cursor.position).toEqual(at(0, 1));
    expect(execute).not.toHaveBeenCalled();
    expect(beatCount(0)).toBe(1);
    // 置いた音の後ろ（何も無い所）でだけ休符を置く
    svc.stepRight();
    expect(execute.mock.calls.map(([command]) => command.kind)).toEqual(['insert-rest']);
    expect(beatCount(0)).toBe(2);
    expect(findNoteOnString(getBeat(target.score, 0, 0, 0), 3)?.fret).toBe(5);
    expect(getBeat(target.score, 0, 0, 1).notes).toHaveLength(0);
  });

  it('EditingService_埋まった最後の小節で→と最後の小節を埋める音_どちらも小節を1つ足して足した小節の頭へ移り足せなければ置いた拍に留まる', () => {
    // UT-EDIT-SVC-115 4.1 節の (b)「最後の小節で埋まっているときの → で小節を足すのは、音を置いて埋まったときと同じ動きにそろえ」
    const outcome = (): { bars: number; position: CursorPosition; codes: string[] } => ({
      bars: target.score.masterBars.length,
      position: cursor.position,
      codes: reporter.reports.map((r) => r.code),
    });
    const whole: BeatDurationSpec = { duration: model.Duration.Whole, dots: 0, tuplet: null };
    // 1 小節目は全音符の休符の拍 1 つで埋まっていて、曲の最後の小節
    svc.stepRight();
    const byArrow = outcome();
    rebuild(new ValidationService());
    cursor.setDuration(whole);
    svc.placeNote(3, 5);
    const byNote = outcome();
    expect(byNote).toEqual(byArrow);
    expect(byArrow).toEqual({ bars: 2, position: at(1, 0), codes: [] });

    // 小節を足すことを EDIT-003 で拒んだときも、どちらも知らせて今の拍に留まる
    rebuild(new FullValidation());
    svc.stepRight();
    const arrowRefused = outcome();
    rebuild(new FullValidation());
    cursor.setDuration(whole);
    svc.placeNote(3, 5);
    const noteRefused = outcome();
    expect(noteRefused).toEqual(arrowRefused);
    expect(arrowRefused).toEqual({ bars: 1, position: at(0, 0), codes: ['EDIT-003'] });
  });

  it('EditingService_曲の終わりで→を続けて押す_毎回カーソルが前へ進み止まる所が無い', () => {
    // UT-EDIT-SVC-116 4.1 節の (b)「曲の終わりで → が効かなくなる所を作らないため」
    svc.placeNote(3, 5);
    const order = (p: CursorPosition): number => p.barIndex * 1000 + p.beatIndex;
    for (let i = 0; i < 12; i++) {
      const before = cursor.position;
      svc.stepRight();
      expect(order(cursor.position)).toBeGreaterThan(order(before));
    }
    expect(target.score.masterBars.length).toBeGreaterThan(2);
    expect(reporter.reports).toEqual([]);
  });
});
