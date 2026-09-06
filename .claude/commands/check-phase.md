---
mode: 'ask'
description: '現在の承認済みフェーズ・進行中の作業パッケージを判定し、依頼内容との差分を提示する'
---

# フェーズ確認

現在の承認済みフェーズ・作業パッケージと依頼内容を突き合わせ、範囲内か超過かを報告する。実装は行わない。

## 手順

1. `.claude/settings.meta.json` の `workflow.phases` から承認済みフェーズを、[`docs/basic_design/15_development_process.md`](../../docs/basic_design/15_development_process.md) §4.1 から Phase 1 実施順序を取得する
2. [`docs/basic_design/00_overview.md`](../../docs/basic_design/00_overview.md) の進捗ログで、現在どの作業パッケージまで完了しているかを確認する
3. 判定ロジックは [phase-gate スキル](../skills/phase-gate/SKILL.md) に従う
4. 直前の依頼内容を分類する
   - 詳細設計書の作成・更新
   - 基本設計／`00_reference.md`／`13_design_decision_points.md` の更新
   - 実装コード作成・変更（`packages/**` `apps/**`）
   - テストコード作成・変更
   - ビルド／バージョニング
   - 設定ファイル整備（`.claude/` 配下）
5. 依頼が「現在の作業パッケージの範囲内」「依存関係の薄い小粒な作業（§4.2 末尾）」「範囲超過」のいずれかを判定する
6. 超過と判定した場合は phase-gate スキルの確認文テンプレを提示する
