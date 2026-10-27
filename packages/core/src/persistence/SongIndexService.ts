/**
 * `index.json`（曲一覧の軽い索引）の読み書きと差分の直し（data-model-persistence.md 9 節・9.1 節・9.2 節）。
 *
 * 曲のファイルを全部読まずに曲一覧を出すための索引で、1 曲を 1 件の `SongSummary` で持つ。
 * 直すのは `upsert`（足す・替える）と `remove`（消す）の 1 件ずつで、直した後の一覧を一時ファイルからの改名で書く。
 * 読めない（壊れている・無い）ときは `rebuildFromSongsFolder()` で `songs/` の下から作り直し、Warning の `SONG-003` を出す。
 * サムネイルの写し（`thumbnails/{songId}.png`）の書き方と作り直しもここに置く（`thumbnailRef` を持つのが索引のため）。
 */

import { model } from '@coderline/alphatab';

import type { FileSystemAdapter } from '../platform';

import type { SongSummary } from '../domain/types';
import { notificationCenter } from '../errors';

import { INDEX_FILE, THUMBNAILS_DIR, TMP_SUFFIX } from './constants';
import { decodeText, encodeJson, isFileNotFound } from './jsonIo';
import { warnProvisional } from './log';
import { songFilePath, songFolderPath, songIdFromFileName, thumbnailFilePath } from './paths';

/** 曲一覧の索引を作るのに要る、曲のファイルの一部（data-model-persistence.md 7 節の SongFileJson のうち読むものだけ）。 */
export interface SongFileForSummary {
  id: string;
  createdAt?: string;
  song?: unknown;
  appMeta?: {
    tags?: { tagId: string }[];
    thumbnail?: { encoding: string; data: string } | null;
  };
  integrity?: { savedAtMonotonic?: number };
}

/**
 * 先頭のパートの楽器の種類を、MIDI のプログラム番号から読み戻す（part-tuning-management.md 2.1 節）。
 * 対応は 1 対 1 で、30 がエレキギター、33 がベース。どちらでもない番号は null。
 */
const INSTRUMENT_TYPE_BY_PROGRAM: ReadonlyMap<number, 'electric_guitar' | 'bass'> = new Map([
  [30, 'electric_guitar'],
  [33, 'bass'],
]);

/** 書き込みの時刻が読めないときの日時（1970-01-01T00:00:00.000Z）。 */
const EPOCH_ISO = new Date(0).toISOString();

/**
 * 曲から `SongSummary` を作る（data-model-persistence.md 9 節）。曲名・アーティスト名・先頭のパートは Score から、
 * 作成日時は曲のファイルの `createdAt`、更新日時は `integrity.savedAtMonotonic` から作る（7 節）。
 * `thumbnailRef` は `appMeta.thumbnail` があれば `thumbnails/{songId}.png`、無ければ null（9.1 節）。
 */
export function summarizeSong(source: {
  id: string;
  createdAt: string | undefined;
  score: model.Score;
  appMeta: SongFileForSummary['appMeta'];
  savedAtMonotonic: number | undefined;
  folder: string;
}): SongSummary {
  const { score } = source;
  // <!-- req datamodelpersistence:aa5fdd30.b005 -->
  const firstTrack = score.tracks[0];
  const savedAt = source.savedAtMonotonic;
  return {
    id: source.id,
    title: score.title.length > 0 ? score.title : '(無題)',
    artist: score.artist,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : EPOCH_ISO,
    // <!-- req datamodelpersistence:d2fc6535.a859 --> <!-- req datamodelpersistence:1cf63af6.70e2 --> <!-- req datamodelpersistence:b40ba64d.b9ec -->
    updatedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? new Date(savedAt).toISOString() : EPOCH_ISO,
    // タグ名への解決は TagStore（画面群パッケージ）の責務。ここでは tagId をそのまま持つ。
    // <!-- req datamodelpersistence:27ac79dd.bec8 -->
    tags: (source.appMeta?.tags ?? []).map((t) => t.tagId),
    // <!-- req datamodelpersistence:f2c915db.010d --> <!-- req datamodelpersistence:74b64601.aa42 --> <!-- req datamodelpersistence:5abec475.2cc1 -->
    thumbnailRef: source.appMeta?.thumbnail != null ? thumbnailFilePath(source.id) : null,
    // <!-- req datamodelpersistence:76b095fe.086f --> <!-- req datamodelpersistence:aa5fdd30.9b98 -->
    firstPartInstrumentType:
      firstTrack === undefined ? null : (INSTRUMENT_TYPE_BY_PROGRAM.get(firstTrack.playbackInfo.program) ?? null),
    // <!-- req datamodelpersistence:e3ee3eba.7950 --> <!-- req datamodelpersistence:e3ee3eba.fd9c -->
    firstPartTuningName: firstTrack === undefined ? null : (firstTrack.staves[0]?.stringTuning.name ?? null),
    folder: source.folder,
  };
}

