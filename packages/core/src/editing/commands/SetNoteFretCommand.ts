/**
 * 置いた音符のフレットを 2 桁に書き換えるコマンド（editing-core.md 2.6 節・4.2 節・7.3 節）。
 *
 * 数字キーで置いてから 1 秒以内に次の数字を押し、2 桁が 10 から 24 になるときに `EditingService` が発行する。
 * 続けて起きる同じ音符の 2 桁のフレットの書き換えは、前の `PlaceNoteCommand` と履歴の 1 つの項目にまとめる：
 * `canMergeWith` は、直前の項目が同じ音符（同じ拍の同じ弦）を置いた `PlaceNoteCommand` のときだけ真を返し、
 * `mergeWith` でその項目を取り込む。まとめた後は、1 回の取り消しで書き換えと置いた音符の両方が戻り、
 * やり直しでは置いた音符を置き直してから書き換える（利用者には 1 つの音を置いた操作に見える）。
 * 書き換える音が自然ハーモニクスなら、`harmonicValue` も書き換えた後のフレットに合わせ、undo でフレットと一緒に戻す（7.3 節）。
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { findNoteOnString, voiceBeats } from '../scoreModel';
import type { CommandOutcome, CursorPosition, EditTarget } from '../types';
import type { Command, CommandLabelId } from './Command';
import { naturalHarmonicValue } from './noteAttributeCommands';
import { PlaceNoteCommand } from './PlaceNoteCommand';

export class SetNoteFretCommand implements Command {
  readonly kind = 'set-note-fret';
  /** 変更が及ぶのは、書き換えた音符のパートだけ（editing-core.md 2.6 節）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly position: CursorPosition;
  private readonly stringNumber: number;
  private readonly fret: number;
  /** mergeWith で取り込んだ、同じ音符を置いた PlaceNoteCommand。 */
  private merged: PlaceNoteCommand | null = null;
  private restore: (() => void) | null = null;

  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, fret: number) {
    this.score = target.score;
    this.position = position;
    this.stringNumber = stringNumber;
    this.fret = fret;
    // <!-- req editingcore:25ef58c0.428d -->
    this.affectedTrackIndices = [position.trackIndex];
  }

  /** 取り込んだ後は、置いた音符の操作として見せる（1 回の取り消しで 2 桁の入力が全部戻るため）。 */
  get label(): CommandLabelId {
    return this.merged?.label ?? 'set-note-fret';
  }

  execute(): CommandOutcome {
    // やり直しでは、取り込んだ PlaceNoteCommand で音符を置き直してから書き換える
    this.merged?.execute();
    // 2 つ目のボイスがまだ無い小節のボイス 2 は拍が 0 個のボイスと同じで、書き換える音符は無い（4.1 節）
    const { trackIndex, barIndex, voiceIndex, beatIndex } = this.position;
    const beat = voiceBeats(this.score, trackIndex, barIndex, voiceIndex)[beatIndex];
    const note = beat === undefined ? null : findNoteOnString(beat, this.stringNumber);
    if (note === null) {
      this.restore = null;
      return { cursorAdvance: 'none' };
    }

    // <!-- req editingcore:b4aef1c4.e94a --> <!-- req editingcore:b4aef1c4.64cd -->
    const old = { fret: note.fret, harmonicValue: note.harmonicValue };
    // <!-- req editingcore:54e0b2f1.d6cc --> <!-- req editingcore:25ef58c0.9118 -->
    note.fret = this.fret;
    // <!-- req editingcore:437f348c.07a5 --> <!-- req editingcore:437f348c.c4c6 --> <!-- req editingcore:437f348c.27f8 -->
    if (note.harmonicType === model.HarmonicType.Natural) note.harmonicValue = naturalHarmonicValue(this.fret);
    this.restore = () => {
      note.fret = old.fret;
      // <!-- req editingcore:437f348c.b98d -->
      note.harmonicValue = old.harmonicValue;
    };
    return { cursorAdvance: 'none' };
  }

  undo(): CommandOutcome {
    this.restore?.();
    this.restore = null;
    this.merged?.undo();
    return { cursorAdvance: 'none' };
  }

  /** 直前の項目が、同じ拍の同じ弦に音符を置いた PlaceNoteCommand のときだけ真（editing-core.md 4.2 節）。 */
  canMergeWith(other: Command): boolean {
    return other instanceof PlaceNoteCommand && other.placesNoteAt(this.position, this.stringNumber);
  }

  /** canMergeWith が真の PlaceNoteCommand（古いほう）を取り込む。 */
  mergeWith(other: Command): void {
    if (other instanceof PlaceNoteCommand) this.merged = other;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES + (this.merged?.estimateSizeBytes() ?? 0);
  }
}
