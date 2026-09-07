/**
 * プラットフォーム抽象層（L4）。
 *
 * web-core-foundation.md §3.2 で FileSystemAdapter の最小契約を確定。
 * data-model-persistence.md §3.3〜§3.4 で FileSystemAdapter を非破壊拡張し、
 * FileSystemAdapterFactory（複数ルート）と AppLocalConfigService（ローカルポインタ）を追加。
 * AudioSession / Window / UpdateCheck は該当パッケージ（再生エンジン統合 / 画面群・ナビゲーション / 将来 Phase）で追加する。
 *
 * インターフェース・型は shared-types が単一の真実源。ここは L4 境界としての再エクスポート点。
 */

export type {
  FileSystemAdapter,
  FileSystemAdapterFactory,
  AppLocalConfigService,
  StorageRootPointer,
  DirEntry,
} from '@riff-line/shared-types';

export { FileNotFoundError, FileReadError, FileWriteError } from './errors';
