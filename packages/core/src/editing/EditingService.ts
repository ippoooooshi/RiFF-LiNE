/**
 * UI イベント → コマンド変換（editing-core.md 4.8 節・5 節）。
 *
 * `CursorController` の現在位置と UI 入力値から具象コマンドを組み立て、`ValidationService` で確かめ、
 * 通れば `CommandHistory.execute()`、拒むときは `NotificationReporter.report(code, context)` で知らせてコマンドを出さない
 * （例外を投げない。editing-core.md 5 節）。小節の音価の合計が拍子の長さを超えても短くても確かめず、今ある拍を捨てない（5 節）。
 * 音符か休符を置いた直後に、タイの候補（6 節）と奏法記号の候補（7.1 節）を求めて覚え、画面に読ませる。覚えた候補は、
 * 次に音を置く・カーソルを動かす（`CursorController.onChange`）・コマンドが当たる（`CommandHistory.onCommandApplied`）・
 * Esc（`dismissSuggestions`）で捨て、何も付けない。編集ウィンドウ（＝開いている曲）ごとに 1 インスタンス。
 * 拍のコード名（editing-core.md 8 節）は、`chordNameAt` で初めて読んだときに `ChordDetectionService` で推し量って覚え、
 * コマンドが当たったら（`CommandHistory.onCommandApplied`）変わったパートの覚えを捨て、次に読むときに推し直す。
 * 覚えは曲のファイルに書かない。
 */

import { ChordDetectionService, chooseChordDisplayName, type ChordDetectionResult } from './ChordDetectionService';
import { ClipboardService, isNoteRef } from './ClipboardService';
import { CompositeCommand } from './CompositeCommand';
import type { CommandHistory } from './commands/CommandHistory';
import { DeleteNotesCommand } from './commands/DeleteNotesCommand';
import { collectRangeBeats, DeleteSelectionCommand } from './commands/DeleteSelectionCommand';
import { DuplicateSelectionCommand } from './commands/DuplicateSelectionCommand';
import { AddMemoCommand, barRef, DeleteMemoCommand, EditMemoCommand } from './commands/memoCommands';
import { PasteCommand } from './commands/PasteCommand';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { InsertRestCommand } from './commands/InsertRestCommand';
import { SetBeatDurationCommand } from './commands/SetBeatDurationCommand';
import { SetRepeatCommand, type RepeatPatch } from './commands/SetRepeatCommand';
import { SetTimeSignatureCommand, type TimeSignatureSpec } from './commands/SetTimeSignatureCommand';
import {
  SetChordNameCommand,
  SetSlurCommand,
  SetTechniqueCommand,
  SetTieCommand,
  type NoteTechniquePatch,
} from './commands/noteAttributeCommands';
import { isValidTempoBpm, SetTempoCommand } from './commands/SetTempoCommand';
import {
  AddSectionMarkerCommand,
  DeleteSectionMarkerCommand,
  EditSectionMarkerCommand,
} from './commands/sectionMarkerCommands';
import { InsertBarCommand, DeleteBarCommand } from './commands/barCommands';
import type { CursorController } from './CursorController';
import { barCount, findNoteOnString, voiceBeats } from './scoreModel';
import { suggestTechniques, TECHNIQUE_SUGGEST_THRESHOLDS, type TechniqueSuggestion } from './techniqueSuggestion';
import { findTieCandidate } from './tieSuggestion';
import type { ValidationService } from './ValidationService';
import type { BeatDurationSpec, CommandOutcome, CursorPosition, EditTarget, NoteRef, ValidationOutcome } from './types';

export type { TechniqueSuggestion } from './techniqueSuggestion';

/** `NotificationCenter.report` の最小要求。 */
export interface EditNotificationReporter {
  report(code: string, context?: Record<string, unknown>): void;
}

/**
 * 小節を消すときの、その小節のセクションマーカーと小節メモの扱い（editing-core.md 10 節）。
 * `'none'` は消す小節にマーカーもメモも無いとき、`'delete'` と `'move-to-previous'` は Critical のダイアログ（`EDIT-017`）の答え。
 */
// <!-- req editingcore:31c046c2.6b14 --> <!-- req editingcore:31c046c2.f0f0 --> <!-- req editingcore:31c046c2.8400 --> <!-- req editingcore:31c046c2.925d -->
export type BarDeleteDisposition = 'none' | 'delete' | 'move-to-previous';

/**
 * 消す小節にマーカーかメモがあるときに扱いを利用者に確かめる口（editing-core.md 10 節）。ダイアログを出し、答えを受け取る所は
 * `NotificationUIBinder`（screens-navigation.md 13.2 節）で、`EditingService` には外から渡す。
 */
// <!-- req editingcore:484a6f87.d504 -->
export interface BarDeleteConfirmer {
  /** Critical のダイアログ（EDIT-017）を出し、選ばれた答えを返す。ダイアログは応答するまで閉じない。 */
  // <!-- req editingcore:4bf5b889.0dae --> <!-- req editingcore:4bf5b889.3e40 --> <!-- req editingcore:4bf5b889.a03f --> <!-- req editingcore:4bf5b889.2a46 -->
  // <!-- req editingcore:4bf5b889.c8d2 -->
  confirm(context: {
    barIndex: number;
    markerCount: number;
    memoCount: number;
  }): Promise<'delete' | 'move-to-previous'>;
}

