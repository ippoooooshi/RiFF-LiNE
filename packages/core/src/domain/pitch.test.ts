// UT-CORE-PITCH: カポの運指から実音の MIDI の高さを出す computeRealMidiPitch
// 検証節: playback-integration.md 9.1 節、web-core-foundation.md 14.3 節の組み合わせの表
// 検証観点: 開放弦の音高 ＋ capoFret ＋ 記譜のフレットの足し算になること、境目の値（capoFret の 0 と 12、フレットの 0 と 24）の組を全部（C2）、
// 範囲を確かめず足し算だけをすること（範囲は入力の側で守る）。

import { describe, expect, it } from 'vitest';

import { computeRealMidiPitch } from './pitch';

/** 境目の値の組で使う開放弦の音高。 */
const OPEN = 50;

describe('computeRealMidiPitch', () => {
  it('computeRealMidiPitch_カポなし開放弦_開放弦の音高そのもの', () => {
    // UT-CORE-PITCH-01 playback-integration.md 9.1 節：capoFret が 0 のときは足す値が 0 になる
    expect(computeRealMidiPitch(40, 0, 0)).toBe(40);
  });

  it('computeRealMidiPitch_カポなしで押さえる_フレットだけを足す', () => {
    // UT-CORE-PITCH-02 playback-integration.md 9.1 節：記譜のフレットの番号を足す
    expect(computeRealMidiPitch(40, 0, 5)).toBe(45);
  });

  it('computeRealMidiPitch_カポありの開放弦_カポだけを足す', () => {
    // UT-CORE-PITCH-03 playback-integration.md 9.1 節：開放弦の音高に capoFret を足す
    expect(computeRealMidiPitch(40, 3, 0)).toBe(43);
  });

  it('computeRealMidiPitch_カポありで押さえる_両方を足す', () => {
    // UT-CORE-PITCH-04 playback-integration.md 9.1 節：実音 ＝ 開放弦の音高 ＋ capoFret ＋ 記譜のフレット
    expect(computeRealMidiPitch(64, 7, 12)).toBe(83);
  });

  it('computeRealMidiPitch_カポ0とフレット0_開放弦の音高', () => {
    // UT-CORE-PITCH-05 playback-integration.md 9.1 節 (b)：境目の値の組（capoFret 0 × フレット 0）
    expect(computeRealMidiPitch(OPEN, 0, 0)).toBe(OPEN);
  });

  it('computeRealMidiPitch_カポ0とフレット24_フレットの上端を足す', () => {
    // UT-CORE-PITCH-08 playback-integration.md 9.1 節 (b)：境目の値の組（capoFret 0 × フレット 24）
    expect(computeRealMidiPitch(OPEN, 0, 24)).toBe(OPEN + 24);
  });

  it('computeRealMidiPitch_カポ12とフレット0_カポの上端を足す', () => {
    // UT-CORE-PITCH-09 playback-integration.md 9.1 節 (b)：境目の値の組（capoFret 12 × フレット 0）
    expect(computeRealMidiPitch(OPEN, 12, 0)).toBe(OPEN + 12);
  });

  it('computeRealMidiPitch_カポ12とフレット24_両方の上端を足す', () => {
    // UT-CORE-PITCH-10 playback-integration.md 9.1 節 (b)：境目の値の組（capoFret 12 × フレット 24）
    expect(computeRealMidiPitch(OPEN, 12, 24)).toBe(OPEN + 12 + 24);
  });

  it('computeRealMidiPitch_フレット0から24_どれも式のとおり', () => {
    // UT-CORE-PITCH-06 playback-integration.md 9.1 節：フレット 0 から 24 の続いた値
    for (let fret = 0; fret <= 24; fret += 1) {
      expect(computeRealMidiPitch(45, 5, fret)).toBe(45 + 5 + fret);
    }
  });

  it('computeRealMidiPitch_カポ0から12_どれも式のとおり', () => {
    // UT-CORE-PITCH-11 playback-integration.md 9.1 節：capoFret の範囲 0 から 12 の続いた値
    for (let capo = 0; capo <= 12; capo += 1) {
      expect(computeRealMidiPitch(40, capo, 3)).toBe(40 + capo + 3);
    }
  });

  it('computeRealMidiPitch_負の値と小数_範囲を確かめず足すだけ', () => {
    // UT-CORE-PITCH-07 playback-integration.md 9.1 節：本関数では範囲を確かめない。足し算だけで場合分けを持たない
    expect(computeRealMidiPitch(-1, -2, -3)).toBe(-6);
    expect(computeRealMidiPitch(40.5, 0, 0)).toBe(40.5);
  });
});
