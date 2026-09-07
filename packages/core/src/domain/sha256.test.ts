// UT: data-model-persistence.md §3.2 (ChecksumUtil の sha256 実装) — domain/sha256.ts
// 検証観点: FIPS 180-4 の既知テストベクタと一致すること（C0/C1）。

import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('sha256Hex', () => {
  it('sha256Hex_EmptyInput_MatchesKnownVector', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('sha256Hex_Abc_MatchesKnownVector', () => {
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('sha256Hex_448BitMessage_MatchesKnownVector', () => {
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('sha256Hex_MultiBlockOver64Bytes_MatchesKnownVector', () => {
    // 1,000,000 個の 'a'。複数ブロック・パディング境界の網羅。
    expect(sha256Hex(enc('a'.repeat(1_000_000)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('sha256Hex_MultiByteUtf8_IsDeterministic', () => {
    const a = sha256Hex(enc('こんにちは🎸'));
    const b = sha256Hex(enc('こんにちは🎸'));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});