/** 対応する開始の無いリピートの終わり（Warning、知らせたうえで発行する。editing-core.md 10 節、基本設計 13 章 B39）。 */
const REPEAT_WITHOUT_START = 'EDIT-015';

/**
 * 右クリックの「切り取り」で消す側（editing-core.md 9 節）。`deleteNoteAt(at)`（4.5 節）と同じ消し方で、音符（`NoteRef`）ならその音符を、
 * 拍（`CursorPosition`）ならその拍が休符の拍のときだけ取り除く `DeleteNotesCommand` を作る。指した音符か休符の拍が無ければ null。
 * 音のある拍は `cutAt` に渡らない（音のある拍の空いた弦では「切り取り」を押せない、9 節の (b)）ので、渡されても何も消さない。
 */
// <!-- req editingcore:ed5d3ff1.6a1e --> <!-- req editingcore:1eab0cdf.e247 --> <!-- req editingcore:1eab0cdf.d516 -->
function deleteNotesCommandAt(target: EditTarget, at: NoteRef | CursorPosition): DeleteNotesCommand | null {
  const position = isNoteRef(at) ? at.position : at;
  const beat = voiceBeats(target.score, position.trackIndex, position.barIndex, position.voiceIndex)[
    position.beatIndex
  ];
  if (beat === undefined) return null;
  if (isNoteRef(at)) {
    // <!-- req editingcore:b39f8cf3.d823 -->
    // <!-- req editingcore:b39f8cf3.a31d -->
    return findNoteOnString(beat, at.stringNumber) === null ? null : new DeleteNotesCommand(target, [at], []);
  }
  // <!-- req editingcore:b39f8cf3.f8d1 -->
  // <!-- req editingcore:b39f8cf3.0ba8 -->
  // <!-- req editingcore:b39f8cf3.ec63 -->
  return beat.notes.length === 0 ? new DeleteNotesCommand(target, [], [at]) : null;
}

/**
 * 公開バレル（index.ts）が今も出している名前。しきい値の正は `TECHNIQUE_SUGGEST_THRESHOLDS`（editing-core.md 7.1 節、
 * techniqueSuggestion.ts）で、ここは同じ値を指すだけ。
 */
export const TECHNIQUE_MIN_FRET_DELTA = TECHNIQUE_SUGGEST_THRESHOLDS.minFretDelta;
export const TECHNIQUE_MAX_FRET_DELTA = TECHNIQUE_SUGGEST_THRESHOLDS.maxFretDelta;

const NO_TECHNIQUE_SUGGESTIONS: readonly TechniqueSuggestion[] = [];

/**
 * 小節を足す確かめが拒んだとき、知らせる context に足そうとした位置を足す（editing-core.md 5 節の表の EDIT-003 の行
 * 「確かめが返す `{ current, count, max }` に、呼ぶ所（`EditingService.insertBar`）が足そうとした位置
 * `{ trackIndex, barIndex }` を足したもの」）。`barIndex` は `at` を 0 から最後の小節までに寄せた値。通ったときはそのまま返す。
 */
// <!-- req editingcore:495325f3.a640 -->
function withBarInsertionPosition(
  outcome: ValidationOutcome,
  trackIndex: number,
  at: number,
  bars: number,
): ValidationOutcome {
  if (outcome.ok) return outcome;
  const barIndex = Math.min(Math.max(0, at), bars - 1);
  return { ...outcome, context: { ...outcome.context, trackIndex, barIndex } };
}

/**
 * 覚えた拍のコード名の 1 件（editing-core.md 8 節「推し量った候補は、拍のコード名の手での指定の欄と組で持つ」）。
 * 手での指定の欄（`Beat.text`）に値があっても、推し量った候補を持つ。出す名前は `chooseChordDisplayName` で組から選ぶ。
 */
interface RememberedChordName {
  /** 推し量った候補（当てはまる型が無ければ null）。 */
  readonly candidate: ChordDetectionResult | null;
  /** 手での指定の欄（`Beat.text`）の値（空なら null か空の文字列）。 */
  readonly manual: string | null;
}

/** コード名の覚えの、パートの中の拍の鍵（小節・ボイス・拍）。 */
function chordNameKey(barIndex: number, voiceIndex: number, beatIndex: number): string {
  return `${barIndex}:${voiceIndex}:${beatIndex}`;
}

// <!-- req editingcore:818541f4.50e5 -->
export class EditingService {
  /**
   * 覚えた拍のコード名（editing-core.md 8 節）。パートの番号 → 拍の鍵（`chordNameKey`）→ 推し量った候補と手での指定の欄の
   * 値の組。曲のファイルには書かず、この窓の中だけで持つ。
   */
  // <!-- req editingcore:a37c7c1f.df21 --> <!-- req editingcore:a37c7c1f.ca8d -->
  private readonly chordNames = new Map<number, Map<string, RememberedChordName>>();
  /** 覚えたタイの候補（タイでつなぐ前の音符、editing-core.md 6 節）。 */
  private tieSuggestion: NoteRef | null = null;
  /** 覚えた奏法記号の候補（0 から 2 件、editing-core.md 7.1 節）。 */
  private techniqueSuggestions: readonly TechniqueSuggestion[] = NO_TECHNIQUE_SUGGESTIONS;

