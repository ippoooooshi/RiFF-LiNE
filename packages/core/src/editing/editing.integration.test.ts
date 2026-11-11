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

import { DeleteBarCommand } from './commands/barCommands';
import { CommandHistory } from './commands/CommandHistory';
import type { BeatTechniquePatch, NoteTechniquePatch } from './commands/noteAttributeCommands';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { getBeat, getVoice, getBar, barCount, findNoteOnString, getMasterBar, getStaff } from './scoreModel';
import type { CommandAppliedEvent, CursorPosition } from './types';
import { createEmptyAppMetadata } from '../domain/SongDocument';
import {
  appMetaJson,
  countUndoable,
  RecordingRenderRequester,
  RecordingReporter,
  scoreJson,
} from '../testing/editingFakes';
import { makeEditingRig, makeSong, makeSongWithBars, type EditingRig } from '../testing/editingFixtures';
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

    // Note の単位は EditingService.setTechnique、Beat の単位は EditingService.setBeatTechnique（editing-core.md 4.8 節）
    const apply = (site: TechniqueSite, which: 'attach' | 'detach'): void => {
      rig.cursor.setPosition(site.position);
      if (site.probe.unit === 'note') {
        rig.service.setTechnique(site.stringNumber!, site.probe[which]);
      } else {
        rig.service.setBeatTechnique(site.probe[which]);
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

// ===== 小節の挿入と削除の継ぎ方（editing-core.md 10 節・3.2 節） =====
//
// editing-core.md 10 節「挿入の位置と継ぐ向きの組み合わせを含むこの 2 つ（挿入と削除の継ぎ方）は、C2（条件の網羅）まで自動テストで確かめる」を、
// EditingService の口（insertBar・deleteBar・setTimeSignature・setTempo・undo・redo）から通す。
// 曲は 5 小節・2 パート。1 小節目は 3/4 をはっきり入れ、残りの小節は組み合わせごとに、拍子をはっきり入れるか継ぐか（explicitTimeSignatureBars に
// あるか）、テンポを置くか継ぐか（MasterBar.tempoAutomations が空か）を決める。期待の値は、3.2 節の継ぎ方（一覧に無い小節は直前の小節の拍子、
// tempoAutomations が空の小節は直前の小節のテンポ）をテストの中の写し（Spec）に当てて作り、コードの答えを写さない。
//
// 網羅した条件（どの条件も真と偽の両方を、下の組み合わせのどれかで通す）
// | 番号 | 条件                                             | 真で通す所                         | 偽で通す所                         |
// | I1   | 挿入の位置が曲の頭                               | IT-EDIT-02                         | IT-EDIT-03・IT-EDIT-04             |
// | I2   | 挿入の位置が曲の終わり（小節の数と同じ位置）     | IT-EDIT-04                         | IT-EDIT-02・IT-EDIT-03             |
// | I3   | 挿入の位置の直前の小節が拍子をはっきり入れている | IT-EDIT-03・IT-EDIT-04 の真の行    | IT-EDIT-03・IT-EDIT-04 の偽の行    |
// | I4   | 挿入の位置の直後の小節が拍子をはっきり入れている | IT-EDIT-02（元の 1 小節目）・IT-EDIT-03 の真の行 | IT-EDIT-03 の偽の行   |
// | I5   | 挿入の位置の直前の小節にテンポがある             | IT-EDIT-03・IT-EDIT-04 の真の行    | IT-EDIT-03・IT-EDIT-04 の偽の行    |
// | I6   | 挿入の位置の直後の小節にテンポがある             | IT-EDIT-02・IT-EDIT-03 の真の行    | IT-EDIT-02・IT-EDIT-03 の偽の行    |
// | I7   | 曲の頭に足すとき、元の 2 小節目が拍子をはっきり入れている | IT-EDIT-02 の真の行       | IT-EDIT-02 の偽の行                |
// | D1   | 削除の位置が曲の頭                               | IT-EDIT-05                         | IT-EDIT-06・IT-EDIT-07             |
// | D2   | 削除の位置が曲の終わり（最後の小節）             | IT-EDIT-07                         | IT-EDIT-05・IT-EDIT-06             |
// | D3   | 消す小節の直前の小節が拍子をはっきり入れている   | IT-EDIT-06・IT-EDIT-07 の真の行    | IT-EDIT-06・IT-EDIT-07 の偽の行    |
// | D4   | 消す小節が拍子をはっきり入れている               | IT-EDIT-05（1 小節目）・IT-EDIT-06・IT-EDIT-07 の真の行 | IT-EDIT-06・IT-EDIT-07 の偽の行 |
// | D5   | 消す小節の直後の小節が拍子をはっきり入れている   | IT-EDIT-05・IT-EDIT-06 の真の行    | IT-EDIT-05・IT-EDIT-06 の偽の行    |
// | D6   | 消す小節の直前の小節にテンポがある               | IT-EDIT-06・IT-EDIT-07 の真の行    | IT-EDIT-06・IT-EDIT-07 の偽の行    |
// | D7   | 消す小節にテンポがある                           | IT-EDIT-05・IT-EDIT-06・IT-EDIT-07 の真の行 | IT-EDIT-05・IT-EDIT-06・IT-EDIT-07 の偽の行 |
// | D8   | 消す小節の直後の小節にテンポがある               | IT-EDIT-05・IT-EDIT-06 の真の行    | IT-EDIT-05・IT-EDIT-06 の偽の行    |
// | C1   | 挿入か削除の後に、それより前の小節の拍子とテンポを変える（10 節「新しい小節に自動で届く」「継ぐ向きの指定は変わらない」） | 全部の行 | 挿入か削除だけの段（変える前） |
// | C2   | undo の後に、拍子の値・一覧・テンポ・小節の数が元に戻る | 全部の行（undo の後）       | 全部の行（undo の前は変わっている）|
// | C3   | redo の後に、挿入か削除の後と同じになる          | 全部の行（redo の後）              | 全部の行（undo の後）              |
// | C4   | 元の 1 小節目にテンポがある（曲の頭に足した 1 小節目と、1 小節目を消した後の新しい 1 小節目にテンポを置くか。3.2 節・10 節、276 番）。曲のテンポ（alphaTab の Score.tempo）は、曲の頭に足しても変わらず、1 小節目を消すと消す前に 2 小節目に効いていたテンポになり、undo で元に、redo で挿入か削除の後と同じになる（全部の行で確かめる） | IT-EDIT-02・IT-EDIT-05・IT-EDIT-08 の真の行 | IT-EDIT-02・IT-EDIT-05・IT-EDIT-08 の偽の行 |
// | I8   | 曲の頭に足すとき、足す前の曲に小節がある（barCommands.ts の at === 0 && next !== undefined） | IT-EDIT-02・IT-EDIT-08     | IT-EDIT-09（小節が 0 の曲）        |
// 組み合わせの数：IT-EDIT-02 は 4、IT-EDIT-03 は 16、IT-EDIT-04 は 4、IT-EDIT-05 は 8、IT-EDIT-06 は 64、IT-EDIT-07 は 16、IT-EDIT-08 は 4、IT-EDIT-09 は 1（各テストの中の条件の全部の組み合わせ）。
// 単体テストで先に確かめていて、ここで重ねていないもの：足した小節の休符の拍と逆参照（UT-EDIT-BAR-05）、マーカーとメモの番号（UT-EDIT-BAR-03）、
// 継いでいる小節の写しが一覧と食い違った曲の 1 小節目の削除（UT-EDIT-BAR-23・UT-EDIT-BAR-25）、小節が 1 つも無くなる削除（UT-EDIT-BAR-19）、
// 1 小節目のテンポの変わり目が 2 つ以上ある曲（最初の値を頭に足した小節へ、最後の値を消した後の 1 小節目へ。UT-EDIT-BAR-26・UT-EDIT-BAR-28）。

type Signature = readonly [number, number];

/** 3.2 節の継ぎ方を当てるための、小節 1 つの写し。signature が null なら直前を継ぐ、tempo が null なら tempoAutomations が空。 */
interface BarSpec {
  signature: Signature | null;
  tempo: number | null;
}

/** 曲の小節 1 つについて、確かめる値（一覧にあるか・MasterBar の拍子の値・tempoAutomations の BPM）。 */
interface BarState {
  explicit: boolean;
  signature: Signature;
  tempo: number | null;
}

interface InheritanceLayout {
  label: string;
  explicitBars: readonly number[];
  tempoBars: readonly number[];
}

interface LayoutFlag {
  name: string;
  kind: 'explicit' | 'tempo';
  bar: number;
}

const INHERITANCE_BAR_COUNT = 5;
const INHERITANCE_PART_COUNT = 2;
const FIRST_SIGNATURE: Signature = [3, 4];
/** はっきり入れるときの小節ごとの拍子（どの小節の値かが見分けられるよう、全部違う値）。 */
const EXPLICIT_SIGNATURES: Readonly<Record<number, Signature>> = { 1: [2, 4], 2: [6, 8], 3: [7, 8], 4: [5, 4] };
/** テンポを置くときの小節ごとの BPM（全部違う値）。 */
const BAR_TEMPOS: Readonly<Record<number, number>> = { 0: 80, 1: 90, 2: 100, 3: 110, 4: 130 };
/** 挿入か削除の後に、それより前の小節へ入れ直す拍子とテンポ（10 節「後で挿入した位置より前の拍子やテンポを変えたとき」）。 */
const CHANGED_SIGNATURE: Signature = [12, 8];
const CHANGED_TEMPO = 150;

/** 条件の全部の組み合わせ（2 の条件の数の乗）を作る。 */
function inheritanceLayouts(flags: readonly LayoutFlag[]): InheritanceLayout[] {
  const layouts: InheritanceLayout[] = [];
  for (let mask = 0; mask < 1 << flags.length; mask++) {
    const on = flags.filter((_flag, i) => (mask & (1 << i)) !== 0);
    layouts.push({
      label: flags.map((flag) => `${flag.name}=${on.includes(flag) ? 'T' : 'F'}`).join(','),
      explicitBars: on.filter((flag) => flag.kind === 'explicit').map((flag) => flag.bar),
      tempoBars: on.filter((flag) => flag.kind === 'tempo').map((flag) => flag.bar),
    });
  }
  return layouts;
}

function specsOf(layout: InheritanceLayout): BarSpec[] {
  return Array.from({ length: INHERITANCE_BAR_COUNT }, (_v, i) => ({
    signature: i === 0 ? FIRST_SIGNATURE : layout.explicitBars.includes(i) ? EXPLICIT_SIGNATURES[i]! : null,
    tempo: layout.tempoBars.includes(i) ? BAR_TEMPOS[i]! : null,
  }));
}

/** 3.2 節：一覧に無い小節は、直前の小節の拍子を継ぐ（1 小節目はいつも一覧にある）。 */
function effectiveSignature(specs: readonly BarSpec[], index: number): Signature {
  for (let i = index; i >= 0; i--) {
    const signature = specs[i]!.signature;
    if (signature !== null) return signature;
  }
  throw new Error('1 小節目に拍子が無い');
}

function expectedStates(specs: readonly BarSpec[]): BarState[] {
  return specs.map((spec, i) => ({
    explicit: spec.signature !== null,
    signature: effectiveSignature(specs, i),
    tempo: spec.tempo,
  }));
}

/**
 * 10 節：新しい小節は拍子もテンポも直前を継ぐ。曲の頭に足した 1 小節目は、元の 1 小節目の拍子をはっきり入れ、テンポは曲のテンポのまま
 * （元の 1 小節目にテンポがあればその値を置き、無ければ継ぐ（空）。この曲の小節のテンポの変わり目は 1 つまでなので、最初の値はその値）。
 */
function insertSpec(specs: readonly BarSpec[], at: number): BarSpec[] {
  const next = [...specs];
  next.splice(at, 0, {
    signature: at === 0 ? effectiveSignature(specs, 0) : null,
    tempo: at === 0 ? specs[0]!.tempo : null,
  });
  return next;
}

/**
 * 10 節：前後の継ぐ向きは変えない。3.2 節：1 小節目を消したら、新しい 1 小節目は消す前に効いていた拍子をはっきり入れ、
 * テンポは自分のテンポがあればそのまま、継いでいたなら元の 1 小節目のテンポを置く（元の 1 小節目にも無ければ継ぐ（空）のまま）。
 */
function deleteSpec(specs: readonly BarSpec[], at: number): BarSpec[] {
  const next = [...specs];
  next.splice(at, 1);
  if (at === 0) next[0] = { signature: effectiveSignature(specs, 1), tempo: specs[1]!.tempo ?? specs[0]!.tempo };
  return next;
}

/** テンポがどの小節にも無い曲の、alphaTab の曲のテンポ（Score.tempo の既定の値。値を写さず alphaTab から読む）。 */
const DEFAULT_SONG_TEMPO = new model.Score().tempo;

/** 3.2 節：小節 index に効いているテンポ（直前へさかのぼって最初に見つかったテンポ。どの小節にも無ければ曲の既定のテンポ）。 */
function effectiveSpecTempo(specs: readonly BarSpec[], index: number): number {
  for (let i = index; i >= 0; i--) {
    const tempo = specs[i]!.tempo;
    if (tempo !== null) return tempo;
  }
  return DEFAULT_SONG_TEMPO;
}

function changeSpec(specs: readonly BarSpec[], index: number): BarSpec[] {
  const next = [...specs];
  next[index] = { signature: CHANGED_SIGNATURE, tempo: CHANGED_TEMPO };
  return next;
}

function observeStates(rig: EditingRig): BarState[] {
  const explicitBars = rig.target.appMeta.settings.explicitTimeSignatureBars;
  return rig.target.score.masterBars.map((masterBar, i) => {
    expect(masterBar.tempoAutomations.length, `小節 ${i} のテンポは 1 つまで`).toBeLessThanOrEqual(1);
    return {
      explicit: explicitBars.includes(i),
      signature: [masterBar.timeSignatureNumerator, masterBar.timeSignatureDenominator] as const,
      tempo: masterBar.tempoAutomations[0]?.value ?? null,
    };
  });
}

/** 3.2 節：tempoAutomations が空の小節は直前の小節のテンポ。どの小節にも無ければ曲のテンポ（alphaTab の Score.tempo）。 */
function effectiveTempo(rig: EditingRig, index: number): number {
  for (let i = index; i >= 0; i--) {
    const automation = getMasterBar(rig.target.score, i).tempoAutomations[0];
    if (automation !== undefined) return automation.value;
  }
  return rig.target.score.tempo;
}

function partBarCounts(rig: EditingRig): number[] {
  return rig.target.score.tracks.map((_track, t) => getStaff(rig.target.score, t).bars.length);
}

function setTempoAt(rig: EditingRig, barIndex: number, bpm: number): void {
  rig.service.setTempo(barIndex, bpm);
}

/** 5 小節・2 パートの曲を EditingService の口だけで組み、組み合わせの拍子とテンポを入れる。 */
function buildInheritanceRig(layout: InheritanceLayout): EditingRig {
  const rig = makeEditingRig(makeSong(INHERITANCE_PART_COUNT));
  for (let i = 1; i < INHERITANCE_BAR_COUNT; i++) rig.service.insertBar(i);
  rig.service.setTimeSignature(0, { numerator: FIRST_SIGNATURE[0], denominator: FIRST_SIGNATURE[1] });
  for (const bar of layout.explicitBars) {
    const [numerator, denominator] = EXPLICIT_SIGNATURES[bar]!;
    rig.service.setTimeSignature(bar, { numerator, denominator });
  }
  for (const bar of layout.tempoBars) setTempoAt(rig, bar, BAR_TEMPOS[bar]!);
  expect(rig.reporter.reports).toEqual([]);
  return rig;
}

/**
 * 挿入か削除を 1 つ通し、継ぎ方（C1）・undo（C2）・redo（C3）を確かめる。
 * `changeAt` は、挿入か削除の後に拍子とテンポを入れ直す小節（挿入か削除の位置より前。曲の頭への挿入だけは、元の 1 小節目）。
 */
async function runInheritanceCase(
  op: 'insert' | 'delete',
  at: number,
  layout: InheritanceLayout,
  changeAt: number,
): Promise<EditingRig> {
  const rig = buildInheritanceRig(layout);
  const specs = specsOf(layout);
  const before = { score: scoreJson(rig.target), meta: appMetaJson(rig.target), states: observeStates(rig) };
  expect(before.states, '組み立てた曲').toEqual(expectedStates(specs));
  // C4：曲のテンポ（Score.tempo）は、挿入の後は挿入の前のまま、1 小節目の削除の後は消す前に 2 小節目に効いていたテンポ。
  // 期待の値は、消す前（足す前）の写しから、新しい 1 小節目になる小節に効いていたテンポとして求める
  const songTempoBefore = effectiveSpecTempo(specs, 0);
  expect(rig.target.score.tempo, '組み立てた曲の曲のテンポ').toBe(songTempoBefore);
  const songTempoAfter = effectiveSpecTempo(specs, op === 'delete' && at === 0 ? 1 : 0);

  let afterSpecs: BarSpec[];
  if (op === 'insert') {
    rig.service.insertBar(at);
    afterSpecs = insertSpec(specs, at);
  } else {
    await rig.service.deleteBar(at);
    afterSpecs = deleteSpec(specs, at);
  }
  const after = expectedStates(afterSpecs);
  expect(observeStates(rig), `${op} の後`).toEqual(after);
  expect(rig.target.score.tempo, `${op} の後の曲のテンポ`).toBe(songTempoAfter);
  expect(partBarCounts(rig), `${op} の後のパートごとの小節の数`).toEqual(
    Array.from({ length: INHERITANCE_PART_COUNT }, () => afterSpecs.length),
  );

  // C1：前の小節の拍子とテンポを後で変えると、継いでいる小節（新しい小節を含む）に届く
  rig.service.setTimeSignature(changeAt, { numerator: CHANGED_SIGNATURE[0], denominator: CHANGED_SIGNATURE[1] });
  setTempoAt(rig, changeAt, CHANGED_TEMPO);
  expect(observeStates(rig), `${op} の後に小節 ${changeAt} を変えた後`).toEqual(
    expectedStates(changeSpec(afterSpecs, changeAt)),
  );
  rig.service.undo();
  rig.service.undo();
  expect(observeStates(rig), '変えたのを取り消した後').toEqual(after);

  // C2：undo で、拍子の値・一覧・テンポ・小節の数が元に戻る
  rig.service.undo();
  expect(observeStates(rig), `${op} を取り消した後`).toEqual(before.states);
  expect(rig.target.score.tempo, `${op} を取り消した後の曲のテンポ`).toBe(songTempoBefore);
  expect(barCount(rig.target.score)).toBe(INHERITANCE_BAR_COUNT);
  expect(partBarCounts(rig)).toEqual(Array.from({ length: INHERITANCE_PART_COUNT }, () => INHERITANCE_BAR_COUNT));
  expect(appMetaJson(rig.target)).toBe(before.meta);
  expect(scoreJson(rig.target)).toBe(before.score);

  // C3：redo で挿入か削除の後と同じになり、もう一度 undo すると元に戻る
  rig.service.redo();
  expect(observeStates(rig), `${op} をやり直した後`).toEqual(after);
  expect(rig.target.score.tempo, `${op} をやり直した後の曲のテンポ`).toBe(songTempoAfter);
  rig.service.undo();
  expect(scoreJson(rig.target)).toBe(before.score);
  expect(appMetaJson(rig.target)).toBe(before.meta);
  expect(rig.reporter.reports).toEqual([]);
  return rig;
}

// <!-- req editingcore:1557eff0.1379 --> <!-- req editingcore:1557eff0.3367 -->
describe('編集コア 小節の挿入と削除の継ぎ方（editing-core.md 10 節・3.2 節、C2）', () => {
  it.each(
    inheritanceLayouts([
      { name: 'nextTempo', kind: 'tempo', bar: 0 },
      { name: 'secondExplicit', kind: 'explicit', bar: 1 },
    ]),
  )('insertBar_AtHead[$label]_NewFirstBarExplicitWithOldFirstSignature_SongTempoKept_UndoRestores', async (layout) => {
    // IT-EDIT-02 editing-core.md 10 節「曲の頭に足した 1 小節目は除く（継ぐ先が無いので、元の 1 小節目の拍子で始める。テンポは曲のテンポのまま
    // （元の 1 小節目にテンポがあれば、新しい 1 小節目にその値を置く。元の 1 小節目にテンポが無い曲では何も置かない…）」
    const rig = await runInheritanceCase('insert', 0, layout, 1);
    rig.service.insertBar(0);
    const head = getMasterBar(rig.target.score, 0);
    expect([head.timeSignatureNumerator, head.timeSignatureDenominator]).toEqual(FIRST_SIGNATURE);
    expect(head.tempoAutomations.map((automation) => automation.value)).toEqual(
      layout.tempoBars.includes(0) ? [BAR_TEMPOS[0]] : [],
    );
  });

  it.each(
    inheritanceLayouts([
      { name: 'firstTempo', kind: 'tempo', bar: 0 },
      { name: 'secondExplicit', kind: 'explicit', bar: 1 },
    ]),
  )('insertBar_AtHead[$label]_SongTempoUnchanged_ThroughUndoRedo', (layout) => {
    // IT-EDIT-08 editing-core.md 10 節「テンポは曲のテンポのまま」（元の 1 小節目にテンポがある曲と無い曲。alphaTab の Score.tempo は
    // 1 小節目の tempoAutomations の最初の値なので、テンポがある曲では新しい 1 小節目にその値を置いて変えない。3.2 節、276 番）
    const rig = buildInheritanceRig(layout);
    const songTempo = rig.target.score.tempo;
    expect(songTempo).toBe(layout.tempoBars.includes(0) ? BAR_TEMPOS[0] : DEFAULT_SONG_TEMPO);
    rig.service.insertBar(0);
    expect(rig.target.score.tempo).toBe(songTempo);
    expect(effectiveTempo(rig, 0)).toBe(songTempo);
    expect(effectiveTempo(rig, 1)).toBe(songTempo);
    rig.service.undo();
    expect(rig.target.score.tempo).toBe(songTempo);
    expect(effectiveTempo(rig, 0)).toBe(songTempo);
    rig.service.redo();
    expect(rig.target.score.tempo).toBe(songTempo);
    expect(effectiveTempo(rig, 1)).toBe(songTempo);
  });

  it('insertBar_AtHeadOfSongWithoutBars_AddsOneBarWithDefaultSignatureInExplicitListAndNoTempo_UndoRestoresEmptyList', () => {
    // IT-EDIT-09 editing-core.md 3.2 節「1 小節目は継ぐ先が無いので、いつも一覧に入れる。」「曲の頭に小節を足したときは、新しい 1 小節目を一覧に入れ」の、
    // 元の 1 小節目が無い側（barCommands.ts の at === 0 && next !== undefined の偽）。小節が 0 の曲は、全部のパートの小節を消す DeleteBarCommand を
    // 履歴に通して作る（EditingService.deleteBar は最後の 1 小節を消さない）。写す元の 1 小節目が無いので拍子は alphaTab の MasterBar の既定のまま、
    // テンポは置かず、足した 1 小節目は一覧に入る（[0]）。undo で空の一覧（[]）に戻る
    const rig = makeEditingRig(makeSong(INHERITANCE_PART_COUNT));
    rig.service.setTimeSignature(0, { numerator: FIRST_SIGNATURE[0], denominator: FIRST_SIGNATURE[1] });
    setTempoAt(rig, 0, BAR_TEMPOS[0]!);
    rig.history.execute(new DeleteBarCommand(rig.target, 0, 'none'));
    expect(barCount(rig.target.score)).toBe(0);
    expect(partBarCounts(rig)).toEqual([0, 0]);
    expect(rig.target.appMeta.settings.explicitTimeSignatureBars).toEqual([]);
    const empty = { score: scoreJson(rig.target), meta: appMetaJson(rig.target) };

    const defaults = new model.MasterBar();
    const expectOneDefaultBar = (label: string): void => {
      expect(barCount(rig.target.score), label).toBe(1);
      expect(partBarCounts(rig), label).toEqual([1, 1]);
      const head = getMasterBar(rig.target.score, 0);
      expect([head.timeSignatureNumerator, head.timeSignatureDenominator], label).toEqual([
        defaults.timeSignatureNumerator,
        defaults.timeSignatureDenominator,
      ]);
      expect(rig.target.appMeta.settings.explicitTimeSignatureBars, label).toEqual([0]);
      expect(head.tempoAutomations, label).toEqual([]);
      expect(rig.target.score.tempo, label).toBe(DEFAULT_SONG_TEMPO);
    };
    rig.service.insertBar(0);
    expectOneDefaultBar('足した後');
    rig.service.undo();
    expect(rig.target.appMeta.settings.explicitTimeSignatureBars).toEqual([]);
    expect(scoreJson(rig.target)).toBe(empty.score);
    expect(appMetaJson(rig.target)).toBe(empty.meta);
    rig.service.redo();
    expectOneDefaultBar('やり直した後');
    expect(rig.reporter.reports).toEqual([]);
  });

  it.each(
    inheritanceLayouts([
      { name: 'prevExplicit', kind: 'explicit', bar: 1 },
      { name: 'nextExplicit', kind: 'explicit', bar: 2 },
      { name: 'prevTempo', kind: 'tempo', bar: 1 },
      { name: 'nextTempo', kind: 'tempo', bar: 2 },
    ]),
  )('insertBar_InMiddle[$label]_NewBarInheritsBoth_FollowsLaterChange_UndoRestores', async (layout) => {
    // IT-EDIT-03 editing-core.md 10 節「新しい小節の拍子は、いつも『直前を継ぐ』（null）で始める」「新しい小節のテンポも、いつも『直前を継ぐ』（null）で始める」
    // 「直前の値を写して固定の値にしない」「後で挿入した位置より前の拍子やテンポを変えたときにも、新しい小節に自動で届く」
    const rig = await runInheritanceCase('insert', 2, layout, 1);
    rig.service.insertBar(2);
    expect(rig.target.appMeta.settings.explicitTimeSignatureBars).not.toContain(2);
    expect(getMasterBar(rig.target.score, 2).tempoAutomations).toEqual([]);
    rig.service.setTimeSignature(1, { numerator: CHANGED_SIGNATURE[0], denominator: CHANGED_SIGNATURE[1] });
    setTempoAt(rig, 1, CHANGED_TEMPO);
    const inserted = getMasterBar(rig.target.score, 2);
    expect([inserted.timeSignatureNumerator, inserted.timeSignatureDenominator]).toEqual(CHANGED_SIGNATURE);
    expect(effectiveTempo(rig, 2)).toBe(CHANGED_TEMPO);
  });

  it.each(
    inheritanceLayouts([
      { name: 'prevExplicit', kind: 'explicit', bar: 4 },
      { name: 'prevTempo', kind: 'tempo', bar: 4 },
    ]),
  )('insertBar_AtEnd[$label]_NewBarInheritsLastBar_FollowsLaterChange_UndoRestores', async (layout) => {
    // IT-EDIT-04 editing-core.md 10 節「新しい小節の拍子は、いつも『直前を継ぐ』（null）で始める」・3.2 節「足した小節は一覧に入れず」
    const rig = await runInheritanceCase('insert', INHERITANCE_BAR_COUNT, layout, INHERITANCE_BAR_COUNT - 1);
    rig.service.insertBar(INHERITANCE_BAR_COUNT);
    rig.service.setTimeSignature(INHERITANCE_BAR_COUNT - 1, {
      numerator: CHANGED_SIGNATURE[0],
      denominator: CHANGED_SIGNATURE[1],
    });
    setTempoAt(rig, INHERITANCE_BAR_COUNT - 1, CHANGED_TEMPO);
    const inserted = getMasterBar(rig.target.score, INHERITANCE_BAR_COUNT);
    expect([inserted.timeSignatureNumerator, inserted.timeSignatureDenominator]).toEqual(CHANGED_SIGNATURE);
    expect(effectiveTempo(rig, INHERITANCE_BAR_COUNT)).toBe(CHANGED_TEMPO);
  });

  it.each(
    inheritanceLayouts([
      { name: 'nextExplicit', kind: 'explicit', bar: 1 },
      { name: 'deletedTempo', kind: 'tempo', bar: 0 },
      { name: 'nextTempo', kind: 'tempo', bar: 1 },
    ]),
  )('deleteBar_AtHead[$label]_NewFirstBarKeepsSignatureInEffect_UndoRestores', async (layout) => {
    // IT-EDIT-05 editing-core.md 3.2 節「1 小節目を消したときは、新しい 1 小節目（元の 2 小節目）を一覧に入れ、消す前にその小節に効いていた拍子で始める」
    // ・10 節「小節を消しても、前後の小節が持つ継ぐ向きの指定は変わらない」
    const rig = await runInheritanceCase('delete', 0, layout, 0);
    const secondBefore = getMasterBar(rig.target.score, 1);
    const signatureBefore = [secondBefore.timeSignatureNumerator, secondBefore.timeSignatureDenominator];
    await rig.service.deleteBar(0);
    const head = getMasterBar(rig.target.score, 0);
    expect(head).toBe(secondBefore);
    expect([head.timeSignatureNumerator, head.timeSignatureDenominator]).toEqual(signatureBefore);
    expect(rig.target.appMeta.settings.explicitTimeSignatureBars).toContain(0);
    // 3.2 節「1 小節目を消した後の新しい 1 小節目は消す前にその小節に効いていたテンポで始める（元の 1 小節目にテンポが無い曲では何も置かない）」
    const headTempo = layout.tempoBars.includes(1)
      ? BAR_TEMPOS[1]
      : layout.tempoBars.includes(0)
        ? BAR_TEMPOS[0]
        : null;
    expect(head.tempoAutomations.map((automation) => automation.value)).toEqual(headTempo === null ? [] : [headTempo]);
  });

  it.each(
    inheritanceLayouts([
      { name: 'prevExplicit', kind: 'explicit', bar: 1 },
      { name: 'deletedExplicit', kind: 'explicit', bar: 2 },
      { name: 'nextExplicit', kind: 'explicit', bar: 3 },
      { name: 'prevTempo', kind: 'tempo', bar: 1 },
      { name: 'deletedTempo', kind: 'tempo', bar: 2 },
      { name: 'nextTempo', kind: 'tempo', bar: 3 },
    ]),
  )('deleteBar_InMiddle[$label]_NeighborsKeepInheritDirection_UndoRestores', async (layout) => {
    // IT-EDIT-06 editing-core.md 10 節「小節を消しても、前後の小節が持つ継ぐ向きの指定は変わらない」
    // 「挿入と削除では一覧の小節の番号をずらすだけで、継ぐという指定そのものは変えない」
    const rig = await runInheritanceCase('delete', 2, layout, 1);
    await rig.service.deleteBar(2);
    // 元の 4 小節目（直後）は 3 小節目になり、一覧にあるか・テンポを持つかは消す前のまま
    expect(rig.target.appMeta.settings.explicitTimeSignatureBars.includes(2)).toBe(layout.explicitBars.includes(3));
    expect(getMasterBar(rig.target.score, 2).tempoAutomations.length > 0).toBe(layout.tempoBars.includes(3));
  });

  it.each(
    inheritanceLayouts([
      { name: 'prevExplicit', kind: 'explicit', bar: 3 },
      { name: 'deletedExplicit', kind: 'explicit', bar: 4 },
      { name: 'prevTempo', kind: 'tempo', bar: 3 },
      { name: 'deletedTempo', kind: 'tempo', bar: 4 },
    ]),
  )('deleteBar_AtEnd[$label]_RemainingBarsUnchanged_UndoRestores', async (layout) => {
    // IT-EDIT-07 editing-core.md 3.2 節「消した小節は一覧から外し」・10 節「前後の小節が持つ継ぐ向きの指定は変わらない」
    const rig = await runInheritanceCase('delete', INHERITANCE_BAR_COUNT - 1, layout, INHERITANCE_BAR_COUNT - 2);
    await rig.service.deleteBar(INHERITANCE_BAR_COUNT - 1);
    expect(rig.target.appMeta.settings.explicitTimeSignatureBars).not.toContain(INHERITANCE_BAR_COUNT - 1);
    expect(barCount(rig.target.score)).toBe(INHERITANCE_BAR_COUNT - 1);
  });
});
