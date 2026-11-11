/**
 * タブ譜編集コア（L2、web-core-foundation.md 2.1 節）の公開バレル（editing-core.md）。
 *
 * `EDIT-001`〜`004`・`008`・`009` のエラーコードは、`errors/index.ts` がコア8コードを共有レジストリへ登録
 * するのと同じ方式で、本バレルの読み込み時に `errorCodeRegistry` へ登録する（副作用）。
 */
// <!-- req webcorefoundation:d0c754fa.5d27 --> <!-- req webcorefoundation:d0c754fa.3699 --> <!-- req webcorefoundation:8e289f5f.1891 --> <!-- req webcorefoundation:8e289f5f.df00 --> <!-- req webcorefoundation:8e289f5f.e832 -->

import { errorCodeRegistry } from '../errors';

import { registerEditErrorCodes } from './editErrorCodes';

export type { Command, CommandLabelId } from './commands/Command';
export type {
  CommandOutcome,
  CommandAppliedEvent,
  CursorPosition,
  SelectionRange,
  EditTarget,
  ValidationOutcome,
} from './types';
/** 任意の連符の組を作る（editing-core.md 4.3 節の宣言。画面の音価のパレットが「任意」の欄の数から BeatDurationSpec を作るときに使う）。 */
export { tupletSpecFor } from './types'; // <!-- req editingcore:c950de37.b36f -->

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
} from './commands/CommandHistory';
export { ClipboardService, type ClipboardBeat, type ClipboardNote, type ClipboardSnapshot } from './ClipboardService';
export { ValidationService } from './ValidationService';
export { ChordDetectionService, detectFromPitchClasses, type ChordDetectionResult } from './ChordDetectionService';
export {
  EditingService,
  TECHNIQUE_MIN_FRET_DELTA,
  TECHNIQUE_MAX_FRET_DELTA,
  type TechniqueSuggestion,
  type BarDeleteDisposition,
  type BarDeleteConfirmer,
} from './EditingService';

// --- 具象コマンド（editing-core.md 2.6 節） ---
// <!-- req editingcore:4d4a8a66.6160 -->
export { PlaceNoteCommand } from './commands/PlaceNoteCommand';
export { InsertRestCommand } from './commands/InsertRestCommand';
export {
  SetTieCommand,
  SetSlurCommand,
  SetTechniqueCommand,
  SetChordNameCommand,
  bendTechniquePatch,
  clearBendPatch,
  vibratoPatch,
  clearArticulationPatch,
  BEND_WIDTH_MAX,
  type NoteTechniquePatch,
  type BendShape,
} from './commands/noteAttributeCommands';
export { SetTempoCommand, MIN_TEMPO_BPM, MAX_TEMPO_BPM, isValidTempoBpm } from './commands/SetTempoCommand';
export { AddMemoCommand, EditMemoCommand, DeleteMemoCommand, barRef, memosForBar } from './commands/memoCommands';
export {
  AddSectionMarkerCommand,
  EditSectionMarkerCommand,
  DeleteSectionMarkerCommand,
} from './commands/sectionMarkerCommands';
export { InsertBarCommand, DeleteBarCommand } from './commands/barCommands';
export { PasteCommand } from './commands/PasteCommand';
export { DeleteSelectionCommand } from './commands/DeleteSelectionCommand';
export { DuplicateSelectionCommand } from './commands/DuplicateSelectionCommand';
export { SetTimeSignatureCommand, type TimeSignatureSpec } from './commands/SetTimeSignatureCommand';
export { SetRepeatCommand, type RepeatPatch } from './commands/SetRepeatCommand';

// 副作用：編集コアのエラーコードを共有レジストリへ登録する。
// <!-- req 00:db2fd366.941a -->
registerEditErrorCodes(errorCodeRegistry);
// <!-- req webcorefoundation:fa45ae68.c7b1 --> <!-- req webcorefoundation:fa45ae68.ca70 --> <!-- req webcorefoundation:fa45ae68.9822 --> <!-- req webcorefoundation:af186b62.fce6 --> <!-- req webcorefoundation:af186b62.a387 --> <!-- req webcorefoundation:af186b62.52de --> <!-- req webcorefoundation:af186b62.7f17 -->
// 13.2 節：移調のための構造を作らない。足すときは選んだ範囲の音符のフレットを書き換えるコマンドを 1 つコマンド層に足すだけで、データモデルを変えない。通知を足すときも既存のコマンド層とデータモデルには手を入れない <!-- req webcorefoundation:ff8ce923.43c2 --> <!-- req webcorefoundation:ff8ce923.681c --> <!-- req webcorefoundation:ff8ce923.aa8a -->
