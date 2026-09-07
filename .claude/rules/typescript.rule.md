---
applyTo: "**/*.{ts,tsx}"
---

# TypeScript コーディング規約

## スタイル

- TypeScript strict モード前提（`tsconfig.base.json` の `strict: true` 他、AD-4）
- インデントはスペース 2、1 行は概ね 120 文字以内（Prettier に従う）
- `packages/core/**` は `@typescript-eslint/no-explicit-any: error`。他パッケージも `any` は原則禁止・使う場合は理由をコメント
- 公開 API（export される関数・クラス・型）のシグネチャは必ず明示的に型注釈する
- 関数は副作用最小化を優先し、純粋関数を選べる場面では純粋関数にする
- グローバル可変状態を作らない。マジックナンバーを避け意味のある定数名を使う

## 命名

- 型・クラス・インターフェース・enum: `PascalCase`
- 関数・メソッド・変数: `camelCase`
- 定数: `UPPER_SNAKE_CASE` または `camelCase`（周辺の既存規約に合わせる）
- クラス接尾辞の意味は [`docs/detailed_design/00_reference.md`](../../docs/detailed_design/00_reference.md) §7 に従う（`Service` / `Controller` / `Command` / `Adapter` / `Factory` / `Host` / `Binder` 等）

## import 順

1. Node 標準ライブラリ / サードパーティ
2. ワークスペース内パッケージ（`@riff-line/shared-types` 等）
3. ローカル（相対パス）

グループ間は 1 行空け、未使用 import は残さない。**レイヤー依存規則（[layer-architecture.rule.md](layer-architecture.rule.md)）を厳守。**

## 例外・エラー処理

- 空 catch（握り潰し）禁止
- エラーメッセージに機微情報・実ストレージの絶対パス等を含めない
- ドメイン層（`packages/core`）は、プラットフォーム固有のエラー（Node の `ENOENT` 等）を扱わない。ラッパー層（`apps/desktop`）が軽量エラークラス（`FileNotFoundError` / `FileWriteError` 等）に正規化してから渡す
- 横断的な通知はエラー/ログ基盤パッケージ完了後は `NotificationCenter.report(code, context)` 経由。それまでは暫定的に `console.error` + イベント発火（詳細設計書の指示に従う）

## ロギング

- `console.log` の常用禁止。デバッグ出力は最小限
- 機微データはログ出力禁止（オフライン・個人利用アプリだが方針は維持）

## コメント方針（密度・粒度）

本プロジェクトは設計書運用（`designDocs=true`）だが、コード側にも次を求める:

- **関数・メソッドごと**: 直前に「何をするか・入出力の意味・副作用や前提」を 1〜数行。型から読めない「なぜ・前提・契約」を優先。自明な 1 行 getter は省略可
- **ステップごと**: 関数内で処理が複数段階に分かれる場合、各節目（分岐・ループ・外部呼び出し・状態遷移）の直前に 1 行
- **トレーサビリティ併記**: 振る舞いを担うブロックに、対応する詳細設計書の節番号（例: `web-core-foundation.md §3.1`）＋要件 ID／テスト ID を併記し、コード⇔設計書⇔テストの双方向追跡を保つ
- コードの逐語訳は書かない。意図・理由・非自明な制約・順序依存・エッジケースを説明する
- 既存コードを編集する際、触れた関数・ブロックを上記水準へ底上げする

## 保守性

- **検索性**: 大きいファイルは見出しコメント（`// ===== セクション名 =====`）で分割
- **不要物の即時・物理削除**: 使われなくなったファイル・関数・定数・型はコメントアウトせず物理削除。削除時は参照元・[structure.md](../docs/structure.md)・関連設計書を同じ変更内で同期
- **単一の真実源**: 同種ロジック・定数の二重定義を作らない（例: `computeRealMidiPitch` のような共有純粋関数は 1 箇所に抽出して双方から呼ぶ）
- **テスト可能な縫い目**: UI / I/O に埋もれたロジックは純関数として切り出し export する

## 静的解析

- 実装後・リファクタリング後に `pnpm typecheck`（型エラー 0）と `pnpm lint`（違反 0）を確認する
