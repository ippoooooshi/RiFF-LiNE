/**
 * 拍へ音符を 1 つ足すコマンド（editing-core.md 2.6 節・4.2 節・4.7 節）。
 *
 * 前提：同じ拍の同じ弦の重なりとフレットの範囲は、発行の前に `ValidationService` が確かめている（editing-core.md 5 節）。
 * 本コマンドは Score を変えるだけで、描き直しは頼まず `Score.finish()` も呼ばない（editing-core.md 2.4 節）。
 * 拍の状態で 3 通りに分かれ、どれも execute と undo が対称になる：
 *   1. 休符の拍（音符を持たない拍）→ 渡した音価（BeatDurationSpec）に変えて音符を足し、音符の拍へ変える
 *   2. 音のある拍 → 和音として音符の並びへ足すだけ（音価は変えない、4.7 節）
 *   3. 拍が無い（beatIndex が beats.length）→ 渡した音価の新しい拍を作り、insertBeatAt で足す
 * 位置のボイス（position.voiceIndex）の拍に置き、ボイス 2 に置くときに 2 つ目のボイスがまだ無い小節では、Bar.voices に
 * 2 つ目の Voice を作り、undo で外す（editing-core.md 4.1 節）。
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import {
  applyDurationSpec,
  captureDurationFields,
  createStringNote,
  ensureSecondVoice,
  getBar,
  getVoice,
  insertBeatAt,
  removeBeat,
  removeVoice,
  restoreDurationFields,
  type BeatDurationFields,
} from '../scoreModel';
import type { BeatDurationSpec, CommandOutcome, CursorPosition, EditTarget } from '../types';
import type { Command } from './Command';

type Mode = 'convert-rest' | 'chord-add' | 'new-beat';

// <!-- req editingcore:624ba574.93d0 --> <!-- req editingcore:6b00ffc2.d52a --> <!-- req editingcore:6b00ffc2.7f61 --> <!-- req editingcore:6b00ffc2.c156 --> <!-- req editingcore:6b00ffc2.d78c -->
// <!-- req editingcore:0a85fb98.4574 --> <!-- req editingcore:974451c7.b893 -->
export class PlaceNoteCommand implements Command {
  readonly kind = 'place-note';
  readonly label = 'place-note';
  /** 変更が及ぶのは、音符を置いたパートだけ（editing-core.md 2.6 節）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly position: CursorPosition;
  private readonly stringNumber: number;
  private readonly fret: number;
  private readonly spec: BeatDurationSpec;

  // execute で決まる、undo のための状態。音符と新しい拍は最初の execute で作り、やり直しでは同じものを置き直す
  private note: model.Note | null = null;
  private createdBeat: model.Beat | null = null;
  private targetBeat: model.Beat | null = null;
  private mode: Mode = 'new-beat';
  private previousDuration: BeatDurationFields | null = null;
  /** ボイス 2 に置いたときに、この execute が作った 2 つ目の Voice（作らなかったら null）。 */
  private createdVoice: model.Voice | null = null;

  constructor(
    // <!-- req editingcore:b82553ce.e805 -->
    target: EditTarget,
    // <!-- req editingcore:b82553ce.8371 -->
    position: CursorPosition,
    // <!-- req editingcore:b82553ce.af76 -->
    stringNumber: number,
    // <!-- req editingcore:b82553ce.b57e -->
    fret: number,
    // <!-- req editingcore:b82553ce.0918 --> <!-- req editingcore:fe783de0.be96 --> <!-- req editingcore:71c0a373.84fa -->
    spec: BeatDurationSpec,
  ) {
    this.score = target.score;
    this.position = position;
    this.stringNumber = stringNumber;
    this.fret = fret;
    this.spec = spec;
    // <!-- req editingcore:0a85fb98.bfec -->
    this.affectedTrackIndices = [position.trackIndex];
  }

  /**
   * このコマンドが、指定した拍の指定した弦に音符を置くものか（SetNoteFretCommand.canMergeWith が、2 桁のフレットの書き換えを
   * 同じ音符を置いた履歴の項目とまとめてよいかを見るのに使う。editing-core.md 4.2 節）。
   */
  placesNoteAt(position: CursorPosition, stringNumber: number): boolean {
    return (
      this.position.trackIndex === position.trackIndex &&
      this.position.barIndex === position.barIndex &&
      this.position.voiceIndex === position.voiceIndex &&
      this.position.beatIndex === position.beatIndex &&
      this.stringNumber === stringNumber
    );
  }

  execute(): CommandOutcome {
    const bar = getBar(this.score, this.position.trackIndex, this.position.barIndex);
    // ボイス 2 に置くとき、2 つ目のボイスがまだ無い小節なら作る（editing-core.md 4.1 節）。作った Voice は undo で外す
    // <!-- req editingcore:31c02a9c.84c0 -->
    if (this.position.voiceIndex === 1) this.createdVoice = ensureSecondVoice(bar, this.createdVoice);
    const voice = getVoice(bar, this.position.voiceIndex);
    // 置いた音の弦は Note.string に、フレットは Note.fret に入れる（editing-core.md 4.2 節）
    // <!-- req editingcore:b9276c22.eb8d --> <!-- req editingcore:b9276c22.2e7c --> <!-- req editingcore:b9276c22.8498 -->
    const note = this.note ?? createStringNote(this.stringNumber, this.fret);
    this.note = note;

    const existing = voice.beats[this.position.beatIndex];
    // <!-- req editingcore:0a85fb98.2bb2 -->
    if (existing === undefined) {
      // 3. 拍が無ければ新しい拍を足す。逆参照（Beat.voice）は insertBeatAt で張る
      this.mode = 'new-beat';
      const beat = this.createdBeat ?? new model.Beat();
      this.createdBeat = beat;
      // <!-- req editingcore:b362bf75.f1ac -->
      applyDurationSpec(beat, this.spec);
      beat.addNote(note);
      // <!-- req editingcore:1203247e.73bb --> <!-- req editingcore:88d85dd1.9354 -->
      // 足すのは音符の拍だけで、小節の中で残る位置には休符の Beat を作らず、暗黙の休符として扱う（3.3 節）
      // <!-- req editingcore:fc0f0993.1f44 --> <!-- req editingcore:fc0f0993.30db --> <!-- req editingcore:8ec5d809.3327 -->
      insertBeatAt(voice, this.position.beatIndex, beat);
      this.targetBeat = beat;
      // <!-- req editingcore:0a85fb98.fcd6 -->
    } else if (existing.notes.length === 0) {
      // 1. 休符の拍は音符の拍へ（音価は渡したものに変える）
      // <!-- req editingcore:09849a5d.ba90 --> <!-- req editingcore:09849a5d.a9d9 -->
      this.mode = 'convert-rest';
      this.previousDuration = captureDurationFields(existing);
      applyDurationSpec(existing, this.spec);
      // <!-- req editingcore:1bfb74d1.09f4 -->
      existing.addNote(note);
      this.targetBeat = existing;
    } else {
      // 2. 音のある拍は和音へ（音符の並びへの追加だけ）
      // <!-- req editingcore:85851646.12b9 --> <!-- req editingcore:85851646.8403 --> <!-- req editingcore:85851646.6727 -->
      // <!-- req editingcore:b1223de3.2172 --> <!-- req editingcore:b1223de3.2f63 --> <!-- req editingcore:9071a1fe.c37d --> <!-- req editingcore:9071a1fe.5472 --> <!-- req editingcore:b05578b4.3ae9 -->
      this.mode = 'chord-add';
      // <!-- req editingcore:0a85fb98.af1a -->
      existing.addNote(note);
      this.targetBeat = existing;
    }

    return { cursorAdvance: 'beat' }; // <!-- req editingcore:ec2256b4.d07b --> <!-- req editingcore:ec2256b4.906c -->
  }

  undo(): CommandOutcome {
    const beat = this.targetBeat!;
    const bar = getBar(this.score, this.position.trackIndex, this.position.barIndex);

    beat.removeNote(this.note!);
    if (this.mode === 'new-beat') {
      removeBeat(getVoice(bar, this.position.voiceIndex), beat);
    } else if (this.mode === 'convert-rest') {
      restoreDurationFields(beat, this.previousDuration!);
    }
    // execute で作った 2 つ目のボイスを外す（editing-core.md 4.1 節「作った Voice は、置いたコマンドの undo で外す」）
    // <!-- req editingcore:31c02a9c.e7de -->
    if (this.createdVoice !== null) removeVoice(bar, this.createdVoice);

    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
