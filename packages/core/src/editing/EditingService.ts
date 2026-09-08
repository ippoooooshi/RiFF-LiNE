/**
 * UI イベント → コマンド変換（editing-core.md §5、04_editing_core.md §1）。
 *
 * `CursorController` の現在位置と UI 入力値から具象コマンドを組み立て、`ValidationService` で検証し、
 * OK なら `CommandHistory.execute()`、NG なら `NotificationCenter.report()` する。UI コンポーネント自体は
 * パッケージ8。編集ウィンドウ（＝開いている曲）ごとに 1 インスタンス。
 */

import { ChordDetectionService } from './ChordDetectionService';
import { ClipboardService } from './ClipboardService';
import type { CommandHistory } from './CommandHistory';
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
import { barCount, findNoteOnString, getVoice, getBar } from './scoreModel';
import type { ValidationService } from './ValidationService';
import type { CommandOutcome, EditTarget, ValidationOutcome } from './types';

/** `NotificationCenter.report` の最小要求。 */
export interface EditNotificationReporter {
  report(code: string, context?: Record<string, unknown>): void;
}

/** B4 の自動候補（editing-core.md §10.5、04_editing_core.md §6.1）。 */
export interface TechniqueSuggestion {
  /** `'slide' | 'hammer' | 'pull'`。 */
  kind: 'slide' | 'hammer' | 'pull';
  patch: NoteTechniquePatch;
}

/** B4 のしきい値（実装時に微調整可能な定数、04_editing_core.md §6.1）。 */
export const TECHNIQUE_MIN_FRET_DELTA = 1;
export const TECHNIQUE_MAX_FRET_DELTA = 4;

export class EditingService {
  private readonly chordDetection = new ChordDetectionService();

  constructor(
    private readonly target: EditTarget,
    private readonly cursor: CursorController,
    private readonly validation: ValidationService,
    private readonly history: CommandHistory,
    private readonly reporter: EditNotificationReporter,
    private readonly clipboard: ClipboardService = new ClipboardService(),
  ) {}

  // ===== ノート入力 =====

  /**
   * 現在のカーソル位置・入力音価で音符を配置する（04_editing_core.md §2・§3）。
   * 和音入力モード中は同一 Beat への追加として扱い、カーソルは進めない。
   */
  placeNote(stringNumber: number, fret: number): void {
    const position = this.cursor.position;
    const outcome = this.runValidated(
      this.validation.validateNotePlacement(this.target, position, stringNumber, fret),
      () =>
        this.history.execute(
          new PlaceNoteCommand(this.target, position, stringNumber, fret, this.cursor.currentDuration),
        ),
    );
    if (outcome !== null) this.cursor.applyOutcome(outcome);
  }

  /** 現在位置へ明示的な休符を挿入し、カーソルを進める。 */
  insertRest(): void {
    const outcome = this.history.execute(
      new InsertRestCommand(this.target, this.cursor.position, this.cursor.currentDuration),
    );
    this.cursor.applyOutcome(outcome);
  }

  // ===== 記号・属性 =====

  setTie(stringNumber: number, tied: boolean): void {
    this.history.execute(new SetTieCommand(this.target, this.cursor.position, stringNumber, tied));
  }

  /** 現在の範囲選択へスラーを付与する。選択が無ければ何もしない。 */
  setSlur(): void {
    const range = this.cursor.selection;
    if (range === null) return;
    this.history.execute(new SetSlurCommand(this.target, range));
  }

  setTechnique(stringNumber: number, patch: NoteTechniquePatch): void {
    this.history.execute(new SetTechniqueCommand(this.target, this.cursor.position, stringNumber, patch));
  }

  setChordName(name: string | null): void {
    this.history.execute(new SetChordNameCommand(this.target, this.cursor.position, name));
  }

  /** BPM を設定する。入力可能範囲（20〜400）外は発行しない（§6.4）。null で継承へ戻す。 */
  setTempo(bpm: number | null): void {
    if (bpm !== null && !isValidTempoBpm(bpm)) return;
    this.history.execute(new SetTempoCommand(this.target, this.cursor.position.barIndex, bpm));
  }

  // ===== メモ・セクションマーカー =====

  addMemo(barIndex: number, text: string): void {
    const { value, outcome } = this.validation.validateMemoText(text);
    if (!outcome.ok) this.reporter.report(outcome.code, outcome.context);
    this.history.execute(new AddMemoCommand(this.target, barIndex, value));
  }

  editMemo(memoId: string, text: string): void {
    const { value, outcome } = this.validation.validateMemoText(text);
    if (!outcome.ok) this.reporter.report(outcome.code, outcome.context);
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

  insertBar(at: number): void {
    this.runValidated(this.validation.validateBarInsertion(this.target), () =>
      this.history.execute(new InsertBarCommand(this.target, at)),
    );
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
    this.cursor.applyOutcome(this.history.undo());
  }

  redo(): void {
    this.cursor.applyOutcome(this.history.redo());
  }

  // ===== 読み取り（UI / コード表示用） =====

  /** 指定 Beat の表示コードネーム（override 優先、無ければ推定、推定不能なら null）。 */
  chordNameAt(barIndex: number, beatIndex: number): string | null {
    const position = this.cursor.position;
    const voice = getVoice(getBar(this.target.score, position.trackIndex, barIndex));
    const beat = voice.beats[beatIndex];
    if (beat === undefined) return null;
    return this.chordDetection.resolveDisplayName(this.target.score, position.trackIndex, beat);
  }

  /**
   * 直前 Beat の同一弦との関係から奏法記号の自動候補を返す（B4）。
   * 条件：直前 Beat（同一 Voice 内で 1 つ前）に同一弦の音があり、フレット差が 1〜4。範囲外・無音は null。
   */
  suggestTechnique(stringNumber: number, fret: number): TechniqueSuggestion | null {
    const position = this.cursor.position;
    if (position.beatIndex <= 0) return null;
    const voice = getVoice(getBar(this.target.score, position.trackIndex, position.barIndex));
    const prevBeat = voice.beats[position.beatIndex - 1];
    const prevNote = prevBeat ? findNoteOnString(prevBeat, stringNumber) : null;
    if (prevNote === null) return null;

    const delta = fret - prevNote.fret;
    const absDelta = Math.abs(delta);
    if (absDelta < TECHNIQUE_MIN_FRET_DELTA || absDelta > TECHNIQUE_MAX_FRET_DELTA) return null;

    // フレットが上がる＝ハンマリング、下がる＝プリングを既定候補にする（04_editing_core.md §6.1）。
    // スライドは「どちらの向きでも起こりうる」ため、UI 側で hammer/pull と並べて提示する余地を残す。
    if (delta > 0) return { kind: 'hammer', patch: { isHammerPullOrigin: true } };
    return { kind: 'pull', patch: { isHammerPullOrigin: true } };
  }

  // ===== 内部 =====

  /**
   * 検証 OK なら `action` を実行してその戻り値を返す。NG なら `report` して null を返す。
   */
  private runValidated(outcome: ValidationOutcome, action: () => CommandOutcome): CommandOutcome | null {
    if (!outcome.ok) {
      this.reporter.report(outcome.code, outcome.context);
      return null;
    }
    return action();
  }
}
