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
import { ClipboardService, durationSpecOf, isNoteRef } from './ClipboardService';
import { CompositeCommand } from './CompositeCommand';
import type { CommandHistory, NotificationReporter } from './commands/CommandHistory';
import { DeleteNotesCommand } from './commands/DeleteNotesCommand';
import { collectRangeBeats, DeleteSelectionCommand } from './commands/DeleteSelectionCommand';
import { DuplicateSelectionCommand } from './commands/DuplicateSelectionCommand';
import { AddMemoCommand, barRef, DeleteMemoCommand, EditMemoCommand } from './commands/memoCommands';
import { PasteCommand } from './commands/PasteCommand';
import { PlaceNoteCommand } from './commands/PlaceNoteCommand';
import { InsertRestCommand } from './commands/InsertRestCommand';
import { SetBeatDurationCommand } from './commands/SetBeatDurationCommand';
import { SetNoteFretCommand } from './commands/SetNoteFretCommand';
import { SetRepeatCommand, type RepeatPatch } from './commands/SetRepeatCommand';
import { SetTimeSignatureCommand, type TimeSignatureSpec } from './commands/SetTimeSignatureCommand';
import {
  SetBeatTechniqueCommand,
  SetChordNameCommand,
  SetSlurCommand,
  SetTechniqueCommand,
  SetTieCommand,
  type BeatTechniquePatch,
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
import {
  barCount,
  beatIndexForVoiceSwitch,
  findNoteOnString,
  isBarFilled,
  isBarFilledAfterPlacing,
  isBarFilledAtLastBeat,
  MAX_FRET,
  voiceBeats,
} from './scoreModel';
import { suggestTechniques, TECHNIQUE_SUGGEST_THRESHOLDS, type TechniqueSuggestion } from './techniqueSuggestion';
import { findTieCandidate } from './tieSuggestion';
import type { ValidationService } from './ValidationService';
import type {
  BeatDurationSpec,
  CommandOutcome,
  CursorPosition,
  EditTarget,
  NoteRef,
  SelectionRange,
  ValidationOutcome,
} from './types';

export type { TechniqueSuggestion } from './techniqueSuggestion';

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
  // <!-- req editingcore:5da48106.3326 --> <!-- req editingcore:5da48106.6555 -->
  // <!-- req editingcore:36796c9e.bb28 --> <!-- req editingcore:36796c9e.d880 --> <!-- req editingcore:36796c9e.2fa8 -->
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
 * 数字キーの 2 桁のフレットの窓（editing-core.md 4.2 節）。1 つ目の数字で音を置いてから、この時間の内（ちょうど 1000 ミリ秒を含む）に
 * 次の数字を押したときだけ、2 桁への書き換えを考える。
 */
// <!-- req editingcore:7ec7691b.cd08 -->
export const TWO_DIGIT_FRET_WINDOW_MS = 1000;

/** 2 桁のフレットの一番小さい値（editing-core.md 4.2 節「2 桁が 10 から 24 になるとき」。一番大きい値は MAX_FRET）。 */
const TWO_DIGIT_FRET_MIN = 10;

/**
 * 数字キーで置いた音符の覚え（editing-core.md 4.2 節）。押した数字・押した時刻（注入した時計の値）・置いた音符の位置と弦。
 * カーソルが動いたときと、どの窓口が出したコマンドでも当たったときに捨てる。
 */
interface PendingDigit {
  readonly digit: number;
  readonly at: number;
  readonly placed: NoteRef;
  /** 置いた直後のカーソルの位置（1 つ目の数字で進んだ位置。和音のときは置いた拍）。次の数字のときに今のカーソルの位置と比べる。 */
  readonly cursorAt: CursorPosition;
}

/**
 * 次の数字を 2 桁目として扱えるか（editing-core.md 4.2 節の (b)「次の数字のときに比べる」）。押した時刻が覚えた時刻から
 * `TWO_DIGIT_FRET_WINDOW_MS` の内で、今のカーソルの位置が置いた直後の位置と同じで、選んでいる弦が置いた音符の弦と同じときだけ。
 * 覚えは onChange で捨てるので、ふつうは位置も弦も同じになる。捨て損ねたときに別の拍・別の弦の音を書き換えないための守り。
 */
function isSecondDigit(
  pending: PendingDigit,
  pressedAt: number,
  cursorPosition: CursorPosition,
  currentString: number,
): boolean {
  return (
    pressedAt - pending.at <= TWO_DIGIT_FRET_WINDOW_MS &&
    isSamePosition(cursorPosition, pending.cursorAt) &&
    currentString === pending.placed.stringNumber
  );
}

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

/** 2 つのカーソルの位置が同じか（パート・小節・ボイス・拍の 4 つ、editing-core.md 3.1 節）。 */
function isSamePosition(a: CursorPosition, b: CursorPosition): boolean {
  return (
    a.trackIndex === b.trackIndex &&
    a.barIndex === b.barIndex &&
    a.voiceIndex === b.voiceIndex &&
    a.beatIndex === b.beatIndex
  );
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
// <!-- req editingcore:adeaedfc.ca04 -->
// <!-- req editingcore:ff7c701d.b05a --> <!-- req editingcore:a5f4921a.7502 --> <!-- req editingcore:a5f4921a.7e89 -->
export class EditingService {
  // <!-- req 00:48e69d47.9ee5 --> <!-- req 00:48e69d47.a8d9 --> <!-- req 00:48e69d47.6d08 -->
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
  /** 数字キーで置いた音符の覚え（editing-core.md 4.2 節）。無ければ null。 */
  // <!-- req editingcore:7ec7691b.c915 --> <!-- req editingcore:7ec7691b.fb32 -->
  private pendingDigit: PendingDigit | null = null;

  constructor(
    // <!-- req 00:48e69d47.3ff5 -->
    // <!-- req editingcore:5a19a29c.bb2d -->
    private readonly target: EditTarget,
    // <!-- req editingcore:5a19a29c.72eb -->
    private readonly cursor: CursorController,
    // <!-- req editingcore:5a19a29c.3332 -->
    private readonly validation: ValidationService,
    // <!-- req editingcore:9adf111c.9021 -->
    private readonly history: CommandHistory,
    // <!-- req editingcore:9adf111c.baed -->
    private readonly reporter: NotificationReporter,
    /**
     * 範囲のコピーと貼り付けのクリップボード（editing-core.md 9 節）。外から渡し、編集ウィンドウ（＝この EditingService）ごとに 1 つ持つ。
     * 渡さなければ、この窓だけのものを作る。別の曲の編集ウィンドウへは貼れない（v1 は同じ曲の中だけ。そのための口は作らない）。
     */
    // <!-- req editingcore:aa765aff.ae30 --> <!-- req editingcore:aa765aff.1dd9 --> <!-- req editingcore:7f78c0f1.20e1 --> <!-- req editingcore:7f78c0f1.c4cc -->
    // <!-- req editingcore:7f78c0f1.efb8 --> <!-- req editingcore:aa765aff.17c9 -->
    // <!-- req editingcore:9adf111c.6fb5 -->
    private readonly clipboard: ClipboardService = new ClipboardService(),
    /**
     * 消す小節にマーカーかメモがあるときに扱いを確かめる口（editing-core.md 10 節）。外から必ず渡す（null を許さない型にし、
     * 渡し忘れを型の検査で止める。editing-core.md 4.8 節）。
     */
    // <!-- req editingcore:ee3762df.ee14 -->
    private readonly barDeleteConfirmer: BarDeleteConfirmer,
    /** コード名を推し量る部品（editing-core.md 8 節。覚えを持たない部品で、覚えるのはこのクラス）。 */
    // <!-- req editingcore:a37c7c1f.8fd0 -->
    // <!-- req editingcore:ee3762df.f411 -->
    private readonly chords: ChordDetectionService = new ChordDetectionService(),
    /**
     * 数字キーの 2 桁のフレットの窓を測る時計（editing-core.md 4.2 節・4.8 節の `now: () => number`。ミリ秒）。
     * テストで差し替えて 1 秒の前後を確かめる。渡さなければ `Date.now`。
     */
    // <!-- req editingcore:7ec7691b.db89 -->
    // <!-- req editingcore:ee3762df.8af6 -->
    private readonly now: () => number = () => Date.now(),
  ) {
    // 覚えた候補と 2 桁のフレットの覚えは、カーソルが動いたとき（← とクリックのように CursorController を直に呼ぶ動きと、
    // 音価を選んだときを含む）と、どの窓口が出したコマンドでも当たったときに捨てる（editing-core.md 4.2 節・6 節・7.1 節）
    // <!-- req editingcore:dbeaa35e.44a4 --> <!-- req editingcore:dbeaa35e.9100 --> <!-- req editingcore:d222e544.fd6f -->
    // <!-- req editingcore:7ec7691b.3376 --> <!-- req editingcore:7ec7691b.7fd5 --> <!-- req editingcore:7ec7691b.df8f -->
    cursor.onChange(() => {
      this.dismissSuggestions();
      this.pendingDigit = null;
    });
    // <!-- req editingcore:dbeaa35e.4ca9 -->
    // <!-- req editingcore:7ec7691b.d169 --> <!-- req editingcore:7ec7691b.f0b5 --> <!-- req editingcore:7ec7691b.704b -->
    history.onCommandApplied(() => {
      this.dismissSuggestions();
      this.pendingDigit = null;
    });
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
   * 置く前に最後の小節が埋まるかを数え、埋まるなら `PlaceNoteCommand` と `InsertBarCommand` を 1 つの `CompositeCommand` に
   * まとめて発行し、足した小節の頭へ送る（4.1 節）。「和音」ボタンが入っている間は進めないので、ここでは足さない（確定のとき、4.7 節）。
   */
  // <!-- req editingcore:c7d1d266.4dc3 --> <!-- req editingcore:592ec46a.bf65 -->
  // <!-- req editingcore:fc01b721.6004 --> <!-- req editingcore:fc01b721.d037 --> <!-- req editingcore:fc01b721.ff8c --> <!-- req editingcore:fc01b721.5820 -->
  placeNote(stringNumber: number, fret: number): void {
    // <!-- req 00:48e69d47.1eae -->
    this.placeAtCursor(stringNumber, fret); // <!-- req editingcore:ec2256b4.62ed -->
  }

  /**
   * 数字キー（0 から 9）を押したとき（editing-core.md 4.2 節）。選んでいる弦の、カーソルの拍に、その数のフレットの音をすぐ置く
   * （`placeNote` と同じ確かめと `PlaceNoteCommand`）。置いてから `TWO_DIGIT_FRET_WINDOW_MS` の内に次の数字を押し、前の数字と
   * 合わせた 2 桁が 10 から 24 になるときは、置いた音のフレットをその 2 桁に書き換える（`SetNoteFretCommand`。履歴では前の
   * `PlaceNoteCommand` と 1 つの項目にまとまる）。カーソルは 1 つ目の数字で進んだ位置のまま動かさない。2 桁が 10 から 24 に
   * ならないときと、窓を過ぎたときは、新しい音として今のカーソルの拍に置く。窓の内でも、今のカーソルの位置か選んでいる弦が
   * 1 つ目の数字を置いた直後と違うときは、新しい音として置く（`isSecondDigit`）。
   * 書き換えの前の確かめは 2 桁が 10 から 24 にあることだけで、`validateNotePlacement` は通さない（置いた音符が同じ弦にあるので
   * `EDIT-001` になるため）。書き換えた後は、そのコマンドの知らせで覚えを捨てるので、3 つ目の数字は新しい音になる。
   * 書き換えた後は、書き換えた音符でタイと奏法記号の候補を求め直す（利用者には 1 つの音を置いた操作に見えるため）。
   */
  // <!-- req editingcore:9a48b4bc.62c9 --> <!-- req editingcore:9a48b4bc.b7a9 --> <!-- req editingcore:8ee56da1.53d2 -->
  // <!-- req editingcore:fc01b721.1bde --> <!-- req editingcore:d2ba6371.d36f --> <!-- req editingcore:d2ba6371.cfdd --> <!-- req editingcore:d2ba6371.6e01 -->
  placeDigit(digit: number): void {
    // <!-- req 00:48e69d47.322f -->
    const pressedAt = this.now();
    const pending = this.pendingDigit;
    // <!-- req editingcore:7ec7691b.6d3f --> <!-- req editingcore:7ec7691b.7d86 --> <!-- req editingcore:3ea42283.302c -->
    if (pending !== null && isSecondDigit(pending, pressedAt, this.cursor.position, this.cursor.currentString)) {
      const twoDigits = pending.digit * 10 + digit;
      // <!-- req editingcore:3ea42283.fa54 -->
      if (Number.isInteger(twoDigits) && twoDigits >= TWO_DIGIT_FRET_MIN && twoDigits <= MAX_FRET) {
        const { placed } = pending;
        // <!-- req editingcore:3ea42283.f21f --> <!-- req editingcore:3ea42283.7f32 -->
        const outcome = this.history.execute(
          new SetNoteFretCommand(this.target, placed.position, placed.stringNumber, twoDigits),
        );
        // cursorAdvance は 'none' なので、カーソルは 1 つ目の数字で進んだ位置のまま
        // <!-- req editingcore:3ea42283.a3cb -->
        this.cursor.applyOutcome(outcome, this.target);
        this.rememberSuggestions(placed);
        return;
      }
    }
    // 窓の外か、2 桁が 10 から 24 にならないときは新しい音として置く
    // <!-- req editingcore:3ea42283.fb49 --> <!-- req editingcore:3ea42283.d507 --> <!-- req editingcore:b9276c22.9cf5 -->
    const placed = this.placeAtCursor(this.cursor.currentString, digit); // <!-- req editingcore:ec2256b4.5e3b -->
    // 自分が出した PlaceNoteCommand の知らせで捨てた後に、置いた音符を覚え直す
    // <!-- req editingcore:7ec7691b.1f1c -->
    if (placed !== null) this.pendingDigit = { digit, at: pressedAt, placed, cursorAt: this.cursor.position };
  }

  /**
   * カーソルの拍の stringNumber の弦に fret の音を置く（editing-core.md 4.2 節。`placeNote` と `placeDigit` の中身）。
   * 確かめで拒んだときは知らせて null を返し、カーソルを動かさない。置けたら置いた音符を返す。
   */
  private placeAtCursor(stringNumber: number, fret: number): NoteRef | null {
    // 音を置く入力で、前の候補を閉じる（拒まれたときも。6 節・7.1 節）
    // <!-- req editingcore:dbeaa35e.0699 --> <!-- req editingcore:d222e544.83f1 -->
    this.dismissSuggestions();
    const position = this.cursor.position;
    const spec = this.cursor.currentDuration;
    // <!-- req editingcore:60016c2f.bb9e --> <!-- req editingcore:0546f4aa.32c0 -->
    const outcome = this.runValidated(
      // <!-- req editingcore:60016c2f.2e83 --> <!-- req editingcore:a3715176.c103 --> <!-- req editingcore:68c8ea9f.60e3 -->
      // <!-- req editingcore:592ec46a.f2a1 -->
      this.validation.validateNotePlacement(this.target, position, stringNumber, fret),
      // 「和音」ボタンが入っている間は、置いた拍に留まるので、ここでは小節を足さない（確定のときに足す、4.7 節）
      () =>
        this.executePlacement(
          // <!-- req editingcore:592ec46a.164c --> <!-- req editingcore:b9276c22.8f53 -->
          new PlaceNoteCommand(this.target, position, stringNumber, fret, spec),
          position,
          // <!-- req editingcore:131d964b.24f4 -->
          // <!-- req editingcore:d1ba36d6.32c4 -->
          !this.cursor.chordInputMode && isBarFilledAfterPlacing(this.target.score, position, spec, false),
          // ボタンが切れていて、音のある拍に別の弦の音を足して和音にするときは、カーソルをその拍に留め、小節も足さない
          // （editing-core.md 4.2 節・4.7 節。戻り値は 'beat' のままで、applyOutcome を呼ばない）
          !this.isChordAdditionWithoutButton(position, stringNumber), // <!-- req editingcore:ec2256b4.dc45 --> <!-- req editingcore:ec2256b4.3771 --> <!-- req editingcore:ec2256b4.5173 --> <!-- req editingcore:ec2256b4.8da8 --> <!-- req editingcore:47f7fe30.92d1 --> <!-- req editingcore:47f7fe30.1bb6 -->
        ),
    );
    // <!-- req editingcore:44073c4a.b621 --> <!-- req editingcore:23ef8d7d.1232 -->
    if (outcome === null) return null;
    // カーソルは executePlacement の中で、コマンドの実行が成り立った後に動かしてある
    // <!-- req editingcore:44073c4a.7610 -->
    // コマンドの知らせとカーソルの知らせで捨てた後に、置いた音符で求め直して覚える
    const placed: NoteRef = { position, stringNumber };
    this.rememberSuggestions(placed);
    return placed;
  }

  /**
   * 「和音」ボタンが切れていて、置く前の拍に音があり、置く弦に音が無いか（editing-core.md 4.2 節・4.7 節）。真なら、音のある拍に
   * 別の弦の音を足して和音にするときで、カーソルを進めない。休符の拍と最後の拍の後ろ（拍が無い）は偽で、今までどおり進む。
   */
  private isChordAdditionWithoutButton(position: CursorPosition, stringNumber: number): boolean {
    // <!-- req editingcore:ec2256b4.0481 -->
    if (this.cursor.chordInputMode) return false;
    const beat = voiceBeats(this.target.score, position.trackIndex, position.barIndex, position.voiceIndex)[
      position.beatIndex
    ];
    return beat !== undefined && beat.notes.length > 0 && findNoteOnString(beat, stringNumber) === null;
  }

  /** 置いた音符で、タイと奏法記号の候補を求めて覚える（editing-core.md 6 節・7.1 節）。 */
  private rememberSuggestions(placed: NoteRef): void {
    // <!-- req editingcore:953e9552.acd0 --> <!-- req editingcore:dbeaa35e.d3c2 --> <!-- req editingcore:dbeaa35e.a007 -->
    this.tieSuggestion = findTieCandidate(this.target.score, placed);
    // <!-- req editingcore:b95656ed.7928 --> <!-- req editingcore:d222e544.c844 -->
    // <!-- req editingcore:d2c8dd0b.d118 -->
    this.techniqueSuggestions = suggestTechniques(this.target.score, placed);
  }

  /**
   * 現在位置へ明示的な休符を挿入し、カーソルを進める（editing-core.md 4.4 節）。
   * 置く前に最後の小節が埋まるかを数え、埋まるなら `InsertRestCommand` と `InsertBarCommand` を 1 つの `CompositeCommand` にまとめて
   * 発行し、足した小節の頭へ送る（4.1 節）。
   * 置いた直後に、スタッカートの候補（前の短い音符に付ける）を求めて覚える（7.1 節）。
   */
  // <!-- req editingcore:fc0f0993.add8 -->
  // <!-- req editingcore:c7d1d266.367d -->
  // <!-- req editingcore:62dc61b3.d947 --> <!-- req editingcore:62dc61b3.49c1 -->
  insertRest(): void {
    // <!-- req 00:48e69d47.638e -->
    this.dismissSuggestions();
    const position = this.cursor.position;
    const spec = this.cursor.currentDuration;
    // 休符は音ではないので、「和音」ボタンが入っていても和音の入力の途中にせずに進む（4.7 節・CursorController.applyOutcome）。
    // だから最後の小節が埋まるなら、ボタンの入切によらず小節を足す
    // <!-- req editingcore:f9719897.81a2 -->
    this.executePlacement(
      new InsertRestCommand(this.target, position, spec),
      position,
      // <!-- req editingcore:131d964b.de6c -->
      isBarFilledAfterPlacing(this.target.score, position, spec, true),
    );
    // 休符の拍には音符が無いので、弦は選んでいる弦を渡す（suggestTechniques は NoteRef を受ける形、7.1 節）
    // <!-- req editingcore:c7d1d266.6bc3 --> <!-- req editingcore:c7d1d266.6235 --> <!-- req editingcore:c7d1d266.a89c -->
    // <!-- req editingcore:d2c8dd0b.5f0a -->
    this.techniqueSuggestions = suggestTechniques(this.target.score, {
      position,
      stringNumber: this.cursor.currentString,
    });
  }

  /**
   * 置くコマンド（`PlaceNoteCommand` か `InsertRestCommand`）を発行し、カーソルを動かす（editing-core.md 4.1 節・4.2 節）。
   * `fillsBar` は、置く前に数えた「置いた後に小節が埋まり、カーソルがここで進む」か。それが曲の最後の小節なら、置くコマンドと
   * `InsertBarCommand` を 1 つの `CompositeCommand` にまとめて発行し（1 回の取り消しで、置いた音か休符と足した小節の両方が戻る）、
   * 足した小節の頭へカーソルを送る。小節を足す確かめ `validateBarInsertion` が拒んだら、知らせて、置くコマンドだけを発行し、
   * カーソルは置いた拍に留める（editing-core.md 4.1 節、283・286 番の決め直し）。
   * それ以外は置くコマンドだけを発行し、戻り値で `CursorController.applyOutcome` に動かさせる。`advances` が偽（ボタンが切れていて
   * 音のある拍に別の弦の音を足して和音にするとき、4.2 節）は、小節を足さず、`applyOutcome` を呼ばずにカーソルをその拍に留める。
   * 発行したコマンドの戻り値を返す。
   */
  // <!-- req editingcore:131d964b.0def --> <!-- req editingcore:131d964b.eab8 --> <!-- req editingcore:131d964b.69f6 --> <!-- req editingcore:131d964b.170f -->
  // <!-- req editingcore:131d964b.6a2e --> <!-- req editingcore:131d964b.fd9a --> <!-- req editingcore:131d964b.5cda -->
  private executePlacement(
    command: PlaceNoteCommand | InsertRestCommand,
    position: CursorPosition,
    fillsBar: boolean,
    advances = true,
  ): CommandOutcome {
    const bars = barCount(this.target.score);
    if (advances && fillsBar && position.barIndex === bars - 1) {
      const barCheck = withBarInsertionPosition(
        this.validation.validateBarInsertion(this.target),
        position.trackIndex,
        bars,
        bars,
      );
      if (barCheck.ok) {
        const outcome = this.history.execute(
          new CompositeCommand(`${command.kind}-append-bar`, command.label, [
            command,
            new InsertBarCommand(this.target, bars),
          ]),
        );
        this.cursor.setPosition({ ...position, barIndex: bars, beatIndex: 0 });
        return outcome;
      }
      // <!-- req editingcore:131d964b.5905 --> <!-- req editingcore:131d964b.58b6 -->
      this.reporter.report(barCheck.code, barCheck.context);
      // 置くコマンドだけを発行し、カーソルは置いた拍に留める（同じ小節の最後の拍の後ろへ進めない）
      return this.history.execute(command); // <!-- req editingcore:131d964b.5429 --> <!-- req editingcore:7cf4b60b.e810 --> <!-- req editingcore:7cf4b60b.e5ae -->
    }
    const outcome = this.history.execute(command);
    if (advances) this.cursor.applyOutcome(outcome, this.target); // <!-- req editingcore:ec2256b4.f173 --> <!-- req editingcore:6839e2ae.871d -->
    return outcome;
  }

  /**
   * → キー（editing-core.md 4.1 節・4.4 節・4.8 節）。カーソルが小節の最後の拍の後ろ（`beatIndex` が `beats.length` 以上）にいて、
   * 小節に空きがあれば、今の入力音価の休符を置いて進む（`insertRest` と同じ `InsertRestCommand`。矢印キーでの明示のスキップ）。
   * 小節の最後の拍か最後の拍の後ろにいて、小節が埋まっていて、それが曲の最後の小節なら、`InsertBarCommand` の 1 つの履歴の項目で
   * 小節を 1 つ足し、その頭へ移る（小節を足す確かめ `validateBarInsertion` で拒んだら知らせて動かない）。
   * それ以外は `CursorController.moveByBeat(target, 1)` の → の動き（空きがあれば最後の拍の後ろへ、埋まっていれば次の小節の頭へ、
   * それより前の拍では次の拍へ）で、コマンドは出さない。
   * 「和音」ボタンが入っていて和音の入力の途中なら、上の動きの代わりに和音を確定し、置いた拍から、音を置いたときと同じ進め方で
   * 1 つ進める（editing-core.md 4.7 節。小節が埋まれば次の小節の頭、それが曲の最後の小節なら小節を足してその頭）。
   * 確定した後もボタンは入れたままにする（4.7 節の (b)）。
   */
  // <!-- req editingcore:f9719897.9381 -->
  // <!-- req editingcore:43ccc84e.c728 --> <!-- req editingcore:43ccc84e.47c1 --> <!-- req editingcore:43ccc84e.0b2d --> <!-- req editingcore:43ccc84e.0f7e -->
  stepRight(): void {
    // <!-- req 00:48e69d47.fe2e --> <!-- req 00:48e69d47.5574 -->
    // <!-- req editingcore:7cf4b60b.2b0c -->
    // <!-- req editingcore:3306efc4.01fa -->
    if (this.cursor.chordInputMode && this.confirmChordAndStep(true)) return;
    const position = this.cursor.position;
    const { trackIndex, barIndex, voiceIndex, beatIndex } = position;
    const { score } = this.target;
    const count = voiceBeats(score, trackIndex, barIndex, voiceIndex).length;
    const filled = isBarFilled(score, trackIndex, barIndex, voiceIndex);
    // <!-- req editingcore:f9719897.a468 --> <!-- req editingcore:f9719897.4b7e -->
    // <!-- req editingcore:52b52eea.7949 --> <!-- req editingcore:52b52eea.bcdd -->
    if (beatIndex >= count && !filled) {
      this.insertRest(); // <!-- req editingcore:7cf4b60b.6d88 --> <!-- req editingcore:7cf4b60b.3088 -->
      return;
    }
    const bars = barCount(score);
    // <!-- req editingcore:52b52eea.e51a --> <!-- req editingcore:5aa7c8dd.ba52 --> <!-- req editingcore:5aa7c8dd.be97 --> <!-- req editingcore:5aa7c8dd.48a6 -->
    if (beatIndex >= count - 1 && filled && barIndex === bars - 1) {
      this.appendBarAndMoveToHead(position); // <!-- req editingcore:7cf4b60b.c027 -->
      return;
    }
    // <!-- req editingcore:acdbe57b.afab -->
    this.cursor.moveByBeat(this.target, 1); // <!-- req editingcore:7cf4b60b.603b -->
  }

  /**
   * 「和音」のボタンを切る（editing-core.md 4.7 節）。和音の入力を終える 3 つの操作の 1 つで、和音の入力の途中なら確定し、置いた拍から、
   * 音を置いたときと同じ進め方で 1 つ進める（小節が埋まれば次の小節の頭、それが曲の最後の小節なら `InsertBarCommand` の 1 つの
   * 履歴の項目で小節を足してその頭。足すことを `EDIT-003` で拒んだら、知らせて確定した和音の拍に留める）。途中でなければボタンを切るだけで、
   * カーソルは動かさない。ボタンは切ったままにする（→ と音価の選択の確定と違い、入れ直さない）。
   * `CursorController.exitChordInput` はコマンドを出せないので小節を足せない。画面のボタンはこちらを呼ぶ。
   */
  // <!-- req editingcore:3306efc4.d40b -->
  exitChordInput(): void {
    // <!-- req 00:48e69d47.3474 -->
    // <!-- req editingcore:711ba495.361a -->
    this.confirmChordAndStep(false); // <!-- req editingcore:711ba495.e333 --> <!-- req editingcore:711ba495.e793 -->
  }

  // ===== カーソルと選択範囲を動かす窓口（editing-core.md 4.8 節、288 番） =====

  /**
   * クリックでカーソルを手で動かす（editing-core.md 4.1 節・4.7 節・4.8 節）。`CursorController.setPosition` に渡す。
   * 和音の入力の途中なら、確定せずに途中の印を捨てる（進めない。置いた音は残し、「和音」ボタンの入切は変えない。4.7 節の (b)）。
   * 捨てるのは `CursorController.setPosition` の中。2 桁のフレットの覚えと候補は、カーソルの知らせ（コンストラクタで
   * `CursorController.onChange` に登録した所）で捨てる（4.2 節の (b)）。
   */
  // <!-- req editingcore:e7806341.7615 --> <!-- req editingcore:e7806341.0102 --> <!-- req editingcore:cca8c362.5383 -->
  // <!-- req editingcore:a5f4921a.52aa -->
  setPosition(position: CursorPosition): void {
    // <!-- req 00:48e69d47.0853 --> <!-- req 00:48e69d47.7850 -->
    this.cursor.setPosition(position); // <!-- req editingcore:e7806341.e717 --> <!-- req editingcore:cca8c362.4a2d --> <!-- req editingcore:7ec7691b.4c66 -->
  }

  /**
   * ← キー（editing-core.md 4.1 節・4.7 節・4.8 節）。`CursorController.moveByBeat(target, -1)` に渡し、選んでいるボイスの拍を
   * 1 つ前へ動く（コマンドは出さない）。和音の入力の途中なら、確定せずに途中の印を捨てる（`setPosition` と同じ。捨てるのは
   * `moveByBeat` の中）。2 桁のフレットの覚えと候補は、カーソルの知らせで捨てる（4.2 節の (b)）。
   */
  // <!-- req editingcore:e7806341.da89 --> <!-- req editingcore:cca8c362.1a19 -->
  // <!-- req editingcore:a5f4921a.52aa -->
  stepLeft(): void {
    // <!-- req 00:48e69d47.7c19 -->
    this.cursor.moveByBeat(this.target, -1); // <!-- req editingcore:e7806341.c2c3 --> <!-- req editingcore:cca8c362.e0af --> <!-- req editingcore:7ec7691b.0e89 -->
  }

  /**
   * 「ボイス 1／2」と Ctrl+Shift+1・Ctrl+Shift+2 でボイスを切り替える（editing-core.md 4.8 節・3.1 節（296 番））。同じ小節の中で、
   * それまでの拍の始まりの時刻と同じか、その直前に始まる、切り替えた先のボイスの拍（`scoreModel.beatIndexForVoiceSwitch`。
   * 2 つ目のボイスがまだ無い小節では拍 0）を `CursorController.setPosition` に渡す。パートと小節は変えない。今のボイスと同じなら
   * 何もしない。和音の入力の途中の印は、手で動かしたときと同じく `CursorController.setPosition` の中で捨てる（4.7 節の (b)）。
   */
  // <!-- req editingcore:e7806341.caf3 --> <!-- req editingcore:e7806341.5b2e --> <!-- req editingcore:e7806341.7ca5 --> <!-- req 00:48e69d47.2de2 --> <!-- req 00:48e69d47.5ecd -->
  switchVoice(voice: 0 | 1): void {
    const position = this.cursor.position;
    if (position.voiceIndex === voice) return;
    const beatIndex = beatIndexForVoiceSwitch(
      this.target.score,
      position.trackIndex,
      position.barIndex,
      position.voiceIndex,
      position.beatIndex,
      voice,
    );
    this.cursor.setPosition({ ...position, voiceIndex: voice, beatIndex });
  }

  /** ↑ ↓ で選ぶ弦を変える（editing-core.md 4.1 節・4.8 節）。`CursorController.setString` に渡す。 */
  // <!-- req editingcore:00603e64.4e74 -->
  setString(stringNumber: number): void {
    // <!-- req 00:48e69d47.8b11 -->
    this.cursor.setString(stringNumber); // <!-- req editingcore:00603e64.ba9d -->
  }

  /** 「和音」ボタンを入れる（editing-core.md 4.7 節・4.8 節）。`CursorController.enterChordInput` に渡す。 */
  // <!-- req editingcore:00603e64.368a -->
  enterChordInput(): void {
    // <!-- req 00:48e69d47.aa34 -->
    this.cursor.enterChordInput(); // <!-- req editingcore:00603e64.ba9d -->
  }

  /** 範囲を決める（editing-core.md 9 節・4.8 節）。`CursorController.setSelection` に渡す。 */
  // <!-- req editingcore:29672b60.2c76 -->
  setSelection(range: SelectionRange): void {
    // <!-- req 00:48e69d47.8bc6 --> <!-- req 00:48e69d47.5a3a -->
    this.cursor.setSelection(range); // <!-- req editingcore:29672b60.1056 -->
  }

  /** 範囲の始まりを置く（editing-core.md 9 節・4.8 節）。`CursorController.beginSelection` に渡す。 */
  // <!-- req editingcore:29672b60.e0c0 -->
  beginSelection(at: CursorPosition): void {
    // <!-- req 00:48e69d47.1f83 -->
    this.cursor.beginSelection(at); // <!-- req editingcore:29672b60.1056 -->
  }

  /** 範囲の終わりを動かす（editing-core.md 9 節・4.8 節）。`CursorController.extendSelection` に渡す。 */
  // <!-- req editingcore:29672b60.80b7 -->
  extendSelection(at: CursorPosition): void {
    // <!-- req 00:48e69d47.1c05 -->
    this.cursor.extendSelection(at); // <!-- req editingcore:29672b60.1056 -->
  }

  /** 範囲を外す（editing-core.md 9 節・4.8 節）。`CursorController.clearSelection` に渡す。 */
  // <!-- req editingcore:29672b60.8dce -->
  clearSelection(): void {
    // <!-- req 00:48e69d47.7af2 -->
    this.cursor.clearSelection(); // <!-- req editingcore:29672b60.1056 -->
  }

  /**
   * 「和音」のボタンを切る・→・音価の選択（`setDuration`）で和音を確定する（editing-core.md 4.7 節）。和音の入力の途中かどうかは
   * `CursorController` の宣言に読む口が無いので、`exitChordInput` でカーソルが動いたかで見る（途中なら、置いた拍から必ず 1 つ進む。
   * 途中でなければ動かない）。`keepButton` が真（→ と音価の選択）なら、すぐ `enterChordInput` でボタンを入れ直す（4.7 節の (b)
   * 「音価を選んで確定したときと、→ で確定したときは、ボタンを入れたままにし」）。偽（ボタンを切ったとき）は入れ直さない。
   * 途中だったときは、置いた拍の小節が埋まっていて曲の最後の小節なら、小節を足してその頭へ移す（4.1 節。`exitChordInput` の
   * 進め方は、次の小節が無いので同じ小節の次の拍になるため）。小節を足すことを確かめが `EDIT-003` で拒んだら、知らせて、
   * カーソルを確定した和音の拍へ戻して留める（4.7 節の (b)。音を置いて拒んだときの 4.1 節とそろえる）。
   * 途中だったら真（→ の動きはここで済む）、途中でなければ偽を返す。
   */
  // <!-- req editingcore:3306efc4.b32e -->
  private confirmChordAndStep(keepButton: boolean): boolean {
    const placed = this.cursor.position;
    // <!-- req editingcore:acdbe57b.6339 --> <!-- req editingcore:acdbe57b.78c1 -->
    this.cursor.exitChordInput(this.target);
    const moved = !isSamePosition(placed, this.cursor.position);
    // <!-- req editingcore:32cf0bd1.d68d --> <!-- req editingcore:32cf0bd1.e1d2 --> <!-- req editingcore:32cf0bd1.269e --> <!-- req editingcore:32cf0bd1.5c3d -->
    if (keepButton) this.cursor.enterChordInput();
    // <!-- req editingcore:acdbe57b.81d0 --> <!-- req editingcore:acdbe57b.41d3 -->
    if (!moved) return false;
    const { score } = this.target;
    if (placed.barIndex === barCount(score) - 1 && isBarFilledAtLastBeat(score, placed)) {
      // <!-- req editingcore:acdbe57b.bdbb -->
      // 小節を足すことを EDIT-003 で拒んだら、カーソルは確定した和音の拍に留める（4.7 節の (b)、286 番の決め直し）
      if (!this.appendBarAndMoveToHead(placed)) this.cursor.setPosition(placed); // <!-- req editingcore:d1ba36d6.bb5f -->
    }
    return true;
  }

  /**
   * 曲の終わりに小節を 1 つ足し（`InsertBarCommand` の 1 つの履歴の項目）、その頭へカーソルを移す（editing-core.md 4.1 節）。
   * 小節を足す確かめ `validateBarInsertion` で拒んだら、知らせて、カーソルを動かさない。
   * `position` は、移す先のパートとボイスを決める今の位置。足せたら真、拒んだら偽を返す。
   */
  private appendBarAndMoveToHead(position: CursorPosition): boolean {
    const bars = barCount(this.target.score);
    const outcome = this.runValidated(
      withBarInsertionPosition(this.validation.validateBarInsertion(this.target), position.trackIndex, bars, bars), // <!-- req editingcore:7cf4b60b.d1a5 -->
      // <!-- req editingcore:d1ba36d6.6e3a --> <!-- req editingcore:d1ba36d6.be12 --> <!-- req editingcore:d1ba36d6.0224 -->
      () => this.history.execute(new InsertBarCommand(this.target, bars)), // <!-- req editingcore:7cf4b60b.eb56 --> <!-- req editingcore:7cf4b60b.33ed -->
    );
    // <!-- req editingcore:d1ba36d6.2b37 -->
    if (outcome === null) return false; // <!-- req editingcore:7cf4b60b.aa2d -->
    this.cursor.setPosition({ ...position, barIndex: bars, beatIndex: 0 });
    return true;
  }

  // ===== 候補（editing-core.md 6 節・7.1 節） =====

  /** 覚えたタイの候補（タイでつなぐ前の音符）。無ければ null。 */
  // <!-- req editingcore:dbeaa35e.b0a4 -->
  // <!-- req editingcore:8da4a1b0.9606 --> <!-- req editingcore:8da4a1b0.0880 --> <!-- req editingcore:8da4a1b0.2351 --> <!-- req editingcore:8da4a1b0.16ed -->
  tieCandidate(): NoteRef | null {
    // <!-- req 00:48e69d47.4954 -->
    return this.tieSuggestion;
  }

  /** 音符か休符を置いた直後に求めて覚えた奏法記号の候補（0 から 2 件）。示すだけで、自動では付けない。 */
  // <!-- req editingcore:c7d1d266.256a --> <!-- req editingcore:d222e544.32d4 -->
  // <!-- req editingcore:d2c8dd0b.42c6 --> <!-- req editingcore:d2c8dd0b.9c55 --> <!-- req editingcore:d2c8dd0b.bdfe -->
  suggestTechniques(): readonly TechniqueSuggestion[] {
    // <!-- req 00:48e69d47.0848 --> <!-- req 00:48e69d47.021d --> <!-- req 00:48e69d47.458b -->
    return this.techniqueSuggestions;
  }

  /**
   * 候補の承認（editing-core.md 7.1 節）。覚えている候補の index 番目の patch で、その候補の target の音符
   * （カーソルの拍ではない）に `SetTechniqueCommand` を発行して候補を閉じる。覚えている候補が無い（閉じた後）か、
   * index が範囲の外（整数でない数を含む）のときは何もしない。UT-EDIT-SVC-117〜120。
   */
  // <!-- req editingcore:2eadf767.a29e --> <!-- req editingcore:2eadf767.3877 --> <!-- req editingcore:d222e544.1dbb -->
  // <!-- req editingcore:d222e544.a00a --> <!-- req editingcore:d222e544.0eb7 --> <!-- req editingcore:d222e544.e286 -->
  // <!-- req editingcore:8fd818a7.f457 --> <!-- req editingcore:28f714ff.2c06 --> <!-- req editingcore:28f714ff.0970 -->
  acceptSuggestion(index: number): void {
    // 範囲の外の index と整数でない index は配列の要素を引けず undefined になる
    const suggestion = this.techniqueSuggestions[index];
    if (suggestion === undefined) return;
    const { position, stringNumber } = suggestion.target;
    this.history.execute(new SetTechniqueCommand(this.target, position, stringNumber, suggestion.patch));
    // コマンドが当たると onCommandApplied でも捨てるが、承認したら閉じることをここでも示す（7.1 節）
    this.dismissSuggestions();
  }

  /** Esc：タイと奏法記号の候補を捨て、何も付けない。 */
  // <!-- req editingcore:dbeaa35e.4fc8 --> <!-- req editingcore:dbeaa35e.f8f7 --> <!-- req editingcore:0f9dc716.a9c6 --> <!-- req editingcore:d222e544.ac5c -->
  // <!-- req editingcore:8da4a1b0.f94e --> <!-- req editingcore:8da4a1b0.69ef --> <!-- req editingcore:8da4a1b0.6c7a --> <!-- req editingcore:8da4a1b0.5342 -->
  dismissSuggestions(): void {
    // <!-- req 00:48e69d47.7130 -->
    this.tieSuggestion = null;
    this.techniqueSuggestions = NO_TECHNIQUE_SUGGESTIONS;
  }

  // ===== 記号・属性 =====

  /**
   * タイを付ける・外す（editing-core.md 6 節）。タイの候補があれば候補の前の音符の `tieToNext` を、
   * 無ければカーソルの拍の stringNumber の弦の音符の `tieToNext` を変える。
   */
  // <!-- req editingcore:d1ef9059.3c28 --> <!-- req editingcore:d1ef9059.d40d --> <!-- req editingcore:d1ef9059.f0d7 --> <!-- req editingcore:d1ef9059.020b -->
  setTie(stringNumber: number, tied: boolean): void {
    // <!-- req 00:48e69d47.1270 --> <!-- req 00:48e69d47.eece --> <!-- req 00:48e69d47.c0ed -->
    const candidate = this.tieSuggestion;
    // <!-- req editingcore:6a216c80.8fb5 --> <!-- req editingcore:dbeaa35e.f21f --> <!-- req editingcore:dbeaa35e.49b5 -->
    // <!-- req editingcore:d1ef9059.83d2 --> <!-- req editingcore:d1ef9059.1a85 -->
    const ref: NoteRef = candidate ?? { position: this.cursor.position, stringNumber };
    // <!-- req editingcore:6a216c80.5dbd --> <!-- req editingcore:6a216c80.4c44 -->
    this.history.execute(new SetTieCommand(this.target, ref.position, ref.stringNumber, tied));
  }

  /**
   * 現在の範囲選択へスラーを付与する（範囲の音符に共通の slurGroupId を付ける `SetSlurCommand`、editing-core.md 6 節・9 節）。
   * 範囲へのスラー付与は、範囲を決めた後にできることの一式に入る（9 節、honnin-queue 59 番）。選択が無ければ何もしない。
   */
  // <!-- req editingcore:ff927923.57c8 -->
  // <!-- req editingcore:8da4a1b0.02f1 --> <!-- req editingcore:8da4a1b0.598a -->
  setSlur(): void {
    // <!-- req 00:48e69d47.77a9 -->
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
   * 選択範囲が無いときも先に `validateBeatDuration` で確かめ、弾かれたら context に `barIndex` を入れずに知らせ（入力ツールバーの
   * 連符の「任意」の欄に赤枠を付けるため、4.3 節）、今の入力音価を変えない。通れば今の入力音価を変える（`CursorController.setDuration`。
   * コマンドにせず、取り消しの対象にしない）。そのうえで、「和音」ボタンが入っていて和音の入力の途中なら確定し、置いた拍から、
   * 音を置いたときと同じ進め方で 1 つ進める（4.7 節。→ の確定と同じ `confirmChordAndStep`）。確定した後もボタンは入れたままにする
   * （4.7 節の (b)）。途中でなければカーソルは動かさない。
   */
  // <!-- req editingcore:ff927923.2272 -->
  // <!-- req editingcore:a327195d.0726 --> <!-- req editingcore:e3a4a919.be61 --> <!-- req editingcore:e3a4a919.c9ee --> <!-- req editingcore:e3a4a919.fd3c -->
  setDuration(spec: BeatDurationSpec): void {
    // <!-- req 00:48e69d47.a87e --> <!-- req 00:48e69d47.d8f8 --> <!-- req 00:48e69d47.9341 --> <!-- req 00:48e69d47.deb8 -->
    const range = this.cursor.selection;
    // 音価の確かめは、コマンドを出す前と、今の入力音価を変える前に行う
    // <!-- req editingcore:aeb95fc9.ee6b -->
    const outcome = this.validation.validateBeatDuration(spec);
    // <!-- req editingcore:aeb95fc9.72b7 -->
    if (range === null) {
      if (!outcome.ok) {
        // <!-- req editingcore:aeb95fc9.3ff4 -->
        this.reporter.report(outcome.code, outcome.context);
        return;
      }
      // <!-- req editingcore:60cb6efa.5f5f -->
      // <!-- req editingcore:a327195d.bdef -->
      this.cursor.setDuration(spec);
      // <!-- req editingcore:3306efc4.830c --> <!-- req editingcore:a327195d.9468 --> <!-- req editingcore:e3a4a919.7c3b -->
      if (this.cursor.chordInputMode) this.confirmChordAndStep(true);
      return;
    }
    if (!outcome.ok) {
      // <!-- req editingcore:aeb95fc9.d8e6 --> <!-- req editingcore:aeb95fc9.d5d4 -->
      this.reporter.report(outcome.code, {
        ...outcome.context,
        trackIndex: range.trackIndex,
        barIndex: range.startBarIndex,
      });
      return;
    }
    // <!-- req editingcore:c881ad1c.1349 --> <!-- req editingcore:c881ad1c.0b65 --> <!-- req editingcore:c881ad1c.0510 --> <!-- req editingcore:c881ad1c.8e3c -->
    // <!-- req editingcore:c20973a2.f9c7 -->
    // <!-- req editingcore:a327195d.935e -->
    const children = collectRangeBeats(this.target.score, range).map(
      ({ barIndex, index }) =>
        new SetBeatDurationCommand(
          this.target,
          { trackIndex: range.trackIndex, barIndex, voiceIndex: range.voiceIndex, beatIndex: index },
          spec,
        ),
    );
    if (children.length === 0) return;
    // <!-- req editingcore:c881ad1c.cf9e --> <!-- req editingcore:c20973a2.7a71 -->
    // <!-- req editingcore:e3a4a919.73b7 -->
    this.history.execute(new CompositeCommand('set-beat-duration', 'set-beat-duration', children));
  }

  // <!-- req editingcore:0f9dc716.25fe --> <!-- req editingcore:0f9dc716.c469 --> <!-- req editingcore:757a18c3.32c9 --> <!-- req editingcore:757a18c3.9ea7 -->
  // <!-- req editingcore:a420e60c.7d56 --> <!-- req editingcore:a420e60c.a374 --> <!-- req editingcore:a420e60c.194b --> <!-- req editingcore:a420e60c.0a60 -->
  setTechnique(stringNumber: number, patch: NoteTechniquePatch): void {
    // <!-- req 00:48e69d47.5d36 -->
    this.history.execute(new SetTechniqueCommand(this.target, this.cursor.position, stringNumber, patch));
  }

  /** 利用者が手で直したコード名を、カーソルの拍の `Beat.text` に入れる（editing-core.md 8 節。null で手の値を外す）。 */
  // <!-- req editingcore:ba7e6984.2eaa --> <!-- req editingcore:ba7e6984.f160 --> <!-- req editingcore:ba7e6984.3128 --> <!-- req editingcore:ba7e6984.47b3 -->
  setChordName(name: string | null): void {
    // <!-- req 00:48e69d47.d29d -->
    // <!-- req editingcore:bf8bce48.bf04 --> <!-- req editingcore:bf8bce48.4abc -->
    this.history.execute(new SetChordNameCommand(this.target, this.cursor.position, name));
  }

  /**
   * Beat の奏法記号（スラップ・ポップ・タップ・ブラシ）を、カーソルの拍に付ける・外す（editing-core.md 4.8 節・7.3 節）。
   * 弦を持たない Beat の属性なので、弦を受けずに `SetBeatTechniqueCommand` を発行する。
   */
  // <!-- req editingcore:85e62931.43ae --> <!-- req editingcore:85e62931.284e --> <!-- req editingcore:85e62931.a3ef -->
  setBeatTechnique(patch: BeatTechniquePatch): void {
    // <!-- req 00:48e69d47.30a4 -->
    this.history.execute(new SetBeatTechniqueCommand(this.target, this.cursor.position, patch));
  }

  /** 小節 `barIndex` の BPM を設定する。入力可能範囲（20〜400）外は発行しない（editing-core.md 3.8 節・4.8 節）。null で継承へ戻す。 */
  // <!-- req editingcore:a9eb7fa2.6304 --> <!-- req editingcore:a9eb7fa2.5577 --> <!-- req editingcore:a9eb7fa2.2b81 --> <!-- req editingcore:a9eb7fa2.c857 --> <!-- req editingcore:a9eb7fa2.42a6 -->
  setTempo(barIndex: number, bpm: number | null): void {
    // <!-- req 00:48e69d47.e6b7 -->
    if (bpm !== null && !isValidTempoBpm(bpm)) return;
    this.history.execute(new SetTempoCommand(this.target, barIndex, bpm));
  }

  // ===== メモ・セクションマーカー =====

  // <!-- req editingcore:efb4d6ab.492c -->
  // <!-- req editingcore:e2662203.0ae9 --> <!-- req editingcore:e2662203.702b --> <!-- req editingcore:e2662203.f32f --> <!-- req editingcore:e2662203.f7ed -->
  addMemo(barIndex: number, text: string): void {
    // <!-- req 00:48e69d47.68e0 -->
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
  // <!-- req editingcore:dc0e3ba5.1108 --> <!-- req editingcore:dc0e3ba5.3f1c --> <!-- req editingcore:dc0e3ba5.375a --> <!-- req editingcore:dc0e3ba5.4ce9 -->
  editMemo(memoId: string, text: string): void {
    // <!-- req 00:48e69d47.b372 -->
    // <!-- req editingcore:99a76868.a17c -->
    const { value, outcome } = this.validation.validateMemoText(text);
    if (!outcome.ok) this.reporter.report(outcome.code, outcome.context);
    // <!-- req editingcore:efb4d6ab.ec2f --> <!-- req editingcore:99a76868.8c98 -->
    this.history.execute(new EditMemoCommand(this.target, memoId, value));
  }

  // <!-- req editingcore:13491055.66e2 --> <!-- req editingcore:13491055.b4db --> <!-- req editingcore:13491055.b75a -->
  deleteMemo(memoId: string): void {
    // <!-- req 00:48e69d47.df13 -->
    this.history.execute(new DeleteMemoCommand(this.target, memoId));
  }

  // <!-- req editingcore:9598f372.708d --> <!-- req editingcore:9598f372.d6bb --> <!-- req editingcore:9598f372.afde --> <!-- req editingcore:9598f372.ef24 -->
  addSectionMarker(barIndex: number, label: string): void {
    // <!-- req 00:48e69d47.e886 -->
    this.history.execute(new AddSectionMarkerCommand(this.target, barIndex, label));
  }

  // <!-- req editingcore:c6de41fc.072f --> <!-- req editingcore:c6de41fc.a058 --> <!-- req editingcore:c6de41fc.e878 --> <!-- req editingcore:c6de41fc.e86e -->
  editSectionMarker(markerId: string, label: string): void {
    // <!-- req 00:48e69d47.ffde -->
    this.history.execute(new EditSectionMarkerCommand(this.target, markerId, label));
  }

  // <!-- req editingcore:5cc9a6d7.a835 --> <!-- req editingcore:5cc9a6d7.bb99 --> <!-- req editingcore:5cc9a6d7.b15d -->
  deleteSectionMarker(markerId: string): void {
    // <!-- req 00:48e69d47.b4e4 -->
    this.history.execute(new DeleteSectionMarkerCommand(this.target, markerId));
  }

  // ===== 小節 =====

  /**
   * 小節を `at` へ足す（editing-core.md 5 節の表の EDIT-003 の行）。確かめ（`validateBarInsertion`）が拒んだら、
   * 確かめが返す `{ current, count, max }` に、足そうとした位置 `{ trackIndex, barIndex }` を足して知らせる。
   * `trackIndex` は編集しているパート（カーソルのパート）、`barIndex` は `at`（小節の数より後ろなら最後の小節、
   * 0 より前なら最初の小節）で、画面はその小節を赤枠にする。
   */
  // <!-- req editingcore:0b61d56f.069c --> <!-- req editingcore:0b61d56f.c887 --> <!-- req editingcore:0b61d56f.2ec4 -->
  insertBar(at: number): void {
    // <!-- req 00:48e69d47.2ac5 -->
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
  // <!-- req editingcore:210f5e46.6f79 --> <!-- req editingcore:210f5e46.27af --> <!-- req editingcore:210f5e46.3871 -->
  async deleteBar(at: number): Promise<void> {
    // <!-- req 00:48e69d47.8b87 --> <!-- req 00:48e69d47.51ba -->
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
    // <!-- req editingcore:0930c37d.e7b6 --> <!-- req editingcore:e642d2e9.a351 --> <!-- req editingcore:1cbcaf96.fbc6 --> <!-- req editingcore:1cbcaf96.0461 -->
    const disposition = await this.barDeleteConfirmer.confirm({ barIndex: at, markerCount, memoCount });
    // <!-- req editingcore:1cbcaf96.b467 -->
    this.history.execute(new DeleteBarCommand(this.target, at, disposition));
  }

  /**
   * 既存の小節の拍子を変える（editing-core.md 10 節、G26 の是正）。null は継ぐ状態へ戻す。値のときは発行の前に
   * `validateTimeSignature`（`EDIT-010`）で確かめ、拒むときは知らせてコマンドを出さない（5 節）。
   */
  // <!-- req editingcore:46b4eea2.079e --> <!-- req editingcore:46b4eea2.a496 --> <!-- req editingcore:46b4eea2.2ea5 --> <!-- req editingcore:46b4eea2.e13b --> <!-- req editingcore:46b4eea2.b7ef -->
  setTimeSignature(barIndex: number, signature: TimeSignatureSpec | null): void {
    // <!-- req 00:48e69d47.0846 -->
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
  // <!-- req editingcore:b07fe7a4.9b41 --> <!-- req editingcore:b07fe7a4.903b --> <!-- req editingcore:b07fe7a4.fa26 --> <!-- req editingcore:b07fe7a4.6dcd -->
  setRepeat(barIndex: number, patch: RepeatPatch): void {
    // <!-- req 00:48e69d47.3e6b -->
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
  // <!-- req editingcore:54bdb477.c422 --> <!-- req editingcore:54bdb477.c90b -->
  copySelection(): void {
    // <!-- req 00:48e69d47.aec1 -->
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
  // <!-- req editingcore:ce29addd.ac77 --> <!-- req editingcore:ce29addd.2020 -->
  cutSelection(): void {
    // <!-- req 00:48e69d47.99ed -->
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
  // <!-- req editingcore:f56c4e6c.0f36 --> <!-- req editingcore:f56c4e6c.6c14 --> <!-- req editingcore:f56c4e6c.98cc --> <!-- req editingcore:f56c4e6c.3a9e --> <!-- req editingcore:f56c4e6c.5420 --> <!-- req editingcore:f56c4e6c.34f1 -->
  copyAt(at: NoteRef | CursorPosition): void {
    // <!-- req 00:48e69d47.b377 -->
    this.clipboard.copyAt(this.target, at);
  }

  /**
   * 選択範囲が無いときの右クリックの「切り取り」（editing-core.md 9 節）。`copyAt(at)` と同じ中身をクリップボードへ置いたうえで、
   * 右クリックした音符か休符の拍を `deleteNoteAt(at)`（4.5 節）と同じ消し方で消す。消す側だけを `DeleteNotesCommand` として履歴に積み、
   * 取り消しで元に戻る。
   */
  // <!-- req editingcore:ed5d3ff1.065e -->
  // <!-- req editingcore:0d0b67bf.e13f --> <!-- req editingcore:0d0b67bf.6fdf --> <!-- req editingcore:0d0b67bf.c432 --> <!-- req editingcore:0d0b67bf.efa2 --> <!-- req editingcore:0d0b67bf.7708 --> <!-- req editingcore:0d0b67bf.f51a -->
  cutAt(at: NoteRef | CursorPosition): void {
    // <!-- req 00:48e69d47.67b7 -->
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
  // <!-- req editingcore:4660d19c.353d --> <!-- req editingcore:4660d19c.3e2b -->
  paste(): void {
    // <!-- req 00:48e69d47.f3fd -->
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
  // <!-- req editingcore:6486cd40.ec40 --> <!-- req editingcore:6486cd40.d4a4 -->
  duplicateSelection(): void {
    // <!-- req 00:48e69d47.8a0b -->
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
  // <!-- req editingcore:a78f9e4a.d339 --> <!-- req editingcore:a78f9e4a.b169 --> <!-- req editingcore:a78f9e4a.bd0a --> <!-- req editingcore:a78f9e4a.c262 -->
  deleteNotes(): void {
    // <!-- req 00:48e69d47.4081 --> <!-- req 00:48e69d47.2a69 --> <!-- req 00:48e69d47.27ac -->
    if (this.deleteSelectionIfAny()) return;
    const position = this.cursor.position;
    const beat = voiceBeats(this.target.score, position.trackIndex, position.barIndex, position.voiceIndex)[
      position.beatIndex
    ];
    if (beat === undefined) return;
    // <!-- req editingcore:5da48106.1094 -->
    if (beat.notes.length === 0) {
      // <!-- req editingcore:b39f8cf3.41cc --> <!-- req editingcore:5da48106.f051 -->
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
  // <!-- req editingcore:93fc6162.6889 --> <!-- req editingcore:93fc6162.ff86 --> <!-- req editingcore:93fc6162.78b7 --> <!-- req editingcore:93fc6162.48ec --> <!-- req editingcore:93fc6162.397b --> <!-- req editingcore:93fc6162.93bc -->
  deleteNoteAt(at: NoteRef | CursorPosition): void {
    // <!-- req 00:48e69d47.3ffd -->
    if (this.deleteSelectionIfAny()) return;
    const command = deleteNotesCommandAt(this.target, at);
    if (command !== null) this.history.execute(command);
  }

  // ===== 音符を動かす（editing-core.md 4.6 節） =====

  /**
   * 左クリック＋ドラッグで音符を動かす（editing-core.md 4.6 節）。画面はドラッグを離したときに 1 回だけ呼ぶ（途中は行き先を示すだけで呼ばない）。
   * 元の音符 `from` を消す `DeleteNotesCommand` と、行き先 `to`（離した所の拍と弦）に同じフレットの数で置く `PlaceNoteCommand` を、
   * kind も履歴の名前（label）も 'move-note' の `CompositeCommand` にまとめて 1 つの履歴の項目にする（1 回の取り消しで元に戻る）。
   * 別の弦へ動かしてもフレットの数を保つ（鳴る音の高さは行き先の弦のチューニングで変わる。フレットの数の範囲はどの弦でも同じなので
   * 範囲の外にならない）。元の拍に音が残らなければ、`DeleteNotesCommand` がその拍を同じ長さの休符の拍として残す（4.5 節）。
   * 行き先の同じ拍・同じ弦に音符があるときは `validateNotePlacement` が `EDIT-001` で拒み、知らせて動かさない（5 節）。
   * 置く音価は、行き先に拍があればその拍の音価（拍の長さを変えない）、無ければ元の拍の音価とする。
   * 元に音符が無いとき・行き先が元と同じ拍の同じ弦のときは何もしない。
   */
  // <!-- req editingcore:a2a487c8.ffbf --> <!-- req editingcore:7aad5af8.da36 --> <!-- req editingcore:7aad5af8.8dfd --> <!-- req editingcore:c75ebe76.8014 --> <!-- req editingcore:c75ebe76.230d --> <!-- req editingcore:c75ebe76.0c0e --> <!-- req editingcore:c75ebe76.4517 -->
  moveNote(from: NoteRef, to: NoteRef): void {
    // <!-- req 00:48e69d47.c717 -->
    const { score } = this.target;
    const source = voiceBeats(score, from.position.trackIndex, from.position.barIndex, from.position.voiceIndex)[
      from.position.beatIndex
    ];
    if (source === undefined) return;
    const note = findNoteOnString(source, from.stringNumber);
    if (note === null) return;
    if (isSamePosition(from.position, to.position) && from.stringNumber === to.stringNumber) return;
    // <!-- req editingcore:cb59db8c.3ef3 --> <!-- req editingcore:cb59db8c.f450 --> <!-- req editingcore:cb59db8c.de4e -->
    const { fret } = note;
    const destination = voiceBeats(score, to.position.trackIndex, to.position.barIndex, to.position.voiceIndex)[
      to.position.beatIndex
    ];
    const spec = durationSpecOf(destination ?? source); // <!-- req editingcore:a2a487c8.a74b --> <!-- req editingcore:a2a487c8.7d5d -->
    // <!-- req editingcore:7aad5af8.e066 --> <!-- req editingcore:7aad5af8.e8cc -->
    // <!-- req editingcore:a3715176.18d8 --> <!-- req editingcore:818541f4.32f1 --> <!-- req editingcore:818541f4.87df -->
    this.runValidated(this.validation.validateNotePlacement(this.target, to.position, to.stringNumber, fret), () =>
      this.history.execute(
        // <!-- req editingcore:a2a487c8.267a --> <!-- req editingcore:a2a487c8.577c --> <!-- req editingcore:a2a487c8.664d --> <!-- req editingcore:bf5f1abb.be15 -->
        // 履歴の名前（label）も 'move-note'（editing-core.md 4.6 節、287 番）
        new CompositeCommand('move-note', 'move-note', [
          // <!-- req editingcore:a2a487c8.e037 -->
          // <!-- req editingcore:a2a487c8.540b --> <!-- req editingcore:3004d5c7.8eff --> <!-- req editingcore:3004d5c7.94bc --> <!-- req editingcore:3004d5c7.80e3 -->
          new DeleteNotesCommand(this.target, [from], []),
          // <!-- req editingcore:a2a487c8.6a21 -->
          new PlaceNoteCommand(this.target, to.position, to.stringNumber, fret, spec),
        ]),
      ),
    );
  }

  // ===== Undo / Redo =====

  // <!-- req editingcore:57f96c72.7ad1 --> <!-- req editingcore:57f96c72.fb41 -->
  undo(): void {
    // <!-- req 00:48e69d47.ffca -->
    this.cursor.applyOutcome(this.history.undo(), this.target);
  }

  // <!-- req editingcore:31c00ee4.3420 --> <!-- req editingcore:31c00ee4.3baa -->
  redo(): void {
    // <!-- req 00:48e69d47.379e -->
    this.cursor.applyOutcome(this.history.redo(), this.target);
  }

  // ===== 読み取り（UI / コード表示用） =====

  /**
   * 指定した拍（パート・小節・ボイス・拍の `CursorPosition`、editing-core.md 4.8 節）の出すコード名（8 節。手で入れた値があればそれ、
   * 無ければ推し量った名前、どちらも無ければ null）。覚え（推し量った候補と手での指定の欄の値の組）が無ければ、手での指定の欄に値があっても
   * `ChordDetectionService.detect` で推し量り、組にして覚える。出す名前は `chooseChordDisplayName`（`resolveDisplayName` と
   * 同じ選び方）で組から選ぶ。
   */
  // <!-- req editingcore:a37c7c1f.dba9 -->
  // <!-- req editingcore:f0106b18.ff08 --> <!-- req editingcore:f0106b18.8511 --> <!-- req editingcore:f0106b18.e06c --> <!-- req editingcore:f0106b18.8520 -->
  chordNameAt(position: CursorPosition): string | null {
    // <!-- req 00:48e69d47.e6d6 -->
    const { trackIndex, barIndex, voiceIndex, beatIndex } = position;
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
  // <!-- req editingcore:6839e2ae.574e --> <!-- req editingcore:6839e2ae.ffb7 -->
  private runValidated(outcome: ValidationOutcome, action: () => CommandOutcome): CommandOutcome | null {
    // <!-- req editingcore:6839e2ae.76c3 -->
    if (!outcome.ok) {
      // <!-- req editingcore:97ec3132.3e0c --> <!-- req editingcore:6839e2ae.e761 -->
      this.reporter.report(outcome.code, outcome.context);
      // <!-- req editingcore:97ec3132.f7c2 -->
      return null;
    }
    return action();
  }
}
