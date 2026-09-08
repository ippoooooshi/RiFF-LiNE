/**
 * セクションマーカーの追加・編集・削除（editing-core.md §6.4、02_data_model.md §3.5）。
 *
 * マーカーは `AppMetadata.sectionMarkers` に保持しつつ、譜面上インライン表示のため alphaTab の
 * `MasterBar.section` にもミラーする（§6.4「譜面上に直接描画されるため再描画が必要」）。
 * `affectedTrackIndices` は全パート（Bar は全パート共通構造）。
 */

import { model } from '@coderline/alphatab';

import type { SectionMarker } from '../../domain/types';
import { BASE_COMMAND_BYTES } from '../commandBase';
import { allTrackIndices, getMasterBar } from '../scoreModel';
import type { Command, CommandOutcome, EditTarget } from '../types';

import { barRef } from './memoCommands';

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

/** alphaTab `MasterBar.section` を label で設定 or クリアし、旧 section を返す（undo 用）。 */
function mirrorSection(score: model.Score, barIndex: number, label: string | null): model.Section | null {
  const masterBar = getMasterBar(score, barIndex);
  const old = masterBar.section;
  if (label === null) {
    masterBar.section = null;
  } else {
    const section = new model.Section();
    section.text = label;
    masterBar.section = section;
  }
  return old;
}

export class AddSectionMarkerCommand implements Command {
  readonly kind = 'add-section-marker';
  readonly label = 'セクションを追加';
  readonly affectedTrackIndices: readonly number[];
  private readonly score: model.Score;
  private readonly markers: SectionMarker[];
  private readonly barIndex: number;
  private readonly created: SectionMarker;
  private previousSection: model.Section | null = null;

  constructor(target: EditTarget, barIndex: number, label: string) {
    this.score = target.score;
    this.markers = target.appMeta.sectionMarkers;
    this.barIndex = barIndex;
    this.created = { id: crypto.randomUUID(), barId: barRef(barIndex), label };
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    this.markers.push(this.created);
    this.previousSection = mirrorSection(this.score, this.barIndex, this.created.label);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    const index = this.markers.indexOf(this.created);
    if (index >= 0) this.markers.splice(index, 1);
    getMasterBar(this.score, this.barIndex).section = this.previousSection;
    this.previousSection = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

export class EditSectionMarkerCommand implements Command {
  readonly kind = 'edit-section-marker';
  readonly label = 'セクション名を編集';
  readonly affectedTrackIndices: readonly number[];
  private readonly score: model.Score;
  private readonly markers: SectionMarker[];
  private readonly markerId: string;
  private readonly nextLabel: string;
  private previous: { label: string; section: model.Section | null; barIndex: number } | null = null;

  constructor(target: EditTarget, markerId: string, nextLabel: string) {
    this.score = target.score;
    this.markers = target.appMeta.sectionMarkers;
    this.markerId = markerId;
    this.nextLabel = nextLabel;
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const marker = this.markers.find((m) => m.id === this.markerId);
    if (marker === undefined) return NO_ADVANCE;
    const barIndex = Number(marker.barId);
    this.previous = { label: marker.label, section: getMasterBar(this.score, barIndex).section, barIndex };
    marker.label = this.nextLabel;
    mirrorSection(this.score, barIndex, this.nextLabel);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    const marker = this.markers.find((m) => m.id === this.markerId);
    if (marker !== undefined && this.previous !== null) {
      marker.label = this.previous.label;
      getMasterBar(this.score, this.previous.barIndex).section = this.previous.section;
    }
    this.previous = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

export class DeleteSectionMarkerCommand implements Command {
  readonly kind = 'delete-section-marker';
  readonly label = 'セクションを削除';
  readonly affectedTrackIndices: readonly number[];
  private readonly score: model.Score;
  private readonly markers: SectionMarker[];
  private readonly markerId: string;
  private removed: { marker: SectionMarker; index: number; section: model.Section | null; barIndex: number } | null =
    null;

  constructor(target: EditTarget, markerId: string) {
    this.score = target.score;
    this.markers = target.appMeta.sectionMarkers;
    this.markerId = markerId;
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const index = this.markers.findIndex((m) => m.id === this.markerId);
    if (index < 0) return NO_ADVANCE;
    const marker = this.markers[index]!;
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
