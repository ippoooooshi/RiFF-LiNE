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

export type { DirEntry, FileSystemAdapter, FileSystemAdapterFactory } from './FileSystemAdapter';
export type { AudioSessionAdapter } from './AudioSessionAdapter';
export type { WindowAdapter } from './WindowAdapter';
export type { UpdateCheckAdapter, UpdateCheckResult } from './UpdateCheckAdapter';
export type { PlatformAdapters } from './PlatformAdapters';
export type { StorageRootPointer } from '@riff-line/shared-types';

export { FileNotFoundError, FileReadError, FileWriteError } from './errors';
// <!-- req webcorefoundation:3319b335.b44f --> <!-- req webcorefoundation:3319b335.09a1 --> <!-- req webcorefoundation:3319b335.3bca -->
