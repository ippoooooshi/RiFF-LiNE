/**
 * 本パッケージ（エラー・ログ基盤）が確定・登録するエラーコードの初期セット
 * （error-logging-foundation.md §4、00_reference.md §5 のうち登録パッケージ = 3 の行）。
 *
 * 前 2 パッケージ（Webコア基盤構築 / データモデル・永続化）の暫定処理を置き換えるのに必要な最小セット。
 * 以降のパッケージは自分の担当ドメイン（`EDIT-xxx` 等）を各詳細設計で追加登録する。
 */

import type { ErrorCodeRegistry } from './ErrorCodeRegistry';
import type { ErrorCodeDefinition } from './types';

/**
 * コード → 定義。レベルは 00_reference.md §5 と一致（B20 の教訓：レベルは実際の挙動＝拒否/継続と揃える）。
 * メッセージは 08_error_logging.md §5 の文言方針（見出しで何が起きたか、本文で原因と選択肢）に沿う。
 */
export const CORE_ERROR_CODES: Readonly<Record<string, ErrorCodeDefinition>> = {
  // --- FILE ドメイン（発生源はデータモデル・永続化パッケージ、error-logging-foundation.md §9.2・§9.3） ---

  /** `AutoSaveScheduler` のリトライ全滅（data-model-persistence.md §3.2）。 */
  'FILE-001': {
    level: 'error',
    messageTemplate: '保存に失敗しました。保存先の空き容量・アクセス権を確認してください。',
  },
  /**
   * `IntegrityCheckFailedError`（チェックサム不一致、data-model-persistence.md §4.2）。
   * 「復元しますか？」に対応する実手段は `LocalBackupService.restore()`（B25、G13 解消）。
   */
  'FILE-002': {
    level: 'critical',
    messageTemplate: 'データの整合性エラーを検知しました。直前の自動保存内容から復元しますか？',
  },
  /** クラウド同期フォルダのオンデマンドダウンロードのリトライ全滅（data-model-persistence.md §6、A5）。 */
  'FILE-003': {
    level: 'error',
    messageTemplate: 'クラウド同期フォルダ内のファイルにアクセスできません。同期状況を確認してください。',
  },
  /** `SchemaMigrator` の `UnsupportedSchemaVersionError`（data-model-persistence.md §3.2）。 */
  'FILE-004': {
    level: 'critical',
    messageTemplate: 'このファイルは新しいバージョンのアプリで作成されたため開けません。',
  },
  /** `MirrorSyncService` のミラー書き込み失敗。主保存は正常（data-model-persistence.md §3.2）。 */
  'FILE-005': {
    level: 'warning',
    messageTemplate: 'ミラー先への保存に失敗しました（主保存は正常です）。',
  },

  // --- SYS ドメイン（発生源は本パッケージのクラッシュ検知・復旧、error-logging-foundation.md §2.3） ---

  /** レンダラークラッシュからの復旧成功。 */
  'SYS-001': {
    level: 'warning',
    messageTemplate: '直前のクラッシュから復旧しました。',
  },
  /** 同一セッション内で繰り返しクラッシュ（暫定判定：3 回、error-logging-foundation.md §2.3）。 */
  'SYS-002': {
    level: 'critical',
    messageTemplate: 'クラッシュが繰り返し発生しています。ログフォルダを確認してください。',
  },

  // --- RENDER ドメイン（発生源は Webコア基盤構築パッケージ、error-logging-foundation.md §9.1） ---

  /** `ScoreRenderHost` の `renderError`（web-core-foundation.md §3.1）。 */
  'RENDER-001': {
    level: 'error',
    messageTemplate: '譜面の描画に失敗しました。',
  },
};

/**
 * `CORE_ERROR_CODES` をレジストリへ一括登録する。アプリ起動時（`errors/index.ts` の共有シングルトン生成時）
 * に 1 回呼ばれる。
 */
export function registerCoreErrorCodes(registry: ErrorCodeRegistry): void {
  for (const [code, definition] of Object.entries(CORE_ERROR_CODES)) {
    registry.register(code, definition);
  }
}
