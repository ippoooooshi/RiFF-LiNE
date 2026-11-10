/**
 * 音符を消し、休符の拍を取り除いて詰めるコマンド（editing-core.md 2.6 節・4.4 節・4.5 節）。
 *
 * - notes の音符を拍から外す。和音の中の 1 つの音なら、その音符だけを外す
 * - 外した拍に音が残らなければ、拍を取り除かず、拍の長さを変えずに休符の拍（音符を持たない拍）として残す（後ろの拍の位置は変わらない）
 * - 拍を取り除くのは、restBeats に渡した休符の拍だけとし、後ろの拍を前へ詰める。音のある拍を渡されたときは取り除かない
 * - 取り除いて 1 つ目のボイスの拍が 1 つも無くなった小節は、全音符の休符の拍を 1 つ置く（3.3 節「小節の中で音を置かない位置は、
 *   自動で休符の Beat にする」・4.4 節の (b) の小節全体の休符の形）
 * - 取り除いて 2 つ目のボイスの拍が 0 個になった小節は、その小節の `Bar.voices` から 2 つ目の Voice を外す（4.1 節の (b)）
 * - undo は、外した音符を元の拍の元の順に、取り除いた拍と外した Voice を元の位置へ戻す
 * notes と restBeats は同じパートの中（Delete キー・右クリック・消しゴム・編集メニューの「削除」が同じ本コマンドを出す）。
 */

import type { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import {
  fillEmptyVoiceWithBarRest,
  findNoteOnString,
  getBar,
  insertBeatAt,
  removeBeat,
  removeVoiceIfNoBeats,
  replaceNotes,
  restoreRemovedVoice,
  voiceBeats,
  type RemovedVoice,
} from '../scoreModel';
import type { CommandOutcome, CursorPosition, EditTarget, NoteRef } from '../types';
import type { Command } from './Command';

/** execute で取り除いた拍（取り消しで同じ位置へ戻す）。 */
interface RemovedBeat {
  voice: model.Voice;
  beat: model.Beat;
  index: number;
}

// <!-- req editingcore:1bfb74d1.4dad -->
export class DeleteNotesCommand implements Command {
  readonly kind = 'delete-notes';
  readonly label = 'delete-notes';
  /** 変更が及ぶパート（notes と restBeats のパート。同じパートの中なので 1 つ。editing-core.md 2.6 節）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly notes: readonly NoteRef[];
  private readonly restBeats: readonly CursorPosition[];

  // execute で決まる、undo のための状態
  private notesBefore = new Map<model.Beat, model.Note[]>();
  private removedBeats: RemovedBeat[] = [];
  /** 拍が 1 つも無くなった小節に置いた、全音符の休符の拍（3.3 節）。 */
  private filledRests: { voice: model.Voice; beat: model.Beat }[] = [];
  /** 拍が 0 個になって小節から外した 2 つ目の Voice（4.1 節の (b)）。 */
  private removedVoices: RemovedVoice[] = [];

  constructor(target: EditTarget, notes: readonly NoteRef[], restBeats: readonly CursorPosition[]) {
    this.score = target.score;
    this.notes = notes;
    this.restBeats = restBeats;
    const tracks = new Set([...notes.map((ref) => ref.position.trackIndex), ...restBeats.map((p) => p.trackIndex)]);
    // <!-- req editingcore:0fcb3848.8418 -->
    this.affectedTrackIndices = [...tracks].sort((a, b) => a - b);
  }

  execute(): CommandOutcome {
    // 位置で引くのは、拍を取り除いて番号がずれる前に全部すませる
    const noteTargets = this.notes.flatMap((ref) => {
      const beat = this.beatAt(ref.position);
      const note = beat === undefined ? null : findNoteOnString(beat, ref.stringNumber);
      return beat === undefined || note === null ? [] : [{ beat, note }];
    });
    const restTargets = this.restBeats.flatMap((position) => {
      const voice = this.voiceAt(position);
      const beat = voice?.beats[position.beatIndex];
      return voice === undefined || beat === undefined || beat.notes.length > 0
        ? []
        : [{ voice, beat, primary: position.voiceIndex === 0 }];
    });

    this.notesBefore = new Map();
    for (const { beat, note } of noteTargets) {
      if (!this.notesBefore.has(beat)) this.notesBefore.set(beat, [...beat.notes]);
      // 音符を外しても拍は残す（音が残らなければ、長さを変えずに休符の拍になる）
      // <!-- req editingcore:0fcb3848.ca47 -->
      beat.removeNote(note);
    }

    this.removedBeats = [];
    for (const { voice, beat } of restTargets) {
      // <!-- req editingcore:0fcb3848.51de -->
      const index = removeBeat(voice, beat);
      if (index >= 0) this.removedBeats.push({ voice, beat, index });
    }
    // 1 つ目のボイスの拍が 1 つも無くなった小節は、音を置かない位置として全音符の休符の拍にする（3.3 節・4.4 節の (b)）
    const primaryVoices = new Set(restTargets.filter((t) => t.primary).map((t) => t.voice));
    this.filledRests = [...primaryVoices].flatMap((voice) => {
      const beat = fillEmptyVoiceWithBarRest(voice);
      return beat === null ? [] : [{ voice, beat }];
    });
    // 2 つ目のボイスの拍が 0 個になった小節は、同じコマンドの中でその小節の Bar.voices から 2 つ目の Voice を外す
    // （4.1 節の (b)、決定 265 番。音を置いていない小節に空のボイスを残さない）。外した後のボイス 2 のカーソルは、
    // 2 つ目のボイスがまだ無い小節と同じく拍 0 になる（beatIndexForVoiceSwitch）
    // <!-- req editingcore:31c02a9c.e01a --> <!-- req editingcore:31c02a9c.ed36 -->
    const secondaryVoices = new Set(restTargets.filter((t) => !t.primary).map((t) => t.voice));
    this.removedVoices = [...secondaryVoices].flatMap((voice) => {
      const removed = removeVoiceIfNoBeats(voice);
      return removed === null ? [] : [removed];
    });

    return { cursorAdvance: 'none' };
  }

  undo(): CommandOutcome {
    // 拍が無くなった小節に置いた休符の拍を先に外す
    for (const { voice, beat } of this.filledRests) removeBeat(voice, beat);
    this.filledRests = [];
    // 拍が 0 個になって外した 2 つ目の Voice を、同じ位置に戻す（4.1 節の (b)）
    // <!-- req editingcore:31c02a9c.f273 -->
    for (let i = this.removedVoices.length - 1; i >= 0; i--) restoreRemovedVoice(this.removedVoices[i]!);
    this.removedVoices = [];
    // 取り除いた順の逆に戻すと、どの拍も取り除いたときと同じ位置へ入る
    for (let i = this.removedBeats.length - 1; i >= 0; i--) {
      const { voice, beat, index } = this.removedBeats[i]!;
      insertBeatAt(voice, index, beat);
    }
    for (const [beat, notes] of this.notesBefore) replaceNotes(beat, notes);
    this.removedBeats = [];
    this.notesBefore = new Map();
    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }

  /** 2 つ目のボイスがまだ無い小節のボイス 2 は undefined（拍が 0 個のボイスと同じで、消すものが無い。4.1 節）。 */
  private voiceAt(position: CursorPosition): model.Voice | undefined {
    return getBar(this.score, position.trackIndex, position.barIndex).voices[position.voiceIndex];
  }

  private beatAt(position: CursorPosition): model.Beat | undefined {
    return voiceBeats(this.score, position.trackIndex, position.barIndex, position.voiceIndex)[position.beatIndex];
  }
}
