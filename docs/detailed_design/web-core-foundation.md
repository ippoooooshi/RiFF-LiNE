# 詳細設計書：Webコア基盤構築

- **対応作業パッケージ**：要件定義書9章「Webコア基盤構築」（相対サイズM）、実施順序1（[[../basic_design/13_design_decision_points.md#3]]B11）
- **ブランチ名**：`feature/web-core-foundation`
- **前提とする基本設計書**：[[../basic_design/01_architecture.md]]、[[../basic_design/09_nonfunctional.md]]、[[../basic_design/15_development_process.md]]。永続化の本格実装（自動保存・スキーマバージョニング等）は次パッケージ「データモデル・永続化」の範囲であり、本書ではその土台となる低レベルfs I/Oのみを扱う。
- **本書の位置づけ**：[[../basic_design/15_development_process.md#1.2]]に基づく詳細設計書。基本設計（責務・契約レベル）を受けて、クラス構成・主要メソッドシグネチャ・起動シーケンスを実装着手前に確定する。

---

## 1. 目的・スコープ

このパッケージは以降の全作業パッケージが乗る土台であり、次の4点を確立する。

1. pnpmモノレポの実体化（[[../basic_design/01_architecture.md#3]]AD-5の具体化）
2. alphaTabライブラリの統合（レンダリングのみ。編集APIは持たないためコマンド層からの利用方法を含めて基盤を用意する程度に留め、実際の編集操作は「タブ譜編集コア」パッケージで実装する）
3. Electron雛形（main/preload/renderer3プロセス構成、セキュリティ既定値、起動シーケンス）
4. ファイルシステムへの低レベル読み書き（`FileSystemAdapter`の最小実装：フォルダ配下の読み込み・書き込み・一覧取得のみ。自動保存・アトミック書き込みの完全な作法・複数バックエンド切替UIは次パッケージ以降）

**スコープ外**（他パッケージが担当）：Song/Part/Bar等の構造化データモデル（→データモデル・永続化）、コマンド層・Undo/Redo（→タブ譜編集コア）、実際の譜面編集操作（→タブ譜編集コア）、再生（→再生エンジン統合）、画面群のUI実装（→画面群・ナビゲーション。本パッケージでは空の1画面のみ用意する）。

## 2. モノレポ構成（AD-5の具体化）

```
riff-line/
├─ pnpm-workspace.yaml
├─ .nvmrc
├─ tsconfig.base.json
├─ eslint.config.js        （フラットコンフィグ。6節で確定）
├─ packages/
│  ├─ core/
│  │  ├─ package.json
│  │  ├─ src/
│  │  │  ├─ ui/            （空、画面群パッケージで実装）
│  │  │  ├─ editing/        （空、タブ譜編集コアパッケージで実装）
│  │  │  ├─ playback/        （空、再生エンジン統合パッケージで実装）
│  │  │  ├─ domain/          （空、データモデル・永続化パッケージで実装）
│  │  │  ├─ export/          （空、Phase 2で実装）
│  │  │  ├─ errors/          （空、エラー/ログ基盤パッケージで実装）
│  │  │  ├─ rendering/       ★本パッケージで実装：alphaTab統合ラッパー
│  │  │  └─ platform/        ★本パッケージで実装：PlatformAdapter I/F定義＋FileSystemAdapterの最小実装契約
│  │  └─ tsconfig.json
│  └─ shared-types/
│     └─ src/index.ts        ★本パッケージで実装：IPC契約の型、PlatformAdapter系の型
├─ apps/
│  ├─ desktop/
│  │  ├─ src/main/           ★本パッケージで実装：Electronメインプロセス
│  │  ├─ src/preload/        ★本パッケージで実装：contextBridge
│  │  └─ src/renderer/       ★本パッケージで実装：packages/coreをホストする最小シェル画面
│  └─ mobile/                （空、Phase 3）
└─ tools/                    （空、次パッケージ以降で開発用サンプルデータ生成スクリプトを追加）
```

`packages/core`から`electron`・`expo-*`への直接import を禁止するESLintルール（6節）は本パッケージで導入し、以降全パッケージに適用され続ける。

## 3. パッケージ／モジュール構成とクラス責務

### 3.1 `packages/core/src/rendering`（新設）

alphaTabの初期化・レンダリング呼び出しを1箇所に集約し、他モジュール（将来の編集サービス・再生サービス）がalphaTabの生API（`AlphaTabApi`）に直接依存しないようにするファサード。[[../basic_design/13_design_decision_points.md#2]]A1・A2の調査結果（自前再描画方式・SVGエンジン採用）を反映する。

| クラス/モジュール | 責務 | 主要メソッド | 備考 |
|---|---|---|---|
| `ScoreRenderHost` | alphaTabの`AlphaTabApi`インスタンスを1つ保持し、初期化・破棄・再描画要求の唯一の窓口になる | `initialize(container: HTMLElement, options: RenderHostOptions): void`／`loadScore(score: unknown): void`／`render(trackIndices?: number[]): void`／`dispose(): void` | `render()`が[[../basic_design/13_design_decision_points.md#2]]A1で確認した`AlphaTabApi.renderScore()`相当を内部で呼ぶ。編集コマンド層（次々パッケージ）は本クラス経由でのみ再描画を要求する |
| `RenderHostOptions`（型） | 初期化オプション | フィールド：`engine: 'svg'`（固定。A2の結果によりSVG採用を確定）、`fontAssetsBasePath: string`、`soundFontAssetsBasePath: string`（本パッケージでは未使用、再生パッケージ向けに先行定義） | 値はコード上の定数ではなく本クラスの引数として渡す（環境差異吸収のため） |
| `RenderHostEvents`（型） | `ScoreRenderHost`が発火するイベント名の列挙 | `'renderStarted' \| 'renderFinished' \| 'renderError'` | UI層（画面群パッケージ）がローディング表示等に利用する契約のみ本パッケージで確定し、実消費は画面群パッケージで行う |

**例外・エラー時の挙動**：`initialize()`はコンテナ要素が未マウントの場合に例外を投げる。`loadScore()`は不正なScoreオブジェクト（alphaTabのパースが失敗するもの）を渡された場合、内部で捕捉し`renderError`イベントとして通知する（例外を外部に投げない。エラー基盤パッケージの`NotificationCenter`が未実装のため、本パッケージでは`console.error`相当の暫定ログ出力＋イベント発火に留め、エラー基盤パッケージ完了後に`NotificationCenter`への連携に置き換える）。

**描画実行方式（2026-09-07 実装時確定、[[../basic_design/13_design_decision_points.md#3]]B30）**：`initialize()`は内部で alphaTab を**メインスレッド同期描画（`core.useWorkers: false`）**で構成する。alphaTab は既定で Web Worker 描画を行うが、ESM バンドル経由のワーカー自動生成は (1) `import.meta.url` 由来の URL（バンドラが事前最適化した alphaTab では実ファイルに解決されない）、(2) `blob:` ワーカー（レンダラーの厳格 CSP `script-src 'self'` が拒否、要件5.1）のいずれも失敗し、`renderFinished` が返らず描画が停止する。CSP を緩めない方針のため同期描画に固定した。あわせて `core.enableLazyLoading: false`（生成物を即座に全反映）とする。大曲向けの専用ワーカースクリプト同梱による非同期描画への移行余地は表示モード／再生パッケージ（[[view-modes.md]]・A9）で扱う（`ScoreRenderHost` の公開シグネチャは不変のまま切替可能）。

### 3.2 `packages/core/src/platform`（新設）

[[../basic_design/01_architecture.md#3]]AD-3のPlatformAdapter群のうち、本パッケージでは`FileSystemAdapter`の最小契約のみを確定する。他3種（AudioSession/Window/UpdateCheck）のインターフェース定義は該当パッケージ（再生エンジン統合／画面群・ナビゲーション／将来Phase）で追加する。

| インターフェース | 責務 | 主要メソッド | 例外・エラー時の挙動 |
|---|---|---|---|
| `FileSystemAdapter`（最小版） | 設定されたストレージルート配下でのバイナリ/テキストファイルの読み書きとディレクトリ一覧取得のみを提供する。Song単位のアトミック書き込み（一時ファイル→リネーム）・自動保存デバウンス・ゴミ箱操作は次パッケージで本インターフェースを拡張する | `readFile(relativePath: string): Promise<Uint8Array>`／`writeFile(relativePath: string, data: Uint8Array): Promise<void>`／`listDirectory(relativePath: string): Promise<DirEntry[]>`／`ensureDirectory(relativePath: string): Promise<void>`／`getRootPath(): string` | Adapter実装層で、Node固有のエラーは境界の外へ出さず、本パッケージで定義する3つの軽量エラークラスに正規化する（[[00_reference.md#9]]9.18節）：**存在しない**パスの`readFile`／`listDirectory`は`FileNotFoundError`。それ以外の**読み取り**失敗（`EACCES`／`EISDIR`／`ENOTDIR`等）は`FileReadError`。**書き込み**失敗（`writeFile`／`ensureDirectory`、権限・親不在等）は`FileWriteError`。リトライ判断は呼び出し元（次パッケージのアトミック書き込みロジック）の責務で、本パッケージ自体はリトライしない。ルート外へ出る（`..`トラバーサル）パス指定は素の`Error`で拒否する |
| `DirEntry`（型） | ディレクトリ一覧の1要素 | フィールド：`name: string`、`isDirectory: boolean`、`sizeBytes: number`、`modifiedAt: string`（ISO8601） | - |

**保存先ルートの扱い**：本パッケージ時点ではローカルフォルダ固定（例：OSのユーザーデータフォルダ配下）とし、iCloud Drive/Google Driveの選択・切替UIと設定永続化は「データモデル・永続化」パッケージで実装する（[[../basic_design/06_file_io_persistence.md]]）。`getRootPath()`が返す値を設定から差し替え可能にする拡張点だけを本パッケージで確保する。

### 3.3 `apps/desktop/src/main`（Electronメインプロセス）

| モジュール | 責務 | 主要関数/メソッド |
|---|---|---|
| `main.ts`（エントリポイント） | Electronアプリのライフサイクル管理、`BrowserWindow`生成、単一インスタンスロックの取得 | `app.whenReady().then(createMainWindow)`／`app.requestSingleInstanceLock()`（複数曲・複数ウィンドウの本格対応は画面群パッケージ。本パッケージでは「同一プロセスの二重起動を防止する」until範囲に限定） |
| `createMainWindow(): BrowserWindow` | `contextIsolation: true`／`nodeIntegration: false`／`sandbox: true`でメインウィンドウを生成し、preloadスクリプトを指定する。新規ウィンドウ生成（`setWindowOpenHandler`）と、現在ロード中URL以外へのナビゲーション（`will-navigate`／`will-redirect`／`will-frame-navigate`の全フレーム）を拒否する（同一URLへのリロードのみ許可）。3値はElectron既定値に依存せず明示指定する（`.claude/rules/electron.rule.md`「セキュリティ既定値（変更禁止）」、[[../basic_design/01_architecture.md#3]]AD-3） | 引数なし、`BrowserWindow`を返す |
| `ElectronFileSystemAdapter`（`FileSystemAdapter`実装） | Node.js `fs/promises`を用いて3.2節のインターフェースを実装する | 各メソッドは`fs.readFile`/`fs.writeFile`/`fs.readdir`/`fs.mkdir`をラップし、Node固有のエラー（`ENOENT`等）を3.2節のエラークラスに変換する |
| IPCハンドラ登録 | `ipcMain.handle('fs:readFile', ...)`等、4節のIPC契約に対応するハンドラを`ElectronFileSystemAdapter`へ委譲する | チャンネル名は4.1節の契約表に従う |

### 3.4 `apps/desktop/src/preload`

| モジュール | 責務 |
|---|---|
| `preload.ts` | `contextBridge.exposeInMainWorld('riffLineApi', {...})`で、4.1節のIPC契約に対応する型安全なラッパー関数のみをレンダラーに公開する。Node.js APIやElectronモジュールそのものは一切公開しない |

### 3.5 `apps/desktop/src/renderer`

本パッケージでは画面群パッケージの前段として、`packages/core`をマウントするだけの最小シェルを用意する（曲一覧・編集画面等の実UIは画面群パッケージで実装）。具体的には、単一のコンテナ要素に対して3.1節の`ScoreRenderHost`を初期化し、alphaTab同梱のサンプルデータ（またはalphaTexの簡単な文字列）を1つ描画できることを確認できる状態までを完了条件とする（8節DoD参照）。

## 4. IPC契約（`shared-types`で型定義）

### 4.1 チャンネルと対応関係

| チャンネル名 | 方向 | 対応するAdapterメソッド | ペイロード概要 |
|---|---|---|---|
| `fs:readFile` | renderer→main（invoke） | `FileSystemAdapter.readFile` | `{ relativePath: string }` → `Uint8Array` |
| `fs:writeFile` | renderer→main（invoke） | `FileSystemAdapter.writeFile` | `{ relativePath: string, data: Uint8Array }` → `void` |
| `fs:listDirectory` | renderer→main（invoke） | `FileSystemAdapter.listDirectory` | `{ relativePath: string }` → `DirEntry[]` |
| `fs:ensureDirectory` | renderer→main（invoke） | `FileSystemAdapter.ensureDirectory` | `{ relativePath: string }` → `void` |
| `fs:getRootPath` | renderer→main（invoke） | `FileSystemAdapter.getRootPath` | なし → `string` |

すべて`ipcRenderer.invoke`/`ipcMain.handle`（Promiseベース）で統一し、`send`/`on`の一方向イベント形式は本パッケージでは使用しない（エラー基盤パッケージで導入予定のクラッシュ通知等、双方向イベントが必要になった時点で追加する）。

**2026-09-07追記（パッケージ2による非破壊拡張、B31）**：上記5チャンネルは**変更しない**。パッケージ2「データモデル・永続化」は`FileSystemAdapterFactory`（複数ルート）のため、ルート指定付きの`fs:*At`（8本）と`appconfig:readPointer`/`writePointer`/`getActiveRoot`を追加する。詳細は[[data-model-persistence.md#3.3.1]]、[[00_reference.md#9]]9.19節。

### 4.2 型定義の置き場所

`packages/shared-types/src/index.ts`に、上記チャンネルのリクエスト/レスポンス型と`DirEntry`型を定義し、`apps/desktop`（main/preload/renderer）・`packages/core`の三者から共有する。`packages/core`は`shared-types`にのみ依存してよく、`electron`パッケージ自体には依存しない（レイヤー依存規則の遵守）。

## 5. 起動シーケンス

```mermaid
sequenceDiagram
    participant OS
    participant Main as メインプロセス(main.ts)
    participant Preload as preloadスクリプト
    participant Renderer as レンダラー(packages/core)
    participant AT as alphaTab(ScoreRenderHost)

    OS->>Main: アプリ起動
    Main->>Main: requestSingleInstanceLock()
    Main->>Main: createMainWindow()
    Main->>Preload: BrowserWindow生成時にpreload読み込み
    Main->>Renderer: index.html読み込み
    Renderer->>Renderer: packages/coreブートストラップ
    Renderer->>AT: ScoreRenderHost.initialize(container, {engine:'svg', ...})
    Renderer->>Preload: window.riffLineApi.fs.getRootPath()
    Preload->>Main: ipcRenderer.invoke('fs:getRootPath')
    Main-->>Preload: ルートパス文字列
    Preload-->>Renderer: ルートパス文字列
    Renderer->>AT: loadScore(サンプルScore) → render()
    AT-->>Renderer: renderFinishedイベント
```

## 6. ビルド・Lint・型チェック設定

**2026-09-07 実装時確定**：本節の方針を、実装で採用したツール構成に合わせて確定した（[[../basic_design/15_development_process.md#9]]のドキュメント同期ルールに従う）。

| 項目 | 方針（実装時に確定） |
|---|---|
| TypeScript | `tsconfig.base.json`で`strict: true`を全パッケージ共通設定とする（[[../basic_design/01_architecture.md#3]]AD-4）。`packages/core`は`any`使用をESLintで禁止（`@typescript-eslint/no-explicit-any: error`）。**バージョンは`typescript@5.9.3`に固定**（実装時点のレジストリ最新はTS7系だが、`@typescript-eslint`・`electron-vite`との互換が枯れている5系最新を選択。TS7への追随は別途） |
| ESLintレイヤー依存規則 | **ESLint 10はeslintrc形式（`.eslintrc.cjs`）を廃止したため、フラットコンフィグ`eslint.config.js`を採用**。レイヤー依存の禁止は`eslint-plugin-import`の`import/no-restricted-paths`ではなく**ビルトインの`no-restricted-imports`（パターン指定）**で実現する（フラットコンフィグ対応が枯れており依存も減る）。`packages/core/**`から`electron`・`expo-*`・`apps/**`・直接のファイルI/O（`fs`/`node:fs`）へのimportをerrorにする。本パッケージで設定ファイルを作成し、以降のパッケージはこれに従うだけでよい |
| ビルドツール | Vite（renderer）＋`tsc -b`（`packages/*`のライブラリビルド）。Electronのmain/preload/rendererは**`electron-vite`（v5）**で一括ビルドし、開発時のホットリロードを確保する（詳細設計では`vite-plugin-electron`または`tsup`としていたが、単一設定で3プロセスを扱え保守されている`electron-vite`を選択）。**main/preloadはCJS形式で出力する**（Electronランタイムの`require('electron')`が確実に解決できるようにするため。rendererはESM） |
| Node.jsバージョン固定 | `.nvmrc`に`24`を明記（実装時点のActive LTS） |
| alphaTabアセット配置 | alphaTabが要求するBravura等のフォントアセット・SoundFont（本パッケージでは読み込まないが再生パッケージ向けに配置のみ）を、`apps/desktop/scripts/copy-alphatab-assets.mjs`が`apps/desktop/src/renderer/public/alphatab/`へコピーする（`predev`/`prebuild`で実行）。Viteが`public/`を`/`で配信し、ビルド時に`dist-electron/renderer/`へ同梱する。rendererは相対パス（`alphatab/font/` 等）で参照し、`RenderHostOptions.fontAssetsBasePath`に渡す（要件5.1「外部CDN禁止」）。`@coderline/alphatab/vite`公式プラグインは1.8.4で内部パス不整合により利用不可だった |
| alphaTab描画実行方式 | **メインスレッド同期描画に固定**（`ScoreRenderHost`内部で`core.useWorkers: false`／`core.enableLazyLoading: false`を設定）。Web Worker 自動生成が厳格CSP（`script-src 'self'`、`blob:`ワーカー不可）と衝突し描画が完了しないため（3.1節「描画実行方式」、[[../basic_design/13_design_decision_points.md#3]]B30）。ヘッドレス（CDP）検証で `renderFinished` 発火・SVG 生成を確認済み |
| CI | `.github/workflows/ci.yml`：PR/pushごとに`pnpm install --frozen-lockfile` → `lint` → `typecheck` → `test` → `build`、およびPRのcommitlint。ブランチ保護でマージのゲートにする（[[../basic_design/15_development_process.md#2]]） |

## 7. このパッケージで解決する設計分岐点

- [[../basic_design/13_design_decision_points.md#2]]A1・A2は基本設計フェーズ末（2026-09-01）の文書調査で解消済み（自前再描画方式・SVGエンジン採用）。本パッケージはその結果を`ScoreRenderHost`として具体化した。
- **新規の実装レベル分岐点（2026-09-07 解決済み）**：alphaTabのアセット（フォント・SoundFont）をElectronでどう配置するかは基本設計で未言及だったため、本パッケージで「専用コピースクリプトで`src/renderer/public/`へ配置し、Viteの`public/`配信でビルド成果物（`dist-electron/renderer/`）に同梱、rendererから相対パスで参照する」方式に確定した（6節）。将来のExpo版（Phase 3）でも同様にアプリバンドルへの同梱で対応できる見込みで、疎結合方針と矛盾しない。
- **実装時の追加確定（非破壊）**：`ScoreRenderHost`に、イベント購読の`on(event, listener)`/`off(event, listener)`、状態確認の`isInitialized`、alphaTexパースを1箇所に集約する静的メソッド`parseAlphaTex(tex): unknown`（レンダラーシェルと将来のインポート機能が生APIを触らずに済むようにする「Host」パターンの一部）を追加した。既存の`initialize`/`loadScore`/`render`/`dispose`のシグネチャは詳細設計どおり。詳細は[[00_reference.md#3.1]]に反映。
- **新規の実装レベル分岐点（2026-09-07 解決済み、[[../basic_design/13_design_decision_points.md#3]]B30）**：alphaTab の描画を Web Worker で行うか同期で行うかは基本設計で未言及だった。ESM バンドル経由のワーカー自動生成が厳格 CSP（`script-src 'self'`、`blob:` ワーカー不可）と衝突して `renderFinished` が返らず描画が停止する事象を実装時に確認し、`ScoreRenderHost` 内部で `core.useWorkers: false`（メインスレッド同期描画）に確定した（3.1節「描画実行方式」・6節）。`ScoreRenderHost` の公開シグネチャは不変で、専用ワーカースクリプト同梱による非同期化は将来 A9 の対策として切替のみで導入できる。

## 8. 完了基準（Definition of Done、[[../basic_design/15_development_process.md#7]]対応）

| # | 基準 | 本パッケージでの具体的な確認内容 |
|---|---|---|
| 1 | 基本設計の記載内容を満たしている | [[../basic_design/01_architecture.md]]のレイヤー構成・AD-1〜AD-5、[[../basic_design/09_nonfunctional.md#1]]の起動シーケンス方針との整合を確認 |
| 2 | 本詳細設計書が実装と整合している | 3〜6節のクラス構成・IPC契約が実装と一致していること |
| 3 | 単体テスト・結合テスト | `ElectronFileSystemAdapter`のエラー変換ロジック（C0/C1）、`ScoreRenderHost`のオプション検証ロジック（C0/C1）を単体テスト。IPC経由の`fs:*`往復を結合テストで確認 |
| 4 | セルフレビュー | **2026-09-03修正**：[[../basic_design/15_development_process.md#6]]は2026-09-02にセルフレビュー対象を「L/XLサイズのみ」から「サイズ問わず全件」へ改訂済みであり、本行の「Mサイズのため対象外」という記載は旧方針のまま取り残されていた（[[../review/design_review_2026-09-03.md]]A-2）。新方針のもとで対象パッケージとして扱い、レイヤー依存規則の逸脱がないかはESLint実行で機械的に確認する |
| 5 | 手動シナリオ確認 | アプリを起動し、レンダラー内にalphaTabのサンプル譜面（またはalphaTexの簡単な文字列）がSVGで描画されることを目視確認する |
| 6 | `main`へマージ済みで起動可能 | Electronアプリが`pnpm dev`で起動し、上記5を満たす状態 |

**2026-09-07 実装ステータス**：基準1〜4・6は充足（`pnpm typecheck` / `pnpm lint` / `pnpm test`〈49 pass / 1 skip〉/ `pnpm build` が緑。セルフレビュー〈基準4〉の指摘はブロッキング・非ブロッキングとも是正済み、[[00_reference.md#9]]9.18節。`electron-vite` によるビルド済みアプリの起動を確認〈main プロセス起動・ウィンドウ生成・renderer HTML ロード・IPC ハンドラ登録までエラーなし〉）。**基準5**：ユーザーの目視確認で、初期実装ではサンプル譜面が描画されず「rendering」で停止する事象が判明。原因は alphaTab の Web Worker 自動生成が厳格 CSP と衝突していたことで、`core.useWorkers: false`（同期描画）へ確定して解消した（3.1節・6節・B30）。修正後、Chrome DevTools Protocol 経由のヘッドレス検証で `renderFinished` 発火・`<svg>` 生成・サンプル alphaTex の描画内容を確認済み。ウィンドウ内での最終的な目視確認はユーザー環境で `run-app.cmd` / `pnpm dev` により実施する（実装環境は `ELECTRON_RUN_AS_NODE=1` によりウィンドウを可視化できないため）。この編集ウィンドウ内での目視は[[00_reference.md#8.1]] G23 としてパッケージ8着手時に実施する繰り越し項目に登録済み（[[screens-navigation.md#9]] P1）。

## 9. 次パッケージへの申し送り

- 「データモデル・永続化」パッケージは、本パッケージの`FileSystemAdapter`最小契約（3.2節）を拡張し、アトミック書き込み（一時ファイル→リネーム）・自動保存デバウンス・保存先バックエンド切替（ローカル/iCloud Drive/Google Drive）・ゴミ箱操作を追加する。既存メソッドのシグネチャ変更は避け、追加メソッドで対応することを原則とする。
- 「エラー・警告基盤」パッケージ完了後、3.1節`ScoreRenderHost`の暫定エラーログ出力を`NotificationCenter`経由に置き換える（本書3.1節に記載の通り）。
- alphaTabの編集時の「安全な変更操作の切り分け」（[[../basic_design/13_design_decision_points.md#2]]A1の残課題）は、本パッケージでは扱わず「タブ譜編集コア」パッケージの詳細設計に持ち越す。
