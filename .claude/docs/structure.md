# リポジトリ構成マップ

> **用途**: Claude が作業前に全体構造と各ファイルの責務を素早く把握するための索引。
> **保守（必須・逐次更新）**: `packages/` `apps/` `docs/` 配下のファイル／ディレクトリを**追加・削除・移動・改名**したら、同じ変更の中で本ファイルの該当行を更新する。モノレポ構成の権威は [`docs/detailed_design/web-core-foundation.md`](../../docs/detailed_design/web-core-foundation.md) §2 と [`docs/basic_design/01_architecture.md`](../../docs/basic_design/01_architecture.md) AD-5。

## 技術スタック

TypeScript / React / Electron / Vite / `@coderline/alphatab`（SVGレンダリング）。pnpm ワークスペース。TypeScript strict。永続化はカスタムJSONスナップショット形式（`.tabapp`）。

## 依存方向（レイヤー、逆方向禁止）

`L1 プレゼンテーション → L2 アプリケーションサービス → L3 ドメイン → L4 プラットフォーム抽象（PlatformAdapter I/F）→ L5 プラットフォーム実装`。
L1〜L3 = Webコア（`packages/core`）。L4 = 境界。L5 = ラッパー層（`apps/desktop` / `apps/mobile`）。
`packages/core` から `electron` / `expo-*` / `apps/**` / `node:fs` への import は ESLint（`eslint.config.js` のビルトイン `no-restricted-imports`）で禁止。詳細は [architecture.md](architecture.md) / [../rules/layer-architecture.rule.md](../rules/layer-architecture.rule.md)。

## 現状

Phase 1 / 作業パッケージ1「Webコア基盤構築」実装済み。作業パッケージ2「データモデル・永続化」実装済み（`feature/data-model-persistence`）：`packages/core/src/{domain,persistence}` を実体化し、`FileSystemAdapter` を4メソッド非破壊拡張、`FileSystemAdapterFactory` / `AppLocalConfigService` 契約と Electron 実装、ルート指定付き `fs:*At` / `appconfig:*` IPC（B31）を追加。以降の `packages/core/src` 配下ディレクトリ（`ui` / `editing` / `playback` / `export` / `errors`）は空（`.gitkeep` のみ）で、対応する作業パッケージで実装する。

## ルート — 設定・ツールチェーン

| パス | 責務 |
| --- | --- |
| `run-app.cmd` | **アプリ起動の唯一のエントリポイント**（Windows、ダブルクリック）。pnpm 検出（corepack フォールバック）→ 初回 install → `electron-vite dev`。「アプリを起動して」と言われたらこれ／`pnpm dev` を使い、別スクリプトを作らない |
| `pnpm-workspace.yaml` | ワークスペース定義（`packages/*` / `apps/*`）。`allowBuilds`（esbuild / electron） |
| `package.json` | ルート（private）。横断スクリプト（`lint` / `typecheck` / `test` / `build` / `dev` / `format`）、devDependencies、`packageManager` で pnpm 固定 |
| `.nvmrc` | Node.js バージョン固定（`24` = Active LTS） |
| `tsconfig.base.json` | 全パッケージ共通の TS 設定（`strict: true` 他、AD-4） |
| `eslint.config.js` | ESLint フラットコンフィグ（ESLint 10 は eslintrc を廃止）。`typescript-eslint` + `no-restricted-imports`（レイヤー依存規則）+ `packages/core` は `no-explicit-any: error`。`.claude/` `docs/` は対象外 |
| `.prettierrc.json` / `.prettierignore` | Prettier（Markdown・`.claude/` は整形対象外） |
| `commitlint.config.mjs` | Conventional Commits 強制 |
| `.husky/pre-commit` `.husky/commit-msg` | `pnpm lint-staged` + `pnpm run typecheck` / commitlint |
| `vitest.config.ts` | Vitest（`test.projects` で core=jsdom / desktop=node を集約） |
| `.github/workflows/ci.yml` | PR/push ごとに install → lint → typecheck → test → build（+ PR は commitlint） |
| `.gitattributes` | 改行を LF に正規化（CI は Linux） |

## `packages/core` — Webコア本体（`@riff-line/core`、L1〜L3）

