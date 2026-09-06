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
- 各テストの先頭コメントに、対応するテスト ID（`// UT-XXX` / `// IT-XXX`）と、検証している詳細設計書の節番号を明記

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
