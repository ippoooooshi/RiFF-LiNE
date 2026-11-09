// UT-EDIT-SVC: editing-core.md 4.8 節・5 節・6 節・7.1 節 — EditingService
// 検証観点: UI 入力 → 確かめ → コマンド/知らせの振り分け、カーソル前進、和音入力、
//   メモ切り詰め通知、小節上限拒否、音価の合計を拒まない扱い、undo/redo、タイと奏法記号の候補、コード名解決。

import { beforeEach, describe, expect, it } from 'vitest';

import { CommandHistory } from './commands/CommandHistory';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { CursorController } from './CursorController';
import { EditingService } from './EditingService';
import { ValidationService } from './ValidationService';
import { getBeat, getVoice, getBar } from './scoreModel';
import { DEFAULT_DURATION_SPEC, type BeatDurationSpec, type CursorPosition, type EditTarget } from './types';
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

  it('deleteBar_OnSingleBarSong_IsNoOp', () => {
    expect(target.score.masterBars).toHaveLength(1);
    svc.deleteBar(0, 'delete');
    expect(target.score.masterBars).toHaveLength(1);
    expect(history.canUndo()).toBe(false);
  });

  it('deleteBar_OutOfRange_IsNoOp', () => {
    svc.insertBar(1); // 2 小節に
    svc.deleteBar(5, 'delete');
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
    // alphaTab 規約：string 1 = 最低音弦。string5(B) fret1 + string4(G) fret0 + string3(D) fret2 = C major
    svc.placeNote(5, 1);
    cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    cursor.enterChordInput();
    svc.placeNote(4, 0);
    svc.placeNote(3, 2);
    expect(svc.chordNameAt(0, 0)).toBe('C');
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
    expect(svc.chordNameAt(0, 0)).toBe('C');
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
      [
        'ほかの窓口のコマンド',
        () => history.execute(new PlaceNoteCommand(target, beat(2), 1, 0, DEFAULT_DURATION_SPEC)),
      ],
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
