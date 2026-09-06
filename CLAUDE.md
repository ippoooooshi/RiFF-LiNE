# CLAUDE.md — タブ譜作成アプリ開発

このファイルは Claude Code がリポジトリのルートで自動的に読み込むファイルです。プロジェクトの全体像・進め方・絶対に守るべきルールをここに凝縮しています。詳細はすべて `docs/` 配下のドキュメントに分散しているので、作業の都度該当ドキュメントを参照してください（このファイル単体では設計判断は完結しません）。

## 1. プロジェクト概要

ギター/ベースのタブ譜（tablature）作成アプリ。個人開発。要件定義→基本設計→詳細設計→実装 の V字モデルで進めており、**現時点で実装（コード）はまだ一切存在しません**。このZIPは基本設計・詳細設計フェーズの成果物一式であり、あなた（Claude Code）が読むべきは大部分がドキュメントであって、既存コードではありません。

詳細な要件は `docs/tab_app_requirements.md` を参照してください。技術スタックの要点だけ挙げると:

- TypeScript / React / Zustand的な状態管理 / Vite / `@coderline/alphatab`（譜面レンダリング）
- Phase 1: Electron デスクトップアプリ（`apps/desktop`）
- Phase 3（将来）: iOS/iPadOS、Expo + WebView（`apps/mobile`、現状は空）
- モノレポ構成: `packages/core`（UIやドメインロジックの大部分）、`packages/shared-types`
- 永続化はカスタムJSONスナップショット形式（`.tabapp`）、alphaTexではない

具体的なモノレポのディレクトリツリーは `docs/basic_design/01_architecture.md`（AD-5）と、より実装に近い形が `docs/detailed_design/web-core-foundation.md` §2 にあります。**このリポジトリにはまだそのツリーは作られていません** — それを作るのが最初のワークパッケージです（§5参照）。

## 2. まず読むべきハブドキュメント

作業を始める前に、以下の「ハブ」文書に目を通してください。個別の詳細設計書を読むときも、疑問が生じたらまずここに立ち返るのが最短です。

- **`docs/detailed_design/00_reference.md`** — 全パッケージ横断のクラス/インターフェース一覧（§3）、非破壊拡張履歴（§4）、エラーコード一覧（§5）、パッケージ依存グラフ（§6, Mermaid）、命名規則（§7）、運用ルール（§8）、既知ギャップ一覧 G1-G21（§8.1）、時系列の修正ログ（§9）。**最も更新頻度が高く最も参照されるドキュメントです。**
- **`docs/basic_design/13_design_decision_points.md`** — 全ての設計判断の根拠カタログ。カテゴリA（技術検証待ち, A1-A12）、カテゴリB（エンジニアリング判断, B1-B29）、カテゴリC（ヒアリング確定, C1-C14）。「なぜこう決まったのか」で迷ったら必ずここを見てください。
- **`docs/basic_design/15_development_process.md`** — 開発プロセスそのものの規約（§3を参照。詳細は下記）。
- **`docs/basic_design/00_overview.md`** — プロジェクト全体のステータスログ、ドキュメント一覧、用語集、全体アーキテクチャ図。

## 3. 開発プロセス（絶対厳守）

出典: `docs/basic_design/15_development_process.md`

### 3.1 ブランチ命名

`feature/<英語スラッグ>` とし、対応する詳細設計書のファイル名（`docs/detailed_design/<スラッグ>.md`）と一致させること。例: `detailed_design/editing-core.md` に対応する実装ブランチは `feature/editing-core`。

### 3.2 セッションの6ステップワークフロー（§4.2）

1. 読み合わせ（該当する基本設計・詳細設計・00_reference.md の関連箇所を読む）
2. 詳細設計書作成（既存が無ければ作成、既存なら差分更新）
3. 実装
4. テスト
5. セルフレビュー（§6のレビュー観点チェックリストに従う。パッケージの大小を問わず全パッケージ対象）
6. PR作成（Squashマージ前提、コミットメッセージはcommitlint準拠の規約に従う。§3.2参照）

### 3.3 Definition of Done（完了の定義、§7）— 6項目全て満たすこと

該当する6項目は `docs/basic_design/15_development_process.md` §7 に定義されています。実装完了を自己申告する前に必ず全項目を確認してください。

### 3.4 リポジトリ規約（§2）

pnpm ワークスペース、TypeScript strict モード、Lint/Format/型チェックは pre-commit フック **と** CI の両方で強制。

### 3.5 テストのタイミング（§5）

原則「実装後にテストを書く」だが、L/XLサイズのパッケージはサブ機能単位で書くこと。

## 4. 【最重要】ドキュメント同時改訂の原則

このプロジェクトの設計ドキュメント群は相互に密結合しています。基本設計・詳細設計・00_reference.md は Wikilink形式 `[[相対パス#見出し]]` で互いを参照し合っています。

