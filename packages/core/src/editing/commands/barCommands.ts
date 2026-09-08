/**
 * 小節の挿入・削除（editing-core.md §6.4・§10.3、04_editing_core.md §10）。
 *
 * どちらも曲全体（全パート）の小節構造を同期変更し、1 回の undo で全体が戻る（§6.3 の Composite 相当。
 * alphaTab の Staff/Score へのミッド挿入は splice が必要なため、per-part 子コマンドに分けず単一コマンドで
 * 全 Staff を同期変更する形にした。undo の原子性は同じく担保される）。
 *
 * 継承チェーン（B5）：挿入 Bar の `tempoAutomations` は空（＝直前から継承）。時報（time signature）は
 * alphaTab に「継承」の null 表現が無いため直前 MasterBar の値を引き継ぐ（WP4 に time signature 変更コマンドは
 * 無く、これで観測上の「継承」と一致する）。
 */

import { model } from '@coderline/alphatab';

import type { Memo, SectionMarker } from '../../domain/types';
import { BASE_COMMAND_BYTES } from '../commandBase';
import { allTrackIndices, barCount, getStaff } from '../scoreModel';
import type { Command, CommandOutcome, EditTarget } from '../types';

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

/** 全休符 1 拍の Bar を生成する。 */
function createEmptyBar(): model.Bar {
  const bar = new model.Bar();
  const voice = new model.Voice();
  bar.addVoice(voice);
  const rest = new model.Beat();
  rest.duration = model.Duration.Whole;
  voice.addBeat(rest);
  return bar;
}

/** `barId`（= 小節インデックスの文字列）を持つ AppMetadata 要素のインデックスをずらす。 */
function shiftBarRefs(items: { barId: string }[], fromIndex: number, delta: number): void {
  for (const item of items) {
    const index = Number(item.barId);
    if (Number.isInteger(index) && index >= fromIndex) item.barId = String(index + delta);
  }
}

export class InsertBarCommand implements Command {
  readonly kind = 'insert-bar';
  readonly label = '小節を挿入';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly memos: Memo[];
  private readonly markers: SectionMarker[];
  private readonly at: number;
  private insertedBars: model.Bar[] = [];
  private insertedMasterBar: model.MasterBar | null = null;

  /** @param at 挿入位置（この位置へ入り、以降が 1 つ後ろへ）。0 〜 barCount。 */
  constructor(target: EditTarget, at: number) {
    this.score = target.score;
    this.memos = target.appMeta.memos;
    this.markers = target.appMeta.sectionMarkers;
    this.at = at;
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const at = Math.min(Math.max(0, this.at), barCount(this.score));

    const masterBar = new model.MasterBar();
    const prev = this.score.masterBars[at - 1] ?? this.score.masterBars[0];
    if (prev !== undefined) {
      masterBar.timeSignatureNumerator = prev.timeSignatureNumerator;
      masterBar.timeSignatureDenominator = prev.timeSignatureDenominator;
    }
    masterBar.tempoAutomations = []; // 継承（B5）
    this.score.masterBars.splice(at, 0, masterBar);
    this.insertedMasterBar = masterBar;

    this.insertedBars = this.score.tracks.map((_track, trackIndex) => {
      const bar = createEmptyBar();
      getStaff(this.score, trackIndex).bars.splice(at, 0, bar);
      return bar;
    });

    shiftBarRefs(this.memos, at, +1);
    shiftBarRefs(this.markers, at, +1);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    const at = Math.min(Math.max(0, this.at), barCount(this.score) - 1);
    this.score.tracks.forEach((_track, trackIndex) => {
      const bars = getStaff(this.score, trackIndex).bars;
      const index = bars.indexOf(this.insertedBars[trackIndex]!);
      if (index >= 0) bars.splice(index, 1);
    });
    if (this.insertedMasterBar !== null) {
      const mi = this.score.masterBars.indexOf(this.insertedMasterBar);
      if (mi >= 0) this.score.masterBars.splice(mi, 1);
    }
    shiftBarRefs(this.memos, at + 1, -1);
    shiftBarRefs(this.markers, at + 1, -1);
    this.insertedBars = [];
    this.insertedMasterBar = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES * (1 + this.score.tracks.length);
  }
}

