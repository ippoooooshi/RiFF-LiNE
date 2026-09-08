// UT-PART-MGMT: part-tuning-management.md §4.1・§6.1・§6.3 — PartManagementService
// 検証観点: 追加時の色自動割当・上限超過で EDIT-005・削除の最低1パートガード、ミキサー/カポの発行、
//   カポ範囲外で EDIT-007、listParts のスナップショット、バッチ追加の除外リスト。

import { beforeEach, describe, expect, it } from 'vitest';

import { CommandHistory } from '../editing';
import type { EditTarget } from '../editing';

import { PART_COLOR_PALETTE } from './PartColorAllocator';
import { PartManagementService } from './PartManagementService';
import { PartValidationService } from './PartValidationService';
import { getCapo, getColorHex, getMixer } from './partModel';
import { buildEditTarget, RecordingRenderRequester, RecordingReporter } from '../testing/editingFakes';

let target: EditTarget;
let history: CommandHistory;
let reporter: RecordingReporter;
let svc: PartManagementService;

beforeEach(() => {
  target = buildEditTarget();
  reporter = new RecordingReporter();
  history = new CommandHistory(new RecordingRenderRequester(), reporter);
  svc = new PartManagementService(target, history, new PartValidationService(), reporter);
});

describe('addPart', () => {
  it('add_AllocatesUnusedColor_AndExecutes', () => {
    const usedBefore = getColorHex(target.score, 0);
    svc.addPart({ name: 'G2', instrumentType: 'electric_guitar' });
    expect(target.score.tracks).toHaveLength(2);
    const newColor = getColorHex(target.score, 1);
    expect(newColor).not.toBe(usedBefore);
    expect(PART_COLOR_PALETTE).toContain(newColor);
  });

  it('add_BassUsesDefaultBassTuning', () => {
    svc.addPart({ name: 'Bass', instrumentType: 'bass' });
    expect(target.score.tracks[1]!.staves[0]!.stringTuning.tunings).toHaveLength(4);
  });

  it('add_AtLimit_ReportsEDIT005_NoAdd', () => {
    for (let i = 0; i < 7; i++) svc.addPart({ name: `G${i}`, instrumentType: 'electric_guitar' });
    expect(target.score.tracks).toHaveLength(8);
    svc.addPart({ name: 'over', instrumentType: 'electric_guitar' });
    expect(target.score.tracks).toHaveLength(8);
    expect(reporter.reports.map((r) => r.code)).toContain('EDIT-005');
  });

  it('addPart_Batch_WithReservedColors_NoDuplicateColor', () => {
    // ウィザードでの一括追加を模す：peekNextColor で予約しながら 3 パート足す
    const reserved: string[] = [];
    for (let i = 0; i < 3; i++) {
      const next = svc.peekNextColor(reserved);
      reserved.push(next);
      svc.addPart({ name: `W${i}`, instrumentType: 'electric_guitar' }, reserved.slice(0, -1));
    }
    const colors = target.score.tracks.map((_t, i) => getColorHex(target.score, i));
    expect(new Set(colors).size).toBe(colors.length); // 全色ユニーク
  });
});

describe('removePart', () => {
  it('remove_KeepsAtLeastOnePart', () => {
    svc.removePart(0);
    expect(target.score.tracks).toHaveLength(1);
    expect(history.canUndo()).toBe(false);
  });

  it('remove_WithMultipleParts_Executes_UndoRestores', () => {
    svc.addPart({ name: 'G2', instrumentType: 'electric_guitar' });
    svc.removePart(1);
    expect(target.score.tracks).toHaveLength(1);
    history.undo();
    expect(target.score.tracks).toHaveLength(2);
  });
});

describe('mixer & capo', () => {
  it('setVolume_setPan_setSolo_setMute_Execute', () => {
    svc.setVolume(0, 8);
    svc.setPan(0, 2);
    svc.setSolo(0, true);
    svc.setMute(0, true);
    expect(getMixer(target.score, 0)).toMatchObject({ volume: 8, pan: 2, solo: true, mute: true });
  });

  it('setCapo_InRange_Executes', () => {
    svc.setCapo(0, 5);
    expect(getCapo(target.score, 0)).toBe(5);
  });

  it('setCapo_OutOfRange_ReportsEDIT007_NoExecute', () => {
    svc.setCapo(0, 20);
    expect(getCapo(target.score, 0)).toBe(0);
    expect(reporter.reports.map((r) => r.code)).toContain('EDIT-007');
  });
});

describe('listParts', () => {
  it('returnsSnapshotPerTrack', () => {
    svc.addPart({ name: 'G2', instrumentType: 'electric_guitar' });
    const list = svc.listParts();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ trackIndex: 0, stringCount: 6, capoFret: 0 });
    expect(list[1]!.name).toBe('G2');
  });
});
