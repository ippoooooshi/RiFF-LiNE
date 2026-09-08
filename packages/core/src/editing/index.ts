/**
 * タブ譜編集コア（L2/L3）の公開バレル（editing-core.md）。
 *
 * `EDIT-001`〜`004`・`008` のエラーコードは、`errors/index.ts` がコア8コードを共有レジストリへ登録するのと
 * 同じ方式で、本バレルの読み込み時に `errorCodeRegistry` へ登録する（副作用）。
 */

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

// 副作用：編集コアのエラーコードを共有レジストリへ登録する。
registerEditErrorCodes(errorCodeRegistry);
