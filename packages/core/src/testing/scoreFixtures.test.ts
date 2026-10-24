// UT-FIXTURE-SCORE: 開発用サンプルデータの関数（makeTechniqueCoverageScore・makeLargeScore・makeMultiPartScore）
// 検証節: web-core-foundation.md 14.9 節

import { model } from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';

import { MAX_PART_COUNT } from '../parts';

import { makeLargeScore, makeMultiPartScore, makeTechniqueCoverageScore } from './scoreFixtures';

function beatsOf(score: model.Score): model.Beat[] {
  return score.tracks.flatMap((t) => t.staves.flatMap((s) => s.bars.flatMap((b) => b.voices.flatMap((v) => v.beats))));
}

function notesOf(score: model.Score): model.Note[] {
  return beatsOf(score).flatMap((b) => b.notes);
}

/** 基本設計 04 章 6 節の Note の単位と Beat の単位の行の奏法記号と、02 章 3.3 節のアーティキュレーションの 5 つ。 */
const EXPECTED: readonly [string, (score: model.Score) => boolean][] = [
  ['チョーキング', (s) => notesOf(s).some((n) => n.bendType === model.BendType.Bend && n.hasBend)],
  ['スライド', (s) => notesOf(s).some((n) => n.slideOutType !== model.SlideOutType.None)],
  ['HP-PO', (s) => notesOf(s).some((n) => n.isHammerPullOrigin && n.hammerPullDestination !== null)],
  ['パームミュート', (s) => notesOf(s).some((n) => n.isPalmMute)],
  ['ビブラート', (s) => notesOf(s).some((n) => n.vibrato !== model.VibratoType.None)],
  ['自然ハーモニクス', (s) => notesOf(s).some((n) => n.harmonicType === model.HarmonicType.Natural)],
  ['人工ハーモニクス', (s) => notesOf(s).some((n) => n.harmonicType === model.HarmonicType.Artificial)],
  ['ピンチハーモニクス', (s) => notesOf(s).some((n) => n.harmonicType === model.HarmonicType.Pinch)],
  ['アクセント', (s) => notesOf(s).some((n) => n.accentuated === model.AccentuationType.Normal)],
  ['強いアクセント', (s) => notesOf(s).some((n) => n.accentuated === model.AccentuationType.Heavy)],
  ['テヌート', (s) => notesOf(s).some((n) => n.accentuated === model.AccentuationType.Tenuto)],
  ['スタッカート', (s) => notesOf(s).some((n) => n.isStaccato)],
  ['ゴースト', (s) => notesOf(s).some((n) => n.isGhost)],
  ['タッピング', (s) => beatsOf(s).some((b) => b.tap)],
  ['スラップ', (s) => beatsOf(s).some((b) => b.slap)],
  ['ポップ', (s) => beatsOf(s).some((b) => b.pop)],
  ['ブラシ', (s) => beatsOf(s).some((b) => b.brushType !== model.BrushType.None && b.notes.length > 1)],
];

describe('scoreFixtures（14.9 節）', () => {
  it('makeTechniqueCoverageScore_短い曲に奏法記号を全部少なくとも1回ずつ含む', () => {
    // UT-FIXTURE-SCORE-01 14.9 節の表「奏法記号の網羅」
    const score = makeTechniqueCoverageScore();
    const missing = EXPECTED.filter(([, has]) => !has(score)).map(([name]) => name);
    expect(missing).toEqual([]);
    expect(score.tracks).toHaveLength(1);
    expect(score.masterBars.length).toBeLessThanOrEqual(EXPECTED.length + 1);
  });

  it('makeLargeScore_2048小節の4パートと8パート', () => {
    // UT-FIXTURE-SCORE-02 14.9 節の表「大曲」（2048 小節で、4 パートと 8 パートの 2 つ）
    for (const partCount of [4, 8] as const) {
      const score = makeLargeScore({ barCount: 2048, partCount });
      expect(score.masterBars).toHaveLength(2048);
      expect(score.tracks).toHaveLength(partCount);
      for (const track of score.tracks) expect(track.staves[0]?.bars).toHaveLength(2048);
    }
  });

  it('makeLargeScore_小節の番号で奏法記号を回し全部を含む', () => {
    // UT-FIXTURE-SCORE-03 14.8 節の手順 1「2048 小節・全部の奏法記号を含む」
    const score = makeLargeScore({ barCount: 40, partCount: 4 });
    expect(EXPECTED.filter(([, has]) => !has(score)).map(([name]) => name)).toEqual([]);
  });

  it('makeLargeScore_小節の数が1以上の整数でなければ投げる', () => {
    // UT-FIXTURE-SCORE-04
    expect(() => makeLargeScore({ barCount: 0, partCount: 4 })).toThrow(RangeError);
    expect(() => makeLargeScore({ barCount: 1.5, partCount: 4 })).toThrow(RangeError);
    expect(makeLargeScore({ barCount: 1, partCount: 4 }).masterBars).toHaveLength(1);
  });

  it('makeMultiPartScore_上限の8パートと複数のチューニングとカポ', () => {
    // UT-FIXTURE-SCORE-05 14.9 節の表「複数のパート」
    const score = makeMultiPartScore();
    expect(score.tracks).toHaveLength(MAX_PART_COUNT);
    const tunings = new Set(score.tracks.map((t) => t.staves[0]?.stringTuning.tunings.join(',')));
    expect(tunings.size).toBe(MAX_PART_COUNT);
    expect(score.tracks.filter((t) => (t.staves[0]?.capo ?? 0) > 0).length).toBeGreaterThan(0);
  });

  it('どの関数も呼ばれるたびに新しいScoreを返し書き換えが別の呼び出しに及ばない', () => {
    // UT-FIXTURE-SCORE-06 14.9 節「どの関数も毎回新しいオブジェクトを返す」
    const makers = [
      makeTechniqueCoverageScore,
      () => makeLargeScore({ barCount: 2, partCount: 4 }),
      makeMultiPartScore,
    ];
    for (const make of makers) {
      const a = make();
      const b = make();
      expect(a).not.toBe(b);
      a.title = 'changed';
      a.tracks[0]!.name = 'changed';
      expect(b.title).not.toBe('changed');
      expect(b.tracks[0]?.name).not.toBe('changed');
    }
  });
});
