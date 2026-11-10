// IT-EDIT: editing-core.md 2 節（コマンド層と操作の履歴。採番簿の web-core-foundation.md 14.4 節が指す節）— タブ譜編集コアの結合シナリオ
// 検証観点:
//  - ステップ入力→和音→タイ→奏法→コード検出→Undo/Redo→範囲コピー&ペースト→小節挿入削除 の通し（editing-core.md 4.8 節の EditingService の口）
//  - 複数編集ウィンドウ（CommandHistory 2 インスタンス）の Undo/Redo 独立性（editing-core.md 2.3 節「履歴は窓ごとに別」）
//  - onCommandApplied が全経路で発火
//  - 2048 小節フィクスチャでの小節追加拒否（EDIT-003、editing-core.md 3.9 節）
//  - 履歴のメモリの予算での破棄と下限（EDIT-008、editing-core.md 2.3 節）
//  - 奏法記号の網羅のフィクスチャ（web-core-foundation.md 14.9 節）を使う機能の網羅（editing-core.md 3.5 節）

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { CommandHistory } from './commands/CommandHistory';
import {
  SetBeatTechniqueCommand,
  type BeatTechniquePatch,
  type NoteTechniquePatch,
} from './commands/noteAttributeCommands';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { getBeat, getVoice, getBar, barCount, findNoteOnString } from './scoreModel';
import type { CommandAppliedEvent, CursorPosition } from './types';
import { createEmptyAppMetadata } from '../domain/SongDocument';
import { countUndoable, RecordingRenderRequester, RecordingReporter, scoreJson } from '../testing/editingFakes';
import { makeEditingRig, makeSong, makeSongWithBars } from '../testing/editingFixtures';
import { makeTechniqueCoverageScore } from '../testing/scoreFixtures';

describe('編集コア 通しシナリオ', () => {
  it('stepInput_Chord_Tie_Technique_Chord_Undo_Redo_Paste_BarOps', async () => {
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
    rig.cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    rig.cursor.enterChordInput();
    rig.service.placeNote(2, 5);
    expect(getBeat(rig.target.score, 0, 0, 0).notes).toHaveLength(2);
    rig.cursor.exitChordInput(rig.target);

    // タイ：beat0 の弦3（タイの始まりの音符）から、同じ弦の次の音符（beat1）へタイ（editing-core.md 3.4 節）
    rig.cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    rig.service.setTie(3, true);
    expect(getBeat(rig.target.score, 0, 0, 1).notes[0]!.isTieDestination).toBe(true);

    // 奏法記号：beat2 の弦3へパームミュート
    rig.cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 2 });
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
      voiceIndex: 0,
      startBarIndex: 0,
      startBeatIndex: 0,
      endBarIndex: 0,
      endBeatIndex: 1,
    });
    rig.service.copySelection();
    rig.cursor.setPosition({ trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 3 });
    rig.service.paste();
    expect(getVoice(getBar(rig.target.score, 0, 0)).beats.length).toBe(5);
    rig.service.undo(); // paste を戻す
    expect(getVoice(getBar(rig.target.score, 0, 0)).beats.length).toBe(3);

    // 小節挿入 → 削除
    rig.service.insertBar(1);
    expect(barCount(rig.target.score)).toBe(2);
    await rig.service.deleteBar(1);
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

    expect(countUndoable(a.history)).toBe(2);
    expect(countUndoable(b.history)).toBe(1);

    // b で Undo しても a には影響しない
    b.service.undo();
    expect(b.history.canUndo()).toBe(false);
    expect(countUndoable(a.history)).toBe(2);
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
        new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 }, 3, 5, {
          duration: model.Duration.Quarter,
          dots: 0,
          tuplet: null,
        }),
      );
    }
    expect(countUndoable(history)).toBe(3); // 下限を維持
    expect(reporter.reports.filter((r) => r.code === 'EDIT-008')).toHaveLength(1);
  });
});

/** 奏法記号の 1 つ。Note の単位は SetTechniqueCommand、Beat の単位は SetBeatTechniqueCommand で付け外しする（editing-core.md 3.5 節の表）。 */
type TechniqueProbe =
  | {
      name: string;
      unit: 'note';
      has: (note: model.Note) => boolean;
      attach: NoteTechniquePatch;
      detach: NoteTechniquePatch;
    }
  | {
      name: string;
      unit: 'beat';
      has: (beat: model.Beat) => boolean;
      attach: BeatTechniquePatch;
      detach: BeatTechniquePatch;
    };

