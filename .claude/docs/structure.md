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

Phase 1 / 作業パッケージ1「Webコア基盤構築」・2「データモデル・永続化」・3「エラー・ログ基盤」・4「タブ譜編集コア」・5「パート・チューニング管理」・6「表示モード」実装済み。6（`feature/view-modes`）：`packages/core/src/viewmodes` を実体化（`ViewModeController`〈focus/scroll/score 切替・フォーカス範囲追従・パート追従、編集ウィンドウ単位〉/ `ZoomController`〈モード別に独立したズーム％、B16、編集ウィンドウ単位〉）、`ScoreRenderHost` へ `applyViewMode`／`applyZoom` を非破壊追加。パート識別色オーバーレイの `data-track-index` 属性方式は alphaTab 1.8.4 の SVG 出力に付与先が無く実装不能のため `boundsLookup` 幾何オーバーレイ方式へ変更、色オーバーレイ本体はパッケージ8へ繰り越し（B34、G24）。以降の `packages/core/src` 配下ディレクトリ（`ui` / `playback` / `export`）は空（`.gitkeep` のみ）で、対応する作業パッケージで実装する。

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
| `src/rendering/ScoreRenderHost.ts` | alphaTab `AlphaTabApi` を1個保持する唯一の窓口。`initialize` / `loadScore` / `render(trackIndices?)` / `dispose` / `on` / `off` / `isInitialized` / `static parseAlphaTex` ＋ `applyViewMode(request)` / `applyZoom(scale)`（パッケージ6 非破壊拡張、`settings.display.{scale,layoutMode,startBar,barCount}`＋`renderTracks`）。他モジュールに生 API を触らせない（`00_reference.md` §3.1・§3.6）。alphaTab は `core.useWorkers: false`（メインスレッド同期描画）で構成 — Web Worker 自動生成が厳格 CSP と衝突するため（13_design_decision_points.md B30） |
| `src/rendering/types.ts` | `RenderHostOptions`（`engine: 'svg'` 固定 / `fontAssetsBasePath` / `soundFontAssetsBasePath`）、`RenderHostEvents`（`'renderStarted' | 'renderFinished' | 'renderError'`）、`RenderViewMode`（`'focus'|'scroll'|'score'`、`domain` の `ViewMode` と構造同一だがレイヤー方向のため独自保持）／`FocusRange`／`ViewModeRenderRequest`（パッケージ6） |
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
| `src/errors/NotificationCenter.ts` | 4段階メッセージの窓口（`report`/`subscribe`/`getRecentBuffer`/`setLogSink`）。`toLogEntry`（Error/Critical に合成 stack）。Webコア内シングルトン。`error-logging-foundation.md` §2.1 |
| `src/errors/Logger.ts` | 永続ログ（main プロセス）。`append`（直列化キュー）/`flush`/`writeCrashLog`/`enforceQuota`（`DEFAULT_LOG_QUOTA_BYTES=10MB`、古い順削除）/`getLogFolderAbsolutePath`。`dateStamp`/`dateTimeStamp` |
| `src/errors/ErrorCodeRegistry.ts` / `coreErrorCodes.ts` | `register`/`resolve`（未登録は `UnknownErrorCodeError`）/`has`。`CORE_ERROR_CODES`＝FILE-001..005 / SYS-001,002 / RENDER-001（8件）＋`registerCoreErrorCodes` |
| `src/errors/channels.ts` / `messageTemplate.ts` / `errors.ts` / `types.ts` | `LEVEL_TO_CHANNEL`、`renderMessageTemplate`（`{context.xxx}`、欠落は残置）、`UnknownErrorCodeError`、`LogSink`/`ErrorCodeDefinition`（IPC 越え型は shared-types を re-export） |
| `src/errors/index.ts` | バレル ＋ 共有 `notificationCenter` / `errorCodeRegistry`（コア8コード登録済み）。`@riff-line/core/errors` サブパスで公開 |
| `src/editing/types.ts` / `scoreModel.ts` | `Command` / `CommandOutcome` / `CursorPosition` / `SelectionRange` / `ValidationOutcome` / `CommandAppliedEvent` / `EditTarget`。alphaTab model グラフの走査・生成ヘルパー（`getBeat` 等・`insertBeatAt`・`MIN/MAX_FRET`・`MAX_BAR_COUNT`） |
| `src/editing/CursorController.ts` | 位置・入力音価・和音入力モード・範囲選択の保持（UI状態、Undo対象外）。`applyOutcome` / `onChange` |
| `src/editing/CommandHistory.ts` | execute/undo/redo（`CommandOutcome` 返す）・再描画一元化（`render(affectedTrackIndices)`）・80MB予算/200件下限/最古エビクション/`EDIT-008`初回のみ・`subscribe`/`onCommandApplied`。編集ウィンドウごとに1インスタンス |
| `src/editing/CompositeCommand.ts` / `commandBase.ts` | 子を登録順execute・逆順undo。`BASE_COMMAND_BYTES` / `estimateSnapshotBytes` |
| `src/editing/commands/*.ts` | `PlaceNoteCommand`（休符変換/和音/新規Beat）/`InsertRestCommand`/`noteAttributeCommands`（Tie/Slur/Technique/ChordName、`finish()` 不使用で対称性保証）/`SetTempoCommand`/`memoCommands`（Add/Edit/Delete、`AppMetadata.memos`）/`sectionMarkerCommands`（＋`MasterBar.section`ミラー）/`barCommands`（`InsertBar`/`DeleteBar`、全パート同期・B5継承・B2 disposition）/`PasteCommand`（B3非対称・`EDIT-009`） |
| `src/editing/ValidationService.ts` | `validateNotePlacement`（`EDIT-001/002`）/`validateBarInsertion`（`EDIT-003`）/`validateMemoText`（`EDIT-004`＋切詰め）。パッケージ5 が非破壊拡張 |
| `src/editing/ChordDetectionService.ts` | 構成音→ピッチクラス集合→辞書照合（maj/m/7/maj7/m7/dim/aug/sus/6/power、転回形）。`Beat.text` override 優先。純関数 `detectFromPitchClasses` |
| `src/editing/EditingService.ts` | UI入力→検証→コマンド/通知の振り分け、カーソル前進、`suggestTechnique`（B4）、`chordNameAt` |
| `src/editing/editErrorCodes.ts` / `index.ts` | `EDIT-001`〜`004`・`008`・`009` 定義＋`registerEditErrorCodes`。バレルが共有 `errorCodeRegistry` へ副作用登録。`@riff-line/core/editing` サブパス |
| `src/testing/editingFakes.ts` / `editingFixtures.ts` | テスト専用：`FakeCommand` / `RecordingRenderRequester` / `RecordingReporter` / `buildEditTarget` / `scoreJson`、`makeSong` / `makeSongWithBars` / `makeEditingRig`（§11 の `tools/` フィクスチャは当面ここ） |
| `src/parts/partModel.ts` | alphaTab `Track`/`Staff` をパートとして扱うヘルパー（`getTrack` / `getTuning` / `getStringCount` / `getCapo` / `getMixer` / `getColorHex` / `hexToColor` / `colorToHex` / `buildPartTrack`）。`getStaff`/`trackCount` は editing から再利用 |
| `src/parts/PartColorAllocator.ts` | ステートレスな8色パレット割当（`PART_COLOR_PALETTE`、used∪reserved 除外、§3.6） |
| `src/parts/PartValidationService.ts` | `ValidationService` のサブクラス（非破壊拡張）。`validatePartCount`(`EDIT-005`)/`validateCapoFret`(`EDIT-007`、0-12)/`validateTuningPresetApplication`(`EDIT-006`) |
| `src/parts/commands/*.ts` | `partAttributeCommands`（`SetPart{Volume,Pan}` ＝ドラッグ結合、`{Solo,Mute,Color}`、`SetCapoFret`）/`structuralPartCommands`（`AddPart`/`RemovePart`〈全体保持・C11予算〉/`ReorderParts`〈順列・不完全順列耐性〉）/`tuningCommands`（`ApplyTuningPreset`〈B15 弦数同期・減少で Note 破棄＋`EDIT-006`〉/`SetCustomTuning`）。`finish()` は呼ばない |
| `src/parts/PartManagementService.ts` | パートCRUD・ミキサー/カポ変更受付。`addPart`（色自動割当・`peekNextColor`）/`removePart`（最低1保持）/`reorderParts`/`set{Volume,Pan,Solo,Mute,Color,Capo}`/`listParts` |
| `src/parts/TuningPresetStore.ts` / `TuningPresetService.ts` | `tuning-presets.json` の read/write ＋ 組み込み6種・CRUD・論理削除（B27）・`purgeExpired`（7日/20件）・`applyPreset`（当該曲の `CommandHistory` へ）・`snapshotTuningFrom` |
| `src/parts/index.ts` | バレル。`EDIT-005`〜`007` を共有 `errorCodeRegistry` へ副作用登録。`@riff-line/core/parts` サブパス |
| `src/viewmodes/types.ts` | `ViewModeRenderHost`（`applyViewMode`/`applyZoom` の最小契約、`ScoreRenderHost` 非結合の縫い目）／`CursorLike`（`ViewModeController` が要求する `CursorController` 部分契約）。`RenderViewMode`/`FocusRange`/`ViewModeRenderRequest` は `rendering/types.ts` から再輸入 |
| `src/viewmodes/ViewModeController.ts` | 表示モード（focus/scroll/score）の保持・切替。`setViewMode`（カーソル状態不変、focus 切替時のみレンジ取り直し）/`currentMode`/`focusVisibleRange`/`onChange`/`dispose`。カーソル購読で focus はレンジ外に出た時のみ追従・focus/scroll は trackIndex 変化で対象パート追従・score は追従しない。`FOCUS_RANGE_BAR_SPAN=8` |
| `src/viewmodes/ZoomController.ts` | モード別に独立したズーム％保持（B16）。`setZoom`（現在モードのみ・`[25,400]` クランプ・`host.applyZoom(percent/100)`・`onZoomChange` 通知）/`zoomIn`/`zoomOut`（±10）/`reapplyForCurrentMode`（モード切替後に bootstrap が呼ぶ）。ctor に `getCurrentMode: () => RenderViewMode`。`initialZoomPercentByMode` は `AppPreferencesService` 由来値の注入口。`DEFAULT_ZOOM_PERCENT_BY_MODE={focus:180,scroll:100,score:100}`（暫定） |
| `src/viewmodes/index.ts` | バレル。エラーコード追加なし。`@riff-line/core/viewmodes` サブパス |
| `src/testing/viewModeFakes.ts` | テスト専用：`RecordingViewModeRenderHost`（`applyViewMode`/`applyZoom` 記録）/ `FakeCursor`（`moveTo` で購読者通知）。本番バレル非公開 |
| `src/{ui,playback,export}/` | 空（`.gitkeep`）。各作業パッケージで実装 |

