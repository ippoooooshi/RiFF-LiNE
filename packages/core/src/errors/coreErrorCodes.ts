/**
 * 本パッケージ（エラー・ログ基盤）が確定・登録するエラーコードの初期セット
 * （error-logging-foundation.md 4 節、00_reference.md 5 節のうち登録パッケージ = 3 の行と、
 * data-model-persistence.md 14.2 節の `FILE-009`〜`FILE-011`、12 節の `FILE-012`〜`FILE-014`、14.1 節の `FILE-015`）。
 *
 * 前 2 パッケージ（Webコア基盤構築 / データモデル・永続化）の暫定処理を置き換えるのに必要な最小セット。
 * 以降のパッケージは自分の担当ドメイン（`EDIT-xxx` 等）を各詳細設計で追加登録する。
 */

import type { ErrorCodeRegistry } from './ErrorCodeRegistry';
import type { ErrorCodeDefinition } from './types';

/**
 * コード → 定義。レベルは 00_reference.md 5 節と一致（B20 の教訓：レベルは実際の挙動＝拒否/継続と揃える）。
 * メッセージは 08_error_logging.md 5 節の文言方針（見出しで何が起きたか、本文で原因と選択肢）に沿う。
 */
export const CORE_ERROR_CODES: Readonly<Record<string, ErrorCodeDefinition>> = {
  // --- FILE ドメイン（発生源はデータモデル・永続化パッケージ、error-logging-foundation.md 9.2 節・9.3 節） ---

  /** `AutoSaveScheduler` のリトライ全滅（data-model-persistence.md 15 節）。 */
  'FILE-001': {
    level: 'error',
    messageTemplate: '保存に失敗しました。保存先の空き容量・アクセス権を確認してください。',
  },
  /**
   * `IntegrityCheckFailedError`（チェックサム不一致、data-model-persistence.md 7 節・8 節）。
   *
   * 「復元しますか？」に対応する実手段は `LocalBackupService.restore()`（B25、G13 解消）。
   */
  'FILE-002': {
    level: 'critical',
    messageTemplate: 'データの整合性エラーを検知しました。直前の自動保存内容から復元しますか？',
  },
  /** クラウド同期フォルダのオンデマンドダウンロードのリトライ全滅（data-model-persistence.md 16 節、A5）。 */
  // <!-- req datamodelpersistence:8b0bd457.9e33 -->
  // <!-- req datamodelpersistence:8b0bd457.6984 -->
  'FILE-003': {
    level: 'error',
    messageTemplate: 'クラウド同期フォルダ内のファイルにアクセスできません。同期状況を確認してください。',
  },
  /** `SchemaMigrator` の `UnsupportedSchemaVersionError`（data-model-persistence.md 8 節）。 */
  'FILE-004': {
    level: 'critical',
    messageTemplate: 'このファイルは新しいバージョンのアプリで作成されたため開けません。',
  },
  /** `MirrorSyncService` のミラー書き込み失敗。主保存は正常（data-model-persistence.md 14.1 節）。 */
  'FILE-005': {
    level: 'warning',
    messageTemplate: 'ミラー先への保存に失敗しました（主保存は正常です）。',
  },
  /**
   * ゴミ箱の復元期限の残りが 3 日以下の曲がある。アプリの起動ごとに 1 回まで（data-model-persistence.md 17 節の
   * `runStartupCleanup` が `TrashService.findExpiringSoon` の後に出す、00_reference.md 5 節）。`context.count` は曲の数。
   */
  'FILE-007': {
    level: 'warning',
    messageTemplate: 'ゴミ箱の {context.count} 曲が 3 日以内に完全に削除されます',
  },
  /**
   * 壊れた曲のファイル：JSON として読めない・いちばん上がオブジェクトでない・`schemaVersion` が空でない文字列でない
   * （`CorruptSongFileError`、data-model-persistence.md 8 節、00_reference.md 5 節）。新しい版のファイルの `FILE-004` とは分ける。
   *
   * 文言は error-logging-foundation.md 4 節の見出しと本文。「復元する」は `FILE-002` と同じ `LocalBackupService.restore(songId)`。
   */
  'FILE-008': {
    level: 'critical',
    messageTemplate:
      'このファイルは壊れているため開けません。このファイルは中身が壊れていて、曲のデータとして読み込めません。保存の途中で書き込みが止まったか、ほかのアプリで書き換えられた可能性があります。ひとつ前に保存した内容（自動保存を含む）を復元しますか？',
  },
  /**
   * 同じフォルダを主ストレージとミラー先の両方に選んだ（ミラー先どうしが同じフォルダのときを含む）。
   * `StorageConfigService.validateMirrorConfig` の `errors`（data-model-persistence.md 14.2 節、00_reference.md 5 節）。
   */
  'FILE-009': {
    level: 'error',
    messageTemplate:
      '同じフォルダが保存先に 2 回選ばれています。主ストレージとミラー先には、それぞれ別のフォルダを選んでください。',
  },
  /** iCloud Drive 用と Google Drive 用のフォルダに同じパスを選んだ（data-model-persistence.md 14.2 節、00_reference.md 5 節）。 */
  // <!-- req datamodelpersistence:563c39d8.4c58 -->
  'FILE-010': {
    level: 'error',
    messageTemplate:
      '1 つのフォルダを iCloud Drive と Google Drive の両方に選ぶことはできません。それぞれ別のフォルダを選んでください。',
  },
  /** 主＝iCloud Drive＋ミラー＝Google Drive の冗長な組み合わせ。止めない（data-model-persistence.md 14.2 節、00_reference.md 5 節）。 */
  // <!-- req datamodelpersistence:bb01e4cd.8d4f -->
  'FILE-011': {
    level: 'info',
    messageTemplate:
      '主ストレージが iCloud Drive で、ミラー先が Google Drive の組み合わせは冗長です（このまま使えます）。',
  },
  /** 保存先の移行を始める前の確かめ。移している間は編集できないことを伝える（data-model-persistence.md 12 節、00_reference.md 5 節）。 */
  // data-model-persistence.md 12 節：移す前の確かめは Critical の FILE-012 で、移している間は編集できないことを文に書く <!-- req datamodelpersistence:b7a5dbbd.d36d --> <!-- req datamodelpersistence:b7a5dbbd.2400 --> <!-- req datamodelpersistence:bf179033.1a47 -->
  'FILE-012': {
    level: 'critical',
    messageTemplate: '保存先を新しいフォルダへ移します。移している間は、開いている曲を編集できません。移しますか？',
  },
  /**
   * 保存先の移行の失敗。主ストレージは古いフォルダのまま（data-model-persistence.md 12 節、00_reference.md 5 節）。
   * 失敗した中身は `context.failedCount`（件数）と `context.failedPaths`（`TabApp/` からの相対パス）で出す。
   */
  // data-model-persistence.md 12 節：移行の失敗は Critical の FILE-013 で、失敗した中身（件数とパス）を出す <!-- req datamodelpersistence:863de9d9.c0cc --> <!-- req datamodelpersistence:bf179033.9d31 -->
  'FILE-013': {
    level: 'critical',
    messageTemplate:
      '保存先の移行に失敗しました（{context.failedCount} 件）：{context.failedPaths}。保存先は元のフォルダのままです。',
  },
  /** 保存先の移行の終わり。古いフォルダはそのまま残すことを伝える（data-model-persistence.md 12 節、00_reference.md 5 節）。 */
  // data-model-persistence.md 12 節：移行の終わりは Info の FILE-014 で、古いフォルダはそのまま残すので中身を確かめてから手で片付けるよう伝える <!-- req datamodelpersistence:9c9329ea.ae26 --> <!-- req datamodelpersistence:9c9329ea.1404 --> <!-- req datamodelpersistence:bf179033.5d4b --> <!-- req datamodelpersistence:a86df126.3e9d -->
  'FILE-014': {
    level: 'info',
    messageTemplate:
      '保存先の移行が終わりました。元のフォルダのファイルは消さずに残してあります。中身を確かめてから片付けてください。',
  },
  /**
   * 終了のときにミラーの写しを 15 秒待っても終わらなかった（`MirrorSyncService.awaitPending` が `false`、
   * data-model-persistence.md 14.1 節、00_reference.md 5 節）。画面に出さず、呼んだ main の終了の処理がログにだけ書く
   * （最後のウィンドウを閉じた後で、出す画面が無いため）。
   */
  // <!-- req datamodelpersistence:9eee465a.8c43 -->
  // <!-- req datamodelpersistence:9eee465a.cc31 -->
  // <!-- req datamodelpersistence:9eee465a.8e6e -->
  'FILE-015': {
    level: 'warning',
    messageTemplate: 'ミラー先への写しが終わる前にアプリを終了しました（主ストレージへの保存は終わっています）。',
  },

  // --- SONG ドメインのうち永続化が出すもの（SONG-001・SONG-002 は ui/uiErrorCodes.ts） ---

  /**
   * `index.json` が読めず、`SongIndexService.rebuildFromSongsFolder()` で `songs/` から作り直した
   * （data-model-persistence.md 9.1 節、00_reference.md 5 節）。`context.songCount` は作り直した曲の数。
   */
  'SONG-003': {
    level: 'warning',
    // <!-- req datamodelpersistence:e0d0ca5c.e716 -->
    messageTemplate: '曲一覧を読み込めなかったため作り直しました（{context.songCount} 曲）',
  },

  // --- SYS ドメイン（発生源は本パッケージのクラッシュ検知・復旧、error-logging-foundation.md 2.3 節） ---

  /** レンダラークラッシュからの復旧成功。 */
  'SYS-001': {
    level: 'warning',
    messageTemplate: '直前のクラッシュから復旧しました。',
  },
  /** 同一セッション内で繰り返しクラッシュ（暫定判定：3 回、error-logging-foundation.md 2.3 節）。 */
  'SYS-002': {
    level: 'critical',
    messageTemplate: 'クラッシュが繰り返し発生しています。ログフォルダを確認してください。',
  },

  // --- RENDER ドメイン（発生源は Webコア基盤構築パッケージ、error-logging-foundation.md 9.1 節） ---

  /** `ScoreRenderHost` の `renderError`（web-core-foundation.md 12.1 節）。 */
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
