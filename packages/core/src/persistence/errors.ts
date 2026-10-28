/**
 * 永続化レイヤーのドメインエラー（data-model-persistence.md 8 節・15 節）。
 *
 * これらは Webコア内部の型。UI 層への通知コード（FILE-002 / FILE-004 等、00_reference.md 5 節）への
 * マッピングは、エラー・ログ基盤パッケージ完成後に NotificationCenter 側で行う。
 * それまでは呼び出し元がこれらを捕捉して暫定ハンドリングする（作り直す前の data-model-persistence.md 11 節の申し送り。置き換えは error-logging-foundation.md 9.2 節）。
 */

/** 指定 id の曲ファイルが存在しない（SongRepository.load）。 */
export class SongNotFoundError extends Error {
  readonly code = 'SONG_NOT_FOUND' as const;
  readonly songId: string;

  constructor(songId: string, options?: ErrorOptions) {
    super(`Song not found: ${songId}`, options);
    this.name = 'SongNotFoundError';
    this.songId = songId;
    Object.setPrototypeOf(this, SongNotFoundError.prototype);
  }
}

/**
 * 保存されている integrity.checksum と再計算値が一致しない（破損の疑い）。
 * 呼び出し元は Critical（FILE-002）として扱い、LocalBackupService からの復元を提案する。
 */
export class IntegrityCheckFailedError extends Error {
  readonly code = 'INTEGRITY_CHECK_FAILED' as const;
  readonly songId: string;

  constructor(songId: string, options?: ErrorOptions) {
    super(`Integrity check failed for song: ${songId}`, options);
    this.name = 'IntegrityCheckFailedError';
    this.songId = songId;
    Object.setPrototypeOf(this, IntegrityCheckFailedError.prototype);
  }
}

/**
 * 壊れた曲のファイルの理由（data-model-persistence.md 8 節の (1)〜(3)）。
 * - `invalid-json`：JSON として読めない（`SongRepository.load` が受け持つ）
 * - `not-object`：いちばん上がオブジェクトでない（`SchemaMigrator.migrate` が受け持つ）
 * - `invalid-schema-version`：`schemaVersion` が空でない文字列でない（`SchemaMigrator.migrate` が受け持つ）
 */
export type CorruptSongFileReason = 'invalid-json' | 'not-object' | 'invalid-schema-version';

/**
 * 曲のファイルの形が壊れていて、版を調べる前に読めない（data-model-persistence.md 8 節）。
 * 投げる側が Critical の `FILE-008` を出す。新しい版のファイル（`UnsupportedSchemaVersionError`、`FILE-004`）とは分ける。
 */
export class CorruptSongFileError extends Error {
  readonly code = 'CORRUPT_SONG_FILE' as const;
  readonly reason: CorruptSongFileReason;

  constructor(reason: CorruptSongFileReason, options?: ErrorOptions) {
    super(`Corrupt song file: ${reason}`, options);
    this.name = 'CorruptSongFileError';
    this.reason = reason;
    Object.setPrototypeOf(this, CorruptSongFileError.prototype);
  }
}

/**
 * 曲の数が上限（`SONG_COUNT_LIMIT`、1000）に達していて、曲を増やせない（data-model-persistence.md 18 節の複製）。
 * 投げる側は何も出さない。受けた呼び出し元（曲一覧の「複製」の処理）が Error の `SONG-002` を出す
 * （`SONG-002` は画面群の `ui/uiErrorCodes.ts` が登録するコードで、新しい曲を作るときの `songActions` と同じく呼ぶ側が出す）。
 */
export class SongCountLimitError extends Error {
  readonly code = 'SONG_COUNT_LIMIT' as const;
  /** 確かめたときの曲の数。`SONG-002` の文脈（`count`）に渡す。 */
  readonly count: number;

  constructor(count: number, options?: ErrorOptions) {
    super(`Song count limit reached: ${count}`, options);
    this.name = 'SongCountLimitError';
    this.count = count;
    Object.setPrototypeOf(this, SongCountLimitError.prototype);
  }
}

/**
 * `schemaVersion` に対応するマイグレーション経路が見つからない
 * （未知の将来バージョンを開こうとした等）。呼び出し元は Critical（FILE-004）として扱う。
 */
export class UnsupportedSchemaVersionError extends Error {
  readonly code = 'UNSUPPORTED_SCHEMA_VERSION' as const;
  readonly fromVersion: string;
  readonly toVersion: string;

  constructor(fromVersion: string, toVersion: string, options?: ErrorOptions) {
    super(`No migration path from schemaVersion ${fromVersion} to ${toVersion}`, options);
    this.name = 'UnsupportedSchemaVersionError';
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
    Object.setPrototypeOf(this, UnsupportedSchemaVersionError.prototype);
  }
}
