/**
 * Note / Beat 属性を書き換える単項コマンド群（editing-core.md §6.4、04_editing_core.md §5〜§7）。
 *
 * いずれも「execute で旧値を捕捉 → 新値を適用」「undo で捕捉した復元関数を呼ぶ」の一律パターンで
 * execute/undo の対称性を機械的に保証する（C2 対象）。
 *
 * alphaTab のフィールド対応（実装時確定、B13 の趣旨に沿って詳細設計へ反映する）：
 *  - タイ       : 継続音側 Note の `isTieDestination` ＋ `tieOrigin` / 直前 Note の `tieDestination`
 *  - スラー     : 範囲先頭 Note の `slurDestination` / 末尾 Note の `slurOrigin`・`isSlurDestination`
 *  - 奏法記号   : `SetTechniqueCommand` が受け取る patch のキーをそのまま Note フィールドへ設定
 *  - コード名   : `Beat.text`（テキスト表示のみ。要件によりダイアグラム不要、§7.4）
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { findNoteOnString, getBeat, getVoice, getBar } from '../scoreModel';
import type { Command, CommandOutcome, CursorPosition, EditTarget, SelectionRange } from '../types';

/**
 * 復元関数を保持して対称性を保証する基底。
 *
 * 属性変更は構造を変えないため `finishScore()` は呼ばない。alphaTab の `finish()` は「意図」フィールド
 * （`isTieDestination` / `slideOutType` 等）から派生リンク（`tieOrigin` へのフレットコピー・`slideTarget` 等）を
 * 生成するため、execute で finish すると undo で意図フィールドを戻しても派生リンクが残り非対称になる。
 * 派生リンクの再計算は `CommandHistory` が呼ぶ `ScoreRenderHost.render()`（内部で alphaTab が re-finish）に任せる。
 */
abstract class AttributeCommand implements Command {
  abstract readonly kind: string;
  abstract readonly label: string;
  readonly affectedTrackIndices: readonly number[];
  protected readonly score: model.Score;
  private restore: (() => void) | null = null;

  protected constructor(score: model.Score, trackIndices: number[]) {
    this.score = score;
    this.affectedTrackIndices = trackIndices;
  }

  /** 旧値を捕捉して新値を適用し、復元関数を返す。 */
  protected abstract apply(): () => void;

  execute(): CommandOutcome {
    this.restore = this.apply();
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

// ===== タイ =====

export class SetTieCommand extends AttributeCommand {
  readonly kind = 'set-tie';
  readonly label = 'タイ';
  private readonly position: CursorPosition;
  private readonly stringNumber: number;
  private readonly tied: boolean;

  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, tied: boolean) {
    super(target.score, [position.trackIndex]);
    this.position = position;
    this.stringNumber = stringNumber;
    this.tied = tied;
  }

  protected apply(): () => void {
    const voice = getVoice(getBar(this.score, this.position.trackIndex, this.position.barIndex));
    const beat = voice.beats[this.position.beatIndex];
    const note = beat ? findNoteOnString(beat, this.stringNumber) : null;
    if (beat === undefined || note === null) return () => undefined;

    // 直前 Beat は配列位置で引く（`beat.previousBeat` は finishScore 後のみ有効なため使わない）。
    const prevBeat = this.position.beatIndex > 0 ? voice.beats[this.position.beatIndex - 1] : undefined;
    const prevNote = prevBeat ? findNoteOnString(prevBeat, this.stringNumber) : null;
    const old = {
      fret: note.fret,
      isTieDestination: note.isTieDestination,
      tieOrigin: note.tieOrigin,
      prevTieDestination: prevNote?.tieDestination ?? null,
    };

    if (this.tied) {
      // タイ先としてマークするのは、リンクできる直前音がある場合のみ（宙吊りのタイ先を作らない）。
      if (prevNote !== null) {
        note.isTieDestination = true;
        note.tieOrigin = prevNote;
        prevNote.tieDestination = note;
      }
    } else {
      note.isTieDestination = false;
      note.tieOrigin = null;
      if (prevNote !== null && prevNote.tieDestination === note) prevNote.tieDestination = null;
    }

    return () => {
      note.fret = old.fret;
      note.isTieDestination = old.isTieDestination;
      note.tieOrigin = old.tieOrigin;
      if (prevNote !== null) prevNote.tieDestination = old.prevTieDestination;
    };
  }
}

// ===== スラー =====

export class SetSlurCommand extends AttributeCommand {
  readonly kind = 'set-slur';
  readonly label = 'スラー';
  private readonly range: SelectionRange;

