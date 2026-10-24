// UT-DEV-ROOT: web-core-foundation.md 14.7 節 — レンダラーの入口（main.tsx）から出した判断の関数（rootElement.ts）
// 検証節: web-core-foundation.md 14.7 節 <!-- req webcorefoundation:c27f130d.35af --> <!-- req webcorefoundation:7ad5880a.9d15 --> <!-- req webcorefoundation:c27f130d.e9a7 --> <!-- req webcorefoundation:8f5284e2.8d95 -->
// 検証観点: React を載せる要素が在れば返し、無ければ起動を止めること（C0/C1）。
// renderer の関数は tsconfig が別なので src/dev から読み込めず、対象と同じフォルダに置く。

import { describe, expect, it } from 'vitest';

import { ROOT_ELEMENT_ID, requireRootElement } from './rootElement';

describe('rootElement', () => {
  it('requireRootElement_rootが在る_その要素を返す', () => {
    // UT-DEV-ROOT-01 14.7 節。index.html の <div id="root"> を引く
    const element = { id: 'root' };
    const asked: string[] = [];
    const doc = {
      getElementById: (id: string) => {
        asked.push(id);
        return id === 'root' ? element : null;
      },
    };
    expect(requireRootElement(doc)).toBe(element);
    expect(asked).toEqual([ROOT_ELEMENT_ID]);
  });

  it('requireRootElement_rootが無い_起動を止める', () => {
    // UT-DEV-ROOT-02 14.7 節。#root が無ければ React を載せずに止める
    const doc = { getElementById: () => null };
    expect(() => requireRootElement(doc)).toThrow('renderer bootstrap failed: #root not found');
  });
});
