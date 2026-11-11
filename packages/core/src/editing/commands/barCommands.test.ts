// UT-EDIT-BAR: InsertBarCommand・DeleteBarCommand とその子のコマンド（小節の挿入と削除）
// 検証節: editing-core.md 2.3 節・2.4 節・2.6 節の表・3.2 節・10 節、基本設計 13 章 B2・B5
// 検証観点（C2）: 全部のパートの小節を同じように変える CompositeCommand で、子は 10 節の箇条の順。undo で Score と appMeta が元に戻る。
//  - 継ぐ向き：足した小節は一覧に入れず（拍子は直前を継ぐ）、テンポも継ぐ（空）。一覧の番号はずらすだけ。1 小節目はいつも一覧に入れる
//  - 曲の頭の小節のテンポ：頭に足した 1 小節目と、1 小節目を消した後の新しい 1 小節目は、元の 1 小節目にテンポがあればテンポを置く（3.2 節）
//  - 消すときのマーカーとメモ：'none'／'delete'／'move-to-previous'（直前が無ければ次の小節、移す先が無ければ消す）
//  - 逆参照：足した小節と拍から上の階層への参照と、小節の番号・前後のつながりを張り直す（描く前の作り直しが通る）

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import {
  DeleteBarCommand,
  DeleteMasterBarCommand,
  DeletePartBarCommand,
  InsertBarCommand,
  InsertMasterBarCommand,
  InsertPartBarCommand,
  MoveBarAnnotationsCommand,
} from './barCommands';
import { AddMemoCommand } from './memoCommands';
import { AddSectionMarkerCommand } from './sectionMarkerCommands';
import { SetTempoCommand } from './SetTempoCommand';
import { SetTimeSignatureCommand } from './SetTimeSignatureCommand';
import { CompositeCommand } from '../CompositeCommand';
import { barCount, finishScore, getMasterBar, getStaff } from '../scoreModel';
import type { EditTarget } from '../types';
import { buildEditTarget, appMetaJson, scoreJson } from '../../testing/editingFakes';
import { rebuildBeforeRender } from '../../testing/noteAttributeFixtures';

const fixedNow = (): Date => new Date('2026-09-08T00:00:00.000Z');

/** N 小節の 2 パート target（各小節に順番のテンポを付けて見分けられるようにする）。 */
function multiBarTarget(bars: number): EditTarget {
  const target = buildEditTarget(2);
  for (let i = 1; i < bars; i++) new InsertBarCommand(target, i).execute();
  for (let i = 0; i < bars; i++) new SetTempoCommand(target, i, 100 + i).execute();
  return target;
}

/** 子のコマンドの kind の並び（CompositeCommand の中身を、公開の形だけから読むため execute の順を記録する）。 */
function childKinds(command: CompositeCommand): string[] {
  return (command as unknown as { children: readonly { kind: string }[] }).children.map((c) => c.kind);
}

/** 曲共通の小節とパートの小節の、番号と前後のつながりと上の階層への参照がそろっているか。 */
function expectLinked(target: EditTarget): void {
  const { score } = target;
  score.masterBars.forEach((masterBar, i) => {
    expect(masterBar.index).toBe(i);
    expect(masterBar.score).toBe(score);
    expect(masterBar.previousMasterBar).toBe(i > 0 ? score.masterBars[i - 1] : null);
    expect(masterBar.nextMasterBar).toBe(score.masterBars[i + 1] ?? null);
  });
  score.tracks.forEach((_track, t) => {
    const staff = getStaff(score, t);
    staff.bars.forEach((bar, i) => {
      expect(bar.index).toBe(i);
      expect(bar.staff).toBe(staff);
      expect(bar.previousBar).toBe(i > 0 ? staff.bars[i - 1] : null);
      expect(bar.nextBar).toBe(staff.bars[i + 1] ?? null);
      for (const voice of bar.voices) for (const beat of voice.beats) expect(beat.voice).toBe(voice);
    });
  });
}

