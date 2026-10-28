// UT-CORE-VALID: 上限の定数と確かめる関数（domain/validation.ts）
// 検証節: data-model-persistence.md 6.2 節・6.3 節・9 節、基本設計 02 章 4.3 節、C12・C13
// 検証観点: メモの切り詰めと、見た目の 1 文字（書記素）での数え方（C13）、曲数・タグ数の境界（C0/C1）。

import { describe, expect, it } from 'vitest';

import {
  canCreateTag,
  clampMemoText,
  evaluateSongCount,
  MEMO_MAX_LENGTH,
  SONG_COUNT_LIMIT,
  SONG_COUNT_WARN_THRESHOLD,
  TAG_COUNT_LIMIT,
} from './validation';

describe('clampMemoText', () => {
  it('clampMemoText_WithinLimit_ReturnsAsIs', () => {
    // UT-CORE-VALID-01
    const r = clampMemoText('あ'.repeat(MEMO_MAX_LENGTH));
    expect(r.truncated).toBe(false);
    expect(r.value).toHaveLength(MEMO_MAX_LENGTH);
  });

  it('clampMemoText_ExceedsLimit_TruncatesToLimit', () => {
    // UT-CORE-VALID-02
    const r = clampMemoText('a'.repeat(MEMO_MAX_LENGTH + 50));
    expect(r.truncated).toBe(true);
    expect(Array.from(r.value)).toHaveLength(MEMO_MAX_LENGTH);
  });

  it('clampMemoText_SurrogatePairEmoji_CountsAsOneCharacterNotUtf16Units', () => {
    // UT-CORE-VALID-03
    // 絵文字はサロゲートペア。UTF-16 の単位ではなく、見た目の 1 文字（書記素）で数える（data-model-persistence.md 6.2 節）。
    const r = clampMemoText('🎸'.repeat(MEMO_MAX_LENGTH + 10));
    expect(Array.from(r.value)).toHaveLength(MEMO_MAX_LENGTH);
    expect(r.truncated).toBe(true);
  });

  it('clampMemoText_EmptyString_NotTruncated', () => {
    // UT-CORE-VALID-04
    expect(clampMemoText('')).toEqual({ value: '', truncated: false });
  });
});

describe('evaluateSongCount', () => {
  it('evaluateSongCount_BelowWarnThreshold_Ok', () => {
    // UT-CORE-VALID-05
    expect(evaluateSongCount(SONG_COUNT_WARN_THRESHOLD - 1)).toBe('ok');
  });

  it('evaluateSongCount_AtWarnThreshold_Warn', () => {
    // UT-CORE-VALID-06
    expect(evaluateSongCount(SONG_COUNT_WARN_THRESHOLD)).toBe('warn');
  });

  it('evaluateSongCount_BelowLimit_Warn', () => {
    // UT-CORE-VALID-07
    expect(evaluateSongCount(SONG_COUNT_LIMIT - 1)).toBe('warn');
  });

  it('evaluateSongCount_AtLimit_Limit', () => {
    // UT-CORE-VALID-08
    expect(evaluateSongCount(SONG_COUNT_LIMIT)).toBe('limit');
  });
});

describe('canCreateTag', () => {
  it('canCreateTag_BelowLimit_True', () => {
    // UT-CORE-VALID-09
    expect(canCreateTag(TAG_COUNT_LIMIT - 1)).toBe(true);
  });

  it('canCreateTag_AtLimit_False', () => {
    // UT-CORE-VALID-10
    expect(canCreateTag(TAG_COUNT_LIMIT)).toBe(false);
  });

  it('canCreateTag_上限は50_49件なら作れて50件なら作れない', () => {
    // UT-CORE-VALID-11 data-model-persistence.md 6.3 節：タグの総数の上限は 50
    expect(TAG_COUNT_LIMIT).toBe(50);
    expect(canCreateTag(49)).toBe(true);
    expect(canCreateTag(50)).toBe(false);
  });
});

describe('clampMemoText（見た目の 1 文字で数える）', () => {
  it('clampMemoText_上限は100文字_100文字はそのまま101文字は切り詰める', () => {
    // UT-CORE-VALID-12 data-model-persistence.md 6.2 節：本文の文字数の上限は 100 文字（MEMO_MAX_LENGTH）
    expect(MEMO_MAX_LENGTH).toBe(100);
    expect(clampMemoText('x'.repeat(100))).toEqual({ value: 'x'.repeat(100), truncated: false });
    expect(clampMemoText('x'.repeat(101))).toEqual({ value: 'x'.repeat(100), truncated: true });
  });

  it('clampMemoText_いくつかの符号位置からできた絵文字_1つで1文字と数える', () => {
    // UT-CORE-VALID-13 data-model-persistence.md 6.2 節：絵文字も 1 つで 1 文字。いくつかの符号位置からできた絵文字も 1 つに数える
    const family = '👨‍👩‍👧'; // 5 つの符号位置
    const flag = '🇯🇵'; // 2 つの符号位置
    const accent = 'é'; // 結合文字つき
    for (const glyph of [family, flag, accent]) {
      expect(clampMemoText(glyph.repeat(100))).toEqual({ value: glyph.repeat(100), truncated: false });
      expect(clampMemoText(glyph.repeat(101))).toEqual({ value: glyph.repeat(100), truncated: true });
    }
  });

  it('clampMemoText_改行_改行も1文字でCRとLFの組も1文字と数える', () => {
    // UT-CORE-VALID-14 data-model-persistence.md 6.2 節：本文には改行を入れられ、改行も 1 文字。改行の CR と LF の組も 1 つに数える
    expect(clampMemoText('\n'.repeat(101))).toEqual({ value: '\n'.repeat(100), truncated: true });
    const withCrLf = `${'あ'.repeat(99)}\r\n`;
    expect(clampMemoText(withCrLf)).toEqual({ value: withCrLf, truncated: false });
    expect(clampMemoText(`${withCrLf}い`)).toEqual({ value: withCrLf, truncated: true });
  });
});