## `packages/shared-types` — 共有型（`@riff-line/shared-types`）

| パス | 責務 |
| --- | --- |
| `src/index.ts` | IPC 契約とプラットフォーム抽象の型。`FileSystemAdapter`（+`renameFile`/`deleteFile`/`copyFile`/`exists`）・`FileSystemAdapterFactory`・`AppLocalConfigService`・`StorageRootPointer`・`DirEntry`。`FS_CHANNELS`（`fs:readFile` 等5本 + `fs:*At` 8本）・`APP_CONFIG_CHANNELS`・`LOG_CHANNELS`（`log:append`）・`CRASH_CHANNELS`（`crash:getRecoveryState`、B32）、各チャンネルの Request/Response 型、`NotificationEvent`/`LogEntry`/`NotificationLevel`/`NotificationChannel`/`CrashRecoveryState`、`RiffLineApi`（`fs`/`fsAt`/`appConfig`/`log`/`crash`）。`packages/core` と `apps/desktop` の三者から共有 |

## `apps/desktop` — Electron ラッパー（`@riff-line/desktop`、L5、Phase 1）

**`apps/desktop/package.json` の `version` が PC版バージョンの真実源（B24）。**

| パス | 責務 |
| --- | --- |
| `src/main/main.ts` | エントリポイント。`requestSingleInstanceLock` → `whenReady` → `Logger` 生成＋起動時 `enforceQuota(10MB)` → IPC 登録（fs / appconfig / `registerLogHandlers`）→ `CrashRecoveryController.attach(createMainWindow())`（`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` / preload 指定） |
| `src/main/CrashRecoveryController.ts` | `render-process-gone` 購読（`clean-exit` 除外）。クラッシュで `crashCountThisSession`+1・`reload()`・`onCrash` フック。`consumeRecoveryState()`→`{recovered, repeatedCrash}`（`REPEATED_CRASH_THRESHOLD=3`）。通知は renderer 側が発行（B32、`error-logging-foundation.md` §2.3） |
| `src/main/LogRingBuffer.ts` | main 側の直近 `NotificationEvent` 履歴（クラッシュログ添付用、`DEFAULT_LOG_RING_SIZE=200`）。`push`/`snapshot`/`size` |
| `src/main/ElectronFileSystemAdapter.ts` | `FileSystemAdapter` 実装（+`renameFile`/`deleteFile`/`copyFile`/`exists`）。`fs/promises` ラッパー。Node 固有エラーを `FileNotFoundError`/`FileReadError`/`FileWriteError` に変換。`readFile` にオンデマンドDL対策（§6、既定 on、opt-out 可） |
| `src/main/ElectronFileSystemAdapterFactory.ts` | `FileSystemAdapterFactory` 実装。絶対パスごとに Adapter を1個キャッシュ（B31） |
| `src/main/ElectronAppLocalConfigService.ts` | `AppLocalConfigService` 実装。`{userData}/storage-pointer.json`、`getActiveRoot`（既定 `{userData}/TabApp`）、`getLocalBackupRoot`（`{userData}/LocalBackup`、B25） |
| `src/main/onDemandRetry.ts` | `retryOnEmptyRead`：空データ時の指数バックオフ再試行（§6、A5、`ONDEMAND_RETRY_BACKOFF_MS`） |
| `src/main/ipc.ts` | `registerFsHandlers`（5本）/ `registerFsAtHandlers`（`fs:*At` 8本、Factory 経由）/ `registerAppConfigHandlers`（`appconfig:*` 4本）/ `registerLogHandlers`（`log:append`→onEvent、`crash:getRecoveryState`→resolver、B32）。委譲のみ |
| `src/preload/preload.ts` | `contextBridge.exposeInMainWorld('riffLineApi', { fs, fsAt, appConfig, log, crash })`。`ipcRenderer.invoke` の型安全ラッパーのみ公開。Node/Electron モジュールは非公開 |
| `src/renderer/index.html` | レンダラーのエントリ HTML（CSP: 自己オリジンのみ） |
| `src/renderer/ipcFileSystem.ts` | `IpcFileSystemAdapter` / `IpcFileSystemAdapterFactory`：`window.riffLineApi.fsAt` のみに依存。IPC reject から軽量エラークラスを復元（B31） |
| `src/renderer/errorLoggingBootstrap.ts` | `notificationCenter.subscribe` → `window.riffLineApi.log.append` へ全イベント転送。起動時 `crash.getRecoveryState()` を1回引き `SYS-001`/`SYS-002` を発行（B32） |
| `src/renderer/main.tsx` / `App.tsx` | React 最小シェル。`ScoreRenderHost` を初期化し `parseAlphaTex` のサンプルを1つ描画、`window.riffLineApi.fs.getRootPath()` を表示。`bootstrapErrorLogging()` 実行＋`notificationCenter` 購読で通知一覧を表示、`renderError`→`RENDER-001`（画面群は Phase 8） |
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
