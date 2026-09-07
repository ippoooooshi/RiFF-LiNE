/**
 * テスト用のインメモリ FileSystemAdapter / FileSystemAdapterFactory（tests.rule.md「I/O は fake で差し替え」）。
 *
 * 本番コードからは import しない（src/index.ts のバレルにも含めない）。実 I/O・IPC の往復は
 * apps/desktop/src/main/*.test.ts の結合テストで別途検証する。
 */

import { FileNotFoundError, FileReadError, FileWriteError } from '../platform/errors';
import type { DirEntry, FileSystemAdapter, FileSystemAdapterFactory } from '@riff-line/shared-types';

/** 先頭 `./`・重複スラッシュを除いた正規化パス。 */
function norm(path: string): string {
  return (
    path
      .replace(/^\.\/+/, '')
      .replace(/\/+/g, '/')
      .replace(/\/$/, '') || '.'
  );
}

export interface FakeFileSystemOptions {
  rootPath?: string;
  /** 呼び出しのたびにカウントする（リトライ・fire-and-forget の検証用）。 */
  countCalls?: boolean;
}

export class FakeFileSystemAdapter implements FileSystemAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(['.']);
  readonly calls: Record<string, number> = {};
  private readonly rootPath: string;
  private readonly countCalls: boolean;

  constructor(options: FakeFileSystemOptions = {}) {
    this.rootPath = options.rootPath ?? '/fake/TabApp';
    this.countCalls = options.countCalls ?? false;
  }

  private tick(name: string): void {
    if (this.countCalls) this.calls[name] = (this.calls[name] ?? 0) + 1;
  }

  private addDirChain(path: string): void {
    const parts = norm(path).split('/');
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      this.dirs.add(acc);
    }
  }

  getRootPath(): string {
    return this.rootPath;
  }

  readFile(relativePath: string): Promise<Uint8Array> {
    this.tick('readFile');
    const key = norm(relativePath);
    const data = this.files.get(key);
    if (data !== undefined) return Promise.resolve(data);
    if (this.dirs.has(key)) return Promise.reject(new FileReadError(relativePath));
    return Promise.reject(new FileNotFoundError(relativePath));
  }

  writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    this.tick('writeFile');
    const key = norm(relativePath);
    const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '.';
    if (!this.dirs.has(parent)) return Promise.reject(new FileWriteError(relativePath));
    this.files.set(key, data);
    return Promise.resolve();
  }

  listDirectory(relativePath: string): Promise<DirEntry[]> {
    this.tick('listDirectory');
    const key = norm(relativePath);
    if (this.files.has(key)) return Promise.reject(new FileReadError(relativePath));
    if (!this.dirs.has(key)) return Promise.reject(new FileNotFoundError(relativePath));

    const prefix = key === '.' ? '' : `${key}/`;
    const names = new Set<string>();
    const out: DirEntry[] = [];
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const name = rest.split('/')[0]!;
      if (names.has(name)) continue;
      names.add(name);
      const isDirectory = rest.includes('/');
      out.push({
        name,
        isDirectory,
        sizeBytes: isDirectory ? 0 : (this.files.get(filePath)?.length ?? 0),
        modifiedAt: new Date(0).toISOString(),
      });
    }
    for (const dir of this.dirs) {
      if (dir === '.' || !dir.startsWith(prefix)) continue;
      const name = dir.slice(prefix.length).split('/')[0]!;
      if (!names.has(name)) {
        names.add(name);
        out.push({ name, isDirectory: true, sizeBytes: 0, modifiedAt: new Date(0).toISOString() });
      }
    }
    return Promise.resolve(out);
  }

  ensureDirectory(relativePath: string): Promise<void> {
    this.tick('ensureDirectory');
    this.addDirChain(relativePath);
    return Promise.resolve();
  }

  renameFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    this.tick('renameFile');
    const from = norm(fromRelativePath);
    const to = norm(toRelativePath);
    const data = this.files.get(from);
    if (data === undefined) return Promise.reject(new FileNotFoundError(fromRelativePath));
    const parent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '.';
    if (!this.dirs.has(parent)) return Promise.reject(new FileWriteError(toRelativePath));
    this.files.delete(from);
    this.files.set(to, data);
    return Promise.resolve();
  }

  deleteFile(relativePath: string): Promise<void> {
    this.tick('deleteFile');
    this.files.delete(norm(relativePath));
    return Promise.resolve();
  }

  copyFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    this.tick('copyFile');
    const data = this.files.get(norm(fromRelativePath));
    if (data === undefined) return Promise.reject(new FileNotFoundError(fromRelativePath));
    const to = norm(toRelativePath);
    const parent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '.';
    if (!this.dirs.has(parent)) return Promise.reject(new FileWriteError(toRelativePath));
    this.files.set(to, data.slice());
    return Promise.resolve();
  }

  exists(relativePath: string): Promise<boolean> {
    this.tick('exists');
    const key = norm(relativePath);
    return Promise.resolve(this.files.has(key) || this.dirs.has(key));
  }

  // ===== テスト用ヘルパー =====

  putText(relativePath: string, text: string): void {
    const key = norm(relativePath);
    const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '.';
    this.addDirChain(parent);
    this.files.set(key, new TextEncoder().encode(text));
  }

  putJson(relativePath: string, value: unknown): void {
    this.putText(relativePath, JSON.stringify(value, null, 2));
  }

  readText(relativePath: string): string {
    const data = this.files.get(norm(relativePath));
    if (data === undefined) throw new Error(`no such fake file: ${relativePath}`);
    return new TextDecoder().decode(data);
  }

  readJson<T>(relativePath: string): T {
    return JSON.parse(this.readText(relativePath)) as T;
  }
}

/** ルートごとに独立した FakeFileSystemAdapter を返すファクトリ（ミラー・移行テスト用）。 */
export class FakeFileSystemAdapterFactory implements FileSystemAdapterFactory {
  readonly byRoot = new Map<string, FakeFileSystemAdapter>();

  constructor(private readonly options: Omit<FakeFileSystemOptions, 'rootPath'> = {}) {}

  createForRoot(absoluteRootPath: string): FakeFileSystemAdapter {
    let adapter = this.byRoot.get(absoluteRootPath);
    if (!adapter) {
      adapter = new FakeFileSystemAdapter({ ...this.options, rootPath: absoluteRootPath });
      this.byRoot.set(absoluteRootPath, adapter);
    }
    return adapter;
  }
}
