// UT-CORE-CHECKSUM: 整合性チェックサム
// 検証節: data-model-persistence.md §3.1・§9（`FILE-002`）
// UT: data-model-persistence.md §3.2・§9.2 — domain/checksum.ts
// 検証観点: 決定的な鍵順序、integrity を含めない、改ざん・欠損での不一致検出（C0/C1）。

import { describe, expect, it } from 'vitest';

import { canonicalJsonStringify, computeChecksum } from './checksum';
import { createEmptyAppMetadata } from './SongDocument';

describe('canonicalJsonStringify', () => {
  it('canonicalJsonStringify_KeyOrderDiffers_ProducesSameString', () => {
    // UT-CORE-CHECKSUM-01
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe(canonicalJsonStringify({ a: 2, b: 1 }));
  });

  it('canonicalJsonStringify_NestedObjects_SortedRecursively', () => {
    // UT-CORE-CHECKSUM-02
    expect(canonicalJsonStringify({ z: { y: 1, x: 2 }, a: [3, { d: 4, c: 5 }] })).toBe(
      '{"a":[3,{"c":5,"d":4}],"z":{"x":2,"y":1}}',
    );
  });

  it('canonicalJsonStringify_ArrayOrderPreserved', () => {
    // UT-CORE-CHECKSUM-03
    expect(canonicalJsonStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('canonicalJsonStringify_PrimitivesAndNull', () => {
    // UT-CORE-CHECKSUM-04
    expect(canonicalJsonStringify(null)).toBe('null');
    expect(canonicalJsonStringify(42)).toBe('42');
    expect(canonicalJsonStringify('x')).toBe('"x"');
    expect(canonicalJsonStringify(undefined)).toBe('null');
  });

  it('canonicalJsonStringify_UndefinedPropertyOmitted', () => {
    // UT-CORE-CHECKSUM-05
    expect(canonicalJsonStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('canonicalJsonStringify_UndefinedInArrayBecomesNull', () => {
    // UT-CORE-CHECKSUM-06
    expect(canonicalJsonStringify([1, undefined, 2])).toBe('[1,null,2]');
  });
});

describe('computeChecksum', () => {
  const appMeta = createEmptyAppMetadata();

  it('computeChecksum_ReturnsSha256PrefixedHex', () => {
    // UT-CORE-CHECKSUM-07
    const sum = computeChecksum('1.0.0', { title: 'T' }, appMeta);
    expect(sum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('computeChecksum_SameInputsDifferentKeyOrder_SameChecksum', () => {
    // UT-CORE-CHECKSUM-08
    const a = computeChecksum('1.0.0', { title: 'T', tempo: 120 }, appMeta);
    const b = computeChecksum('1.0.0', { tempo: 120, title: 'T' }, appMeta);
    expect(a).toBe(b);
  });

  it('computeChecksum_SongTampered_ChecksumChanges', () => {
    // UT-CORE-CHECKSUM-09
    const a = computeChecksum('1.0.0', { title: 'T' }, appMeta);
    const b = computeChecksum('1.0.0', { title: 'T!' }, appMeta);
    expect(a).not.toBe(b);
  });

  it('computeChecksum_AppMetaChanged_ChecksumChanges', () => {
    // UT-CORE-CHECKSUM-10
    const a = computeChecksum('1.0.0', { title: 'T' }, appMeta);
    const b = computeChecksum('1.0.0', { title: 'T' }, { ...appMeta, tags: [{ tagId: 'x' }] });
    expect(a).not.toBe(b);
  });

  it('computeChecksum_SchemaVersionChanged_ChecksumChanges', () => {
    // UT-CORE-CHECKSUM-11
    expect(computeChecksum('1.0.0', { title: 'T' }, appMeta)).not.toBe(
      computeChecksum('1.1.0', { title: 'T' }, appMeta),
    );
  });
});
