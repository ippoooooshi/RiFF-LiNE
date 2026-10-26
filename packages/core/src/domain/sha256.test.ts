// UT-CORE-SHA256: 同期の SHA-256（domain/sha256.ts）
// 検証節: data-model-persistence.md 7 節（checksum のハッシュの種類は SHA-256）
// 検証観点: FIPS 180-4 の既知テストベクタと一致すること、パディングの境界（C0/C1）。

import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('sha256Hex', () => {
  it('sha256Hex_EmptyInput_MatchesKnownVector', () => {
    // UT-CORE-SHA256-01
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('sha256Hex_Abc_MatchesKnownVector', () => {
    // UT-CORE-SHA256-02
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('sha256Hex_448BitMessage_MatchesKnownVector', () => {
    // UT-CORE-SHA256-03
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('sha256Hex_MultiBlockOver64Bytes_MatchesKnownVector', () => {
    // UT-CORE-SHA256-04
    // 1,000,000 個の 'a'。複数ブロック・パディング境界の網羅。
    expect(sha256Hex(enc('a'.repeat(1_000_000)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('sha256Hex_MultiByteUtf8_IsDeterministic', () => {
    // UT-CORE-SHA256-05
    const a = sha256Hex(enc('こんにちは🎸'));
    const b = sha256Hex(enc('こんにちは🎸'));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('sha256Hex_パディングの境界の55と56と64バイト_既知の値と一致する', () => {
    // UT-CORE-SHA256-06 data-model-persistence.md 7 節：ハッシュの種類は SHA-256。
    // 55 バイトは 1 ブロックに収まる最長、56 バイトはビット長が次のブロックへ溢れる最短、64 バイトはちょうど 1 ブロック。
    // 期待値は Node.js の crypto（sha256）で得たもの。
    expect(sha256Hex(enc('a'.repeat(55)))).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318');
    expect(sha256Hex(enc('a'.repeat(56)))).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
    expect(sha256Hex(enc('a'.repeat(64)))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
  });

  it('sha256Hex_マルチバイトのUTF8_既知の値と一致する', () => {
    // UT-CORE-SHA256-07 data-model-persistence.md 7 節：対象は UTF-8 のバイト列。期待値は Node.js の crypto（sha256）で得たもの
    expect(sha256Hex(enc('こんにちは🎸'))).toBe('18316d128944865791c5424f6bc777036ef97f1cfd97da81fac76688d96b25d2');
  });
});
