---
mode: 'agent'
description: '実装（packages/** apps/**）が是正後の設計と一致しているかをアプリ全体で照合し、ダミー配線・未結線・設計乖離を洗い出す。検出のみ、是正は sdlc-impl。'
---

# 実装忠実性監査（Phase 1 完成・製品化 I1）

対象は PR 差分ではなく**アプリ全体**。ゴールは [`.claude/docs/phase1-productization.md`](../docs/phase1-productization.md) の G-I-1。
前提は D1・D2 完了（設計が署名レベル・接続先表まで確定していること）。

## 手順

1. **機械チェック（先に実行し、結果を後続に添付）**
   - ダミーハンドラ／仮実装の洗い出し:
     `grep -rn "() => undefined\|=> *{}\|TODO\|FIXME\|stub\|とりあえず\|未実装\|not implemented" apps/desktop/src packages/core/src`
   - bootstrap 配線の確認: `apps/desktop/src/renderer/App.tsx` ほか、各画面コンポーネントへ渡している props（`onXxx`）が実ロジック（Service / Controller / IPC）に繋がっているか。`() => undefined` や空関数を渡している箇所を列挙
   - 「設計が UI から呼ぶと定めたサービス・メソッド」（`docs/basic_design/03_screens_ui_pc.md` の画面別接続、`docs/detailed_design/phase1-productization.md` の接続先表、各 detailed_design §）を 1 件ずつ取り、実コードに呼び出し箇所があるか `Grep` で確認。無いものを「未結線」として記録

2. **`sdlc-impl-review` を全体スコープで起動**（差し戻し先判定つき）。観点:
   - 設計の各クラス／メソッドの as-built 一致（`00_reference.md` §3 と実シグネチャ）
   - レイヤー依存規則（[`.claude/rules/layer-architecture.rule.md`](../rules/layer-architecture.rule.md)）・Electron 既定値（[`electron.rule.md`](../rules/electron.rule.md)）・オフライン制約
   - テスト網羅（renderer `.tsx` を含む結合テスト、カバレッジ KPI）
   - P1〜P7 の E2E 経路が実コード上つながっているか（曲一覧 → 新規作成 → 編集 → 保存 → 再起動復元、再生、表示モード等）

3. **E2E 代替検証**
   - P1〜P7 のうち CDP／ヘッドレス（`ELECTRON_RUN_AS_NODE` や `--remote-debugging-port` 経由）で機能面を代替検証できる項目を洗い出し、可能なものは実行して結果を添付。目視・聴取が本質の項目は「本人環境必須」と明記

4. **統合**
   - 未結線・設計乖離を「画面／機能 × 接続先 × 状態（未結線 / 乖離 / OK）」の表にまとめ、是正先（I1 本体の `sdlc-impl` へ／設計へ差し戻し）を判定

## 禁止事項

- コードの**是正はしない**（本コマンドは検出のみ。是正は I1 本体の `sdlc-impl`）
- `git` 操作

## 出力

- ダミー配線の grep 結果（ファイル:行）
- 未結線・乖離リスト（画面／機能 × 接続先 × 状態 × 是正先）
- E2E 代替検証の結果と、本人環境必須項目の一覧
- 差し戻し判定（impl 是正で足りる / 設計へ戻す）
