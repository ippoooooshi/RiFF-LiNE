# リポジトリ構成マップ

> **用途**: Claude が作業前に全体構造と各ファイルの責務を素早く把握するための索引。
> **保守（必須・逐次更新）**: `packages/` `apps/` `docs/` 配下のファイル／ディレクトリを**追加・削除・移動・改名**したら、同じ変更の中で本ファイルの該当行を更新する。モノレポ構成の権威は [`docs/detailed_design/web-core-foundation.md`](../../docs/detailed_design/web-core-foundation.md) §2 と [`docs/basic_design/01_architecture.md`](../../docs/basic_design/01_architecture.md) AD-5。

## 技術スタック

TypeScript / React / Electron / Vite / `@coderline/alphatab`（SVGレンダリング）。pnpm ワークスペース。TypeScript strict。永続化はカスタムJSONスナップショット形式（`.tabapp`）。

## 依存方向（レイヤー、逆方向禁止）

`L1 プレゼンテーション → L2 アプリケーションサービス → L3 ドメイン → L4 プラットフォーム抽象（PlatformAdapter I/F）→ L5 プラットフォーム実装`。
L1〜L3 = Webコア（`packages/core`）。L4 = 境界。L5 = ラッパー層（`apps/desktop` / `apps/mobile`）。
`packages/core` から `electron` / `expo-*` / `apps/**` への import は ESLint（`import/no-restricted-paths`）で禁止。詳細は [architecture.md](architecture.md) / [../rules/layer-architecture.rule.md](../rules/layer-architecture.rule.md)。

## 現状

Phase 1 / 作業パッケージ1「Webコア基盤構築」実装済み。以降の `packages/core/src` 配下ディレクトリ（`ui` / `editing` / `playback` / `domain` / `export` / `errors`）は空（`.gitkeep` のみ）で、対応する作業パッケージで実装する。

## ルート — 設定・ツールチェーン

| パス | 責務 |
| --- | --- |
| `pnpm-workspace.yaml` | ワークスペース定義（`packages/*` / `apps/*`） |
| `package.json` | ルート（private）。横断スクリプト（`lint` / `typecheck` / `test` / `build` / `dev` / `format`）、devDependencies、`packageManager` で pnpm 固定 |
| `.nvmrc` | Node.js バージョン固定（`24` = Active LTS） |
| `tsconfig.base.json` | 全パッケージ共通の TS 設定（`strict: true` 他、AD-4） |
| `.eslintrc.cjs` | ESLint。`@typescript-eslint` + `import/no-restricted-paths`（レイヤー依存規則）+ `packages/core` は `no-explicit-any: error` |
| `.prettierrc.json` | Prettier |
| `commitlint.config.cjs` | Conventional Commits 強制 |
| `.husky/pre-commit` `.husky/commit-msg` | lint-staged + `tsc -b` / commitlint |
| `vitest.workspace.ts` | Vitest ワークスペース（各パッケージのテストを集約） |
| `.github/workflows/ci.yml` | PR ごとに install → lint → typecheck → test → build + commitlint |

## `packages/core` — Webコア本体（`@tab-app/core`、L1〜L3）

| パス | 責務 |
| --- | --- |
| `src/rendering/ScoreRenderHost.ts` | alphaTab `AlphaTabApi` を1個保持する唯一の窓口。`initialize` / `loadScore` / `render(trackIndices?)` / `dispose` / `on` / `off`。他モジュールに生 API を触らせない（`00_reference.md` §3.1） |
| `src/rendering/types.ts` | `RenderHostOptions`（`engine: 'svg'` 固定 / `fontAssetsBasePath` / `soundFontAssetsBasePath`）、`RenderHostEvents`（`'renderStarted' | 'renderFinished' | 'renderError'`） |
| `src/platform/FileSystemAdapter.ts` | `FileSystemAdapter` インターフェース（最小版）: `readFile` / `writeFile` / `listDirectory` / `ensureDirectory` / `getRootPath`。実装は含まない |
| `src/platform/errors.ts` | `FileNotFoundError` / `FileWriteError`（軽量エラークラス、エラーコード体系外） |
| `src/platform/types.ts` | `DirEntry`（`name` / `isDirectory` / `sizeBytes` / `modifiedAt`） |
| `src/{ui,editing,playback,domain,export,errors}/` | 空（`.gitkeep`）。各作業パッケージで実装 |

