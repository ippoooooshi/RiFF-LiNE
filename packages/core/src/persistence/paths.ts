/**
 * ルート相対パスの組み立て（06_file_io_persistence.md §3）。
 * FileSystemAdapter は常にルート相対パスを受け取るため、区切りは `/` に固定する。
 */

import { SONG_FILE_EXT, SONGS_DIR, TMP_SUFFIX, TRASH_DIR } from './constants';

/** `songs/{id}.tabapp` */
export function songFilePath(songId: string): string {
  return `${SONGS_DIR}/${songId}${SONG_FILE_EXT}`;
}

/** `songs/{id}.tabapp.tmp`（アトミック書き込みの一時ファイル） */
export function songTmpFilePath(songId: string): string {
  return `${songFilePath(songId)}${TMP_SUFFIX}`;
}

/** `trash/{id}.tabapp` */
export function trashFilePath(songId: string): string {
  return `${TRASH_DIR}/${songId}${SONG_FILE_EXT}`;
}

/** `{id}.tabapp` → `id`。拡張子が違えば null。 */
export function songIdFromFileName(fileName: string): string | null {
  if (!fileName.endsWith(SONG_FILE_EXT)) return null;
  const id = fileName.slice(0, -SONG_FILE_EXT.length);
  return id.length > 0 && !id.includes('/') ? id : null;
}