/**
 * 曲のファイルの JSON から `SongSummary` を作る（索引の作り直しと、ゴミ箱から戻した曲で使う）。
 * `song` は alphaTab の `JsonConverter.jsonToScore` で Score に戻してから読む（data-model-persistence.md 2 節）。
 * @param folder 曲のファイルを置いた `songs/` からの相対フォルダ（直下なら空の文字列）。
 */
export function toSongSummary(fileJson: SongFileForSummary, folder = ''): SongSummary {
  const score = model.JsonConverter.jsonToScore(JSON.stringify(fileJson.song ?? {}));
  return summarizeSong({
    id: fileJson.id,
    createdAt: fileJson.createdAt,
    score,
    appMeta: fileJson.appMeta,
    // <!-- req datamodelpersistence:1cf63af6.020c --> <!-- req datamodelpersistence:1cf63af6.b102 --> <!-- req datamodelpersistence:b40ba64d.abfd -->
    savedAtMonotonic: fileJson.integrity?.savedAtMonotonic,
    folder,
  });
}

/** 一時ファイル（`{path}.tmp`）へ書いてから改名する（data-model-persistence.md 15 節と同じ書き方）。 */
export async function writeFileAtomically(
  adapter: FileSystemAdapter,
  relativePath: string,
  data: Uint8Array,
): Promise<void> {
  const tmp = `${relativePath}${TMP_SUFFIX}`;
  await adapter.writeFile(tmp, data);
  await adapter.renameFile(tmp, relativePath);
}

/**
 * サムネイルの写しを書く（data-model-persistence.md 9.1 節）。`appMeta.thumbnail.data` の base64 を PNG のバイト列に戻して、
 * `thumbnails/{songId}.png` へ一時ファイルからの改名で書く。
 * @throws DOMException base64 として読めない。
 */
export async function writeThumbnailCopy(adapter: FileSystemAdapter, songId: string, base64Png: string): Promise<void> {
  // <!-- req datamodelpersistence:5abec475.d90e -->
  const binary = atob(base64Png);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await adapter.ensureDirectory(THUMBNAILS_DIR);
  // <!-- req datamodelpersistence:5abec475.feb7 -->
  await writeFileAtomically(adapter, thumbnailFilePath(songId), bytes);
}

// <!-- req datamodelpersistence:e5701d27.fc54 -->
export class SongIndexService {
  constructor(private readonly adapter: FileSystemAdapter) {}

  /**
   * `index.json` を読む（data-model-persistence.md 9 節）。読めない（無い・読み取りに失敗・JSON でない・配列でない）ときは
   * `rebuildFromSongsFolder()` で作り直し、Warning の `SONG-003`（`context.songCount` に作り直した曲の数）を出す（9.1 節）。
   */
  // <!-- req datamodelpersistence:55f2ceb0.d3b8 -->
  async load(): Promise<SongSummary[]> {
    try {
      // <!-- req datamodelpersistence:11a20e18.2b27 --> <!-- req datamodelpersistence:11a20e18.566b -->
      const parsed = JSON.parse(decodeText(await this.adapter.readFile(INDEX_FILE))) as unknown;
      if (Array.isArray(parsed)) return parsed as SongSummary[];
    } catch {
      // 読めないときは下で作り直す。
    }
    // <!-- req datamodelpersistence:0a2a65ec.4abc -->
    const rebuilt = await this.rebuildFromSongsFolder();
    // <!-- req datamodelpersistence:0a2a65ec.f5e1 --> <!-- req datamodelpersistence:0a2a65ec.8a5f -->
    notificationCenter.report('SONG-003', { songCount: rebuilt.length });
    return rebuilt;
  }

  /** 1 件を返す。索引に無ければ undefined。 */
  async find(songId: string): Promise<SongSummary | undefined> {
    return (await this.load()).find((s) => s.id === songId);
  }

