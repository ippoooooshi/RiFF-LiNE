/**
 * 配置と追加の確かめ（editing-core.md 5 節、基本設計 04 章 4 節・11 節。コードのレベルと範囲の正は 00_reference.md 5 節）。
 *
 * 副作用の無い確かめだけを置く。拒むときはエラーコードと文脈を返し、呼ぶ側（`EditingService`・`PartManagementService`）が
 * `NotificationReporter.report(code, context)` で知らせ、コマンドを出さない（editing-core.md 5 節）。
 * Warning のコード（`EDIT-004`・`EDIT-015`）も `ok: false` で返し、呼ぶ側は知らせたうえで操作を続ける。
 * メソッドは editing-core.md 5 節の宣言の 7 つで、パートの数の確かめもここに置き、別のクラスに分けない（同節）。
 */

import type { model } from '@coderline/alphatab';

import { clampMemoText, MEMO_MAX_LENGTH } from '../domain/validation';

import type { RepeatPatch } from './commands/SetRepeatCommand';
import type { TimeSignatureSpec } from './commands/SetTimeSignatureCommand';
import {
  barCount,
  findNoteOnString,
  getMasterBar,
  MAX_BAR_COUNT,
  MAX_FRET,
  MIN_FRET,
  trackCount,
  voiceBeats,
} from './scoreModel';
import type { BeatDurationSpec, CursorPosition, EditTarget, ValidationOutcome } from './types';

const OK: ValidationOutcome = { ok: true };

/** パートの数のハードキャップ（editing-core.md 5 節の表、`EDIT-005`、基本設計 13 章 B20）。 */
export const MAX_PART_COUNT = 8;

/** 拍子の分子の範囲（00_reference.md 5 節の `EDIT-010` の行）。 */
const TIME_SIGNATURE_NUMERATOR_MIN = 1;
const TIME_SIGNATURE_NUMERATOR_MAX = 32;
/** 拍子の分母に使える値（00_reference.md 5 節の `EDIT-010` の行）。 */
const TIME_SIGNATURE_DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** 反復の回数の範囲。0 は「なし」、1 は許さない（基本設計 13 章 B39、`EDIT-011`）。 */
const REPEAT_COUNT_NONE = 0;
const REPEAT_COUNT_MIN = 2;
const REPEAT_COUNT_MAX = 10;

/** 付点の数に使える値（editing-core.md 4.3 節、`EDIT-012`）。 */
const ALLOWED_DOTS: readonly number[] = [0, 1, 2];

/** 何連符かの範囲（editing-core.md 4.3 節、00_reference.md 5 節の `EDIT-016` の行）。 */
const TUPLET_NUMERATOR_MIN = 2;
const TUPLET_NUMERATOR_MAX = 12;

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

// <!-- req editingcore:73054ed4.bec8 -->
export class ValidationService {
  /**
   * 音符を置く・動かすときの確かめ（editing-core.md 5 節の表）。
   * `EDIT-002`（フレットが 0 から 24 の外）を先に見て、範囲の外なら弦の重複を見ない。次に `EDIT-001`（同じ拍の同じ弦にもう音符がある）。
   * `EDIT-002` の context は `{ trackIndex, barIndex }`（カーソルの小節）、`EDIT-001` の context は
   * `{ trackIndex, barIndex, voiceIndex, beatIndex, stringNumber }`（ScoreHighlightBinder がその弦の今ある音符に赤枠を付ける）。
   */
  // <!-- req editingcore:8ba29eb2.9263 -->
  validateNotePlacement(
    target: EditTarget,
    position: CursorPosition,
    stringNumber: number,
    fret: number,
  ): ValidationOutcome {
    // <!-- req editingcore:5e3e2ebe.e305 -->
    if (!isIntegerIn(fret, MIN_FRET, MAX_FRET)) {
      // <!-- req editingcore:5e3e2ebe.7a53 -->
      return {
        ok: false,
        code: 'EDIT-002',
        context: { trackIndex: position.trackIndex, barIndex: position.barIndex },
      };
    }

    // 位置のボイスの拍を見る。2 つ目のボイスがまだ無い小節のボイス 2 は拍が無い（editing-core.md 4.1 節）
    const beat = voiceBeats(target.score, position.trackIndex, position.barIndex, position.voiceIndex)[
      position.beatIndex
    ];
    // <!-- req editingcore:8ba29eb2.3ac4 -->
    if (beat !== undefined && findNoteOnString(beat, stringNumber) !== null) {
      // <!-- req editingcore:8ba29eb2.c217 -->
      return {
        ok: false,
        code: 'EDIT-001',
        context: {
          trackIndex: position.trackIndex,
          barIndex: position.barIndex,
          voiceIndex: position.voiceIndex,
          beatIndex: position.beatIndex,
          stringNumber,
        },
      };
    }
    return OK;
  }

