# 命名規則・Git 運用・バージョニング（運用索引）

> 権威: [`docs/basic_design/15_development_process.md`](../../docs/basic_design/15_development_process.md) §2・§3・§8、[`docs/detailed_design/00_reference.md`](../../docs/detailed_design/00_reference.md) §7。

## ブランチ運用（§3.1）

- `feature/<英語スラッグ>`。詳細設計書ファイル名（`docs/detailed_design/<スラッグ>.md`）と一致必須
- `main` は常にビルド可能・アプリ起動可能に保つ
- マージ: GitHub PR → CI ステータスチェック通過 → **Squash merge** → feature ブランチ削除
- 実験は `spike/` プレフィックス（`main` にマージしない使い捨て）

## コミットメッセージ（§3.2、commitlint で機械強制）

Conventional Commits: `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:` / `ci:` / `build:` / `perf:`。

Claude が作成するコミットは末尾に:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```
PR 本文の末尾に:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Git 操作の制約

- **impl フェーズでの git 操作（commit / push / ブランチ作成）は自動実行禁止。** ユーザーが明示的に指示した場合のみ
- 破壊的操作（`reset --hard` / `push --force` / ブランチ削除）は必ず事前確認
- スコープ外変更を検出したら `git stash` で退避し、別課題として切り出す

## バージョニング（§8、B24）

- **バージョンの単位はプラットフォーム（アプリ）ごとに独立**
  - PC版: `apps/desktop/package.json` の `version`。Phase 1 完了時点で v0.x、実運用開始で v1.0.0
  - iPhone版（Phase 3）: `apps/mobile/package.json` の `version`。PC版の番号とは独立系列
- `packages/core` は独立した公開APIバージョニングを持たない（モノレポ内の単一ワークスペース扱い）
- 作業パッケージ単位のマージでは機械的にバージョンを上げず、Phase の節目で番号を切る
- バージョン文字列をコードにハードコードしない。UI は実行時にパッケージ情報から参照

## ID 採番

- 要件 ID: `REQ-`（要件台帳 = `docs/tab_app_requirements.md`）。要件内容そのものの変更はユーザー確認必須
- テスト ID: `UT-` / `IT-`（[`docs/basic_design/11_test_strategy.md`](../../docs/basic_design/11_test_strategy.md) §3 の対象一覧）
- 既知ギャップ: `G<番号>`（`docs/detailed_design/00_reference.md` §8.1。解消時も削除せず「解消済み（日付・対応パッケージ）」に書き換え）
- 新規採番の前に必ず対象文書を検索し、衝突が無いか確認。衝突検出時は即停止してユーザーへ報告

## PowerShell / シェル

`.ps1` を作る場合は ASCII 限定・エンコーディングに注意（Windows 環境）。一時ファイルはプロジェクト外の scratchpad へ。