  constructor(
    private readonly target: EditTarget,
    private readonly cursor: CursorController,
    private readonly validation: ValidationService,
    private readonly history: CommandHistory,
    private readonly reporter: EditNotificationReporter,
    /**
     * 範囲のコピーと貼り付けのクリップボード（editing-core.md 9 節）。外から渡し、編集ウィンドウ（＝この EditingService）ごとに 1 つ持つ。
     * 渡さなければ、この窓だけのものを作る。別の曲の編集ウィンドウへは貼れない（v1 は同じ曲の中だけ。そのための口は作らない）。
     */
    // <!-- req editingcore:aa765aff.ae30 --> <!-- req editingcore:aa765aff.1dd9 --> <!-- req editingcore:7f78c0f1.20e1 --> <!-- req editingcore:7f78c0f1.c4cc -->
    // <!-- req editingcore:7f78c0f1.efb8 --> <!-- req editingcore:aa765aff.17c9 -->
    private readonly clipboard: ClipboardService = new ClipboardService(),
    /**
     * 消す小節にマーカーかメモがあるときに扱いを確かめる口（editing-core.md 10 節）。外から渡す。渡していない窓で確かめが要る
     * 小節を消そうとしたら、アプリの組み立ての不具合として `deleteBar` の Promise を Error で落とす。
     */
    private readonly barDeleteConfirmer: BarDeleteConfirmer | null = null,
    /** コード名を推し量る部品（editing-core.md 8 節。覚えを持たない部品で、覚えるのはこのクラス）。 */
    // <!-- req editingcore:a37c7c1f.8fd0 -->
    private readonly chords: ChordDetectionService = new ChordDetectionService(),
  ) {
    // 覚えた候補は、カーソルが動いたときと、どの窓口が出したコマンドでも当たったときに捨てる（editing-core.md 6 節・7.1 節。
    // 4.2 節の 2 桁のフレットの覚えと同じ知らせ）
    // <!-- req editingcore:dbeaa35e.44a4 --> <!-- req editingcore:dbeaa35e.9100 --> <!-- req editingcore:77240d55.8c53 -->
    cursor.onChange(() => this.dismissSuggestions());
    // <!-- req editingcore:dbeaa35e.4ca9 -->
    history.onCommandApplied(() => this.dismissSuggestions());
    // 拍の音符を変えるコマンドがどれでも、変わったパートのコード名の覚えを古いまま残さない（editing-core.md 8 節）
    // <!-- req editingcore:3dd755cd.d1f8 --> <!-- req editingcore:3dd755cd.0216 --> <!-- req editingcore:a37c7c1f.0f4c --> <!-- req editingcore:a37c7c1f.29c4 -->
    // <!-- req editingcore:a37c7c1f.a787 -->
    history.onCommandApplied((event) => this.forgetChordNames(event.affectedTrackIndices));
  }

  // ===== ノート入力 =====

  /**
   * 現在のカーソル位置・入力音価で音符を配置する（editing-core.md 4.2 節）。
   * 和音入力モード中は同一 Beat への追加として扱い、カーソルは進めない（4.7 節）。
   * PlaceNoteCommand を実行する前に ValidationService で確かめ、拒むときは知らせてコマンドを出さない（5 節）。
   * 小節の音価の合計は確かめない（5 節）。置いた直後に、タイと奏法記号の候補を求めて覚える（6 節・7.1 節）。
   */
  // <!-- req editingcore:c7d1d266.4dc3 -->
  placeNote(stringNumber: number, fret: number): void {
    // 音を置く入力で、前の候補を閉じる（拒まれたときも。6 節・7.1 節）
    // <!-- req editingcore:dbeaa35e.0699 --> <!-- req editingcore:77240d55.7611 -->
    this.dismissSuggestions();
    const position = this.cursor.position;
    // <!-- req editingcore:60016c2f.bb9e --> <!-- req editingcore:0546f4aa.32c0 -->
    const outcome = this.runValidated(
      // <!-- req editingcore:60016c2f.2e83 --> <!-- req editingcore:a3715176.c103 --> <!-- req editingcore:68c8ea9f.60e3 -->
      this.validation.validateNotePlacement(this.target, position, stringNumber, fret),
      () =>
        this.history.execute(
          new PlaceNoteCommand(this.target, position, stringNumber, fret, this.cursor.currentDuration),
        ),
    );
    if (outcome === null) return;
    this.cursor.applyOutcome(outcome, this.target);
    // コマンドの知らせとカーソルの知らせで捨てた後に、置いた音符で求め直して覚える
    const placed: NoteRef = { position, stringNumber };
    // <!-- req editingcore:953e9552.acd0 --> <!-- req editingcore:dbeaa35e.d3c2 --> <!-- req editingcore:dbeaa35e.a007 -->
    this.tieSuggestion = findTieCandidate(this.target.score, placed);
    // <!-- req editingcore:b95656ed.7928 --> <!-- req editingcore:77240d55.56a1 --> <!-- req editingcore:77240d55.e739 --> <!-- req editingcore:77240d55.53bf -->
    this.techniqueSuggestions = suggestTechniques(this.target.score, placed);
  }

