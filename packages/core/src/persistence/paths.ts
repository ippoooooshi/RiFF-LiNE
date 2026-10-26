/**
 * ルート相対パスの組み立て（06_file_io_persistence.md §3）。
 * FileSystemAdapter は常にルート相対パスを受け取るため、区切りは `/` に固定する。
 */

import {
  INDEX_FILE,
  LOGS_DIR,
  PREFERENCES_FILE,
  SONG_FILE_EXT,
  SONGS_DIR,
  STORAGE_SETTINGS_FILE,
  TAGS_FILE,
  THUMBNAILS_DIR,
  TMP_SUFFIX,
  TRASH_DIR,
  TRASH_INDEX_FILE,
  TUNING_PRESETS_FILE,
} from './constants';

/** 主ストレージの木の 1 行（data-model-persistence.md 13.1 節の表。1 行に 1 つのパスだけ）。 */
export interface PrimaryStorageTreeEntry {
  /** `TabApp/` からの相対パス。 */
  readonly path: string;
  /** フォルダ（中のファイルを下のフォルダごと写す）かファイルか。 */
  readonly kind: 'directory' | 'file';
  /** 保存先の移行（12 節）で写すか。 */
  readonly migrate: boolean;
}

/**
 * 主ストレージの `TabApp/` の下の木（data-model-persistence.md 13.1 節の表）と、保存先の移行で写すかどうか。
 * `logs/` だけは写さない（13.1 節、基本設計 13 章 C14）。写すかどうかは、この表だけで決める。
 */
// data-model-persistence.md 13.1 節：主ストレージの木に限り、songs/（サブフォルダごと）・trash/・trash-index.json・index.json・thumbnails/・tuning-presets.json・tags.json・settings.json・preferences.json を移し、logs/ とローカル既定パスのファイルは移さず古い logs/ は追わない <!-- req datamodelpersistence:ba28d012.f4db --> <!-- req datamodelpersistence:790be758.7e93 --> <!-- req datamodelpersistence:15d25b97.be6d --> <!-- req datamodelpersistence:760462d1.09af --> <!-- req datamodelpersistence:39a81d30.d8a3 --> <!-- req datamodelpersistence:b81b3c3b.a885 --> <!-- req datamodelpersistence:1a3c735e.5253 --> <!-- req datamodelpersistence:fa0cc9c9.4df7 --> <!-- req datamodelpersistence:9b9d539e.b58b --> <!-- req datamodelpersistence:182df8f4.4a9c --> <!-- req datamodelpersistence:acec37bd.d920 --> <!-- req datamodelpersistence:acec37bd.f80d --> <!-- req datamodelpersistence:acec37bd.adf6 --> <!-- req datamodelpersistence:acec37bd.5802 --> <!-- req datamodelpersistence:e0dd6d5d.12fe --> <!-- req datamodelpersistence:639788d0.7d7f --> <!-- req datamodelpersistence:639788d0.1500 -->
export const PRIMARY_STORAGE_TREE: readonly PrimaryStorageTreeEntry[] = [
  { path: SONGS_DIR, kind: 'directory', migrate: true },
  { path: TRASH_DIR, kind: 'directory', migrate: true },
  { path: TRASH_INDEX_FILE, kind: 'file', migrate: true },
  { path: INDEX_FILE, kind: 'file', migrate: true },
  { path: THUMBNAILS_DIR, kind: 'directory', migrate: true },
  { path: TUNING_PRESETS_FILE, kind: 'file', migrate: true },
  { path: TAGS_FILE, kind: 'file', migrate: true },
  { path: STORAGE_SETTINGS_FILE, kind: 'file', migrate: true },
  { path: PREFERENCES_FILE, kind: 'file', migrate: true },
  { path: LOGS_DIR, kind: 'directory', migrate: false },
];

/** 曲のファイル（`songs/` か `trash/` の下の `.tabapp`）のパスか。移行で `integrity.checksum` も確かめる対象（12 節の 3）。 */
export function isSongFileInTree(relativePath: string): boolean {
  return (
    relativePath.endsWith(SONG_FILE_EXT) &&
    (relativePath.startsWith(`${SONGS_DIR}/`) || relativePath.startsWith(`${TRASH_DIR}/`))
  );
}

// data-model-persistence.md 5 節：id を曲のファイルの名前 {id}.tabapp に使う <!-- req datamodelpersistence:fbd2e0bc.7b1a -->
/** `songs/{id}.tabapp` */
// data-model-persistence.md 7 節：SongFileJson の id はファイルの名前と同じにする <!-- req datamodelpersistence:d485e2f4.2929 -->
// data-model-persistence.md 13.1 節：songs/ には曲のファイル {songId}.tabapp を置く <!-- req datamodelpersistence:ba28d012.c349 -->
export function songFilePath(songId: string): string {
  return `${SONGS_DIR}/${songId}${SONG_FILE_EXT}`;
}

/** `songs/{id}.tabapp.tmp`（アトミック書き込みの一時ファイル） */
export function songTmpFilePath(songId: string): string {
  return `${songFilePath(songId)}${TMP_SUFFIX}`;
}

/** `trash/{id}.tabapp` */
// data-model-persistence.md 10.1 節：ゴミ箱 trash/ を保存先のルート（TabApp/）の中に置く <!-- req datamodelpersistence:feeb91c5.d73e -->
export function trashFilePath(songId: string): string {
  return `${TRASH_DIR}/${songId}${SONG_FILE_EXT}`;
}

/** `{id}.tabapp` → `id`。拡張子が違えば null。 */
export function songIdFromFileName(fileName: string): string | null {
  if (!fileName.endsWith(SONG_FILE_EXT)) return null;
  const id = fileName.slice(0, -SONG_FILE_EXT.length);
  return id.length > 0 && !id.includes('/') ? id : null;
}
