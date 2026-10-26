/**
 * 永続化層（L2 アプリケーションサービス）の公開バレル（data-model-persistence.md §3.2）。
 */
// <!-- req webcorefoundation:a0047314.881c -->
// <!-- req webcorefoundation:50be3620.9782 --> <!-- req webcorefoundation:50be3620.1095 --> <!-- req webcorefoundation:50be3620.bdb4 --> <!-- req webcorefoundation:50be3620.3fcd --> <!-- req webcorefoundation:50be3620.ba84 --> <!-- req webcorefoundation:50be3620.5739 --> <!-- req webcorefoundation:50be3620.8806 --> <!-- req webcorefoundation:50be3620.1a92 --> <!-- req webcorefoundation:50be3620.abd7 --> <!-- req webcorefoundation:50be3620.ebff --> <!-- req webcorefoundation:50be3620.76ec --> <!-- req webcorefoundation:50be3620.4515 -->

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
export { SongRepository } from './SongRepository';
export { AutoSaveScheduler, type AutoSaveHooks } from './AutoSaveScheduler';
export { TrashService, type TrashEntry } from './TrashService';
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
