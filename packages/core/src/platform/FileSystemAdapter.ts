/**
 * ファイル I/O のアダプタ（PlatformAdapter の 4 系統の 1 つ）。
 *
 * 置き場所は web-core-foundation.md 3.1 節（packages/core/src/platform、実装は置かない）、
 * シグネチャは data-model-persistence.md 10.1 節。PC 版で IPC を通るメソッドは Promise を返す（3.3 節）。
 * 実装は apps/desktop（main の ElectronFileSystemAdapter と、レンダラーの IpcFileSystemAdapter）。
 * 一覧の要素 DirEntry は IPC の応答の型でもあるので、packages/shared-types に置いたものを使う（3.1 節「IPC の要求と応答の型は packages/shared-types」）。
 */

import type { DirEntry } from '@riff-line/shared-types';

export type { DirEntry };

/**
 * 設定された 1 つのストレージルートの下でのファイル I/O。
 * アトミックな書き込み・ゴミ箱への移動・保存先の移行は、このメソッドだけを使って Webコア（persistence）が組み立てる（3.2 節）。
 */
export interface FileSystemAdapter {
  // <!-- req webcorefoundation:7f9c007c.8a41 --> <!-- req webcorefoundation:7f9c007c.9746 --> <!-- req webcorefoundation:7f9c007c.20dd --> <!-- req webcorefoundation:7f9c007c.9054 --> <!-- req webcorefoundation:7f9c007c.50b5 --> <!-- req webcorefoundation:7f9c007c.4d22 --> <!-- req webcorefoundation:7f9c007c.22d5 --> <!-- req webcorefoundation:7f9c007c.a439 --> <!-- req webcorefoundation:8595dd1b.5780 --> <!-- req webcorefoundation:8595dd1b.08bc --> <!-- req webcorefoundation:8595dd1b.22a2 --> <!-- req webcorefoundation:8595dd1b.ff37 --> <!-- req webcorefoundation:8595dd1b.442e --> <!-- req webcorefoundation:8595dd1b.4a11 --> <!-- req webcorefoundation:bd754809.398a --> <!-- req webcorefoundation:bd754809.1e5e --> <!-- req webcorefoundation:96af041f.8cbd --> <!-- req webcorefoundation:96af041f.2cfb --> <!-- req webcorefoundation:282eeb42.93c0 --> <!-- req webcorefoundation:282eeb42.6298 -->
  /** ルートからの相対パスのファイルを読む。無ければ FileNotFoundError、読めなければ FileReadError。 */
  readFile(relativePath: string): Promise<Uint8Array>;
  /** ルートからの相対パスへ書き込む。書けなければ FileWriteError。このメソッドは書き直しをしない。 */
  writeFile(relativePath: string, data: Uint8Array): Promise<void>;
  /** ルートからの相対パスのフォルダの中の一覧。無ければ FileNotFoundError、読めなければ FileReadError。 */
  listDirectory(relativePath: string): Promise<DirEntry[]>;
  /** ルートからの相対パスのフォルダを親ごと作る。既にあってもエラーにしない。作れなければ FileWriteError。 */
  ensureDirectory(relativePath: string): Promise<void>;
  /** 同じルートの中で移す（改名する）。移す前が無ければ FileNotFoundError、移せなければ FileWriteError。 */
  renameFile(fromRelativePath: string, toRelativePath: string): Promise<void>;
  /** ルートからの相対パスのファイルを消す。無くてもエラーにしない。消せなければ FileWriteError。 */
  deleteFile(relativePath: string): Promise<void>;
  /** 同じルートの中で写す。写せなければ FileWriteError。 */
  copyFile(fromRelativePath: string, toRelativePath: string): Promise<void>;
  /** ルートからの相対パスにファイルかフォルダが在るか。 */
  exists(relativePath: string): Promise<boolean>;
  /** 作ったときに渡されたルートの絶対パス。IPC を通らない。 */
  getRootPath(): string;
}

/** 渡した絶対パスをルートとする FileSystemAdapter を作るファクトリ（ミラー同期・保存先の移行が複数のルートを同時に使う）。 */
export interface FileSystemAdapterFactory {
  createForRoot(absoluteRootPath: string): FileSystemAdapter;
}
// 13.1 節の②：保存先を 1 つのフォルダのパスとして扱い、バックエンドごとの分かれ道を持たない（ローカル・iCloud Drive・Google Drive・カスタムフォルダ）。13.2 節：データの暗号化は作らず、足すときはこの口に暗号化を挟み、データモデルを変えない <!-- req webcorefoundation:aef52fbc.1e87 --> <!-- req webcorefoundation:aef52fbc.b11a --> <!-- req webcorefoundation:aef52fbc.562c --> <!-- req webcorefoundation:aef52fbc.bf5b --> <!-- req webcorefoundation:aef52fbc.43ea --> <!-- req webcorefoundation:aef52fbc.8ff4 --> <!-- req webcorefoundation:6c2e96c5.b32b --> <!-- req webcorefoundation:6c2e96c5.843f --> <!-- req webcorefoundation:6c2e96c5.bfb5 -->
