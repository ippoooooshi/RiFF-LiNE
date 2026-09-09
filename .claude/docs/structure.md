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

Phase 1 / 作業パッケージ1〜8 実装済み（1「Webコア基盤構築」・2「データモデル・永続化」・3「エラー・ログ基盤」・4「タブ譜編集コア」・5「パート・チューニング管理」・6「表示モード」・7「再生エンジン統合」・8「画面群・ナビゲーション」）。Phase 1（PC版MVP）実装フェーズ完了。8（`feature/screens-navigation`）：`packages/core/src/ui` を実体化（`AppPreferencesService`／`TagStore`／`ThumbnailGenerator`／`NotificationUIBinder`／`ScoreHighlightBinder`／`ToolbarViewModel`／`StatusBarViewModel`／`MenuBarController`／`KeyboardShortcutRouter`／`PartColorOverlay`〈G24 解消〉／`PlaybackPreferencesAdapter`／`uiErrorCodes`〈`TAG-001`/`SONG-001`/`SONG-002`〉）、`apps/desktop/src/renderer/screens` に React 画面シェル15件、`apps/desktop/src/main/WindowManager.ts`（`WindowAdapter` 実装）、`ScoreRenderHost` へ `showErrorHighlight`/`clearErrorHighlight`/`getPartRegions` を非破壊追加、`@riff-line/shared-types` に `WindowAdapter`／`WINDOW_CHANNELS`／`RiffLineApi.windows` を追加。フレームワーク非依存ロジックはコア、JSX は L5 という分割は B36。6（`feature/view-modes`）：`packages/core/src/viewmodes` を実体化（`ViewModeController`／`ZoomController`）、`ScoreRenderHost` へ `applyViewMode`／`applyZoom` を非破壊追加。色オーバーレイ本体はパッケージ8へ繰り越し（B34、G24）。7（`feature/playback-integration`）：`packages/core/src/playback` を実体化（`PlaybackService`／`PlaybackSyncController`／`PlaybackMixerBinder`／`AudioSyncStrategy` 2 実装／`MetronomeService`／`CountInController`／`TapTempoController`／`PlaybackCursorFollow`）、カポ実音変換式を `domain/pitch.ts` の共有純粋関数 `computeRealMidiPitch` へ抽出（B18、`ChordDetectionService` も委譲）、`ViewModeController` へ `isBarVisible`／`revealBar` を非破壊追加。生 `AlphaSynth` を扱う `PlaybackSynth` 実装の配線と `preWarm` の起動シーケンス挿入は bootstrap（パッケージ8）／Phase 1 実機検証へ委譲。`packages/core/src/export` は空（`.gitkeep` のみ）で、Phase 2「エクスポート・印刷」で実装する。

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
| `src/rendering/index.ts` / `src/index.ts` | パッケージ公開バレル（`src/index.ts` が rendering・platform・domain・persistence・errors・editing・parts・viewmodes・playback を再エクスポート） |
| `src/domain/types.ts` | `SongDocument`／`AppMetadata`／`SongFileJson`（`schemaVersion`/`id`/`createdAt`/`song`/`appMeta`/`integrity`）／`SongSummary`／`TuningPreset`／`Tag`／`NewSongSetup`／`ViewMode` 等の型 |
| `src/domain/sha256.ts` / `checksum.ts` | 依存なし同期 SHA-256、決定的 JSON 正規化 + `computeChecksum(schemaVersion, song, appMeta)`（§9.2） |
| `src/domain/pitch.ts` | `computeRealMidiPitch(openStringPitch, capoFret, frettedFret)`：カポ運指→実音変換式（`開放弦 + capo + fret`、B18）。共有純粋関数（`PlaybackService` と将来の `MidiExportService` が使用、`ChordDetectionService` も委譲。00_reference.md §2、playback-integration.md §3.2） |
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
| `src/viewmodes/ViewModeController.ts` | 表示モード（focus/scroll/score）の保持・切替。`setViewMode`（カーソル状態不変、focus 切替時のみレンジ取り直し）/`currentMode`/`focusVisibleRange`/`isBarVisible(barIndex)`/`revealBar(barIndex)`（パッケージ7 非破壊追加：再生カーソル追従の「表示範囲更新 API」、focus のみ範囲外で再センタリング）/`onChange`/`dispose`。カーソル購読で focus はレンジ外に出た時のみ追従・focus/scroll は trackIndex 変化で対象パート追従・score は追従しない。`FOCUS_RANGE_BAR_SPAN=8` |
| `src/viewmodes/ZoomController.ts` | モード別に独立したズーム％保持（B16）。`setZoom`（現在モードのみ・`[25,400]` クランプ・`host.applyZoom(percent/100)`・`onZoomChange` 通知）/`zoomIn`/`zoomOut`（±10）/`reapplyForCurrentMode`（モード切替後に bootstrap が呼ぶ）。ctor に `getCurrentMode: () => RenderViewMode`。`initialZoomPercentByMode` は `AppPreferencesService` 由来値の注入口。`DEFAULT_ZOOM_PERCENT_BY_MODE={focus:180,scroll:100,score:100}`（暫定） |
| `src/viewmodes/index.ts` | バレル。エラーコード追加なし。`@riff-line/core/viewmodes` サブパス |
| `src/testing/viewModeFakes.ts` | テスト専用：`RecordingViewModeRenderHost`（`applyViewMode`/`applyZoom` 記録）/ `FakeCursor`（`moveTo` で購読者通知）。本番バレル非公開 |
| `src/playback/types.ts` | 再生統合の境界型。`PlaybackSynth`（AlphaSynth の唯一の薄い窓口）/`TickMap`/`AudioSyncStrategy`/`PlaybackViewport`/`PlaybackPreferences(Source)`＋`DEFAULT_PLAYBACK_PREFERENCES`。生 `AlphaSynth` 実装は bootstrap（パッケージ8）／Phase 1 に閉じる |
| `src/playback/tickMap.ts` | `ArrayTickMap`（小節先頭 tick 配列で tick⇔小節を相互変換）＋`buildBarTickBoundaries(score)`（`MasterBar.calculateDuration()` の積算） |
| `src/playback/PlaybackService.ts` | 再生制御ファサード（編集ウィンドウ単位）。`preWarm`/`play`/`pause`/`stop`/`seekToBar`/`setRegionLoop`/`setSectionLoop`/`clearLoop`/`setSoloTracks`/`setTempoFactor`/`resolvePlaybackPitch`（`computeRealMidiPitch`）/`isPlaying`/`dispose`。ループ終端 tick 到達で開始小節へ再シーク（§4.1） |
| `src/playback/PlaybackSyncController.ts` | dirty トラック管理・小節境界フラッシュ（§3.1 単一ルール）。`onCommandApplied` を再生中のみ購読し dirty へ加算、位置イベントの小節境界（ループ境界含む）で `AudioSyncStrategy` 経由フラッシュ→クリア。停止で dirty 破棄 |
| `src/playback/AudioSyncStrategy.ts` | `PartialReloadStrategy`／`PauseResumeStrategy`＋`createDefaultAudioSyncStrategy()`（A4 未解決のため既定＝`PauseResumeStrategy`）。設定切替のみで入替可能 |
| `src/playback/PlaybackMixerBinder.ts` | `onCommandApplied` 購読→通知のたびに全チャンネルの volume/pan/solo と（ソロ優先を加味した）実効 mute を AlphaSynth へ一律再送（冪等・分類しない）。`syncAll`/`dispose` |
| `src/playback/MetronomeService.ts` | クリック音（`MetronomeClickSink` 委譲、1 拍目 `accented`、プリセット/音量は `PlaybackPreferencesSource` から）。`playPattern(measureCount, beatsPerMeasure, beatDurationMs)`／`applyToSynth(synth, enabled)` |
| `src/playback/CountInController.ts` | 設定倍率（C2、1/2 小節）ぶんの `MetronomeService.playPattern` → 完了後 `PlaybackService.play()`。`start(context)`/`cancel()` |
| `src/playback/TapTempoController.ts` | 直近 `sampleSize` 件（既定4、`refreshPreferences` で更新）のタップ平均間隔→BPM（`[MIN,MAX]_TEMPO_BPM` クランプ、`TAP_RESET_GAP_MS=2000` でリセット）。`tap()`/`currentBpm`/`commit(barIndex)`（`SetTempoCommand` 発行）/`reset()` |
| `src/playback/PlaybackCursorFollow.ts` | 位置イベント購読→再生カーソルの小節が表示範囲外なら `PlaybackViewport.revealBar` を呼ぶ（範囲内は無操作）。`dispose` |
| `src/playback/index.ts` | バレル。エラーコード追加なし。`@riff-line/core/playback` サブパスで公開 |
| `src/testing/playbackFakes.ts` | テスト専用：`FakePlaybackSynth`（位置/状態イベント発火）/`FakeTickMap`/`FakeCommandAppliedSource`/`FakePlaybackPreferences`/`RecordingMetronomeSink`/`RecordingViewport`/`RecordingTempoCommandSink`/`createImmediateScheduler`。本番バレル非公開 |
| `src/ui/types.ts` | 画面群のフレームワーク非依存型。`AppPreferences`（＋`DEFAULT_APP_PREFERENCES`・各クランプ定数）／`SongListLayout`／`MetronomePresetId`／`MenuItemDescriptor`／`ToolbarState`／`StatusBarState`／`UiNotificationReporter`（screens-navigation.md §3・§4） |
| `src/ui/AppPreferencesService.ts` | 設定ダイアログ項目1〜6・8・11＋曲一覧表示方式＋`onboardingSeen` の read/write。`preferences.json`（`settings.json` と分離、G16）。`load`/`save` とも `normalize`（未知キー除去・型不一致の既定値化・数値クランプ）。C2＝ズーム倍率/タップテンポ感度/音量の境界（§3.1・§6） |
| `src/ui/TagStore.ts` | `tags.json` のタグマスタ CRUD。`create` は前後空白除去・同名は既存返し・50 件到達で `TAG-001`＋`null`（as-built は `Promise<Tag \| null>`）。`MAX_TAG_COUNT`（§3.2・§3.5・G7） |
| `src/ui/ThumbnailGenerator.ts` | 先頭1段 SVG→**実 PNG**（`<img>`→`canvas.drawImage`→`toDataURL('image/png')`→`stripDataUrlPrefix`）。`wrapSave(save)` が保存直前に `appMeta.thumbnail` を差し込む非破壊フック（B7、G6）。DOM 依存は `rasterizeEnv.{createCanvas,loadImage}` 縫い目、2D 非対応/デコード失敗で `null`。純関数 `svgToDataUrl`/`stripDataUrlPrefix`（独立レビュー B-1 で SVG ソース base64 化の自己矛盾を是正） |
| `src/ui/NotificationUIBinder.ts` | `NotificationCenter.subscribe` → `event.channel`（toast/highlight/modal）で対応シンクへ振り分け（C1、§4.5・§5.3）。`attach` 冪等・`detach` |
| `src/ui/ScoreHighlightBinder.ts` | highlight チャンネルの `context`（`barIndex`/`trackIndex`/`barCount`、文字列許容）→ `ScoreRenderHost.showErrorHighlight`。`barIndex` 無し（`TAG-001` 等）は `clearErrorHighlight` のみ（§4.5.1） |
| `src/ui/ToolbarViewModel.ts` | 編集ウィンドウごと。`CommandHistory.subscribe` で Undo/Redo 活性、`PlaybackStateSource`（任意）で `isPlaying`、パネル表示トグル（Undo 対象外）。`getState`/`onChange`/`togglePanel`/`setPanelVisible`/`dispose`（§4.4） |
| `src/ui/StatusBarViewModel.ts` | 編集ウィンドウごと。小節/拍子/テンポ/カポ（provider）＋ズーム％（`ZoomController`）。`cursor.onChange` で自動 refresh、ズーム変更時は bootstrap が `refresh()`（§4.4、14_visual_design_system.md §4） |
| `src/ui/MenuBarController.ts` | 03_screens_ui_pc.md §6 のメニューを `MenuItemDescriptor[]` として組み立て action へ配線。`buildTemplate`/`invoke(id)`。未配線は `enabled:false`、エクスポート/印刷は B19 で既定無効（§4.2・§3.6） |
| `src/ui/KeyboardShortcutRouter.ts` | `register`/`handleKeyEvent(event, {isTextInputFocused})`。`normalizeCombo`（`mod`→`shift`→`alt`＋小文字キー）。テキスト入力中は `allowInTextInput` 以外を通さない（§4.3、03_screens_ui_pc.md §7） |
| `src/ui/PartColorOverlay.ts` | G24 解消。`ScoreRenderHost.getPartRegions()` の矩形＋パート色 HEX から半透明カラーバンド `<div>` を重ねる DOM/CSS 生成。`update`/`clear`/`dispose`。`PART_COLOR_OVERLAY_CLASS` |
| `src/ui/PlaybackPreferencesAdapter.ts` | `AppPreferencesService` → `PlaybackPreferencesSource.load()` の橋渡し（`MetronomeService`/`CountInController`/`TapTempoController` の設定値入力元、playback-integration.md §4.4、9.10節の実体化） |
| `src/ui/uiErrorCodes.ts` | `TAG-001`（Error）/`SONG-001`（Warning）/`SONG-002`（Error）定義＋`registerUiErrorCodes`。`ui/index.ts` が共有 `errorCodeRegistry` へ副作用登録（§3.5、00_reference.md §5） |
| `src/ui/index.ts` | バレル。`@riff-line/core/ui` サブパス。読み込み時に `registerUiErrorCodes` を副作用実行 |
| `src/ui/*.test.ts` / `src/ui/screensNavigation.integration.test.ts` | 単体＋結合（通知の UI 振り分けの通し・複数編集ウィンドウの ViewModel 独立） |
| `src/export/` | 空（`.gitkeep`）。Phase 2「エクスポート・印刷」で実装 |

