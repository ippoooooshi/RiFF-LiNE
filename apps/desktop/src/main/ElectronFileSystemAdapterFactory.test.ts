// IT-FS-FACTORY: `ElectronFileSystemAdapterFactory`（複数ルート、B31）
// 検証節: data-model-persistence.md 10.1 節の (b)
// UT/IT: data-model-persistence.md 10 節・10.1 節 — ElectronFileSystemAdapterFactory
// 検証観点: ルートごとに独立したアダプタ、同一ルートはキャッシュ、実 I/O が別フォルダに向く（C0/C1）。

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ElectronFileSystemAdapter } from './ElectronFileSystemAdapter';
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
    // IT-FS-FACTORY-01
    expect(factory.createForRoot(rootA)).toBe(factory.createForRoot(rootA));
  });

  it('createForRoot_NormalizedEquivalentRoot_ReturnsCachedInstance', () => {
    // IT-FS-FACTORY-02
    // `rootA/sub/..` は normalize すると `rootA` と一致する → 同じキャッシュエントリ。
    expect(factory.createForRoot(rootA)).toBe(factory.createForRoot(join(rootA, 'sub', '..')));
  });

  it('createForRoot_DifferentRoots_ReturnIndependentAdapters', async () => {
    // IT-FS-FACTORY-03
    const a = factory.createForRoot(rootA);
    const b = factory.createForRoot(rootB);
    expect(a).not.toBe(b);
    expect(a.getRootPath()).toBe(rootA);
    expect(b.getRootPath()).toBe(rootB);

    await a.writeFile('only-in-a.txt', enc.encode('A'));
    expect(await b.exists('only-in-a.txt')).toBe(false);
    expect(dec.decode(await a.readFile('only-in-a.txt'))).toBe('A');
  });

  it('createForRoot_末尾に区切りの付いた同じルート_同じアダプタを返す', () => {
    // IT-FS-FACTORY-04 data-model-persistence.md 10.1 節：main の側は、同じルートには 1 つだけ作って使い回す
    const plain = factory.createForRoot(rootA);
    expect(factory.createForRoot(rootA + sep)).toBe(plain);
    expect(plain.getRootPath()).toBe(rootA);
  });

  it('createForRoot_相対パスのルート_投げる', () => {
    // IT-FS-FACTORY-05 data-model-persistence.md 10.1 節：任意の「絶対パス」をルートにする。絶対パスでなければ作らない（作業フォルダからの相対で読み書きさせない）
    expect(() => factory.createForRoot('relative/root')).toThrow(/absolute/i);
  });

  it('createForRoot_保存先の種類によらず_同じElectronFileSystemAdapterを作る_既定は読み直しあり', async () => {
    // IT-FS-FACTORY-06 data-model-persistence.md 10 節：ローカル・iCloud Drive・Google Drive は、どれも 1 つのフォルダのパスで、同じ FileSystemAdapter で扱う
    const defaults = new ElectronFileSystemAdapterFactory();
    const local = defaults.createForRoot(rootA);
    const synced = defaults.createForRoot(rootB);
    expect(local).toBeInstanceOf(ElectronFileSystemAdapter);
    expect(synced).toBeInstanceOf(ElectronFileSystemAdapter);
    await writeFile(join(rootB, 'song.tabapp'), 'body');
    expect(dec.decode(await synced.readFile('song.tabapp'))).toBe('body');
  });
});
