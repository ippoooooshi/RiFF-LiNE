/**
 * `index.json`（曲一覧の軽量インデックス）の読み書きと差分更新（06_file_io_persistence.md §10、02_data_model.md §5）。
 *
 * 1000 曲規模でも起動時に各曲ファイルをフルパースせず一覧表示できるようにするための索引。
 * 破損・欠落時は例外を投げず `rebuildFromSongsFolder()` に自動フォールバックする（§3.2）。
 */

import type { FileSystemAdapter } from '@riff-line/shared-types';

import type { SongSummary } from '../domain/types';

import { INDEX_FILE, SONGS_DIR } from './constants';
import { decodeText, isFileNotFound, writeJsonFile } from './jsonIo';
import { warnProvisional } from './log';
import { songIdFromFileName, songFilePath } from './paths';

/** SongDocument（またはそのファイル JSON）から一覧用の軽量情報を取り出す。 */
export function toSongSummary(fileJson: {
  id: string;
  song?: unknown;
  appMeta?: { tags?: { tagId: string }[]; thumbnail?: unknown };
  integrity?: { savedAtMonotonic?: number };
  isTrashed?: boolean;
  updatedAt?: string;
}): SongSummary {
  const song = (fileJson.song ?? {}) as { title?: unknown };
  const savedAt = fileJson.integrity?.savedAtMonotonic;
  return {
    id: fileJson.id,
    title: typeof song.title === 'string' && song.title.length > 0 ? song.title : '(無題)',
    updatedAt:
      fileJson.updatedAt ?? (typeof savedAt === 'number' ? new Date(savedAt).toISOString() : new Date(0).toISOString()),
    // タグ名への解決は TagStore（画面群パッケージ）の責務。ここでは tagId をそのまま持つ。
    tags: (fileJson.appMeta?.tags ?? []).map((t) => t.tagId),
    thumbnailRef: fileJson.appMeta?.thumbnail != null ? fileJson.id : null,
    isTrashed: fileJson.isTrashed ?? false,
  };
}

export class SongIndexService {
  constructor(private readonly adapter: FileSystemAdapter) {}

  /**
   * `index.json` を読む。パース失敗・破損時は rebuildFromSongsFolder() へ自動フォールバックし、
   * Warning 相当を暫定出力する（例外は投げない）。
   */
  async load(): Promise<SongSummary[]> {
    let bytes: Uint8Array;
    try {
      bytes = await this.adapter.readFile(INDEX_FILE);
    } catch (error) {
      if (isFileNotFound(error)) return this.rebuildFromSongsFolder();
      warnProvisional('index.json の読み込みに失敗。songs/ から再構築します。', { error: String(error) });
      return this.rebuildFromSongsFolder();
    }
    try {
      const parsed = JSON.parse(decodeText(bytes)) as unknown;
      if (!Array.isArray(parsed)) throw new Error('index.json is not an array');
      return parsed as SongSummary[];
    } catch (error) {
      warnProvisional('index.json が破損しています。songs/ から再構築します。', { error: String(error) });
      return this.rebuildFromSongsFolder();
    }
  }

  /** 1 件を追加または更新して `index.json` を書き戻す。 */
  async upsert(summary: SongSummary): Promise<void> {
    const list = await this.load();
    const next = list.filter((s) => s.id !== summary.id);
    next.push(summary);
    await writeJsonFile(this.adapter, INDEX_FILE, next);
  }

  /** 1 件を除去して `index.json` を書き戻す（存在しなくてもエラーにしない）。 */
  async remove(songId: string): Promise<void> {
    const list = await this.load();
    await writeJsonFile(
      this.adapter,
      INDEX_FILE,
      list.filter((s) => s.id !== songId),
    );
  }

  /**
   * `songs/` 配下を全走査し、各ファイルのヘッダ部（id / title / タグ / 保存時刻）だけを読んで
   * `index.json` を再構築する。破損している個別ファイルはスキップする。
   */
  async rebuildFromSongsFolder(): Promise<SongSummary[]> {
    let entries;
    try {
      entries = await this.adapter.listDirectory(SONGS_DIR);
    } catch (error) {
      if (isFileNotFound(error)) {
        await writeJsonFile(this.adapter, INDEX_FILE, []);
        return [];
      }
      throw error;
    }

    const summaries: SongSummary[] = [];
    for (const entry of entries) {
      const songId = entry.isDirectory ? null : songIdFromFileName(entry.name);
      if (songId === null) continue;
      try {
        const raw = await this.adapter.readFile(songFilePath(songId));
        const fileJson = JSON.parse(decodeText(raw)) as Parameters<typeof toSongSummary>[0];
        summaries.push(toSongSummary({ ...fileJson, id: songId, updatedAt: entry.modifiedAt }));
      } catch (error) {
        warnProvisional(`曲ファイルの読み込みに失敗（スキップ）: ${songId}`, { error: String(error) });
      }
    }

    await writeJsonFile(this.adapter, INDEX_FILE, summaries);
    return summaries;
  }
}
