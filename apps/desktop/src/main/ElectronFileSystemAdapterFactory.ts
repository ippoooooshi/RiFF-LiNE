/**
 * FileSystemAdapterFactory の Electron 実装（data-model-persistence.md §3.3・§3.3.1）。
 *
 * 絶対パスごとに ElectronFileSystemAdapter を 1 個だけ生成してキャッシュする薄いラッパー。
 * ミラー同期・ストレージ移行が複数ルートへ同時アクセスするために使う。
 */

import { normalize } from 'node:path';

import type { FileSystemAdapter, FileSystemAdapterFactory } from '@riff-line/shared-types';

import { ElectronFileSystemAdapter, type ElectronFileSystemAdapterOptions } from './ElectronFileSystemAdapter';

export class ElectronFileSystemAdapterFactory implements FileSystemAdapterFactory {
  private readonly cache = new Map<string, FileSystemAdapter>();

  constructor(private readonly options: ElectronFileSystemAdapterOptions = {}) {}

  createForRoot(absoluteRootPath: string): FileSystemAdapter {
    const key = normalize(absoluteRootPath);
    let adapter = this.cache.get(key);
    if (!adapter) {
      adapter = new ElectronFileSystemAdapter(key, this.options);
      this.cache.set(key, adapter);
    }
    return adapter;
  }
}
