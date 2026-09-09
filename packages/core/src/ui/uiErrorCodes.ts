/**
 * 画面群・ナビゲーションが登録するエラーコード（screens-navigation.md §3.5、00_reference.md §5 の登録パッケージ = 8 の行）。
 *
 * `ErrorCodeRegistry` への非破壊追加。`editErrorCodes.ts` / `partErrorCodes.ts` と同じ方式で、
 * `ui/index.ts` の読み込み時に共有 `errorCodeRegistry` へ副作用登録する。
 *
 * レベルは実挙動（拒否 / 継続）と揃える（B20 の教訓、00_reference.md §8 運用ルール）：
 * - `TAG-001` … 50 件ハードキャップ超過で作成自体を拒否 → Error
 * - `SONG-001` … 900 件到達の予告的警告、追加は継続可 → Warning
 * - `SONG-002` … 1000 件ハードキャップ到達で新規作成を拒否 → Error（C12）
 */

import type { ErrorCodeDefinition, ErrorCodeRegistry } from '../errors';

/** コード → 定義。 */
export const UI_ERROR_CODES: Readonly<Record<string, ErrorCodeDefinition>> = {
  /** タグ総数が上限（50）を超える作成操作（B20 で Warning→Error 再分類、13_design_decision_points.md B20）。 */
  'TAG-001': {
    level: 'error',
    messageTemplate: 'タグは50個までです。これ以上追加できません。',
  },
  /** 曲数が警告しきい値（900、上限の 90%）に到達（拒否は伴わない予告的警告）。 */
  'SONG-001': {
    level: 'warning',
    messageTemplate: '曲数が {context.count} 件になりました。上限（1000件）に近づいています。',
  },
  /** 曲数が上限（1000）に到達した新規曲作成（C12、design_review_2026-09-03 A-3）。 */
  'SONG-002': {
    level: 'error',
    messageTemplate: '曲数の上限（1000件）に達しています。新しい曲を作成できません。',
  },
};

/** `UI_ERROR_CODES` をレジストリへ一括登録する。画面群パッケージの初期化時に 1 回呼ぶ。 */
export function registerUiErrorCodes(registry: ErrorCodeRegistry): void {
  for (const [code, definition] of Object.entries(UI_ERROR_CODES)) {
    registry.register(code, definition);
  }
}
