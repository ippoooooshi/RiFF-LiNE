/**
 * FileSystemAdapterFactory の Electron 実装（data-model-persistence.md 10.1 節の (b)）。
 *
 * 絶対パスごとに ElectronFileSystemAdapter を 1 個だけ生成してキャッシュする薄いラッパー。
 * 主ストレージ・ミラー先（14 節）・移行先（12 節）が別のフォルダなので、複数のルートを同時に読み書きするために使う。
 */

import type { FileSystemAdapter, FileSystemAdapterFactory } from '@riff-line/core/platform';

import {
  ElectronFileSystemAdapter,
  resolveRootPath,
  type ElectronFileSystemAdapterOptions,
} from './ElectronFileSystemAdapter';

// data-model-persistence.md 10.1 節：createForRoot の main の側の実装はこのファイルに置き、任意の絶対パスをルートにした FileSystemAdapter を作る <!-- req datamodelpersistence:a5185d1e.a5e4 --> <!-- req datamodelpersistence:a5185d1e.2b71 -->
export class ElectronFileSystemAdapterFactory implements FileSystemAdapterFactory {
  private readonly cache = new Map<string, FileSystemAdapter>();

  constructor(private readonly options: ElectronFileSystemAdapterOptions = {}) {}

  createForRoot(absoluteRootPath: string): FileSystemAdapter {
    // data-model-persistence.md 10 節：保存先の種類（ローカル・iCloud Drive・Google Drive）によらず、同じ ElectronFileSystemAdapter で扱う <!-- req datamodelpersistence:a827d2fd.7eed -->
    // data-model-persistence.md 10.1 節：同じルートには 1 つだけ作って使い回す <!-- req datamodelpersistence:a5185d1e.f93b -->
    // 鍵は末尾の区切りと `..` をそろえた絶対パス。絶対パスでなければここで投げ、何も作らない。
    const key = resolveRootPath(absoluteRootPath);
    let adapter = this.cache.get(key);
    if (!adapter) {
      adapter = new ElectronFileSystemAdapter(key, this.options);
      this.cache.set(key, adapter);
    }
    return adapter;
  }
}
