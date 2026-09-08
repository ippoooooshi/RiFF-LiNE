/**
 * チューニングの適用（part-tuning-management.md §3.2・§5、editing-core.md §6 基盤に準拠）。
 *
 * - `ApplyTuningPresetCommand`：プリセットの `stringPitches` と弦数をアトミックに適用（B15）。
 *   弦数減少時は消える弦上の Note を破棄し `EDIT-006`（Warning）を発行（B3 と同じ非対称ルール）。
 * - `SetCustomTuningCommand`：弦数を変えずに `stringPitches` だけを手動編集値へ更新。
 *
 * B33 と同じく `Score.finish()` は呼ばない（音高は描画時に tuning から再計算される）。
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../../editing/commandBase';
import type { Command, CommandOutcome } from '../../editing/types';
import { getStaff } from '../partModel';

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

/** `NotificationCenter.report` の最小要求。 */
export interface TuningReporter {
  report(code: string, context?: Record<string, unknown>): void;
}

export interface TuningPresetInput {
  /** 適用したプリセットの識別（provenance。alphaTab `Tuning.name` に格納する）。 */
  name?: string;
  /** 開放弦チューニング（高音弦→低音弦、MIDI ピッチ）。長さ = 適用後の弦数。 */
  stringPitches: number[];
}

export class ApplyTuningPresetCommand implements Command {
  readonly kind = 'apply-tuning-preset';
  readonly label = 'チューニングプリセット適用';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly trackIndex: number;
  private readonly preset: TuningPresetInput;
  private readonly reporter: TuningReporter;

  private undoState: {
    tunings: number[];
    tuningName: string;
    /** 破棄した Note とその復元先（beat と、beat.notes 内での元インデックス）。 */
    droppedNotes: { beat: model.Beat; note: model.Note; index: number }[];
  } | null = null;
  private reportedDrop = false;

  constructor(score: model.Score, trackIndex: number, preset: TuningPresetInput, reporter: TuningReporter) {
    this.score = score;
    this.trackIndex = trackIndex;
    this.preset = preset;
    this.reporter = reporter;
    this.affectedTrackIndices = [trackIndex];
  }

  execute(): CommandOutcome {
    const staff = getStaff(this.score, this.trackIndex);
    const oldTunings = [...staff.stringTuning.tunings];
    const oldName = staff.stringTuning.name;
    const newCount = this.preset.stringPitches.length;

    const droppedNotes: { beat: model.Beat; note: model.Note; index: number }[] = [];
    if (newCount < oldTunings.length) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (let i = beat.notes.length - 1; i >= 0; i--) {
              const note = beat.notes[i]!;
              if (note.string > newCount) {
                droppedNotes.push({ beat, note, index: i });
                beat.notes.splice(i, 1);
              }
            }
          }
        }
      }
    }

    staff.stringTuning.tunings = [...this.preset.stringPitches];
    if (this.preset.name !== undefined) staff.stringTuning.name = this.preset.name;

    this.undoState = { tunings: oldTunings, tuningName: oldName, droppedNotes };

    if (droppedNotes.length > 0 && !this.reportedDrop) {
      this.reportedDrop = true;
      this.reporter.report('EDIT-006', { droppedCount: droppedNotes.length, newStringCount: newCount });
    }
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.undoState === null) return NO_ADVANCE;
    const staff = getStaff(this.score, this.trackIndex);
    staff.stringTuning.tunings = [...this.undoState.tunings];
    staff.stringTuning.name = this.undoState.tuningName;
    // 破棄した Note を元の位置へ戻す（index 昇順で挿入して後続の index ずれを防ぐ）。
    for (const { beat, note, index } of [...this.undoState.droppedNotes].sort((a, b) => a.index - b.index)) {
      beat.notes.splice(Math.min(index, beat.notes.length), 0, note);
    }
    this.undoState = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES + (this.undoState?.droppedNotes.length ?? 0) * 64;
  }
}

export class SetCustomTuningCommand implements Command {
  readonly kind = 'set-custom-tuning';
  readonly label = 'チューニングを編集';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly trackIndex: number;
  private readonly stringPitches: number[];
  private previous: { tunings: number[]; name: string } | null = null;

  /** @param stringPitches 弦数は変えない（現在の弦数と同じ長さである前提）。 */
  constructor(score: model.Score, trackIndex: number, stringPitches: number[]) {
    this.score = score;
    this.trackIndex = trackIndex;
    this.stringPitches = stringPitches;
    this.affectedTrackIndices = [trackIndex];
  }

  execute(): CommandOutcome {
    const staff = getStaff(this.score, this.trackIndex);
    this.previous = { tunings: [...staff.stringTuning.tunings], name: staff.stringTuning.name };
    staff.stringTuning.tunings = [...this.stringPitches];
    // 手動編集はプリセット由来ではないため名前を外す。
    staff.stringTuning.name = '';
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.previous !== null) {
      const staff = getStaff(this.score, this.trackIndex);
      staff.stringTuning.tunings = [...this.previous.tunings];
      staff.stringTuning.name = this.previous.name;
    }
    this.previous = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