  /**
   * 現在位置へ明示的な休符を挿入し、カーソルを進める（editing-core.md 4.4 節）。
   * 置いた直後に、スタッカートの候補（前の短い音符に付ける）を求めて覚える（7.1 節）。
   */
  // <!-- req editingcore:3e714fd8.add8 -->
  // <!-- req editingcore:c7d1d266.367d -->
  insertRest(): void {
    this.dismissSuggestions();
    const position = this.cursor.position;
    const outcome = this.history.execute(new InsertRestCommand(this.target, position, this.cursor.currentDuration));
    this.cursor.applyOutcome(outcome, this.target);
    // 休符の拍には音符が無いので、弦は選んでいる弦を渡す（suggestTechniques は NoteRef を受ける形、7.1 節）
    // <!-- req editingcore:c7d1d266.6bc3 --> <!-- req editingcore:c7d1d266.6235 --> <!-- req editingcore:c7d1d266.a89c -->
    this.techniqueSuggestions = suggestTechniques(this.target.score, {
      position,
      stringNumber: this.cursor.currentString,
    });
  }

  // ===== 候補（editing-core.md 6 節・7.1 節） =====

  /** 覚えたタイの候補（タイでつなぐ前の音符）。無ければ null。 */
  // <!-- req editingcore:dbeaa35e.b0a4 -->
  tieCandidate(): NoteRef | null {
    return this.tieSuggestion;
  }

  /** 音符か休符を置いた直後に求めて覚えた奏法記号の候補（0 から 2 件）。示すだけで、自動では付けない。 */
  // <!-- req editingcore:c7d1d266.256a --> <!-- req editingcore:77240d55.32d4 -->
  suggestTechniques(): readonly TechniqueSuggestion[] {
    return this.techniqueSuggestions;
  }

  /** Esc：タイと奏法記号の候補を捨て、何も付けない。 */
  // <!-- req editingcore:dbeaa35e.4fc8 --> <!-- req editingcore:dbeaa35e.f8f7 --> <!-- req editingcore:0f9dc716.a9c6 --> <!-- req editingcore:77240d55.d805 --> <!-- req editingcore:77240d55.b410 -->
  dismissSuggestions(): void {
    this.tieSuggestion = null;
    this.techniqueSuggestions = NO_TECHNIQUE_SUGGESTIONS;
  }

  // ===== 記号・属性 =====

  /**
   * タイを付ける・外す（editing-core.md 6 節）。タイの候補があれば候補の前の音符の `tieToNext` を、
   * 無ければカーソルの拍の stringNumber の弦の音符の `tieToNext` を変える。
   */
  setTie(stringNumber: number, tied: boolean): void {
    const candidate = this.tieSuggestion;
    // <!-- req editingcore:6a216c80.8fb5 --> <!-- req editingcore:dbeaa35e.f21f --> <!-- req editingcore:dbeaa35e.49b5 -->
    const ref: NoteRef = candidate ?? { position: this.cursor.position, stringNumber };
    // <!-- req editingcore:6a216c80.5dbd --> <!-- req editingcore:6a216c80.4c44 -->
    this.history.execute(new SetTieCommand(this.target, ref.position, ref.stringNumber, tied));
  }

  /**
   * 現在の範囲選択へスラーを付与する（範囲の音符に共通の slurGroupId を付ける `SetSlurCommand`、editing-core.md 6 節・9 節）。
   * 範囲へのスラー付与は、範囲を決めた後にできることの一式に入る（9 節、honnin-queue 59 番）。選択が無ければ何もしない。
   */
  // <!-- req editingcore:ff927923.57c8 -->
  setSlur(): void {
    const range = this.cursor.selection;
    if (range === null) return;
    // <!-- req editingcore:c8eec0d8.8da4 --> <!-- req editingcore:c8eec0d8.d215 --> <!-- req editingcore:5c42de3d.718d -->
    this.history.execute(new SetSlurCommand(this.target, range));
  }

  /**
   * 音価を選ぶ（editing-core.md 4.3 節・4.7 節・9 節）。選択範囲があれば、範囲の音価のまとめ変更として、選んだ拍の音価・付点・連符を
   * まとめて変える：拍ごとに `SetBeatDurationCommand` を作り、`CompositeCommand` にまとめて 1 つの履歴の項目にする（B41）。
   * 発行の前に `validateBeatDuration` で確かめ、弾かれたら context に `{ trackIndex, barIndex }`（barIndex は範囲の最初の拍の小節）を
   * 入れて知らせ、コマンドを出さない（4.3 節）。範囲の音価のまとめ変更は、範囲を決めた後にできることの一式に入る（9 節、honnin-queue 59 番）。
   * 選択範囲が無いときは今の入力音価を変える（`CursorController.setDuration`）。和音の入力の途中なら確定する働き（4.7 節）はここに無い。
   */
  // <!-- req editingcore:ff927923.2272 -->
  setDuration(spec: BeatDurationSpec): void {
    const range = this.cursor.selection;
    if (range === null) {
      this.cursor.setDuration(spec);
      return;
    }
    const outcome = this.validation.validateBeatDuration(spec);
    if (!outcome.ok) {
      this.reporter.report(outcome.code, {
        ...outcome.context,
        trackIndex: range.trackIndex,
        barIndex: range.startBarIndex,
      });
      return;
    }
    // <!-- req editingcore:c881ad1c.1349 --> <!-- req editingcore:c881ad1c.0b65 --> <!-- req editingcore:c881ad1c.0510 --> <!-- req editingcore:c881ad1c.8e3c -->
    const children = collectRangeBeats(this.target.score, range).map(
      ({ barIndex, index }) =>
        new SetBeatDurationCommand(
          this.target,
          { trackIndex: range.trackIndex, barIndex, voiceIndex: range.voiceIndex, beatIndex: index },
          spec,
        ),
    );
    if (children.length === 0) return;
    // <!-- req editingcore:c881ad1c.cf9e -->
    this.history.execute(new CompositeCommand('set-beat-duration', 'set-beat-duration', children));
  }

