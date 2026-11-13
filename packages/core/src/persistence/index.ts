/**
 * 永続化層（L2 アプリケーションサービス）の公開バレル（data-model-persistence.md 1 節）。
 */
// <!-- req webcorefoundation:a0047314.881c -->

export * from './constants';
export {
  songFilePath,
  songTmpFilePath,
  songFolderPath,
  thumbnailFilePath,
  trashFilePath,
  songIdFromFileName,
  isSongFileInTree,
  PRIMARY_STORAGE_TREE,
  type PrimaryStorageTreeEntry,
} from './paths';

export {
  SongNotFoundError,
  IntegrityCheckFailedError,
  CorruptSongFileError,
  UnsupportedSchemaVersionError,
  SongCountLimitError,
  type CorruptSongFileReason,
} from './errors';

export { ChecksumUtil } from './ChecksumUtil';
export { SchemaMigrator } from './SchemaMigrator';
export {
  PreMigrationService,
  PRE_MIGRATION_DIR,
  PRE_MIGRATION_RETENTION_DAYS,
  preMigrationFileName,
} from './PreMigrationService';
export {
  SongIndexService,
  toSongSummary,
  summarizeSong,
  writeThumbnailCopy,
  type SongFileForSummary,
} from './SongIndexService';
export { SongFolderService, finalizeFolderName, removeInvalidFolderNameChars } from './SongFolderService';
export { LocalBackupService } from './LocalBackupService';
export { SongRepository, duplicateSongTitle } from './SongRepository';
export { AutoSaveScheduler, type AutoSaveHooks } from './AutoSaveScheduler';
export {
  TrashService,
  runStartupCleanup,
  trashRemainingDays,
  trashRemainingMs,
  type StartupCleanupDeps,
  type TrashEntry,
} from './TrashService';
export {
  SongImportService,
  importedSongTitle,
  type ImportConflict,
  type ImportConflictChoice,
  type ImportResult,
} from './SongImportService';
export {
  StorageConfigService,
  NullStorageLocationDetector,
  type StorageType,
  type StorageLocation,
  type StorageSettings,
  type ValidationResult,
  type StorageLocationDetector,
} from './StorageConfigService';
export {
  StorageMigrationService,
  runStorageMigration,
  type MigrationResult,
  type MigrationFailure,
  type MigrationLockTarget,
  type StorageMigrationRunDeps,
} from './StorageMigrationService';
export { MirrorSyncService } from './MirrorSyncService';
