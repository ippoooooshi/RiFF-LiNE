/**
 * 1 曲の読み込み・保存を担うアプリケーションサービス（data-model-persistence.md 15 節・7 節・8 節）。
 *
 * SchemaMigrator・ChecksumUtil・FileSystemAdapter・SongIndexService・LocalBackupService を協調させる。
 * ミラー同期の起動は AutoSaveScheduler の責務（data-model-persistence.md 15 節の流れの 6）。
 */

import type { FileSystemAdapter } from '../platform';

import { SongDocument, createEmptyAppMetadata } from '../domain/SongDocument';
import { createInitialScore } from '../domain/newSong';
import type { NewSongSetup } from '../domain/types';
import { evaluateSongCount } from '../domain/validation';
import { notificationCenter } from '../errors';

import { THUMBNAILS_DIR } from './constants';
import { SongCountLimitError, SongNotFoundError } from './errors';
import { encodeJson, isFileNotFound } from './jsonIo';
import { warnProvisional } from './log';
import type { PreMigrationService } from './PreMigrationService';
import type { SchemaMigrator } from './SchemaMigrator';
import { parseSongFileJson, verifySongFileChecksum } from './songFileCheck';
import type { SongIndexService } from './SongIndexService';
import { summarizeSong, writeFileAtomically, writeThumbnailCopy } from './SongIndexService';
import type { LocalBackupService } from './LocalBackupService';
import { songFilePath, songFolderPath, songTmpFilePath, thumbnailFilePath } from './paths';

/**
 * 複製の曲名を決める（data-model-persistence.md 18 節、2026-10-06 本人決定、honnin-queue 40 番）。
 * 「<元の曲名> のコピー」とし、同じ名前が既にあれば「<元の曲名> のコピー 2」「<元の曲名> のコピー 3」と、空いているいちばん小さい数を足す。
 * @param originalTitle 元の曲の、曲一覧に出る名前。
 * @param existingTitles `index.json` の `title` の全部（ゴミ箱の曲は `index.json` に無いので数えない）。
 */
