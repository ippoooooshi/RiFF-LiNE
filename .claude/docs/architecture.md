# アーキテクチャ詳細（運用索引）

> **権威は [`docs/basic_design/01_architecture.md`](../../docs/basic_design/01_architecture.md)。** 本ファイルは Claude が実装時に参照する要約。

## レイヤー構成（§2）

```
L1 プレゼンテーション層 ── 画面コンポーネント群 / alphaTabレンダリング領域(SVG)
L2 アプリケーションサービス層 ── 編集サービス / コマンド層(Undo/Redo) / 再生制御 / エクスポート / バリデーション
L3 ドメイン層 ── alphaTab Scoreモデル / アプリ独自メタデータ(サイドカー)
──────────────────────────────  ↑ここまで Webコア (packages/core)
L4 プラットフォーム抽象層 ── PlatformAdapter I/F (FileSystem / Audio / Window / Update)
L5 プラットフォーム実装層 ── Electronアダプタ(apps/desktop) / Expoアダプタ(apps/mobile, Phase 3)
```

**依存方向**: 上位層 → 下位層のみ。逆方向（L3 が L1 を知る等）は禁止。ESLint `import/no-restricted-paths` で機械的に強制（リスク#8「Electron依存混入」をレビュー任せにしない）。

## 主要アーキテクチャ決定（AD）

- **AD-1**: ドメインモデルは alphaTab の Score モデルを基盤とし、アプリ独自情報（タグ / 小節メモ / プリセット / ゴミ箱台帳 / UI設定等）は「サイドカーメタデータ」として別JSON領域に保持
- **AD-2**: 編集操作はすべてコマンドパターン経由で Score モデルを変更。コマンド層は UI にも alphaTab にも依存しない純粋ロジック。alphaTab に編集コマンドAPIは無く、Score を直接操作 → 再描画API を呼ぶ（A1 解決）
- **AD-3**: プラットフォーム差異は PlatformAdapter インターフェースで吸収（FileSystem / AudioSession / Window / UpdateCheck の4系統）。具象実装は起動時に注入（依存性逆転）
- **AD-4**: TypeScript / React / 軽量ストア（Zustand相当）+ コマンド層は独自実装 / Vite / `@coderline/alphatab`。レンダリングエンジンは **SVG**（A2 で確定）
- **AD-5**: pnpm モノレポ（`packages/core` / `packages/shared-types` / `apps/desktop` / `apps/mobile` / `tools/`）。`packages/core` から `electron` / `expo-*` を直接 import した時点でビルド失敗

## Electron プロセス構成（§4）

- メインプロセス: FileSystemAdapter 実装 / WindowAdapter 実装 / ネイティブメニュー / プリントダイアログ
- preload: contextBridge で IPC API を型安全に公開（Node.js API・Electron モジュールそのものは公開しない）
- レンダラー: `packages/core` 一式の実行環境
- **セキュリティ既定値**: `contextIsolation: true` / `nodeIntegration: false`。詳細は [../rules/electron.rule.md](../rules/electron.rule.md)

## DI パターン

- コンストラクタ DI を基本。組み立てはエントリポイント（起動処理）に集約
- Adapter の具象実装（`ElectronFileSystemAdapter` 等）はメインプロセスの起動処理で生成し、IPC 経由で Webコアへ供給

## 違反時の対応

逆方向 import が必要に思えたら設計を見直す（インターフェース / イベントの後注入で解決可能か）。解決困難な場合は実装前に `13_design_decision_points.md` に分岐点として記録し、基本設計側を更新してから進む（`15_development_process.md` §9）。
