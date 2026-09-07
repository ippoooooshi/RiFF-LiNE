---
applyTo: "packages/**,apps/**"
---

# レイヤーアーキテクチャ規約

> 権威: [`docs/basic_design/01_architecture.md`](../../docs/basic_design/01_architecture.md) §2・AD-3・AD-5。目的は要件書リスク#8「PC版開発中に Electron 依存コードが Webコアに紛れ込む」を**仕組みで**防ぐこと。

## 依存方向（逆方向は禁止）

```
L1 プレゼンテーション ─▶ L2 アプリケーションサービス ─▶ L3 ドメイン ─▶ L4 PlatformAdapter I/F ─▶ L5 プラットフォーム実装
```

- **L1〜L3 = Webコア = `packages/core`**（+ 型のみ `packages/shared-types`）
- **L4 = 境界**: `packages/core/src/platform`（インターフェース定義のみ、実装を含まない）
- **L5 = ラッパー層 = `apps/desktop`（Electron）/ `apps/mobile`（Expo, Phase 3）**

## 許可 / 禁止マトリクス

| モジュール | 許可依存 | 禁止依存 |
|---|---|---|
| `packages/core/**` | `@riff-line/shared-types`、Node 標準ライブラリのうち環境非依存のもの、汎用 npm ライブラリ、`@coderline/alphatab` | `electron`、`expo-*`、`apps/**`、`node:fs` 等のプラットフォーム I/O を直接叩くもの |
| `packages/shared-types/**` | （型のみ。ランタイム依存を持たない） | すべてのランタイムパッケージ |
| `apps/desktop/src/main/**` | `electron`、Node 標準ライブラリ、`@riff-line/shared-types`、`@riff-line/core`（型・純粋ロジックの利用） | `apps/desktop/src/renderer/**` の直接 import |
| `apps/desktop/src/preload/**` | `electron`（`contextBridge` / `ipcRenderer`）、`@riff-line/shared-types` | `@riff-line/core`、Node fs 等の実 I/O |
| `apps/desktop/src/renderer/**` | `@riff-line/core`、`@riff-line/shared-types`、React、`window.riffLineApi`（preload 公開 API） | `electron`、`node:*`、`ipcRenderer` の直接利用 |

## 機械的強制

- ESLint のビルトイン `no-restricted-imports`（パターン指定）で `packages/core/**` から `electron` / `expo-*` / `apps/**` / `node:fs`（実 I/O）への import をエラーにする（`eslint.config.js` フラットコンフィグ、作業パッケージ1で設定。以降のパッケージはこれに従うだけでよい）
- `packages/core/package.json` は `electron` / `expo-*` を dependencies にも devDependencies にも持たない
- CI と pre-commit hook の両方で lint を強制

## 違反時の対応

- 逆方向 import が必要に思えたら、まず設計を見直す（インターフェースの後注入・イベント経由で解決できないか）
- 解決困難な場合は実装前に [`docs/basic_design/13_design_decision_points.md`](../../docs/basic_design/13_design_decision_points.md) に分岐点として記録し、基本設計側を更新して合意を得てから進む（`15_development_process.md` §9）
- テストコードはこの依存方向制約の対象外（検証目的で各層を跨いで参照してよい）
