/**
 * 永続化層（L2 アプリケーションサービス）の公開バレル（data-model-persistence.md §3.2）。
 */
// <!-- req webcorefoundation:a0047314.881c -->
// <!-- req webcorefoundation:50be3620.9782 --> <!-- req webcorefoundation:50be3620.1095 --> <!-- req webcorefoundation:50be3620.bdb4 --> <!-- req webcorefoundation:50be3620.3fcd --> <!-- req webcorefoundation:50be3620.ba84 --> <!-- req webcorefoundation:50be3620.5739 --> <!-- req webcorefoundation:50be3620.8806 --> <!-- req webcorefoundation:50be3620.1a92 --> <!-- req webcorefoundation:50be3620.abd7 --> <!-- req webcorefoundation:50be3620.ebff --> <!-- req webcorefoundation:50be3620.76ec --> <!-- req webcorefoundation:50be3620.4515 -->

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
