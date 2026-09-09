---
mode: 'agent'
description: '設計ドキュメント全体（basic_design 16 + detailed_design 10 + 00_reference）の横断整合を独立監査し、矛盾・未履行の申し送り・G1 を洗い出す。検出のみ、是正は sdlc-design。'
---

# 設計横断整合監査（Phase 1 完成・製品化 D1）

対象は特定パッケージではなく**設計体系全体**。ゴールは [`.claude/docs/phase1-productization.md`](../docs/phase1-productization.md) の G-D-1 / G-D-2。
出典・運用ルールは [`docs/basic_design/15_development_process.md`](../../docs/basic_design/15_development_process.md) §6（C6 セルフレビュー運用）・§9、[`.claude/rules/docs.rule.md`](../rules/docs.rule.md)。

## 手順

1. **対象棚卸し**
   - `docs/tab_app_requirements.md`（要件台帳）
   - `docs/basic_design/*.md`（16 冊）
   - `docs/detailed_design/*.md`（10 冊。うち `00_reference.md` は横断リファレンス）
   - `docs/review/*.md`（過去の監査で既出の指摘・A-/B-/G- 番号）

2. **独立 3 観点で `sdlc-design-review` を並行起動**（実装との対話履歴を持たない別セッション。§6 C6）。各観点に上記対象一式と本コマンドの狙いを渡す:
   - **観点A トレーサビリティ**: 要件 → basic_design → detailed_design → `00_reference.md` §3（クラス登録簿）/ §5（エラーコード）の連鎖に、欠落・二重定義・未反映が無いか。要件 ID（`REQ-`）・テスト ID（`UT-`/`IT-`）の対応漏れ
   - **観点B クロスリファレンス**: Wikilink `[[相対パス#見出し]]` の指す節が実在するか（G19 型）。ある detailed_design が別 detailed_design のクラス／メソッド名を引用している箇所が、原典の現行シグネチャと一致するか（G3 型の命名不一致）
   - **観点C 申し送りの履行**: ある detailed_design が「別パッケージへ」「Phase 2 へ」「実装フェーズへ」と書いた申し送りが、受け側で実際に設計／実装されたか（G6 / G10 型の食い違い）。`00_reference.md` §8.1 の未解消ギャップ（G1〜）それぞれの現況

3. **統合と記録**
   - 3 観点の指摘を重複排除して統合し、重大度（Blocking / Major / Minor）と是正方針（設計是正 / `13_design_decision_points.md` 分岐点登録 / `00_reference.md` §8.1 に G 番号追記）を付ける
   - `docs/review/design_audit_<YYYY-MM-DD>.md` に記録する（`docs.rule.md` の「変更ログ目的の新規 md 禁止」は `docs/` 一般の話で、`docs/review/` の**監査記録は従来どおり作成可**。既存 3 本と同じ体裁）

4. **G1 解消計画**
   - WP4〜8（`editing-core` / `part-tuning-management` / `view-modes` / `playback-integration` / `screens-navigation`）の各 detailed_design について、責務レベル止まりのクラス一覧と、`00_reference.md` §3 の as-built シグネチャで埋められるもの／実コードを読んで確認が要るものを仕分けする

## 禁止事項

- 設計ドキュメントの**是正はしない**（本コマンドは検出のみ。是正は D1 本体の `sdlc-design`）
- `packages/**` `apps/**` のコード変更
- `git` 操作

## 出力

- 矛盾・欠落リスト（重大度 × 対象ファイル × 是正方針）
- G1 埋め戻し計画（detailed_design × クラス × 埋め方）
- `docs/review/design_audit_<日付>.md` のパス