**1つの決定や修正を行うとき、それに関連する全てのドキュメントを同じパスで（同時に）更新すること。** 片方だけ直して他を放置すると、`docs/review/` にあるような監査で指摘される不整合（過去の実例: A-1〜A-5, B-1〜B-5 など）が再発します。具体的にどのドキュメント群が連動するかの実例は `docs/review/design_review_2026-09-03.md`、`docs/review/design_review_2026-09-03_audit.md`、`docs/review/design_review_2026-09-04.md` を参照してください。

典型的な連動例:
- コマンド／バリデーション仕様を変える → `basic_design/04_editing_core.md` と `detailed_design/editing-core.md` と `detailed_design/00_reference.md`(§3, §5) を同時に更新
- エラーコードを追加/変更する → 該当パッケージの detailed_design と `detailed_design/00_reference.md` §5（エラーコード一覧）を同時に更新
- ディレクトリツリーやファイル配置を変える → `basic_design/06_file_io_persistence.md` §3 と `detailed_design/data-model-persistence.md` を同時に更新（1ディレクトリツリー行には1パスのみ、という運用ルールあり）

## 5. 最初に着手すべきワークパッケージ

実装順序（`docs/basic_design/15_development_process.md` §4.1）に従うと、**最初に着手すべきは `docs/detailed_design/web-core-foundation.md`（Webコア基盤構築）です**。

これはモノレポの雛形（`pnpm-workspace.yaml`、`tsconfig.base.json`、`.eslintrc.cjs`、`packages/core`、`packages/shared-types`、`apps/desktop` の Electron main/preload/renderer 等）を実際に作る作業です。**このZIPにはまだそのコードは含まれていません。あなた（Claude Code）がこのワークパッケージとして自発的に作るべきものであり、既に完成しているものとして扱わないでください。**

その後の順序（Phase 1）:
1. Webコア基盤構築
2. データモデル・永続化
3. エラー/ログ基盤
4. タブ譜編集コア
5. パート・チューニング管理
6. 表示モード
7. 再生エンジン統合
8. 画面群・ナビゲーション

Phase 2（書き出し機能、印刷プレビュー）はPhase 1完了後。詳細は `docs/basic_design/15_development_process.md` §4.1 / §4.1.1 のテーブルを参照。

各ワークパッケージに対応する詳細設計書はそれぞれ `docs/detailed_design/` 配下に既に存在します（上記の実装順序と同名のファイル）。実装時はまずその詳細設計書を読み込んでから着手してください。

## 6. ドキュメント全体マップ

```
docs/
├── tab_app_requirements.md          要件定義（最上流）
├── basic_design/                    基本設計（16ファイル）
│   ├── 00_overview.md               全体像・ステータス・用語集
│   ├── 01_architecture.md           アーキテクチャ方針
│   ├── 02_data_model.md             データモデル（ER図）
│   ├── 03_screens_ui_pc.md          PC版画面・UI
│   ├── 04_editing_core.md           編集コア機能
│   ├── 05_playback_audio.md         再生・オーディオ
│   ├── 06_file_io_persistence.md    ファイルI/O・永続化
│   ├── 07_export_print.md           書き出し・印刷
│   ├── 08_error_logging.md          エラー・ログ設計
│   ├── 09_nonfunctional.md          非機能要件
│   ├── 10_extensibility_future.md   拡張性・将来計画
│   ├── 11_test_strategy.md          テスト戦略・品質KPI
│   ├── 12_traceability.md           要求トレーサビリティ
│   ├── 13_design_decision_points.md 設計判断カタログ（重要）
│   ├── 14_visual_design_system.md   ビジュアルデザインシステム
│   └── 15_development_process.md    開発プロセス規約（重要）
├── detailed_design/                 詳細設計（10ファイル）
│   ├── 00_reference.md              横断リファレンス（最重要・最頻参照）
│   ├── web-core-foundation.md       ★最初に着手
│   ├── data-model-persistence.md
│   ├── error-logging-foundation.md
│   ├── editing-core.md
│   ├── part-tuning-management.md
│   ├── view-modes.md
│   ├── playback-integration.md
│   ├── screens-navigation.md
│   └── export-print.md
└── review/                          設計レビュー記録（3ファイル）
    ├── design_review_2026-09-03.md
    ├── design_review_2026-09-03_audit.md
    └── design_review_2026-09-04.md
```

## 7. VSCode / Claude Code 利用上の注意

- このリポジトリには現状 `.gitignore` や `package.json` は含まれていません（Work Package 1 で作成予定）。
- ドキュメント間の `[[相対パス#見出し]]` 形式のリンクは、このZIPの `docs/` フォルダ構造をそのまま維持すれば相対リンクとして機能します（フォルダ構成を変えないでください）。
- 実装を始める前に、必ず `docs/detailed_design/00_reference.md` の §8.1（既知ギャップ）を確認し、着手するワークパッケージに関連するギャップが残っていないか確認してください。