  // <!-- req editingcore:0f9dc716.25fe --> <!-- req editingcore:0f9dc716.c469 --> <!-- req editingcore:757a18c3.32c9 --> <!-- req editingcore:757a18c3.9ea7 -->
  setTechnique(stringNumber: number, patch: NoteTechniquePatch): void {
    this.history.execute(new SetTechniqueCommand(this.target, this.cursor.position, stringNumber, patch));
  }

  /** 利用者が手で直したコード名を、カーソルの拍の `Beat.text` に入れる（editing-core.md 8 節。null で手の値を外す）。 */
  setChordName(name: string | null): void {
    // <!-- req editingcore:bf8bce48.bf04 --> <!-- req editingcore:bf8bce48.4abc -->
    this.history.execute(new SetChordNameCommand(this.target, this.cursor.position, name));
  }

  /** BPM を設定する。入力可能範囲（20〜400）外は発行しない（editing-core.md 3.8 節）。null で継承へ戻す。 */
  setTempo(bpm: number | null): void {
    if (bpm !== null && !isValidTempoBpm(bpm)) return;
    this.history.execute(new SetTempoCommand(this.target, this.cursor.position.barIndex, bpm));
  }

  // ===== メモ・セクションマーカー =====

  // <!-- req editingcore:efb4d6ab.492c -->
  addMemo(barIndex: number, text: string): void {
    // <!-- req editingcore:efb4d6ab.3df3 --> <!-- req editingcore:99a76868.32c9 --> <!-- req editingcore:99a76868.a9b2 -->
    // <!-- req editingcore:8392e1f9.3826 -->
    const { value, outcome } = this.validation.validateMemoText(text);
    // <!-- req editingcore:99a76868.0563 -->
    if (!outcome.ok) this.reporter.report(outcome.code, outcome.context);
    // <!-- req editingcore:efb4d6ab.8a75 --> <!-- req editingcore:99a76868.e5bd --> <!-- req editingcore:99a76868.b60f -->
    // <!-- req editingcore:8392e1f9.f7e8 -->
    this.history.execute(new AddMemoCommand(this.target, barIndex, value));
  }

  // <!-- req editingcore:efb4d6ab.c9a6 -->
  editMemo(memoId: string, text: string): void {
    // <!-- req editingcore:99a76868.a17c -->
    const { value, outcome } = this.validation.validateMemoText(text);
    if (!outcome.ok) this.reporter.report(outcome.code, outcome.context);
    // <!-- req editingcore:efb4d6ab.ec2f --> <!-- req editingcore:99a76868.8c98 -->
    this.history.execute(new EditMemoCommand(this.target, memoId, value));
  }

  deleteMemo(memoId: string): void {
    this.history.execute(new DeleteMemoCommand(this.target, memoId));
  }

  addSectionMarker(barIndex: number, label: string): void {
    this.history.execute(new AddSectionMarkerCommand(this.target, barIndex, label));
  }

  editSectionMarker(markerId: string, label: string): void {
    this.history.execute(new EditSectionMarkerCommand(this.target, markerId, label));
  }

  deleteSectionMarker(markerId: string): void {
    this.history.execute(new DeleteSectionMarkerCommand(this.target, markerId));
  }

  // ===== 小節 =====

  /**
   * 小節を `at` へ足す（editing-core.md 5 節の表の EDIT-003 の行）。確かめ（`validateBarInsertion`）が拒んだら、
   * 確かめが返す `{ current, count, max }` に、足そうとした位置 `{ trackIndex, barIndex }` を足して知らせる。
   * `trackIndex` は編集しているパート（カーソルのパート）、`barIndex` は `at`（小節の数より後ろなら最後の小節、
   * 0 より前なら最初の小節）で、画面はその小節を赤枠にする。
   */
  insertBar(at: number): void {
    // <!-- req editingcore:8ee56da1.f78b -->
    // <!-- req editingcore:495325f3.efa1 --> <!-- req editingcore:f63c202a.23bc -->
    const outcome = withBarInsertionPosition(
      this.validation.validateBarInsertion(this.target),
      this.cursor.position.trackIndex,
      at,
      barCount(this.target.score),
    );
    this.runValidated(outcome, () => this.history.execute(new InsertBarCommand(this.target, at)));
  }

