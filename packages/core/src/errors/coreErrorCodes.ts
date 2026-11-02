/**
 * 本パッケージ（エラー・ログ基盤）が登録するエラーコード（error-logging-foundation.md 4 節、00_reference.md 5 節）。
 *
 * - `CORE_ERROR_CODES`：00_reference.md 5 節の登録パッケージ = 3 の 13 行（`FILE-001`〜`FILE-005`・`FILE-008`・
 *   `SYS-001`〜`SYS-006`・`RENDER-001`）。前 2 パッケージの暫定処理を置き換えるのに必要な最小セットで、 <!-- req errorloggingfoundation:5cc2a4a1.9d87 -->
 *   以降のパッケージは自分の担当領域のコード（`EDIT-xxx` など）を各詳細設計で追加登録する（4 節）。 <!-- req errorloggingfoundation:5cc2a4a1.9121 -->
 * - `PERSISTENCE_ERROR_CODES`：登録パッケージ = 2 のうち、このファイルに置いているコード（data-model-persistence.md
 *   14.2 節の `FILE-009`〜`FILE-011`、12 節の `FILE-012`〜`FILE-014`、14.1 節の `FILE-015`、17 節の `FILE-007`、
 *   9.1 節の `SONG-003`）。
 *
 * 文言は 08_error_logging.md 5 節の方針（見出しで何が起きたか、本文で原因と選択肢）に沿う。 <!-- req errorloggingfoundation:5b1b7f48.02f9 --> <!-- req errorloggingfoundation:41c9cfc6.daa4 -->
 */

import type { ErrorCodeRegistry } from './ErrorCodeRegistry';
import type { ErrorCodeDefinition } from './types';

/**
 * 繰り返しクラッシュと判定する、アプリを起動してからの累積回数（error-logging-foundation.md 2.3 節・4 節の `SYS-002`）。
 * `packages/core` に置き、`apps/desktop` の `CrashRecoveryController` はここから読む。`SYS-002` の本文の
 * 「3 回以上」もこの定数から埋め込む。
 */
// <!-- req errorloggingfoundation:c065ba9a.4986 -->
// <!-- req errorloggingfoundation:bd769cb2.1694 -->
export const REPEATED_CRASH_THRESHOLD = 3;

/**
 * 登録パッケージ = 3 の 13 コード（error-logging-foundation.md 4 節の表）。レベルは 00_reference.md 5 節と一致。
 * Critical のコードは `title`（見出し）と `buttons`（肯定・否定をはっきりさせたボタンの文言）を持ち、
 * `messageTemplate` を本文として使う（2.1 節）。
 */
