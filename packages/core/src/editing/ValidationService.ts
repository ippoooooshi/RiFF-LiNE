/**
 * ノート配置・小節数・メモ文字数の検証（editing-core.md §7、04_editing_core.md §4・§11）。
 *
 * 純粋ロジック。NG のときはエラーコードと文脈を返し、呼び出し元（`EditingService`）が
 * `NotificationCenter.report()` へ橋渡しする。パッケージ5 が「パート数上限(8)」等をこのクラスへ
 * 非破壊追加する（既存メソッドは変更しない、§7 拡張ポイント）。
 */

import { clampMemoText, MEMO_MAX_LENGTH } from '../domain/validation';

import { barCount, findNoteOnString, getVoice, getBar, MAX_BAR_COUNT, MAX_FRET, MIN_FRET } from './scoreModel';
import type { CursorPosition, EditTarget, ValidationOutcome } from './types';

const OK: ValidationOutcome = { ok: true };

export class ValidationService {
  /**
   * ノート配置の可否（04_editing_core.md §4）。
   * - フレット番号が 0〜24 の範囲外 → `EDIT-002`
   * - 同一 Beat 内の同一弦へ既に音がある（和音入力での重複） → `EDIT-001`
   */
  validateNotePlacement(
    target: EditTarget,
    position: CursorPosition,
    stringNumber: number,
    fret: number,
  ): ValidationOutcome {
    if (!Number.isInteger(fret) || fret < MIN_FRET || fret > MAX_FRET) {
      return { ok: false, code: 'EDIT-002', context: { fret, stringNumber, min: MIN_FRET, max: MAX_FRET } };
    }

    const voice = getVoice(getBar(target.score, position.trackIndex, position.barIndex));
    const beat = voice.beats[position.beatIndex];
    if (beat !== undefined && findNoteOnString(beat, stringNumber) !== null) {
      return {
        ok: false,
        code: 'EDIT-001',
        context: { stringNumber, barIndex: position.barIndex, beatIndex: position.beatIndex },
      };
    }
    return OK;
  }

  /** 小節挿入の可否。追加後の小節数が 2048 を超える → `EDIT-003`（ハードキャップ、B20）。 */
  validateBarInsertion(target: EditTarget): ValidationOutcome {
    if (barCount(target.score) >= MAX_BAR_COUNT) {
      return { ok: false, code: 'EDIT-003', context: { current: barCount(target.score), max: MAX_BAR_COUNT } };
    }
    return OK;
  }

  /**
   * メモ本文の検証（`EDIT-004`、C13）。入力自体はブロックせず、保存する値は先頭 100 字へ切り詰める。
   * @returns `value`＝永続化してよい文字列、`outcome`＝上限到達なら `EDIT-004`（Warning）。
   */
  validateMemoText(text: string): { value: string; outcome: ValidationOutcome } {
    const { value, truncated } = clampMemoText(text);
    if (truncated) {
      return { value, outcome: { ok: false, code: 'EDIT-004', context: { max: MEMO_MAX_LENGTH } } };
    }
    return { value, outcome: OK };
  }
}
