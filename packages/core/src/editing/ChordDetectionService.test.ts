// UT-EDIT-CHORD: editing-core.md §8、04_editing_core.md §7 — ChordDetectionService
// 検証観点（C2）: 既知コードフォーム辞書の照合（メジャー/マイナー/7th/maj7/sus/dim/aug/power）、
//   転回形、override 優先、推定不能で null。

import { describe, expect, it } from 'vitest';

import { ChordDetectionService, detectFromPitchClasses } from './ChordDetectionService';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { SetChordNameCommand } from './commands/noteAttributeCommands';
import { getBeat } from './scoreModel';
import { buildEditTarget } from '../testing/editingFakes';
import { model } from '@coderline/alphatab';

/** ピッチクラス集合（0=C）。 */
const pcs = (...values: number[]): Set<number> => new Set(values);

describe('detectFromPitchClasses', () => {
  it.each([
    ['C major', pcs(0, 4, 7), 'C'],
    ['A minor', pcs(9, 0, 4), 'Am'],
    ['G7', pcs(7, 11, 2, 5), 'G7'],
    ['Cmaj7', pcs(0, 4, 7, 11), 'Cmaj7'],
    ['Dm7', pcs(2, 5, 9, 0), 'Dm7'],
    ['B dim', pcs(11, 2, 5), 'Bdim'],
    ['C aug', pcs(0, 4, 8), 'Caug'],
    ['D sus4', pcs(2, 7, 9), 'Dsus4'],
    ['E5 power', pcs(4, 11), 'E5'],
  ])('%s → %s', (_label, set, expected) => {
    expect(detectFromPitchClasses(set)?.name).toBe(expected);
  });

  it('firstInversion_StillDetectsRoot', () => {
    // C/E（E G C）= C major の第一転回。ピッチクラス集合は同じなので C と判定される。
    expect(detectFromPitchClasses(pcs(4, 7, 0))?.name).toBe('C');
  });

  it('singleNote_ReturnsNull', () => {
    expect(detectFromPitchClasses(pcs(0))).toBeNull();
  });

  it('unknownCluster_ReturnsNull', () => {
    expect(detectFromPitchClasses(pcs(0, 1, 2, 3))).toBeNull();
  });
});

describe('ChordDetectionService', () => {
  it('detect_FromBeatNotes_UsesTuningAndFret', () => {
    // 標準チューニング [64,59,55,50,45,40]（string1..6）。
    // string5(A=45) fret3 = C(48→pc0), string4(D=50) fret2 = E(52→pc4), string3(G=55) fret0 = G(55→pc7) → C major
    const target = buildEditTarget();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 5, 3, model.Duration.Quarter).execute();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 4, 2, model.Duration.Quarter).execute();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, 0, model.Duration.Quarter).execute();

    const svc = new ChordDetectionService();
    const beat = getBeat(target.score, 0, 0, 0);
    expect(svc.detect(target.score, 0, beat)?.name).toBe('C');
  });

  it('resolveDisplayName_PrefersOverride', () => {
    const target = buildEditTarget();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 5, 3, model.Duration.Quarter).execute();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 4, 2, model.Duration.Quarter).execute();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, 0, model.Duration.Quarter).execute();
    new SetChordNameCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 'C add9').execute();

    const svc = new ChordDetectionService();
    const beat = getBeat(target.score, 0, 0, 0);
    expect(svc.resolveDisplayName(target.score, 0, beat)).toBe('C add9'); // 推定 'C' より override
  });

  it('resolveDisplayName_RestBeat_ReturnsNull', () => {
    const target = buildEditTarget();
    const svc = new ChordDetectionService();
    expect(svc.resolveDisplayName(target.score, 0, getBeat(target.score, 0, 0, 0))).toBeNull();
  });
});