/** Bar 削除時の関連メモ／セクションマーカーの扱い（B2、Critical ダイアログの結果）。 */
export type BarDeleteDisposition = 'delete' | 'move-to-previous';

export class DeleteBarCommand implements Command {
  readonly kind = 'delete-bar';
  readonly label = '小節を削除';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly memos: Memo[];
  private readonly markers: SectionMarker[];
  private readonly at: number;
  private readonly disposition: BarDeleteDisposition;

  private removedBars: { trackIndex: number; bar: model.Bar }[] = [];
  private removedMasterBar: { masterBar: model.MasterBar; index: number } | null = null;
  /** execute 前の memos/markers（並び順・各 barId）の完全スナップショット。undo で丸ごと復元する。 */
  private memoBefore: { list: Memo[]; barIds: Map<Memo, string> } | null = null;
  private markerBefore: { list: SectionMarker[]; barIds: Map<SectionMarker, string> } | null = null;

  constructor(target: EditTarget, at: number, disposition: BarDeleteDisposition) {
    this.score = target.score;
    this.memos = target.appMeta.memos;
    this.markers = target.appMeta.sectionMarkers;
    this.at = at;
    this.disposition = disposition;
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const at = this.at;
    this.memoBefore = { list: [...this.memos], barIds: new Map(this.memos.map((m) => [m, m.barId])) };
    this.markerBefore = { list: [...this.markers], barIds: new Map(this.markers.map((m) => [m, m.barId])) };

    // 対象小節を全 Staff / Score から取り除く。
    this.removedBars = this.score.tracks.map((_track, trackIndex) => {
      const bars = getStaff(this.score, trackIndex).bars;
      const [bar] = bars.splice(at, 1);
      return { trackIndex, bar: bar! };
    });
    const [masterBar] = this.score.masterBars.splice(at, 1);
    this.removedMasterBar = { masterBar: masterBar!, index: at };

    // 対象小節に紐づくメモ／マーカーを B2 の方針で処理し、後ろの参照を 1 つ前へ詰める。
    disposeAttached(this.memos, at, this.disposition);
    disposeAttached(this.markers, at, this.disposition);
    shiftBarRefs(this.memos, at + 1, -1);
    shiftBarRefs(this.markers, at + 1, -1);

    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    for (const { trackIndex, bar } of this.removedBars) {
      getStaff(this.score, trackIndex).bars.splice(this.at, 0, bar);
    }
    if (this.removedMasterBar !== null) {
      this.score.masterBars.splice(this.removedMasterBar.index, 0, this.removedMasterBar.masterBar);
    }

    // メモ／マーカーは execute 前の配列内容・barId へ丸ごと戻す（削除・移動・シフトを一括で巻き戻す）。
    if (this.memoBefore !== null) {
      this.memos.splice(0, this.memos.length, ...this.memoBefore.list);
      for (const [memo, barId] of this.memoBefore.barIds) memo.barId = barId;
    }
    if (this.markerBefore !== null) {
      this.markers.splice(0, this.markers.length, ...this.markerBefore.list);
      for (const [marker, barId] of this.markerBefore.barIds) marker.barId = barId;
    }

    this.removedBars = [];
    this.removedMasterBar = null;
    this.memoBefore = null;
    this.markerBefore = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES * (1 + this.score.tracks.length);
  }
}

/** 削除対象小節 `at` に紐づく要素を、disposition に従って一覧から削除 or 直前小節へ付け替える（B2）。 */
function disposeAttached<T extends { barId: string }>(list: T[], at: number, disposition: BarDeleteDisposition): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (Number(list[i]!.barId) !== at) continue;
    if (disposition === 'move-to-previous' && at > 0) {
      list[i]!.barId = String(at - 1);
    } else {
      list.splice(i, 1);
    }
  }
}
