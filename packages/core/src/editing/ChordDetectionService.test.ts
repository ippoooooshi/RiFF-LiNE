// UT-EDIT-CHORD: editing-core.md 8 節、基本設計 04 章 7 節 — ChordDetectionService
// 検証観点（C2）: 表の 14 の型の照らし合わせ（12 のルートへずらす）、転回形、2 つ以上の解釈が当たるときの選ぶ順
//   （一番低い音をルート・構成音の少ない型・表の上の型）、分数の形とシャープの音の名前、手で入れた値の優先、推し量れないときの null。

import { describe, expect, it } from 'vitest';

import { ChordDetectionService, detectFromPitchClasses } from './ChordDetectionService';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { SetChordNameCommand } from './commands/noteAttributeCommands';
import { getBeat, getStaff } from './scoreModel';
import { buildEditTarget } from '../testing/editingFakes';
import type { EditTarget } from './types';
import { model } from '@coderline/alphatab';

/** 高さの類の集まり（0 が C）。 */
const pcs = (...values: number[]): Set<number> => new Set(values);

const QUARTER = { duration: model.Duration.Quarter, dots: 0, tuplet: null } as const;
const BEAT0 = { trackIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 } as const;

/** 拍 0 に [弦, フレット] の音を置く（alphaTab の決まりで弦 1 が一番低い弦。チューニングは E2 A2 D3 G3 B3 E4）。 */
function placeChord(target: EditTarget, notes: readonly (readonly [number, number])[]): void {
  for (const [stringNumber, fret] of notes) {
    new PlaceNoteCommand(target, BEAT0, stringNumber, fret, QUARTER).execute();
  }
}

/** 弦 5 フレット 1（C4）・弦 4 フレット 0（G3）・弦 3 フレット 2（E3）。一番低い音は E3。 */
const C_OVER_E_SHAPE = [
  [5, 1],
  [4, 0],
  [3, 2],
] as const;

