/**
 * 指定 Beat へ 1 つの Note を追加する（editing-core.md §6.4、04_editing_core.md §2・§3）。
 *
 * 前提：重複配置・フレット範囲は `ValidationService` が検証済み（§7）。本コマンドは Score グラフの変更のみ。
 * 3 通りの対象状態を扱い、いずれも execute/undo が対称：
 *   1. 対象 Beat が存在し休符   → その Beat を「音価変更＋Note 追加」で音符 Beat に変える
 *   2. 対象 Beat が存在し非休符 → 和音入力。Note を追加するだけ（音価は変えない）
 *   3. 対象 Beat がまだ無い（beatIndex === beats.length）→ 新規 Beat を作って追加する
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { createStringNote, getVoice, getBar } from '../scoreModel';
import type { Command, CommandOutcome, CursorPosition, EditTarget } from '../types';

type Mode = 'convert-rest' | 'chord-add' | 'new-beat';

export class PlaceNoteCommand implements Command {
  readonly kind = 'place-note';
  readonly label = '音符を配置';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly position: CursorPosition;
  private readonly stringNumber: number;
  private readonly fret: number;
  private readonly duration: model.Duration;

  // execute で確定する undo 用の状態
  private note: model.Note | null = null;
  private targetBeat: model.Beat | null = null;
  private mode: Mode | null = null;
  private previousDuration: model.Duration | null = null;

  constructor(
    target: EditTarget,
    position: CursorPosition,
    stringNumber: number,
    fret: number,
    duration: model.Duration,
  ) {
    this.score = target.score;
    this.position = position;
    this.stringNumber = stringNumber;
    this.fret = fret;
    this.duration = duration;
    this.affectedTrackIndices = [position.trackIndex];
  }

  execute(): CommandOutcome {
    const voice = getVoice(getBar(this.score, this.position.trackIndex, this.position.barIndex));
    const note = createStringNote(this.stringNumber, this.fret);
    this.note = note;

    const existing = voice.beats[this.position.beatIndex];
    if (existing === undefined) {
      // ケース 3：新規 Beat
      this.mode = 'new-beat';
      const beat = new model.Beat();
      beat.duration = this.duration;
      beat.addNote(note);
      voice.addBeat(beat);
      this.targetBeat = beat;
    } else if (existing.notes.length === 0) {
      // ケース 1：休符 Beat を音符 Beat へ
      this.mode = 'convert-rest';
      this.previousDuration = existing.duration;
      existing.duration = this.duration;
      existing.addNote(note);
      this.targetBeat = existing;
    } else {
      // ケース 2：和音入力（既存 Beat への追加）
      this.mode = 'chord-add';
      existing.addNote(note);
      this.targetBeat = existing;
    }

    return { cursorAdvance: 'beat' };
  }

  undo(): CommandOutcome {
    const voice = getVoice(getBar(this.score, this.position.trackIndex, this.position.barIndex));
    const beat = this.targetBeat!;

    if (this.mode === 'new-beat') {
      const index = voice.beats.indexOf(beat);
      if (index >= 0) voice.beats.splice(index, 1);
    } else {
      const noteIndex = beat.notes.indexOf(this.note!);
      if (noteIndex >= 0) beat.notes.splice(noteIndex, 1);
      if (this.mode === 'convert-rest' && this.previousDuration !== null) {
        beat.duration = this.previousDuration;
      }
    }

    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
