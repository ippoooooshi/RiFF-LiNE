/**
 * パートの CRUD・ミキサー値・カポの変更受付（part-tuning-management.md §4.1）。
 *
 * UI（パッケージ8）からの要求を受け、`PartValidationService` で検証し、`PartColorAllocator` で色を払い出し、
 * 具象コマンドを組み立てて対象曲の `CommandHistory` へ `execute` する。編集ウィンドウごとに 1 インスタンス。
 */

import { STANDARD_BASS_TUNING, STANDARD_GUITAR_TUNING } from '../domain/newSong';
import type { CommandHistory, EditTarget } from '../editing';

import {
  SetCapoFretCommand,
  SetPartColorCommand,
  SetPartMuteCommand,
  SetPartPanCommand,
  SetPartSoloCommand,
  SetPartVolumeCommand,
} from './commands/partAttributeCommands';
import {
  AddPartCommand,
  RemovePartCommand,
  ReorderPartsCommand,
  type NewPartSpec,
} from './commands/structuralPartCommands';
import { PartColorAllocator } from './PartColorAllocator';
import { getColorHex, getCapo, getMixer, getStringCount, getTuning, getTrack, trackCount } from './partModel';
import type { PartValidationService } from './PartValidationService';

/** `NotificationCenter.report` の最小要求。 */
export interface PartNotificationReporter {
  report(code: string, context?: Record<string, unknown>): void;
}

/** MVP の楽器種別（02_data_model.md §3.2）。 */
export type InstrumentType = 'electric_guitar' | 'bass';

const MIDI_PROGRAM: Record<InstrumentType, number> = {
  electric_guitar: 30, // Distortion Guitar
  bass: 33, // Electric Bass (finger)
};

const DEFAULT_TUNING: Record<InstrumentType, readonly number[]> = {
  electric_guitar: STANDARD_GUITAR_TUNING,
  bass: STANDARD_BASS_TUNING,
};

/** UI 向けのパート表示情報（読み取り専用のスナップショット）。 */
export interface PartSummary {
  trackIndex: number;
  name: string;
  colorHex: string;
  stringCount: number;
  tuning: number[];
  capoFret: number;
  volume: number;
  pan: number;
  solo: boolean;
  mute: boolean;
}

export interface AddPartRequest {
  name: string;
  instrumentType: InstrumentType;
  /** 省略時は楽器種別の標準チューニング。 */
  tuning?: number[];
  /** 挿入位置。省略時は末尾。 */
  at?: number;
}

export class PartManagementService {
  private readonly colorAllocator = new PartColorAllocator();

  constructor(
    private readonly target: EditTarget,
    private readonly history: CommandHistory,
    private readonly validation: PartValidationService,
    private readonly reporter: PartNotificationReporter,
  ) {}

  /** 現在のパート一覧（表示用スナップショット）。 */
  listParts(): PartSummary[] {
    return this.target.score.tracks.map((_track, trackIndex) => this.summaryOf(trackIndex));
  }

  summaryOf(trackIndex: number): PartSummary {
    const mixer = getMixer(this.target.score, trackIndex);
    return {
      trackIndex,
      name: getTrack(this.target.score, trackIndex).name,
      colorHex: getColorHex(this.target.score, trackIndex),
      stringCount: getStringCount(this.target.score, trackIndex),
      tuning: getTuning(this.target.score, trackIndex),
      capoFret: getCapo(this.target.score, trackIndex),
      ...mixer,
    };
  }

  /**
   * パートを追加する。上限（8）超過は `EDIT-005` を通知して発行しない。
   * @param reservedColors バッチ一括追加時に、同一バッチで払い出し済みだが未実行の色（§3.6）。
   */
  addPart(request: AddPartRequest, reservedColors: string[] = []): void {
    const check = this.validation.validatePartCount(this.target);
    if (!check.ok) {
      this.reporter.report(check.code, check.context);
      return;
    }
    const used = this.target.score.tracks.map((_t, i) => getColorHex(this.target.score, i));
    const colorHex = this.colorAllocator.allocate(used, reservedColors);
    const spec: NewPartSpec = {
      name: request.name,
      program: MIDI_PROGRAM[request.instrumentType],
      tuning: request.tuning ?? [...DEFAULT_TUNING[request.instrumentType]],
      colorHex,
    };
    this.history.execute(new AddPartCommand(this.target.score, spec, request.at));
  }

  /** `addPart` が次に払い出すであろう色（バッチ追加時の除外リスト構築用、§3.6）。 */
  peekNextColor(reservedColors: string[] = []): string {
    const used = this.target.score.tracks.map((_t, i) => getColorHex(this.target.score, i));
    return this.colorAllocator.allocate(used, reservedColors);
  }

  /** パートを削除する。最低 1 パートは残す。 */
  removePart(trackIndex: number): void {
    if (trackCount(this.target.score) <= 1 || trackIndex < 0 || trackIndex >= trackCount(this.target.score)) return;
    this.history.execute(new RemovePartCommand(this.target.score, trackIndex));
  }

  /** パートの並び順を変更する。`order` は現在のインデックスの順列。 */
  reorderParts(order: readonly number[]): void {
    this.history.execute(new ReorderPartsCommand(this.target.score, order));
  }

  setVolume(trackIndex: number, volume: number): void {
    this.history.execute(new SetPartVolumeCommand(this.target.score, trackIndex, volume));
  }

  setPan(trackIndex: number, pan: number): void {
    this.history.execute(new SetPartPanCommand(this.target.score, trackIndex, pan));
  }

  setSolo(trackIndex: number, solo: boolean): void {
    this.history.execute(new SetPartSoloCommand(this.target.score, trackIndex, solo));
  }

  setMute(trackIndex: number, mute: boolean): void {
    this.history.execute(new SetPartMuteCommand(this.target.score, trackIndex, mute));
  }

  /** 手動での色変更（自動割当と違い重複チェックはしない、§4.3）。 */
  setColor(trackIndex: number, hex: string): void {
    this.history.execute(new SetPartColorCommand(this.target.score, trackIndex, hex));
  }

  /** カポ変更。0〜12 の範囲外は `EDIT-007` を通知して発行しない（§3.3、B14）。 */
  setCapo(trackIndex: number, capoFret: number): void {
    const check = this.validation.validateCapoFret(capoFret);
    if (!check.ok) {
      this.reporter.report(check.code, check.context);
      return;
    }
    this.history.execute(new SetCapoFretCommand(this.target.score, trackIndex, capoFret));
  }
}
