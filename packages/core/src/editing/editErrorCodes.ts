/**
 * タブ譜編集コアが登録するエラーコード（editing-core.md §7、00_reference.md §5 の登録パッケージ = 4 の行）。
 *
 * `ErrorCodeRegistry` への非破壊追加。`error-logging-foundation.md` のコア8コードとは衝突しない。
 * レベルは 00_reference.md §5・`04_editing_core.md` §11 と一致（B20 の教訓：レベルは実挙動＝拒否/継続と揃える）。
 */

import type { ErrorCodeDefinition, ErrorCodeRegistry } from '../errors';

/** コード → 定義。パート数上限（`EDIT-005`〜`007`）はパッケージ5が別途登録する（§14 申し送り）。 */
export const EDIT_ERROR_CODES: Readonly<Record<string, ErrorCodeDefinition>> = {
  /** 同一 Beat 内で同一弦へ重複配置（04_editing_core.md §4）。配置を拒否し該当弦をハイライト。 */
  'EDIT-001': {
    level: 'error',
    messageTemplate: '同じ弦の同じ位置には音を重ねられません。',
  },
  /** フレット番号が 0〜24 の範囲外（04_editing_core.md §4）。 */
  'EDIT-002': {
    level: 'error',
    messageTemplate: 'フレット番号は 0〜24 の範囲で入力してください。',
  },
  /** 小節数が 2048 を超える追加（B20 で Warning→Error 再分類。ハードキャップ＝追加拒否）。 */
  'EDIT-003': {
    level: 'error',
    messageTemplate: '小節数の上限（2048）に達しています。これ以上追加できません。',
  },
  /** メモ文字数が上限（100字）に達した（C13：入力はブロックせず保存内容を先頭100字へ切り詰める）。 */
  'EDIT-004': {
    level: 'warning',
    messageTemplate: 'メモは100文字までです。超過分は保存時に切り詰められます。',
  },
  /** `CommandHistory` のメモリ予算超過による Undo/Redo 履歴のエビクションがセッション中に初めて発生（C11）。 */
  'EDIT-008': {
    level: 'info',
    messageTemplate: 'Undo/Redo の履歴が上限に達したため、古い操作の取り消し記録を破棄しました。',
  },
};

/** `EDIT_ERROR_CODES` をレジストリへ一括登録する。編集コアの初期化時に 1 回呼ぶ。 */
export function registerEditErrorCodes(registry: ErrorCodeRegistry): void {
  for (const [code, definition] of Object.entries(EDIT_ERROR_CODES)) {
    registry.register(code, definition);
  }
}
