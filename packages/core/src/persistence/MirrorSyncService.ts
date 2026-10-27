/**
 * 主ストレージへの保存が成功した後の、ミラー先への写し（data-model-persistence.md 14.1 節、基本設計 06 章 4 節）。
 *
 * - `syncAfterSave` は待たずに写しを始める（戻り値を待たせない）。呼ぶのは `AutoSaveScheduler` の `onSaved` の 1 か所で、
 *   `SongRepository` には渡さない（data-model-persistence.md 14.1 節の (b)）。
 * - 写すのは、保存した曲のファイル（`songs/{サブフォルダ/}{id}.tabapp`）と `index.json` の 2 つだけ。ミラー先の `TabApp/` の下の
 *   同じ相対パスへ、どちらも一時ファイルからの改名で書く。ミラー先から消す処理は持たない（ゴミ箱へ入れてもミラー先の曲は残す）。
 * - 失敗は中で受けて Warning の `FILE-005` を出し、外へ投げない（ミラーは保険で、主の保存を犠牲にしない）。
 * - `awaitPending` は進んでいる写しの終わりを待ち、終われば true、`timeoutMs` が過ぎたら false で解決する。投げない。
 *   false のときのログ（Warning の `FILE-015`）は、呼んだ main の終了の処理が書く（ここでは書かない）。
 */

import type { FileSystemAdapter, FileSystemAdapterFactory } from '../platform';

import { notificationCenter } from '../errors';

import { INDEX_FILE, MIRROR_AWAIT_PENDING_TIMEOUT_MS } from './constants';
import { decodeText, writeFileAtomically } from './jsonIo';
import { songFilePath, songFolderPath } from './paths';

/** 主ストレージから読んだ、写す 2 つの中身。 */
interface MirrorPayload {
  /** 曲のサブフォルダ（`songs/` からの相対。空の文字列は `songs/` の直下）。 */
  folder: string;
  songBytes: Uint8Array;
  indexBytes: Uint8Array;
}

/**
 * `index.json` の中身から曲の `folder` を引く（data-model-persistence.md 15 節の (b)：サブフォルダは `index.json` の `folder` で決める）。
 * 索引に無い曲・`folder` が文字列でない曲は `songs/` の直下（空の文字列）とする。
 * @throws SyntaxError JSON として読めない。
 */
// <!-- req datamodelpersistence:6a5a3c14.600f -->
// <!-- req datamodelpersistence:6a5a3c14.39b4 -->
export function folderOfSongInIndex(indexBytes: Uint8Array, songId: string): string {
  const parsed = JSON.parse(decodeText(indexBytes)) as unknown;
  if (!Array.isArray(parsed)) return '';
  for (const item of parsed as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as { id?: unknown; folder?: unknown };
    if (entry.id === songId) return typeof entry.folder === 'string' ? entry.folder : '';
  }
  return '';
}

// <!-- req datamodelpersistence:af93c541.a053 -->
// <!-- req datamodelpersistence:f94e3602.5dfd -->
// <!-- req datamodelpersistence:f94e3602.7094 -->
export class MirrorSyncService {
  /** 進んでいる写し。awaitPending がこれを待つ。 */
  private readonly pending = new Set<Promise<void>>();

  /**
   * @param sourceAdapter 主ストレージのアダプタ（写す元の曲のファイルと `index.json` を読む）。
   * @param adapterFactory ミラー先のルートごとのアダプタを作る。
   */
  constructor(
    // <!-- req datamodelpersistence:e5d32992.a614 -->
    private readonly sourceAdapter: FileSystemAdapter,
    // <!-- req datamodelpersistence:e5d32992.c91f -->
    private readonly adapterFactory: FileSystemAdapterFactory,
  ) {}