describe('detectFromPitchClasses', () => {
  it.each([
    ['C major', pcs(0, 4, 7), 0, 'C'],
    ['A minor', pcs(9, 0, 4), 9, 'Am'],
    ['G7', pcs(7, 11, 2, 5), 7, 'G7'],
    ['Cmaj7', pcs(0, 4, 7, 11), 0, 'Cmaj7'],
    ['Dm7', pcs(2, 5, 9, 0), 2, 'Dm7'],
    ['B dim', pcs(11, 2, 5), 11, 'Bdim'],
    ['C aug', pcs(0, 4, 8), 0, 'Caug'],
    ['D sus4', pcs(2, 7, 9), 2, 'Dsus4'],
    ['E5 power', pcs(4, 11), 4, 'E5'],
  ])('%s → %s', (_label, set, lowest, expected) => {
    expect(detectFromPitchClasses(set, lowest)?.name).toBe(expected);
  });

  it('singleNote_ReturnsNull', () => {
    expect(detectFromPitchClasses(pcs(0), 0)).toBeNull();
  });

  it('unknownCluster_ReturnsNull', () => {
    expect(detectFromPitchClasses(pcs(0, 1, 2, 3), 0)).toBeNull();
  });

  it.each([
    [1, [0, 4, 7], ''],
    [2, [0, 3, 7], 'm'],
    [3, [0, 7], '5'],
    [4, [0, 5, 7], 'sus4'],
    [5, [0, 2, 7], 'sus2'],
    [6, [0, 3, 6], 'dim'],
    [7, [0, 4, 8], 'aug'],
    [8, [0, 4, 7, 10], '7'],
    [9, [0, 3, 7, 10], 'm7'],
    [10, [0, 4, 7, 11], 'maj7'],
    [11, [0, 4, 7, 9], '6'],
    [12, [0, 3, 7, 9], 'm6'],
    [13, [0, 3, 6, 10], 'm7b5'],
    [14, [0, 3, 6, 9], 'dim7'],
  ] as const)(
    'detectFromPitchClasses_表の%i番目の型を12のルートへずらし一番低い音をルートにする_ルートの名前と型の字を返す',
    (_order, intervals, suffix) => {
      // UT-EDIT-CHORD-01 editing-core.md 8 節の表・「表の型を 12 のルートのどれかへずらしたものと、ちょうど同じになるかで見る」・「音の名前はシャープで書く（C・C#・D・D#・E・F・F#・G・G#・A・A#・B）」
      const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      for (let root = 0; root < 12; root++) {
        const set = new Set(intervals.map((interval) => (root + interval) % 12));
        expect(detectFromPitchClasses(set, root)).toEqual({ name: `${names[root]!}${suffix}`, rootPitchClass: root });
      }
    },
  );

  it('detectFromPitchClasses_一番低い音がルートでない3和音_ルートの名前と一番低い音の名前の分数の形で返す', () => {
    // UT-EDIT-CHORD-02 editing-core.md 8 節「選んだ解釈のルートが一番低い音でないときは、「ルートの名前/一番低い音の名前」の分数の形（C/E）で出す」・「集まりで見るので、転回形（どの音が一番下か）によらず同じ型に当たる」
    expect(detectFromPitchClasses(pcs(4, 7, 0), 4)).toEqual({ name: 'C/E', rootPitchClass: 0 });
    expect(detectFromPitchClasses(pcs(0, 4, 7), 7)).toEqual({ name: 'C/G', rootPitchClass: 0 });
    expect(detectFromPitchClasses(pcs(1, 5, 8), 8)).toEqual({ name: 'C#/G#', rootPitchClass: 1 });
  });

  it('detectFromPitchClasses_C6とAm7の両方に当たる集まり_一番低い音をルートとする解釈を選ぶ', () => {
    // UT-EDIT-CHORD-03 editing-core.md 8 節「同じ集まりに 2 つ以上の解釈が当たるとき（C6 と Am7 の 0・4・7・9 と 9・0・4・7）は、(1) 一番低い音をルートとする解釈」
    expect(detectFromPitchClasses(pcs(0, 4, 7, 9), 0)).toEqual({ name: 'C6', rootPitchClass: 0 });
    expect(detectFromPitchClasses(pcs(0, 4, 7, 9), 9)).toEqual({ name: 'Am7', rootPitchClass: 9 });
  });

  it('detectFromPitchClasses_C6とAm7のどちらのルートも一番低い音でない_表の上にあるm7を選び分数の形にする', () => {
    // UT-EDIT-CHORD-04 editing-core.md 8 節「(1) 一番低い音をルートとする解釈、(2) 構成音の少ない型、(3) 表の上にある型、の順で 1 つを選ぶ」（m7 は表の 9 番目、6 は 11 番目）
    expect(detectFromPitchClasses(pcs(0, 4, 7, 9), 4)).toEqual({ name: 'Am7/E', rootPitchClass: 9 });
    expect(detectFromPitchClasses(pcs(0, 4, 7, 9), 7)).toEqual({ name: 'Am7/G', rootPitchClass: 9 });
    // m6 と m7b5（Cm6 と Am7b5 の 0・3・7・9）：m6 は表の 12 番目、m7b5 は 13 番目
    expect(detectFromPitchClasses(pcs(0, 3, 7, 9), 0)).toEqual({ name: 'Cm6', rootPitchClass: 0 });
    expect(detectFromPitchClasses(pcs(0, 3, 7, 9), 9)).toEqual({ name: 'Am7b5', rootPitchClass: 9 });
    expect(detectFromPitchClasses(pcs(0, 3, 7, 9), 3)).toEqual({ name: 'Cm6/D#', rootPitchClass: 0 });
  });

  it('detectFromPitchClasses_どの音をルートにしても同じ型に当たる集まり_一番低い音をルートにして分数にしない', () => {
    // UT-EDIT-CHORD-05 editing-core.md 8 節「(1) 一番低い音をルートとする解釈」（dim7 と aug は 4 つと 3 つのルートで同じ集まりになる）
    expect(detectFromPitchClasses(pcs(0, 3, 6, 9), 0)).toEqual({ name: 'Cdim7', rootPitchClass: 0 });
    expect(detectFromPitchClasses(pcs(0, 3, 6, 9), 6)).toEqual({ name: 'F#dim7', rootPitchClass: 6 });
    expect(detectFromPitchClasses(pcs(0, 4, 8), 4)).toEqual({ name: 'Eaug', rootPitchClass: 4 });
  });

  it('detectFromPitchClasses_空の集まりと型に無い組み合わせ_名前を出さない', () => {
    // UT-EDIT-CHORD-06 editing-core.md 8 節「表に当たらない集まり（1 つの音だけ・型に無い組み合わせ）は名前を出さない」
    expect(detectFromPitchClasses(pcs(), 0)).toBeNull();
    expect(detectFromPitchClasses(pcs(7), 7)).toBeNull();
    expect(detectFromPitchClasses(pcs(0, 4), 0)).toBeNull();
    expect(detectFromPitchClasses(pcs(0, 2, 4, 7), 0)).toBeNull(); // add9 は表に無い
    expect(detectFromPitchClasses(pcs(0, 4, 7, 10, 2), 0)).toBeNull(); // 9 は表に無い
  });
});

