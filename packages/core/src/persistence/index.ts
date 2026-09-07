/**
 * 永続化層（L2 アプリケーションサービス）の公開バレル（data-model-persistence.md §3.2）。
 */

export * from './constants';
export { songFilePath, songTmpFilePath, trashFilePath, songIdFromFileName } from './paths';

export { SongNotFoundError, IntegrityCheckFailedError, UnsupportedSchemaVersionError } from './errors';

export { ChecksumUtil } from './ChecksumUtil';
export { SchemaMigrator } from './SchemaMigrator';
export { SongIndexService, toSongSummary } from './SongIndexService';
export { LocalBackupService } from './LocalBackupService';
export { SongRepository } from './SongRepository';
export { AutoSaveScheduler, type AutoSaveHooks } from './AutoSaveScheduler';
export { TrashService, type TrashEntry } from './TrashService';
export {
  StorageConfigService,
  NullStorageLocationDetector,
  type StorageConfig,
  type MirrorLocation,
  type ValidationResult,
  type StorageLocationDetector,
} from './StorageConfigService';
export { StorageMigrationService, type MigrationResult, type MigrationFailure } from './StorageMigrationService';
export { MirrorSyncService } from './MirrorSyncService';