| パス | 責務 |
| --- | --- |
| `src/rendering/ScoreRenderHost.ts` | alphaTab `AlphaTabApi` を1個保持する唯一の窓口。`initialize` / `loadScore` / `render(trackIndices?)` / `dispose` / `on` / `off` / `isInitialized` / `static parseAlphaTex`。他モジュールに生 API を触らせない（`00_reference.md` §3.1）。alphaTab は `core.useWorkers: false`（メインスレッド同期描画）で構成 — Web Worker 自動生成が厳格 CSP と衝突するため（13_design_decision_points.md B30） |
| `src/rendering/types.ts` | `RenderHostOptions`（`engine: 'svg'` 固定 / `fontAssetsBasePath` / `soundFontAssetsBasePath`）、`RenderHostEvents`（`'renderStarted' | 'renderFinished' | 'renderError'`） |
| `src/platform/index.ts` | L4 境界のバレル。`FileSystemAdapter` / `DirEntry` 型を `@riff-line/shared-types` から再エクスポート（単一の真実源）＋ `errors.ts` の3クラスを再エクスポート。実装は含まない |
| `src/platform/errors.ts` | `FileNotFoundError`（不在）/ `FileReadError`（EACCES/EISDIR 等の読み取り失敗）/ `FileWriteError`（書き込み失敗）。軽量エラークラス、アプリのエラーコード体系（RENDER-001 等）外 |
| `src/rendering/index.ts` / `src/index.ts` | パッケージ公開バレル（`src/index.ts` が rendering・platform・domain・persistence を再エクスポート） |
| `src/domain/types.ts` | `SongDocument`／`AppMetadata`／`SongFileJson`（`schemaVersion`/`id`/`createdAt`/`song`/`appMeta`/`integrity`）／`SongSummary`／`TuningPreset`／`Tag`／`NewSongSetup`／`ViewMode` 等の型 |
| `src/domain/sha256.ts` / `checksum.ts` | 依存なし同期 SHA-256、決定的 JSON 正規化 + `computeChecksum(schemaVersion, song, appMeta)`（§9.2） |
| `src/domain/SongDocument.ts` | 1曲の集約ルート。`toFileJson` / `static fromFileJson` / `computeChecksum`。Score の JSON 往復は alphaTab `JsonConverter` |
| `src/domain/newSong.ts` | `createInitialScore(NewSongSetup)`（alphaTab モデル API で空1小節の Score を組み立て） |
| `src/domain/validation.ts` | メモ切り詰め（C13）、曲数・タグ数の上限判定（C12・TAG-001）。定数と純関数のみ |
| `src/persistence/constants.ts` / `paths.ts` | ディレクトリ/ファイル名、自動保存タイミング、保持日数、ルート相対パス組み立て |
| `src/persistence/errors.ts` | `SongNotFoundError` / `IntegrityCheckFailedError`（FILE-002）/ `UnsupportedSchemaVersionError`（FILE-004） |
| `src/persistence/jsonIo.ts` / `log.ts` | Adapter 越しの JSON 読み書きヘルパー、NotificationCenter 完成までの暫定 console ログ |
| `src/persistence/SchemaMigrator.ts` | `register(from,to,fn)` / `migrate(json,current)`。逐次適用 + 欠損フィールドの既定値補完 |
| `src/persistence/ChecksumUtil.ts` | `ChecksumUtil.compute(...)`（domain/checksum のラッパー、00_reference.md §3.2 登録簿名） |
| `src/persistence/SongIndexService.ts` | `index.json` の load/upsert/remove/rebuild。破損・欠落時は `songs/` 走査で再構築 |
| `src/persistence/SongRepository.ts` | `load`（SongNotFound/Integrity 判定）/ `save`（rotate→tmp→rename→index）/ `create`（初回保存まで） |
| `src/persistence/LocalBackupService.ts` | 保存直前の端末ローカル1世代退避（B25）。`rotate` / `restore` |
| `src/persistence/AutoSaveScheduler.ts` | デバウンス3s・最大遅延10s、1s/3s/9s リトライ（FILE-001）、`notifyDirty`/`flush`/`dispose` |
| `src/persistence/TrashService.ts` | ゴミ箱の移動/復元/`purgeExpired`（保持30日境界、B9）/`permanentlyDelete`。`trash-index.json`（B29） |
| `src/persistence/StorageConfigService.ts` | `settings.json` の load/save、`validateMirrorConfig`（§4.2 禁止パターン）、`StorageLocationDetector` 契約 |
| `src/persistence/StorageMigrationService.ts` | `migrate(from,to,onProgress?)`。`songs/`・`trash/`・設定ファイルを read→write→照合。`logs/` は対象外（C14） |
| `src/persistence/MirrorSyncService.ts` | `syncAfterSave`（fire-and-forget）/ `awaitPending(timeoutMs)`（終了時待ち、B26）。例外を外へ出さない |
| `src/testing/FakeFileSystemAdapter.ts` | テスト専用インメモリ Adapter / Factory（本番バレル非公開） |
| `src/{ui,editing,playback,export,errors}/` | 空（`.gitkeep`）。各作業パッケージで実装 |

