// UT: web-core-foundation.md §3.2 — ファイル I/O の軽量エラークラス
import { describe, expect, it } from 'vitest';

import { FileNotFoundError, FileReadError, FileWriteError } from './errors';

describe('FileNotFoundError', () => {
  it('FileNotFoundError_HasNameCodeAndPath', () => {
    const err = new FileNotFoundError('songs/a.tabapp');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FileNotFoundError);
    expect(err.name).toBe('FileNotFoundError');
    expect(err.code).toBe('FILE_NOT_FOUND');
    expect(err.path).toBe('songs/a.tabapp');
    expect(err.message).toContain('songs/a.tabapp');
  });

  it('FileNotFoundError_PreservesCauseViaOptions', () => {
    const cause = new Error('ENOENT');
    const err = new FileNotFoundError('x', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('FileReadError', () => {
  it('FileReadError_HasNameCodeAndPath', () => {
    const err = new FileReadError('songs/c.tabapp');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FileReadError);
    expect(err.name).toBe('FileReadError');
    expect(err.code).toBe('FILE_READ_FAILED');
    expect(err.path).toBe('songs/c.tabapp');
    expect(err.message).toContain('songs/c.tabapp');
  });

  it('FileReadError_PreservesCauseViaOptions', () => {
    const cause = new Error('EACCES');
    const err = new FileReadError('x', { cause });
    expect(err.cause).toBe(cause);
  });

  it('FileReadError_IsDistinctFromFileNotFoundError', () => {
    const err = new FileReadError('x');
    expect(err).not.toBeInstanceOf(FileNotFoundError);
  });
});

describe('FileWriteError', () => {
  it('FileWriteError_HasNameCodeAndPath', () => {
    const err = new FileWriteError('songs/b.tabapp');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FileWriteError);
    expect(err.name).toBe('FileWriteError');
    expect(err.code).toBe('FILE_WRITE_FAILED');
    expect(err.path).toBe('songs/b.tabapp');
    expect(err.message).toContain('songs/b.tabapp');
  });

  it('FileWriteError_IsDistinctFromOtherFileErrors', () => {
    const err = new FileWriteError('x');
    expect(err).not.toBeInstanceOf(FileNotFoundError);
    expect(err).not.toBeInstanceOf(FileReadError);
  });
});