  /** 1 件を足すか替えて、直した後の一覧を書く（data-model-persistence.md 9.1 節）。 */
  // <!-- req datamodelpersistence:0627499f.4f75 -->
  async upsert(summary: SongSummary): Promise<void> {
    const list = await this.load();
    // <!-- req datamodelpersistence:55f2ceb0.1bdf -->
    const index = list.findIndex((s) => s.id === summary.id);
    // <!-- req datamodelpersistence:0627499f.dd07 -->
    if (index >= 0) list[index] = summary;
    // <!-- req datamodelpersistence:0627499f.b227 -->
    else list.push(summary);
    // <!-- req datamodelpersistence:0627499f.b7f0 -->
    await this.write(list);
  }

  /** 1 件を外して、直した後の一覧を書く（無くてもエラーにしない。data-model-persistence.md 9.1 節）。 */
  // <!-- req datamodelpersistence:0627499f.cff9 -->
  async remove(songId: string): Promise<void> {
    const list = await this.load();
    await this.write(list.filter((s) => s.id !== songId));
  }

  /**
   * フォルダの名前を変えたとき、その下にある曲の全部の `folder` の先頭を新しいパスに直す（data-model-persistence.md 9.2 節）。
   * @returns 直した曲の数。
   */
  async replaceFolderPrefix(fromFolder: string, toFolder: string): Promise<number> {
    const list = await this.load();
    let changed = 0;
    const next = list.map((s) => {
      if (s.folder !== fromFolder && !s.folder.startsWith(`${fromFolder}/`)) return s;
      changed++;
      return { ...s, folder: `${toFolder}${s.folder.slice(fromFolder.length)}` };
    });
    await this.write(next);
    return changed;
  }

  /**
   * `songs/` の下（サブフォルダを含む）の曲のファイルを全部読んで `index.json` を作り直す（data-model-persistence.md 9.1 節）。
   * 更新日時はファイルの更新時刻ではなく `integrity.savedAtMonotonic` から作る（7 節）。読めない曲のファイルは飛ばす。
   */
  // <!-- req datamodelpersistence:0a2a65ec.d26a -->
  async rebuildFromSongsFolder(): Promise<SongSummary[]> {
    const summaries: SongSummary[] = [];
    await this.collectSongs('', summaries);
    // <!-- req datamodelpersistence:0a2a65ec.c8c6 -->
    await this.write(summaries);
    return summaries;
  }

  /**
   * 曲一覧が `thumbnailRef` の写しを見つけられないとき、曲のファイルを読んで `appMeta.thumbnail` から写しを作り直す
   * （data-model-persistence.md 9.1 節）。曲一覧への知らせと描き直しは呼び出し元が行う。
   * @returns 写しを作ったら true。曲のファイルの `appMeta.thumbnail` が null なら作らずに false。
   */
  // <!-- req datamodelpersistence:028688f6.2549 --> <!-- req datamodelpersistence:232e3ec5.be24 -->
  async rebuildThumbnailCopy(songId: string): Promise<boolean> {
    const folder = (await this.find(songId))?.folder ?? '';
    // <!-- req datamodelpersistence:028688f6.d80d -->
    const fileJson = JSON.parse(
      decodeText(await this.adapter.readFile(songFilePath(songId, folder))),
    ) as SongFileForSummary;
    const thumbnail = fileJson.appMeta?.thumbnail;
    if (thumbnail == null) return false;
    // <!-- req datamodelpersistence:028688f6.c277 -->
    await writeThumbnailCopy(this.adapter, songId, thumbnail.data);
    return true;
  }

  private async write(list: SongSummary[]): Promise<void> {
    // <!-- req datamodelpersistence:0627499f.646e -->
    await writeFileAtomically(this.adapter, INDEX_FILE, encodeJson(list));
  }

  /** `songs/{folder}` の中を下のフォルダまでたどって、曲のファイルを `out` に足す。 */
  private async collectSongs(folder: string, out: SongSummary[]): Promise<void> {
    let entries;
    try {
      entries = await this.adapter.listDirectory(songFolderPath(folder));
    } catch (error) {
      // songs/ がまだ無い（曲が 1 つも無い）ときは空の一覧にする。
      if (folder === '' && isFileNotFound(error)) return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        await this.collectSongs(folder === '' ? entry.name : `${folder}/${entry.name}`, out);
        continue;
      }
      const songId = songIdFromFileName(entry.name);
      if (songId === null) continue;
      try {
        const raw = await this.adapter.readFile(songFilePath(songId, folder));
        const fileJson = JSON.parse(decodeText(raw)) as SongFileForSummary;
        out.push(toSongSummary({ ...fileJson, id: songId }, folder));
      } catch (error) {
        warnProvisional(`曲ファイルの読み込みに失敗（スキップ）: ${songId}`, { error: String(error) });
      }
    }
  }
}
