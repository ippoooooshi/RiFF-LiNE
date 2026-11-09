// UT-PART-MGMT: part-tuning-management.md §4.1・§6.1・§6.3 — PartManagementService
// 検証観点: 追加時の色自動割当・上限超過で EDIT-005・削除の最低1パートガード、ミキサー/カポの発行、
//   カポ範囲外で EDIT-007、listParts のスナップショット、バッチ追加の除外リスト。

import { beforeEach, describe, expect, it } from 'vitest';

import { CommandHistory, ValidationService } from '../editing';
import type { EditTarget, ValidationOutcome } from '../editing';

import { PART_COLOR_PALETTE } from './PartColorAllocator';
import { MAX_CAPO_FRET, MIN_CAPO_FRET, PartManagementService } from './PartManagementService';
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
  svc = new PartManagementService(target, history, new ValidationService(), reporter);
});

/** validatePartCount が呼ばれた回数を数え、決めた結果を返す ValidationService。 */
class CountingPartCountValidation extends ValidationService {
  calls = 0;
  constructor(private readonly outcome: ValidationOutcome) {
    super();
  }
  override validatePartCount(): ValidationOutcome {
    this.calls += 1;
    return this.outcome;
  }
}

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

  it('EDIT-005: 8 パートでのパートの追加', () => {
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

  it('PartManagementService_addPart_受けたValidationServiceのvalidatePartCountの結果で拒む', () => {
    // UT-PART-MGMT-01 editing-core.md 5 節「パートの数の確かめは、ValidationService に validatePartCount として置き、別のクラスに分けない」・part-tuning-management.md 2.6 節「足した後の数が 8 を超えるなら EDIT-005 を知らせて発行しない」
    const refuse = new CountingPartCountValidation({ ok: false, code: 'EDIT-005', context: { current: 1, max: 8 } });
    const refusing = new PartManagementService(target, history, refuse, reporter);
    refusing.addPart({ name: 'G2', instrumentType: 'electric_guitar' });
    expect(refuse.calls).toBe(1);
    expect(target.score.tracks).toHaveLength(1);
    expect(history.canUndo()).toBe(false);
    expect(reporter.reports).toContainEqual({ code: 'EDIT-005', context: { current: 1, max: 8 } });

    const allow = new CountingPartCountValidation({ ok: true });
    new PartManagementService(target, history, allow, reporter).addPart({ name: 'G2', instrumentType: 'bass' });
    expect(allow.calls).toBe(1);
    expect(target.score.tracks).toHaveLength(2);
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

describe('reorderParts & setColor', () => {
  it('PartManagementService_reorderParts_並びを入れ替えるコマンドを発行する', () => {
    // UT-PART-MGMT-04 part-tuning-management.md 2.6 節「reorderParts(order: readonly number[]): void」
    svc.addPart({ name: 'G2', instrumentType: 'electric_guitar' });
    svc.reorderParts([1, 0]);
    expect(target.score.tracks.map((t) => t.name)).toEqual(['G2', expect.any(String)]);
    history.undo();
    expect(target.score.tracks[1]!.name).toBe('G2');
  });

  it('PartManagementService_setColor_指定の色にするコマンドを発行する', () => {
    // UT-PART-MGMT-05 part-tuning-management.md 2.6 節「setColor(trackIndex: number, hex: string): void」
    svc.setColor(0, '#123456');
    expect(getColorHex(target.score, 0).toLowerCase()).toBe('#123456');
    expect(history.canUndo()).toBe(true);
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

  it('EDIT-007: 範囲外のカポ（20）', () => {
    svc.setCapo(0, 20);
    expect(getCapo(target.score, 0)).toBe(0);
    expect(reporter.reports.map((r) => r.code)).toContain('EDIT-007');
  });

  it.each([0, 5, 12])('PartManagementService_カポ%s_範囲の内なので発行する', (capo) => {
    // UT-PART-MGMT-02 part-tuning-management.md 2.5 節の表「0 から 12 の範囲の外なら発行せず、EDIT-007 にする」の内側（境界 0・12）
    svc.setCapo(0, capo);
    expect(getCapo(target.score, 0)).toBe(capo);
    expect(history.canUndo()).toBe(true);
    expect(reporter.reports).toEqual([]);
  });

  it.each([-1, 13, 3.5])('PartManagementService_カポ%s_発行せずEDIT007を知らせる', (capo) => {
    // UT-PART-MGMT-03 part-tuning-management.md 2.5 節の表「0 から 12 の範囲の外なら発行せず、EDIT-007 にする」（境界 -1・13・整数でない値）
    svc.setCapo(0, capo);
    expect(getCapo(target.score, 0)).toBe(0);
    expect(history.canUndo()).toBe(false);
    expect(reporter.reports).toEqual([
      { code: 'EDIT-007', context: { capoFret: capo, min: MIN_CAPO_FRET, max: MAX_CAPO_FRET } },
    ]);
    expect([MIN_CAPO_FRET, MAX_CAPO_FRET]).toEqual([0, 12]);
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
