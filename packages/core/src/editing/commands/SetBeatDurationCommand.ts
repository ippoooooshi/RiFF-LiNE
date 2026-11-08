/**
 * 今ある拍の音価・付点・連符を変えるコマンド（editing-core.md 2.6 節・3.3 節・4.3 節）。
 *
 * 1 つの拍だけを変える。範囲選択の全部の拍を変えるときは、拍ごとの本コマンドを `CompositeCommand` にまとめる（B41）。
 * 音価は音符の長さ（Beat.duration）・付点の数（Beat.dots）・連符（Beat.tupletNumerator・Beat.tupletDenominator）の組で、
 * 新しく置く `PlaceNoteCommand`・`InsertRestCommand` と同じ形（BeatDurationSpec）で受ける。付点と連符の確かめは発行の前に
 * `ValidationService.validateBeatDuration` が行い、小節の音価の合計が拍子を超えても拒まない（editing-core.md 5 節）。
 * undo は前の音価（4 つの項目のそのままの値）に戻す。
 */

import type { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { applyDurationSpec, captureDurationFields, getBeat, restoreDurationFields } from '../scoreModel';
import type { BeatDurationSpec, CommandOutcome, CursorPosition, EditTarget } from '../types';
import type { Command } from './Command';

export class SetBeatDurationCommand implements Command {
  readonly kind = 'set-beat-duration';
  readonly label = 'set-beat-duration';
  /** 変更が及ぶのは、音価を変えた拍のパートだけ（editing-core.md 2.6 節）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly position: CursorPosition;
  private readonly spec: BeatDurationSpec;
  private restore: (() => void) | null = null;

  constructor(target: EditTarget, position: CursorPosition, spec: BeatDurationSpec) {
    this.score = target.score;
    this.position = position;
    this.spec = spec;
    // <!-- req editingcore:60bf886e.85d4 -->
    this.affectedTrackIndices = [position.trackIndex];
  }

  execute(): CommandOutcome {
    const beat = getBeat(
      this.score,
      this.position.trackIndex,
      this.position.barIndex,
      this.position.beatIndex,
      this.position.voiceIndex,
    );
    const old = captureDurationFields(beat);
    // <!-- req editingcore:60bf886e.c676 --> <!-- req editingcore:60bf886e.5940 --> <!-- req editingcore:60bf886e.253d -->
    applyDurationSpec(beat, this.spec);
    this.restore = () => restoreDurationFields(beat, old);
    return { cursorAdvance: 'none' };
  }

  undo(): CommandOutcome {
    this.restore?.();
    this.restore = null;
    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
