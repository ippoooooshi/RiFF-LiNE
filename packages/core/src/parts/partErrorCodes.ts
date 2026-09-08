/**
 * パート・チューニング管理が登録するエラーコード（part-tuning-management.md §4.4、00_reference.md §5 の
 * 登録パッケージ = 5 の行）。`ErrorCodeRegistry` への非破壊追加。
 *
 * `EDIT-005`（パート数上限）は B20 により Warning→Error へ再分類済み（ハードキャップ）。
 */

import type { ErrorCodeDefinition, ErrorCodeRegistry } from '../errors';

export const PART_ERROR_CODES: Readonly<Record<string, ErrorCodeDefinition>> = {
  /** パート数が 8 を超える追加操作の拒否（ハードキャップ、B20）。 */
  'EDIT-005': {
    level: 'error',
    messageTemplate: 'パート数の上限（8）に達しています。これ以上追加できません。',
  },
  /** チューニングプリセット適用で弦数が減り、消える弦上の音を破棄した（part-tuning-management.md §3.2）。 */
  'EDIT-006': {
    level: 'warning',
    messageTemplate: '弦数が減るチューニングを適用したため、一部の弦の音は破棄されました。',
  },
  /** カポ位置が 0〜12 の範囲外（B14）。 */
  'EDIT-007': {
    level: 'error',
    messageTemplate: 'カポの位置は 0〜12 フレットの範囲で指定してください。',
  },
};

export function registerPartErrorCodes(registry: ErrorCodeRegistry): void {
  for (const [code, definition] of Object.entries(PART_ERROR_CODES)) {
    registry.register(code, definition);
  }
}