  /**
   * 小節 `at` を消す（editing-core.md 10 節の流れ）。消す小節にマーカーもメモも無ければ、すぐ `DeleteBarCommand(at, 'none')` を発行する
   * （await の前に発行するので、返った時点で消えている）。どちらかがあれば、注入した `BarDeleteConfirmer.confirm` で Critical のダイアログ
   * （`EDIT-017`）を出し、選ばれた答え（'delete' か 'move-to-previous'）を `disposition` に渡して発行する。削除そのものを取りやめるのは、
   * 消した後の取り消し（Ctrl+Z）で行う（ダイアログは応答するまで閉じない）。
   * 曲は最低 1 小節を保つ（唯一の小節、または範囲外 `at` の削除は無視する）。
   */
  // <!-- req editingcore:8ee56da1.6ad1 -->
  // <!-- req editingcore:3b517865.4825 -->
  async deleteBar(at: number): Promise<void> {
    if (barCount(this.target.score) <= 1 || at < 0 || at >= barCount(this.target.score)) return;
    const ref = barRef(at);
    // <!-- req editingcore:0930c37d.1cc1 -->
    const markerCount = this.target.appMeta.sectionMarkers.filter((marker) => marker.barId === ref).length;
    // <!-- req editingcore:e642d2e9.b8b4 -->
    const memoCount = this.target.appMeta.memos.filter((memo) => memo.barId === ref).length;
    if (markerCount === 0 && memoCount === 0) {
      // <!-- req editingcore:1cbcaf96.ccce -->
      this.history.execute(new DeleteBarCommand(this.target, at, 'none'));
      return;
    }
    if (this.barDeleteConfirmer === null) throw new Error('BarDeleteConfirmer is not injected');
    // <!-- req editingcore:0930c37d.e7b6 --> <!-- req editingcore:e642d2e9.a351 --> <!-- req editingcore:1cbcaf96.fbc6 --> <!-- req editingcore:1cbcaf96.0461 -->
    const disposition = await this.barDeleteConfirmer.confirm({ barIndex: at, markerCount, memoCount });
    // <!-- req editingcore:1cbcaf96.b467 -->
    this.history.execute(new DeleteBarCommand(this.target, at, disposition));
  }

  /**
   * 既存の小節の拍子を変える（editing-core.md 10 節、G26 の是正）。null は継ぐ状態へ戻す。値のときは発行の前に
   * `validateTimeSignature`（`EDIT-010`）で確かめ、拒むときは知らせてコマンドを出さない（5 節）。
   */
  setTimeSignature(barIndex: number, signature: TimeSignatureSpec | null): void {
    // <!-- req editingcore:8ee56da1.56c3 --> <!-- req editingcore:0546f4aa.d682 -->
    // <!-- req editingcore:32a8af57.ac75 --> <!-- req editingcore:32a8af57.124d -->
    const outcome: ValidationOutcome =
      signature === null ? { ok: true } : this.validation.validateTimeSignature(signature);
    this.runValidated(outcome, () =>
      this.history.execute(new SetTimeSignatureCommand(this.target, barIndex, signature)),
    );
  }

  /**
   * リピートを付ける・外す（editing-core.md 10 節）。回数は `validateRepeat` で確かめ、範囲の外（`EDIT-011`）は知らせて拒み、
   * 対応する開始の無い終わり（`EDIT-015`）は知らせたうえで発行する（基本設計 13 章 B39）。
   */
  setRepeat(barIndex: number, patch: RepeatPatch): void {
    // <!-- req editingcore:13ef4f29.3c7e -->
    const outcome = this.validation.validateRepeat(this.target.score, barIndex, patch);
    if (!outcome.ok) {
      this.reporter.report(outcome.code, outcome.context);
      // <!-- req editingcore:13ef4f29.c514 -->
      if (outcome.code !== REPEAT_WITHOUT_START) return;
    }
    // <!-- req editingcore:13ef4f29.eaab -->
    this.history.execute(new SetRepeatCommand(this.target, barIndex, patch));
  }

  // ===== 範囲選択とクリップボード（editing-core.md 9 節） =====
  // 範囲（コピーと貼り付けのための範囲。1 つのパートの中だけ）を決めた後にできることは、次の一式で閉じ、ここにまとめる（9 節、honnin-queue 59 番）。
  //   - 範囲を決める口：CursorController の beginSelection（始まり）・extendSelection（終わり）・setSelection（範囲をまとめて決める）・
  //     clearSelection（範囲を外す）。選択モードの入切とハイライトは画面の受け持ち（screens-navigation.md 10 節）で、この口を呼んで範囲を決める。
  //   - コピー（copySelection）・切り取り（cutSelection）・貼り付け（paste）。
  //   - 削除：deleteNotes（Delete キー）・deleteNoteAt（右クリックのメニューの「削除」と消しゴム）が、選択範囲があれば
  //     deleteSelectionIfAny から DeleteSelectionCommand（ラベル 'delete-selection'）を出す。
  //   - 別の節が決めた範囲への操作 3 つ：複製 duplicateSelection・音価のまとめ変更 setDuration・スラー付与 setSlur。
  // この一式の外の操作は、選択範囲の機能として足さない。
  // <!-- req editingcore:8ee56da1.e346 --> <!-- req editingcore:8ee56da1.c648 -->
  // <!-- req editingcore:21a29679.1e31 --> <!-- req editingcore:ff927923.e5e4 --> <!-- req editingcore:ff927923.137d --> <!-- req editingcore:01c3a567.43a1 -->

