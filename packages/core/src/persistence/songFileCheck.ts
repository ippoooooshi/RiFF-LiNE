/**
 * 曲のファイルとして読めるかの確かめ（data-model-persistence.md 8 節・15 節）。
 *
 * 曲を開くとき（`SongRepository.load`）、退かした版を戻すとき（`LocalBackupService.restore`、20 節）、
 * 外の `.tabapp` を取り込むとき（`SongImportService`、19 節）の 3 か所が、同じ順で同じ知らせを出すように 1 か所に置く。
 */

import { createEmptyAppMetadata } from '../domain/SongDocument';
import { notificationCenter } from '../errors';

import { ChecksumUtil } from './ChecksumUtil';
import { CorruptSongFileError, IntegrityCheckFailedError } from './errors';
import { decodeText } from './jsonIo';

/**
 * 曲のファイルのバイトを JSON として読む（data-model-persistence.md 8 節の (1)）。
 * 読めなければ Critical の `FILE-008`（`reason: 'invalid-json'`）を出し、`CorruptSongFileError` を投げる。FILE-004 は出さない。
 * @throws CorruptSongFileError JSON として読めない。
 */
export function parseSongFileJson(bytes: Uint8Array, songId: string): unknown {
  try {
    return JSON.parse(decodeText(bytes)) as unknown;
  } catch (error) {
    // <!-- req datamodelpersistence:8db5ad15.e3c4 -->
    notificationCenter.report('FILE-008', { songId, reason: 'invalid-json' });
    throw new CorruptSongFileError('invalid-json', { cause: error });
  }
}

/**
 * 変換する前の生の中身で `integrity.checksum` を確かめる（data-model-persistence.md 15 節・8 節・7 節）。
 * 合わなければ Critical の `FILE-002` を出し、`IntegrityCheckFailedError` を投げる。
 * `integrity` か `integrity.checksum` が無いか空の文字列の曲も壊れたファイルとし、合わないときと同じく `FILE-002` を出して投げる
 * （15 節、2026-10-28 本人決定、honnin-queue 215 番）。空でなく `sha256:` で始まらない値は、作り直した値と合わないので同じく `FILE-002`。
 * 呼び出し元は `LocalBackupService.restore(songId)` で控えから戻すかを聞く（20.1 節）。
 * @param raw 形を確かめた後の曲のファイルの JSON。
 * @param schemaVersion `SchemaMigrator.checkShape` が返した版。
 * @throws IntegrityCheckFailedError チェックサムが合わない、または `integrity.checksum` が無いか空の文字列。
 */
export function verifySongFileChecksum(
  raw: { song?: unknown; appMeta?: unknown; integrity?: { checksum?: unknown } },
  schemaVersion: string,
  songId: string,
): void {
  const stored = raw.integrity?.checksum;
  // <!-- req datamodelpersistence:ee447c8b.44eb -->
  const missing = typeof stored !== 'string' || stored.length === 0;
  if (
    missing ||
    ChecksumUtil.compute(schemaVersion, raw.song, (raw.appMeta ?? createEmptyAppMetadata()) as never) !== stored
  ) {
    // error-logging-foundation.md 9.2 節：Critical の FILE-002。「復元しますか？」の手段は LocalBackupService.restore(songId)（B25）。
    // <!-- req datamodelpersistence:8db5ad15.4c05 -->
    // <!-- req datamodelpersistence:ee447c8b.a0ee -->
    notificationCenter.report('FILE-002', { songId });
    throw new IntegrityCheckFailedError(songId);
  }
}
