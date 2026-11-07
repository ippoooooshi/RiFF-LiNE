/**
 * サムネイルの写し（`thumbnails/{songId}.png`）の書き方と作り直し（data-model-persistence.md 9.1 節）。
 *
 * 写しは、曲のファイルの `appMeta.thumbnail` の base64 を PNG のバイト列に戻して、一時ファイルからの改名で書く。
 * 書く所は、保存（`SongRepository.save`）・ゴミ箱から戻す・取り込み・写しが見つからないときの作り直し（`thumbnail:regenerate`）で同じ
 * `writeThumbnailCopy` 1 つにする。
 * main（apps/desktop/src/main）も作り直しのために読むので、alphaTab を import しない（細い入口 `persistence/mirror` から出す）。
 */

import type { FileSystemAdapter } from '../platform';

import { INDEX_FILE, THUMBNAILS_DIR } from './constants';
import { decodeText, writeFileAtomically } from './jsonIo';
import { folderOfSongInIndex } from './MirrorSyncService';
import { songFilePath, thumbnailFilePath } from './paths';
import type { SongFileForSummary } from './SongIndexService';

/**
 * サムネイルの写しを書く（data-model-persistence.md 9.1 節）。`appMeta.thumbnail.data` の base64 を PNG のバイト列に戻して、
 * `thumbnails/{songId}.png` へ一時ファイルからの改名で書く。
 * @throws DOMException base64 として読めない。
 */
export async function writeThumbnailCopy(adapter: FileSystemAdapter, songId: string, base64Png: string): Promise<void> {
  // <!-- req datamodelpersistence:5abec475.d90e -->
  const binary = atob(base64Png); // <!-- req datamodelpersistence:e3d56cc3.67ea -->
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await adapter.ensureDirectory(THUMBNAILS_DIR);
  // <!-- req datamodelpersistence:5abec475.feb7 -->
  await writeFileAtomically(adapter, thumbnailFilePath(songId), bytes);
}

/** `index.json` からその曲の `folder` を引く。読めない（無い・壊れている）ときと索引に無い曲は `songs/` の直下（空の文字列）。 */
async function folderOfSong(adapter: FileSystemAdapter, songId: string): Promise<string> {
  try {
    return folderOfSongInIndex(await adapter.readFile(INDEX_FILE), songId);
  } catch {
    // 索引を作り直すのは曲一覧の仕事（9.1 節の rebuildFromSongsFolder）。ここでは読むだけで書かない。
    return '';
  }
}

/**
 * 曲一覧が `thumbnailRef` の写しを見つけられないとき、曲のファイルを読んで `appMeta.thumbnail` から写しを作り直す
 * （data-model-persistence.md 9.1 節、`thumbnail:regenerate` の中身）。曲のファイルの場所は `index.json` の `folder` で決め、
 * `index.json` は読むだけで作り直さない。
 * @returns 写しを書いたら true。曲のファイルが読めない（無い・JSON でない）か `appMeta.thumbnail` が null なら、写さずに false。
 * @throws 写しを書けない（base64 として読めない・書き込みの失敗）。
 */
export async function regenerateThumbnailCopy(adapter: FileSystemAdapter, songId: string): Promise<boolean> {
  const folder = await folderOfSong(adapter, songId);
  let thumbnail: { data: string } | null | undefined;
  try {
    const fileJson = JSON.parse(
      decodeText(await adapter.readFile(songFilePath(songId, folder))), // <!-- req datamodelpersistence:e3d56cc3.d80d --> <!-- req datamodelpersistence:e3d56cc3.c277 -->
    ) as SongFileForSummary | null;
    thumbnail = fileJson?.appMeta?.thumbnail;
  } catch {
    // 曲のファイルが読めない：写さずに false（9.1 節）
    return false; // <!-- req datamodelpersistence:e3d56cc3.577e -->
  }
  // appMeta.thumbnail が null：写さずに false（9.1 節）
  if (thumbnail == null) return false; // <!-- req datamodelpersistence:e3d56cc3.8559 -->
  await writeThumbnailCopy(adapter, songId, thumbnail.data); // <!-- req datamodelpersistence:e3d56cc3.6f55 -->
  return true;
}