  /**
   * 小節を足すときの確かめ（editing-core.md 5 節の表）。足した後の小節の数が 2048 を超えるなら `EDIT-003`（ハードキャップ、B20）。
   * @param count 足す小節の数（既定 1）。
   */
  // <!-- req editingcore:570b0a02.2f34 -->
  validateBarInsertion(target: EditTarget, count = 1): ValidationOutcome {
    const current = barCount(target.score);
    if (current + count > MAX_BAR_COUNT) {
      // <!-- req editingcore:570b0a02.1118 -->
      return { ok: false, code: 'EDIT-003', context: { current, count, max: MAX_BAR_COUNT } };
    }
    return OK;
  }

  /** パートを足すとき（`AddPartCommand` の前）の確かめ（editing-core.md 5 節の表）。足した後のパートの数が 8 を超えるなら `EDIT-005`（ハードキャップ、B20）。 */
  validatePartCount(target: EditTarget): ValidationOutcome {
    const current = trackCount(target.score);
    if (current + 1 > MAX_PART_COUNT) {
      return { ok: false, code: 'EDIT-005', context: { current, max: MAX_PART_COUNT } };
    }
    return OK;
  }

  /**
   * メモの確かめ（editing-core.md 5 節の表・3.10 節、基本設計 13 章 C13）。入力は止めず、100 文字を超えたら `EDIT-004`（Warning）。
   * @returns `value` は先頭 100 文字に切り詰めた値、`outcome` は超えていれば `EDIT-004`。
   */
  // <!-- req editingcore:ff2e72a0.f2fd --> <!-- req editingcore:99a76868.49f6 -->
  validateMemoText(text: string): { value: string; outcome: ValidationOutcome } {
    const { value, truncated } = clampMemoText(text);
    if (truncated) {
      return { value, outcome: { ok: false, code: 'EDIT-004', context: { max: MEMO_MAX_LENGTH } } };
    }
    return { value, outcome: OK };
  }

  /**
   * 拍子の確かめ（editing-core.md 5 節・10 節）。分子が 1 から 32 の整数でないか、分母が 1・2・4・8・16・32 でないなら `EDIT-010`。
   * context は `{ numerator, denominator }` で barIndex を持たせない（拍子の入力欄を赤枠にする、screens-navigation.md 13.1 節）。
   */
  validateTimeSignature(signature: TimeSignatureSpec): ValidationOutcome {
    const { numerator, denominator } = signature;
    if (
      !isIntegerIn(numerator, TIME_SIGNATURE_NUMERATOR_MIN, TIME_SIGNATURE_NUMERATOR_MAX) ||
      !TIME_SIGNATURE_DENOMINATORS.includes(denominator)
    ) {
      return { ok: false, code: 'EDIT-010', context: { numerator, denominator } };
    }
    return OK;
  }

  /**
   * リピートの確かめ（editing-core.md 5 節・10 節、基本設計 13 章 B39）。
   * - 回数が 0 か 2 から 10 の整数でないなら `EDIT-011`（Error、拒む）。context は `{ repeatCount }` で barIndex を持たせない
   *   （反復回数の入力欄を赤枠にする、screens-navigation.md 13.1 節）。
   * - 終わり（回数 2 以上）を付けるのに、その小節かそれより前に開始（`isRepeatStart`）が無いなら `EDIT-015`（Warning、知らせたうえで発行する）。
   *   同じ patch で付ける開始も数える。
   */
  validateRepeat(score: model.Score, barIndex: number, patch: RepeatPatch): ValidationOutcome {
    const { repeatCount } = patch;
    if (repeatCount === undefined || repeatCount === REPEAT_COUNT_NONE) return OK;
    if (!isIntegerIn(repeatCount, REPEAT_COUNT_MIN, REPEAT_COUNT_MAX)) {
      return { ok: false, code: 'EDIT-011', context: { repeatCount } };
    }
    const startsHere = patch.isRepeatStart ?? getMasterBar(score, barIndex).isRepeatStart;
    const startsBefore = score.masterBars.slice(0, barIndex).some((masterBar) => masterBar.isRepeatStart);
    if (!startsHere && !startsBefore) {
      return { ok: false, code: 'EDIT-015', context: { barIndex, repeatCount } };
    }
    return OK;
  }

  /**
   * 音価の確かめ（editing-core.md 4.3 節・5 節）。付点の数が 0・1・2 でないなら `EDIT-012`、
   * 連符の何連符か（分子）が 2 から 12 の整数でないなら `EDIT-016`。付点を先に見る。
   * 小節の音価の合計が拍子を超えても短くても拒まない（5 節の表）ので、ここでは小節を見ない。
   * context の `{ trackIndex, barIndex }` は起きた操作で分けるので、呼ぶ側が入れる（4.3 節）。
   */
  validateBeatDuration(spec: BeatDurationSpec): ValidationOutcome {
    if (!ALLOWED_DOTS.includes(spec.dots)) {
      return { ok: false, code: 'EDIT-012', context: { dots: spec.dots } };
    }
    if (spec.tuplet !== null && !isIntegerIn(spec.tuplet.numerator, TUPLET_NUMERATOR_MIN, TUPLET_NUMERATOR_MAX)) {
      return { ok: false, code: 'EDIT-016', context: { tupletNumerator: spec.tuplet.numerator } };
    }
    return OK;
  }
}
// <!-- req webcorefoundation:5488154e.da95 -->
