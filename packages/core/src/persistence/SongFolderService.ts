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
// <!-- req datamodelpersistence:c9252048.61a5 -->
const INVALID_FOLDER_NAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * Windows の予約名（`CON`・`PRN`・`AUX`・`NUL`・`COM1`〜`COM9`・`LPT1`〜`LPT9`）。大文字と小文字を区別せず、
 * 後ろに `.` と文字が続くものも含む（data-model-persistence.md 9.2 節）。
 */
// <!-- req datamodelpersistence:3342b9a9.aa1c --> <!-- req datamodelpersistence:3342b9a9.0a1e --> <!-- req datamodelpersistence:3342b9a9.2916 --> <!-- req datamodelpersistence:3342b9a9.b095 --> <!-- req datamodelpersistence:3342b9a9.1fae --> <!-- req datamodelpersistence:3342b9a9.31be --> <!-- req datamodelpersistence:3342b9a9.cd2b --> <!-- req datamodelpersistence:3342b9a9.cc2b -->
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
 * 予約名なら予約名の部分の後ろに `_` を足す（「CON」なら「CON_」）。後ろに `.` と文字が続く名前は、
 * 最初の `.` の前に `_` を足す（「aux.txt」なら「aux_.txt」。2026-10-27 本人決定、honnin-queue 208 番）。
 */
// <!-- req datamodelpersistence:c9252048.514e -->
export function finalizeFolderName(raw: string): string | null {
  // <!-- req datamodelpersistence:465fc7fe.ffdd --> <!-- req datamodelpersistence:465fc7fe.0566 -->
  const name = removeInvalidFolderNameChars(raw).replace(TRAILING_DOTS_AND_SPACES, '');
  if (name === '') return null;
  // 予約名の部分（1 つ目の組）の直後に `_` を入れ、`.` から後ろ（2 つ目の組。無ければ空の文字列）をそのまま続ける。予約名でなければ変えない
  // <!-- req datamodelpersistence:3342b9a9.2d64 --> <!-- req datamodelpersistence:3342b9a9.208a -->
  // <!-- req datamodelpersistence:3342b9a9.6026 -->
  // <!-- req datamodelpersistence:3342b9a9.9478 -->
  return name.replace(RESERVED_FOLDER_NAME, '$1_$2');
}

/** 親のフォルダ（`songs/` からの相対、直下は空の文字列）と名前をつなぐ。 */
function joinFolder(parent: string, name: string): string {
  // <!-- req datamodelpersistence:7b2a8059.7125 -->
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
    // <!-- req datamodelpersistence:465fc7fe.e57b -->
    if (name === null) return null;
    // <!-- req datamodelpersistence:7b2a8059.cb76 --> <!-- req datamodelpersistence:f8ba311f.f2bb --> <!-- req datamodelpersistence:f8ba311f.2063 -->
    const folder = joinFolder(parentFolder, name);
    // <!-- req datamodelpersistence:7b2a8059.fa66 --> <!-- req datamodelpersistence:f8ba311f.9e00 -->
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
    // <!-- req datamodelpersistence:465fc7fe.c1d0 -->
    if (name === null) return folder;
    const renamed = joinFolder(parentFolderOf(folder), name);
    if (renamed === folder) return folder;
    // <!-- req datamodelpersistence:f8ba311f.2971 --> <!-- req datamodelpersistence:f8ba311f.4598 -->
    await this.adapter.renameFile(songFolderPath(folder), songFolderPath(renamed));
    // <!-- req datamodelpersistence:f8ba311f.68ba -->
    await this.indexService.replaceFolderPrefix(folder, renamed);
    return renamed;
  }

  /**
   * フォルダを消す。中が空（曲もフォルダも無い）のときだけ消す。空のフォルダを消しても `index.json` は変わらない。
   * 消すのは `removeEmptyDirectory`（data-model-persistence.md 9.2 節・10.1 節。`deleteFile` はフォルダを消さない）。
   * @returns 消したら true。中が空でなければ消さずに false。
   * @throws FileWriteError 中を確かめた後に中身が入ったなど、消せなかった（`removeEmptyDirectory` の失敗をそのまま伝える）。
   */
  async deleteFolder(folder: string): Promise<boolean> {
    const path = songFolderPath(folder);
    const entries = await this.adapter.listDirectory(path);
    // <!-- req datamodelpersistence:f8ba311f.942b -->
    if (entries.length > 0) return false;
    // <!-- req datamodelpersistence:f8ba311f.784d -->
    // <!-- req datamodelpersistence:f8ba311f.a5ee -->
    await this.adapter.removeEmptyDirectory(path);
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
    // <!-- req datamodelpersistence:d65f65d5.592b --> <!-- req datamodelpersistence:d65f65d5.15a2 --> <!-- req datamodelpersistence:d65f65d5.66bb -->
    await this.adapter.renameFile(songFilePath(songId, summary.folder), songFilePath(songId, toFolder));
    // <!-- req datamodelpersistence:d65f65d5.ae57 --> <!-- req datamodelpersistence:8af93d68.dfc3 --> <!-- req datamodelpersistence:688b1f5f.5dfa -->
    await this.indexService.upsert({ ...summary, folder: toFolder });
  }
}
