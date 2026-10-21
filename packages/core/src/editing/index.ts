/**
 * タブ譜編集コア（L2、web-core-foundation.md 2.1 節）の公開バレル（editing-core.md）。
 *
 * `EDIT-001`〜`004`・`008`・`009` のエラーコードは、`errors/index.ts` がコア8コードを共有レジストリへ登録
 * するのと同じ方式で、本バレルの読み込み時に `errorCodeRegistry` へ登録する（副作用）。
 */
// <!-- req webcorefoundation:d0c754fa.5d27 --> <!-- req webcorefoundation:d0c754fa.3699 --> <!-- req webcorefoundation:bfc5c94b.8e93 --> <!-- req webcorefoundation:bfc5c94b.cf7b -->

import { errorCodeRegistry } from '../errors';

import { registerEditErrorCodes } from './editErrorCodes';

export type {
  Command,
  CommandOutcome,
  CommandAppliedEvent,
  CursorPosition,
  SelectionRange,
  EditTarget,
  ValidationOutcome,
} from './types';

export { EDIT_ERROR_CODES, registerEditErrorCodes } from './editErrorCodes';
export {
  MIN_FRET,
  MAX_FRET,
  MAX_BAR_COUNT,
  trackCount,
  allTrackIndices,
  barCount,
  stringCount,
  getStaff,
  getBar,
  getVoice,
  getBeat,
  getMasterBar,
  findNoteOnString,
  openStringPitch,
  createRestBeat,
  createStringNote,
  finishScore,
} from './scoreModel';
export { BASE_COMMAND_BYTES, estimateSnapshotBytes } from './commandBase';
export { CursorController } from './CursorController';
export { CompositeCommand } from './CompositeCommand';
export {
  CommandHistory,
  DEFAULT_MEMORY_BUDGET_BYTES,
  MIN_RETAINED_ENTRIES,
  type CommandHistoryOptions,
  type RenderRequester,
  type NotificationReporter,
} from './CommandHistory';
export { ClipboardService, type ClipboardBeat, type ClipboardSnapshot } from './ClipboardService';
export { ValidationService } from './ValidationService';
export { ChordDetectionService, detectFromPitchClasses, type ChordDetectionResult } from './ChordDetectionService';
export {
  EditingService,
  TECHNIQUE_MIN_FRET_DELTA,
  TECHNIQUE_MAX_FRET_DELTA,
  type EditNotificationReporter,
  type TechniqueSuggestion,
} from './EditingService';

// --- 具象コマンド（editing-core.md §6.4） ---
export { PlaceNoteCommand } from './commands/PlaceNoteCommand';
export { InsertRestCommand } from './commands/InsertRestCommand';
export {
  SetTieCommand,
  SetSlurCommand,
  SetTechniqueCommand,
  SetChordNameCommand,
  type NoteTechniquePatch,
} from './commands/noteAttributeCommands';
export { SetTempoCommand, MIN_TEMPO_BPM, MAX_TEMPO_BPM, isValidTempoBpm } from './commands/SetTempoCommand';
export { AddMemoCommand, EditMemoCommand, DeleteMemoCommand, barRef, memosForBar } from './commands/memoCommands';
export {
  AddSectionMarkerCommand,
  EditSectionMarkerCommand,
  DeleteSectionMarkerCommand,
} from './commands/sectionMarkerCommands';
export { InsertBarCommand, DeleteBarCommand, type BarDeleteDisposition } from './commands/barCommands';
export { PasteCommand, type PasteReporter } from './commands/PasteCommand';

// 副作用：編集コアのエラーコードを共有レジストリへ登録する。
registerEditErrorCodes(errorCodeRegistry);
// <!-- req webcorefoundation:fa45ae68.c7b1 --> <!-- req webcorefoundation:fa45ae68.ca70 --> <!-- req webcorefoundation:fa45ae68.9822 --> <!-- req webcorefoundation:af186b62.fce6 --> <!-- req webcorefoundation:af186b62.a387 --> <!-- req webcorefoundation:af186b62.52de --> <!-- req webcorefoundation:af186b62.7f17 -->
