/**
 * セクションマーカーを足す・変える・消す（editing-core.md 2.6 節の表・3.10 節・10 節、基本設計 02 章 3.5 節）。
 *
 * マーカーの正は `appMeta.sectionMarkers` で、譜面に名前を描かせるため alphaTab の `MasterBar.section` にも写す（3.10 節）。
 * 写しを描き直すので、3 つのコマンドの `affectedTrackIndices` は全部のパートとする（10 節）。
 */

import { model } from '@coderline/alphatab';

import type { SectionMarker } from '../../domain/types';
import { BASE_COMMAND_BYTES } from '../commandBase';
import { allTrackIndices, getMasterBar } from '../scoreModel';
import type { CommandOutcome, EditTarget } from '../types';
import type { Command } from './Command';

import { barRef } from './memoCommands';

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

/** `markerId` のマーカーを返す。無ければ `RangeError`（editing-core.md 10 節の (b)：画面からは起きないアプリの不具合）。 */
function requireMarker(markers: readonly SectionMarker[], markerId: string): SectionMarker {
  const marker = markers.find((m) => m.id === markerId);
  if (marker === undefined) throw new RangeError(`section marker not found: ${markerId}`);
  return marker;
}

/** alphaTab の `MasterBar.section` に label の写しを置き、前の section を返す（undo 用）。 */
function mirrorSection(score: model.Score, barIndex: number, label: string): model.Section | null {
  const masterBar = getMasterBar(score, barIndex);
  const old = masterBar.section;
  const section = new model.Section();
  section.text = label;
  masterBar.section = section;
  return old;
}

// <!-- req editingcore:9a7d695e.bc9f --> <!-- req editingcore:4557341e.e591 -->
// <!-- req editingcore:2508e008.7e1f --> <!-- req editingcore:2508e008.00cd -->
export class AddSectionMarkerCommand implements Command {
  readonly kind = 'add-section-marker';
  readonly label = 'add-section-marker';
  readonly affectedTrackIndices: readonly number[];
  private readonly score: model.Score;
  private readonly markers: SectionMarker[];
  private readonly barIndex: number;
  private readonly created: SectionMarker;
  private previousSection: model.Section | null = null;

