/**
 * `ValidationService`（editing-core.md §7）の非破壊拡張（part-tuning-management.md §3.1・§4.4）。
 *
 * 基底クラスのメソッド（`validateNotePlacement` 等）はそのまま継承し、パート・チューニング固有の
 * 検証メソッドを**サブクラスとして追加**する（基底のシグネチャは一切変更しない）。
 * `PartManagementService` / `TuningPresetService` はこのサブクラスを使う。
 */

import { ValidationService } from '../editing';
import type { EditTarget, ValidationOutcome } from '../editing';

import { getStringCount, trackCount } from './partModel';

/** パート数のハードキャップ（要件5.3、B20）。 */
export const MAX_PART_COUNT = 8;

/** カポ位置の範囲（B14）。 */
export const MIN_CAPO_FRET = 0;
export const MAX_CAPO_FRET = 12;

const OK: ValidationOutcome = { ok: true };

export class PartValidationService extends ValidationService {
  /** パート追加の可否。追加後のパート数が 8 を超える → `EDIT-005`（Error、ハードキャップ）。 */
  validatePartCount(target: EditTarget): ValidationOutcome {
    if (trackCount(target.score) >= MAX_PART_COUNT) {
      return { ok: false, code: 'EDIT-005', context: { current: trackCount(target.score), max: MAX_PART_COUNT } };
    }
    return OK;
  }

  /** カポ変更の可否。0〜12 の整数以外 → `EDIT-007`（Error）。 */
  validateCapoFret(capoFret: number): ValidationOutcome {
    if (!Number.isInteger(capoFret) || capoFret < MIN_CAPO_FRET || capoFret > MAX_CAPO_FRET) {
      return { ok: false, code: 'EDIT-007', context: { capoFret, min: MIN_CAPO_FRET, max: MAX_CAPO_FRET } };
    }
    return OK;
  }

  /**
   * チューニングプリセット適用が弦数減少で Note を破棄しうるか（`EDIT-006`、Warning）。
   * NG（＝破棄あり）でも適用自体は続行する（`EditingService` の runValidated とは扱いが異なり、
   * 呼び出し元は report しつつコマンドを発行する）。破棄の実処理は `ApplyTuningPresetCommand` が行う。
   * @param newStringCount 適用するプリセットの弦数。
   */
  validateTuningPresetApplication(target: EditTarget, trackIndex: number, newStringCount: number): ValidationOutcome {
    const current = getStringCount(target.score, trackIndex);
    if (newStringCount < current) {
      return { ok: false, code: 'EDIT-006', context: { from: current, to: newStringCount } };
    }
    return OK;
  }
}
