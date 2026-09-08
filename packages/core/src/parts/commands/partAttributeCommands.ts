/**
 * パート属性（ミキサー値・識別色・カポ）を書き換える単項コマンド群
 * （part-tuning-management.md §5、editing-core.md §6 の `Command`/`CommandHistory` 基盤に準拠）。
 *
 * B33（editing-core）と同じく alphaTab `Score.finish()` は呼ばない。属性変更は構造を変えず、
 * 派生情報の再計算は `CommandHistory` → `ScoreRenderHost.render()` に一任する。
 * execute で旧値を捕捉 → 復元関数を返す一律パターンで execute/undo の対称性を保証する。
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../../editing/commandBase';
import type { Command, CommandOutcome } from '../../editing/types';
import { colorToHex, getStaff, getTrack, hexToColor } from '../partModel';

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

abstract class PartAttributeCommand implements Command {
  abstract readonly kind: string;
  abstract readonly label: string;
  readonly affectedTrackIndices: readonly number[];
  protected readonly score: model.Score;
  protected readonly trackIndex: number;
  private restore: (() => void) | null = null;

  protected constructor(score: model.Score, trackIndex: number) {
    this.score = score;
    this.trackIndex = trackIndex;
    this.affectedTrackIndices = [trackIndex];
  }

  /** 旧値を捕捉して新値を適用し、復元関数を返す。 */
  protected abstract apply(): () => void;

  execute(): CommandOutcome {
    this.restore = this.apply();
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    this.restore?.();
    this.restore = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

// ===== ミキサー：数値（ドラッグ中の連続変更を結合） =====

/** `SetPartVolumeCommand` / `SetPartPanCommand` の共通実装。 */
abstract class NumericMixerCommand extends PartAttributeCommand {
  /** 結合時に「ドラッグ開始前の値」を保つための、この履歴エントリが復元すべき旧値。 */
  private baseOldValue: number | null = null;

  protected constructor(
    score: model.Score,
    trackIndex: number,
    protected readonly field: 'volume' | 'balance',
    protected readonly nextValue: number,
  ) {
    super(score, trackIndex);
  }

  protected apply(): () => void {
    const info = getTrack(this.score, this.trackIndex).playbackInfo;
    if (this.baseOldValue === null) this.baseOldValue = info[this.field];
    info[this.field] = this.nextValue;
    // 復元先はクロージャで固定せず `this.baseOldValue` を undo 時に読む
    // （merge で「ドラッグ開始前の値」へ書き換わっても正しく戻せるように）。
    return () => {
      info[this.field] = this.baseOldValue as number;
    };
  }

  canMergeWith(other: Command): boolean {
    return (
      other.kind === this.kind &&
      other instanceof NumericMixerCommand &&
      other.trackIndex === this.trackIndex &&
      other.field === this.field
    );
  }

  /** 古い方（`other`）の「ドラッグ開始前の値」を引き継ぎ、1 エントリで開始前まで戻せるようにする。 */
  mergeWith(other: Command): void {
    if (other instanceof NumericMixerCommand && other.baseOldValue !== null) {
      this.baseOldValue = other.baseOldValue;
    }
  }
}

export class SetPartVolumeCommand extends NumericMixerCommand {
  readonly kind = 'set-part-volume';
  readonly label = '音量';
  constructor(score: model.Score, trackIndex: number, volume: number) {
    super(score, trackIndex, 'volume', volume);
  }
}

export class SetPartPanCommand extends NumericMixerCommand {
  readonly kind = 'set-part-pan';
  readonly label = 'パン';
  constructor(score: model.Score, trackIndex: number, pan: number) {
    super(score, trackIndex, 'balance', pan);
  }
}

// ===== ミキサー：ソロ／ミュート（結合しない） =====

export class SetPartSoloCommand extends PartAttributeCommand {
  readonly kind = 'set-part-solo';
  readonly label = 'ソロ';
  constructor(
    score: model.Score,
    trackIndex: number,
    private readonly solo: boolean,
  ) {
    super(score, trackIndex);
  }
  protected apply(): () => void {
    const info = getTrack(this.score, this.trackIndex).playbackInfo;
    const old = info.isSolo;
    info.isSolo = this.solo;
    return () => {
      info.isSolo = old;
    };
  }
}

export class SetPartMuteCommand extends PartAttributeCommand {
  readonly kind = 'set-part-mute';
  readonly label = 'ミュート';
  constructor(
    score: model.Score,
    trackIndex: number,
    private readonly mute: boolean,
  ) {
    super(score, trackIndex);
  }
  protected apply(): () => void {
    const info = getTrack(this.score, this.trackIndex).playbackInfo;
    const old = info.isMute;
    info.isMute = this.mute;
    return () => {
      info.isMute = old;
    };
  }
}

// ===== 識別色 =====

export class SetPartColorCommand extends PartAttributeCommand {
  readonly kind = 'set-part-color';
  readonly label = 'パート色';
  constructor(
    score: model.Score,
    trackIndex: number,
    private readonly hex: string,
  ) {
    super(score, trackIndex);
  }
  protected apply(): () => void {
    const track = getTrack(this.score, this.trackIndex);
    const oldHex = colorToHex(track.color);
    track.color = hexToColor(this.hex);
    return () => {
      track.color = hexToColor(oldHex);
    };
  }
}

// ===== カポ（0〜12 は ValidationService 検証済みの前提、part-tuning-management.md §3.3） =====

export class SetCapoFretCommand extends PartAttributeCommand {
  readonly kind = 'set-capo-fret';
  readonly label = 'カポ';
  constructor(
    score: model.Score,
    trackIndex: number,
    private readonly capoFret: number,
  ) {
    super(score, trackIndex);
  }
  protected apply(): () => void {
    const staff = getStaff(this.score, this.trackIndex);
    const old = staff.capo;
    staff.capo = this.capoFret;
    return () => {
      staff.capo = old;
    };
  }
}