// <!-- req errorloggingfoundation:249656c5.bfe9 -->
export const CORE_ERROR_CODES: Readonly<Record<string, ErrorCodeDefinition>> = {
  // --- FILE ドメイン（発生源はデータモデル・永続化パッケージ） ---

  /**
   * `AutoSaveScheduler` のリトライ全滅（`SongRepository.save()` 自体ではなく、それを呼ぶリトライのループが発生源）。 <!-- req errorloggingfoundation:ae358b03.74d0 --> <!-- req errorloggingfoundation:ae358b03.5bb7 -->
   * 変換前の版を `PreMigration/` へ写せず開かなかったときにも出す（data-model-persistence.md 8 節）。 <!-- req errorloggingfoundation:ae358b03.0927 -->
   */
  // <!-- req errorloggingfoundation:ae358b03.3a0d -->
  // <!-- req 00:99c9766b.1707 --> <!-- req 00:99c9766b.8d98 --> <!-- req 00:99c9766b.c4c9 --> <!-- req 00:99c9766b.6726 -->
  'FILE-001': {
    // <!-- req errorloggingfoundation:ae358b03.b34d -->
    level: 'error',
    // <!-- req errorloggingfoundation:ae358b03.cb40 -->
    messageTemplate: '保存に失敗しました。保存先の空き容量・アクセス権を確認してください',
  },
  /**
   * `IntegrityCheckFailedError`（チェックサム不一致）。`SongRepository.load` が `report('FILE-002', {songId})` を呼ぶ。 <!-- req errorloggingfoundation:5b1b7f48.5b38 -->
   * 「復元する」の実手段は `LocalBackupService.restore(songId)` で、戻る先は保存の直前に退避した 1 世代 <!-- req errorloggingfoundation:5b1b7f48.aeeb -->
   * （最後の保存のひとつ前に保存した内容、自動保存を含む）。
   */
  // <!-- req errorloggingfoundation:5b1b7f48.f70e -->
  // <!-- req 00:8103da9e.5aa1 --> <!-- req 00:8103da9e.31bb --> <!-- req 00:8103da9e.4b37 -->
  'FILE-002': {
    // <!-- req errorloggingfoundation:5b1b7f48.d1f2 -->
    level: 'critical',
    // <!-- req errorloggingfoundation:5b1b7f48.0679 -->
    title: 'データの整合性エラーを検知しました',
    messageTemplate:
      // <!-- req errorloggingfoundation:5b1b7f48.91f0 -->
      'このファイルの中身が、保存したときの記録と一致しません。保存の途中で書き込みが止まったか、ほかのアプリで書き換えられた可能性があります。ひとつ前に保存した内容（自動保存を含む）を復元しますか？',
    // <!-- req errorloggingfoundation:5b1b7f48.a7a0 --> <!-- req errorloggingfoundation:5b1b7f48.c37a -->
    buttons: { confirm: '復元する', cancel: 'キャンセル' },
  },
  /** クラウド同期フォルダのオンデマンドダウンロードのリトライ全滅（data-model-persistence.md 16 節）。 <!-- req errorloggingfoundation:02e78c28.4b75 --> */
  // <!-- req datamodelpersistence:8b0bd457.9e33 -->
  // <!-- req datamodelpersistence:8b0bd457.6984 -->
  // <!-- req errorloggingfoundation:02e78c28.5ba7 -->
  // <!-- req 00:12bcaa72.eeab --> <!-- req 00:12bcaa72.32cb --> <!-- req 00:12bcaa72.9d19 -->
  'FILE-003': {
    // <!-- req errorloggingfoundation:02e78c28.a8bb -->
    level: 'error',
    // <!-- req errorloggingfoundation:02e78c28.fd6c -->
    messageTemplate: 'クラウド同期フォルダ内のファイルにアクセスできません。同期状況を確認してください',
  },
  /**
   * `SchemaMigrator` の `UnsupportedSchemaVersionError`（data-model-persistence.md 8 節）。 <!-- req errorloggingfoundation:2ad8e696.f1a6 -->
   * ダイアログの中で選ぶものは無いので、ボタンは「閉じる」の 1 つだけ。
   */
  // <!-- req errorloggingfoundation:2ad8e696.81ef -->
  // <!-- req 00:d2d4b797.bed4 --> <!-- req 00:d2d4b797.bae3 --> <!-- req 00:d2d4b797.d16b -->
  'FILE-004': {
    // <!-- req errorloggingfoundation:2ad8e696.7374 -->
    level: 'critical',
    // <!-- req errorloggingfoundation:2ad8e696.a823 -->
    title: 'このファイルは開けません',
    messageTemplate:
      // <!-- req errorloggingfoundation:2ad8e696.798e -->
      'このファイルは、今のアプリより新しいバージョンのアプリで保存されているため、読み込めません。ファイルは変更していません。アプリを最新版に更新してから、もう一度開いてください。',
    // <!-- req errorloggingfoundation:2ad8e696.e724 -->
    buttons: { confirm: '閉じる' },
  },
  /** `MirrorSyncService` のミラー書き込み失敗。主保存は正常（data-model-persistence.md 14.1 節）。 <!-- req errorloggingfoundation:fe283230.3895 --> */
  // <!-- req errorloggingfoundation:fe283230.b118 -->
  // <!-- req 00:d4c8541c.bd3d --> <!-- req 00:d4c8541c.000e --> <!-- req 00:d4c8541c.9dce -->
  'FILE-005': {
    // <!-- req errorloggingfoundation:fe283230.8333 -->
    level: 'warning',
    // <!-- req errorloggingfoundation:fe283230.aaa8 -->
    messageTemplate: 'ミラー先への保存に失敗しました（主保存は正常です）',
  },
  /**
   * 壊れた曲のファイル（`CorruptSongFileError`）：(1) JSON として読めない、(2) 最上位がオブジェクトでない、 <!-- req errorloggingfoundation:41c9cfc6.842c -->
   * (3) `schemaVersion` が空でない文字列でない、の 3 つだけ（data-model-persistence.md 8 節）。新しい版の `FILE-004` とは分ける。 <!-- req errorloggingfoundation:41c9cfc6.de15 -->
   * 「復元する」は `FILE-002` と同じ `LocalBackupService.restore(songId)` で、戻る先も `FILE-002` と同じ。 <!-- req errorloggingfoundation:41c9cfc6.6675 -->
   */
  // <!-- req errorloggingfoundation:41c9cfc6.3368 -->
  // <!-- req 00:ec68612e.ad0d --> <!-- req 00:11538a65.94ee --> <!-- req 00:397c7edb.0f29 --> <!-- req 00:397c7edb.5d68 --> <!-- req 00:5727fef6.a61f --> <!-- req 00:5727fef6.f550 --> <!-- req 00:5727fef6.dc23 -->
  'FILE-008': {
    // <!-- req errorloggingfoundation:41c9cfc6.0643 -->
    level: 'critical',
    // <!-- req errorloggingfoundation:41c9cfc6.1454 -->
    title: 'このファイルは壊れているため開けません',
    messageTemplate:
      // <!-- req errorloggingfoundation:41c9cfc6.e86d -->
      'このファイルは中身が壊れていて、曲のデータとして読み込めません。保存の途中で書き込みが止まったか、ほかのアプリで書き換えられた可能性があります。ひとつ前に保存した内容（自動保存を含む）を復元しますか？',
    // <!-- req errorloggingfoundation:41c9cfc6.e747 --> <!-- req errorloggingfoundation:41c9cfc6.7001 -->
    buttons: { confirm: '復元する', cancel: 'キャンセル' },
  },

  // --- SYS ドメイン（発生源は本パッケージ。error-logging-foundation.md 2.3 節・2.5 節・2.6 節） ---

  /** レンダラーのクラッシュからの復旧（2.3 節）。曲や小節を発生源に持たないので context は要らない。 <!-- req errorloggingfoundation:94ac59d4.e320 --> */
  // <!-- req errorloggingfoundation:ce632d5c.8211 -->
  // <!-- req 00:7b1905ba.bf57 --> <!-- req 00:7b1905ba.fd1d --> <!-- req 00:7b1905ba.7336 -->
  // <!-- req errorloggingfoundation:c7d54f51.6289 -->
  'SYS-001': {
    // <!-- req errorloggingfoundation:ce632d5c.368f -->
    level: 'warning',
    // <!-- req errorloggingfoundation:ce632d5c.7107 -->
    // <!-- req errorloggingfoundation:c7d54f51.add6 -->
    messageTemplate: '直前のクラッシュから復旧しました',
  },
  /**
   * 同じセッションで繰り返しクラッシュ（2.3 節）。`context` は `{logFolder}`＝`getLogFolderAbsolutePath()` のパスで、 <!-- req errorloggingfoundation:c065ba9a.37f7 --> <!-- req errorloggingfoundation:c065ba9a.a0a3 -->
   * renderer は `CrashRecoveryState.logFolder` から受け取る。案内はログの場所を文で示すだけで、ボタンは「閉じる」だけ <!-- req errorloggingfoundation:c065ba9a.05e9 -->
   * （ログフォルダを開く手段は設定ダイアログの「アプリ情報」）。
   */
  // <!-- req errorloggingfoundation:c065ba9a.210c -->
  // <!-- req 00:7201a989.29b6 --> <!-- req 00:7201a989.3add --> <!-- req 00:7201a989.7892 -->
  // <!-- req errorloggingfoundation:ad54ece3.4fef -->
  'SYS-002': {
    // <!-- req errorloggingfoundation:c065ba9a.17d1 -->
    level: 'critical',
    // <!-- req errorloggingfoundation:c065ba9a.9cfb -->
    title: '画面の処理が繰り返し異常終了しています',
    // <!-- req errorloggingfoundation:c065ba9a.fe5c --> <!-- req errorloggingfoundation:c065ba9a.c734 -->
    // <!-- req errorloggingfoundation:ad54ece3.c8e0 -->
    messageTemplate: `画面の処理が、アプリを起動してから ${REPEATED_CRASH_THRESHOLD} 回以上、異常終了して開き直されました。原因はログに記録してあります。閉じて作業を続けてください。ログの場所：{context.logFolder}`,
    // <!-- req errorloggingfoundation:c065ba9a.d8f2 -->
    buttons: { confirm: '閉じる' },
  },
  /** フリーズからの復帰（`responsive`、2.3 節の案 A）。 */
  // <!-- req errorloggingfoundation:33672dde.aff7 -->
  // <!-- req 00:a32f7f3d.4da8 --> <!-- req 00:a32f7f3d.5725 --> <!-- req 00:a32f7f3d.45ab -->
  'SYS-003': {
    // <!-- req errorloggingfoundation:33672dde.56df -->
    level: 'warning',
    // <!-- req errorloggingfoundation:33672dde.5877 -->
    // <!-- req 00:a32f7f3d.8ac5 -->
    // <!-- req errorloggingfoundation:981ed938.1f78 -->
    messageTemplate: '一時的に応答が停止していました',
  },
  /** `ErrorBoundary` が画面の部品の描画の例外を受け止めた（2.5 節）。`context` は `{windowKind, error}`。 */
  // <!-- req errorloggingfoundation:37e0d1bb.5ac6 -->
  // <!-- req 00:704acb67.ab90 --> <!-- req 00:704acb67.eb4b --> <!-- req 00:704acb67.41a6 --> <!-- req 00:704acb67.51e2 -->
  // <!-- req errorloggingfoundation:215df0c4.9246 -->
  // <!-- req errorloggingfoundation:215df0c4.c058 -->
  // <!-- req errorloggingfoundation:49344b98.d306 -->
  // <!-- req errorloggingfoundation:49344b98.85a7 -->
  // <!-- req errorloggingfoundation:49344b98.1bfc -->
  'SYS-004': {
    // <!-- req errorloggingfoundation:37e0d1bb.7867 -->
    level: 'error',
    // <!-- req errorloggingfoundation:37e0d1bb.af74 -->
    messageTemplate: '画面の表示中に問題が起きました',
    // <!-- req errorloggingfoundation:37e0d1bb.a7e9 -->
    showOnScreen: false,
    // <!-- req 00:704acb67.020b -->
    // <!-- req errorloggingfoundation:37e0d1bb.6823 -->
    logOnlyReason: '白い画面の代わりに出す画面（見出し・短い説明・「画面を開き直す」ボタン）が知らせるため',
  },
  /**
   * 描画の外で起きた未捕捉の例外（2.6 節）。`context` は `{kind, error}`（`kind` は `error`・`unhandledrejection`・ <!-- req errorloggingfoundation:3680e262.8575 -->
   * `main-uncaughtException`・`main-unhandledRejection` の 4 つ）。
   */
  // <!-- req errorloggingfoundation:3680e262.299c -->
  // <!-- req 00:bf061284.5c4b --> <!-- req 00:bf061284.03d4 --> <!-- req 00:bf061284.3c00 --> <!-- req 00:bf061284.f044 -->
  // <!-- req errorloggingfoundation:a30de309.63e5 -->
  // <!-- req errorloggingfoundation:a30de309.4422 -->
  // <!-- req errorloggingfoundation:3680e262.8717 -->
  'SYS-005': {
    // <!-- req errorloggingfoundation:3680e262.c3fa -->
    level: 'error',
    // <!-- req errorloggingfoundation:3680e262.2a53 -->
    messageTemplate: '描画の外で未捕捉の例外が起きました',
    // <!-- req errorloggingfoundation:3680e262.20d6 -->
    showOnScreen: false,
    // <!-- req 00:bf061284.d727 -->
    logOnlyReason:
      // <!-- req errorloggingfoundation:a30de309.bf80 -->
      'プログラムの誤りで投げた例外を、開発者ツールのコンソールだけでなくログに残すための記録で、使う人に知らせることが無い',
  },
  /**
   * まだ作っていない機能（Phase 2 から後の機能）の入口が押された（4 節、本人決定 K6）。入口が
   * `report('SYS-006', { feature })` を呼ぶ（`feature` は押された入口の名前で、文言には埋め込まない）。 <!-- req errorloggingfoundation:4be7e6fb.916d --> <!-- req errorloggingfoundation:4be7e6fb.0f02 -->
   * トーストで出し、ダイアログにしない。各入口で呼ぶのは入口を作るパッケージ（主に 8 画面群）。
   */
  // <!-- req errorloggingfoundation:4be7e6fb.2748 --> <!-- req errorloggingfoundation:4be7e6fb.c969 -->
  // <!-- req 00:2e93c823.5068 --> <!-- req 00:2e93c823.2de7 --> <!-- req 00:2e93c823.dd79 --> <!-- req 00:2e93c823.b6f8 --> <!-- req 00:2e93c823.b8ef --> <!-- req 00:2e93c823.7c7b -->
  'SYS-006': {
    // <!-- req errorloggingfoundation:4be7e6fb.2dd5 --> <!-- req errorloggingfoundation:4be7e6fb.00c5 --> <!-- req errorloggingfoundation:4be7e6fb.4d1a -->
    level: 'info',
    // <!-- req errorloggingfoundation:4be7e6fb.72ea -->
    // <!-- req 00:2e93c823.5ed9 --> <!-- req 00:2e93c823.7d4c -->
    messageTemplate: '今後のバージョンで対応予定',
    // <!-- req errorloggingfoundation:4be7e6fb.2aeb -->
    // <!-- req 00:2e93c823.cf21 -->
    showOnScreen: true,
  },

  // --- RENDER ドメイン（発生源は Webコア基盤構築パッケージ） ---

  /** `ScoreRenderHost` の `renderError`（web-core-foundation.md 12.1 節）。 <!-- req errorloggingfoundation:bd033a3e.509e --> */
  // <!-- req errorloggingfoundation:bd033a3e.1e65 -->
  // <!-- req 00:0acdb220.ac89 --> <!-- req 00:0acdb220.e7b2 --> <!-- req 00:0acdb220.4f93 -->
  'RENDER-001': {
    // <!-- req errorloggingfoundation:bd033a3e.ad04 -->
    level: 'error',
    // <!-- req errorloggingfoundation:bd033a3e.3a45 -->
    messageTemplate: '譜面の描画に失敗しました',
  },
};

