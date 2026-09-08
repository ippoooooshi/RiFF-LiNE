// IT-PART: part-tuning-management.md §7・§8 DoD — パート・チューニング管理の結合シナリオ
// 検証観点:
//  - パート追加→編集→削除→Undo で全データ完全復元（RemovePart の全体保持）
//  - チューニングプリセット適用（増加/減少）と Undo/Redo
//  - 複数編集ウィンドウでのパート操作の CommandHistory 分離
//  - onCommandApplied が全パート操作で発火
//  - EDIT-005/006/007 の通知

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { CommandHistory } from '../editing';
import { PlaceNoteCommand } from '../editing/commands/PlaceNoteCommand';
import type { CommandAppliedEvent, EditTarget } from '../editing';

import { BUILTIN_TUNING_PRESETS, TuningPresetService } from './TuningPresetService';
import { TuningPresetStore } from './TuningPresetStore';
import { PartManagementService } from './PartManagementService';
import { PartValidationService } from './PartValidationService';
import { getStringCount, getTuning } from './partModel';
import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';
import { buildEditTarget, RecordingRenderRequester, RecordingReporter, scoreJson } from '../testing/editingFakes';

function rig(): {
  target: EditTarget;
  history: CommandHistory;
  reporter: RecordingReporter;
  parts: PartManagementService;
  presets: TuningPresetService;
} {
  const target = buildEditTarget();
  const reporter = new RecordingReporter();
  const history = new CommandHistory(new RecordingRenderRequester(), reporter);
  const validation = new PartValidationService();
  return {
    target,
    history,
    reporter,
    parts: new PartManagementService(target, history, validation, reporter),
    presets: new TuningPresetService(new TuningPresetStore(new FakeFileSystemAdapter()), reporter),
  };
}

describe('パート・チューニング管理 通しシナリオ', () => {
  it('addPart_editNotes_removePart_undo_fullyRestores', () => {
    const r = rig();
    const applied: CommandAppliedEvent[] = [];
    r.history.onCommandApplied((e) => applied.push(e));

    r.parts.addPart({ name: 'Lead', instrumentType: 'electric_guitar' });
    new PlaceNoteCommand(
      r.target,
      { trackIndex: 1, barIndex: 0, beatIndex: 0 },
      3,
      12,
      model.Duration.Eighth,
    ).execute();
    r.parts.setVolume(1, 9);
    r.parts.setCapo(1, 3);
    const afterEdits = scoreJson(r.target);

    r.parts.removePart(1);
    expect(r.target.score.tracks).toHaveLength(1);

    r.history.undo(); // removePart を戻す
    expect(r.target.score.tracks).toHaveLength(2);
    expect(scoreJson(r.target)).toBe(afterEdits);

    expect(applied.some((e) => e.phase === 'execute')).toBe(true);
    expect(applied.some((e) => e.phase === 'undo')).toBe(true);
  });

  it('applyPreset_increaseThenDecrease_withUndoRedo', () => {
    const r = rig();
    new PlaceNoteCommand(
      r.target,
      { trackIndex: 0, barIndex: 0, beatIndex: 0 },
      6,
      2,
      model.Duration.Quarter,
    ).execute();
    const before6 = scoreJson(r.target);

    const sevenString = {
      ...BUILTIN_TUNING_PRESETS[0]!,
      id: 't7',
      name: '7弦',
      stringPitches: [69, 64, 59, 55, 50, 45, 40],
    };
    r.presets.applyPreset(r.target, r.history, 0, sevenString);
    expect(getStringCount(r.target.score, 0)).toBe(7);

    const fiveString = { ...BUILTIN_TUNING_PRESETS[0]!, id: 't5', name: '5弦', stringPitches: [64, 59, 55, 50, 45] };
    r.presets.applyPreset(r.target, r.history, 0, fiveString);
    expect(getStringCount(r.target.score, 0)).toBe(5);
    expect(r.reporter.reports.some((x) => x.code === 'EDIT-006')).toBe(true);

    r.history.undo(); // 5弦化を戻す → 7弦
    r.history.undo(); // 7弦化を戻す → 6弦
    expect(getTuning(r.target.score, 0)).toHaveLength(6);
    expect(scoreJson(r.target)).toBe(before6);

    r.history.redo();
    expect(getStringCount(r.target.score, 0)).toBe(7);
  });

  it('multipleWindows_partOpsIndependent', () => {
    const a = rig();
    const b = rig();
    a.parts.addPart({ name: 'A2', instrumentType: 'bass' });
    a.parts.addPart({ name: 'A3', instrumentType: 'electric_guitar' });
    b.parts.addPart({ name: 'B2', instrumentType: 'electric_guitar' });

    expect(a.history.undoDepth).toBe(2);
    expect(b.history.undoDepth).toBe(1);
    b.history.undo();
    expect(a.target.score.tracks).toHaveLength(3);
    expect(b.target.score.tracks).toHaveLength(1);
  });

  it('partCountLimit_and_capoRange_report', () => {
    const r = rig();
    for (let i = 0; i < 7; i++) r.parts.addPart({ name: `P${i}`, instrumentType: 'electric_guitar' });
    expect(r.target.score.tracks).toHaveLength(8);
    r.parts.addPart({ name: 'over', instrumentType: 'electric_guitar' });
    r.parts.setCapo(0, 99);
    const codes = r.reporter.reports.map((x) => x.code);
    expect(codes).toContain('EDIT-005');
    expect(codes).toContain('EDIT-007');
  });
});
