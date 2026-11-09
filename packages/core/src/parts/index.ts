/**
 * パート・チューニング管理（L2、web-core-foundation.md 2.1 節）の公開バレル（part-tuning-management.md）。
 *
 * `EDIT-005`〜`007` のエラーコードは、`errors/index.ts` / `editing/index.ts` と同じ方式で
 * 本バレルの読み込み時に共有 `errorCodeRegistry` へ登録する（副作用）。
 */
// <!-- req webcorefoundation:a0047314.ecd2 --> <!-- req webcorefoundation:a0047314.2de1 -->

import { errorCodeRegistry } from '../errors';

import { registerPartErrorCodes } from './partErrorCodes';

export { PART_ERROR_CODES, registerPartErrorCodes } from './partErrorCodes';
export { PartColorAllocator, PART_COLOR_PALETTE } from './PartColorAllocator';
// パートの数の上限の正は editing の `ValidationService`（editing-core.md 5 節）。パートの使い手向けにここからも出す。
export { MAX_PART_COUNT } from '../editing/ValidationService';
// 注：`getStaff` / `trackCount` は editing パッケージが真実源のため `parts` バレルからは再エクスポートしない。
export {
  buildPartTrack,
  hexToColor,
  colorToHex,
  getTrack,
  getTuning,
  getStringCount,
  getCapo,
  getMixer,
  getColorHex,
  type MixerValues,
} from './partModel';
export {
  SetPartVolumeCommand,
  SetPartPanCommand,
  SetPartSoloCommand,
  SetPartMuteCommand,
  SetPartColorCommand,
  SetCapoFretCommand,
} from './commands/partAttributeCommands';
export {
  AddPartCommand,
  RemovePartCommand,
  ReorderPartsCommand,
  type NewPartSpec,
} from './commands/structuralPartCommands';
export {
  ApplyTuningPresetCommand,
  SetCustomTuningCommand,
  type TuningPresetInput,
  type TuningReporter,
} from './commands/tuningCommands';
export {
  PartManagementService,
  MIN_CAPO_FRET,
  MAX_CAPO_FRET,
  type PartSummary,
  type AddPartRequest,
  type InstrumentType,
  type PartNotificationReporter,
} from './PartManagementService';
export { TuningPresetStore } from './TuningPresetStore';
export {
  TuningPresetService,
  BUILTIN_TUNING_PRESETS,
  PRESET_TRASH_RETENTION_DAYS,
  PRESET_TRASH_MAX_ENTRIES,
} from './TuningPresetService';

// 副作用：パート・チューニング管理のエラーコードを共有レジストリへ登録する。
registerPartErrorCodes(errorCodeRegistry);
