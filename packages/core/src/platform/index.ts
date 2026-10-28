/**
 * プラットフォーム抽象層（L4）。PlatformAdapter のインターフェースだけを置き、実装は置かない（web-core-foundation.md 3.1 節）。
 *
 * - 4 系統のアダプタ：FileSystemAdapter（＋ FileSystemAdapterFactory）・AudioSessionAdapter・WindowAdapter・UpdateCheckAdapter
 * - L5 が起動時に作った具象をまとめて Webコアへ渡す PlatformAdapters
 * - FileSystemAdapter の実装が投げる軽量エラークラス（errors.ts）
 *
 * IPC の要求と応答の型（DirEntry・StorageRootPointer を含む）とチャンネルの名前の表は packages/shared-types に置く。
 */
// <!-- req webcorefoundation:6581ddd9.eebf --> <!-- req webcorefoundation:6581ddd9.12f3 -->
// <!-- req webcorefoundation:2f20ef26.1657 --> <!-- req webcorefoundation:2f20ef26.7644 --> <!-- req webcorefoundation:2f20ef26.1cea --> <!-- req webcorefoundation:2f20ef26.e837 --> <!-- req webcorefoundation:2f20ef26.6d54 --> <!-- req webcorefoundation:2d4b4a69.aa8e --> <!-- req webcorefoundation:2d4b4a69.b8d3 --> <!-- req webcorefoundation:2d4b4a69.0d67 --> <!-- req webcorefoundation:2d4b4a69.3f01 --> <!-- req webcorefoundation:2d4b4a69.b5a9 --> <!-- req webcorefoundation:2d4b4a69.9906 --> <!-- req webcorefoundation:2d4b4a69.cbd6 --> <!-- req webcorefoundation:2d4b4a69.f503 --> <!-- req webcorefoundation:2d4b4a69.ef17 --> <!-- req webcorefoundation:2d4b4a69.9860 --> <!-- req webcorefoundation:50a5cb45.c6b5 --> <!-- req webcorefoundation:50a5cb45.c323 --> <!-- req webcorefoundation:0612e303.4fec --> <!-- req webcorefoundation:c9ada815.6f71 --> <!-- req webcorefoundation:c9ada815.9558 --> <!-- req webcorefoundation:c9ada815.00bd --> <!-- req webcorefoundation:c9ada815.388c --> <!-- req webcorefoundation:c9ada815.e65a --> <!-- req webcorefoundation:c9ada815.b791 --> <!-- req webcorefoundation:c9ada815.8347 --> <!-- req webcorefoundation:ebaf52bb.7517 --> <!-- req webcorefoundation:ebaf52bb.5cdb --> <!-- req webcorefoundation:ebaf52bb.b2bb --> <!-- req webcorefoundation:3fd1fcd2.84b2 --> <!-- req webcorefoundation:76bdbd66.e7b4 --> <!-- req webcorefoundation:76bdbd66.cd09 --> <!-- req webcorefoundation:76bdbd66.7aa8 --> <!-- req webcorefoundation:76bdbd66.d3a4 --> <!-- req webcorefoundation:76bdbd66.e7c1 --> <!-- req webcorefoundation:76bdbd66.7bed --> <!-- req webcorefoundation:cb308c28.5640 --> <!-- req webcorefoundation:7ed848a5.cf78 --> <!-- req webcorefoundation:615f0294.b050 --> <!-- req webcorefoundation:eaf98b95.c92d --> <!-- req webcorefoundation:4e432e1e.0435 --> <!-- req webcorefoundation:e78d2928.d32c --> <!-- req webcorefoundation:e78d2928.3b5e --> <!-- req webcorefoundation:e78d2928.0dc8 --> <!-- req webcorefoundation:017a7cbc.5d06 --> <!-- req webcorefoundation:017a7cbc.6553 --> <!-- req webcorefoundation:017a7cbc.395a -->

export type { DirEntry, FileSystemAdapter, FileSystemAdapterFactory } from './FileSystemAdapter';
export type { AudioSessionAdapter } from './AudioSessionAdapter';
export type { WindowAdapter } from './WindowAdapter';
export type { UpdateCheckAdapter, UpdateCheckResult } from './UpdateCheckAdapter';
export type { PlatformAdapters } from './PlatformAdapters';
export type { StorageRootPointer } from '@riff-line/shared-types';

// data-model-persistence.md 10.1 節：FileSystemAdapter の実装が投げる軽量エラークラスを platform の口から出す
export { FileNotFoundError, FileReadError, FileWriteError } from './errors';
// <!-- req webcorefoundation:3319b335.b44f --> <!-- req webcorefoundation:3319b335.09a1 --> <!-- req webcorefoundation:3319b335.3bca -->
