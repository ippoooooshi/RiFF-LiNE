---
mode: 'agent'
description: '次の作業パッケージに着手する（読み合わせ → ブランチ作成 → 6ステップワークフロー開始）'
---

# 作業パッケージ着手

[`docs/basic_design/15_development_process.md`](../../docs/basic_design/15_development_process.md) §4.2 の 6 ステップワークフローを開始する。

## 手順

1. **対象パッケージの特定**
   - `.claude/settings.meta.json` の `workflow.phases` と §4.1（Phase 1 実施順序）/ §4.1.1（Phase 2）を確認する
   - [`docs/basic_design/00_overview.md`](../../docs/basic_design/00_overview.md) の進捗ログで、直前まで完了しているパッケージを確認する
   - 次に着手すべきパッケージ（またはユーザー指定のパッケージ）を確定する。実施順序上の前提パッケージが未完なら、その旨をユーザーに報告して止まる

2. **読み合わせ（ステップ1）**
   - 対象パッケージの `docs/detailed_design/<スラッグ>.md`（既存。なければ作成対象）
   - 対応する `docs/basic_design/*`
   - [`docs/detailed_design/00_reference.md`](../../docs/detailed_design/00_reference.md) の §3（関連クラスの現行シグネチャ）・§4（非破壊拡張ポイント）・§5（エラーコード）・**§8.1（既知ギャップ。対象パッケージに関連する未解消ギャップが無いか必ず確認）**
   - [`docs/basic_design/13_design_decision_points.md`](../../docs/basic_design/13_design_decision_points.md) の関連分岐点。未決着のカテゴリB／C事項があれば着手前に決着させる（品質KPI: 着手前 0 件）

3. **ブランチ作成**
   - `feature/<スラッグ>`（詳細設計書ファイル名と一致）。XL サイズはサブ機能単位に分割可（`feature/<スラッグ>-<サブ機能>`）
   - **git 操作はユーザーの承認を得てから実行する**（`.claude/docs/conventions.md`）

4. **以降**: `Workflow({ name: 'orchestrate', args: '<パッケージ名>を実装' })` で design → design-review → impl → impl-review を進めるか、手動で 6 ステップを回す

5. **完了時**: [phase-gate スキル](../skills/phase-gate/SKILL.md) の「作業パッケージ完了時の同期更新チェックリスト」と DoD 6 項目（[workflow.md](../docs/workflow.md)）をすべて満たしてから PR 作成