## `packages/shared-types` — 共有型（`@riff-line/shared-types`）

| パス | 責務 |
| --- | --- |
| `src/index.ts` | IPC 契約とプラットフォーム抽象の型。`FileSystemAdapter`（+`renameFile`/`deleteFile`/`copyFile`/`exists`）・`FileSystemAdapterFactory`・`AppLocalConfigService`・`StorageRootPointer`・`DirEntry`。`FS_CHANNELS`（`fs:readFile` 等5本 + `fs:*At` 8本）・`APP_CONFIG_CHANNELS`、各チャンネルの Request/Response 型、`RiffLineApi`（`fs`/`fsAt`/`appConfig`）。`packages/core` と `apps/desktop` の三者から共有 |

## `apps/desktop` — Electron ラッパー（`@riff-line/desktop`、L5、Phase 1）

**`apps/desktop/package.json` の `version` が PC版バージョンの真実源（B24）。**

| パス | 責務 |
| --- | --- |
| `src/main/main.ts` | エントリポイント。`requestSingleInstanceLock` → `whenReady` → `createMainWindow`（`contextIsolation: true` / `nodeIntegration: false` / preload 指定） |
| `src/main/ElectronFileSystemAdapter.ts` | `FileSystemAdapter` 実装（+`renameFile`/`deleteFile`/`copyFile`/`exists`）。`fs/promises` ラッパー。Node 固有エラーを `FileNotFoundError`/`FileReadError`/`FileWriteError` に変換。`readFile` にオンデマンドDL対策（§6、既定 on、opt-out 可） |
| `src/main/ElectronFileSystemAdapterFactory.ts` | `FileSystemAdapterFactory` 実装。絶対パスごとに Adapter を1個キャッシュ（B31） |
| `src/main/ElectronAppLocalConfigService.ts` | `AppLocalConfigService` 実装。`{userData}/storage-pointer.json`、`getActiveRoot`（既定 `{userData}/TabApp`）、`getLocalBackupRoot`（`{userData}/LocalBackup`、B25） |
| `src/main/onDemandRetry.ts` | `retryOnEmptyRead`：空データ時の指数バックオフ再試行（§6、A5、`ONDEMAND_RETRY_BACKOFF_MS`） |
| `src/main/ipc.ts` | `registerFsHandlers`（5本）/ `registerFsAtHandlers`（`fs:*At` 8本、Factory 経由）/ `registerAppConfigHandlers`（`appconfig:*` 4本）。委譲のみ |
| `src/preload/preload.ts` | `contextBridge.exposeInMainWorld('riffLineApi', { fs, fsAt, appConfig })`。`ipcRenderer.invoke` の型安全ラッパーのみ公開。Node/Electron モジュールは非公開 |
| `src/renderer/index.html` | レンダラーのエントリ HTML（CSP: 自己オリジンのみ） |
| `src/renderer/ipcFileSystem.ts` | `IpcFileSystemAdapter` / `IpcFileSystemAdapterFactory`：`window.riffLineApi.fsAt` のみに依存。IPC reject から軽量エラークラスを復元（B31） |
| `src/renderer/main.tsx` / `App.tsx` | React 最小シェル。`ScoreRenderHost` を初期化し `parseAlphaTex` のサンプルを1つ描画、`window.riffLineApi.fs.getRootPath()` を表示（画面群は Phase 8） |
| `src/renderer/env.d.ts` | `window.riffLineApi` の型宣言 + `vite/client` |
| `src/renderer/public/alphatab/` | alphaTab フォント・SoundFont（`scripts/copy-alphatab-assets.mjs` が配置、`.gitignore` 対象）。SoundFont は配置のみ・非ロード |
| `scripts/copy-alphatab-assets.mjs` | alphaTab アセットを `src/renderer/public/alphatab/` へコピー（`predev` / `prebuild`） |
| `electron.vite.config.ts` | `electron-vite`（main/preload は CJS 出力・`electron` external、renderer は React + ESM）。ビルド成果物は `dist-electron/{main,preload,renderer}` |

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