  /** 現在の範囲選択をクリップボードへコピーする（右クリックのメニューの「コピー」）。選択が無ければ何もしない。 */
  // <!-- req editingcore:21a29679.0582 --> <!-- req editingcore:b118de0b.f65c -->
  copySelection(): void {
    const range = this.cursor.selection;
    if (range === null) return;
    this.clipboard.copy(this.target, range);
  }

  /**
   * 現在の範囲選択を切り取る（右クリックのメニューの「切り取り」、editing-core.md 9 節）。コピーと同じ中身をクリップボードへ置き
   * （コマンドにしない）、そのうえで範囲の拍と音符を消す側だけを `DeleteSelectionCommand`（ラベル 'cut'）として履歴に積む。
   * 取り消しで元に戻せる。選択が無ければ何もしない。
   */
  // <!-- req editingcore:21a29679.7d19 --> <!-- req editingcore:f095e116.7a1e -->
  cutSelection(): void {
    const range = this.cursor.selection;
    if (range === null) return;
    // <!-- req editingcore:3cdcd643.b23d -->
    this.clipboard.copy(this.target, range);
    // <!-- req editingcore:92227fca.2f4f -->
    this.history.execute(new DeleteSelectionCommand(this.target, range, 'cut'));
  }

  /**
   * 選択範囲が無いときの右クリックの「コピー」（editing-core.md 9 節）。右クリックした音符 1 つか休符の拍 1 つを、1 拍の形で
   * `ClipboardService.copyAt` でクリップボードへ写す。
   */
  // <!-- req editingcore:60ed4fb0.0725 -->
  copyAt(at: NoteRef | CursorPosition): void {
    this.clipboard.copyAt(this.target, at);
  }

  /**
   * 選択範囲が無いときの右クリックの「切り取り」（editing-core.md 9 節）。`copyAt(at)` と同じ中身をクリップボードへ置いたうえで、
   * 右クリックした音符か休符の拍を `deleteNoteAt(at)`（4.5 節）と同じ消し方で消す。消す側だけを `DeleteNotesCommand` として履歴に積み、
   * 取り消しで元に戻る。
   */
  // <!-- req editingcore:ed5d3ff1.065e -->
  cutAt(at: NoteRef | CursorPosition): void {
    // <!-- req editingcore:ed5d3ff1.bb59 -->
    this.copyAt(at);
    const command = deleteNotesCommandAt(this.target, at);
    // <!-- req editingcore:ed5d3ff1.07e0 --> <!-- req editingcore:ed5d3ff1.f504 -->
    if (command !== null) this.history.execute(command);
  }

  /**
   * クリップボードの拍を、カーソルの位置（カーソルを動かした先。コピーした元と別のパートでもよい）へ挿入して貼り付ける
   * （B3 の弦の数の決まりは PasteCommand が担う）。クリップボードが空なら何もしない。
   */
  // <!-- req editingcore:21a29679.e69c --> <!-- req editingcore:2ae28f18.a74b --> <!-- req editingcore:2ae28f18.8e57 -->
  paste(): void {
    const snapshot = this.clipboard.getSnapshot();
    if (snapshot === null || snapshot.beats.length === 0) return;
    this.history.execute(new PasteCommand(this.target, this.cursor.position, snapshot, this.reporter));
  }

  /**
   * Ctrl+D の複製（editing-core.md 9 節、基本設計 03 章 7 節）。範囲の拍の写しを、範囲の終わりの拍のすぐ後ろ（同じ小節の中）に挿入する
   * `DuplicateSelectionCommand` を発行する。クリップボードは変えない。範囲が無いときは何もしない。範囲の複製は、範囲を決めた後に
   * できることの一式に入る（honnin-queue 59 番）。
   */
  // <!-- req editingcore:ff927923.b58b --> <!-- req editingcore:7bb0a980.af91 -->
  duplicateSelection(): void {
    const range = this.cursor.selection;
    // <!-- req editingcore:7bb0a980.4142 -->
    if (range === null) return;
    // <!-- req editingcore:7bb0a980.c17c -->
    this.history.execute(new DuplicateSelectionCommand(this.target, range));
  }

  // ===== 音符と休符を消す・範囲の削除（editing-core.md 4.5 節・9 節） =====

  /**
   * Delete キー・Backspace キー・編集メニューの「削除」（editing-core.md 4.5 節）。選択範囲があれば、その範囲を 9 節の
   * `DeleteSelectionCommand`（ラベル 'delete-selection'）で消す（範囲を決めた後にできることの一式の「削除」）。クリップボードは変えない。
   * 無ければカーソルの拍の選んでいる弦の音符を、カーソルの拍が休符の拍ならその拍を `restBeats` に渡して、`DeleteNotesCommand` で消す。
   * 消すものが無ければ何もしない。どちらも履歴に積み、取り消しで元に戻る。
   */
  // <!-- req editingcore:a9c10fd0.5d32 -->
  // <!-- req editingcore:a9c10fd0.ab4c -->
  // <!-- req editingcore:a9c10fd0.9d01 -->
  // <!-- req editingcore:b39f8cf3.61d9 -->
  // <!-- req editingcore:b39f8cf3.888d -->
  // <!-- req editingcore:b39f8cf3.e742 -->
  // <!-- req editingcore:b39f8cf3.9bc6 -->
  deleteNotes(): void {
    if (this.deleteSelectionIfAny()) return;
    const position = this.cursor.position;
    const beat = voiceBeats(this.target.score, position.trackIndex, position.barIndex, position.voiceIndex)[
      position.beatIndex
    ];
    if (beat === undefined) return;
    if (beat.notes.length === 0) {
      // <!-- req editingcore:b39f8cf3.41cc -->
      this.history.execute(new DeleteNotesCommand(this.target, [], [position]));
      return;
    }
    const stringNumber = this.cursor.currentString;
    if (findNoteOnString(beat, stringNumber) === null) return;
    // <!-- req editingcore:b39f8cf3.befb -->
    this.history.execute(new DeleteNotesCommand(this.target, [{ position, stringNumber }], []));
  }

