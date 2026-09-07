---
applyTo: "apps/desktop/**"
---

# Electron 実装規約

> 権威: [`docs/basic_design/01_architecture.md`](../../docs/basic_design/01_architecture.md) §4、[`docs/detailed_design/web-core-foundation.md`](../../docs/detailed_design/web-core-foundation.md) §3.3〜3.5・§4。

## セキュリティ既定値（変更禁止）

- `BrowserWindow` は `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` で生成する
- レンダラー（= Webコア実行環境）から Node.js API へは**必ず preload 経由の IPC**でアクセスする。`webPreferences` で Node 統合を有効化しない
- `webContents` の新規ウィンドウ生成・ナビゲーションは既定で拒否し、必要なもののみ明示的に許可する

## IPC

- すべて `ipcRenderer.invoke` / `ipcMain.handle`（Promise ベース）で統一。`send` / `on` の一方向イベントは、双方向イベントが本当に必要になった時点で追加する
- チャンネル名は `@riff-line/shared-types` の `FS_CHANNELS` 等の定数を使い、文字列リテラルを散らばらせない
- preload は `contextBridge.exposeInMainWorld` で**型安全なラッパー関数のみ**を公開する。`ipcRenderer` そのもの・Node モジュール・Electron モジュールを露出しない
- メインプロセスの IPC ハンドラは `ElectronFileSystemAdapter` 等の Adapter 実装へ委譲するだけにする（ハンドラ内にビジネスロジックを書かない）

## プロセス分離

- `src/main/**`（Node 環境）・`src/preload/**`（隔離コンテキスト）・`src/renderer/**`（ブラウザ環境）の 3 つを明確に分ける
- `src/renderer/**` は `@riff-line/core` と `window.riffLineApi` のみに依存する（[layer-architecture.rule.md](layer-architecture.rule.md)）
- 単一インスタンスロック（`app.requestSingleInstanceLock()`）で同一プロセスの二重起動を防ぐ

## オフライン（要件5.1）

- 外部 CDN からのスクリプト・スタイル・フォント・SoundFont の読み込みを一切行わない
- alphaTab 本体・フォント資産・SoundFont はビルド成果物に同梱し、`file://` または `app://` スキームで読み込む
- CSP を設定し、`connect-src` / `script-src` を自己オリジンに限定する

## エラー変換

- Node 固有のエラー（`ENOENT` / `EACCES` 等）は Adapter 実装層で軽量エラークラス（`FileNotFoundError` / `FileWriteError`）に変換してから Webコアへ渡す。Webコアに Node のエラーオブジェクトを漏らさない
- 本作業パッケージではリトライしない（リトライ判断は呼び出し元＝次パッケージのアトミック書き込みロジックの責務）

## クラッシュ検知（次パッケージ以降で本実装）

- メインプロセスは `renderer-process-gone` を監視する枠だけ用意し、実処理はエラー/ログ基盤パッケージで `CrashRecoveryController` として実装する