  /**
   * 待たずに写しを始める。失敗は中で受けて FILE-005 を出し、外へ投げない。
   * @param songId 保存した曲。
   * @param mirrorRoots ミラー先のルートの絶対パス（`{...}/TabApp` まで含む）。
   */
  // <!-- req datamodelpersistence:cfa86780.af44 -->
  // <!-- req datamodelpersistence:cfa86780.05b4 -->
  // <!-- req datamodelpersistence:cfa86780.c477 -->
  // <!-- req datamodelpersistence:f06935f1.ffd2 -->
  syncAfterSave(songId: string, mirrorRoots: string[]): void {
    if (mirrorRoots.length === 0) return;

    // <!-- req datamodelpersistence:f06935f1.5b15 -->
    // <!-- req datamodelpersistence:b32daf03.b453 -->
    const task = this.copyToMirrors(songId, mirrorRoots);
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  /**
   * 進んでいる写しが全部終わるか、timeoutMs が過ぎるまで待つ。過ぎても投げず、終われば true、過ぎたら false で解決する。
   * @param timeoutMs 待つ上限（ms）。省くと MIRROR_AWAIT_PENDING_TIMEOUT_MS（data-model-persistence.md 14.1 節）。
   */
  // <!-- req datamodelpersistence:6b66a105.4288 -->
  // <!-- req datamodelpersistence:6b66a105.978a -->
  // <!-- req datamodelpersistence:6b66a105.70d5 -->
  // <!-- req datamodelpersistence:439586de.0f24 -->
  // <!-- req datamodelpersistence:9eee465a.281b -->
  async awaitPending(timeoutMs: number = MIRROR_AWAIT_PENDING_TIMEOUT_MS): Promise<boolean> {
    if (this.pending.size === 0) return true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    // copyToMirrors は投げないので allSettled でなく all で足りる。
    const done = Promise.all([...this.pending]).then(() => true as const);

    const result = await Promise.race([done, timeout]);
    clearTimeout(timer);
    return result;
  }

  /** 1 曲ぶんを全部のミラー先へ写す。投げない（失敗はミラー先ごとに FILE-005）。 */
  private async copyToMirrors(songId: string, mirrorRoots: string[]): Promise<void> {
    let payload: MirrorPayload;
    try {
      payload = await this.readPayload(songId);
    } catch (error) {
      // 写す元が読めなければ、どのミラー先へも書けない。利用者から見れば「ミラーされなかった」ので FILE-005。
      notificationCenter.report('FILE-005', { songId, reason: 'source-read-failed', error: String(error) });
      return;
    }

    await Promise.all(
      // <!-- req datamodelpersistence:f06935f1.707a -->
      mirrorRoots.map(async (root) => {
        try {
          // <!-- req datamodelpersistence:a5185d1e.189a -->
          const mirror = this.adapterFactory.createForRoot(root);
          await mirror.ensureDirectory(songFolderPath(payload.folder));
          // 曲のファイルを先に書き、そのあと曲を指す index.json を書く（索引が無い曲を指さないため）。
          // <!-- req datamodelpersistence:f94e3602.0b81 -->
          // <!-- req datamodelpersistence:f94e3602.8b22 -->
          await writeFileAtomically(mirror, songFilePath(songId, payload.folder), payload.songBytes);
          // <!-- req datamodelpersistence:f94e3602.f6fa -->
          await writeFileAtomically(mirror, INDEX_FILE, payload.indexBytes);
        } catch (error) {
          // FILE-005（Warning）：ミラー先への書き込みの失敗。主の保存は終わっているので、保険が欠けるだけ。
          // <!-- req datamodelpersistence:0d8ddc22.93f7 -->
          // <!-- req datamodelpersistence:0d8ddc22.eb74 -->
          // <!-- req datamodelpersistence:0d8ddc22.a2e0 -->
          // <!-- req datamodelpersistence:f06935f1.3c90 -->
          // <!-- req datamodelpersistence:f06935f1.2d08 -->
          // <!-- req datamodelpersistence:f06935f1.d1b6 -->
          notificationCenter.report('FILE-005', { songId, mirrorRoot: root, error: String(error) });
        }
      }),
    );
  }

  /** 主ストレージから `index.json` と曲のファイルを読む。曲のファイルの場所は `index.json` の `folder` で決める。 */
  // <!-- req datamodelpersistence:f94e3602.c261 -->
  // <!-- req datamodelpersistence:d3a7325e.de6b -->
  private async readPayload(songId: string): Promise<MirrorPayload> {
    const indexBytes = await this.sourceAdapter.readFile(INDEX_FILE);
    const folder = folderOfSongInIndex(indexBytes, songId);
    const songBytes = await this.sourceAdapter.readFile(songFilePath(songId, folder));
    return { folder, songBytes, indexBytes };
  }
}