/**
 * web-core-foundation.md 14.9 節の「奏法記号の網羅」が挙げる奏法記号の全部（チョーキング・スライド・HP-PO・パームミュート・
 * ビブラート・ハーモニクスの 3 種・タッピング・スラップ・ポップ・ブラシ・アーティキュレーションの 5 つ）。
 * 持つ所と alphaTab の属性は editing-core.md 3.5 節の表、アーティキュレーションの外し方は同じ節の「外すときは」の箇条。
 */
const COVERAGE_TECHNIQUES: readonly TechniqueProbe[] = [
  {
    name: 'チョーキング',
    unit: 'note',
    has: (n) => n.bendType === model.BendType.Bend && (n.bendPoints?.length ?? 0) > 0,
    attach: {
      bendType: model.BendType.Bend,
      bendPoints: [
        { offset: 0, value: 0 },
        { offset: model.BendPoint.MaxPosition, value: 4 },
      ],
    },
    detach: { bendType: model.BendType.None, bendPoints: [] },
  },
  {
    name: 'スライド',
    unit: 'note',
    has: (n) => n.slideOutType !== model.SlideOutType.None,
    attach: { slideOutType: model.SlideOutType.Shift },
    detach: { slideOutType: model.SlideOutType.None },
  },
  {
    name: 'HP-PO（ハンマリングとプリング）',
    unit: 'note',
    has: (n) => n.isHammerPullOrigin,
    attach: { isHammerPullOrigin: true },
    detach: { isHammerPullOrigin: false },
  },
  {
    name: 'パームミュート',
    unit: 'note',
    has: (n) => n.isPalmMute,
    attach: { isPalmMute: true },
    detach: { isPalmMute: false },
  },
  {
    name: 'ビブラート',
    unit: 'note',
    has: (n) => n.vibrato !== model.VibratoType.None,
    attach: { vibrato: model.VibratoType.Slight },
    detach: { vibrato: model.VibratoType.None },
  },
  {
    name: '自然ハーモニクス',
    unit: 'note',
    has: (n) => n.harmonicType === model.HarmonicType.Natural,
    attach: { harmonicType: model.HarmonicType.Natural },
    detach: { harmonicType: model.HarmonicType.None },
  },
  {
    name: '人工ハーモニクス',
    unit: 'note',
    has: (n) => n.harmonicType === model.HarmonicType.Artificial && n.harmonicValue === 12,
    attach: { harmonicType: model.HarmonicType.Artificial, harmonicValue: 12 },
    detach: { harmonicType: model.HarmonicType.None, harmonicValue: 0 },
  },
  {
    name: 'ピンチハーモニクス',
    unit: 'note',
    has: (n) => n.harmonicType === model.HarmonicType.Pinch,
    attach: { harmonicType: model.HarmonicType.Pinch },
    detach: { harmonicType: model.HarmonicType.None },
  },
  {
    name: 'タッピング',
    unit: 'beat',
    has: (b) => b.tap,
    attach: { tap: true },
    detach: { tap: false },
  },
  {
    name: 'スラップ',
    unit: 'beat',
    has: (b) => b.slap,
    attach: { slap: true },
    detach: { slap: false },
  },
  {
    name: 'ポップ',
    unit: 'beat',
    has: (b) => b.pop,
    attach: { pop: true },
    detach: { pop: false },
  },
  {
    name: 'ブラシ',
    unit: 'beat',
    has: (b) => b.brushType !== model.BrushType.None,
    attach: { brushType: model.BrushType.BrushDown },
    detach: { brushType: model.BrushType.None },
  },
  {
    name: 'アクセント',
    unit: 'note',
    has: (n) => n.accentuated === model.AccentuationType.Normal,
    attach: { accentuated: model.AccentuationType.Normal },
    detach: { accentuated: model.AccentuationType.None },
  },
  {
    name: '強いアクセント',
    unit: 'note',
    has: (n) => n.accentuated === model.AccentuationType.Heavy,
    attach: { accentuated: model.AccentuationType.Heavy },
    detach: { accentuated: model.AccentuationType.None },
  },
  {
    name: 'テヌート',
    unit: 'note',
    has: (n) => n.accentuated === model.AccentuationType.Tenuto,
    attach: { accentuated: model.AccentuationType.Tenuto },
    detach: { accentuated: model.AccentuationType.None },
  },
  {
    name: 'スタッカート',
    unit: 'note',
    has: (n) => n.isStaccato,
    attach: { isStaccato: true },
    detach: { isStaccato: false },
  },
  {
    name: 'ゴースト',
    unit: 'note',
    has: (n) => n.isGhost,
    attach: { isGhost: true },
    detach: { isGhost: false },
  },
];