  /**
   * @throws RangeError `barIndex` が曲の小節（`Score.masterBars`）の範囲の外のとき、または同じ小節にマーカーがもうあるとき
   * （editing-core.md 10 節の (b)：1 つの小節に置けるマーカーは 1 つ。画面からは起きないアプリの不具合なので利用者向けのエラーコードを作らない）。
   */
  // <!-- req editingcore:a0291166.f698 -->
  constructor(target: EditTarget, barIndex: number, label: string) {
    // 作るときに確かめる。どちらの RangeError もアプリの不具合で起き、利用者向けのエラーコードを作らない（10 節の (b)）
    // <!-- req editingcore:5a1e92d4.e965 --> <!-- req editingcore:5a1e92d4.02db --> <!-- req editingcore:5a1e92d4.662e -->
    // <!-- req editingcore:5a1e92d4.da80 -->
    if (!Number.isInteger(barIndex) || barIndex < 0 || barIndex >= target.score.masterBars.length) {
      throw new RangeError(`section marker barIndex out of range: ${barIndex}`); // <!-- req editingcore:5a1e92d4.cdeb -->
    }
    // 1 つの小節に置けるマーカーは 1 つ（10 節、honnin-queue 114 番）
    // <!-- req editingcore:8b5fa80b.dd47 --> <!-- req editingcore:b841fbf5.d86a --> <!-- req editingcore:b841fbf5.0381 --> <!-- req editingcore:b841fbf5.d2df -->
    if (target.appMeta.sectionMarkers.some((m) => m.barId === barRef(barIndex))) {
      throw new RangeError(`bar ${barIndex} already has a section marker`); // <!-- req editingcore:b841fbf5.cf5c -->
    }
    this.score = target.score;
    this.markers = target.appMeta.sectionMarkers;
    this.barIndex = barIndex;
    this.created = { id: crypto.randomUUID(), barId: barRef(barIndex), label };
    // <!-- req editingcore:9a7d695e.6729 --> <!-- req editingcore:e40b338f.bb28 -->
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    this.markers.push(this.created);
    this.previousSection = mirrorSection(this.score, this.barIndex, this.created.label);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    const index = this.markers.indexOf(this.created);
    if (index < 0) return NO_ADVANCE;
    this.markers.splice(index, 1);
    getMasterBar(this.score, this.barIndex).section = this.previousSection;
    this.previousSection = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

// <!-- req editingcore:9a7d695e.5379 --> <!-- req editingcore:3d1d0efe.89a6 -->
// <!-- req editingcore:2508e008.18d1 -->
export class EditSectionMarkerCommand implements Command {
  readonly kind = 'edit-section-marker';
  readonly label = 'edit-section-marker';
  readonly affectedTrackIndices: readonly number[];
  private readonly score: model.Score;
  private readonly markers: SectionMarker[];
  private readonly markerId: string;
  private readonly nextLabel: string;
  private previous: { label: string; section: model.Section | null; barIndex: number } | null = null;

  /** @throws RangeError `markerId` のマーカーが無いとき（editing-core.md 10 節の (b)）。 */
  // <!-- req editingcore:1ef31866.81ec --> <!-- req editingcore:ba39997d.68bc -->
  constructor(target: EditTarget, markerId: string, nextLabel: string) {
    requireMarker(target.appMeta.sectionMarkers, markerId); // <!-- req editingcore:5a1e92d4.46a0 -->
    this.score = target.score;
    this.markers = target.appMeta.sectionMarkers;
    this.markerId = markerId;
    this.nextLabel = nextLabel;
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const marker = requireMarker(this.markers, this.markerId);
    const barIndex = Number(marker.barId);
    this.previous = { label: marker.label, section: getMasterBar(this.score, barIndex).section, barIndex };
    marker.label = this.nextLabel;
    mirrorSection(this.score, barIndex, this.nextLabel);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.previous !== null) {
      requireMarker(this.markers, this.markerId).label = this.previous.label;
      getMasterBar(this.score, this.previous.barIndex).section = this.previous.section;
    }
    this.previous = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

// <!-- req editingcore:9a7d695e.64f8 --> <!-- req editingcore:0f575a94.e538 -->
// <!-- req editingcore:2508e008.3c1a -->
export class DeleteSectionMarkerCommand implements Command {
  readonly kind = 'delete-section-marker';
  readonly label = 'delete-section-marker';
  readonly affectedTrackIndices: readonly number[];
  private readonly score: model.Score;
  private readonly markers: SectionMarker[];
  private readonly markerId: string;
  private removed: { marker: SectionMarker; index: number; section: model.Section | null; barIndex: number } | null =
    null;

  /** @throws RangeError `markerId` のマーカーが無いとき（editing-core.md 10 節の (b)）。 */
  // <!-- req editingcore:d8b160bf.ec6e --> <!-- req editingcore:ba39997d.5748 -->
  constructor(target: EditTarget, markerId: string) {
    requireMarker(target.appMeta.sectionMarkers, markerId); // <!-- req editingcore:5a1e92d4.2965 -->
    this.score = target.score;
    this.markers = target.appMeta.sectionMarkers;
    this.markerId = markerId;
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const marker = requireMarker(this.markers, this.markerId);
    const index = this.markers.indexOf(marker);
    const barIndex = Number(marker.barId);
    this.removed = { marker, index, section: getMasterBar(this.score, barIndex).section, barIndex };
    this.markers.splice(index, 1);
    getMasterBar(this.score, barIndex).section = null;
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.removed !== null) {
      this.markers.splice(this.removed.index, 0, this.removed.marker);
      getMasterBar(this.score, this.removed.barIndex).section = this.removed.section;
    }
    this.removed = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}
