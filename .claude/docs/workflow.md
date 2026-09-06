# 開発フロー（運用エントリポイント）

> **権威ドキュメントは [`docs/basic_design/15_development_process.md`](../../docs/basic_design/15_development_process.md)。**
> 本ファイルはそれを Claude Code のセッション運用に落とし込んだ索引であり、方針の出典は常に上記。矛盾を見つけたら上記を正とし、本ファイルを直す。

## V字モデル（§1.1）

要件定義 → 基本設計 → 詳細設計 → 実装、の各左側工程が、運用テスト / システムテスト / 結合テスト / 単体テスト に対応する。詳細設計工程は独立工程（§1.2）。

## セッションの6ステップワークフロー（§4.2）

1 セッション = 1 作業パッケージ（または §3 で分割したサブ機能）を主題とする。

1. **読み合わせ** — 該当する基本設計・詳細設計・[`00_reference.md`](../../docs/detailed_design/00_reference.md) の関連箇所、および `00_reference.md` §8.1（既知ギャップ）を読む
2. **詳細設計書作成** — `docs/detailed_design/<スラッグ>.md` を新規作成、既存なら差分更新。エージェント `sdlc-design`
3. **実装** — 詳細設計書 + `00_reference.md` §3 のシグネチャに従う。エージェント `sdlc-impl`。git 操作は禁止
4. **テスト** — テスト後書き（§5）。L/XL サイズはサブ機能の区切りごとに追加。カバレッジ基準は [testing.md](testing.md)
5. **セルフレビュー** — §6 の観点で、実装との対話履歴を持たない別セッション（またはサブエージェント `sdlc-impl-review` / `/code-review`）に PR 差分を渡す。**サイズによらず全作業パッケージが対象**
6. **PR作成** — Squash マージ前提。コミットメッセージは Conventional Commits（commitlint 準拠、[conventions.md](conventions.md)）

## Definition of Done（§7）— 6項目すべて

1. 該当基本設計書の記載内容を満たす（満たせない場合は設計書側を更新するか `13_design_decision_points.md` に新規分岐点として記録）
2. 詳細設計書（`docs/detailed_design/<スラッグ>.md`）が作成され、実装と整合している
3. §5 のタイミングで単体テストが追加され、[`11_test_strategy.md`](../../docs/basic_design/11_test_strategy.md) §0 の品質KPI（全メソッド C0/C1 100%、対象ロジック C2）を満たしてパス。該当範囲の結合テストも実施済み
4. §6 のセルフレビューを実施し、指摘に対応済み
5. 手動シナリオ確認（システムテスト観点）を最低1シナリオ実施
6. CI が通り、`main` にマージ済みで、アプリが起動・動作する状態

## ブランチ命名（§3.1）

`feature/<英語スラッグ>`。対応する詳細設計書ファイル名（`docs/detailed_design/<スラッグ>.md`）と一致させる。
例: `detailed_design/editing-core.md` ↔ `feature/editing-core`。
XL サイズはサブ機能単位で分割可（例: `feature/editing-core-step-input`）。
実験的変更は `spike/` プレフィックス、`main` にマージしない。

## Phase 1 実施順序（§4.1、B11 で確定）

1 Webコア基盤構築 → 2 データモデル・永続化 → 3 エラー/ログ基盤 → 4 タブ譜編集コア → 5 パート・チューニング管理 → 6 表示モード → 7 再生エンジン統合 → 8 画面群・ナビゲーション

## 【最重要】文書同時改訂の原則

1 つの決定・修正を行うとき、関連する全ドキュメントを**同じターンで**更新する。詳細は [../rules/docs.rule.md](../rules/docs.rule.md)。

## エージェント / ワークフロー / コマンド

- エージェント: `.claude/agents/`（`sdlc-plan` / `sdlc-design` / `sdlc-design-review` / `sdlc-impl` / `sdlc-impl-review`）— すべてプロジェクトローカル、`~/.claude` に非依存
- ワークフロー: `Workflow({ name: 'orchestrate', args: 'リクエスト' })` で plan → design → design-review → impl → impl-review を自動実行
- コマンド: `.claude/commands/`（`run-tests` / `check-phase` / `append-gap` / `bump-version` / `new-wp`）
- スキル: `.claude/skills/phase-gate/SKILL.md`

## モデル選択（目安）

| フェーズ | モデル |
|---|---|
| plan / design-review / impl-review | haiku（分析・チェック項目照合） |
| design | sonnet（ドキュメント整合の作り込み） |
| impl | opus（推定ステップ数 ≥ 2）/ sonnet（< 2） |

ユーザー指定があればそれに従う。