## `packages/shared-types` — 共有型（`@tab-app/shared-types`）

| パス | 責務 |
| --- | --- |
| `src/index.ts` | IPC 契約の型。`FS_CHANNELS`（`fs:readFile` 等の定数）、各チャンネルの Request/Response 型、`DirEntry` 再エクスポート、`TabAppApi`（preload が renderer に公開する API の型）。`packages/core` と `apps/desktop` の三者から共有 |

## `apps/desktop` — Electron ラッパー（`@tab-app/desktop`、L5、Phase 1）

**`apps/desktop/package.json` の `version` が PC版バージョンの真実源（B24）。**

| パス | 責務 |
| --- | --- |
| `src/main/main.ts` | エントリポイント。`requestSingleInstanceLock` → `whenReady` → `createMainWindow`（`contextIsolation: true` / `nodeIntegration: false` / preload 指定） |
| `src/main/ElectronFileSystemAdapter.ts` | `FileSystemAdapter` 実装。`fs/promises` ラッパー。Node 固有エラー（`ENOENT` 等）を `FileNotFoundError` / `FileWriteError` に変換。ルート = `app.getPath('userData')/TabApp`（本パッケージはローカル固定） |
| `src/main/ipc.ts` | `registerFsHandlers(adapter)`: `ipcMain.handle(FS_CHANNELS.*, …)` を adapter へ委譲 |
| `src/preload/preload.ts` | `contextBridge.exposeInMainWorld('tabAppApi', { fs: { … } })`。`ipcRenderer.invoke` の型安全ラッパーのみ公開。Node/Electron モジュールは非公開 |
| `src/renderer/index.html` | レンダラーのエントリ HTML |
| `src/renderer/main.tsx` | React 最小シェル。`ScoreRenderHost` を初期化し alphaTex サンプルを1つ描画（画面群は Phase 8） |
| `assets/alphatab/` | alphaTab フォント資産（`node_modules/@coderline/alphatab/dist/font/` からコピー）。SoundFont は配置のみ・非ロード |
| `vite.config.ts` | Vite + `vite-plugin-electron`（main/preload）+ `@vitejs/plugin-react`（renderer） |

## `apps/mobile` / `tools`

空（`.gitkeep`）。`apps/mobile` は Phase 3、`tools` は次パッケージ以降（開発用サンプルデータ生成スクリプト）。

## テスト配置

- 単体: 対象と同じディレクトリの `*.test.ts`（`packages/core/src/**`）
- 結合: `apps/desktop/src/main/*.test.ts`（実 I/O・IPC 往復）
- 規約は [testing.md](testing.md) / [../rules/tests.rule.md](../rules/tests.rule.md)

## docs/ — 設計ドキュメント（権威）

| パス | 責務 |
| --- | --- |
| `docs/tab_app_requirements.md` | 要件定義（最上流） |
| `docs/basic_design/00〜15_*.md` | 基本設計16冊。特に `00_overview.md`（ステータスログ）、`13_design_decision_points.md`（設計判断カタログ）、`15_development_process.md`（開発プロセス規約） |
| `docs/detailed_design/00_reference.md` | 横断リファレンス（最頻参照。クラス登録簿 §3 / 非破壊拡張履歴 §4 / エラーコード §5 / 依存グラフ §6 / 既知ギャップ §8.1） |
| `docs/detailed_design/<スラッグ>.md` | 作業パッケージ単位の詳細設計書 |
| `docs/review/*.md` | 設計レビュー記録 |