describe('InsertBarCommand', () => {
  it('insert_AddsBarToAllStaves_AndMasterBar_UndoRestores', () => {
    // UT-EDIT-BAR-01 2.6 節の表「InsertBarCommand は全部のパートに小節を足す」「CompositeCommand として構成する」「範囲は全部のパート」
    const target = buildEditTarget(2);
    const before = { score: scoreJson(target), meta: appMetaJson(target) };
    expect(barCount(target.score)).toBe(1);

    const cmd = new InsertBarCommand(target, 1);
    expect(cmd).toBeInstanceOf(CompositeCommand);
    expect(cmd.kind).toBe('insert-bar');
    expect(cmd.label).toBe('insert-bar');
    // 10 節：曲共通の小節を先に、パートを番号の順に
    expect(childKinds(cmd)).toEqual(['insert-master-bar', 'insert-part-bar', 'insert-part-bar']);
    cmd.execute();
    expect(barCount(target.score)).toBe(2);
    expect(getStaff(target.score, 0).bars).toHaveLength(2);
    expect(getStaff(target.score, 1).bars).toHaveLength(2);
    expect([...cmd.affectedTrackIndices]).toEqual([0, 1]);

    cmd.undo();
    expect(barCount(target.score)).toBe(1);
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
  });

  it('insert_NewBar_InheritsTempoAndTimeSignature_AndFollowsLaterChanges', () => {
    // UT-EDIT-BAR-02 10 節「新しい小節の拍子もテンポも、いつも『直前を継ぐ』（null）で始める」「直前の値を写して固定の値にしない」
    const target = multiBarTarget(2); // 小節 0・1 のテンポは 100・101
    new SetTimeSignatureCommand(target, 0, { numerator: 3, denominator: 4 }).execute();
    new InsertBarCommand(target, 1).execute();

    const inserted = getMasterBar(target.score, 1);
    expect(inserted.tempoAutomations).toHaveLength(0);
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect([inserted.timeSignatureNumerator, inserted.timeSignatureDenominator]).toEqual([3, 4]);
    // 後で前の小節の拍子を変えると、新しい小節に届く
    new SetTimeSignatureCommand(target, 0, { numerator: 6, denominator: 8 }).execute();
    expect([inserted.timeSignatureNumerator, inserted.timeSignatureDenominator]).toEqual([6, 8]);
  });

  it('insert_ShiftsMemoMarkerAndExplicitBars_UndoUnshifts', () => {
    // UT-EDIT-BAR-03 10 節「InsertMasterBarCommand は後ろの小節の番号と explicitTimeSignatureBars・セクションマーカー・小節メモの番号をずらす」
    const target = multiBarTarget(3);
    new AddMemoCommand(target, 2, 'bar2 memo', fixedNow).execute();
    new AddMemoCommand(target, 0, 'bar0 memo', fixedNow).execute();
    new AddSectionMarkerCommand(target, 2, 'bar2 sec').execute();
    new SetTimeSignatureCommand(target, 2, { numerator: 5, denominator: 4 }).execute();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new InsertBarCommand(target, 1);
    cmd.execute();
    expect(target.appMeta.memos.map((m) => m.barId)).toEqual(['3', '0']);
    expect(target.appMeta.sectionMarkers[0]!.barId).toBe('3');
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 3]);
    expect(getMasterBar(target.score, 3).section?.text).toBe('bar2 sec');

    cmd.undo();
    expect(appMetaJson(target)).toBe(before.meta);
    expect(scoreJson(target)).toBe(before.score);
    // やり直すと同じ結果（C2 の対称性）
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 3]);
  });

  it('insert_AtHead_NewFirstBarIsExplicit_WithOldFirstSignature', () => {
    // UT-EDIT-BAR-04 3.2 節「1 小節目は継ぐ先が無いので、いつも一覧に入れる」
    const target = buildEditTarget();
    new SetTimeSignatureCommand(target, 0, { numerator: 7, denominator: 8 }).execute();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new InsertBarCommand(target, 0);
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 1]);
    const head = getMasterBar(target.score, 0);
    expect([head.timeSignatureNumerator, head.timeSignatureDenominator]).toEqual([7, 8]);

    cmd.undo();
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
  });

  it('insert_RelinksBarsAndBeats_SoRebuildBeforeRenderingSucceeds', () => {
    // UT-EDIT-BAR-05 2.4 節「小節を足すコマンドも、逆参照を明示的に張る」「insertBeatAt で張る」・4.4 節の (b)「全音符の長さの休符の拍を 1 つ置く」
    const target = multiBarTarget(3);
    const cmd = new InsertBarCommand(target, 1);
    cmd.execute();
    expectLinked(target);
    const newBar = getStaff(target.score, 1).bars[1]!;
    expect(newBar.voices[0]!.beats).toHaveLength(1);
    expect(newBar.voices[0]!.beats[0]!.notes).toHaveLength(0);
    expect(newBar.voices[0]!.beats[0]!.duration).toBe(model.Duration.Whole);
    // 描く前の作り直し（Score.finish）が通り、小節から曲共通の小節を正しく引ける
    finishScore(target.score);
    expect(newBar.masterBar).toBe(getMasterBar(target.score, 1));
    expect(getMasterBar(target.score, 2).start).toBeGreaterThan(getMasterBar(target.score, 1).start);
    // alphaTab のリピートのまとまりも組み直している
    expect(getMasterBar(target.score, 1).repeatGroup.masterBars).toContain(getMasterBar(target.score, 1));

    cmd.undo();
    expectLinked(target);
  });

  it.each([
    [-3, 0],
    [99, 2],
  ])('insert_OutOfRangeAt(%s)_IsClampedTo(%s)', (at, expected) => {
    // UT-EDIT-BAR-06 10 節（足す位置は 0 から小節の数まで。範囲の外は端に寄せる）
    const target = multiBarTarget(2);
    const original = [getMasterBar(target.score, 0), getMasterBar(target.score, 1)];
    new InsertBarCommand(target, at).execute();
    expect(target.score.masterBars.indexOf(original[0]!)).toBe(expected === 0 ? 1 : 0);
    // 足した小節のテンポは継ぐ（空）。曲の頭に寄せたときは、元の 1 小節目にテンポ（100）があるので曲のテンポを置く（3.2 節、276 番）
    expect(getMasterBar(target.score, expected).tempoAutomations.map((a) => a.value)).toEqual(
      expected === 0 ? [100] : [],
    );
  });

  it('insertChildren_UndoBeforeExecute_DoesNothing', () => {
    // UT-EDIT-BAR-07 2.2 節（undo は execute の変更を打ち消すだけ）
    const target = multiBarTarget(2);
    const before = { score: scoreJson(target), meta: appMetaJson(target) };
    new InsertMasterBarCommand(target, 1).undo();
    new InsertPartBarCommand(target, 0, 1).undo();
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
  });

  it('insertMasterBar_IntoScoreWithoutBars_AddsFirstBarAsExplicitEntry', () => {
    // UT-EDIT-BAR-08 3.2 節「1 小節目は継ぐ先が無いので、いつも一覧に入れる。」（継ぐ先の小節が無いときは、元の 1 小節目の拍子を写さない）
    //   ・「どのコマンドも、undo で一覧を変更の前に戻す」
    const target = buildEditTarget();
    target.score.masterBars.splice(0);
    target.appMeta.settings.explicitTimeSignatureBars.splice(0);
    const cmd = new InsertMasterBarCommand(target, 0);
    cmd.execute();
    expect(barCount(target.score)).toBe(1);
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    cmd.undo();
    expect(barCount(target.score)).toBe(0);
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([]);
  });

  it('insert_EstimateSize_IsSumOfChildren', () => {
    // UT-EDIT-BAR-09 2.3 節「CompositeCommand の推定の大きさは、中のコマンドの推定の大きさの合計」
    const target = buildEditTarget(3);
    const cmd = new InsertBarCommand(target, 1);
    const children = [
      new InsertMasterBarCommand(target, 1),
      ...[0, 1, 2].map((t) => new InsertPartBarCommand(target, t, 1)),
    ];
    expect(cmd.estimateSizeBytes()).toBe(children.reduce((sum, c) => sum + c.estimateSizeBytes(), 0));
    expect([...children[1]!.affectedTrackIndices]).toEqual([0]);
  });
});

