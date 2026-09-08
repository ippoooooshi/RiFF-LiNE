// UT: playback-integration.md §3.2 / §7、00_reference.md §2 — computeRealMidiPitch（カポ実音変換式、B18）
//
// 検証観点（§7 で C2 指定＝境界値網羅）:
//  - 式 openStringPitch + capoFret + frettedFret に一致
//  - capoFret 境界（0 / 12）× frettedFret 境界（0 / 24）の全組み合わせ
//  - 負値・非整数でも純粋な加算として振る舞う（範囲チェックは呼び出し側責務）

import { describe, expect, it } from 'vitest';

import { computeRealMidiPitch } from './pitch';

describe('computeRealMidiPitch', () => {
  it('computeRealMidiPitch_NoCapoOpenString_ReturnsOpenStringPitch', () => {
    // UT: §3.2 — capo 0・fret 0 は開放弦ピッチそのもの
    expect(computeRealMidiPitch(40, 0, 0)).toBe(40);
  });

  it('computeRealMidiPitch_NoCapoFrettedNote_AddsFretOnly', () => {
    // UT: §3.2
    expect(computeRealMidiPitch(40, 0, 5)).toBe(45);
  });

  it('computeRealMidiPitch_WithCapoOpenString_AddsCapoOnly', () => {
    // UT: §3.2
    expect(computeRealMidiPitch(40, 3, 0)).toBe(43);
  });

  it('computeRealMidiPitch_WithCapoAndFret_AddsBoth', () => {
    // UT: §3.2 — 実音 = 開放弦 + capo + fret
    expect(computeRealMidiPitch(64, 7, 12)).toBe(83);
  });

  // C2：capoFret 境界（0 / 12）× frettedFret 境界（0 / 24）
  const openStringPitch = 50;
  const capoBoundaries = [0, 12];
  const fretBoundaries = [0, 24];
  for (const capoFret of capoBoundaries) {
    for (const frettedFret of fretBoundaries) {
      it(`computeRealMidiPitch_CapoBoundary${capoFret}_FretBoundary${frettedFret}_MatchesFormula`, () => {
        // UT: §7 C2 境界値網羅
        expect(computeRealMidiPitch(openStringPitch, capoFret, frettedFret)).toBe(
          openStringPitch + capoFret + frettedFret,
        );
      });
    }
  }

  it('computeRealMidiPitch_AllFretsZeroToTwentyFour_MatchFormula', () => {
    // UT: §7 C2 — フレット 0〜24 の連続値
    for (let fret = 0; fret <= 24; fret += 1) {
      expect(computeRealMidiPitch(45, 5, fret)).toBe(45 + 5 + fret);
    }
  });

  it('computeRealMidiPitch_NegativeAndFractionalInputs_PureAddition', () => {
    // UT: §3.2 — 純粋な加算（範囲チェックは呼び出し側）
    expect(computeRealMidiPitch(-1, -2, -3)).toBe(-6);
    expect(computeRealMidiPitch(40.5, 0, 0)).toBe(40.5);
  });
});
