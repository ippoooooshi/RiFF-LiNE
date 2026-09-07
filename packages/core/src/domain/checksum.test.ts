// UT: data-model-persistence.md §3.2・§9.2 — domain/checksum.ts
// 検証観点: 決定的な鍵順序、integrity を含めない、改ざん・欠損での不一致検出（C0/C1）。

import { describe, expect, it } from 'vitest';

import { canonicalJsonStringify, computeChecksum } from './checksum';
import { createEmptyAppMetadata } from './SongDocument';

describe('canonicalJsonStringify', () => {
  it('canonicalJsonStringify_KeyOrderDiffers_ProducesSameString', () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe(canonicalJsonStringify({ a: 2, b: 1 }));
  });

  it('canonicalJsonStringify_NestedObjects_SortedRecursively', () => {
    expect(canonicalJsonStringify({ z: { y: 1, x: 2 }, a: [3, { d: 4, c: 5 }] })).toBe(
      '{"a":[3,{"c":5,"d":4}],"z":{"x":2,"y":1}}',
    );
  });

  it('canonicalJsonStringify_ArrayOrderPreserved', () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('canonicalJsonStringify_PrimitivesAndNull', () => {
    expect(canonicalJsonStringify(null)).toBe('null');
    expect(canonicalJsonStringify(42)).toBe('42');
    expect(canonicalJsonStringify('x')).toBe('"x"');
    expect(canonicalJsonStringify(undefined)).toBe('null');
  });

  it('canonicalJsonStringify_UndefinedPropertyOmitted', () => {
    expect(canonicalJsonStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('canonicalJsonStringify_UndefinedInArrayBecomesNull', () => {
    expect(canonicalJsonStringify([1, undefined, 2])).toBe('[1,null,2]');
  });
});

describe('computeChecksum', () => {
  const appMeta = createEmptyAppMetadata();

  it('computeChecksum_ReturnsSha256PrefixedHex', () => {
    const sum = computeChecksum('1.0.0', { title: 'T' }, appMeta);
    expect(sum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('computeChecksum_SameInputsDifferentKeyOrder_SameChecksum', () => {
    const a = computeChecksum('1.0.0', { title: 'T', tempo: 120 }, appMeta);
    const b = computeChecksum('1.0.0', { tempo: 120, title: 'T' }, appMeta);
    expect(a).toBe(b);
  });

  it('computeChecksum_SongTampered_ChecksumChanges', () => {
    const a = computeChecksum('1.0.0', { title: 'T' }, appMeta);
    const b = computeChecksum('1.0.0', { title: 'T!' }, appMeta);
    expect(a).not.toBe(b);
  });

  it('computeChecksum_AppMetaChanged_ChecksumChanges', () => {
    const a = computeChecksum('1.0.0', { title: 'T' }, appMeta);
    const b = computeChecksum('1.0.0', { title: 'T' }, { ...appMeta, tags: [{ tagId: 'x' }] });
    expect(a).not.toBe(b);
  });

  it('computeChecksum_SchemaVersionChanged_ChecksumChanges', () => {
    expect(computeChecksum('1.0.0', { title: 'T' }, appMeta)).not.toBe(
      computeChecksum('1.1.0', { title: 'T' }, appMeta),
    );
  });
});
