---
name: layer
description: レイヤー依存規則。packages/core のプラットフォーム非依存性を保つ。
paths:
  - "packages/**/*.ts"
  - "packages/**/*.tsx"
---

# レイヤー依存規則【プロジェクト固有】

> import 禁止そのものは ESLint の `no-restricted-imports` が拒否する。ここには**なぜそうなのか**と、機械が見ない判断だけを置く。

## なぜ

`packages/core` は PC 版（Electron）と将来の iPhone 版（Expo + WebView）で**共通のまま**でなければならない。ここにプラットフォーム依存が1つ紛れ込むと、iPhone 版展開時に手戻りになる。これは要件で明示されたリスク（リスク#8）であり、Phase 3 まで露見しない種類の負債。

## 禁止

`packages/core` から以下への import を行わない。

- `electron` / `expo-*` / その他プラットフォーム SDK
- `node:fs` / `node:path` / `node:os` などの Node.js 組み込み
- `apps/**` の任意のモジュール

`packages/ui-desktop`（PC 版の画面）から以下への import を行わない（2026-09-26 本人決定、基本設計 01 章 AD-5）。

- `electron` / `expo-*` / その他プラットフォーム SDK
- `node:fs` / `node:path` / `node:os` などの Node.js 組み込み
- `apps/**` の任意のモジュール

画面は Webコアの一部（要件 6 章）で、Windows とのやりとりはシェル（`apps/desktop`）から注入で受ける。**ESLint の `no-restricted-imports` にこの決まりを足すのは、`packages/ui-desktop` を作るとき**（今はまだ無い）。

## 依存の向き

```
apps/desktop  ──▶  packages/ui-desktop  ──▶  packages/core  ──▶  packages/shared-types
（シェル：起動・DI・          （PC 版の画面：          （ロジックの大半）
  Windows とのやりとり）         React の部品）
apps/desktop  ──▶  packages/core
```

矢印を逆流させない。`packages/core` が I/O やオーディオセッションを必要とするときは、**インターフェースを core 側に定義し、実装を apps 側から注入する**（`FileSystemAdapter` と `ElectronFileSystemAdapter` の関係がその形）。

## 判断が要るとき

「どこに置くべきか」で迷ったら、次の順に決める。

1. Windows とのやりとり（窓・ファイル・Windows の保存や印刷の画面・メニューバーなど、シェルの 7 つの仕事）なら `apps/desktop`
2. 画面の見た目（React の部品）なら `packages/ui-desktop`
3. それ以外は **iPhone 版でもそのまま使えるか**で決める。使えるなら（今は PC でしか呼ばれなくても）`packages/core`。使えないなら、なぜ PC 専用なのかを `13_design_decision_points.md` に書いてから置き場所を決める

新しいアダプタ境界を切るのは設計判断なので、`13_design_decision_points.md` に分岐点として記録してから実装する。
