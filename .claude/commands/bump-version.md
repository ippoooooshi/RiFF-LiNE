---
mode: 'agent'
description: 'アプリ（プラットフォーム）ごとに独立したバージョンを更新する'
---

# バージョン更新

> 権威: [`docs/basic_design/15_development_process.md`](../../docs/basic_design/15_development_process.md) §8、[`docs/basic_design/13_design_decision_points.md`](../../docs/basic_design/13_design_decision_points.md) B24。

## 前提: バージョンはプラットフォームごとに独立

- PC版: `apps/desktop/package.json` の `version`（`.claude/settings.meta.json` の `project.versionFile`）
- iPhone版（Phase 3）: `apps/mobile/package.json` の `version`（PC版とは独立系列）
- `packages/core` / `packages/shared-types` は独立した公開APIバージョニングを持たない（更新対象外）

## 入力

更新種別（`major` / `minor` / `patch`）か明示バージョン文字列、および対象アプリ（既定: `apps/desktop`）。省略時は `minor` / `apps/desktop`。

## 手順

1. 対象アプリの `package.json` から現在バージョンを読む
2. 新バージョンを計算する（`major`: MAJOR+1・MINOR=0・PATCH=0 ／ `minor`: MINOR+1・PATCH=0 ／ `patch`: PATCH+1 ／ 明示指定: SemVer 検証のうえそのまま）
3. 対象アプリの `package.json` の `version` のみを書き換える
4. 旧 → 新バージョンと更新ファイルパスをサマリ出力する

## 注意

- 作業パッケージ単位のマージでは機械的にバージョンを上げない。Phase の節目（Phase 1 完了で v0.x、実運用開始で v1.0.0）で切る
- 本プロジェクトの設計書は「変更履歴テーブル」ではなく `00_overview.md` の進捗ログで履歴を管理する。バージョンの節目を進捗ログに 1 行記録する
- コード中にバージョン文字列をハードコードしない（UI は実行時にパッケージ情報から参照）
- タグ付け・push はユーザーの明示指示がない限り行わない