export function duplicateSongTitle(originalTitle: string, existingTitles: readonly string[]): string {
  const taken = new Set(existingTitles);
  const base = `${originalTitle} のコピー`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// <!-- req datamodelpersistence:bfdafeb1.bb60 -->
// <!-- req datamodelpersistence:b32daf03.db17 -->
export class SongRepository {
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly migrator: SchemaMigrator,
    private readonly indexService: SongIndexService,
    private readonly localBackup: LocalBackupService,
    /** 変換する前の版を残す先（data-model-persistence.md 8 節の `PreMigration/`）。渡さなければ写さない。 */
    private readonly preMigration?: PreMigrationService,
  ) {}

  /**
   * 2 つ目の数が今の版より大きい版で読んだ曲の id（data-model-persistence.md 8 節、2026-10-27 本人決定、honnin-queue 213 番）。
   * ここに在る曲は読むだけ（編集も自動保存もしない）で開き、`AutoSaveScheduler` は保存しない。`allowEditing` で外す。
   */
  private readonly newerVersionSongIds = new Set<string>();

  /**
   * 2 つ目の数が今の版より大きい版で読んだ曲で、まだ `allowEditing` していないか（data-model-persistence.md 8 節）。
   * true の間、`AutoSaveScheduler` はその曲の `notifyDirty` と `flush` で保存しない。
   */
  isNewerVersion(songId: string): boolean {
    return this.newerVersionSongIds.has(songId);
  }

  /**
   * 「この曲はこのアプリより新しい版で作られています。…それでも直しますか？」で「直す」を選んだときに呼ぶ（data-model-persistence.md 8 節）。
   * 覚えを外し、そのあとは今までどおり保存する。保存で今のアプリが知らない項目が消え、版の数は今の版になる。
   */
  allowEditing(songId: string): void {
    this.newerVersionSongIds.delete(songId);
  }

  /**
   * 曲を読み込む（data-model-persistence.md 8 節）。
   * 本ファイルを `index.json` の `folder`（data-model-persistence.md 9.2 節）から決めた場所で読み、形を確かめ、`integrity.checksum` を確かめてから版を移し、曲をメモリに広げる。
   * 版の 1 つ目の数が今の版より小さい曲（変換の関数を当てる曲）だけ、変換の前に読んだバイトをそのまま `PreMigration/` へ写す
   * （`preMigration` を渡したとき）。1 つ目の数が同じで 2 つ目の数だけ違う曲は、読むときの整えで補うので写さない
   * （data-model-persistence.md 8 節の (b)、honnin-queue 211 番）。写せなかったときは Error の `FILE-001` を出して例外をそのまま上げ、
   * 変換せず、曲を開かない（2026-10-27 本人決定、honnin-queue 212 番）。
   * 変換した曲は次の自動保存で今の版で上書きされる（`save` が `SongDocument.schemaVersion` を書く）。
   * 2 つ目の数が今の版より大きい曲は、その id を覚える（`isNewerVersion`。honnin-queue 213 番）。今の版以下の曲を読んだら覚えを外す。
   * @throws SongNotFoundError ファイルが存在しない。
   * @throws CorruptSongFileError 壊れたファイル（JSON として読めない・いちばん上がオブジェクトでない・
   *   `schemaVersion` が空でない文字列でない。Critical=FILE-008）。
   * @throws IntegrityCheckFailedError チェックサム不一致（Critical=FILE-002、呼び出し元へ伝播）。
   * @throws UnsupportedSchemaVersionError 1 つ目の数が今より大きい版、または変換の関数がつながらない（Critical=FILE-004）。
   */
  // <!-- req datamodelpersistence:237a4084.f63e -->
  async load(songId: string): Promise<SongDocument> {
    // data-model-persistence.md 9.2 節：曲は songs/ の下のサブフォルダにも置かれるので、index.json の folder から場所を決める。
    // 索引に無い曲は save と同じく songs/ の直下を読む（無ければ SongNotFoundError）。
    const folder = (await this.indexService.find(songId))?.folder ?? '';
    let bytes: Uint8Array;
    try {
      // <!-- req datamodelpersistence:751e4fcb.73a4 -->
      // <!-- req datamodelpersistence:751e4fcb.962f -->
      bytes = await this.adapter.readFile(songFilePath(songId, folder));
    } catch (error) {
      if (isFileNotFound(error)) throw new SongNotFoundError(songId, { cause: error });
      throw error;
    }

    // data-model-persistence.md 8 節 (1)：JSON として読めなければ壊れたファイル（FILE-008、CorruptSongFileError）。FILE-004 は出さない。
    // 確かめは取り込み（19 節）と退かした版を戻すとき（20 節）と同じ songFileCheck.ts の関数で行う
    // <!-- req datamodelpersistence:7944390e.36d6 -->
    // <!-- req datamodelpersistence:7944390e.fc86 -->
    const parsed = parseSongFileJson(bytes, songId);

    // data-model-persistence.md 8 節 (2)(3)：版を調べる前に形を確かめる（SchemaMigrator が受け持つ）
    // <!-- req datamodelpersistence:ef05ede5.5366 -->
    // <!-- req datamodelpersistence:237a4084.8b3f -->
    const schemaVersion = this.migrator.checkShape(parsed);
    const raw = parsed as {
      song?: unknown;
      appMeta?: unknown;
      integrity?: { checksum?: string };
    };

    // マイグレーション前の生の内容でチェックサムを検証する（data-model-persistence.md 15 節の順序）。合わなければ Critical の FILE-002 と
    // IntegrityCheckFailedError。文言の「復元しますか？」の手段は呼び出し元が LocalBackupService.restore(songId) で出す（B25）。
    // <!-- req datamodelpersistence:237a4084.4736 -->
    // <!-- req datamodelpersistence:4135089b.32b8 -->
    // <!-- req datamodelpersistence:237a4084.e085 -->
    verifySongFileChecksum(raw, schemaVersion, songId);

    // data-model-persistence.md 8 節：変換するとき（1 つ目の数が今の版より小さいときだけ）は、変換の前に読んだ曲のファイルを
    // 中身を変えずに PreMigration/ へ写す。写せなければ preserve の例外がそのまま上がり、変換せず、曲を開かない
    // <!-- req datamodelpersistence:570e50a6.d113 -->
    // <!-- req datamodelpersistence:570e50a6.30e1 -->
    // <!-- req datamodelpersistence:570e50a6.8e12 -->
    if (this.preMigration !== undefined && this.migrator.needsMigration(schemaVersion)) {
      // <!-- req datamodelpersistence:95c36c45.6e0e -->
      // <!-- req datamodelpersistence:95c36c45.3959 -->
      // <!-- req datamodelpersistence:95c36c45.cf60 -->
      try {
        await this.preMigration.preserve(songId, schemaVersion, bytes);
      } catch (error) {
        // data-model-persistence.md 8 節：写せなかったときは変換せず、曲を開かない。Error の FILE-001 を出す（文言は今のまま、honnin-queue 212 番）
        notificationCenter.report('FILE-001', { songId, reason: 'pre-migration-copy-failed', error: String(error) });
        throw error;
      }
    }

    // data-model-persistence.md 8 節：変換を終えてから、曲をメモリ上に広げる
    // <!-- req datamodelpersistence:cbc88742.2d0e --> <!-- req datamodelpersistence:cbc88742.e083 --> <!-- req datamodelpersistence:28f8323b.eae7 --> <!-- req datamodelpersistence:28f8323b.6dae -->
    // <!-- req datamodelpersistence:237a4084.1306 -->
    const migrated = this.migrator.migrate(raw);
    // data-model-persistence.md 8 節：2 つ目の数が今の版より大きい曲は読むだけで開くので、その id を覚える（honnin-queue 213 番）
    if (this.migrator.isNewerMinorVersion(schemaVersion)) this.newerVersionSongIds.add(songId);
    else this.newerVersionSongIds.delete(songId);
    // ファイル名を id の最終的な真実とする（SongDocument.id は読み取り専用なので、id を替えて作る）。
    // <!-- req datamodelpersistence:ef05ede5.2f16 -->
    // <!-- req datamodelpersistence:237a4084.2c85 -->
    return SongDocument.fromFileJson({ ...migrated, id: songId });
  }

  /**
   * 曲ごとの、前の保存で写しを書いたときの `appMeta.thumbnail.data`。変わったときだけ写しを書き直す（data-model-persistence.md 9.1 節）。
   * アプリを起動してから初めての保存では、前の値が無いので書く。
   */
  private readonly lastThumbnailData = new Map<string, string>();

  /**
   * 曲をアトミックに保存する（data-model-persistence.md 15 節）。
   * 手順：LocalBackupService.rotate → integrity 確定 → tmp へ書き込み → rename → サムネイルの写し → index 更新。
   * 曲のファイルの場所は、id と `index.json` が持つ `songs/` からの相対フォルダで決まる（data-model-persistence.md 5 節）。
   * 索引に無い曲（新しい曲）は `songs/` の直下に置く。
   * 曲の編集による索引の直しは、曲のファイルを書いた後にここで `upsert` を呼ぶ 1 つの経路で行う（data-model-persistence.md 9.1 節）。
   * 1 つの曲を書くのは 1 か所だけという前提（単一ライター）とする。別の PC からの同時の編集は、単一ライターの前提の外として扱い、
   * 見つけも直しもしない（data-model-persistence.md 14.3 節）。
   */
  // <!-- req datamodelpersistence:e7285636.937e -->
  // <!-- req datamodelpersistence:e7285636.7610 -->
  // <!-- req datamodelpersistence:e7285636.4261 -->
  async save(document: SongDocument): Promise<void> {
    const folder = (await this.indexService.find(document.id))?.folder ?? '';
    // 現行スキーマバージョンへ揃える（マイグレーション後の初回保存で上書き、data-model-persistence.md 8 節）。
    await this.adapter.ensureDirectory(songFolderPath(folder));

    // 書き込み直前に旧本体を 1 世代退避する（B25）。失敗しても save は継続（rotate 側で握り潰す）。
    // <!-- req datamodelpersistence:40f6d26f.1225 -->
    await this.localBackup.rotate(document.id);

    // <!-- req datamodelpersistence:cbc88742.7786 -->
    // <!-- req datamodelpersistence:40f6d26f.bbbc -->
    // <!-- req datamodelpersistence:40f6d26f.657d -->
    // <!-- req datamodelpersistence:8145c582.d46a -->
    const fileJson = document.toFileJson();
    // data-model-persistence.md 3 節：保存は自前の版つきの構造化 JSON（SongFileJson）をそのまま書き、保存のたびに alphaTex へ変換しない <!-- req datamodelpersistence:c5f62f5c.17eb --> <!-- req datamodelpersistence:da091b1d.3765 --> <!-- req datamodelpersistence:8145c582.b55f -->
    const bytes = encodeJson(fileJson);

    // <!-- req datamodelpersistence:40f6d26f.6a28 -->
    // <!-- req datamodelpersistence:751e4fcb.1fb6 -->
    // <!-- req datamodelpersistence:751e4fcb.91d5 -->
    const tmp = songTmpFilePath(document.id, folder);
    const final = songFilePath(document.id, folder);
    // <!-- req datamodelpersistence:751e4fcb.4bf1 -->
    // <!-- req datamodelpersistence:feeb91c5.3ff3 -->
    await this.adapter.writeFile(tmp, bytes);
    // <!-- req datamodelpersistence:3f49bc93.40f5 -->
    // <!-- req datamodelpersistence:3f49bc93.2d8b -->
    // <!-- req datamodelpersistence:7a7c18f6.18bd -->
    // <!-- req datamodelpersistence:7a7c18f6.9f8a -->
    // <!-- req datamodelpersistence:feeb91c5.eb85 -->
    await this.adapter.renameFile(tmp, final);

    // data-model-persistence.md 9.1 節：写しは曲のファイル（正）を書き終えた後に、その正の appMeta.thumbnail から作る。
    // appMeta.thumbnail が null なら写しを作らず、thumbnailRef も null にする（summarizeSong）。
    // <!-- req datamodelpersistence:5abec475.aa0a --> <!-- req datamodelpersistence:5abec475.af9c -->
    const thumbnail = fileJson.appMeta.thumbnail;
    // <!-- req datamodelpersistence:5abec475.c1f7 -->
    if (thumbnail === null) {
      this.lastThumbnailData.delete(document.id);
      // <!-- req datamodelpersistence:5abec475.2e40 -->
    } else if (this.lastThumbnailData.get(document.id) !== thumbnail.data) {
      try {
        // <!-- req datamodelpersistence:5abec475.2af3 --> <!-- req datamodelpersistence:b4f17978.af6e -->
        await writeThumbnailCopy(this.adapter, document.id, thumbnail.data);
        this.lastThumbnailData.set(document.id, thumbnail.data);
      } catch (error) {
        // 写しが無くても、曲一覧は曲のファイルの appMeta.thumbnail から作り直せる（SongIndexService.rebuildThumbnailCopy）。
        warnProvisional(`サムネイルの写しの書き込みに失敗（保存は継続）: ${document.id}`, { error: String(error) });
      }
    }

    // <!-- req datamodelpersistence:8af93d68.6753 --> <!-- req datamodelpersistence:8af93d68.542c --> <!-- req datamodelpersistence:8af93d68.dcd0 --> <!-- req datamodelpersistence:8af93d68.800c --> <!-- req datamodelpersistence:8af93d68.5bbf --> <!-- req datamodelpersistence:8af93d68.9223 --> <!-- req datamodelpersistence:8af93d68.8e17 --> <!-- req datamodelpersistence:8af93d68.ab9b --> <!-- req datamodelpersistence:688b1f5f.34ec --> <!-- req datamodelpersistence:688b1f5f.7dca --> <!-- req datamodelpersistence:688b1f5f.44cf --> <!-- req datamodelpersistence:688b1f5f.a767 --> <!-- req datamodelpersistence:688b1f5f.f564 --> <!-- req datamodelpersistence:688b1f5f.0623 --> <!-- req datamodelpersistence:688b1f5f.9d1d --> <!-- req datamodelpersistence:688b1f5f.718a --> <!-- req datamodelpersistence:5abec475.24c5 -->
    // <!-- req datamodelpersistence:7d90aac8.56c7 -->
    await this.indexService.upsert(
      summarizeSong({
        id: document.id,
        createdAt: fileJson.createdAt,
        score: document.score,
        appMeta: fileJson.appMeta,
        savedAtMonotonic: fileJson.integrity.savedAtMonotonic,
        folder,
      }),
    );
  }

  /**
   * 新規曲を作成し、初回保存まで行って SongDocument を返す。
   * 初回保存しておくことで、以降の編集前にクラッシュ・再起動しても曲一覧に現れる。
   */
  async create(initialSetup: NewSongSetup): Promise<SongDocument> {
    const doc = new SongDocument({
      // data-model-persistence.md 5 節：id は版 4 の UUID を crypto.randomUUID() で作る <!-- req datamodelpersistence:fbd2e0bc.17cc -->
      id: crypto.randomUUID(),
      score: createInitialScore(initialSetup),
      appMeta: createEmptyAppMetadata(),
    });
    // <!-- req datamodelpersistence:8af93d68.dd74 -->
    await this.save(doc);
    return doc;
  }

  /**
   * 曲を複製する（data-model-persistence.md 18 節）。
   * 元の曲を読み、新しい id・「<元の曲名> のコピー」の名前（`duplicateSongTitle`）・複製した時刻の作成日時だけを書き換え、
   * `song` の本体と `appMeta` はそのまま引き継いで、元の曲と同じサブフォルダへ一時ファイルからの改名で書く（15 節）。
   * サムネイルの写しは作り直さず、元の曲の `thumbnails/{元id}.png` を `copyFile` で `thumbnails/{新id}.png` へ写す。
   * そのあと `index.json` に新しい `SongSummary` を足す（9.1 節と同じ `upsert`）。
   * ミラーへ知らせるのは呼んだ曲一覧の「複製」の処理（IPC の `mirror:syncAfterSave`、14.1 節）で、ここでは知らせない。
   * @throws SongCountLimitError 曲の数が上限（1000）に達している。何も書かない（呼ぶ側が `SONG-002` を出す）。
   * @throws SongNotFoundError ほか `load` と同じ。元の曲を読めなければ何も書かない。
   */
  async duplicate(songId: string): Promise<SongDocument> {
    const summaries = await this.indexService.load();
    // data-model-persistence.md 18 節：曲の数の上限 1000 の確かめの対象に入れ、上限に達していれば複製を拒む
    if (evaluateSongCount(summaries.length) === 'limit') throw new SongCountLimitError(summaries.length);

    const source = await this.load(songId);
    // data-model-persistence.md 18 節：複製は元の曲と同じサブフォルダに置き、SongSummary.folder も元の曲の値を引き継ぐ
    const folder = summaries.find((summary) => summary.id === songId)?.folder ?? '';
    const sourceJson = source.toFileJson();
    const copy = SongDocument.fromFileJson({
      ...sourceJson,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      appMeta: structuredClone(sourceJson.appMeta),
    });
    // 名前は曲一覧に出る名前（index.json の title と同じ作り方）から作り、index.json の title だけで重なりを調べる
    const originalTitle = summarizeSong({
      id: songId,
      createdAt: sourceJson.createdAt,
      score: source.score,
      appMeta: sourceJson.appMeta,
      savedAtMonotonic: undefined,
      folder,
    }).title;
    copy.score.title = duplicateSongTitle(
      originalTitle,
      summaries.map((summary) => summary.title),
    );

    const fileJson = copy.toFileJson();
    await this.adapter.ensureDirectory(songFolderPath(folder));
    await writeFileAtomically(this.adapter, songFilePath(copy.id, folder), encodeJson(fileJson));

    const thumbnail = fileJson.appMeta.thumbnail;
    if (thumbnail !== null) {
      try {
        await this.adapter.ensureDirectory(THUMBNAILS_DIR);
        await this.adapter.copyFile(thumbnailFilePath(songId), thumbnailFilePath(copy.id));
        this.lastThumbnailData.set(copy.id, thumbnail.data);
      } catch (error) {
        // 写しが無くても、曲一覧は曲のファイルの appMeta.thumbnail から作り直せる（SongIndexService.rebuildThumbnailCopy）。
        warnProvisional(`複製のサムネイルの写しを写せませんでした（複製は継続）: ${copy.id}`, { error: String(error) });
      }
    }

    await this.indexService.upsert(
      summarizeSong({
        id: copy.id,
        createdAt: fileJson.createdAt,
        score: copy.score,
        appMeta: fileJson.appMeta,
        savedAtMonotonic: fileJson.integrity.savedAtMonotonic,
        folder,
      }),
    );
    return copy;
  }
}
