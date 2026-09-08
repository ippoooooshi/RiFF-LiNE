/**
 * クリップボード内容を貼り付け先パートへ複製する（editing-core.md §6.4・§10.4、04_editing_core.md §9）。
 *
 * B3 の非対称ルール：
 *  - 貼り付け先の弦数が不足 → 超過弦の Note を破棄し `EDIT-009`（Warning）を発行する
 *  - 貼り付け先の弦数が多い → 余った弦を使わないだけ。警告なし
 */

import { model } from '@coderline/alphatab';

import type { ClipboardSnapshot } from '../ClipboardService';
import { BASE_COMMAND_BYTES } from '../commandBase';
import { getVoice, getBar, insertBeatAt, stringCount } from '../scoreModel';
import type { Command, CommandOutcome, CursorPosition, EditTarget } from '../types';

/** `NotificationCenter.report` の最小要求。 */
export interface PasteReporter {
  report(code: string, context?: Record<string, unknown>): void;
}

export class PasteCommand implements Command {
  readonly kind = 'paste';
  readonly label = '貼り付け';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly position: CursorPosition;
  private readonly snapshot: ClipboardSnapshot;
  private readonly reporter: PasteReporter;
  private insertedBeats: model.Beat[] = [];

  constructor(target: EditTarget, position: CursorPosition, snapshot: ClipboardSnapshot, reporter: PasteReporter) {
    this.score = target.score;
    this.position = position;
    this.snapshot = snapshot;
    this.reporter = reporter;
    this.affectedTrackIndices = [position.trackIndex];
  }

  execute(): CommandOutcome {
    const voice = getVoice(getBar(this.score, this.position.trackIndex, this.position.barIndex));
    const strings = stringCount(this.score, this.position.trackIndex);

    let droppedCount = 0;
    this.insertedBeats = this.snapshot.beats.map((src) => {
      const beat = new model.Beat();
      beat.duration = src.duration;
      for (const n of src.notes) {
        if (n.string < 1 || n.string > strings) {
          droppedCount += 1;
          continue;
        }
        const note = new model.Note();
        note.string = n.string;
        note.fret = n.fret;
        beat.addNote(note);
      }
      return beat;
    });

    const at = Math.min(this.position.beatIndex, voice.beats.length);
    this.insertedBeats.forEach((beat, offset) => insertBeatAt(voice, at + offset, beat));

    if (droppedCount > 0) {
      this.reporter.report('EDIT-009', { droppedCount, targetStringCount: strings });
    }

    return { cursorAdvance: 'none' };
  }

  undo(): CommandOutcome {
    const voice = getVoice(getBar(this.score, this.position.trackIndex, this.position.barIndex));
    for (const beat of this.insertedBeats) {
      const index = voice.beats.indexOf(beat);
      if (index >= 0) voice.beats.splice(index, 1);
    }
    this.insertedBeats = [];
    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES + this.snapshot.beats.length * 64;
  }
}
