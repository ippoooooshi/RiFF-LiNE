// UT-FS-ERRORS: 軽量エラークラス（`FileNotFoundError` 等）
// 検証節: 00_reference.md 3.1 節、data-model-persistence.md 10.1 節
// UT: 00_reference.md 3.1 節、data-model-persistence.md 10.1 節 — ファイル I/O の軽量エラークラス
import { describe, expect, it } from 'vitest';

import { FileNotFoundError, FileReadError, FileWriteError } from './errors';

describe('FileNotFoundError', () => {
  it('FileNotFoundError_HasNameCodeAndPath', () => {
    // UT-FS-ERRORS-01
    const err = new FileNotFoundError('songs/a.tabapp');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FileNotFoundError);
    expect(err.name).toBe('FileNotFoundError');
    expect(err.code).toBe('FILE_NOT_FOUND');
    expect(err.path).toBe('songs/a.tabapp');
    expect(err.message).toContain('songs/a.tabapp');
  });

  it('FileNotFoundError_PreservesCauseViaOptions', () => {
    // UT-FS-ERRORS-02
    const cause = new Error('ENOENT');
    const err = new FileNotFoundError('x', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('FileReadError', () => {
  it('FileReadError_HasNameCodeAndPath', () => {
    // UT-FS-ERRORS-03
    const err = new FileReadError('songs/c.tabapp');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FileReadError);
    expect(err.name).toBe('FileReadError');
    expect(err.code).toBe('FILE_READ_FAILED');
    expect(err.path).toBe('songs/c.tabapp');
    expect(err.message).toContain('songs/c.tabapp');
  });

  it('FileReadError_PreservesCauseViaOptions', () => {
    // UT-FS-ERRORS-04
    const cause = new Error('EACCES');
    const err = new FileReadError('x', { cause });
    expect(err.cause).toBe(cause);
  });

  it('FileReadError_IsDistinctFromFileNotFoundError', () => {
    // UT-FS-ERRORS-05
    const err = new FileReadError('x');
    expect(err).not.toBeInstanceOf(FileNotFoundError);
  });
});

describe('FileWriteError', () => {
  it('FileWriteError_HasNameCodeAndPath', () => {
    // UT-FS-ERRORS-06
    const err = new FileWriteError('songs/b.tabapp');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FileWriteError);
    expect(err.name).toBe('FileWriteError');
    expect(err.code).toBe('FILE_WRITE_FAILED');
    expect(err.path).toBe('songs/b.tabapp');
    expect(err.message).toContain('songs/b.tabapp');
  });

  it('FileWriteError_IsDistinctFromOtherFileErrors', () => {
    // UT-FS-ERRORS-07
    const err = new FileWriteError('x');
    expect(err).not.toBeInstanceOf(FileNotFoundError);
    expect(err).not.toBeInstanceOf(FileReadError);
  });

  it('FileWriteError_causeを渡す_元のエラーを持つ', () => {
    // UT-FS-ERRORS-08 data-model-persistence.md 10.1 節：書けなければ FileWriteError。元の失敗（EIO など）を cause に残す
    const cause = new Error('EIO');
    expect(new FileWriteError('x', { cause }).cause).toBe(cause);
  });
});

describe('platform の口', () => {
  it('platformのindex_errors.tsの3つのクラスをそのまま出す', async () => {
    // UT-FS-ERRORS-09 data-model-persistence.md 10.1 節：FileNotFoundError と FileReadError は packages/core/src/platform/errors.ts に在り、platform の口から使う
    const platform = await import('./index');
    expect(platform.FileNotFoundError).toBe(FileNotFoundError);
    expect(platform.FileReadError).toBe(FileReadError);
    expect(platform.FileWriteError).toBe(FileWriteError);
  });
});