## `packages/shared-types` — 共有型（`@riff-line/shared-types`）

| パス | 責務 |
| --- | --- |
| `src/index.ts` | IPC 契約とプラットフォーム抽象の型。`FileSystemAdapter`（+`renameFile`/`deleteFile`/`copyFile`/`exists`）・`FileSystemAdapterFactory`・`AppLocalConfigService`・`StorageRootPointer`・`DirEntry`・`WindowAdapter`（screens-navigation.md §4.1、AD-3 の未定義枠）。`FS_CHANNELS`（`fs:readFile` 等5本 + `fs:*At` 8本）・`APP_CONFIG_CHANNELS`・`LOG_CHANNELS`（`log:append`）・`CRASH_CHANNELS`（`crash:getRecoveryState`、B32）・`WINDOW_CHANNELS`（`window:openSong`/`openSongList`＋クローズ時 flush の `flushAutoSaveRequest`/`flushAutoSaveAck`、パッケージ8）、各チャンネルの Request/Response 型、`NotificationEvent`/`LogEntry`/`NotificationLevel`/`NotificationChannel`/`CrashRecoveryState`、`RiffLineApi`（`fs`/`fsAt`/`appConfig`/`log`/`crash`/`windows`〈`openSong`/`openSongList`/`onFlushAutoSaveRequest`/`ackFlushAutoSave`〉）。`packages/core` と `apps/desktop` の三者から共有 |

