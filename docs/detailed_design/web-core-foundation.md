# 詳細設計書：Webコア基盤構築

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 1「Webコア基盤構築」
- **ブランチ名**：`feature/web-core-foundation`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 1. 目的・スコープ

[[../basic_design/01_architecture.md#1]] を受ける。

- 本書は、Webコア（プラットフォームに依存しない部分）とプラットフォームラッパー（PC 版の Electron、将来の iPhone 版の Expo）の境界を、パッケージとフォルダの単位で決める。Webコアは `packages/core` と `packages/ui-desktop`、ラッパーは `apps/desktop` と `apps/mobile` とし、`packages/shared-types` は両側が共有する型だけを置く境界とする（層ごとの置き場所は 2.1 節）。 <!-- req 01:71ceacea.e7a7 -->
- 防ぐ対象は、PC 版を作っている間に Electron に依存するコードが Webコアに入り込むこと（要件書リスク#8）とする。具体的には、`packages/core` と `packages/ui-desktop` の中での `electron`・`expo-*`・Node.js の組み込みモジュール（`node:` で始まるもの）・`apps/**` の import を指す。 <!-- req 01:71ceacea.e98f -->
- 防ぎ方は、レビューで見つけるという運用の決まりに頼らず、構造で行う。(1) `packages/core` と `packages/ui-desktop` の `package.json` の依存に `electron` と `expo-*` を入れない。(2) ESLint の `no-restricted-imports` で上の import をエラーにし、CI の `pnpm lint` が通らなければマージできないようにする（2.2 節）。 <!-- req 01:71ceacea.6d1d -->

**詳細設計書で決めること**：各詳細設計書は、受け持つクラスごとに次の 5 つを書く。書き方は本書で決めた（(b)）。TypeScript の宣言で書くのは、実装とそのまま突き合わせられるため。

| 決めること | 書き方 |
|---|---|
| クラス構成 | 置き場所（パッケージとフォルダ）、クラスとインターフェースの一覧、どれがどれを持つか。[[00_reference.md#3]] の登録簿にも 1 行ずつ載せる <!-- req 01:ddb7c423.c57e --> |
| メソッドのシグネチャ | `export class …`／`export interface …` の TypeScript の宣言をコードブロックで書く <!-- req 01:ddb7c423.e60a --> |
| 引数 | 宣言の中で名前と型を書く。省略できる引数は、省いたときの値をコメントで書く <!-- req 01:ddb7c423.dcfa --> |
| 戻り値の型 | 宣言の中で書く。非同期のものは `Promise<…>` で書く <!-- req 01:ddb7c423.13ac --> |
| 例外仕様 | メソッドごとに、投げるエラーのクラスか、出す通知のコード（[[00_reference.md#5]]）を表で書く。まだ決められない範囲は「未確定」と書いて [[00_reference.md#8.1]] に G 番号で載せ、空けたままにしない <!-- req 01:ddb7c423.a8e6 --> |

## 2. レイヤー構成と依存の規則

[[../basic_design/01_architecture.md#2]] を受ける。層の定義と図は基本設計が正で、本節はパッケージとフォルダへの当てはめと、依存を見張る仕組みを書く。

### 2.1 層とパッケージ・フォルダの対応

| 層 | 置き場所 | 置くもの |
|---|---|---|
| L1 プレゼンテーション | `packages/ui-desktop` | PC 版の画面の部品（React のコンポーネント、03 章）。Webコアに属する <!-- req 01:bfeb405b.1dc4 --> |
| L1 プレゼンテーション | `packages/core/src/ui` | 見た目に関係しない画面の処理（ViewModel・Binder・Store・Router・Overlay） |
| L1 プレゼンテーション | `packages/core/src/rendering` | alphaTab の描画領域の窓口。(b) 基本設計 AD-5 の木には無いフォルダだが、alphaTab の描画の API に触る所を 1 か所に閉じるために置く |
| L2 アプリケーションサービス | `packages/core/src/editing`・`packages/core/src/playback`・`packages/core/src/export` | 編集サービス・コマンド層・バリデーション（`editing`）、再生制御（`playback`）、書き出し（`export`） |
| L3 ドメイン | `packages/core/src/domain` | Score のラッパーとサイドカーメタデータ（[[data-model-persistence.md#2]]） |
| L4 プラットフォーム抽象 | `packages/core/src/platform`・`packages/shared-types` | PlatformAdapter のインターフェース（実装は置かない）、IPC の型 |
| L5 プラットフォーム実装 | `apps/desktop`（Phase 1）・`apps/mobile`（Phase 3） | main・preload・レンダラーの起動と DI の組み立て。**画面の部品は置かない** <!-- req 01:bfeb405b.ffb5 --> |
| 層の外 | `packages/core/src/errors` | エラーと通知（08 章）。(b) どの層から使ってもよく、`errors` からはほかの層を import しない。L3 の読み込みの失敗も L1 の表示も同じ通知の仕組みを使うので、どれか 1 つの層に入れると逆向きの依存が出るため |

### 2.2 依存の向き

- 上の層は下の層を import してよい（L1 → L2 → L3 → L4）。 <!-- req 01:cfe39104.1eb4 -->
- 下の層は上の層を import しない（下の表に無い向きはすべて禁止）。 <!-- req 01:cfe39104.e306 -->

層ごとに、import してよい先を次の表に限る（表に無い向きはすべて禁止）。 <!-- req 01:cfe39104.8f78 -->

| import する側 | import してよい先 |
|---|---|
| L1（`packages/ui-desktop`・`packages/core/src/ui`・`packages/core/src/rendering`） | L2・L3・L4・`errors`・React（`packages/ui-desktop` だけ） |
| L2 | L3・L4・`errors` |
| L3 | L4・`errors`・`packages/shared-types` |
| L4 | `packages/shared-types`。L5 は import しない（L5 が L4 のインターフェースを実装して起動時に注入する、AD-3 の依存性逆転。基本設計 2 節の図の L4 → L5 の矢印は、import ではなく実装の向き） |
| `errors` | `packages/shared-types` |
| L5（`apps/desktop`） | L1〜L4・`errors`・`electron`（DI の組み立てのため）。L5 は層の番号では一番下だが、パッケージの依存の向きは基本設計 AD-5 の `apps/desktop` → `packages/ui-desktop` → `packages/core` → `packages/shared-types` に従い、組み立てのために L1〜L4 を import する |

**ESLint で見張る**：設定はリポジトリ直下の `eslint.config.js`（フラットコンフィグ）1 つにまとめる。ESLint の組み込みの `no-restricted-imports`（パターン指定）で、上の表に無い向きの import と、`packages/core/**`・`packages/ui-desktop/**` から `electron`・`expo-*`・Node.js の組み込みモジュール・`apps/**` への import をエラーにする。`packages/core` から `react` の import もエラーにする（[[../basic_design/13_design_decision_points.md#3]] B36 の理由 (1)）。(b) 組み込みのルールを使うのは、作り直す前の実装で動いていた形で、`eslint-plugin-import` を足さずに済むため。`packages/ui-desktop` の分は、そのパッケージを作るときに足す。 <!-- req 01:09054c00.d4eb -->

**レビューに任せない**：CI（`.github/workflows/ci.yml`）で PR と push ごとに `pnpm lint` を走らせ、エラーがあればブランチ保護でマージできないようにする。混入はレビューで見つけるのではなく、ここで止める。 <!-- req 01:09054c00.ade1 -->

### 2.3 要件 6 章の「ロジック層」との対応

基本設計の表（要件 6 章の 3 要素と本書での所在）を、フォルダとクラスに当てはめる。

| 要件 6 章の 3 要素 | 置き場所とクラス |
|---|---|
| コマンド層 | L2 の `packages/core/src/editing/commands`：`Command` インターフェース・`CommandHistory`・具象コマンド（[[editing-core.md#2]]） <!-- req 01:1e34f635.f040 --> |
| Undo/Redo 履歴管理 | 独立したモジュールにせず、コマンド層の内側に置く。`CommandHistory` の中の undo と redo の 2 つのスタックとして持つ（コマンド層の内部状態）。要件の 3 要素の 1 つはこの 2 つのスタックに当たる <!-- req 01:3b927158.ff13 --> <!-- req 01:3b927158.d1e5 --> <!-- req 01:3b927158.32df --> |
| バリデーション | L2 の `packages/core/src/editing/validation` の `ValidationService`（基本設計の `バリデーションサービス`） <!-- req 01:2c06de67.cb52 --> |

L2 のほかのモジュール（`EditingService`・`PlaybackService`・書き出しのサービス）は「ロジック層」と呼ばない。L2 にモジュールを足すときは、上の表の 3 つのどれかに当たるかを先に決め、当たらないものは上の表に入れない。 <!-- req 01:ea16f591.35d3 -->

## 3. PlatformAdapter（プラットフォームの差を吸収する口）

[[../basic_design/01_architecture.md#3]] AD-3 を受ける。アダプタの責務の考え方は基本設計が正で、本節はインターフェースの置き場所、注入のしかた、PC 版での実装の分け方、メソッドのシグネチャを書く受け先を決める。

### 3.1 インターフェースの置き場所と注入

Webコアがプラットフォームに頼る仕事は、ファイル I/O・オーディオセッション制御・ウィンドウ管理・自動更新チェックの 4 系統とし、系統ごとにインターフェースを 1 つずつ置く：`FileSystemAdapter`・`AudioSessionAdapter`・`WindowAdapter`・`UpdateCheckAdapter`。4 つとも `packages/core/src/platform` に置き、実装はそこに置かない（5 節）。 <!-- req 01:384bef0d.068f --> <!-- req 01:384bef0d.c5c3 --> <!-- req 01:384bef0d.9198 --> <!-- req 01:384bef0d.d97e --> <!-- req 01:23a18f23.838c -->

Webコア（`packages/core`・`packages/ui-desktop`）のコードは、4 系統について具象クラスを import せず、`packages/core/src/platform` のインターフェースだけを型として使う。具象クラスは `apps/**` にあるので、import すると 2.2 節の ESLint の規則でエラーになる。 <!-- req 01:384bef0d.34b6 -->

具象の実装は、PC 版は Electron アダプタとして `apps/desktop` に、iPhone 版（Phase 3）は Expo アダプタとして `apps/mobile` に置く。L5 が起動時に具象を作り、次の `PlatformAdapters` 1 つにまとめて、Webコアの組み立ての関数に引数で渡す（依存性逆転）。Webコアの中でアダプタを使うクラスは、コンストラクタの引数で受け取り、グローバルな置き場（シングルトン・モジュールの変数）から取らない。(b) 1 つの型にまとめて渡すのは、4 つのどれかを渡し忘れたときに型の検査で見つけるため。コンストラクタで受け取るのは、テストで偽物に差し替えるため。 <!-- req 01:384bef0d.7e73 -->

```ts
// packages/core/src/platform/PlatformAdapters.ts
export interface PlatformAdapters {
  fileSystem: FileSystemAdapter;
  audioSession: AudioSessionAdapter;
  window: WindowAdapter;
  updateCheck: UpdateCheckAdapter;
}
```

PC 版では、Electron のプロセスの分け方に合わせて、1 つのアダプタを 3 か所で実装する。main は Node.js と Electron の API で実際の仕事をし、`ipcMain.handle` で要求を受ける。preload は `contextBridge.exposeInMainWorld` で、main への呼び口（`ipcRenderer.invoke` を包んだ関数）だけをレンダラーに出す。レンダラーの側では、インターフェースを実装するクラスが preload の呼び口を呼ぶ。IPC の要求と応答の型は `packages/shared-types` に置く。main だけで済まないのは、レンダラーから Node.js の API に直接触れさせないため（6.2 節のセキュリティの既定値）。 <!-- req 01:d2e57aa7.f36f --> <!-- req 01:d2e57aa7.3854 -->

### 3.2 アダプタごとの責務

| アダプタ | 責務 | PC 版の実装 |
|---|---|---|
| `FileSystemAdapter` | 曲データの読み込み、アトミックな書き込み（一時ファイルに書いてからリネームする、[[../basic_design/06_file_io_persistence.md]] の方式）、一覧の取得、ゴミ箱への移動、現在の保存先ルートの取得、保存先の移行の 6 つ | main が Node.js の `fs/promises` で行い、レンダラーの側のクラスが IPC で呼ぶ <!-- req 01:d09e28be.d7ef --> <!-- req 01:d09e28be.1a2b --> <!-- req 01:d09e28be.9d24 --> <!-- req 01:d09e28be.e4c4 --> <!-- req 01:d09e28be.305f --> <!-- req 01:d09e28be.0158 --> |
| `AudioSessionAdapter` | バックグラウンドで鳴っているほかの音楽アプリと、音声を共存させる設定 | 何もしない実装（no-op）をレンダラーの側に置く。IPC は使わない。実際の設定をするのは iPhone 版（Phase 3）の実装だけ <!-- req 01:c9422351.89ca --> <!-- req 01:c9422351.013c --> <!-- req 01:c9422351.9376 --> |
| `WindowAdapter` | 曲のウィンドウを開くこと。同じ曲のウィンドウがもう開いていれば、新しく開かずにそのウィンドウを前に出す（同じ曲の二重起動を防ぐ、要件 5.6） | main がウィンドウを管理し、レンダラーの側のクラスが IPC で呼ぶ <!-- req 01:21f81568.05f0 --> <!-- req 01:21f81568.db72 --> |
| `UpdateCheckAdapter` | 更新の確認 | 今はダミーの実装で、通信せずに常に「更新なし」を返す。(b) 要件 5.1 の完全オフラインに合わせ、確認の中身が決まるまで外へ通信しないため <!-- req 01:23a18f23.a76a --> <!-- req 01:23a18f23.fffe --> |

保存先は、`FileSystemAdapter` から見ると 1 つの「フォルダのパス」で、ローカル・iCloud Drive・Google Drive・カスタムフォルダのどれを選んだかで扱いを変えない。保存先の種類と選び方は [[../basic_design/06_file_io_persistence.md#2]] が正で、ユーザーが選んだフォルダのパスを設定から受け取る。`FileSystemAdapter` とその実装は、どのクラウドサービスの API も呼ばず、どのサービスにも依存しない（同期は OS の同期クライアントが行う）。 <!-- req 01:d09e28be.2fc6 --> <!-- req 01:d09e28be.e80e -->

### 3.3 メソッドのシグネチャを書く受け先

4 つのアダプタのメソッドのシグネチャ（引数、戻り値の型、非同期か同期か、エラーのときの扱い）は、次の受け先で、1 節の「詳細設計書で決めること」の表の書き方で書く。本節には書かない。 <!-- req 01:caf80338.5bff --> <!-- req 01:caf80338.943b --> <!-- req 01:caf80338.c8f3 -->

| アダプタ | シグネチャの受け先 | 書く回 |
|---|---|---|
| `FileSystemAdapter` | data-model-persistence.md | 基本設計 06 章の回 |
| `AudioSessionAdapter` | playback-integration.md | 基本設計 05 章の回 |
| `WindowAdapter` | screens-navigation.md | 基本設計 03 章の回 |
| `UpdateCheckAdapter` | 本書 | 基本設計 10 章の回 |

非同期か同期かは、受け先で書くときに次の決まりに従う：PC 版で IPC を通るメソッド（`FileSystemAdapter`・`WindowAdapter`）は `Promise<…>` を返す非同期にする（Electron の `ipcRenderer.invoke` が `Promise` を返すため）。IPC を通らないメソッド（PC 版の `AudioSessionAdapter`）も、iPhone 版で非同期になりうるものは `Promise<…>` を返す形にそろえ、プラットフォームで同期と非同期を変えない。 <!-- req 01:caf80338.7615 --> <!-- req 01:caf80338.90ef -->

## 4. 言語・UI・状態管理・ビルド・スタイリング

[[../basic_design/01_architecture.md#3]] AD-4 を受ける。選んだ理由は基本設計が正で、本節はどのパッケージにどう入れるかを書く。

### 4.1 選んだもの

| 項目 | 決まり |
|---|---|
| 言語 | TypeScript。`packages/*` と `apps/*` のソースは `.ts`／`.tsx` で書く <!-- req 01:da104e4f.da60 --> |
| UI | React。React を import してよいのは `packages/ui-desktop` だけ（2.2 節の表）。`apps/desktop` のレンダラーは React を import せず、`packages/ui-desktop` が出す「画面を DOM に載せる関数」を呼んで、組み立てたアダプタとサービスを渡す。(b) 2.2 節の表で L5 の import してよい先に React が無いため。関数の形は基本設計 03 章の回に screens-navigation.md に書く <!-- req 01:15b5ef7e.c567 --> |
| 状態管理 | Zustand。ストアは `packages/core/src/ui` に置き、`zustand/vanilla` の `createStore` で作る（React を import しない）。画面の部品（`packages/ui-desktop`）は `zustand` の `useStore` でストアを読む。(b) `packages/core` が React を import しない決まり（2.2 節）を守ったまま、ストアを Webコアの見た目に関係しない側に置けるため <!-- req 01:47958bb6.ef05 --> |
| コマンド層 | 状態管理のライブラリを使わず、`packages/core/src/editing/commands` に自前で書く（[[editing-core.md#2]]） <!-- req 01:47958bb6.023d --> |
| Undo/Redo の対象 | Score の変更だけ。`CommandHistory` に積むのは Score を変えるコマンドだけにする <!-- req 01:47958bb6.3b76 --> |
| 画面の状態 | Score の外にある画面の状態（選択範囲・表示モードを含む）は、状態管理のストアに置き、`CommandHistory` に積まない。ストアの値の変更は Undo/Redo で戻らない <!-- req 01:47958bb6.4f3b --> |
| ビルド | Vite を土台にした electron-vite で、main・preload・レンダラーの 3 つを組む。設定は `apps/desktop/electron.vite.config.ts` の 1 つ。(b) 3 つのプロセスを 1 つの設定で組めるため <!-- req 01:612cc1fc.58f5 --> |
| alphaTab | `@coderline/alphatab` を npm から入れ、依存に書くのは `packages/core`（描画と再生）。版は `package.json` で 1 つに固定する（今は `1.8.4`） <!-- req 01:48ac7e6b.6f77 --> |
| SoundFont とフォント | alphaTab の npm パッケージの `dist/soundfont` と `dist/font` を、ビルドの前にコピーするスクリプト（`apps/desktop/scripts`）で `apps/desktop/src/renderer/public/alphatab/` に置き、アプリと一緒に配る。読み込みはアプリの中の相対パスで行い、`http:`・`https:` の URL から読まない（要件 5.1、外部の CDN を使わない）。どの SoundFont を配るかは playback-integration.md（基本設計 05 章の回） <!-- req 01:48ac7e6b.76f9 --> |
| 描画エンジン | SVG。alphaTab の設定の `core.engine`（`CoreSettings.engine`）に `'svg'` を渡す。渡すのは `packages/core/src/rendering` の 1 か所だけ <!-- req 01:3230a605.a839 --> |

### 4.2 スタイリングと見た目のトークン

画面の見た目は Tailwind CSS v4 系で書き、[[../basic_design/14_visual_design_system.md]] のトークンを CSS の `@theme` に定義する。**色・文字・余白・角丸・影のトークンの値を書くのは、本節と本節で決める CSS ファイル 1 つだけ**にする（ほかの詳細設計書・ほかのファイルは値を持たず、名前で参照する）。

| 項目 | 決まり |
|---|---|
| 入れるもの | `tailwindcss` と `@tailwindcss/vite`（Vite のプラグイン）の 2 つ。どちらも v4 系で、細かい版は入れるときに `package.json` で固定する（今は入っていない） <!-- req 01:4be59a2d.8748 --> <!-- req 01:4be59a2d.ca34 --> |
| Vite への入れ方 | `@tailwindcss/vite` を `apps/desktop/electron.vite.config.ts` の `renderer.plugins` に足す（公式の Vite での入れ方：`import tailwindcss from '@tailwindcss/vite'` と `plugins: [tailwindcss()]`） <!-- req 01:4be59a2d.638c --> |
| 定義を置くファイル | `packages/ui-desktop/theme.css` の 1 つ。先頭に `@import "tailwindcss";` と `@source "./src";`、続けて `@theme static { … }` にトークンを並べる（下の CSS）。(b) 画面の部品が `packages/ui-desktop` にあるので、トークンも同じパッケージに置く。`@source` を書くのは、Tailwind が既定ではビルドを走らせる作業ディレクトリ（`apps/desktop`）からクラス名を探し、`node_modules` の中を探さないため（公式文書 Detecting classes in source files：「Tailwind uses the current working directory as its starting point when scanning for class names by default.」「Use `@source` to explicitly register source paths relative to the stylesheet」） |
| 読み込み方 | レンダラーの入口（`apps/desktop/src/renderer` の `main.ts`）で `import '@riff-line/ui-desktop/theme.css';` を 1 回だけ行う。`packages/ui-desktop` の `package.json` の `exports` に `./theme.css` を載せる |
| トークンの範囲 | 14 章の 3 節（色）・4 節（文字）・5 節（余白）・6 節（角丸と影）の値をすべて `@theme` に書き、CSS 変数にする <!-- req 01:4be59a2d.2332 --> <!-- req 01:4be59a2d.3b48 --> <!-- req 01:4be59a2d.49c5 --> <!-- req 01:4be59a2d.e9ec --> <!-- req 01:4be59a2d.7e81 --> <!-- req 01:4be59a2d.028c --> |
| `static` を付ける理由 | Tailwind v4 は、既定では使われたテーマ変数だけを CSS 変数として出す（公式文書 Theme variables：「By default only used CSS variables will be generated in the final CSS output.」）。`packages/core` の描画の側は Tailwind のクラスを使わず `var(--color-danger)` の形で参照するので、使われていなくても全トークンを CSS 変数として出す `static` にする。これで `@theme` に書いたトークンがすべて CSS 変数になる <!-- req 01:4be59a2d.32ca --> |
| 既定のテーマを外す | `@theme static` の最初に `--*: initial;` を書き、Tailwind の既定のテーマ変数（例：`red-500`）をすべて外す。**画面が使えるのは 14 章のトークンから作られたクラスだけ**になる（公式文書：「Now none of the default utility classes that are driven by theme variables will be available」） <!-- req 01:4be59a2d.5ffb --> |
| 直値を書かない | 画面の部品（`packages/ui-desktop`）は、色・文字・余白・角丸・影を、トークンから作られた Tailwind のクラス（`bg-surface`・`text-danger`・`p-3`・`rounded-md` の形）だけで書く。色・長さの直値（例：`#c62a3f`）、角括弧で値を書く任意値のクラス（例：`[#c62a3f]`・`[13px]`）、`style` 属性のどれも書かない（`style` 属性に `var(--…)` を書くことも含む、[[../basic_design/08_error_logging.md#4]]）。`var(--…)` で参照してよいのは、クラスを付けられない `packages/core/src/rendering` の SVG の着色だけ。(b) 画面の部品ではなく、alphaTab が描いた SVG の要素に色を付ける所なので <!-- req 01:4be59a2d.4bfe --> <!-- req 01:4be59a2d.5ffb --> |
| ダークの値 | 14 章 3 節の表のダークの値（先行定義）と 6 節のダークの影は、v1 では `@theme` に入れない（14 章 3 節の「v1で使用するのはライト値のみ」）。入れるときは同じファイルに上書きの規則を足す |
| パート識別色 | `Part.color`（データとしてのパートの色、14 章 3.2 節）は `--color-*` のトークンに入れない。曲データの値なので、描画のときに渡す |

色は 14 章 3 節の表の全トークン（19 個）を、表の名前に `--color-` を付けて、ライトの値のまま並べる（[[../basic_design/08_error_logging.md#4]] の「`--color-` ＋表の名前」）。色のほか（14 章 4〜6 節）は、Tailwind の名前空間（公式文書の表：`--font-*`・`--text-*`・`--font-weight-*`・`--spacing-*`・`--radius-*`・`--shadow-*`）に合わせて、下の対応表の名前にする。

```css
@import "tailwindcss";
@source "./src";

@theme static {
  --*: initial;

  /* 色：14 章 3.1 節 ニュートラル */
  --color-bg: #f6f6f7;
  --color-surface: #ffffff;
  --color-surface-2: #f0f0f2;
  --color-surface-3: #e9e9ec;
  --color-border: #e2e2e6;
  --color-border-strong: #d3d3d9;
  --color-text-primary: #1a1a1e;
  --color-text-secondary: #68686f;
  --color-text-tertiary: #a0a0a8;
  /* 色：14 章 3.2 節 アクセント */
  --color-accent: #5850ec;
  --color-accent-hover: #473fd6;
  --color-accent-soft: #eeecfd;
  /* 色：14 章 3.3 節 ステータス */
  --color-success: #157f45;
  --color-success-soft: #e5f5ec;
  --color-warning: #b5690a;
  --color-warning-soft: #fdf1e2;
  --color-danger: #c62a3f;
  --color-danger-soft: #fbe9ec;
  --color-info-tag: #0b6e8f;

  /* 文字：14 章 4 節 */
  --font-ui: "Segoe UI", "Yu Gothic UI", "Meiryo UI", "Hiragino Kaku Gothic ProN", sans-serif;
  --font-mono: "Cascadia Mono", "Consolas", ui-monospace, monospace;
  --text-heading: 0.9375rem;
  --text-body: 0.84375rem;
  --text-label: 0.75rem;
  --text-caption: 0.6875rem;
  --font-weight-heading: 600;
  --font-weight-body: 400;
  --font-weight-label: 600;
  --font-weight-caption: 500;

  /* 余白：14 章 5 節（4px グリッド） */
  --spacing: 4px;

  /* 角丸：14 章 6 節 */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* 影：14 章 6 節（1 種類だけ、ライト） */
  --shadow-float: 0 4px 12px rgb(0 0 0 / 0.12);
}
```

**14 章の名前と `@theme` の名前の対応**（名前がそのまま名前空間に合わないもの）：

| 14 章 | 14 章の値 | `@theme` の名前と値 | 作られるクラスの例 |
|---|---|---|---|
| 4 節 フォントスタック「UI基本」 | `"Segoe UI", "Yu Gothic UI", "Meiryo UI", "Hiragino Kaku Gothic ProN", sans-serif` | `--font-ui`（同じ値） | `font-ui` |
| 4 節 フォントスタック「数値・技術情報用（等幅）」 | `"Cascadia Mono", "Consolas", ui-monospace, monospace` | `--font-mono`（同じ値） | `font-mono` |
| 4 節 ダイアログ見出し | 15px相当・600 | `--text-heading: 0.9375rem`（15px）／`--font-weight-heading: 600` | `text-heading`・`font-heading` |
| 4 節 本文・標準UI文字 | 13.5px相当・400 | `--text-body: 0.84375rem`（13.5px）／`--font-weight-body: 400` | `text-body`・`font-body` |
| 4 節 ラベル・見出し小 | 12px相当・600 | `--text-label: 0.75rem`（12px）／`--font-weight-label: 600` | `text-label`・`font-label` |
| 4 節 補助文字・タイムスタンプ | 11px相当・500 | `--text-caption: 0.6875rem`（11px）／`--font-weight-caption: 500` | `text-caption`・`font-caption` |
| 5 節 space-1〜space-5 | 4／8／12／16／20px | `--spacing: 4px` の 1 つだけ。Tailwind の数値の余白クラスは `--spacing` の倍数になる（公式文書 padding：「`padding: calc(var(--spacing) * <number>);`」）。space-1＝`*-1`（4px）、space-2＝`*-2`（8px）、space-3＝`*-3`（12px）、space-4＝`*-4`（16px）、space-5＝`*-5`（20px） | `p-3`・`gap-4` |
| 6 節 radius-sm／radius-md／radius-lg | 4／6／8px | `--radius-sm`／`--radius-md`／`--radius-lg`（名前も値もそのまま） | `rounded-sm`・`rounded-md`・`rounded-lg` |
| 6 節 影（浮いている要素だけに使う、1 種類） | ライト `0 4px 12px rgb(0 0 0 / 0.12)` | `--shadow-float`（同じ値）。(b) 14 章に名前が無いので、用途（浮いている要素）から名前を付けた | `shadow-float` |

- 文字の大きさは、14 章 4 節の「相対単位で定義する」に従って `rem` で書く（1rem＝16px として換算した）
- ツールバー・メニューバーの高さ（14 章 5 節の目安 28〜32px／44〜48px）は `@theme` のトークンにせず、`--spacing` の倍数（`h-8`＝32px・`h-12`＝48px）で書く。(b) 高さは 14 章でトークンになっていないので、目安の幅の上の端を 4px の倍数で取った
- 14 章の値や表を変えたときは、この節の CSS と対応表を同じ変更の中で直す

## 5. パッケージの構成と依存の禁止

[[../basic_design/01_architecture.md#3]] AD-5 を受ける。層とフォルダの対応は 2.1 節、層どうしの import の決まりと ESLint は 2.2 節が正で、本節はパッケージの木と、パッケージの依存の定義を書く。

### 5.1 パッケージとフォルダの木

リポジトリ直下は pnpm のワークスペース（`pnpm-workspace.yaml` に `packages/*` と `apps/*`）にする。

```
（リポジトリ直下）
├─ pnpm-workspace.yaml
├─ eslint.config.js              2.2 節
├─ packages/
│  ├─ core/                      @riff-line/core
│  │  └─ src/
│  │     ├─ ui/                  見た目に関係しない画面の処理
│  │     ├─ rendering/           alphaTab の描画の窓口（2.1 節の (b)）
│  │     ├─ editing/             編集サービス・コマンド層
│  │     ├─ playback/            再生制御
│  │     ├─ domain/              Score のラッパー・メタデータのモデル
│  │     ├─ export/              PDF・alphaTex・MIDI
│  │     ├─ errors/              エラーとログ
│  │     ├─ testing/             開発用サンプルデータ
│  │     └─ platform/            PlatformAdapter のインターフェース
│  ├─ ui-desktop/                @riff-line/ui-desktop
│  │  ├─ theme.css               4.2 節
│  │  └─ src/                    PC 版の画面の部品（React）
│  └─ shared-types/              @riff-line/shared-types
│     └─ src/                    共有する型だけ
└─ apps/
   ├─ desktop/                   @riff-line/desktop
   │  ├─ electron.vite.config.ts 4.1 節
   │  ├─ scripts/                ビルドの前に alphaTab のアセットをコピーする（4.1 節）
   │  └─ src/
   │     ├─ main/
   │     ├─ preload/
   │     └─ renderer/
   └─ mobile/                    Phase 3
```

- `packages/` には、プラットフォームに依存しない 3 つのパッケージ（`@riff-line/core`・`@riff-line/ui-desktop`・`@riff-line/shared-types`）を置く。 <!-- req 01:634f2a2f.7d3b --> <!-- req 01:499869ac.fef8 --> <!-- req 01:262248db.2f87 -->
- `packages/core` は Webコア本体で、L1 のうち見た目に関係しない処理と、L2・L3、L4 のうちインターフェースの定義（`platform`）を持つ。プラットフォーム固有の API（`electron`・`expo-*`・Node.js の組み込みモジュール）を直接参照しない（5.2 節で止める）。 <!-- req 01:62f312e4.d63f --> <!-- req 01:62f312e4.8679 -->
- `packages/core/src/ui` には、画面の見た目に関係しない処理（2.1 節の ViewModel・Binder・Store・Router・Overlay、曲アクションの新規作成と上限警告〈[[../basic_design/11_test_strategy.md]] の `UT-SONGACT-*`〉を含む）を置き、React の部品を置かない。React の部品は `packages/ui-desktop` に置く。 <!-- req 01:c5710176.c336 --> <!-- req 01:c5710176.a109 --> <!-- req 01:c5710176.7892 -->
- `packages/core/src/editing` には、編集サービスとコマンド層（`Command`・`CommandHistory`、[[editing-core.md#2]]）を置く。 <!-- req 01:a1b976a5.86d0 --> <!-- req 01:a1b976a5.efb6 -->
- `packages/core/src/playback` には、再生制御（基本設計 05 章、playback-integration.md）を置く。 <!-- req 01:d52f6760.46c0 --> <!-- req 01:d52f6760.49ef -->
- `packages/core/src/domain` には、Score のラッパーとメタデータのモデル（基本設計 02 章、[[data-model-persistence.md#2]]）を置く。 <!-- req 01:2746c543.6112 --> <!-- req 01:2746c543.f908 -->
- `packages/core/src/export` には、PDF・alphaTex・MIDI の書き出し（基本設計 07 章、export-print.md）を置く。 <!-- req 01:0cccc02e.b2ae --> <!-- req 01:0cccc02e.9d8d --> <!-- req 01:0cccc02e.1458 --> <!-- req 01:0cccc02e.38e2 -->
- `packages/core/src/errors` には、エラーとログの基盤（基本設計 08 章、error-logging-foundation.md）を置く。 <!-- req 01:0e391442.b41a -->
- `packages/core/src/platform` には、PlatformAdapter のインターフェース（3 節）だけを置き、実装を置かない。 <!-- req 01:ae8384d2.9a86 --> <!-- req 01:ae8384d2.1d91 -->
- 開発用サンプルデータ（要件 9 章）は `packages/core/src/testing` に置く。そのための `tools/` はリポジトリに設けない（2026-09-27 本人決定）。フィクスチャの中身は基本設計 11 章の回に書く。 <!-- req 01:e02f7bf5.90d2 --> <!-- req 01:e02f7bf5.1fe0 -->
- `packages/ui-desktop` には、PC 版の画面の部品（React のコンポーネント、基本設計 03 章）を置く。Webコアの L1 に属する（2.1 節）。 <!-- req 01:499869ac.76b5 --> <!-- req 01:499869ac.883b -->
- `packages/shared-types` には、`packages/core` と各ラッパー（`apps/*`）が共有する型の定義だけを置き、実行されるコードを置かない。 <!-- req 01:262248db.dea3 -->
- `apps/` はリポジトリ直下に置く。 <!-- req 01:f77cce6a.7804 -->
- `apps/desktop` は、PC 版（Phase 1）の Electron のラッパーとする。持つのは、基本設計 01 章 4.1 節のシェル側責務 7 点と、レンダラーの起動・DI の組み立てだけで、ほかの仕事を持たない（2026-09-27 本人決定）。7 点のうち①から④（ファイル I/O・オーディオセッション制御・ウィンドウ管理・自動更新チェック）は、AD-3 のアダプタの実装として main・preload・レンダラーで実装する（3.1 節）。⑤から⑦（OS 標準のダイアログの呼び出し・ネイティブのメニューの構築・クラッシュ検知）は、アダプタを通さずに `apps/desktop` で実装する。どのプロセスに置くかは 7.2 節。`packages/ui-desktop` の画面は、`apps/desktop` の DI の組み立ての中で組み立てる。画面の部品は置かない。 <!-- req 01:d2e57aa7.6755 --> <!-- req 01:d2e57aa7.edb8 --> <!-- req 01:d2e57aa7.3851 --> <!-- req 01:d2e57aa7.9bad --> <!-- req 01:d2e57aa7.3f52 --> <!-- req 01:d2e57aa7.1e0f --> <!-- req 01:d2e57aa7.c93d --> <!-- req 01:d2e57aa7.809e --> <!-- req 01:d2e57aa7.89a5 -->
- `apps/mobile` は、iPhone 版の Expo＋WebView のラッパーとし、Phase 3 で作る。 <!-- req 01:7405ea98.068b --> <!-- req 01:7405ea98.d8ae --> <!-- req 01:7405ea98.5eb1 -->

### 5.2 依存の定義と、import したらビルドが失敗する仕組み

パッケージの依存の向きは `apps/desktop` → `packages/ui-desktop` → `packages/core` → `packages/shared-types` とし、逆向きの依存を書かない。各パッケージの `package.json` の `dependencies` に書いてよいものを次の表に限る。 <!-- req 01:22be1a8f.86eb --> <!-- req 01:22be1a8f.d0fe -->

| パッケージ | `dependencies` に書いてよいもの | 書かないもの |
|---|---|---|
| `@riff-line/shared-types` | なし | ワークスペースのほかのパッケージすべて |
| `@riff-line/core` | `@riff-line/shared-types`・`@coderline/alphatab`・`zustand` | `electron`・`expo-*`・`react`・`@riff-line/ui-desktop`・`apps/*` のパッケージ |
| `@riff-line/ui-desktop` | `@riff-line/core`・`@riff-line/shared-types`・`react`・`react-dom`・`zustand` | `electron`・`expo-*`・`apps/*` のパッケージ <!-- req 01:02a0c5e8.d137 --> <!-- req 01:02a0c5e8.cb41 --> <!-- req 01:02a0c5e8.8572 --> <!-- req 01:02a0c5e8.7799 --> <!-- req 01:02a0c5e8.6cdc --> <!-- req 01:02a0c5e8.1261 --> |
| `@riff-line/desktop` | `@riff-line/ui-desktop`・`@riff-line/core`・`@riff-line/shared-types`。開発用（`devDependencies`）に `electron`・`electron-vite`・`@vitejs/plugin-react`・`tailwindcss`・`@tailwindcss/vite` | `react`・`react-dom`（上の UI の行） |

`packages/core` と `packages/ui-desktop` から `electron`・`expo-*` を import した時点でビルドが失敗するように、次の 2 つを重ねる。`packages/ui-desktop` の禁止も `packages/core` と同じ 2 つで止める。 <!-- req 01:abd3cf77.6a75 --> <!-- req 01:02a0c5e8.a84a -->

1. **依存の定義**：上の表のとおり、`packages/core` と `packages/ui-desktop` の `package.json` に `electron`・`expo-*` を書かない。 <!-- req 01:abd3cf77.2d2e -->
2. **lint のルール**：2.2 節の ESLint の `no-restricted-imports` で、その import をエラーにする。(b) リポジトリ直下の `build` の最初に `pnpm lint` を走らせ、lint のエラーでビルドを止める。依存の定義だけでは import が解決できてしまうことがあるため（リポジトリ直下の `.npmrc` に「Electron 関連はホイストする」の `public-hoist-pattern[]=*electron*` がある）、import を見て止めるのは ESLint に任せ、それをビルドの一部にする。CI（2.2 節）でも同じ `build` を走らせる。 <!-- req 01:abd3cf77.6c94 -->

## 6. プロセス構成・IPC・セキュリティの既定値

[[../basic_design/01_architecture.md#4]] を受ける。プロセスの図は基本設計が正で、本節はプロセスごとの置き場所、ウィンドウを作るときの既定値、IPC の決まりを書く。シェル側の責務をどのプロセスで実装するかは 7 節。

### 6.1 プロセスとウィンドウ

| プロセス | 数 | 置き場所 | 持つもの |
|---|---|---|---|
| main | 1 | `apps/desktop/src/main` | アダプタの実際の仕事（3.1 節・3.2 節）、⑤から⑦（7.2 節）、IPC のハンドラ |
| preload | ウィンドウごとに 1 | `apps/desktop/src/preload` | `contextBridge.exposeInMainWorld` で出す呼び口だけ（3.1 節） |
| レンダラー | 曲一覧ウィンドウに 1、編集ウィンドウ（曲）ごとに 1（10.2 節） | 入口は `apps/desktop/src/renderer`、中身は Webコア | Webコアの一式（`packages/core`・`packages/ui-desktop`） |

曲一覧ウィンドウと編集ウィンドウの分け方は [[../basic_design/03_screens_ui_pc.md#2]] が正。

### 6.2 セキュリティの既定値

- `BrowserWindow` を作るときは、`webPreferences` に `contextIsolation: true` と `nodeIntegration: false` を必ず渡し、どのウィンドウでも変えない。 <!-- req 01:ecd4a120.d9e1 --> <!-- req 01:ecd4a120.6b09 -->
- 同じ所に `sandbox: true` も渡す。(b) Electron の既定値に頼らず明示する。作り直す前の実装で、既定値に黙って頼っていたのをレビューで直した経緯があるため（[[../basic_design/00_overview.md]] の 0.19）
- レンダラーの Webコアは Node.js の API に直接触れず、必ず preload が出した呼び口から IPC で main に頼む（3.1 節の 3 か所の実装）。 <!-- req 01:ecd4a120.a0fd -->
- main の IPC のハンドラは、受け取った引数を確かめてから使う。(b) レンダラーを信頼の境界の外として扱い、Webコアの不具合が main でのファイル操作に直接つながらないようにするため
- レンダラーの CSP は `script-src 'self'` のまま緩めない（要件 5.1 の完全オフライン。[[../basic_design/13_design_decision_points.md#3]] B30 は、CSP を緩めない前提で alphaTab の描き方を決めている）

### 6.3 IPC の決まり

- レンダラーから main への頼みは、`ipcRenderer.invoke`／`ipcMain.handle` で行い、戻り値は `Promise` にする（3.3 節の非同期の決まり）。
- main からレンダラーへの知らせ（メニューで選ばれた項目、7.2 節の⑥）は、main が `webContents.send` で送り、preload が出す購読の関数でレンダラーが受ける。
- チャンネルの名前と、要求と応答の型は `packages/shared-types` に置く（3.1 節）。(b) 本書にはチャンネルの一覧を持たない。チャンネルは、それを使うアダプタや機能の受け先（ファイル I/O は data-model-persistence.md、ログとクラッシュは error-logging-foundation.md、ウィンドウとメニューは screens-navigation.md、印刷は export-print.md）で、シグネチャと一緒に書く。同じ事実を 2 か所に書かないため

## 7. シェル側の責務の一覧

[[../basic_design/01_architecture.md#4.1]] を受ける。7 点の定義と、7 点をシェル側の責務の全体とする理由は基本設計が正で、本節は 7 点を PC 版のどのプロセスのどこで実装するかを書く。

### 7.1 7 点の外へ足さない

- シェル側（`apps/desktop`・`apps/mobile`）の責務は、7.2 節の表の 7 点だけとする。要件 6 章の書き方どおり、シェル側だけを限定して並べ、Webコアの責務は一つずつ並べずに「7 点のほか全部」とする。 <!-- req 01:74ee13c1.1a95 --> <!-- req 01:5a45b866.737f --> <!-- req 01:5a45b866.fe7e -->
- 詳細設計でも、シェル側の責務はこの 7 点に限って扱い、7 点の外へ足さない。7 点のどれにも当たらない機能は、新しいものも前からあるものも、Webコア（`packages/core`・`packages/ui-desktop`）に置く。 <!-- req 01:d2029e53.bf8e --> <!-- req 01:45dce2c8.0278 --> <!-- req 01:2068a9a4.640d --> <!-- req 01:56324cb4.d322 --> <!-- req 01:71f70a6f.76e5 -->
- 編集ロジック（`packages/core/src/editing`）・データモデル（`packages/core/src/domain`）・再生エンジン（`packages/core/src/playback`）は、PC 版と iPhone 版で同じコードを使い、別に作らない。 <!-- req 01:d2029e53.989a --> <!-- req 01:d2029e53.aebf --> <!-- req 01:d2029e53.4ab2 -->
- 画面は PC 版と iPhone 版で別に作る。PC 版の画面の部品（React）は `packages/ui-desktop` に置き、iPhone 版はこれを使わない。 <!-- req 01:d2029e53.f89c -->
- PC 版の画面の部品は 7 点のどれにも当たらないので、Webコアの `packages/ui-desktop` に置き、シェルの `apps/desktop` には置かない（5.1 節）。 <!-- req 01:008a1e77.7564 --> <!-- req 01:008a1e77.f823 -->

### 7.2 7 点の実装の置き場所

①から④は AD-3 のアダプタとして Webコアへ注入する（3 節）。⑤から⑦はアダプタを通さず、OS に直接触れる実装として `apps/desktop` の main に置く。 <!-- req 01:40249078.8462 --> <!-- req 01:40249078.5fbb -->

| # | 責務 | 実装の形 | PC 版で置くプロセス | 中身の受け先 |
|---|---|---|---|---|
| ① | ファイル I/O | `FileSystemAdapter`（3 節）を注入する | main が `fs/promises` で行い、レンダラーの側のクラスが IPC で呼ぶ（3.2 節） | data-model-persistence.md（基本設計 06 章の回） <!-- req 01:40249078.0976 --> <!-- req 01:a0e77481.20de --> |
| ① に含める | main の `Logger` によるログファイルへの書き出し | レンダラーから `log:append` の IPC で受け、main がファイルに書く | main | error-logging-foundation.md（基本設計 08 章の回） <!-- req 01:a0e77481.fcfc --> |
| ② | オーディオセッション制御 | `AudioSessionAdapter`（3 節）を注入する。実際の処理を持つのは iPhone 版だけ | PC 版は何もしない実装をレンダラーの側に置く（3.2 節） | playback-integration.md（基本設計 05 章の回） <!-- req 01:40249078.5689 --> <!-- req 01:3b7c8d0b.9fd0 --> <!-- req 01:3b7c8d0b.4bcc --> |
| ③ | ウィンドウ管理 | `WindowAdapter`（3 節）を注入する | main | screens-navigation.md（基本設計 03 章の回） <!-- req 01:40249078.f639 --> <!-- req 01:6dab0106.eaa3 --> |
| ④ | 自動更新チェック | `UpdateCheckAdapter`（3 節）を注入する。v1 は通信しないダミー（3.2 節） | 置くプロセスは本書の 10 章の回に書く | 本書（基本設計 10 章の回） <!-- req 01:40249078.c416 --> <!-- req 01:8359d666.81a9 --> <!-- req 01:8359d666.1ede --> |
| ⑤ | OS 標準のダイアログの呼び出し（印刷・ファイル選択） | アダプタを通さず、OS のダイアログを直接開く | main | 印刷は export-print.md（基本設計 07 章の回）、ファイル選択は 7.3 節 <!-- req 01:40249078.2bf0 --> <!-- req 01:40249078.c51d --> <!-- req 01:71678ac4.f525 --> <!-- req 01:71678ac4.1aed --> |
| ⑥ | メニューバーと右クリックメニューの構築 | アダプタを通さず、main の `Menu`／`Menu.buildFromTemplate` で作る。選ばれた項目は IPC でレンダラーの Webコアへ知らせる（6.3 節） | main | 項目は screens-navigation.md（基本設計 03 章の回） <!-- req 01:40249078.9185 --> <!-- req 01:40249078.135c --> <!-- req 01:61a9764d.45f5 --> <!-- req 01:61a9764d.7b13 --> <!-- req 01:61a9764d.2331 --> <!-- req 01:f3133cb2.30ee --> <!-- req 01:f3133cb2.a88f --> <!-- req 01:f3133cb2.55ef --> |
| ⑦ | クラッシュ検知 | アダプタを通さず、main が各ウィンドウの `webContents` の `render-process-gone` を見張る。検知したら、そのウィンドウのレンダラーを、直前の自動保存のデータから読み込み直す | main | error-logging-foundation.md（基本設計 08 章の回） <!-- req 01:40249078.9565 --> <!-- req 01:fc2e1762.1640 --> <!-- req 01:7e4c4791.ec29 --> <!-- req 01:7e4c4791.3f13 --> |
| ⑦ に含める | レンダラーが落ちた後のクラッシュログの記録（main の `Logger` と、直近の履歴の保持） | レンダラーの中の `Logger` はレンダラーと一緒に失われ、自分のクラッシュを書けないので、main に置く | main | error-logging-foundation.md（基本設計 08 章の回） <!-- req 01:fc2e1762.7f49 --> |

### 7.3 ⑤ のうちファイル選択のダイアログ

- OS 標準のファイル選択のダイアログをシェル側で開くのは、次の 2 つだけとする。(a) 保存先フォルダの指定（[[../basic_design/06_file_io_persistence.md#2]] の「カスタムフォルダを選択」）。(b) 書き出し画面の保存先フォルダの欄の「参照…」で開くフォルダ選択（[[../basic_design/07_export_print.md#2]]）。 <!-- req 01:ed9d890f.6ebc --> <!-- req 01:600aa0e8.371c --> <!-- req 01:600aa0e8.36ae --> <!-- req 01:600aa0e8.73c8 -->
- どちらもフォルダを選ぶダイアログにする（Electron の `dialog.showOpenDialog` に `properties: ['openDirectory']` を渡す）。書き出しのファイル名は書き出し画面の欄で決め、OS のダイアログでは選ばせない。 <!-- req 01:600aa0e8.fb4e -->
- main がダイアログを開き、選ばれたフォルダのパスの文字列だけを IPC でレンダラーへ返す。Webコアはパスの文字列を受け取るだけで、ダイアログのことを知らない。⑥⑦と同じく、アダプタを通さない。チャンネルと戻り値の形は、使う側の受け先（data-model-persistence.md、export-print.md）で書く。 <!-- req 01:3ecc378b.6a97 --> <!-- req 01:3ecc378b.04c6 --> <!-- req 01:3ecc378b.1621 --> <!-- req 01:ff571dfd.16b3 -->

## 10. 起動・メモリ・描画の方針

[[../basic_design/01_architecture.md#6]] を受ける。目標値は基本設計 09 章が正で、本節はアーキテクチャの側で決めることだけを書く。

### 10.1 起動

- alphaTab（描画）と AlphaSynth（再生）は、アプリの起動の手順の中で初期化しない。曲を開いた編集ウィンドウのレンダラーで初期化する。曲一覧ウィンドウでは初期化しない。 <!-- req 01:55d78e78.40a5 --> <!-- req 01:55d78e78.a485 -->
- 音源の読み込みと、読み終わるまでの再生ボタンの状態は、playback-integration.md（基本設計 05 章の回、[[../basic_design/05_playback_audio.md#9]]）に書く。

### 10.2 メモリ（レンダラーの分け方）

- 編集ウィンドウ（曲）ごとにレンダラーのプロセスを分ける。曲を開くたびに `BrowserWindow` を 1 つ作り、同じ曲のウィンドウがもうあれば新しく作らない（`WindowAdapter`、3.2 節）。 <!-- req 01:0d1336fe.3522 -->
- 1 つの曲のレンダラーが落ちても、読み込み直すのはそのウィンドウのレンダラーだけにする（7.2 節の⑦）。 <!-- req 01:0d1336fe.bb5d -->
- 09 章のメモリの目標値は、1 ウィンドウあたりの値として扱う（[[../basic_design/09_nonfunctional.md#3]]）。

### 10.3 描画

- 100 小節を超える曲でも速さを保つため、フォーカス表示で描く小節を絞り、全部の小節を一度に DOM に描く仕組みを自前で作らない。 <!-- req 01:1bc94906.a335 -->
- alphaTab の遅延描画（画面の外の小節を後で描くしくみ）は使わない。alphaTab の設定の `core.enableLazyLoading`（既定は `true`）に `false` を渡す（[[../basic_design/13_design_decision_points.md#3]] B30）。渡すのは、4.1 節の `core.engine` と同じ `packages/core/src/rendering` の 1 か所だけ。 <!-- req 01:1bc94906.b94e -->
- 大曲の全体表示の速さは、[[../basic_design/13_design_decision_points.md#2]] A9 で実機を使って確かめる。 <!-- req 01:1bc94906.1559 -->

## 11. alphaTab の検証事項

[[../basic_design/01_architecture.md#7]] を受ける。

- 編集は alphaTab の専用の API を使わず、アプリの側で Score のオブジェクトを直接変えてから、描き直しを頼む方式とする（[[../basic_design/13_design_decision_points.md#2]] A1）。描き直しを頼むのは `CommandHistory`（[[editing-core.md#2]]）。 <!-- req 01:585528d5.124a -->
- Score のどのプロパティを変えれば安全かの切り分けは、[[../basic_design/13_design_decision_points.md#2]] A1 で、プロパティごとには分けず、コマンドの実行と取り消しのたびに `CommandHistory` が対象のトラックだけを一律に描き直す方式に決まっている。この決定と理由は editing-core.md（基本設計 04 章の回）に書く。 <!-- req 01:585528d5.7cd9 -->
- 描画エンジンは SVG とする（A2。設定は 4.1 節の `core.engine`）。 <!-- req 01:47c71afa.1e6f -->
- パートが 0 の曲を alphaTab がそのまま描けるかは、まだ確かめていない。描けない前提で、パートが 0 のときはアプリの側で描画を呼ばず、案内を出す（案内の中身は [[../basic_design/03_screens_ui_pc.md#10]]、screens-navigation.md に書く）。(b) 描画を呼ぶかどうかの判断は `packages/core/src/rendering` の窓口で行う。alphaTab を呼ぶ所がそこだけだから（2.1 節）。 <!-- req 01:9eabe9c3.bcd0 -->
- 描けるかどうかは実装の前に確かめ、確かめた結果で本節を直す。 <!-- req 01:9eabe9c3.7630 -->