/**
 * 登録パッケージ = 2 のうち、このファイルに置いているコード（00_reference.md 5 節）。
 * レベルは 00_reference.md 5 節と一致。
 */
export const PERSISTENCE_ERROR_CODES: Readonly<Record<string, ErrorCodeDefinition>> = {
  /**
   * ゴミ箱の復元期限の残りが 3 日以下の曲がある。アプリの起動ごとに 1 回まで（data-model-persistence.md 17 節の
   * `runStartupCleanup` が `TrashService.findExpiringSoon` の後に出す、00_reference.md 5 節）。`context.count` は曲の数。
   */
  // <!-- req 00:c4e09d1a.3edc --> <!-- req 00:c4e09d1a.e212 --> <!-- req 00:c4e09d1a.f766 -->
  'FILE-007': {
    level: 'warning',
    // <!-- req 00:c4e09d1a.5422 -->
    messageTemplate: 'ゴミ箱の {context.count} 曲が 3 日以内に完全に削除されます',
  },
  /**
   * 同じフォルダを主ストレージとミラー先の両方に選んだ（ミラー先どうしが同じフォルダのときを含む）。
   * `StorageConfigService.validateMirrorConfig` の `errors`（data-model-persistence.md 14.2 節、00_reference.md 5 節）。
   */
  // <!-- req 00:994d45b4.6900 --> <!-- req 00:994d45b4.7224 --> <!-- req 00:994d45b4.9214 -->
  'FILE-009': {
    level: 'error',
    messageTemplate:
      '同じフォルダが保存先に 2 回選ばれています。主ストレージとミラー先には、それぞれ別のフォルダを選んでください。',
  },
  /** iCloud Drive 用と Google Drive 用のフォルダに同じパスを選んだ（data-model-persistence.md 14.2 節、00_reference.md 5 節）。 */
  // <!-- req datamodelpersistence:563c39d8.4c58 -->
  // <!-- req 00:745a4d07.92a2 --> <!-- req 00:745a4d07.894b --> <!-- req 00:745a4d07.6727 -->
  'FILE-010': {
    level: 'error',
    messageTemplate:
      '1 つのフォルダを iCloud Drive と Google Drive の両方に選ぶことはできません。それぞれ別のフォルダを選んでください。',
  },
  /** 主＝iCloud Drive＋ミラー＝Google Drive の冗長な組み合わせ。止めない（data-model-persistence.md 14.2 節、00_reference.md 5 節）。 */
  // <!-- req datamodelpersistence:bb01e4cd.8d4f -->
  // <!-- req 00:f12ffa53.9f57 --> <!-- req 00:f12ffa53.f310 --> <!-- req 00:f12ffa53.c218 -->
  'FILE-011': {
    level: 'info',
    messageTemplate:
      '主ストレージが iCloud Drive で、ミラー先が Google Drive の組み合わせは冗長です（このまま使えます）。',
  },
  /** 保存先の移行を始める前の確かめ。移している間は編集できないことを伝える（data-model-persistence.md 12 節、00_reference.md 5 節）。 */
  // data-model-persistence.md 12 節：移す前の確かめは Critical の FILE-012 で、移している間は編集できないことを文に書く <!-- req datamodelpersistence:b7a5dbbd.d36d --> <!-- req datamodelpersistence:b7a5dbbd.2400 --> <!-- req datamodelpersistence:43e812df.1a47 -->
  // <!-- req 00:f39b658a.598a --> <!-- req 00:f39b658a.0c19 --> <!-- req 00:f39b658a.8b03 -->
  'FILE-012': {
    level: 'critical',
    // 見出しとボタンは 00_reference.md 5 節の FILE-012 の行（2026-11-01 本人決定）
    // <!-- req 00:f39b658a.7ab7 --> <!-- req datamodelpersistence:43e812df.228c -->
    title: '保存先を移しますか',
    // <!-- req 00:f39b658a.9f1a -->
    messageTemplate: '保存先を新しいフォルダへ移します。移している間は、開いている曲を編集できません。移しますか？',
    // <!-- req 00:f39b658a.29dd --> <!-- req 00:f39b658a.8683 --> <!-- req datamodelpersistence:43e812df.d956 --> <!-- req datamodelpersistence:43e812df.72bb -->
    buttons: { confirm: '移す', cancel: 'キャンセル' },
  },
  /**
   * 保存先の移行の失敗。主ストレージは古いフォルダのまま（data-model-persistence.md 12 節、00_reference.md 5 節）。
   * 失敗した中身は `context.failedCount`（件数）と `context.failedPaths`（`TabApp/` からの相対パス）で出す。
   */
  // data-model-persistence.md 12 節：移行の失敗は Critical の FILE-013 で、失敗した中身（件数とパス）を出す <!-- req datamodelpersistence:863de9d9.c0cc --> <!-- req datamodelpersistence:43e812df.9d31 -->
  // <!-- req 00:75cd5509.4e9a --> <!-- req 00:75cd5509.67d1 --> <!-- req 00:75cd5509.f71d -->
  'FILE-013': {
    level: 'critical',
    // 見出しとボタンは 00_reference.md 5 節の FILE-013 の行（2026-11-01 本人決定）。ダイアログの中で選ぶものが無いので、
    // FILE-004 と同じく「閉じる」の 1 つだけ。
    // <!-- req 00:75cd5509.aa40 --> <!-- req 00:75cd5509.a701 --> <!-- req datamodelpersistence:43e812df.7307 --> <!-- req datamodelpersistence:43e812df.5569 -->
    title: '保存先を移せませんでした',
    messageTemplate:
      '保存先の移行に失敗しました（{context.failedCount} 件）：{context.failedPaths}。保存先は元のフォルダのままです。',
    buttons: { confirm: '閉じる' },
  },
  /** 保存先の移行の終わり。古いフォルダはそのまま残すことを伝える（data-model-persistence.md 12 節、00_reference.md 5 節）。 */
  // data-model-persistence.md 12 節：移行の終わりは Info の FILE-014 で、古いフォルダはそのまま残すので中身を確かめてから手で片付けるよう伝える <!-- req datamodelpersistence:9c9329ea.ae26 --> <!-- req datamodelpersistence:9c9329ea.1404 --> <!-- req datamodelpersistence:43e812df.5d4b --> <!-- req datamodelpersistence:a86df126.3e9d -->
  // <!-- req 00:1d3c5cc2.508e --> <!-- req 00:1d3c5cc2.e86c --> <!-- req 00:1d3c5cc2.6649 --> <!-- req 00:1d3c5cc2.accd -->
  'FILE-014': {
    level: 'info',
    messageTemplate:
      '保存先の移行が終わりました。元のフォルダのファイルは消さずに残してあります。中身を確かめてから片付けてください。',
  },
  /**
   * 終了のときにミラーの写しを 15 秒待っても終わらなかった（`MirrorSyncService.awaitPending` が `false`、
   * data-model-persistence.md 14.1 節、00_reference.md 5 節）。画面に出さず、呼んだ main の終了の処理がログにだけ書く。
   */
  // <!-- req datamodelpersistence:25f2e3af.8c43 -->
  // <!-- req datamodelpersistence:25f2e3af.cc31 -->
  // <!-- req datamodelpersistence:25f2e3af.8e6e -->
  // <!-- req 00:69604054.2952 --> <!-- req 00:69604054.fcd4 --> <!-- req 00:69604054.b667 --> <!-- req 00:69604054.931f -->
  'FILE-015': {
    level: 'warning',
    messageTemplate: 'ミラー先への写しが終わる前にアプリを終了しました（主ストレージへの保存は終わっています）。',
    showOnScreen: false,
    // <!-- req 00:69604054.9420 -->
    // <!-- req datamodelpersistence:25f2e3af.6d05 -->
    logOnlyReason: '最後のウィンドウを閉じた後で、出す画面が無いため',
  },

  // --- SONG ドメインのうち永続化が出すもの（SONG-001・SONG-002 は ui/uiErrorCodes.ts） ---

  /**
   * `index.json` が読めず、`SongIndexService.rebuildFromSongsFolder()` で `songs/` から作り直した
   * （data-model-persistence.md 9.1 節、00_reference.md 5 節）。`context.songCount` は作り直した曲の数。
   */
  // <!-- req 00:dfd5f479.1990 --> <!-- req 00:dfd5f479.4a78 --> <!-- req 00:dfd5f479.c525 -->
  'SONG-003': {
    level: 'warning',
    // <!-- req datamodelpersistence:e0d0ca5c.e716 -->
    // <!-- req 00:dfd5f479.78d5 -->
    messageTemplate: '曲一覧を読み込めなかったため作り直しました（{context.songCount} 曲）',
  },
};

/**
 * `CORE_ERROR_CODES`（13 コード）をレジストリへ一括登録する。アプリ起動時（`errors/index.ts` の共有シングルトンを
 * 作るとき）に 1 回呼ばれる。
 */
export function registerCoreErrorCodes(registry: ErrorCodeRegistry): void {
  registerAll(registry, CORE_ERROR_CODES);
}

/** `PERSISTENCE_ERROR_CODES` をレジストリへ一括登録する。`errors/index.ts` の共有レジストリを作るときに 1 回呼ばれる。 */
export function registerPersistenceErrorCodes(registry: ErrorCodeRegistry): void {
  registerAll(registry, PERSISTENCE_ERROR_CODES);
}

function registerAll(registry: ErrorCodeRegistry, codes: Readonly<Record<string, ErrorCodeDefinition>>): void {
  for (const [code, definition] of Object.entries(codes)) {
    registry.register(code, definition);
  }
}
