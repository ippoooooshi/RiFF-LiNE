/**
 * 休符の拍を挿入するコマンド（editing-core.md 2.6 節・3.3 節・4.4 節）。
 *
 * 休符は音符を持たない拍（`Beat.notes` が空）で表し、alphaTab の読み取り専用の `Beat.isRest` には書かない。
 * 「休符」ボタンと Enter での明示のスキップ（と、小節に空きがある最後の拍の後ろの →）で、渡した音価（BeatDurationSpec）の
 * 休符の拍をカーソルの位置に挿入し、カーソルを進める。何も置かなかった位置は暗黙の休符のままで、本コマンドは要らない。
 */

import type { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { applyDurationSpec, createRestBeat, getBar, getVoice, insertBeatAt, removeBeat } from '../scoreModel';
import type { BeatDurationSpec, CommandOutcome, CursorPosition, EditTarget } from '../types';
import type { Command } from './Command';

// <!-- req editingcore:d11ab3cf.bcb4 -->
export class InsertRestCommand implements Command {
  readonly kind = 'insert-rest';
  readonly label = 'insert-rest';
  /** 変更が及ぶのは、休符の拍を挿入したパートだけ（editing-core.md 2.6 節）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly position: CursorPosition;
  private readonly spec: BeatDurationSpec;
  private insertedBeat: model.Beat | null = null;

  // <!-- req editingcore:ee890ce2.4182 -->
  constructor(target: EditTarget, position: CursorPosition, spec: BeatDurationSpec) {
    this.score = target.score;
    this.position = position;
    this.spec = spec;
    // <!-- req editingcore:21de6bc7.2d2f -->
    this.affectedTrackIndices = [position.trackIndex];
  }

  execute(): CommandOutcome {
    const voice = getVoice(getBar(this.score, this.position.trackIndex, this.position.barIndex));
    // 拍は最初の execute で作り、やり直しでは同じ拍を置き直す
    const beat = this.insertedBeat ?? createRestBeat(this.spec.duration);
    applyDurationSpec(beat, this.spec);
    this.insertedBeat = beat;
    // 足した拍から属する Voice への逆参照（Beat.voice）は insertBeatAt で張る（editing-core.md 2.4 節）
    // <!-- req editingcore:21de6bc7.b929 -->
    insertBeatAt(voice, this.position.beatIndex, beat);
    return { cursorAdvance: 'beat' };
  }

  undo(): CommandOutcome {
    removeBeat(getVoice(getBar(this.score, this.position.trackIndex, this.position.barIndex)), this.insertedBeat!);
    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
