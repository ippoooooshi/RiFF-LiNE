/**
 * 永続化レイヤーのドメインエラー（data-model-persistence.md §3.2）。
 *
 * これらは Webコア内部の型。UI 層への通知コード（FILE-002 / FILE-004 等、00_reference.md §5）への
 * マッピングは、エラー・ログ基盤パッケージ完成後に NotificationCenter 側で行う。
 * それまでは呼び出し元がこれらを捕捉して暫定ハンドリングする（§11 申し送り）。
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