  constructor(target: EditTarget, range: SelectionRange) {
    super(target.score, [range.trackIndex]);
    this.range = range;
  }

  protected apply(): () => void {
    const first = firstNoteOfBeat(
      getBeat(this.score, this.range.trackIndex, this.range.startBarIndex, this.range.startBeatIndex),
    );
    const last = firstNoteOfBeat(
      getBeat(this.score, this.range.trackIndex, this.range.endBarIndex, this.range.endBeatIndex),
    );
    if (first === null || last === null || first === last) return () => undefined;

    const old = {
      firstSlurDestination: first.slurDestination,
      lastSlurOrigin: last.slurOrigin,
      lastIsSlurDestination: last.isSlurDestination,
    };
    first.slurDestination = last;
    last.slurOrigin = first;
    last.isSlurDestination = true;

    return () => {
      first.slurDestination = old.firstSlurDestination;
      last.slurOrigin = old.lastSlurOrigin;
      last.isSlurDestination = old.lastIsSlurDestination;
    };
  }
}

// ===== 奏法記号 =====

/**
 * `SetTechniqueCommand` が受け取る部分更新。指定したキーだけを Note へ設定する（04_editing_core.md §6）。
 * 機械推定できるもの（スライド/ハンマリング/プリング）・手動指定のみのもの（ハーモニクス種別・ミュート等）を
 * 同一の patch 形状で扱う。
 */
export interface NoteTechniquePatch {
  slideOutType?: model.SlideOutType;
  slideInType?: model.SlideInType;
  isHammerPullOrigin?: boolean;
  harmonicType?: model.HarmonicType;
  harmonicValue?: number;
  isStaccato?: boolean;
  isPalmMute?: boolean;
  isLetRing?: boolean;
  isGhost?: boolean;
  vibrato?: model.VibratoType;
}

const TECHNIQUE_KEYS: readonly (keyof NoteTechniquePatch)[] = [
  'slideOutType',
  'slideInType',
  'isHammerPullOrigin',
  'harmonicType',
  'harmonicValue',
  'isStaccato',
  'isPalmMute',
  'isLetRing',
  'isGhost',
  'vibrato',
];

export class SetTechniqueCommand extends AttributeCommand {
  readonly kind = 'set-technique';
  readonly label = '奏法記号';
  private readonly position: CursorPosition;
  private readonly stringNumber: number;
  private readonly patch: NoteTechniquePatch;

  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, patch: NoteTechniquePatch) {
    super(target.score, [position.trackIndex]);
    this.position = position;
    this.stringNumber = stringNumber;
    this.patch = patch;
  }

  protected apply(): () => void {
    const beat = getBeat(this.score, this.position.trackIndex, this.position.barIndex, this.position.beatIndex);
    const note = findNoteOnString(beat, this.stringNumber);
    if (note === null) return () => undefined;

    const noteRecord = note as unknown as Record<string, unknown>;
    const old: Partial<Record<keyof NoteTechniquePatch, unknown>> = {};
    for (const key of TECHNIQUE_KEYS) {
      if (this.patch[key] === undefined) continue;
      old[key] = noteRecord[key];
      noteRecord[key] = this.patch[key];
    }

    return () => {
      for (const key of TECHNIQUE_KEYS) {
        if (key in old) noteRecord[key] = old[key];
      }
    };
  }
}

// ===== コード名（手動 override） =====

export class SetChordNameCommand extends AttributeCommand {
  readonly kind = 'set-chord-name';
  readonly label = 'コード名';
  private readonly position: CursorPosition;
  private readonly name: string | null;

  constructor(target: EditTarget, position: CursorPosition, name: string | null) {
    super(target.score, [position.trackIndex]);
    this.position = position;
    this.name = name;
  }

  protected apply(): () => void {
    const beat = getBeat(this.score, this.position.trackIndex, this.position.barIndex, this.position.beatIndex);
    const old = beat.text;
    beat.text = this.name;
    return () => {
      beat.text = old;
    };
  }
}

/** Beat 内の最初の Note（弦番号昇順で最初のもの）。 */
function firstNoteOfBeat(beat: model.Beat): model.Note | null {
  return beat.notes.length > 0 ? [...beat.notes].sort((a, b) => a.string - b.string)[0]! : null;
}
