/**
 * 曲一覧ウィンドウ／新規曲作成ウィザードの操作オーケストレーション（screens-navigation.md §4.8 #1・#2、§5.2、§3.5）。
 *
 * 純粋な調停ロジック（曲数評価 → 作成 → 編集ウィンドウを開く、`SONG-001`/`SONG-002` の発火判定）を
 * DOM / IPC から切り離して `apps/desktop/src/renderer` に置き、`App.tsx` が実 dep（`SongRepository.create` /
 * `window.riffLineApi.windows.openSong` / `notificationCenter.report`）を注入する。ここは Node 環境で単体テスト可能。
 */

import { SONG_COUNT_LIMIT, SONG_COUNT_WARN_THRESHOLD, type NewSongSetup } from '@riff-line/core';

/** `createSongAndOpen` の依存（すべて注入）。 */
export interface SongCreationDeps {
  /** ゴミ箱を除いた現在の曲数。 */
  countActiveSongs(): Promise<number> | number;
  /** 曲を新規作成し、生成された曲 ID を返す（`SongRepository.create`）。 */
  createSong(setup: NewSongSetup): Promise<string>;
  /** 編集ウィンドウを開く（`window.riffLineApi.windows.openSong`）。 */
  openSong(songId: string): Promise<void>;
  /** 通知発行（`notificationCenter.report`）。 */
  report(code: string, context?: Record<string, unknown>): void;
}

/**
 * 新規曲を作成して編集ウィンドウを開く（screens-navigation.md §5.2）。
 *
 * - 現在の曲数が上限（1000）以上なら **作成せず** `SONG-002`（Error＝拒否、C12）を発行して `null` を返す。
 * - 作成後の曲数が警告しきい値（900、上限の 90%）以上なら `SONG-001`（Warning＝予告、拒否なし）を発行する。
 * - どちらにも該当しなければ作成 → `openSong` して曲 ID を返す。
 */
export async function createSongAndOpen(deps: SongCreationDeps, setup: NewSongSetup): Promise<string | null> {
  const count = await deps.countActiveSongs();

  if (count >= SONG_COUNT_LIMIT) {
    deps.report('SONG-002', { count });
    return null;
  }

  const songId = await deps.createSong(setup);

  if (count + 1 >= SONG_COUNT_WARN_THRESHOLD) {
    deps.report('SONG-001', { count: count + 1 });
  }

  await deps.openSong(songId);
  return songId;
}

/**
 * 曲一覧ロード時に、曲数が警告しきい値に達していれば `SONG-001` を発行する（拒否は伴わない予告、§3.5）。
 */
export function warnIfNearSongLimit(
  activeSongCount: number,
  report: (code: string, context?: Record<string, unknown>) => void,
): void {
  if (activeSongCount >= SONG_COUNT_WARN_THRESHOLD) {
    report('SONG-001', { count: activeSongCount });
  }
}
