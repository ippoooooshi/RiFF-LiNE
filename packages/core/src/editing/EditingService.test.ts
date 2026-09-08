// UT-EDIT-SVC: editing-core.md §5・§10 — EditingService
// 検証観点: UI 入力 → 検証 → コマンド/通知の振り分け、カーソル前進、和音入力、
//   メモ切り詰め通知、小節上限拒否、undo/redo、B4 自動候補、コード名解決。

import { beforeEach, describe, expect, it } from 'vitest';

import { CommandHistory } from './CommandHistory';
import { CursorController } from './CursorController';
import { EditingService } from './EditingService';
import { ValidationService } from './ValidationService';
import { getBeat, getVoice, getBar } from './scoreModel';
import type { EditTarget } from './types';
import { buildEditTarget, RecordingRenderRequester, RecordingReporter } from '../testing/editingFakes';
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

  it('fretOutOfRange_ReportsEDIT002_NoCommand_NoAdvance', () => {
    svc.placeNote(3, 30);
    expect(reporter.reports[0]).toMatchObject({ code: 'EDIT-002' });
    expect(history.canUndo()).toBe(false);
    expect(cursor.position.beatIndex).toBe(0);
  });

  it('chordInputMode_AddsToSameBeat_NoAdvance', () => {
    svc.placeNote(3, 5); // beat 0 → cursor advances to 1
    cursor.setPosition({ trackIndex: 0, barIndex: 0, beatIndex: 0 });
    cursor.enterChordInput();
    svc.placeNote(2, 7);
    expect(getBeat(target.score, 0, 0, 0).notes).toHaveLength(2);
    expect(cursor.position.beatIndex).toBe(0); // 和音入力中は進まない
  });

  it('duplicateString_ReportsEDIT001', () => {
    svc.placeNote(3, 5);
    cursor.setPosition({ trackIndex: 0, barIndex: 0, beatIndex: 0 });
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
  it('addMemo_OverLimit_ClampsAndReportsEDIT004', () => {
    svc.addMemo(0, 'あ'.repeat(120));
    expect(reporter.reports.map((r) => r.code)).toContain('EDIT-004');
    expect([...target.appMeta.memos[0]!.text]).toHaveLength(100);
  });

  it('addMemo_WithinLimit_NoReport', () => {
    svc.addMemo(0, 'ok');
    expect(reporter.reports).toEqual([]);
    expect(target.appMeta.memos[0]!.text).toBe('ok');
  });

  it('insertBar_AtLimit_ReportsEDIT003_NoInsert', () => {
    while (target.score.masterBars.length < 2048) target.score.addMasterBar(new model.MasterBar());
    const barsBefore = target.score.masterBars.length;
    svc.insertBar(1);
    expect(reporter.reports.map((r) => r.code)).toContain('EDIT-003');
    expect(target.score.masterBars.length).toBe(barsBefore);
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
    expect(render.calls).toEqual([]); // affectedTrackIndices=[] なので render は呼ばれない
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
    expect(history.undoDepth).toBe(2);
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

describe('EditingService.suggestTechnique (B4)', () => {
  beforeEach(() => {
    // beat0: string3 fret5、beat1 へカーソル
    svc.placeNote(3, 5);
  });

  it('fretUpWithinRange_SuggestsHammer', () => {
    expect(svc.suggestTechnique(3, 8)).toEqual({ kind: 'hammer', patch: { isHammerPullOrigin: true } });
  });

  it('fretDownWithinRange_SuggestsPull', () => {
    expect(svc.suggestTechnique(3, 3)).toEqual({ kind: 'pull', patch: { isHammerPullOrigin: true } });
  });

  it('fretDeltaTooLarge_ReturnsNull', () => {
    expect(svc.suggestTechnique(3, 12)).toBeNull(); // delta 7 > 4
  });

  it('sameFret_DeltaZero_ReturnsNull', () => {
    expect(svc.suggestTechnique(3, 5)).toBeNull(); // absDelta 0 < MIN(1)
  });

  it('fretDeltaExactlyMax_SuggestsHammer', () => {
    expect(svc.suggestTechnique(3, 9)).toEqual({ kind: 'hammer', patch: { isHammerPullOrigin: true } }); // delta 4 == MAX
  });

  it('noPreviousNoteOnString_ReturnsNull', () => {
    expect(svc.suggestTechnique(1, 6)).toBeNull();
  });

  it('atBarStart_ReturnsNull', () => {
    cursor.setPosition({ trackIndex: 0, barIndex: 0, beatIndex: 0 });
    expect(svc.suggestTechnique(3, 7)).toBeNull();
  });
});

describe('EditingService.chordNameAt', () => {
  it('returnsDetectedName', () => {
    // alphaTab 規約：string 1 = 最低音弦。string5(B) fret1 + string4(G) fret0 + string3(D) fret2 = C major
    svc.placeNote(5, 1);
    cursor.setPosition({ trackIndex: 0, barIndex: 0, beatIndex: 0 });
    cursor.enterChordInput();
    svc.placeNote(4, 0);
    svc.placeNote(3, 2);
    expect(svc.chordNameAt(0, 0)).toBe('C');
  });
});
