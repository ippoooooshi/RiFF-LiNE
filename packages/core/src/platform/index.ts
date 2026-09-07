/**
 * プラットフォーム抽象層（L4、web-core-foundation.md §3.2）。
 * 本パッケージでは FileSystemAdapter の最小契約のみ。AudioSession / Window / UpdateCheck は
 * それぞれ該当パッケージ（再生エンジン統合 / 画面群・ナビゲーション / 将来 Phase）で追加する。
 */

// FileSystemAdapter インターフェースと DirEntry は shared-types が単一の真実源。
export type { FileSystemAdapter, DirEntry } from '@riff-line/shared-types';

export { FileNotFoundError, FileReadError, FileWriteError } from './errors';
