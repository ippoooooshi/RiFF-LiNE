/**
 * 曲一覧のフォルダの実体（data-model-persistence.md 9.2 節）。フォルダは `songs/` の下のサブフォルダで、
 * `SongSummary.folder` は `songs/` からの相対パス（区切りは `/`、直下は空の文字列）。
 *
 * 作る・名前を変える・消す（中が空のときだけ）・曲をフォルダへ移すの 4 つと、フォルダの名前を確定する決まりを持つ。
 * エラーのコードと知らせは足さない（9.2 節、honnin-queue 48 番の (3)）。名前の欄（入力の側）は作業パッケージ 8。
 */

import type { FileSystemAdapter } from '../platform';

import { SongNotFoundError } from './errors';
import { songFilePath, songFolderPath } from './paths';
import type { SongIndexService } from './SongIndexService';

/** Windows のファイル名に使えない 9 文字（`\ / : * ? " < > |`、data-model-persistence.md 9.2 節）。 */
const INVALID_FOLDER_NAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * Windows の予約名（`CON`・`PRN`・`AUX`・`NUL`・`COM1`〜`COM9`・`LPT1`〜`LPT9`）。大文字と小文字を区別せず、
 * 後ろに `.` と文字が続くものも含む（data-model-persistence.md 9.2 節）。
 */
const RESERVED_FOLDER_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..+)?$/i;

/** 名前の末尾の点と空白。 */
const TRAILING_DOTS_AND_SPACES = /[. ]+$/;

/** 使えない 9 文字を除く。打った文字と貼り付けた文字の両方に使う（data-model-persistence.md 9.2 節）。 */
export function removeInvalidFolderNameChars(text: string): string {
  return text.replace(INVALID_FOLDER_NAME_CHARS, '');
}

/**
 * フォルダの名前を確定する（data-model-persistence.md 9.2 節）。使えない文字を除き、末尾の点と空白を取り除く。
 * 取り除いて空になれば null（作るときは作らず、名前を変えるときは前の名前のままにする）。
 * 予約名なら後ろに `_` を足す（「CON」なら「CON_」）。
 */
export function finalizeFolderName(raw: string): string | null {
  const name = removeInvalidFolderNameChars(raw).replace(TRAILING_DOTS_AND_SPACES, '');
  if (name === '') return null;
  return RESERVED_FOLDER_NAME.test(name) ? `${name}_` : name;
}

/** 親のフォルダ（`songs/` からの相対、直下は空の文字列）と名前をつなぐ。 */
function joinFolder(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`;
}

/** フォルダの親（`songs/` の直下のフォルダなら空の文字列）。 */
function parentFolderOf(folder: string): string {
  const slash = folder.lastIndexOf('/');
  return slash < 0 ? '' : folder.slice(0, slash);
}

export class SongFolderService {
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly indexService: SongIndexService,
  ) {}

  /**
   * フォルダを作る。選んでいるフォルダの中（選んでいなければ `songs/` の直下）にサブフォルダを作る（`ensureDirectory`）。
   * @param parentFolder 選んでいるフォルダ。選んでいなければ空の文字列。
   * @returns 作ったフォルダ（`songs/` からの相対）。名前が確定できず作らなかったときは null。
   */
  async createFolder(parentFolder: string, rawName: string): Promise<string | null> {
    const name = finalizeFolderName(rawName);
    if (name === null) return null;
    const folder = joinFolder(parentFolder, name);
    await this.adapter.ensureDirectory(songFolderPath(folder));
    return folder;
  }

  /**
   * フォルダの名前を変える（`renameFile`）。その下にある曲の全部の `folder` の先頭を新しいパスに直す。
   * 名前が確定できない（空になる）ときは前の名前のままにする。
   * @returns 変えた後のフォルダ（`songs/` からの相対）。変えなかったときは元のフォルダ。
   */
  async renameFolder(folder: string, rawNewName: string): Promise<string> {
    const name = finalizeFolderName(rawNewName);
    if (name === null) return folder;
    const renamed = joinFolder(parentFolderOf(folder), name);
    if (renamed === folder) return folder;
    await this.adapter.renameFile(songFolderPath(folder), songFolderPath(renamed));
    await this.indexService.replaceFolderPrefix(folder, renamed);
    return renamed;
  }

  /**
   * フォルダを消す。中が空（曲もフォルダも無い）のときだけ消す。空のフォルダを消しても `index.json` は変わらない。
   * @returns 消したら true。中が空でなければ消さずに false。
   */
  async deleteFolder(folder: string): Promise<boolean> {
    const path = songFolderPath(folder);
    const entries = await this.adapter.listDirectory(path);
    if (entries.length > 0) return false;
    await this.adapter.deleteFile(path);
    return true;
  }

  /**
   * 曲をフォルダへ移す。曲のファイルを `songs/` の下で動かし（`renameFile`）、`index.json` のその曲の `folder` を差分で直す。
   * 動かすのはファイルだけで、曲のファイルの中身は変えない。
   * @param toFolder 移す先（`songs/` からの相対、直下は空の文字列）。
   * @throws SongNotFoundError 曲が索引に無い。
   */
  async moveSong(songId: string, toFolder: string): Promise<void> {
    const summary = await this.indexService.find(songId);
    if (summary === undefined) throw new SongNotFoundError(songId);
    if (summary.folder === toFolder) return;
    await this.adapter.ensureDirectory(songFolderPath(toFolder));
    await this.adapter.renameFile(songFilePath(songId, summary.folder), songFilePath(songId, toFolder));
    await this.indexService.upsert({ ...summary, folder: toFolder });
  }
}