## `apps/desktop` — Electron ラッパー（`@riff-line/desktop`、L5、Phase 1）

**`apps/desktop/package.json` の `version` が PC版バージョンの真実源（B24）。**

| パス | 責務 |
| --- | --- |
| `src/main/autoSaveFlushBridge.ts` | `AutoSaveFlushBridge`：クローズ確定前の自動保存 flush ハンドシェイク（token 付き `WINDOW_CHANNELS.flushAutoSaveRequest` send → `flushAutoSaveAck` またはタイムアウト〈既定5秒〉）。`main.ts` が `songId→BrowserWindow` を保持して宛先解決（独立レビュー B-2、electron.rule.md IPC 規約） |
| `src/main/CrashRecoveryController.ts` | `render-process-gone` 購読（`clean-exit` 除外）。クラッシュで `crashCountThisSession`+1・`reload()`・`onCrash` フック。`consumeRecoveryState()`→`{recovered, repeatedCrash}`（`REPEATED_CRASH_THRESHOLD=3`）。通知は renderer 側が発行（B32、`error-logging-foundation.md` §2.3） |
| `src/main/LogRingBuffer.ts` | main 側の直近 `NotificationEvent` 履歴（クラッシュログ添付用、`DEFAULT_LOG_RING_SIZE=200`）。`push`/`snapshot`/`size` |
| `src/main/ElectronFileSystemAdapter.ts` | `FileSystemAdapter` 実装（+`renameFile`/`deleteFile`/`copyFile`/`exists`）。`fs/promises` ラッパー。Node 固有エラーを `FileNotFoundError`/`FileReadError`/`FileWriteError` に変換。`readFile` にオンデマンドDL対策（§6、既定 on、opt-out 可） |
| `src/main/ElectronFileSystemAdapterFactory.ts` | `FileSystemAdapterFactory` 実装。絶対パスごとに Adapter を1個キャッシュ（B31） |
| `src/main/ElectronAppLocalConfigService.ts` | `AppLocalConfigService` 実装。`{userData}/storage-pointer.json`、`getActiveRoot`（既定 `{userData}/TabApp`）、`getLocalBackupRoot`（`{userData}/LocalBackup`、B25） |
| `src/main/onDemandRetry.ts` | `retryOnEmptyRead`：空データ時の指数バックオフ再試行（§6、A5、`ONDEMAND_RETRY_BACKOFF_MS`） |
| `src/main/WindowManager.ts` | `WindowAdapter` 実装（screens-navigation.md §4.1）。曲一覧/編集ウィンドウの生成・`focusExistingWindow`（既存×最小化/既存×非最小化/新規 の複合条件 C2）・編集ウィンドウ単位インスタンス一式の紐付け／破棄・クローズ時 `flushAutoSave(songId)` 待ち（`finalizeClose` は管理表除去を `destroy()` 前に行い二重 dispose を防ぐ、非ブロッキング#5。`EditWindowInstances.dispose` は冪等契約）。実 `BrowserWindow` は `ManagedWindow` 契約＋注入ファクトリで抽象化（テストで Electron 非起動） |
| `src/main/ipc.ts` | `registerFsHandlers`（5本）/ `registerFsAtHandlers`（`fs:*At` 8本、Factory 経由）/ `registerAppConfigHandlers`（`appconfig:*` 4本）/ `registerLogHandlers`（`log:append`→onEvent、`crash:getRecoveryState`→resolver、B32）/ `registerWindowHandlers`（`window:openSong`/`openSongList`→`WindowManager`、パッケージ8）。委譲のみ |
| `src/main/main.ts` | エントリ。単一インスタンスロック → `whenReady` → Logger/CrashRecovery → IPC 登録（fs/appconfig/log/window）→ `WindowManager` 構築（`createBrowserWindow(route)` を `contextIsolation:true`/`nodeIntegration:false`/`sandbox:true` で。`#songlist`/`#edit/<songId>` ハッシュルート）→ `windowManager.openSongListWindow()` |
| `src/preload/preload.ts` | `contextBridge.exposeInMainWorld('riffLineApi', { fs, fsAt, appConfig, log, crash, windows })`。`windows.openSong(songId)`/`openSongList()` を追加。`ipcRenderer.invoke` の型安全ラッパーのみ公開。Node/Electron モジュールは非公開 |
| `src/renderer/index.html` | レンダラーのエントリ HTML（CSP: 自己オリジンのみ） |
| `src/renderer/ipcFileSystem.ts` | `IpcFileSystemAdapter` / `IpcFileSystemAdapterFactory`：`window.riffLineApi.fsAt` のみに依存。IPC reject から軽量エラークラスを復元（B31） |
| `src/renderer/errorLoggingBootstrap.ts` | `notificationCenter.subscribe` → `window.riffLineApi.log.append` へ全イベント転送。起動時 `crash.getRecoveryState()` を1回引き `SYS-001`/`SYS-002` を発行（B32） |
| `src/renderer/main.tsx` / `App.tsx` | `App.tsx` は薄いホスト＝ルーティング＋DI 組み立て（`location.hash` で `#songlist`＝`SongListWindow`／`#edit/<songId>`＝`EditWindow`）。`EditWindow` が編集ウィンドウ単位の `ScoreRenderHost`/`CommandHistory`/`CursorController`/`ViewModeController`/`ZoomController`＋`ToolbarViewModel`/`StatusBarViewModel`/`NotificationUIBinder`/`ScoreHighlightBinder`/`MenuBarController` を生成し `screens/` のシェルへ結ぶ（B36、9.25節） |
| `src/renderer/screens/*.tsx` | 03_screens_ui_pc.md 画面インベントリ 15 件（#8 除く）の React シェル：`common.tsx`（`Dialog`/`Panel`/`Field`/`Phase2Button`/`tokens`）・`SongListView`・`NewSongWizard`・`EditWindowShell`・`Panels.tsx`（`MixerPanel`/`FretboardOverlay`/`PartManagementPanel`/`TuningPanel`/`MemoListPanel`）・`Dialogs.tsx`（`SettingsDialog`/`TagManagementDialog`/`TrashDialog`/`LicenseDialog`）・`OnboardingOverlay`・`ExportPrintDialogs.tsx`（`ExportDialog`/`PrintPreviewDialog`＝B19 で実行ボタン無効化）・`index.ts`。ロジックは持たず props（`@riff-line/core/ui` の ViewModel/Service）を描画に結ぶだけ |
| `src/renderer/songActions.ts` | 新規曲作成オーケストレーション（Node 環境で UT 可能）。`createSongAndOpen`（曲数評価→`SongRepository.create`→`windows.openSong`、上限1000で`SONG-002`拒否・作成後900で`SONG-001`予告）／`warnIfNearSongLimit`（曲一覧ロード時）。`App.tsx` が実 dep を注入（独立レビュー 非ブロッキング#1・#2） |
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
