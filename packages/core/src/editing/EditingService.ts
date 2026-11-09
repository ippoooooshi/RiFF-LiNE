/**
 * UI イベント → コマンド変換（editing-core.md 4.8 節・5 節）。
 *
 * `CursorController` の現在位置と UI 入力値から具象コマンドを組み立て、`ValidationService` で確かめ、
 * 通れば `CommandHistory.execute()`、拒むときは `NotificationReporter.report(code, context)` で知らせてコマンドを出さない
 * （例外を投げない。editing-core.md 5 節）。小節の音価の合計が拍子の長さを超えても短くても確かめず、今ある拍を捨てない（5 節）。
 * 音符か休符を置いた直後に、タイの候補（6 節）と奏法記号の候補（7.1 節）を求めて覚え、画面に読ませる。覚えた候補は、
 * 次に音を置く・カーソルを動かす（`CursorController.onChange`）・コマンドが当たる（`CommandHistory.onCommandApplied`）・
 * Esc（`dismissSuggestions`）で捨て、何も付けない。編集ウィンドウ（＝開いている曲）ごとに 1 インスタンス。
 */

import { ChordDetectionService } from './ChordDetectionService';
import { ClipboardService } from './ClipboardService';
import type { CommandHistory } from './commands/CommandHistory';
import { AddMemoCommand, DeleteMemoCommand, EditMemoCommand } from './commands/memoCommands';
import { PasteCommand } from './commands/PasteCommand';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { InsertRestCommand } from './commands/InsertRestCommand';
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
import { InsertBarCommand, DeleteBarCommand, type BarDeleteDisposition } from './commands/barCommands';
import type { CursorController } from './CursorController';
import { barCount, voiceBeats } from './scoreModel';
import { suggestTechniques, TECHNIQUE_SUGGEST_THRESHOLDS, type TechniqueSuggestion } from './techniqueSuggestion';
import { findTieCandidate } from './tieSuggestion';
import type { ValidationService } from './ValidationService';
import type { CommandOutcome, EditTarget, NoteRef, ValidationOutcome } from './types';

export type { TechniqueSuggestion } from './techniqueSuggestion';

/** `NotificationCenter.report` の最小要求。 */
export interface EditNotificationReporter {
  report(code: string, context?: Record<string, unknown>): void;
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

// <!-- req editingcore:818541f4.50e5 -->
export class EditingService {
  private readonly chordDetection = new ChordDetectionService();
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
    private readonly clipboard: ClipboardService = new ClipboardService(),
  ) {
    // 覚えた候補は、カーソルが動いたときと、どの窓口が出したコマンドでも当たったときに捨てる（editing-core.md 6 節・7.1 節。
    // 4.2 節の 2 桁のフレットの覚えと同じ知らせ）
    // <!-- req editingcore:dbeaa35e.44a4 --> <!-- req editingcore:dbeaa35e.9100 --> <!-- req editingcore:77240d55.8c53 -->
    cursor.onChange(() => this.dismissSuggestions());
    // <!-- req editingcore:dbeaa35e.4ca9 -->
    history.onCommandApplied(() => this.dismissSuggestions());
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
  // <!-- req editingcore:fb3290aa.add8 -->
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

  /** 現在の範囲選択へスラーを付与する。選択が無ければ何もしない。 */
  setSlur(): void {
    const range = this.cursor.selection;
    if (range === null) return;
    // <!-- req editingcore:c8eec0d8.8da4 --> <!-- req editingcore:c8eec0d8.d215 -->
    this.history.execute(new SetSlurCommand(this.target, range));
  }

  // <!-- req editingcore:0f9dc716.25fe --> <!-- req editingcore:0f9dc716.c469 --> <!-- req editingcore:757a18c3.32c9 --> <!-- req editingcore:757a18c3.9ea7 -->
  setTechnique(stringNumber: number, patch: NoteTechniquePatch): void {
    this.history.execute(new SetTechniqueCommand(this.target, this.cursor.position, stringNumber, patch));
  }

  setChordName(name: string | null): void {
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
   * @param disposition 関連メモ／マーカーの扱い（Critical ダイアログの結果、B2）。
   * 曲は最低 1 小節を保つ（唯一の小節、または範囲外 `at` の削除は無視する）。
   */
  deleteBar(at: number, disposition: BarDeleteDisposition): void {
    if (barCount(this.target.score) <= 1 || at < 0 || at >= barCount(this.target.score)) return;
    this.history.execute(new DeleteBarCommand(this.target, at, disposition));
  }

  // ===== コピー & ペースト =====

  /** 現在の範囲選択をクリップボードへコピーする。選択が無ければ何もしない。 */
  copySelection(): void {
    const range = this.cursor.selection;
    if (range === null) return;
    this.clipboard.copy(this.target, range);
  }

  /** クリップボード内容を現在位置へ貼り付ける（B3 の非対称ルールは PasteCommand が担う）。 */
  paste(): void {
    const snapshot = this.clipboard.getSnapshot();
    if (snapshot === null || snapshot.beats.length === 0) return;
    this.history.execute(new PasteCommand(this.target, this.cursor.position, snapshot, this.reporter));
  }

  // ===== Undo / Redo =====

  undo(): void {
    this.cursor.applyOutcome(this.history.undo(), this.target);
  }

  redo(): void {
    this.cursor.applyOutcome(this.history.redo(), this.target);
  }

  // ===== 読み取り（UI / コード表示用） =====

  /** 指定 Beat の表示コードネーム（override 優先、無ければ推定、推定不能なら null）。 */
  chordNameAt(barIndex: number, beatIndex: number): string | null {
    const position = this.cursor.position;
    // 2 つ目のボイスがまだ無い小節のボイス 2 は拍が 0 個のボイスと同じ（4.1 節）
    const beat = voiceBeats(this.target.score, position.trackIndex, barIndex, position.voiceIndex)[beatIndex];
    if (beat === undefined) return null;
    return this.chordDetection.resolveDisplayName(this.target.score, position.trackIndex, beat);
  }

  // ===== 内部 =====

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