describe('DeleteBarCommand', () => {
  it('delete_RemovesFromAllStaves_Renumbers_UndoRestores', () => {
    // UT-EDIT-BAR-10 2.6 節の表「DeleteBarCommand は全部のパートから小節を消す」「CompositeCommand として構成する」「範囲は全部のパート」
    const target = multiBarTarget(3);
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new DeleteBarCommand(target, 1, 'delete');
    expect(cmd).toBeInstanceOf(CompositeCommand);
    expect(cmd.kind).toBe('delete-bar');
    expect(cmd.label).toBe('delete-bar');
    // 10 節：マーカーとメモ → パートごとの小節 → 曲共通の小節
    expect(childKinds(cmd)).toEqual([
      'move-bar-annotations',
      'delete-part-bar',
      'delete-part-bar',
      'delete-master-bar',
    ]);
    expect([...cmd.affectedTrackIndices]).toEqual([0, 1]);
    cmd.execute();
    expect(barCount(target.score)).toBe(2);
    expect(getStaff(target.score, 0).bars).toHaveLength(2);
    expect(getStaff(target.score, 1).bars).toHaveLength(2);
    // 旧 bar2（tempo 102）が新 bar1 へ詰まる
    expect(getMasterBar(target.score, 1).tempoAutomations[0]!.value).toBe(102);
    expectLinked(target);

    cmd.undo();
    expect(barCount(target.score)).toBe(3);
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
    expectLinked(target);
  });

  it('delete_MoveToPrevious_ReassignsMemoMarkerAndMirrorToPrevBar_UndoRestores', () => {
    // UT-EDIT-BAR-11 10 節「選択肢のもう 1 つは『直前の小節へ移動する』」（B2）
    const target = multiBarTarget(3);
    new AddMemoCommand(target, 1, 'bar1 memo', fixedNow).execute();
    new AddMemoCommand(target, 2, 'bar2 memo', fixedNow).execute();
    new AddSectionMarkerCommand(target, 1, 'bar1 sec').execute();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new DeleteBarCommand(target, 1, 'move-to-previous');
    cmd.execute();
    expect(target.appMeta.memos.map((m) => m.barId)).toEqual(['0', '1']);
    expect(target.appMeta.sectionMarkers[0]!.barId).toBe('0');
    expect(getMasterBar(target.score, 0).section?.text).toBe('bar1 sec');

    cmd.undo();
    expect(appMetaJson(target)).toBe(before.meta);
    expect(scoreJson(target)).toBe(before.score);
  });

  it('delete_MoveToPrevious_AtBarZero_MovesToNextBar_UndoRestores', () => {
    // UT-EDIT-BAR-12 10 節の (b)「消すのが 1 小節目のときは、次の小節（消した後の 1 小節目）へ移す」
    const target = multiBarTarget(3);
    new AddMemoCommand(target, 0, 'bar0 memo', fixedNow).execute();
    new AddSectionMarkerCommand(target, 0, 'intro').execute();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new DeleteBarCommand(target, 0, 'move-to-previous');
    cmd.execute();
    expect(target.appMeta.memos[0]!.barId).toBe('0');
    expect(target.appMeta.sectionMarkers[0]!.barId).toBe('0');
    expect(getMasterBar(target.score, 0).section?.text).toBe('intro');
    expect(getMasterBar(target.score, 0).tempoAutomations[0]!.value).toBe(101);

    cmd.undo();
    expect(appMetaJson(target)).toBe(before.meta);
    expect(scoreJson(target)).toBe(before.score);
  });

  it('moveAnnotations_MoveToPrevious_WhenNoOtherBar_DeletesThem_UndoRestores', () => {
    // UT-EDIT-BAR-13 10 節（移す先の小節が無いときは移せないので消す）
    const target = buildEditTarget();
    new AddMemoCommand(target, 0, 'only', fixedNow).execute();
    const before = appMetaJson(target);
    const cmd = new MoveBarAnnotationsCommand(target, 0, 'move-to-previous');
    cmd.execute();
    expect(target.appMeta.memos).toHaveLength(0);
    cmd.undo();
    expect(appMetaJson(target)).toBe(before);
  });

  it('delete_MoveToPrevious_MemoOnly_LeavesSectionMirrors', () => {
    // UT-EDIT-BAR-14 3.10 節（写しの MasterBar.section を動かすのはマーカーを移したときだけ）
    const target = multiBarTarget(3);
    new AddSectionMarkerCommand(target, 0, 'keep').execute();
    new AddMemoCommand(target, 1, 'm', fixedNow).execute();
    const cmd = new DeleteBarCommand(target, 1, 'move-to-previous');
    cmd.execute();
    expect(getMasterBar(target.score, 0).section?.text).toBe('keep');
    expect(target.appMeta.memos[0]!.barId).toBe('0');
  });

  it('delete_DeleteDisposition_RemovesAttachedMemoAndMarker_UndoRestores', () => {
    // UT-EDIT-BAR-15 10 節「選択肢の 1 つは『削除する』」（B2）
    const target = multiBarTarget(3);
    new AddMemoCommand(target, 1, 'doomed', fixedNow).execute();
    new AddMemoCommand(target, 2, 'survivor', fixedNow).execute();
    new AddSectionMarkerCommand(target, 1, 'gone').execute();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new DeleteBarCommand(target, 1, 'delete');
    cmd.execute();
    expect(target.appMeta.memos.map((m) => m.text)).toEqual(['survivor']);
    expect(target.appMeta.memos[0]!.barId).toBe('1'); // bar2 -> bar1
    expect(target.appMeta.sectionMarkers).toHaveLength(0);

    cmd.undo();
    expect(appMetaJson(target)).toBe(before.meta);
    expect(scoreJson(target)).toBe(before.score);
  });

  it('delete_NoneDisposition_KeepsOtherAnnotations_AndShiftsThem', () => {
    // UT-EDIT-BAR-16 10 節「消す小節にマーカーもメモも無ければ、すぐ DeleteBarCommand(at, 'none') を発行する」
    const target = multiBarTarget(3);
    new AddMemoCommand(target, 2, 'later', fixedNow).execute();
    const before = appMetaJson(target);
    const cmd = new DeleteBarCommand(target, 1, 'none');
    cmd.execute();
    expect(target.appMeta.memos[0]!.barId).toBe('1');
    cmd.undo();
    expect(appMetaJson(target)).toBe(before);
  });

  it('delete_ExplicitBars_RemovesDeletedAndShiftsLater_InheritanceKept', () => {
    // UT-EDIT-BAR-17 3.2 節「消した小節は一覧から外し、一覧の小節の番号を消した数だけずらす」・10 節「前後の小節が持つ継ぐ向きの指定は変わらない」
    const target = multiBarTarget(5);
    new SetTimeSignatureCommand(target, 1, { numerator: 3, denominator: 4 }).execute();
    new SetTimeSignatureCommand(target, 3, { numerator: 6, denominator: 8 }).execute();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new DeleteBarCommand(target, 1, 'none');
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 2]);
    // 消した小節を継いでいた小節は、こんどは 1 小節目を継ぐ
    expect(getMasterBar(target.score, 1).timeSignatureNumerator).toBe(4);
    expect(getMasterBar(target.score, 2).timeSignatureNumerator).toBe(6);

    cmd.undo();
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
  });

  it('delete_FirstBar_NextBarBecomesExplicitWithItsSignature', () => {
    // UT-EDIT-BAR-18 3.2 節「1 小節目は、いつも一覧に入れる」
    const target = multiBarTarget(3);
    new SetTimeSignatureCommand(target, 0, { numerator: 2, denominator: 4 }).execute();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };
    const cmd = new DeleteBarCommand(target, 0, 'none');
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect(getMasterBar(target.score, 0).timeSignatureNumerator).toBe(2);
    cmd.undo();
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
  });

  it('deleteMasterBar_OnlyBar_LeavesEmptyList_UndoRestores', () => {
    // UT-EDIT-BAR-19 3.2 節（小節が 1 つも無くなったときは 1 小節目を一覧に入れない）
    const target = buildEditTarget();
    const before = appMetaJson(target);
    const cmd = new DeleteMasterBarCommand(target, 0);
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([]);
    cmd.undo();
    expect(appMetaJson(target)).toBe(before);
    expect(barCount(target.score)).toBe(1);
  });

  it('deleteChildren_UndoBeforeExecute_DoesNothing', () => {
    // UT-EDIT-BAR-20 2.2 節（undo は execute の変更を打ち消すだけ）
    const target = multiBarTarget(2);
    new AddMemoCommand(target, 1, 'm', fixedNow).execute();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };
    new MoveBarAnnotationsCommand(target, 1, 'delete').undo();
    new DeletePartBarCommand(target, 0, 1).undo();
    new DeleteMasterBarCommand(target, 1).undo();
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
  });

  it('deleteBarChildren_OutOfRange_DoNothing', () => {
    // UT-EDIT-BAR-21 10 節（消す小節が無いときは何も持たない）
    const target = buildEditTarget();
    const before = { score: scoreJson(target), meta: appMetaJson(target) };
    const partBar = new DeletePartBarCommand(target, 0, 5);
    partBar.execute();
    partBar.undo();
    const masterBar = new DeleteMasterBarCommand(target, 5);
    masterBar.execute();
    masterBar.undo();
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
    expect(partBar.estimateSizeBytes()).toBe(new DeletePartBarCommand(target, 0, 9).estimateSizeBytes());
  });

  it('delete_EstimateSize_GrowsWithHeldNotes', () => {
    // UT-EDIT-BAR-22 2.3 節「DeleteBarCommand も、消した小節の全部のパートの中身を持つので大きくなる」
    const target = multiBarTarget(2);
    const empty = new DeleteBarCommand(target, 1, 'none').estimateSizeBytes();
    const bar = getStaff(target.score, 0).bars[1]!;
    const note = new model.Note();
    note.string = 1;
    bar.voices[0]!.beats[0]!.addNote(note);
    const withNote = new DeleteBarCommand(target, 1, 'none');
    expect(withNote.estimateSizeBytes()).toBeGreaterThan(empty);
    expect([...new DeletePartBarCommand(target, 1, 1).affectedTrackIndices]).toEqual([1]);
  });

  it('delete_FirstBar_NewFirstBarStartsWithSignatureInEffectBeforeDeletion_InheritedOrExplicit_UndoRestores', () => {
    // UT-EDIT-BAR-23 3.2 節「1 小節目は継ぐ先が無いので、いつも一覧に入れる」・「1 小節目を消したときは、新しい 1 小節目を一覧に入れ、
    // 元の 1 小節目の拍子で始める（…拍子の見た目は変わらない）」（消す前に効いていた拍子は、継ぐ向きの指定から求める）
    // editing-core.md 1113 行のとおり、undo の最後に一覧から写し直す（写しが食い違った曲では、undo の後に一覧どおりの拍子になる。2026-11-10 チャット側の決定 266 番）
    const target = multiBarTarget(4);
    new SetTimeSignatureCommand(target, 0, { numerator: 3, denominator: 4 }).execute();
    new SetTimeSignatureCommand(target, 2, { numerator: 6, denominator: 8 }).execute();
    // 継いでいる 2 小節目の MasterBar の写しが、継ぐ向きの指定と食い違っていても（読み込んだ曲のとき）、効いている拍子は 1 小節目の値
    getMasterBar(target.score, 1).timeSignatureNumerator = 5;
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new DeleteBarCommand(target, 0, 'none');
    cmd.execute();
    expect(target.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 1]);
    const first = getMasterBar(target.score, 0);
    expect([first.timeSignatureNumerator, first.timeSignatureDenominator]).toEqual([3, 4]);
    expect(getMasterBar(target.score, 1).timeSignatureNumerator).toBe(6);
    cmd.undo();
    expect(appMetaJson(target)).toBe(before.meta);
    // undo の最後に一覧から写し直す（10 節の (b)）ので、食い違っていた継いでいる 2 小節目の写しは 1 小節目の値になる。
    // その写しを除けば消す前と同じ
    expect(getMasterBar(target.score, 1).timeSignatureNumerator).toBe(3);
    getMasterBar(target.score, 1).timeSignatureNumerator = 5;
    expect(scoreJson(target)).toBe(before.score);

    // はっきり入れた 2 小節目は、その値のまま 1 小節目になる
    const explicitSecond = multiBarTarget(3);
    new SetTimeSignatureCommand(explicitSecond, 1, { numerator: 7, denominator: 8 }).execute();
    new DeleteBarCommand(explicitSecond, 0, 'none').execute();
    const head = getMasterBar(explicitSecond.score, 0);
    expect([head.timeSignatureNumerator, head.timeSignatureDenominator]).toEqual([7, 8]);
    expect(explicitSecond.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
  });

  it('delete_AnyBar_EveryRemainingBarKeepsBeats_RebuildBeforeRenderingSucceeds', () => {
    // UT-EDIT-BAR-24 3.3 節「小節を作ったときは、そのボイスに全音符の長さの休符の Beat を 1 つ置く」（小節の削除は小節ごと外すだけで、拍の無い小節を作らない）
    const target = multiBarTarget(3);
    for (const at of [0, 1, 2]) {
      const cmd = new DeleteBarCommand(target, at, 'none');
      cmd.execute();
      for (const [t] of target.score.tracks.entries()) {
        for (const bar of getStaff(target.score, t).bars) expect(bar.voices[0]!.beats.length).toBeGreaterThan(0);
      }
      expect(() => rebuildBeforeRender(target.score)).not.toThrow();
      cmd.undo();
    }
    expect(barCount(target.score)).toBe(3);
  });

  it('deleteMasterBar_Undo_ResolveInheritedTimeSignaturesLast_SignaturesUnchanged_InheritedBarsFollowList', () => {
    // UT-EDIT-BAR-25 10 節の (b)「resolveInheritedTimeSignatures は InsertMasterBarCommand・DeleteMasterBarCommand・
    // SetTimeSignatureCommand の execute と undo の最後に呼ぶ」（1 小節目を消したときの undo も、拍子の値を写し直すのは最後）
    const signatures = (target: EditTarget): number[][] =>
      target.score.masterBars.map((masterBar) => [
        masterBar.timeSignatureNumerator,
        masterBar.timeSignatureDenominator,
      ]);

    // 継ぐ向きの指定と写しがそろった曲では、どの小節を消して戻しても、どの小節の拍子も変わらない
    for (const at of [0, 1, 2, 4]) {
      const target = multiBarTarget(5);
      new SetTimeSignatureCommand(target, 0, { numerator: 3, denominator: 4 }).execute();
      new SetTimeSignatureCommand(target, 2, { numerator: 6, denominator: 8 }).execute();
      const before = { signatures: signatures(target), score: scoreJson(target), meta: appMetaJson(target) };
      const cmd = new DeleteMasterBarCommand(target, at);
      cmd.execute();
      cmd.undo();
      expect(signatures(target)).toEqual(before.signatures);
      expect(scoreJson(target)).toBe(before.score);
      expect(appMetaJson(target)).toBe(before.meta);
    }

    // 1 小節目を消して戻すとき、新しい 1 小節目だった小節の値を戻した後で一覧から写し直すので、継いでいる小節は
    // 一覧の小節の値になる（読み込んだ曲で写しが食い違っていても、undo の後に食い違いを残さない）
    const stale = multiBarTarget(4);
    new SetTimeSignatureCommand(stale, 0, { numerator: 3, denominator: 4 }).execute();
    getMasterBar(stale.score, 1).timeSignatureNumerator = 5;
    const cmd = new DeleteMasterBarCommand(stale, 0);
    cmd.execute();
    cmd.undo();
    expect(stale.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect(signatures(stale)).toEqual([
      [3, 4],
      [3, 4],
      [3, 4],
      [3, 4],
    ]);
  });
});

