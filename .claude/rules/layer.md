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

## 依存の向き

```
apps/desktop  ──▶  packages/core  ──▶  packages/shared-types
   （薄いラッパー）      （ロジックの大半）
```

矢印を逆流させない。`packages/core` が I/O やオーディオセッションを必要とするときは、**インターフェースを core 側に定義し、実装を apps 側から注入する**（`FileSystemAdapter` と `ElectronFileSystemAdapter` の関係がその形）。

## 判断が要るとき

「これは core に置くべきか apps に置くべきか」で迷ったら、**iPhone 版でもそのまま使えるか**だけを基準にする。使えないなら apps。使えるが今は PC でしか呼ばれない、なら core。

新しいアダプタ境界を切るのは設計判断なので、`13_design_decision_points.md` に分岐点として記録してから実装する。
