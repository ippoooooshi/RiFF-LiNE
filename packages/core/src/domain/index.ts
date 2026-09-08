/**
 * ドメイン層（L3）の公開バレル（data-model-persistence.md §3.1）。
 * SongDocument / AppMetadata 等の型とロジック。永続化サービスは persistence/ 側。
 */

export * from './types';
export { SongDocument, CURRENT_SCHEMA_VERSION, createEmptyAppMetadata } from './SongDocument';
export { computeChecksum, canonicalJsonStringify } from './checksum';
export { computeRealMidiPitch } from './pitch';
export { sha256Hex } from './sha256';
export { createInitialScore, STANDARD_GUITAR_TUNING, STANDARD_BASS_TUNING } from './newSong';
export {
  MEMO_MAX_LENGTH,
  TAG_COUNT_LIMIT,
  SONG_COUNT_LIMIT,
  SONG_COUNT_WARN_THRESHOLD,
  clampMemoText,
  evaluateSongCount,
  canCreateTag,
  type SongCountStatus,
} from './validation';
