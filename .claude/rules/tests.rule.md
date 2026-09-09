---
applyTo: "**/*.test.{ts,tsx}"
---

# テスト実装規約

> 権威: [`docs/basic_design/11_test_strategy.md`](../../docs/basic_design/11_test_strategy.md)、運用索引は [../docs/testing.md](../docs/testing.md)。

## フレームワーク・配置

- **Vitest**（`vitest.workspace.ts` で各パッケージを集約）
- 単体テスト: 対象ファイルと同じディレクトリの `<対象>.test.ts`（`packages/core/src/**`）
- 結合テスト: `apps/desktop/src/main/*.test.ts`（実 I/O・IPC 契約の往復）

## 命名・トレーサビリティ

- テスト名: `<対象>_<条件>_<期待結果>`（例: `ElectronFileSystemAdapter_MissingPath_ThrowsFileNotFoundError`）
- **プレフィックスは採番簿（[`docs/basic_design/11_test_strategy.md`](../../docs/basic_design/11_test_strategy.md) §3.1）で予約されたものだけを使う。** 新しい対象を足すときは実装と同じターンで採番簿へ行を足す（予約せずに使わない）
- 記載場所は次の 2 か所に分ける（同じ節番号を全テストへ書き写さないため）:

  ```ts
  // UT-PLAY-SVC: PlaybackService（再生・シーク・ループ・ソロ・preWarm）   ← ファイル先頭: プレフィックスと対象
  // 検証節: playback-integration.md §4.6.2                              ← ファイル先頭: 検証する詳細設計書の節
  …
    it('PlaybackService_ループ終端_開始小節へ再シークする', () => {
      // UT-PLAY-SVC-07 §4.6.2「ループ境界の扱い」                        ← 各テスト: 連番 ID（＋必要なら細目）
  ```

  ファイル内の全テストが同じ節を検証する場合、節番号はファイル先頭の 1 行で足りる。テストごとに検証する細目が異なる場合は各テストの ID 行に併記する。
- 連番は同一ファイル内で 01 から。**既存の番号は再利用しない**（削除したテストの番号は欠番のまま残す。番号が指す対象が入れ替わると過去の記録と照合できなくなるため）
- **機械的強制**：`pnpm check:test-ids`（CI ゲート）が「全テストファイルが予約済みプレフィックスの ID を最低 1 つ持つ」「使われているプレフィックスが採番簿に存在する」を検査する。このルールは以前から存在したが、予約簿も検査も無かったため 87 ファイル中 33 ファイルで守られていなかった（監査 MJ-A5／MJ-A7）

## カバレッジ（完了条件）

- 実装した**全メソッド**で C0（命令網羅）100% / C1（分岐網羅）100%
- [`11_test_strategy.md`](../../docs/basic_design/11_test_strategy.md) §2 の「C2 対象ロジック一覧」に該当するものは C2（条件網羅）まで
- 振る舞いを変えたのに旧仕様のままテストが通る状態（false positive）は不可。変更に対応する UT / IT を必ず同期

## UT 方針

- 外部ライブラリ（`@coderline/alphatab` 等）・I/O（fs・IPC）はモックまたは fake で差し替え
- 純粋ロジックを中心に検証

## IT 方針

- OS の一時ディレクトリ（`os.tmpdir()` 配下）にテスト用フォルダを作成し、テスト後に必ず破棄
- ライフサイクル（初期化 → 操作 → クローズ）の通し動作を検証
- IPC は fake `ipcMain` / `ipcRenderer` でハンドラを捕捉し、チャンネル契約（[`web-core-foundation.md`](../../docs/detailed_design/web-core-foundation.md) §4.1）どおりに委譲されることを確認

## 禁止事項

- 本番データファイル・実ストレージルートの参照
- ネットワーク通信
- 機微情報を assertion メッセージ・ログに含めること
- テスト実行順依存
- プラットフォーム都合で決定的に再現できないケースを無理に PASS させること（`it.skip` + 理由コメントを明記して残す）

## 検証ゲート

コード変更後、完了報告の前に `pnpm typecheck` / `pnpm lint` / `pnpm test` がすべて緑であることを確認する。失敗時は出力とともに正直に報告する。
