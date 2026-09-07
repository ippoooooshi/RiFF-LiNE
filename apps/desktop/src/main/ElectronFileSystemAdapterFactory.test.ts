// UT/IT: data-model-persistence.md §3.3・§3.3.1 — ElectronFileSystemAdapterFactory
// 検証観点: ルートごとに独立したアダプタ、同一ルートはキャッシュ、実 I/O が別フォルダに向く（C0/C1）。

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ElectronFileSystemAdapterFactory } from './ElectronFileSystemAdapterFactory';

let rootA: string;
let rootB: string;
let factory: ElectronFileSystemAdapterFactory;
const enc = new TextEncoder();
const dec = new TextDecoder();

beforeEach(async () => {
  rootA = await mkdtemp(join(tmpdir(), 'tabapp-fac-a-'));
  rootB = await mkdtemp(join(tmpdir(), 'tabapp-fac-b-'));
  factory = new ElectronFileSystemAdapterFactory({ retryOnDemandDownload: false });
});

afterEach(async () => {
  await rm(rootA, { recursive: true, force: true });
  await rm(rootB, { recursive: true, force: true });
});

describe('ElectronFileSystemAdapterFactory', () => {
  it('createForRoot_SameRoot_ReturnsCachedInstance', () => {
    expect(factory.createForRoot(rootA)).toBe(factory.createForRoot(rootA));
  });

  it('createForRoot_NormalizedEquivalentRoot_ReturnsCachedInstance', () => {
    // `rootA/sub/..` は normalize すると `rootA` と一致する → 同じキャッシュエントリ。
    expect(factory.createForRoot(rootA)).toBe(factory.createForRoot(join(rootA, 'sub', '..')));
  });

  it('createForRoot_DifferentRoots_ReturnIndependentAdapters', async () => {
    const a = factory.createForRoot(rootA);
    const b = factory.createForRoot(rootB);
    expect(a).not.toBe(b);
    expect(a.getRootPath()).toBe(rootA);
    expect(b.getRootPath()).toBe(rootB);

    await a.writeFile('only-in-a.txt', enc.encode('A'));
    expect(await b.exists('only-in-a.txt')).toBe(false);
    expect(dec.decode(await a.readFile('only-in-a.txt'))).toBe('A');
  });
});
