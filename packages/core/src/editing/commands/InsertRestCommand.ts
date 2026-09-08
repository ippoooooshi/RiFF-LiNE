/**
 * 指定位置へ明示的な休符 Beat を挿入する（editing-core.md §6.4、04_editing_core.md §2）。
 *
 * 「音を置かなかった位置」は Bar 生成時点で暗黙的休符になっているため追加不要。本コマンドは
 * ユーザーが音価を選んで「休符」ボタン等で明示的にスキップした場合に発行される。
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { createRestBeat, getVoice, getBar, insertBeatAt } from '../scoreModel';
import type { Command, CommandOutcome, CursorPosition, EditTarget } from '../types';

export class InsertRestCommand implements Command {
  readonly kind = 'insert-rest';
  readonly label = '休符を挿入';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly position: CursorPosition;
  private readonly duration: model.Duration;
  private insertedBeat: model.Beat | null = null;

  constructor(target: EditTarget, position: CursorPosition, duration: model.Duration) {
    this.score = target.score;
    this.position = position;
    this.duration = duration;
    this.affectedTrackIndices = [position.trackIndex];
  }

  execute(): CommandOutcome {
    const voice = getVoice(getBar(this.score, this.position.trackIndex, this.position.barIndex));
    const beat = createRestBeat(this.duration);
    this.insertedBeat = beat;

    insertBeatAt(voice, this.position.beatIndex, beat);
    return { cursorAdvance: 'beat' };
  }

  undo(): CommandOutcome {
    const voice = getVoice(getBar(this.score, this.position.trackIndex, this.position.barIndex));
    const index = voice.beats.indexOf(this.insertedBeat!);
    if (index >= 0) voice.beats.splice(index, 1);
    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
