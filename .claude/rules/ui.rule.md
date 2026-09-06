---
applyTo: "apps/desktop/src/renderer/**,packages/core/src/ui/**"
---

# UI 実装規約（React）

> 権威: [`docs/basic_design/03_screens_ui_pc.md`](../../docs/basic_design/03_screens_ui_pc.md)、[`docs/basic_design/14_visual_design_system.md`](../../docs/basic_design/14_visual_design_system.md)。
> 画面群の本実装は Phase 1 / 作業パッケージ8「画面群・ナビゲーション」。それまでの UI コードは**最小シェルのみ**（Webコアをマウントし、alphaTab の描画確認ができる状態）。

## 画面構成方針

- 画面コンポーネントは `packages/core/src/ui`（プラットフォーム非依存な部分）に置き、`apps/desktop/src/renderer` は薄いホスト（マウント・DI 組み立て）に留める
- 主要画面・責務の一覧は作業パッケージ8で `03_screens_ui_pc.md` に沿って確定する

## 依存方向

- UI 層（L1）から データ層・I/O を直接呼ばない。必ずアプリケーションサービス層（L2、`EditingService` / `PlaybackService` 等）を介する
- レンダラーからプラットフォーム機能へは `window.tabAppApi`（preload 公開 API）経由のみ。`electron` / `node:*` を import しない（[layer-architecture.rule.md](layer-architecture.rule.md)）
- alphaTab の生 API（`AlphaTabApi`）を UI から直接触らない。必ず `ScoreRenderHost` 経由

## 状態管理

- Undo/Redo 対象（Score モデル）と UI 状態（選択範囲・表示モード・ズーム等）を明確に分離する（AD-4）
- UI 状態は軽量ストア（Zustand 相当）、Score 変更はコマンド層経由（AD-2）

## スレッド／パフォーマンス

- 重い処理（大曲のレンダリング・シリアライズ）で UI をフリーズさせない
- 高頻度更新（再生カーソル追従等）は必要最小限の再描画に抑える

## ビジュアル

- 配色・余白・タイポグラフィは `14_visual_design_system.md` のトークンに従う。契約上意味を持たない実装詳細（正確なピクセル値等）は固定しすぎない

## 禁止事項

- UI コンポーネントへの機密データ・実パスのハードコード
- 画面間でサービス層をバイパスしてデータを受け渡すこと
- 外部 CDN からのフォント・アセット読み込み（オフライン、[electron.rule.md](electron.rule.md)）