describe('曲の頭に小節を足す・1 小節目を消すときのテンポ（editing-core.md 3.2 節・10 節）', () => {
  /** N 小節の 2 パート target。テンポはどの小節にも置かない（全部の小節が曲のテンポを継ぐ）。 */
  function inheritingTarget(bars: number): EditTarget {
    const target = buildEditTarget(2);
    for (let i = 1; i < bars; i++) new InsertBarCommand(target, i).execute();
    return target;
  }
  const tempoAt = (bpm: number, ratioPosition: number): model.Automation =>
    model.Automation.buildTempoAutomation(false, ratioPosition, bpm, bpm, true);
  const tempos = (target: EditTarget, barIndex: number): number[] =>
    getMasterBar(target.score, barIndex).tempoAutomations.map((automation) => automation.value);

  it('insertAtHead_FirstBarHasTempo_NewFirstBarGetsSongTempo_SongTempoUnchanged_UndoRedo', () => {
    // UT-EDIT-BAR-26 10 節「テンポは曲のテンポのまま（元の 1 小節目にテンポがあれば、新しい 1 小節目にその値を置く…）」・3.2 節
    // 「曲の頭に足した新しい 1 小節目は元の 1 小節目のテンポで」（曲のテンポは alphaTab の Score.tempo＝1 小節目の最初の値）
    const target = inheritingTarget(2);
    getMasterBar(target.score, 0).tempoAutomations = [tempoAt(90, 0), tempoAt(110, 0.5)];
    const before = { score: scoreJson(target), meta: appMetaJson(target) };
    expect(target.score.tempo).toBe(90);

    const cmd = new InsertBarCommand(target, 0);
    cmd.execute();
    expect(tempos(target, 0)).toEqual([90]);
    expect(tempos(target, 1)).toEqual([90, 110]);
    expect(tempos(target, 2)).toEqual([]);
    expect(target.score.tempo).toBe(90);

    cmd.undo();
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);
    expect(target.score.tempo).toBe(90);

    cmd.execute();
    expect(tempos(target, 0)).toEqual([90]);
    expect(target.score.tempo).toBe(90);
  });

  it('insertAtHead_FirstBarWithoutTempo_PlacesNoTempo_SongTempoStaysDefault_UndoRedo', () => {
    // UT-EDIT-BAR-27 10 節「元の 1 小節目にテンポが無い曲では何も置かない」
    const target = inheritingTarget(2);
    const before = scoreJson(target);
    const songTempo = target.score.tempo;

    const cmd = new InsertBarCommand(target, 0);
    cmd.execute();
    expect(tempos(target, 0)).toEqual([]);
    expect(target.score.tempo).toBe(songTempo);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
    cmd.execute();
    expect(tempos(target, 0)).toEqual([]);
    expect(target.score.tempo).toBe(songTempo);
  });

  it('deleteFirstBar_SecondBarInherits_NewFirstBarGetsLastTempoOfOldFirstBar_UndoRemovesIt_RedoSame', () => {
    // UT-EDIT-BAR-28 3.2 節「1 小節目を消した後の新しい 1 小節目は消す前にその小節に効いていたテンポで始める」
    // （継いでいたなら元の 1 小節目の tempoAutomations の最後の値）
    const target = inheritingTarget(3);
    getMasterBar(target.score, 0).tempoAutomations = [tempoAt(90, 0), tempoAt(110, 0.5)];
    const before = { score: scoreJson(target), meta: appMetaJson(target) };

    const cmd = new DeleteBarCommand(target, 0, 'none');
    cmd.execute();
    expect(tempos(target, 0)).toEqual([110]);
    expect(tempos(target, 1)).toEqual([]);
    expect(target.score.tempo).toBe(110);

    cmd.undo();
    expect(tempos(target, 1)).toEqual([]);
    expect(scoreJson(target)).toBe(before.score);
    expect(appMetaJson(target)).toBe(before.meta);

    cmd.execute();
    expect(tempos(target, 0)).toEqual([110]);
    cmd.undo();
    expect(scoreJson(target)).toBe(before.score);
  });

  it('deleteFirstBar_FirstBarWithoutTempo_PlacesNoTempo_UndoRedo', () => {
    // UT-EDIT-BAR-29 3.2 節「元の 1 小節目にテンポが無い曲では何も置かない」
    const target = inheritingTarget(3);
    const before = scoreJson(target);
    const cmd = new DeleteBarCommand(target, 0, 'none');
    cmd.execute();
    expect(tempos(target, 0)).toEqual([]);
    cmd.undo();
    expect(scoreJson(target)).toBe(before);
    cmd.execute();
    expect(tempos(target, 0)).toEqual([]);
  });

  it('deleteFirstBar_SecondBarHasOwnTempo_KeepsIt_UndoRedo', () => {
    // UT-EDIT-BAR-30 3.2 節「消す前にその小節に効いていたテンポで始める」（自分のテンポを持っていればそのまま）
    const target = inheritingTarget(3);
    getMasterBar(target.score, 0).tempoAutomations = [tempoAt(90, 0)];
    const own = [tempoAt(100, 0), tempoAt(105, 0.5)];
    getMasterBar(target.score, 1).tempoAutomations = own;
    const before = scoreJson(target);

    const cmd = new DeleteBarCommand(target, 0, 'none');
    cmd.execute();
    expect(getMasterBar(target.score, 0).tempoAutomations).toBe(own);
    expect(tempos(target, 0)).toEqual([100, 105]);
    cmd.undo();
    expect(getMasterBar(target.score, 1).tempoAutomations).toBe(own);
    expect(scoreJson(target)).toBe(before);
    cmd.execute();
    expect(tempos(target, 0)).toEqual([100, 105]);
  });
});
