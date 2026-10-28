/**
 * ファイル I/O のアダプタ（PlatformAdapter の 4 系統の 1 つ）。
 *
 * 置き場所は web-core-foundation.md 3.1 節（packages/core/src/platform、実装は置かない）、
 * シグネチャは data-model-persistence.md 10.1 節。PC 版で IPC を通るメソッドは Promise を返す（3.3 節）。
 * 実装は apps/desktop（main の ElectronFileSystemAdapter と、レンダラーの IpcFileSystemAdapter）。
 * 一覧の要素 DirEntry は IPC の応答の型でもあるので、packages/shared-types に置いたものを使う（3.1 節「IPC の要求と応答の型は packages/shared-types」）。
 */

import type { DirEntry } from '@riff-line/shared-types';

// data-model-persistence.md 10.1 節：DirEntry をこの口から export する（欄は IPC の応答の型として packages/shared-types に置く） <!-- req datamodelpersistence:14be17e9.6f0d -->
export type { DirEntry };

// data-model-persistence.md 10 節：決まったクラウドへ書く口ではなく、設定で決めたローカルのフォルダのパスの下を読み書きする口として作る <!-- req datamodelpersistence:1a87237c.03ca --> <!-- req datamodelpersistence:1a87237c.612a --> <!-- req datamodelpersistence:1a87237c.7f44 -->
/**
 * 設定された 1 つのストレージルートの下でのファイル I/O。
 * アトミックな書き込み・ゴミ箱への移動・保存先の移行は、このメソッドだけを使って Webコア（persistence）が組み立てる（3.2 節）。
 */
// data-model-persistence.md 10.1 節：IPC を通るメソッドは Promise を返す（getRootPath だけは IPC を通らない） <!-- req datamodelpersistence:1081b672.b1eb -->
// data-model-persistence.md 10.1 節：インターフェース FileSystemAdapter を export する <!-- req datamodelpersistence:45703afb.52b2 -->
export interface FileSystemAdapter {
  // <!-- req webcorefoundation:7f9c007c.8a41 --> <!-- req webcorefoundation:7f9c007c.9746 --> <!-- req webcorefoundation:7f9c007c.20dd --> <!-- req webcorefoundation:7f9c007c.9054 --> <!-- req webcorefoundation:7f9c007c.50b5 --> <!-- req webcorefoundation:7f9c007c.4d22 --> <!-- req webcorefoundation:7f9c007c.22d5 --> <!-- req webcorefoundation:7f9c007c.a439 --> <!-- req webcorefoundation:8595dd1b.5780 --> <!-- req webcorefoundation:8595dd1b.08bc --> <!-- req webcorefoundation:8595dd1b.22a2 --> <!-- req webcorefoundation:8595dd1b.ff37 --> <!-- req webcorefoundation:8595dd1b.442e --> <!-- req webcorefoundation:8595dd1b.4a11 --> <!-- req webcorefoundation:bd754809.398a --> <!-- req webcorefoundation:bd754809.1e5e --> <!-- req webcorefoundation:96af041f.8cbd --> <!-- req webcorefoundation:96af041f.2cfb --> <!-- req webcorefoundation:282eeb42.93c0 --> <!-- req webcorefoundation:282eeb42.6298 -->
  // data-model-persistence.md 10.1 節：readFile(relativePath): Promise<Uint8Array> <!-- req datamodelpersistence:b325a04c.f821 -->
  /** ルートからの相対パスのファイルを読む。無ければ FileNotFoundError、読めなければ FileReadError。 */
  readFile(relativePath: string): Promise<Uint8Array>;
  // data-model-persistence.md 10.1 節：writeFile(relativePath, data): Promise<void> <!-- req datamodelpersistence:736043c4.ae38 -->
  /** ルートからの相対パスへ書き込み、閉じる前にディスクへ書き出す。書けなければ FileWriteError。このメソッドは書き直しをしない。 */
  writeFile(relativePath: string, data: Uint8Array): Promise<void>;
  // data-model-persistence.md 10.1 節：listDirectory(relativePath): Promise<DirEntry[]> <!-- req datamodelpersistence:fe6bba5f.cb37 -->
  /** ルートからの相対パスのフォルダの中の一覧。無ければ FileNotFoundError、読めなければ FileReadError。 */
  listDirectory(relativePath: string): Promise<DirEntry[]>;
  // data-model-persistence.md 10.1 節：ensureDirectory(relativePath): Promise<void> <!-- req datamodelpersistence:1eb5a245.7ca9 -->
  /** ルートからの相対パスのフォルダを親ごと作る。既にあってもエラーにしない。作れなければ FileWriteError。 */
  ensureDirectory(relativePath: string): Promise<void>;
  // data-model-persistence.md 10.1 節：renameFile(fromRelativePath, toRelativePath): Promise<void> <!-- req datamodelpersistence:3f1e8b9c.ac98 -->
  /** 同じルートの中で移す（改名する）。移す後に在れば置き換える。移す前が無ければ FileNotFoundError、移せなければ FileWriteError。 */
  renameFile(fromRelativePath: string, toRelativePath: string): Promise<void>;
  // data-model-persistence.md 10.1 節：deleteFile(relativePath): Promise<void> <!-- req datamodelpersistence:ddf344b4.ac93 -->
  /** ルートからの相対パスのファイルを消す。無くてもエラーにしない。消せなければ FileWriteError。フォルダは消さない。 */
  deleteFile(relativePath: string): Promise<void>;
  /**
   * ルートからの相対パスの空のフォルダを消す（data-model-persistence.md 10.1 節）。
   * 中が空でなければ FileWriteError。消せないとき（無い・フォルダでないを含む）も FileWriteError。
   */
  // <!-- req datamodelpersistence:ddf344b4.cec2 -->
  removeEmptyDirectory(relativePath: string): Promise<void>;
  // data-model-persistence.md 10.1 節：copyFile(fromRelativePath, toRelativePath): Promise<void> <!-- req datamodelpersistence:c8eb6abc.2943 -->
  /** 同じルートの中で写す。写せなければ FileWriteError。 */
  copyFile(fromRelativePath: string, toRelativePath: string): Promise<void>;
  // data-model-persistence.md 10.1 節：exists(relativePath): Promise<boolean> <!-- req datamodelpersistence:598aff65.93bd -->
  /** ルートからの相対パスにファイルかフォルダが在るか。調べられなければ FileReadError。 */
  exists(relativePath: string): Promise<boolean>;
  // data-model-persistence.md 10.1 節：getRootPath(): string <!-- req datamodelpersistence:6393037b.bc5c -->
  /** 作ったときに渡されたルートの絶対パス。IPC を通らない。 */
  getRootPath(): string;
}

