---
mode: 'agent'
description: '型チェック → Lint → 単体テスト → 結合テスト を順に実行し、失敗を分析する（実装変更は行わない）'
---

# テスト実行と失敗分析

## コマンド

`.claude/settings.meta.json` の `commands` に従う:

- 型チェック: `pnpm typecheck`（= `tsc -b`）
- Lint: `pnpm lint`（= `eslint .`。レイヤー依存規則はビルトイン `no-restricted-imports` で強制）
- テスト: `pnpm test`（= `vitest run`。単体＋結合）

個別実行が必要なら `pnpm --filter <pkg> test` や `vitest run <path>` を使う。

## 手順

1. `pnpm typecheck` を実行し、型エラーが無いことを確認する（あればテスト実行前に報告）
2. `pnpm lint` を実行し、違反 0 を確認する（レイヤー依存違反は特に重視）
3. `pnpm test` で単体テスト（UT）・結合テスト（IT）を実行する
4. 失敗ケースを抽出し、以下の表で報告する

   | ケース | 種別(UT/IT) | エラー要旨 | 推定原因 | 修正候補 |
   | --- | --- | --- | --- | --- |

5. 関連するテスト ID（`UT-XXX` / `IT-XXX`）と、検証対象の詳細設計書の節番号を併記する
6. 修正候補は提案のみ。本コマンド内では実装を変更しない

## 注意

- テスト実行中の標準出力に機微情報が混入していないか確認する
- カバレッジ計測は `pnpm test -- --coverage`（別途）。本コマンドのスコープ外
- ネットワークを要するテストは存在してはならない（[../rules/tests.rule.md](../rules/tests.rule.md)）
