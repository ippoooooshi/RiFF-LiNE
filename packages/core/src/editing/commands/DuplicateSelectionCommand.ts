/**
 * 選択範囲の写しを後ろに挿入する（Ctrl+D の複製、editing-core.md 2.6 節の表・9 節、基本設計 03 章 7 節）。
 *
 * 範囲の拍の写しを、範囲の終わりの拍のすぐ後ろ（同じ小節の中）に挿入する。写しの後ろの拍は写しの分だけ後ろへずれ、
 * 次の小節へは送らない（挿入で小節の合計が拍子を超えても拒まない、5 節）。クリップボードは変えない。同じパートの中の写しなので、
 * 弦の数は確かめない。`undo` は挿入した拍を外す。範囲が無いときに何もしないのは、発行する `EditingService` の側。
 *
 * 写すのは、クリップボードと同じく（9 節の (b)）、拍の音価（音符の長さ・付点・連符）と Beat の単位の奏法記号（`BeatTechniquePatch` の項目）と、
 * 音符の弦とフレットと Note の奏法記号（`NoteTechniquePatch` の項目）とする。タイとスラーの印は写さない（範囲の外の音符とつながる印を写すと、
 * 写した先でつながる相手がいないため）。足した拍から `Voice` への逆参照は `insertBeatAt` で張る（2.4 節）。
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { captureDurationFields, insertBeatAt, removeBeat, restoreDurationFields } from '../scoreModel';
import type { CommandOutcome, EditTarget, SelectionRange } from '../types';
import type { Command } from './Command';
import { collectRangeBeats } from './DeleteSelectionCommand';
import type { BeatTechniquePatch, NoteTechniquePatch } from './noteAttributeCommands';

/** 写した拍と音符 1 つあたりの推定の大きさ（バイト、editing-core.md 2.3 節の予算の見積もり）。 */
const HELD_ITEM_BYTES = 64;

/**
 * 写す Note の奏法記号の項目。`NoteTechniquePatch` のキーを 1 つずつ全部挙げる（キーが足されたら型の検査で落ちる）。
 * bendPoints は中身を写すので、値をそのまま入れるキーから外す。
 */
const NOTE_TECHNIQUE_KEYS = {
  slideOutType: true,
  slideInType: true,
  isHammerPullOrigin: true,
  harmonicType: true,
  harmonicValue: true,
  isPalmMute: true,
  vibrato: true,
  isGhost: true,
  isStaccato: true,
  accentuated: true,
  bendType: true,
  bendPoints: false,
} as const satisfies Record<keyof NoteTechniquePatch, boolean>;

/** 写す Beat の奏法記号の項目。`BeatTechniquePatch` のキーを全部挙げる。 */
const BEAT_TECHNIQUE_KEYS = {
  slap: true,
  pop: true,
  tap: true,
  brushType: true,
} as const satisfies Record<keyof BeatTechniquePatch, true>;

/** 項目の名前で値を写す（alphaTab の Note と Beat の同じ名前の項目へ）。 */
function copyFields(source: object, destination: object, keys: Record<string, boolean>): void {
  const from = source as Record<string, unknown>;
  const to = destination as Record<string, unknown>;
  for (const [key, copy] of Object.entries(keys)) if (copy) to[key] = from[key];
}

/** 拍の写しを作る（音価・Beat の奏法記号・音符の弦とフレットと Note の奏法記号）。 */
function copyBeat(source: model.Beat): model.Beat {
  const beat = new model.Beat();
  restoreDurationFields(beat, captureDurationFields(source));
  copyFields(source, beat, BEAT_TECHNIQUE_KEYS);
  for (const sourceNote of source.notes) {
    const note = new model.Note();
    note.string = sourceNote.string;
    note.fret = sourceNote.fret;
    copyFields(sourceNote, note, NOTE_TECHNIQUE_KEYS);
    // bendPoints は Note.addBendPoint で入れる（描画が読む maxBendPoint は addBendPoint だけが入れる）。addBendPoint が変える bendType は写した値に戻す
    for (const point of sourceNote.bendPoints ?? []) note.addBendPoint(new model.BendPoint(point.offset, point.value));
    note.bendType = sourceNote.bendType;
    beat.addNote(note);
  }
  return beat;
}

// <!-- req editingcore:2fce8a97.a908 --> <!-- req editingcore:290c7ca4.de9d --> <!-- req editingcore:7bb0a980.af91 --> <!-- req editingcore:676bb618.ca32 -->
export class DuplicateSelectionCommand implements Command {
  readonly kind = 'duplicate-selection';
  readonly label = 'duplicate-selection';
  /** 範囲のパートだけ（`[range.trackIndex]`、2.6 節の表）。 */
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly range: SelectionRange;
  private inserted: { voice: model.Voice; beats: model.Beat[] } | null = null;

  // <!-- req editingcore:d1cad41b~1.03af -->
  constructor(target: EditTarget, range: SelectionRange) {
    this.score = target.score;
    this.range = range;
    // <!-- req editingcore:2fce8a97.d372 -->
    this.affectedTrackIndices = [range.trackIndex];
  }

  execute(): CommandOutcome {
    const sources = collectRangeBeats(this.score, this.range);
    const last = sources[sources.length - 1];
    if (last === undefined) return { cursorAdvance: 'none' };
    // 範囲の終わりの拍のすぐ後ろ（同じ小節の中）に、範囲の順に挿入する
    const copies = sources.map((s) => copyBeat(s.beat));
    // 写しの後ろの拍は写しの分だけ後ろへずれ、次の小節へは送らない（合計が拍子を超えても拒まない、5 節）
    // <!-- req editingcore:2fce8a97.9b05 --> <!-- req editingcore:7bb0a980.ff34 --> <!-- req editingcore:7bb0a980.d7e8 --> <!-- req editingcore:676bb618.a419 -->
    // <!-- req editingcore:676bb618.ca41 --> <!-- req editingcore:676bb618.00a6 -->
    copies.forEach((beat, offset) => insertBeatAt(last.voice, last.index + 1 + offset, beat));
    this.inserted = { voice: last.voice, beats: copies };
    return { cursorAdvance: 'none' };
  }

  undo(): CommandOutcome {
    if (this.inserted !== null) {
      const { voice, beats } = this.inserted;
      for (const beat of beats) removeBeat(voice, beat);
    }
    this.inserted = null;
    return { cursorAdvance: 'none' };
  }

  /** 写した拍と音符の数に比例させる（2.3 節：変更の差分だけを持つ）。 */
  estimateSizeBytes(): number {
    const items = (this.inserted?.beats ?? []).reduce((sum, beat) => sum + 1 + beat.notes.length, 0);
    return BASE_COMMAND_BYTES + items * HELD_ITEM_BYTES;
  }
}