// data-model-persistence.md 10.1 節：インターフェース FileSystemAdapterFactory を export し、createForRoot(absoluteRootPath): FileSystemAdapter を持つ <!-- req datamodelpersistence:02c7f5d3.5c0e --> <!-- req datamodelpersistence:85cb4f0a.4c24 -->
/** 渡した絶対パスをルートとする FileSystemAdapter を作るファクトリ（ミラー同期・保存先の移行が複数のルートを同時に使う）。 */
export interface FileSystemAdapterFactory {
  createForRoot(absoluteRootPath: string): FileSystemAdapter;
}

// data-model-persistence.md 10 節：IPC 越しの実装（IpcFileSystemAdapter・IpcFileSystemAdapterFactory）を足しても、この 2 つの口の公開のシグネチャは変えない <!-- req datamodelpersistence:ae2ccdb7.dcaf --> <!-- req datamodelpersistence:ae2ccdb7.a4f9 -->
// data-model-persistence.md 10 節：Webコアのサービスはレンダラーの側に置いたまま、この 2 つの口だけを見て動く（packages/core は electron と Node.js を import しない、ESLint の no-restricted-imports） <!-- req datamodelpersistence:ae2ccdb7.84f8 --> <!-- req datamodelpersistence:ae2ccdb7.f573 -->
// data-model-persistence.md 10 節：アトミックな書き込みとゴミ箱への移動の手順は Webコアのサービスが組み立て、アダプタに別のメソッドを足さない（writeFile と renameFile の組、renameFile 1 回） <!-- req datamodelpersistence:feeb91c5.6936 --> <!-- req datamodelpersistence:feeb91c5.9528 -->
// <!-- req datamodelpersistence:eb1ed8ce.e844 -->
// <!-- req datamodelpersistence:eb1ed8ce.0edf -->
// 13.1 節の②：保存先を 1 つのフォルダのパスとして扱い、バックエンドごとの分かれ道を持たない（ローカル・iCloud Drive・Google Drive・カスタムフォルダ）。13.2 節：データの暗号化は作らず、足すときはこの口に暗号化を挟み、データモデルを変えない <!-- req webcorefoundation:aef52fbc.1e87 --> <!-- req webcorefoundation:aef52fbc.b11a --> <!-- req webcorefoundation:aef52fbc.562c --> <!-- req webcorefoundation:aef52fbc.bf5b --> <!-- req webcorefoundation:aef52fbc.43ea --> <!-- req webcorefoundation:aef52fbc.8ff4 --> <!-- req webcorefoundation:6c2e96c5.b32b --> <!-- req webcorefoundation:6c2e96c5.843f --> <!-- req webcorefoundation:6c2e96c5.bfb5 -->