describe('ChordDetectionService', () => {
  it('detect_FromBeatNotes_UsesTuningAndFret', () => {
    // alphaTab 規約：note.string=1 が最低音弦。tuning[6-string] が開放弦ピッチ。
    // string5(B=59) fret1 = C(60), string4(G=55) fret0 = G, string3(D=50) fret2 = E（一番低い音）→ C の和音で、一番下が E
    const target = buildEditTarget();
    placeChord(target, C_OVER_E_SHAPE);

    const svc = new ChordDetectionService();
    const beat = getBeat(target.score, 0, 0, 0);
    expect(svc.detect(target.score, 0, beat)?.name).toBe('C/E');
  });

  it('resolveDisplayName_PrefersOverride', () => {
    const target = buildEditTarget();
    placeChord(target, C_OVER_E_SHAPE);
    new SetChordNameCommand(target, BEAT0, 'C add9').execute();

    const svc = new ChordDetectionService();
    const beat = getBeat(target.score, 0, 0, 0);
    expect(svc.resolveDisplayName(target.score, 0, beat)).toBe('C add9'); // 推定 'C/E' より override
  });

  it('resolveDisplayName_RestBeat_ReturnsNull', () => {
    const target = buildEditTarget();
    const svc = new ChordDetectionService();
    expect(svc.resolveDisplayName(target.score, 0, getBeat(target.score, 0, 0, 0))).toBeNull();
  });

  it('detect_一番低い弦の音がルートでない_実際の音の高さで一番低い音を決め分数の形にする', () => {
    // UT-EDIT-CHORD-07 editing-core.md 8 節「構成音は、弦のチューニングとフレットから実際の音の高さを出して求める」・「和声の解析は、当たった解釈のうちどれをルートとするかを、一番低い音（転回形でどの音が下にあるか）と型の音の数で選び」
    const target = buildEditTarget();
    // 弦 1 フレット 0（E2）・弦 4 フレット 0（G3）・弦 5 フレット 1（C4）
    placeChord(target, [
      [1, 0],
      [4, 0],
      [5, 1],
    ]);
    const beat = getBeat(target.score, 0, 0, 0);
    expect(new ChordDetectionService().detect(target.score, 0, beat)).toEqual({ name: 'C/E', rootPitchClass: 0 });

    // 弦 2 フレット 3（C3）を足すと、一番低い音は E2 のまま
    placeChord(target, [[2, 3]]);
    expect(new ChordDetectionService().detect(target.score, 0, beat)?.name).toBe('C/E');
  });

  it('detect_一番低い音がルートの和音_分数にせずルートの名前で返す', () => {
    // UT-EDIT-CHORD-08 editing-core.md 8 節「確定した和音から、ルートの音を推し量る」・「確定した和音から、コードの種類（下の表の 14 の型）を推し量る」
    const target = buildEditTarget();
    // 弦 2 フレット 3（C3）・弦 3 フレット 2（E3）・弦 4 フレット 0（G3）・弦 5 フレット 1（C4）
    placeChord(target, [
      [2, 3],
      [3, 2],
      [4, 0],
      [5, 1],
    ]);
    const beat = getBeat(target.score, 0, 0, 0);
    expect(new ChordDetectionService().detect(target.score, 0, beat)).toEqual({ name: 'C', rootPitchClass: 0 });
  });

  it('detect_カポを付けたパート_カポの分も足した実際の音の高さで推し量る', () => {
    // UT-EDIT-CHORD-09 editing-core.md 8 節「構成音は、弦のチューニングとフレットから実際の音の高さを出して求める（カポの分も足す。」
    const target = buildEditTarget();
    placeChord(target, [
      [2, 3],
      [3, 2],
      [4, 0],
      [5, 1],
    ]);
    getStaff(target.score, 0).capo = 2;
    const beat = getBeat(target.score, 0, 0, 0);
    expect(new ChordDetectionService().detect(target.score, 0, beat)).toEqual({ name: 'D', rootPitchClass: 2 });
  });

  it('resolveDisplayName_手で入れた値が空の文字列_推し量った名前を返す', () => {
    // UT-EDIT-CHORD-10 editing-core.md 8 節「欄が空なら推し量った候補を出し、値があれば手で入れた値を優先して出す」・「手での指定の欄の実体は、alphaTab の `Beat.text` とする」
    const target = buildEditTarget();
    placeChord(target, C_OVER_E_SHAPE);
    const beat = getBeat(target.score, 0, 0, 0);
    beat.text = '';
    expect(new ChordDetectionService().resolveDisplayName(target.score, 0, beat)).toBe('C/E');
  });
});
