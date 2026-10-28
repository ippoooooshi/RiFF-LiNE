/**
 * main（apps/desktop/src/main）がミラーの写しのために読む、ミラーと設定の部品だけの細い入口（data-model-persistence.md 14.1 節）。
 *
 * persistence の入口（index.ts）は曲の読み書きの部品ごと alphaTab を引き込むので、main はこちらを読む（2026-10-28 チャット側の決定）。
 * ここから読むファイルは alphaTab を import しない。確かめは apps/desktop/src/dev/layerRules.test.ts（UT-DEV-LAYER-35）。
 */

export { MirrorSyncService } from './MirrorSyncService';
export {
  StorageConfigService,
  NullStorageLocationDetector,
  type StorageType,
  type StorageLocation,
  type StorageSettings,
  type ValidationResult,
  type StorageLocationDetector,
} from './StorageConfigService';
