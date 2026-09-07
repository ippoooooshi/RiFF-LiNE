// UT: data-model-persistence.md §7、02_data_model.md §4.3、C12・C13 — domain/validation.ts
// 検証観点: メモ切り詰め（C13）、曲数・タグ数の境界（C0/C1）。

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
    const r = clampMemoText('あ'.repeat(MEMO_MAX_LENGTH));
    expect(r.truncated).toBe(false);
    expect(r.value).toHaveLength(MEMO_MAX_LENGTH);
  });

  it('clampMemoText_ExceedsLimit_TruncatesToLimit', () => {
    const r = clampMemoText('a'.repeat(MEMO_MAX_LENGTH + 50));
    expect(r.truncated).toBe(true);
    expect(Array.from(r.value)).toHaveLength(MEMO_MAX_LENGTH);
  });

  it('clampMemoText_CountsCodePointsNotUtf16Units', () => {
    // 絵文字はサロゲートペア。コードポイント単位で数える。
    const r = clampMemoText('🎸'.repeat(MEMO_MAX_LENGTH + 10));
    expect(Array.from(r.value)).toHaveLength(MEMO_MAX_LENGTH);
    expect(r.truncated).toBe(true);
  });

  it('clampMemoText_EmptyString_NotTruncated', () => {
    expect(clampMemoText('')).toEqual({ value: '', truncated: false });
  });
});

describe('evaluateSongCount', () => {
  it('evaluateSongCount_BelowWarnThreshold_Ok', () => {
    expect(evaluateSongCount(SONG_COUNT_WARN_THRESHOLD - 1)).toBe('ok');
  });

  it('evaluateSongCount_AtWarnThreshold_Warn', () => {
    expect(evaluateSongCount(SONG_COUNT_WARN_THRESHOLD)).toBe('warn');
  });

  it('evaluateSongCount_BelowLimit_Warn', () => {
    expect(evaluateSongCount(SONG_COUNT_LIMIT - 1)).toBe('warn');
  });

  it('evaluateSongCount_AtLimit_Limit', () => {
    expect(evaluateSongCount(SONG_COUNT_LIMIT)).toBe('limit');
  });
});

describe('canCreateTag', () => {
  it('canCreateTag_BelowLimit_True', () => {
    expect(canCreateTag(TAG_COUNT_LIMIT - 1)).toBe(true);
  });

  it('canCreateTag_AtLimit_False', () => {
    expect(canCreateTag(TAG_COUNT_LIMIT)).toBe(false);
  });
});
