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