/** フィクスチャの中で奏法記号が付いている所。Note の単位なら弦の番号も持つ。 */
interface TechniqueSite {
  probe: TechniqueProbe;
  position: CursorPosition;
  stringNumber: number | null;
}

/** パート 0 のボイス 0 を頭から見て、その奏法記号が付いた最初の所を返す。無ければ null。 */
function findTechniqueSite(score: model.Score, probe: TechniqueProbe): TechniqueSite | null {
  const bars = score.tracks[0]!.staves[0]!.bars;
  for (let barIndex = 0; barIndex < bars.length; barIndex++) {
    const beats = getVoice(bars[barIndex]!).beats;
    for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
      const beat = beats[beatIndex]!;
      const position: CursorPosition = { trackIndex: 0, barIndex, voiceIndex: 0, beatIndex };
      if (probe.unit === 'beat') {
        if (probe.has(beat)) return { probe, position, stringNumber: null };
        continue;
      }
      const note = beat.notes.find((n) => probe.has(n));
      if (note !== undefined) return { probe, position, stringNumber: note.string };
    }
  }
  return null;
}

/** その所に奏法記号が今も付いているか。 */
function hasTechniqueAt(score: model.Score, site: TechniqueSite): boolean {
  const beat = getBeat(score, 0, site.position.barIndex, site.position.beatIndex);
  if (site.probe.unit === 'beat') return site.probe.has(beat);
  const note = findNoteOnString(beat, site.stringNumber!);
  return note !== null && site.probe.has(note);
}

describe('編集コア 奏法記号の網羅（web-core-foundation.md 14.9 節のフィクスチャ、editing-core.md 3.5 節）', () => {
  // <!-- req editingcore:18069b26.110f --> <!-- req editingcore:18069b26.3167 --> <!-- req editingcore:18069b26.dc2e -->
  it('techniqueCoverageScore_AllTechniques_AttachDetachAndUndo_ThroughEditingPath', () => {
    // IT-EDIT-01 editing-core.md 3.5 節「14.9 節の「奏法記号の網羅」のフィクスチャを使う機能の網羅のテストは、…結合テストで行う」
    const rig = makeEditingRig({ score: makeTechniqueCoverageScore(), appMeta: createEmptyAppMetadata() });
    const original = scoreJson(rig.target);

    // Note の単位は EditingService.setTechnique、Beat の単位は SetBeatTechniqueCommand を CommandHistory へ渡す
    // （今の EditingService に、editing-core.md 4.8 節の setBeatTechnique が無いため）
    const apply = (site: TechniqueSite, which: 'attach' | 'detach'): void => {
      rig.cursor.setPosition(site.position);
      if (site.probe.unit === 'note') {
        rig.service.setTechnique(site.stringNumber!, site.probe[which]);
      } else {
        rig.history.execute(new SetBeatTechniqueCommand(rig.target, rig.cursor.position, site.probe[which]));
      }
    };
    const expectEach = (sites: readonly TechniqueSite[], present: boolean, step: string): void => {
      for (const site of sites) {
        expect(hasTechniqueAt(rig.target.score, site), `${site.probe.name}（${step}）`).toBe(present);
      }
    };

    // フィクスチャは、挙げた奏法記号の全部を少なくとも 1 回ずつ含む
    const sites: TechniqueSite[] = [];
    for (const probe of COVERAGE_TECHNIQUES) {
      const site = findTechniqueSite(rig.target.score, probe);
      expect(site, `${probe.name}（フィクスチャに含まれる）`).not.toBeNull();
      sites.push(site!);
    }
    expect(sites).toHaveLength(17);

    // 外す
    for (const site of sites) apply(site, 'detach');
    expectEach(sites, false, '外した後');

    // 付ける
    for (const site of sites) apply(site, 'attach');
    expectEach(sites, true, '付けた後');

    // 取り消す：付けたのを戻すと外れた形へ、外したのを戻すとフィクスチャの形へ戻る
    for (let i = 0; i < sites.length; i++) rig.service.undo();
    expectEach(sites, false, '付けたのを取り消した後');
    for (let i = 0; i < sites.length; i++) rig.service.undo();
    expectEach(sites, true, '外したのを取り消した後');
    expect(rig.history.canUndo()).toBe(false);
    expect(scoreJson(rig.target)).toBe(original);
  });
});