  /**
   * 右クリックのメニューの「削除」と消しゴムモードのクリック（editing-core.md 4.5 節）。選択範囲があれば、どの入口も 9 節の
   * `DeleteSelectionCommand`（ラベル 'delete-selection'）でその範囲を消す。無ければ、音符（`NoteRef`）ならその音符を、拍（`CursorPosition`）なら
   * その拍が休符の拍のときだけ取り除く `DeleteNotesCommand` を出す。音のある拍を渡されたときは何もしない（4.5 節）。
   */
  // <!-- req editingcore:b39f8cf3.e51f -->
  // <!-- req editingcore:21a29679.5bdb -->
  // <!-- req editingcore:19d583f7.b90b -->
  deleteNoteAt(at: NoteRef | CursorPosition): void {
    if (this.deleteSelectionIfAny()) return;
    const command = deleteNotesCommandAt(this.target, at);
    if (command !== null) this.history.execute(command);
  }

  // ===== Undo / Redo =====

  undo(): void {
    this.cursor.applyOutcome(this.history.undo(), this.target);
  }

  redo(): void {
    this.cursor.applyOutcome(this.history.redo(), this.target);
  }

  // ===== 読み取り（UI / コード表示用） =====

  /**
   * カーソルのパートとボイスの、指定した拍の出すコード名（editing-core.md 8 節。手で入れた値があればそれ、無ければ推し量った
   * 名前、どちらも無ければ null）。覚え（推し量った候補と手での指定の欄の値の組）が無ければ、手での指定の欄に値があっても
   * `ChordDetectionService.detect` で推し量り、組にして覚える。出す名前は `chooseChordDisplayName`（`resolveDisplayName` と
   * 同じ選び方）で組から選ぶ。
   */
  // <!-- req editingcore:a37c7c1f.dba9 -->
  chordNameAt(barIndex: number, beatIndex: number): string | null {
    const { trackIndex, voiceIndex } = this.cursor.position;
    // 2 つ目のボイスがまだ無い小節のボイス 2 は拍が 0 個のボイスと同じ（4.1 節）
    const beat = voiceBeats(this.target.score, trackIndex, barIndex, voiceIndex)[beatIndex];
    if (beat === undefined) return null;
    let names = this.chordNames.get(trackIndex);
    if (names === undefined) {
      names = new Map();
      this.chordNames.set(trackIndex, names);
    }
    const key = chordNameKey(barIndex, voiceIndex, beatIndex);
    let remembered = names.get(key);
    if (remembered === undefined) {
      // <!-- req editingcore:1001cdcd.a439 --> <!-- req editingcore:1001cdcd.98b3 -->
      remembered = { candidate: this.chords.detect(this.target.score, trackIndex, beat), manual: beat.text };
      names.set(key, remembered);
    }
    return chooseChordDisplayName(remembered.manual, remembered.candidate);
  }

  // ===== 内部 =====

  /**
   * 選択範囲があれば、範囲の削除（editing-core.md 9 節）として `DeleteSelectionCommand`（ラベル 'delete-selection'）を履歴に積み、真を返す。
   * 選択範囲の削除はクリップボードを変えない。無ければ何もせず偽を返す（4.5 節「選択範囲が無いときは…DeleteNotesCommand」）。
   */
  // <!-- req editingcore:a9c10fd0.8c77 -->
  private deleteSelectionIfAny(): boolean {
    const range = this.cursor.selection;
    if (range === null) return false;
    // <!-- req editingcore:92227fca.55ae -->
    // <!-- req editingcore:b39f8cf3.627d -->
    this.history.execute(new DeleteSelectionCommand(this.target, range, 'delete-selection'));
    return true;
  }

  /** 変わったパートのコード名の覚えを捨てる（editing-core.md 8 節。次に読むときに推し直す）。 */
  private forgetChordNames(trackIndices: readonly number[]): void {
    for (const trackIndex of trackIndices) this.chordNames.delete(trackIndex);
  }

  /**
   * 検証 OK なら `action` を実行してその戻り値を返す。NG なら `report` して null を返す。
   */
  // <!-- req editingcore:97ec3132.8293 -->
  private runValidated(outcome: ValidationOutcome, action: () => CommandOutcome): CommandOutcome | null {
    if (!outcome.ok) {
      // <!-- req editingcore:97ec3132.3e0c -->
      this.reporter.report(outcome.code, outcome.context);
      // <!-- req editingcore:97ec3132.f7c2 -->
      return null;
    }
    return action();
  }
}
