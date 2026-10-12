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
| L5（`apps/desktop`） | L1〜L4・`errors`・`electron`（DI の組み立てのため）。L5 は層の番号では一番下だが、パッケージの依存の向きは基本設計 AD-5 の `apps/desktop` → `packages/ui-desktop` → `packages/core` → `packages/shared-types` に従い、組み立てのために L1〜L4 を import する。L5 が L1 の画面（`packages/ui-desktop`）を読み込むのは、基本設計 01 章 2 節の「組み立ての根としての例外」に当たり、それ以外の逆方向の依存は持たない <!-- req 01:6c825e98.be91 --> |

**ESLint で見張る**：設定はリポジトリ直下の `eslint.config.js`（フラットコンフィグ）1 つにまとめる。ESLint の組み込みの `no-restricted-imports`（パターン指定）で、上の表に無い向きの import と、`packages/core/**`・`packages/ui-desktop/**` から `electron`・`expo-*`・Node.js の組み込みモジュール・`apps/**` への import をエラーにする。`packages/core` から `react` の import もエラーにする（[[../basic_design/13_design_decision_points.md#3]] B36 の理由 (1)）。(b) 組み込みのルールを使うのは、作り直す前の実装で動いていた形で、`eslint-plugin-import` を足さずに済むため。`packages/ui-desktop` の分は、そのパッケージを作るときに足す。ビルドの構成（electron-vite と Electron Builder）の import の禁止も同じ設定に入れる（中身は 8.4 節）。 <!-- req 01:09054c00.d4eb -->

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

Webコアがプラットフォームに頼る仕事は、ファイル I/O・オーディオセッション制御・ウィンドウ管理・自動更新チェックの 4 系統とし、系統ごとにインターフェースを 1 つずつ置く：`FileSystemAdapter`・`AudioSessionAdapter`・`WindowAdapter`・`UpdateCheckAdapter`。4 つとも `packages/core/src/platform` に置き、実装はそこに置かない（5 節）。v1 で注入するのはこの 4 系統とする。基本設計 10 章 1 節の表でアダプタの追加で受けるとした将来の機能は、アプリロック・ライセンス・MIDI 連携・通知・音声メモの録音・省電力の 6 つで閉じる（2026-10-10 本人決定）。どれも同じ形で新しいアダプタを足し、足すときに本節と `PlatformAdapters` に足す（基本設計 01 章 AD-3）。v1 ではこの 6 つの型を置かない。 <!-- req 01:384bef0d.068f --> <!-- req 01:384bef0d.c5c3 --> <!-- req 01:384bef0d.9198 --> <!-- req 01:384bef0d.d97e --> <!-- req 01:23a18f23.838c --> <!-- req 01:30c41fe8.bb3f --> <!-- req 01:e1a076ad.d297 -->

Webコア（`packages/core`・`packages/ui-desktop`）のコードは、4 系統について具象クラスを import せず、`packages/core/src/platform` のインターフェースだけを型として使う。具象クラスは `apps/**` にあるので、import すると 2.2 節の ESLint の規則でエラーになる。 <!-- req 01:384bef0d.34b6 -->

具象の実装は、PC 版は Electron アダプタとして `apps/desktop` に、iPhone 版（Phase 3）は Expo アダプタとして `apps/mobile` に置く。L5 が起動時に具象を作り、次の `PlatformAdapters` 1 つにまとめて、Webコアの組み立ての関数に引数で渡す（依存性逆転）。Webコアの中でアダプタを使うクラスは、コンストラクタの引数で受け取り、グローバルな置き場（シングルトン・モジュールの変数）から取らない。Phase 3 の iPhone 版の保存先の契約は、基本設計 13 章 A12 で作り直す前提とし、本書の `FileSystemAdapter` の契約は PC 版（Phase 1）のものとする。(b) 1 つの型にまとめて渡すのは、4 つのどれかを渡し忘れたときに型の検査で見つけるため。コンストラクタで受け取るのは、テストで偽物に差し替えるため。 <!-- req 01:384bef0d.7e73 -->

```ts
// packages/core/src/platform/PlatformAdapters.ts
export interface PlatformAdapters {
  fileSystem: FileSystemAdapter;
  audioSession: AudioSessionAdapter;
  window: WindowAdapter;
  updateCheck: UpdateCheckAdapter;
}
```

PC 版では、Electron のプロセスの分け方に合わせて、1 つのアダプタを 3 か所で実装する。main は Node.js と Electron の API で実際の仕事をし、`ipcMain.handle` で要求を受ける。preload は `contextBridge.exposeInMainWorld` で、main への呼び口（`ipcRenderer.invoke` を包んだ関数）だけをレンダラーに出す。レンダラーの側では、インターフェースを実装するクラスが preload の呼び口を呼ぶ。IPC の要求と応答の型は `packages/shared-types` に置く。main だけで済まないのは、レンダラーから Node.js の API に直接触れさせないため（6.2 節のセキュリティの既定値）。 <!-- req 01:7da038e8.f36f --> <!-- req 01:7da038e8.3854 --> <!-- req 01:dc789b0c.6bf3 -->

### 3.2 アダプタごとの責務

| アダプタ | 責務 | PC 版の実装 |
|---|---|---|
| `FileSystemAdapter` | 曲データの読み込み、アトミックな書き込み（一時ファイルに書いてからリネームする、[[../basic_design/06_file_io_persistence.md]] の方式）、一覧の取得、ゴミ箱への移動、現在の保存先ルートの取得、保存先の移行の 6 つ | main が Node.js の `fs/promises` で行い、レンダラーの側のクラスが IPC で呼ぶ <!-- req 01:05ee595e.d7ef --> <!-- req 01:05ee595e.1a2b --> <!-- req 01:05ee595e.9d24 --> <!-- req 01:05ee595e.e4c4 --> <!-- req 01:05ee595e.305f --> <!-- req 01:05ee595e.0158 --> |
| `AudioSessionAdapter` | バックグラウンドで鳴っているほかの音楽アプリと、音声を共存させる設定 | 何もしない実装（no-op）をレンダラーの側に置く。IPC は使わない。実際の設定をするのは iPhone 版（Phase 3）の実装だけ <!-- req 01:c9422351.89ca --> <!-- req 01:c9422351.013c --> <!-- req 01:c9422351.9376 --> |
| `WindowAdapter` | 曲のウィンドウを開くこと。同じ曲のウィンドウがもう開いていれば、新しく開かずにそのウィンドウを前に出す（同じ曲の二重起動を防ぐ、要件 5.6） | main がウィンドウを管理し、レンダラーの側のクラスが IPC で呼ぶ <!-- req 01:21f81568.05f0 --> <!-- req 01:21f81568.db72 --> |
| `UpdateCheckAdapter` | 更新の確認 | 今はダミーの実装で、通信せずに常に「更新なし」を返す。(b) 要件 5.1 の完全オフラインに合わせ、確認の中身が決まるまで外へ通信しないため <!-- req 01:23a18f23.a76a --> <!-- req 01:23a18f23.fffe --> <!-- req 09:4acadeee.8c72 --> |

- `FileSystemAdapter` の 6 つの責務のうち、アトミックな書き込み・ゴミ箱への移動・保存先の移行の 3 つは、アダプタのメソッド（[[data-model-persistence.md#10]] の 10.1 節の `readFile`・`writeFile`・`renameFile`）だけを使って組み立てる。アトミックな書き込みは一時ファイルへの `writeFile` と本ファイルへの `renameFile` の組（[[data-model-persistence.md#15]] の `SongRepository.save`）、ゴミ箱への移動は `trash/` への `renameFile`（[[data-model-persistence.md#17]] の `TrashService`）、保存先の移行は古いルートのアダプタの `readFile` と、新しいルートのアダプタの一時ファイルへの `writeFile` と `renameFile`（[[data-model-persistence.md#12]] の `StorageMigrationService`）とする。(b) 3 つともプラットフォームの API に触れる所は上のメソッドだけで、手順の組み立てはプラットフォームに依存しないので、組み立てを Webコアに置き、PC 版と iPhone 版で 2 回書かずに済むようにするため。アダプタを差し替えれば、3 つの責務もそのアダプタの上で同じ手順で動く。

保存先は、`FileSystemAdapter` から見ると 1 つの「フォルダのパス」で、ローカル・iCloud Drive・Google Drive・カスタムフォルダのどれを選んだかで扱いを変えない。保存先の種類と選び方は [[../basic_design/06_file_io_persistence.md#2]] が正で、ユーザーが選んだフォルダのパスを設定から受け取る。`FileSystemAdapter` とその実装は、どのクラウドサービスの API も呼ばず、どのサービスにも依存しない（同期は OS の同期クライアントが行う）。 <!-- req 01:05ee595e.2fc6 --> <!-- req 01:05ee595e.e80e --> <!-- req 09:5c312fba.9c21 -->

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
|---|--- <!-- req 01:684cea3b.e2e0 --> |
| 言語 | TypeScript。`packages/*` と `apps/*` のソースは `.ts`／`.tsx` で書く <!-- req 01:da104e4f.da60 --> |
| UI | React。React を import してよいのは `packages/ui-desktop` だけ（2.2 節の表）。`apps/desktop` のレンダラーは React を import せず、`packages/ui-desktop` が出す「画面を DOM に載せる関数」を呼んで、組み立てたアダプタとサービスを渡す。(b) 2.2 節の表で L5 の import してよい先に React が無いため。関数の形は基本設計 03 章の回に screens-navigation.md に書く <!-- req 01:15b5ef7e.c567 --> |
| 状態管理 | Zustand。ストアは `packages/core/src/ui` に置き、`zustand/vanilla` の `createStore` で作る（React を import しない）。画面の部品（`packages/ui-desktop`）は `zustand` の `useStore` でストアを読む。(b) `packages/core` が React を import しない決まり（2.2 節）を守ったまま、ストアを Webコアの見た目に関係しない側に置けるため <!-- req 01:47958bb6.ef05 --> |
| コマンド層 | 状態管理のライブラリを使わず、`packages/core/src/editing/commands` に自前で書く（[[editing-core.md#2]]） <!-- req 01:47958bb6.023d --> |
| Undo/Redo の対象 | Score の変更だけ。`CommandHistory` に積むのは Score を変えるコマンドだけにする <!-- req 01:47958bb6.3b76 --> |
| 画面の状態 | Score の外にある画面の状態（選択範囲・表示モードを含む）は、状態管理のストアに置き、`CommandHistory` に積まない。ストアの値の変更は Undo/Redo で戻らない <!-- req 01:47958bb6.4f3b --> |
| ビルド | Vite を土台にした electron-vite で、main・preload・レンダラーの 3 つを組む。設定は `apps/desktop/electron.vite.config.ts` の 1 つ。(b) 3 つのプロセスを 1 つの設定で組めるため <!-- req 01:612cc1fc.58f5 --> |
| alphaTab | `@coderline/alphatab` を fork したもの（下の「alphaTab の fork」の行）を入れ、依存に書くのは `packages/core`（描画と再生）。版は `package.json` で 1 つに固定する（今の元は本家の `1.8.4`）。(b) 依存の名前は `@coderline/alphatab` のままにし、`package.json` の参照先だけを fork の作り物に向ける。アプリのコードの import を変えずに済み、本家へ戻すときも参照先を 1 か所直せば済むため <!-- req 01:5712243c.f50c --> <!-- req 01:5712243c.e538 --> |
| alphaTab の fork | 本家の同じ版を元にし、足すのは再生中のパンの命令 `changeTrackPan`（[[playback-integration.md#2]] の 2.2 節）の 1 つだけとする（2026-10-11 本人決定、基本設計 13 章 A13）。足したものの一覧（足したファイル・直したファイル・足した命令の通り道）は fork の側に 1 つのファイルで残す。本家の版を上げるときは、fork に本家の新しい版を取り込み、一覧のとおりに足したものを当て直し、playback-integration.md 2.2 節の 2 つの単体テスト（アプリの側と fork の側）と 12 節の Phase 0 の確かめをやり直す。版を上げる PR では 8.2 節のライセンスの確かめも通す。fork のソースは、GitHub で本家を fork した公開のリポジトリに置き、このリポジトリには入れない。アプリに取り込むのは、fork をビルドした作り物だけとする（2026-10-12 本人決定、honnin-queue 83 番）。本家の新しい版を取り込むときは、GitHub の fork の機能で本家との差分を fork に取り込む。fork のリポジトリは公開しているので、配るときの「fork で直したファイルのソースを公開する」（基本設計 01 章 5 節、本書 8.2 節）は、このリポジトリを示せば満たす。fork のリポジトリは Phase 0 で作り、名前と URL はそのときに書く。(b) fork をビルドした作り物（`dist`）を `packages/core` の `package.json` から pnpm のファイルの参照で指し、アプリのビルドで alphaTab を組み直さない。アプリのビルドの手順を本家のままの形に保つため。作り物をこのリポジトリのどこに置くかと、ファイルの参照の書き方は、Phase 0 で fork を作るときに pnpm の版の説明で確かめて書く <!-- req 01:5712243c.c532 --> <!-- req 01:5712243c.0477 --> <!-- req 01:5712243c.b4fe --> <!-- req 01:5712243c.b1d5 --> <!-- req 01:5712243c.ca70 --> <!-- req 01:5712243c.5e6d --> <!-- req 01:5712243c.8697 --> |
| SoundFont とフォント | alphaTab（fork）のパッケージの `dist/soundfont` と `dist/font` を、ビルドの前にコピーするスクリプト（`apps/desktop/scripts`）で `apps/desktop/src/renderer/public/alphatab/` に置き、アプリと一緒に配る。読み込みはアプリの中の相対パスで行い、`http:`・`https:` の URL から読まない（要件 5.1、外部の CDN を使わない）。どの SoundFont を配るかは playback-integration.md（基本設計 05 章の回） <!-- req 01:5712243c.76f9 --> |
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
| 直値を書かない | 画面の部品（`packages/ui-desktop`）は、色・文字・余白・角丸・影を、トークンから作られた Tailwind のクラス（`bg-surface`・`text-danger`・`p-3`・`rounded-md` の形）だけで書く。色・長さの直値（例：`#c62a3f`）、角括弧で値を書く任意値のクラス（例：`[#c62a3f]`・`[13px]`）、`style` 属性のどれも書かない（`style` 属性に `var(--…)` を書くことも含む、[[../basic_design/08_error_logging.md#4]]）。`var(--…)` で参照してよいのは、クラスを付けられない `packages/core/src/rendering` の SVG の着色だけ。(b) 画面の部品ではなく、alphaTab が描いた SVG の要素に色を付ける所なので <!-- req 01:4be59a2d.4bfe --> <!-- req 01:4be59a2d.5ffb --> <!-- req 08:ee543f5b.4a5e --> <!-- req 14:20e92645.0395 --> |
| ダークの値 | 14 章 3 節の表のダークの値と 6 節のダークの影は、将来ダークモードを足すときに使う控えで、v1 では `@theme` に入れない（14 章 3 節の「v1の実装にはダーク値を入れない」）。控えの値は下の「色のトークンの使い道とダークの控え」の表の右の列に持つ。影のダークの控えは `0 4px 12px rgb(0 0 0 / 0.45)`。入れるときは同じファイルに上書きの規則を足す <!-- req 14:fb087205.3517 --> <!-- req 14:fb087205.1fce --> <!-- req 14:af97cae7.9ba9 --> |
| パート識別色 | `Part.color`（データとしてのパートの色、14 章 3.2 節）は、アクセントの色とは別の色の体系として扱い、`--color-*` のトークンに入れない。曲データの値なので、描画のときに渡す。既定のパレットの 8 色は [[part-tuning-management.md#2]] の 2.1 節の `PART_COLOR_PALETTE` の 1 か所に持ち、並びの番号で `part-color-1` から `part-color-8` と呼ぶ。8 色は、アクセント（インディゴの `#5850ec`）と色相が隣り合わないよう、わざとずらして選んである（2026-10-01 本人決定、honnin-queue 2 番）。(b) パレットを CSS 変数にしないのは、選んだ色が HEX の文字列で曲のファイルに入り、割り当ての処理（TypeScript）が値を使うので、CSS と TypeScript の 2 か所に値を持たないため <!-- req 14:8d71b484.a943 --> <!-- req 14:4f65c325.0202 --> <!-- req 14:ed168089.839d --> <!-- req 14:ed168089.4a8b --> |

色は 14 章 3 節の表の全トークン（21 個）を、表の名前に `--color-` を付けて、ライトの値のまま並べる（[[../basic_design/08_error_logging.md#4]] の「`--color-` ＋表の名前」）。色のほか（14 章 4〜6 節）は、Tailwind の名前空間（公式文書の表：`--font-*`・`--text-*`・`--font-weight-*`・`--spacing-*`・`--radius-*`・`--shadow-*`）に合わせて、下の対応表の名前にする。 <!-- req 08:ee543f5b.14a8 --> <!-- req 08:ee543f5b.0d34 --> <!-- req 14:20e92645.a3dd --> <!-- req 14:20e92645.5bf8 -->

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
  --color-overlay: color-mix(in srgb, var(--color-surface) 70%, transparent);
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
  --color-info-tag-soft: #e3f2f7;

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
| 4 節 フォントスタック「UI基本」 | `"Segoe UI", "Yu Gothic UI", "Meiryo UI", "Hiragino Kaku Gothic ProN", sans-serif` | `--font-ui`（同じ値）。PC 版は Windows の標準の書体を先頭に置いた、この並びの順のまま使う | `font-ui` <!-- req 14:881d9ab0.50e2 --> <!-- req 14:45547963.8e5e --> |
| 4 節 フォントスタック「数値・技術情報用（等幅）」 | `"Cascadia Mono", "Consolas", ui-monospace, monospace` | `--font-mono`（同じ値）。数と技術の情報の表示に使う（使う所は [[screens-navigation.md#15]] の 15.2 節） | `font-mono` <!-- req 14:d475d16c.a8f8 --> <!-- req 14:d475d16c.0843 --> |
| 4 節 ダイアログ見出し | 15px相当・600 | `--text-heading: 0.9375rem`（15px）／`--font-weight-heading: 600` | `text-heading`・`font-heading` <!-- req 14:46fa6f5d.90ab --> |
| 4 節 本文・標準UI文字 | 13.5px相当・400 | `--text-body: 0.84375rem`（13.5px）／`--font-weight-body: 400` | `text-body`・`font-body` <!-- req 14:79e1c28f.c96a --> |
| 4 節 ラベル・見出し小 | 12px相当・600 | `--text-label: 0.75rem`（12px）／`--font-weight-label: 600` | `text-label`・`font-label` <!-- req 14:22effc43.3fbb --> |
| 4 節 補助文字・タイムスタンプ | 11px相当・500 | `--text-caption: 0.6875rem`（11px）／`--font-weight-caption: 500` | `text-caption`・`font-caption` <!-- req 14:48490a85.7c46 --> |
| 5 節 space-1〜space-5 | 4／8／12／16／20px | `--spacing: 4px` の 1 つだけ。Tailwind の数値の余白クラスは `--spacing` の倍数になる（公式文書 padding：「`padding: calc(var(--spacing) * <number>);`」）。space-1＝`*-1`（4px）、space-2＝`*-2`（8px）、space-3＝`*-3`（12px）、space-4＝`*-4`（16px）、space-5＝`*-5`（20px）。余白は 4px の格子にそろえる | `p-3`・`gap-4` <!-- req 14:027dd337.91c6 --> |
| 6 節 radius-sm／radius-md／radius-lg | 4／6／8px | `--radius-sm`／`--radius-md`／`--radius-lg`（名前も値もそのまま） | `rounded-sm`・`rounded-md`・`rounded-lg` |
| 6 節 影（浮いている要素だけに使う、1 種類） | ライト `0 4px 12px rgb(0 0 0 / 0.12)` | `--shadow-float`（同じ値）。影はこの 1 つだけで、別の影のトークンを作らない。(b) 14 章に名前が無いので、用途（浮いている要素）から名前を付けた | `shadow-float` <!-- req 14:af97cae7.e479 --> <!-- req 14:af97cae7.1639 --> |

- 文字の大きさは、14 章 4 節の「相対単位で定義する」に従って `rem` で書く（1rem＝16px として換算した）。OS の表示の拡大（UI のスケーリング）に合わせて大きさが変わるようにするため <!-- req 14:753144e7.86d2 -->
- ツールバー・メニューバーの高さ（14 章 5 節の目安 28〜32px／44〜48px）は `@theme` のトークンにせず、`--spacing` の倍数（`h-8`＝32px・`h-12`＝48px）で書く。(b) 高さは 14 章でトークンになっていないので、目安の幅の上の端を 4px の倍数で取った。ツールバー（[[screens-navigation.md#7]] の 7.1 節の上のツールバー）の高さは `h-8`（32px）とする <!-- req 14:ee708534.1b7c -->
- メニューバーの高さ（目安 44〜48px）は、ここでは決めない。メニューバーは OS 標準のメニュー（[[screens-navigation.md#8]] の 8.3 節の `BrowserWindow.setMenu`）で、高さを OS が決め、アプリの CSS が届かないため（未確認（推測）。確かめるには実機で編集ウィンドウを開いてメニューバーの高さを測る）。14 章 5 節と 7.1 節のどちらにそろえるかは honnin-queue 89 番 <!-- req 14:ee708534.e041 -->
- macOS 版と iPhone 版（Phase 3）に入るときは、上のフォントスタックの先頭に SF 系の書体を足すだけにし、書体の決め方の原則は変えない <!-- req 14:86374013.e3d2 --> <!-- req 14:86374013.699a -->
- 14 章の値や表を変えたときは、この節の CSS と対応表を同じ変更の中で直す

**色のトークンの使い道とダークの控え**（14 章 3 節。どの部品にどの色を当てるかは [[screens-navigation.md#15]]）：

| 14 章の名前 | ライトの値（`@theme`） | 使い道 | ダークの控え（v1 では入れない） |
|---|---|---|---|
| bg | `#f6f6f7` | ウィンドウ全体の背景 | `#19191c` <!-- req 14:df155668.b1bb --> |
| surface | `#ffffff` | パネルの背景・カードの背景・ダイアログの背景 | `#212124` <!-- req 14:8958f426.f73f --> <!-- req 14:8958f426.5e5d --> <!-- req 14:8958f426.3d51 --> |
| surface-2 | `#f0f0f2` | ホバーしたときの背景と、軽い区分けの背景 | `#29292d` <!-- req 14:8d5410fb.8c72 --> <!-- req 14:8d5410fb.2bb5 --> |
| surface-3 | `#e9e9ec` | ファイルアイコンのプレースホルダ（仮の絵）の背景 | `#323236` <!-- req 14:5df90278.ab1e --> |
| border | `#e2e2e6` | 標準の罫線 | `#38383d` <!-- req 14:f8cf884b.7a6e --> |
| border-strong | `#d3d3d9` | 入力欄とボタンの罫線（強調が要る罫線） | `#46464c` <!-- req 14:1b5b83ff.f5fb --> <!-- req 14:1b5b83ff.b3c4 --> |
| text-primary | `#1a1a1e` | 主要な文字 | `#f0f0f2` <!-- req 14:9973e2d6.a3bc --> <!-- req 14:9973e2d6.3738 --> |
| text-secondary | `#68686f` | ラベルと補助の文字 | `#a3a3ab` <!-- req 14:47d6d6a3.372c --> <!-- req 14:47d6d6a3.1173 --> |
| text-tertiary | `#a0a0a8` | プレースホルダの文字とタイムスタンプ（日時） | `#75757e` <!-- req 14:37f9e9f7.885d --> <!-- req 14:37f9e9f7.3ffa --> |
| overlay | surface を 70% の不透明度（上の CSS の `color-mix`） | 編集を受け付けない間に譜面の上へ重ねる覆い（[[screens-navigation.md#7]] の 7.6 節） | ライトと同じく surface を 70% の不透明度 <!-- req 14:6318bca1.e35a --> |
| accent | `#5850ec` | プライマリボタン・アクティブなナビ・アクティブなタブ・フォーカスリング | `#8b84f5` <!-- req 14:282a6a13.6f03 --> <!-- req 14:282a6a13.ba6c --> <!-- req 14:282a6a13.f01e --> <!-- req 14:282a6a13.228d --> |
| accent-hover | `#473fd6` | プライマリボタンのホバー | `#a19bf7` <!-- req 14:83f6aed0.a175 --> |
| accent-soft | `#eeecfd` | アクティブな状態の淡い背景（ナビの選択行） | `#2c2a52` <!-- req 14:23dd472f.1029 --> |
| success | `#157f45` | 完了と成功のバッジ | `#4ecb87` <!-- req 14:6d7b37fd.baf2 --> <!-- req 14:6d7b37fd.98e9 --> |
| success-soft | `#e5f5ec` | success のバッジの背景 | `#16311f` <!-- req 14:c1fa4868.bbad --> |
| warning | `#b5690a` | Warning レベルの知らせ（[[screens-navigation.md#13]] の 13.2 節の表）と、上限に近づいたときの表示（[[screens-navigation.md#2]]） | `#e8a141` <!-- req 14:34bc2e77.74b5 --> <!-- req 14:34bc2e77.f97f --> |
| warning-soft | `#fdf1e2` | warning の背景 | `#3a2a10` <!-- req 14:81ec028c.5ddc --> |
| danger | `#c62a3f` | Error レベルと Critical レベルの知らせ（13.2 節の表）と、削除のボタン | `#ea6577` <!-- req 14:9bdead80.f7d8 --> <!-- req 14:9bdead80.797f --> <!-- req 14:9bdead80.49e1 --> |
| danger-soft | `#fbe9ec` | danger の背景 | `#3a1a20` <!-- req 14:9ec1a0d6.3b90 --> |
| info-tag | `#0b6e8f` | 知らせのレベルとは結び付けない、一般的な状態タグ（処理中・同期中）の中立の識別色 | `#4fc2e0` <!-- req 14:f1ff8685.2964 --> <!-- req 14:f1ff8685.f2a0 --> |
| info-tag-soft | `#e3f2f7` | info-tag のバッジの背景とタグの背景。success-soft・warning-soft・danger-soft と同じ使い方（淡い背景に、同じ名前の濃い色の文字） | `#0f2f38` <!-- req 14:0a9671a3.d63c --> <!-- req 14:0a9671a3.eeb3 --> <!-- req 14:0a9671a3.1233 --> <!-- req 14:0a9671a3.7e5f --> <!-- req 14:0a9671a3.0185 --> <!-- req 14:0a9671a3.2586 --> <!-- req 14:0a9671a3.f6ba --> |

- Info レベルの知らせ（トースト）は専用の色を持たず、surface の背景とアイコンだけで出す（13.2 節の表）。info-tag と info-tag-soft は Info のトーストに使わない <!-- req 14:f1ff8685.0c28 --> <!-- req 14:f1ff8685.3623 --> <!-- req 14:0a9671a3.1647 -->
- (b) overlay は surface の値から `color-mix` で作り、surface と別の値を持たない。14 章の定義が「surface を 70% の不透明度」で、surface の値を微調整したときに覆いの色も一緒に変わるようにするため

**余白のトークンの使い道**（14 章 5 節）：

| 14 章の名前 | 値（クラス） | 使い道 |
|---|---|---|
| space-1 | 4px（`*-1`） | 最小の間隔。アイコンと文字の間 <!-- req 14:5641f683.46ab --> <!-- req 14:5641f683.af6e --> |
| space-2 | 8px（`*-2`） | ボタンの内側の余白と、詰めて並べる要素の間 <!-- req 14:5fdab24c.dfe5 --> <!-- req 14:5fdab24c.03f0 --> |
| space-3 | 12px（`*-3`） | パネルの内側の標準の余白 <!-- req 14:bde61206.1ab3 --> |
| space-4 | 16px（`*-4`） | パネルどうしの間とカードどうしの間の標準の間隔 <!-- req 14:df7854f9.db8a --> <!-- req 14:df7854f9.5379 --> |
| space-5 | 20px（`*-5`） | ウィンドウの余白（中身の領域の外周） <!-- req 14:a4dec4da.4693 --> <!-- req 14:a4dec4da.6d27 --> |

**値の微調整**（14 章 1 節と 11 節）：

- 14 章の値は方針として決まった値で、Phase 0 から 1 のあいだに、alphaTab が実際に描いた譜面と並べて見ながら微調整してよい <!-- req 14:d1ab0d15.1a20 -->
- 微調整は、実装のときに OS のアクセシビリティの設定（コントラスト比を含む）を確かめながら行ってよい <!-- req 14:4214acb0.4a2c -->
- 直すのは値だけとし、トークンの名前と役割（何のためのトークンか）は変えない <!-- req 14:4214acb0.7c77 --> <!-- req 14:4214acb0.deff -->
- 本人が決めた値（14 章で「本人決定」と書いた値：4 節の文字の大きさと太さ、5 節の space-5、6 節の影、3.1 節の overlay）は変えない。微調整してよいのは、それ以外の値に限る <!-- req 14:4214acb0.4301 --> <!-- req 14:4214acb0.5213 -->
- alphaTab が描く譜面の部分の色は 14 章の範囲の外で、本節のトークンでは決めない。alphaTab の既定のテーマの設定と、[[../basic_design/13_design_decision_points.md#2]] A2 の確かめの結果と合わせて Phase 0 から 1 のあいだに決め、決めたら本節に書く <!-- req 14:2d490140.2bd4 --> <!-- req 14:2d490140.ebd2 -->

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
- `apps/desktop` は、PC 版（Phase 1）の Electron のラッパーとする。持つのは、基本設計 01 章 4.1 節のシェル側責務 7 点と、レンダラーの起動・DI の組み立てだけで、ほかの仕事を持たない（2026-09-27 本人決定）。7 点のうち①から④（ファイル I/O・オーディオセッション制御・ウィンドウ管理・自動更新チェック）は、AD-3 のアダプタの実装として main・preload・レンダラーで実装する（3.1 節）。⑤から⑦（OS 標準のダイアログの呼び出し・ネイティブのメニューの構築・クラッシュ検知）は、アダプタを通さずに `apps/desktop` で実装する。どのプロセスに置くかは 7.2 節。`packages/ui-desktop` の画面は、`apps/desktop` の DI の組み立ての中で組み立てる。画面の部品は置かない。 <!-- req 01:7da038e8.6755 --> <!-- req 01:7da038e8.edb8 --> <!-- req 01:7da038e8.3851 --> <!-- req 01:7da038e8.9bad --> <!-- req 01:7da038e8.3f52 --> <!-- req 01:7da038e8.1e0f --> <!-- req 01:7da038e8.c93d --> <!-- req 01:7da038e8.809e --> <!-- req 01:7da038e8.89a5 -->
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

| プロセス | 数 | 置き場所 | 持つもの <!-- req 01:41c05390.b0c1 --> |
|---|---|---|--- <!-- req 01:b0881589.03b0 --> |
| main | 1 | `apps/desktop/src/main` | アダプタの実際の仕事（3.1 節・3.2 節）、⑤から⑦（7.2 節）、IPC のハンドラ <!-- req 01:684cea3b.5bd9 --> |
| preload | ウィンドウごとに 1 | `apps/desktop/src/preload` | `contextBridge.exposeInMainWorld` で出す呼び口だけ（3.1 節） |
| レンダラー | 曲一覧ウィンドウに 1、編集ウィンドウ（曲）ごとに 1、印刷と PDF の生成のあいだだけ見えないウィンドウに 1（10.2 節） | 入口は `apps/desktop/src/renderer`、中身は Webコア | Webコアの一式（`packages/core`・`packages/ui-desktop`）。見えないウィンドウに載せるものは export-print.md（基本設計 07 章の回） |

曲一覧ウィンドウと編集ウィンドウの分け方は [[../basic_design/03_screens_ui_pc.md#2]] が正。

### 6.2 セキュリティの既定値

- `BrowserWindow` を作るときは、`webPreferences` に `contextIsolation: true` と `nodeIntegration: false` を必ず渡し、どのウィンドウでも変えない。 <!-- req 01:dc789b0c.d9e1 --> <!-- req 01:dc789b0c.6b09 -->
- 同じ所に `sandbox: true` も渡す。(b) Electron の既定値に頼らず明示する。作り直す前の実装で、既定値に黙って頼っていたのをレビューで直した経緯があるため（[[../basic_design/00_overview.md]] の 0.19）
- レンダラーの Webコアは Node.js の API に直接触れず、必ず preload が出した呼び口から IPC で main に頼む（3.1 節の 3 か所の実装）。 <!-- req 01:dc789b0c.a0fd -->
- main の IPC のハンドラは、受け取った引数を確かめてから使う。(b) レンダラーを信頼の境界の外として扱い、Webコアの不具合が main でのファイル操作に直接つながらないようにするため
- レンダラーの CSP は `script-src 'self'` のまま緩めない（要件 5.1 の完全オフライン。[[../basic_design/13_design_decision_points.md#3]] B30 は、CSP を緩めない前提で alphaTab の描き方を決めている）
- v1 のアプリは、ネットワーク I/O を行う実装を持たず、通信なしですべての機能が動く（要件 5.1、[[../basic_design/09_nonfunctional.md#4.1]]）。alphaTab 本体は npm の依存としてビルドでアプリに組み込み、SoundFont とフォントは 4.1 節のとおりアプリと一緒に配って、どちらも外部の CDN から読まない。更新の確認（3.2 節の `UpdateCheckAdapter`）は v1 では通信しない。将来通信する実装にしても、問い合わせの失敗は無視して起動・編集・再生を続け、更新の確認を起動・編集・再生に欠かせない経路に置かない。 <!-- req 09:bee9a72a.461c --> <!-- req 09:0f5a59a2.6756 --> <!-- req 09:0aaf1b07.f7fa --> <!-- req 09:0aaf1b07.a7c6 --> <!-- req 09:4acadeee.1bb4 -->
- 保存先が iCloud Drive と Google Drive のどちらの同期フォルダでも、同期は OS の同期クライアントが行い、アプリは同期の処理をしない（3.2 節の表の後の段落）。同期が止まっていても、アプリはそのフォルダをローカルのフォルダとして読み書きし続け、同期の状態を確かめたり待ったりしない。読み書きの作りは data-model-persistence.md（基本設計 06 章の回）に書く。 <!-- req 09:5c312fba.f7bd --> <!-- req 09:5c312fba.77c5 -->
- (b) ネットワーク I/O を持たないことは、import を機械で止め、動きを受け入れ確認で確かめる。`packages/core` と `packages/ui-desktop` は Node.js の組み込みモジュールの import をもう止めている（2.2 節）。`apps/desktop/src/**` にも、2.2 節の ESLint の `no-restricted-imports` で `node:http`・`node:https`・`node:net`・`node:tls`・`node:dgram`（`node:` の付かない名前も）と、`electron` の `net` の import を止める。レビューに頼らず止めるため。Phase 1 の受け入れ確認では、ネットワークアダプタを無効にした状態から起動し、曲の新規作成・編集・保存・再生・書き出し・印刷プレビューまでを一通り通す（手順は [[../basic_design/11_test_strategy.md#6.1]]、基本設計 11 章の回）。 <!-- req 09:a4831e54.592c --> <!-- req 09:a4831e54.9560 --> <!-- req 09:a4831e54.6d71 --> <!-- req 09:a4831e54.8566 --> <!-- req 09:a4831e54.40c0 --> <!-- req 09:a4831e54.94c1 -->

### 6.3 IPC の決まり

- レンダラーから main への頼みは、`ipcRenderer.invoke`／`ipcMain.handle` で行い、戻り値は `Promise` にする（3.3 節の非同期の決まり）。
- main からレンダラーへの知らせ（メニューで選ばれた項目、7.2 節の⑥）は、main が `webContents.send` で送り、preload が出す購読の関数でレンダラーが受ける。
- チャンネルの名前と、要求と応答の型は `packages/shared-types` に置く（3.1 節）。(b) 本書にはチャンネルの一覧を持たない。チャンネルは、それを使うアダプタや機能の受け先（ファイル I/O は data-model-persistence.md、ログとクラッシュは error-logging-foundation.md、ウィンドウとメニューは screens-navigation.md、印刷は export-print.md）で、シグネチャと一緒に書く。同じ事実を 2 か所に書かないため

## 7. シェル側の責務の一覧

[[../basic_design/01_architecture.md#4.1]] を受ける。7 点の定義と、7 点をシェル側の責務の全体とする理由は基本設計が正で、本節は 7 点を PC 版のどのプロセスのどこで実装するかを書く。

### 7.1 7 点の外へ足さない

- シェル側（`apps/desktop`・`apps/mobile`）の責務は、7.2 節の表の 7 点だけとする。要件 6 章の書き方どおり、シェル側だけを限定して並べ、Webコアの責務は一つずつ並べずに「7 点のほか全部」とする。 <!-- req 01:74ee13c1.1a95 --> <!-- req 01:5a45b866.737f --> <!-- req 01:5a45b866.fe7e -->
- 詳細設計でも、シェル側の責務はこの 7 点に限って扱い、7 点の外へ足さない。7 点のどれにも当たらない機能は、新しいものも前からあるものも、Webコア（`packages/core`・`packages/ui-desktop`）に置く。ただし、基本設計 01 章 AD-3 の形で足す新しいアダプタ（3.1 節の 6 つの将来の機能）の実装は、この決まりの例外とし、足すときに要件 6 章のシェル側の列挙から直して 7.2 節の表に行を足す（2026-10-10 本人決定）。 <!-- req 01:d2029e53.bf8e --> <!-- req 01:45dce2c8.0278 --> <!-- req 01:2068a9a4.640d --> <!-- req 01:56324cb4.d322 --> <!-- req 01:71f70a6f.76e5 --> <!-- req 01:aafb2517.2a2f -->
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

- OS 標準のファイル選択のダイアログをシェル側で開くのは、次の 3 つだけとする。(a) 保存先フォルダの指定（[[../basic_design/06_file_io_persistence.md#2]] の「カスタムフォルダを選択」）。(b) 書き出し画面の保存先フォルダの欄の「参照…」で開くフォルダ選択（[[../basic_design/07_export_print.md#2]]）。(c) ミラー先のフォルダの指定（[[../basic_design/06_file_io_persistence.md#2]] の「ミラー（バックアップ）先」、設定ダイアログの 10 項目目。[[data-model-persistence.md#11]]）。 <!-- req 01:3ae7674a.6b1c --> 3 つとも基本設計 01 章 4.1 節の「⑤のうちファイル選択ダイアログ」に挙げてある。 <!-- req 01:ed9d890f.6ebc --> <!-- req 01:3ae7674a.371c --> <!-- req 01:3ae7674a.36ae -->
- 3 つともフォルダを選ぶダイアログにする（Electron の `dialog.showOpenDialog` に `properties: ['openDirectory']` を渡す）。書き出しのファイル名は書き出し画面の欄で決め、OS のダイアログでは選ばせない。 <!-- req 01:3ae7674a.fb4e -->
- main がダイアログを開き、選ばれたフォルダのパスの文字列だけを IPC でレンダラーへ返す。Webコアはパスの文字列を受け取るだけで、ダイアログのことを知らない。⑥⑦と同じく、アダプタを通さない。チャンネルと戻り値の形は、使う側の受け先（data-model-persistence.md、export-print.md）で書く。 <!-- req 01:979ab8f7.6a97 --> <!-- req 01:979ab8f7.04c6 --> <!-- req 01:979ab8f7.1621 --> <!-- req 01:ff571dfd.16b3 -->

## 8. 依存ライブラリとライセンスの確認、ビルドと配布

[[../basic_design/01_architecture.md#5]] を受ける。ライブラリの表とライセンスの確認で見る点は基本設計が正で、本節はそれぞれを入れる場所、確認の手順、出荷の条件の確かめ方、配布用のパッケージの作り方を書く。

### 8.1 依存ライブラリ

| ライブラリ | 使い方 | 入れる所 |
|---|---|---|
| alphaTab（`@coderline/alphatab` の fork、4.1 節） | 譜面の描画（`packages/core/src/rendering`）、編集用のデータモデル（alphaTab の `Score` を `packages/core/src/domain` のラッパーで包む）、合奏再生のシンセ（AlphaSynth、`packages/core/src/playback`）の 3 つに使う。ライセンスは Phase 0 でライセンスファイルを直接開いて確かめる（8.2 節） | `packages/core` の依存（5.2 節） <!-- req 01:3c94e34f.8816 --> <!-- req 01:3c94e34f.4ea8 --> <!-- req 01:3c94e34f.9993 --> <!-- req 01:3c94e34f.6252 --> |
| 同梱の SoundFont | 楽器の音源。alphaTab（fork）のパッケージの `dist/soundfont` を配る（4.1 節）。Phase 0 でライセンスを最終確認し（8.2 節）、確認の結果、使えない条件が見つかったときは代わりの SoundFont を用意する。代わりを選ぶときも 8.2 節の手順を通す | アプリと一緒に配るアセット（4.1 節） <!-- req 01:a3e163a1.7ddf --> <!-- req 01:a3e163a1.c25f --> |
| Electron | PC 版のシェルの土台（`apps/desktop`） | `apps/desktop` の開発用の依存（5.2 節） <!-- req 01:91d4c296.16bc --> |
| React | UI のフレームワーク。import してよいのは `packages/ui-desktop` だけ（4.1 節） | `packages/ui-desktop` の依存（5.2 節） <!-- req 01:5f6fab94.8e39 --> |
| 専用の PDF ライブラリ | 入れない。PDF は Electron の `webContents.printToPDF()` で作り（export-print.md、基本設計 07 章の回）、alphaTex の書き出しは alphaTab の API で行う。[[../basic_design/13_design_decision_points.md#3]] B6 のフォールバックの条件に当たったときだけ、足すかを検討する。足すときは 8.2 節の手順を先に通す | なし <!-- req 01:86ecfba1.9a08 --> |

版は各パッケージの `package.json` が正で、本節には書かない。

### 8.2 ライセンスの確認の手順

- 確認するのは、第三者のライブラリ（`package.json` の `dependencies` と `devDependencies`）とアセット（SoundFont とフォント）を新しく採用するときと、採用済みのものの版を上げるときの両方とする。初回だけで済ませない。(b) 確認は、`package.json` の依存を足す変更、版を変える変更、アセットを差し替える変更と同じ PR の中で行う。版が変わる時点に結びつけて、「都度」を取りこぼさないため。 <!-- req 01:b39bcc96.c540 --> <!-- req 01:bcb784ce.7515 --> <!-- req 01:bcb784ce.243b -->
- 配布元のライセンスファイルそのものを開いて条項を読む。要約・孫引き（パッケージの説明文、ほかのサイトのまとめ）で代えない。 <!-- req 01:a1b884bd.3584 -->
- 読んで確かめるのは、基本設計の 4 つとする。(1) 商用利用と商用ソフトへの組み込みが許されるか。(2) 表示義務の有無で、著作権表示の表示義務と、ライセンス全文の同梱の義務の 2 つを分けて見る。(3) 再配布の条件。(4) 自社のコードの開示義務の有無。 <!-- req 01:53da7cda.e291 --> <!-- req 01:53da7cda.cdb9 --> <!-- req 01:53da7cda.4719 --> <!-- req 01:53da7cda.2aaf --> <!-- req 01:53da7cda.13cf -->
- 確かめた条項は守る。守れない条項のあるものは採用しない。 <!-- req 01:b39bcc96.3fce -->
- (2) の表示義務のあるものは、クレジットの画面に載せる。v1 はクレジットの画面を設ける。(b) 基本設計 03 章 2 節で、ライセンスの画面が曲一覧ウィンドウから開くダイアログの 1 つになっているため。画面の中身は [[../basic_design/10_extensibility_future.md#8]] のとおり、ライブラリ名・ライセンスの種類・条項へのリンクの配列のデータとして持つ。ダイアログの作りは screens-navigation.md（基本設計 03 章の回）に書く。 <!-- req 01:aa5786e5.bba0 --> <!-- req 01:f58d9b12.e5ec -->
- この手順は、今使っているものだけでなく、これから採用するライブラリとアセットにも同じように当てはめる。 <!-- req 01:d8637313.429a --> <!-- req 01:d8637313.bed2 -->
- alphaTab と同梱の SoundFont は、どちらも Phase 0 でライセンスファイルを直接開いて確定させる（要件書リスク#2、Phase 0 の検証項目#1）。(b) 今の版の npm パッケージで開くのは、alphaTab は直下の `LICENSE`（MPL-2.0 の全文）と、組み込んだ部品のライセンスを書いた `LICENSE.header`、SoundFont は `dist/soundfont/LICENSE` と、音源の出どころを書いた `dist/soundfont/README.md` とする。`LICENSE` の中に「See LICENSE.header for further licenses of integrated submodules.」とあり、SoundFont は出どころが別に書かれているため。 <!-- req 01:729689f3.1549 -->
- alphaTab の fork（4.1 節）は、fork の直下の `LICENSE`（MPL-2.0 の全文）と `LICENSE.header` を本家のまま残す。本家のソースのファイルに著作権の表示があれば、それも消さず書き換えない。Phase 0 の確かめでは、本家の 2 つのファイルに加えて、fork の `LICENSE` と `LICENSE.header` が本家と同じであることと、fork の足したものの一覧（4.1 節）に直したファイルが全部載っていることを確かめる。
- fork を含むアプリを配るときは、fork で直したファイルのソースを公開し、`LICENSE` と著作権の表示を残す（MPL-2.0 の義務、基本設計 01 章 5 節）。アプリのコード（`packages/*` と `apps/*`）は公開しない。公開する場所は、4.1 節の fork の公開のリポジトリとする（2026-10-12 本人決定、honnin-queue 83 番）。 <!-- req 01:3c94e34f.de48 --> <!-- req 01:3c94e34f.8593 --> <!-- req 01:3c94e34f.4528 -->

### 8.3 出荷の条件

出荷してよいかは、「ライセンスを確認した」と書いてあることでは決めず、次の 2 つが実際に揃っていることで決める。 <!-- req 01:dd1da3b7.b7f3 -->

1. 8.2 節の (2) の表示義務のあるもの（著作権表示とライセンス全文）が、配るパッケージに入っていること。 <!-- req 01:0df1ff64.7489 -->
2. 配るパッケージが、8.2 節の (3) 再配布の条件と (4) 自社のコードの開示義務のどちらにも反していないこと。 <!-- req 01:0df1ff64.222d --> <!-- req 01:0df1ff64.2750 -->

- (b) 1 つ目は機械で確かめる。配布用のパッケージを作った後に、表示義務のあるファイルがパッケージの中に在るかを確かめるスクリプトを `apps/desktop/scripts` に置き、無ければ失敗させる。確かめるファイルは、8.2 節で表示義務があると分かったものとする。「確認した」の記述ではなく、ファイルが在ることで決めるため。
- (b) 2 つ目は、出荷の前に、8.2 節で読んだ条項と配るパッケージの中身を人が突き合わせて確かめる。条項の読み方は機械では決められないため。
- alphaTab と同梱の SoundFont の分は、Phase 0 の確認（8.2 節の最後）の結果で、この 2 つに当てはめる（要件 9 章の Phase 0 の検証項目#1）。
- (b) alphaTab の fork の分は、1 つ目の確かめのスクリプトが見るファイルに fork の `LICENSE` を入れ、2 つ目の人の確かめに「fork で直したファイルのソースを公開しているか」を入れる。fork を配ると MPL-2.0 の再配布の条件が掛かり、配るたびに満たしているかを確かめる所が要るため。

### 8.4 ビルドと配布

- 基本設計の「ビルドツール」は、役割で 2 つの道具に分ける。(b) 組み立て（main・preload・レンダラーの 3 つを組む）は、Vite を土台にした electron-vite（4.1 節。`apps/desktop/package.json` の `build` が `electron-vite build`）。配布用のパッケージ作り（パッケージング、インストーラの生成、成果物の置き場所）は Electron Builder。基本設計 AD-4 の「Vite」は組み立てを、5 節の「Electron Builder」は配布用のパッケージ作りを指すと読む。 <!-- req 01:d2970505.221b -->
- Electron Builder は、今の `apps/desktop/package.json` の依存にはまだ無い。`apps/desktop` の開発用の依存に足し、足すときは 8.2 節の手順を通す。設定ファイルの名前と項目の名前は、足す版の公式の説明で確かめてから本節に書く。
- ビルドと配布の手順は、アプリのコードに埋め込まない。Electron Builder の設定ファイル 1 つと、`apps/desktop/package.json` の `scripts` だけで完結させる。 <!-- req 01:d2970505.8660 --> <!-- req 01:d2970505.f663 -->
- パッケージング、インストーラの生成、成果物の置き場所は、すべてその設定ファイルに書く。 <!-- req 01:2f286bde.f4fd -->
- アンインストールで消さないもの（主ストレージの既定の場所と、ローカル既定パスの木、[[data-model-persistence.md#20]]）を消す対象から外す設定も、その設定ファイルに書く。項目の名前は、Electron Builder を足すときに足す版の公式の説明で確かめてから本節に書く（今は確かめていない）。
- Webコア（`packages/*`）とラッパーのソース（`apps/desktop/src`）から、ビルドの構成（electron-vite と Electron Builder の設定ファイルとパッケージ）を import しない。(b) 2.2 節の ESLint の `no-restricted-imports` に、`packages/**` と `apps/desktop/src/**` からの `electron-vite` と Electron Builder のパッケージの import の禁止を足す。レビューに頼らず止めるため。 <!-- req 01:2f286bde.d17b -->
- 後から足しうる工程（コード署名と、自動更新の配信元の指定）は、設定ファイルに項目を足すだけで入れられるようにしておく。v1 はどちらも書かない（署名しない判断は [[../basic_design/10_extensibility_future.md#1]]、自動更新の確認は 3.2 節の `UpdateCheckAdapter` で、v1 は通信しない）。署名を入れると決めても、Webコアのコードとパッケージの構成（5 節）は変えない。 <!-- req 01:2f286bde.f9b8 -->

### 8.5 対応 OS

[[../basic_design/09_nonfunctional.md#4]] と [[../basic_design/09_nonfunctional.md#4.2]] を受ける。規則と、いまの当てはめの値は基本設計 09 章 4.2 節の表が正で、本節は配るものにどう当てはめるかを書く。

| 項目 | 決まり |
|---|---|
| 規則 | 対応する OS の版は、固定の値ではなく規則として持つ。リリースの時点で OS のベンダーが出している最新の版から、1〜2 世代前までを対象とする。Windows 版と iOS 版（Phase 3）で同じ規則を使う <!-- req 09:06f1d77d.2b8a --> <!-- req 09:cb3cb11c.d15b --> <!-- req 09:cb3cb11c.3df3 --> <!-- req 09:55ed4adb.b4fd --> <!-- req 09:50a529c1.0566 --> |
| いまの当てはめ | 2026 年の時点で、Windows は Windows 10 以降、iOS は iOS 17 以降。これは規則を当てはめた結果の値で、規則そのものではない。値を書き換えるときは、基本設計 09 章 4.2 節の「いまの当てはめ」の行だけを書き換える <!-- req 09:55ed4adb.d4a6 --> <!-- req 09:3b69ac76.236b --> <!-- req 09:3b69ac76.942f --> <!-- req 09:437e29dd.0bdd --> <!-- req 09:437e29dd.26ad --> |
| 実行環境との関係 | Electron（PC 版）と Expo SDK（iPhone 版）が動かせる OS の範囲と、規則が食い違うときは、狭いほうを採る。今の Electron 44.2.0 は、npm のパッケージの README に「Windows (Windows 10 and up)」とあり、規則を当てはめた Windows 10 以降と同じ範囲なので、PC 版は Windows 10 以降とする <!-- req 09:55ed4adb.0d3b --> <!-- req 09:82c95c71.ceaf --> <!-- req 09:50a529c1.11de --> |
| 当てはめ直す時期 | 各 Phase の着手時と、リリースを切るとき。(b) Electron の版を上げたときも、その版の README で Windows の範囲を確かめ直す。8.2 節のライセンスの確認と同じく、版が変わる時点に結びつけて取りこぼさないため。iPhone 版の値は、Phase 3 の着手時に当てはめ直して決める <!-- req 09:50a529c1.86f3 --> |
| 高解像度のディスプレイ | Electron の標準の動きに任せ、アプリの側で特別な対応をしない（要件どおり） <!-- req 09:3cd38124.46c9 --> |

## 9. alphaTab に委ねる範囲

[[../basic_design/01_architecture.md#5]] を受ける。委ねる範囲と自作する範囲の線は基本設計が正で、本節はそれぞれを alphaTab の何に渡すかと、自作する所を書く。alphaTab の名前は、1.8.4 の型定義（`dist/alphaTab.d.ts`）で確かめた。

### 9.1 委ねるもの

| 項目 | alphaTab に委ねる形 | 中身の受け先 |
|---|---|---|
| 描画 | 譜面の描画は alphaTab のレイアウトエンジンに委ね、符頭・符幹・符尾（連桁）をどう描くかの規則を自前で持たない。alphaTab の描画を呼ぶのは `packages/core/src/rendering` の窓口だけ（2.1 節） | 描き直しの頼み方は 11 節 <!-- req 01:18a9613c.7360 --> <!-- req 01:18a9613c.c2e1 --> |
| 多弦チューニング | 基本設計 02 章の `stringPitches` を、alphaTab の弦のチューニング（`Staff.stringTuning`、`Tuning` の `tunings`）へ渡す | data-model-persistence.md（基本設計 02 章の回） <!-- req 01:36d55d38.9cb3 --> |
| 奏法記号 | alphaTab の属性として持つ。Note 単位のものは `Note` の属性に、タッピング・スラップ・ポップ・ブラシは `Beat` の `tap`・`slap`・`pop`・`brushType` に持つ | editing-core.md（基本設計 04 章の回） <!-- req 01:fbe6240e.c219 --> <!-- req 01:fbe6240e.8665 --> <!-- req 01:fbe6240e.af70 --> <!-- req 01:fbe6240e.cc0f --> <!-- req 01:fbe6240e.ef05 --> <!-- req 01:fbe6240e.ebd0 --> |
| 拍子とテンポの変更 | 小節の側（alphaTab の `MasterBar`）の値として持つ。拍子は `timeSignatureNumerator` と `timeSignatureDenominator`、テンポの変更は `tempoAutomations` | data-model-persistence.md（基本設計 02 章の回）、editing-core.md（基本設計 04 章の回） <!-- req 01:d15e4358.597f --> <!-- req 01:d15e4358.48c0 --> |
| 合奏再生 | AlphaSynth に委ね、自前の合奏再生のしくみを持たない | playback-integration.md（基本設計 05 章の回） <!-- req 01:aa66c600.3b7a --> |
| タイ | 音価の連結と、再生のときに 1 つの音にまとめることは、alphaTab の記譜の要素（`Note` の `isTieDestination`）として扱い、自前の連結の規則を持たない | editing-core.md（基本設計 04 章の回） <!-- req 01:2dcb1c03.6d64 --> <!-- req 01:2dcb1c03.e667 --> |
| 再生カーソル | 再生中は、今の再生位置を示すカーソルを譜面に出す。出すのは alphaTab の再生カーソル（設定の `player.enableCursor`）に委ね、位置の計算を自前で持たない。スクロールの追従は、alphaTab の `playerPositionChanged` を購読して行う | playback-integration.md（基本設計 05 章の回） <!-- req 01:207dcd93.75fa --> <!-- req 01:207dcd93.af80 --> <!-- req 01:207dcd93.f445 --> |

### 9.2 カポ

- カポの位置は、alphaTab の標準機能の `Staff.capo` に持つ。基本設計 02 章の `capoFret` を変えたときは、`Staff.capo` にもその値を入れる。 <!-- req 01:17b05df6.0a4a --> <!-- req 01:e9a0918b.f0f2 -->
- 実音への読み替え（開放弦の音高＋`capoFret`＋記譜のフレット）は、alphaTab の標準機能に委ねず自作する。 <!-- req 01:17b05df6.49ab -->
- 読み替えは 1 つの関数にまとめ、[[../basic_design/05_playback_audio.md#10]] の変換式をそこだけに書く。関数の名前とシグネチャは playback-integration.md（基本設計 05 章の回）に書く。 <!-- req 01:17b05df6.7c5c --> <!-- req 01:e9a0918b.e92b -->
- MIDI 書き出しとコード推定（[[../basic_design/04_editing_core.md#7]]）の 2 か所は、その関数を呼び、自分の中で加算を書かない。 <!-- req 01:e9a0918b.0925 --> <!-- req 01:e9a0918b.dacf -->
- 再生は、その関数を呼ばず、alphaTab が `Staff.capo` を足して出す音の高さに任せる。そこと関数の値が同じになることを単体テストで見張る（[[../basic_design/13_design_decision_points.md#2]] A14 の (b)、2026-10-10 本人決定。テストの組み方は playback-integration.md の 9.2 節）。 <!-- req 01:e9a0918b.e774 --> <!-- req 01:e9a0918b.40c5 -->
- (b) 関数の置き場所は `packages/core/src/domain` とする。呼ぶ 2 か所（`packages/core/src/export`・`packages/core/src/editing`）と、再生と比べる単体テスト（`packages/core/src/playback` の側）はどれも L2 で、2.2 節の表では L2 どうしは import できないので、共に import できる L3 に置く。
- alphaTab のシンセが `Staff.capo` を再生の音の高さに足すかは、Phase 0 の実機で [[../basic_design/13_design_decision_points.md#2]] A14 として確かめる。足さないと分かったときの再生への渡し方は、playback-integration.md の 9.2 節に書く。

### 9.3 自作する範囲 <!-- req 01:99fa2738.9142 --> <!-- req 01:99fa2738.783c --> <!-- req 01:99fa2738.e23d -->

- 自作するのは、エディタの UI（`packages/ui-desktop` と `packages/core/src/ui`）、アプリ独自のデータモデル（`packages/core/src/domain` の Score のラッパーとサイドカーのメタデータ）、各ラッパー層の統合部分に限る。(b) 「各ラッパー層」は、alphaTab を包む窓口（`packages/core/src/rendering` と、再生の窓口）と、プラットフォームを包むアダプタ（3 節）の両方と読む。 <!-- req 01:cc6799d4.3cf2 --> <!-- req 01:cc6799d4.b037 --> <!-- req 01:cc6799d4.e3c1 -->
- 9.1 節の表の範囲（9.2 節のカポの読み替えと、要件 9 章が自前で作ると定めている MIDI 書き出し〈export-print.md、基本設計 07 章の回〉は除く）について、下位の設計（詳細設計と実装）で自前の描画の規則と解釈の規則を新しく起こさない。9.2 節のカポの位置の保持（`Staff.capo` に持つこと）も、この範囲に入れる。
- alphaTab の標準機能で足りないと分かったときは、実装のコードを先に書かず、まず [[../basic_design/13_design_decision_points.md]] に分岐点として起こし、そこで方針を決めてから実装に進む。 <!-- req 01:417b4b86.b21d -->

## 10. 起動・メモリ・描画の方針

[[../basic_design/01_architecture.md#6]] を受ける。目標値は基本設計 09 章が正で、本節はアーキテクチャの側で決めることだけを書く。

### 10.1 起動

- alphaTab（描画）と AlphaSynth（再生）は、アプリの起動の手順の中で初期化しない。曲を開いた編集ウィンドウのレンダラーで初期化する。曲一覧ウィンドウでは初期化しない。 <!-- req 01:55d78e78.40a5 --> <!-- req 01:55d78e78.a485 --> <!-- req 09:7b9adfdb.8f19 -->
- 音源の読み込みと、読み終わるまでの再生ボタンの状態は、playback-integration.md（基本設計 05 章の回、[[../basic_design/05_playback_audio.md#9]]）に書く。
- 編集ウィンドウでの alphaTab と AlphaSynth の初期化は非同期に行う。曲一覧ウィンドウは別のレンダラーなので、この初期化は曲一覧の表示と操作を止めない。 <!-- req 09:7b9adfdb.84c3 --> <!-- req 09:7b9adfdb.4f5e -->
- 曲一覧ウィンドウは、曲一覧の索引（`index.json`）だけを読んで一覧を出し、曲のファイルを 1 つずつ開いて読まない。索引の形と更新は data-model-persistence.md（基本設計 06 章の回、[[../basic_design/06_file_io_persistence.md#10]]）に書く。曲一覧ウィンドウでは、alphaTab と AlphaSynth の重いもの（SoundFont のデータを含む）を読み込まず、メモリに載せない。 <!-- req 09:7b9adfdb.bdd4 --> <!-- req 09:d21c7b17.3c0f -->

### 10.2 メモリ（レンダラーの分け方）

- 編集ウィンドウ（曲）ごとにレンダラーのプロセスを分ける。曲を開くたびに `BrowserWindow` を 1 つ作り、同じ曲のウィンドウがもうあれば新しく作らない（`WindowAdapter`、3.2 節）。 <!-- req 01:9147a9af.9b17 --> <!-- req 09:0cee684c.a446 -->
- 1 つの曲のレンダラーが落ちても、読み込み直すのはそのウィンドウのレンダラーだけにする（7.2 節の⑦）。 <!-- req 01:9147a9af.5bea -->
- 09 章のメモリの目標値は、1 ウィンドウあたりの値として扱う（[[../basic_design/09_nonfunctional.md#3]]）。 <!-- req 01:9147a9af.02ae --> <!-- req 09:eb60d8c2.ddd0 -->
- 印刷と PDF の生成のあいだだけ、画面に出さない `BrowserWindow`（`show: false`）を 1 つ作る。作る時機と閉じる時機は、[[../basic_design/13_design_decision_points.md#3]] B28 のキャッシュ（印刷プレビューで作ったものを、対象の曲とレイアウトの設定が変わっていなければ直後の印刷で使い回す）に合わせる。作りの中身（クラス、曲のデータの渡し方、このウィンドウが落ちたときの扱い）は export-print.md（基本設計 07 章の回）に書く。 <!-- req 01:9147a9af.2fa2 --> <!-- req 01:9147a9af.6f5e -->
- 曲一覧ウィンドウ（[[../basic_design/03_screens_ui_pc.md#2]]、6.1 節）と、編集ウィンドウごとのレンダラーと、印刷と PDF の見えないウィンドウのほかに、子プロセスと `BrowserWindow` を増やさない。 <!-- req 01:9147a9af.24d9 -->
- 09 章 3 節の 3 つの目標値（アイドル時 150MB、通常の編集 400MB、大曲〈2048 小節〉の編集 600MB）は、どれもウィンドウ 1 つあたりで測る。アイドル時は、曲を開いていない曲一覧ウィンドウ 1 枚の状態を指す。複数のウィンドウを開くと、メモリはウィンドウの数に比例して増える。値は基本設計 09 章 3 節が正。 <!-- req 09:d21c7b17.07b0 --> <!-- req 09:d21c7b17.ee95 --> <!-- req 09:0cee684c.22f2 --> <!-- req 09:eb60d8c2.ee34 --> <!-- req 09:eb60d8c2.a3cb -->
- 編集ウィンドウには、1 曲分の Score モデル、描画のキャッシュ、SoundFont の 3 つを常駐させる。試しの音用の 2 つ目の AlphaSynth（[[playback-integration.md#8]] の 8.2 節、基本設計 13 章 A15）を持つときは、そのシンセと、それが読んだ 2 つ目の SoundFont も常駐させる。400MB は、これらを全部載せた状態で測る。SoundFont は曲を開いた時点で読み込み、ウィンドウを閉じるまで持つ。読み込みの手順は playback-integration.md（基本設計 05 章の回）に書く。 <!-- req 09:0cee684c.ae56 --> <!-- req 09:0cee684c.ef2f --> <!-- req 09:4148ac6c.f55a -->
- 印刷と PDF の見えないウィンドウのメモリは、編集ウィンドウの目標値に含めず、別に数える。その目標値は Phase 0 から 1 の実測の後に決め、それまでは置かない（2026-09-27 本人決定）。 <!-- req 09:d21c7b17.0b6a --> <!-- req 09:d21c7b17.4634 -->
- 大曲の編集時のメモリは、Phase 0 から 1 で実測する（10.6 節）。600MB を超えたときの対策は実測の後に決める。(b) 今は候補を 1 つだけ書く。開いていない小節の Beat と Note の詳しいデータを、使うときに読み込む（基本設計 09 章 3 節の例）。何が 600MB を押し上げるか（Score・描画のキャッシュ・SoundFont のどれか）は、測るまで分からないため。

### 10.3 描画

- 100 小節を超える曲でも速さを保つため、フォーカス表示で描く小節を絞り、全部の小節を一度に DOM に描く仕組みを自前で作らない。 <!-- req 01:1bc94906.a335 -->
- alphaTab の遅延描画（画面の外の小節を後で描くしくみ）は使わない。alphaTab の設定の `core.enableLazyLoading`（既定は `true`）に `false` を渡す（[[../basic_design/13_design_decision_points.md#3]] B30）。渡すのは、4.1 節の `core.engine` と同じ `packages/core/src/rendering` の 1 か所だけ。 <!-- req 01:1bc94906.b94e -->
- 大曲の全体表示の速さは、[[../basic_design/13_design_decision_points.md#2]] A9 で実機を使って確かめる。 <!-- req 01:1bc94906.1559 -->
- 30fps のための描き方は 12 節。

### 10.4 入力の反応と再生の開始

[[../basic_design/09_nonfunctional.md#1]] の入力の反応（100ms）と再生の開始（200ms）を受ける。

- 音符の入力に対して、画面への反映とシンセへの反映（ノートオン）を分けて処理する。上限は画面と音で片方ずつ 100ms とし、内訳（画面に何 ms、音に何 ms）は決めない。 <!-- req 09:4148ac6c.a5a2 --> <!-- req 09:4148ac6c.cc9b -->
- 画面への反映を先に行う。同じ入力のイベントの処理の中で AlphaSynth にノートオンを出し、入力から発音までを 100ms の内側に収める。ノートオンの出し方は playback-integration.md（基本設計 05 章の回、[[../basic_design/05_playback_audio.md#3.2]]）に書く。 <!-- req 09:4148ac6c.029e --> <!-- req 09:4148ac6c.9eb6 --> <!-- req 09:4148ac6c.3337 -->
- 再生中は、ノートオンを試しの音用の 2 つ目の AlphaSynth に出し、曲を止めずに鳴らす（[[playback-integration.md#8]] の 8.2 節の `PreviewSynth`。止めているときも同じシンセで鳴らす）。 <!-- req 09:4148ac6c.c39a -->
- コマンドの実行はファイルの I/O を伴わない（[[editing-core.md#2]] の 2.1 節）。自動保存はコマンドの実行とは別に非同期で行い、数秒の間隔でまとめて保存する（デバウンス）。秒数と保存の手順は data-model-persistence.md（基本設計 06 章の回、[[../basic_design/06_file_io_persistence.md#5]]）に書く。 <!-- req 09:4148ac6c.123f --> <!-- req 09:9039fe30.4f75 -->
- 再生ボタンを押してから音が出るまでを 200ms 以内にする。音源の読み込みの時機と、読み終わるまで再生ボタンを押せないことは playback-integration.md（基本設計 05 章の回、[[../basic_design/05_playback_audio.md#9]]）に書く。 <!-- req 09:21da7cff.757d -->

### 10.5 自動保存のシリアライズの重さ

- 自動保存で曲全体を毎回シリアライズせず、変更のあった小節（Bar）やパート（Part）だけを差分でシリアライズする方式を検討する。 <!-- req 09:25f6e257.48d9 --> <!-- req 09:25f6e257.d67b -->
- (b) 差分にするかは、実装のときに JSON のシリアライズの時間を 2048 小節の大曲のデータ（10.6 節）で測ってから決める（[[../basic_design/13_design_decision_points.md#2]] A6）。曲全体の 1 回のシリアライズが 100ms 未満なら、簡潔さを優先して差分にしない。シリアライズは入力と同じレンダラーで動くので、入力の反応の上限（10.4 節）を線にするため。 <!-- req 09:25f6e257.687d --> <!-- req 09:25f6e257.fb6b -->

### 10.6 負荷テスト

- Phase 1 の後半に、2048 小節・全部の奏法記号を含む開発用サンプルデータ（`packages/core/src/testing`、5.1 節）を、想定利用の 4 パートと上限の 8 パートの 2 つ用意する。09 章 1 節と 3 節の目標値は、4 パートのデータで満たすことを実測で確かめる。8 パートのデータでは落ちずに動くことを確かめて測った値を記録し、目標値を超えても不合格にしない（[[../basic_design/09_nonfunctional.md#2]]、2026-09-28 本人決定）。 <!-- req 09:d75ce8cf.5088 --> <!-- req 09:d75ce8cf.5d4d --> <!-- req 09:d75ce8cf.bbfb --> <!-- req 09:d75ce8cf.5b17 --> <!-- req 09:d75ce8cf.64d8 --> <!-- req 09:f4718ad1.0b1d --> <!-- req 09:f4718ad1.e6fe --> <!-- req 09:f4718ad1.6852 --> <!-- req 09:f4718ad1.c94f --> <!-- req 09:f4718ad1.f7ff -->
- 同じ負荷テストで、[[../basic_design/13_design_decision_points.md#2]] の A6（シリアライズ）・A8（描き直しと 100ms）・A9（全体スクロールとズーム中の fps）を確かめる。手順は基本設計 11 章 8 節で、11 章の回に書く。 <!-- req 09:1d2c825a.8aa8 --> <!-- req 09:1d2c825a.7e68 --> <!-- req 09:1d2c825a.5dab -->
- 負荷テストより前に、Phase 0 で SoundFont を選ぶときに、試しの音用の 2 つ目の AlphaSynth に同じ SoundFont を読ませたときのメモリの増えを測る（基本設計 13 章 A15 の条件 ③）。通常の編集の 400MB にゆとりを持って収まらなければ、[[playback-integration.md#8]] の 8.2 節の `PreviewSynth` を 'song-boundary' の形にする（playback-integration.md 12 節）。(b) ゆとりの幅は、SoundFont を選んで 1 つ目の常駐の大きさが分かってから、測った値と並べて本人が決める。今の時点では、決める材料（1 つ目の大きさ）が無いため。

## 11. alphaTab の検証事項

[[../basic_design/01_architecture.md#7]] を受ける。

- 編集は alphaTab の専用の API を使わず、アプリの側で Score のオブジェクトを直接変えてから、描き直しを頼む方式とする（[[../basic_design/13_design_decision_points.md#2]] A1）。描き直しを頼むのは `CommandHistory`（[[editing-core.md#2]]）。 <!-- req 01:9e38ea0c.124a -->
- Score のどのプロパティを変えれば安全かの切り分けは、[[../basic_design/13_design_decision_points.md#2]] A1 で、プロパティごとには分けず、コマンドの実行と取り消しのたびに `CommandHistory` が対象のトラックだけを一律に描き直す方式に決まっている。この決定と理由は editing-core.md（基本設計 04 章の回）に書く。
- 描画エンジンは SVG とする（A2。設定は 4.1 節の `core.engine`）。 <!-- req 01:47c71afa.1e6f -->
- パートが 0 の曲を alphaTab がそのまま描けるかは、まだ確かめていない。描けない前提で、パートが 0 のときはアプリの側で描画を呼ばず、案内を出す（案内の中身は [[../basic_design/03_screens_ui_pc.md#10]]、screens-navigation.md に書く）。(b) 描画を呼ぶかどうかの判断は `packages/core/src/rendering` の窓口で行う。alphaTab を呼ぶ所がそこだけだから（2.1 節）。 <!-- req 01:9eabe9c3.bcd0 -->
- 描けるかどうかは実装の前に確かめ、確かめた結果で本節を直す。 <!-- req 01:9eabe9c3.7630 -->

## 12. 描画の窓口

[[../basic_design/09_nonfunctional.md#1]] の描画 30fps と、[[../basic_design/09_nonfunctional.md#2]] の大曲の描き方を受ける。目標値は基本設計 09 章が正で、本節は alphaTab の描画を呼ぶ窓口の形と、30fps のための描き方を書く。

### 12.1 窓口のクラス

- alphaTab の描画を呼ぶのは、`packages/core/src/rendering` の `ScoreRenderHost` だけとする（2.1 節）。ほかのモジュールは alphaTab の `AlphaTabApi` に直接触れない。`ScoreRenderHost` は `AlphaTabApi` を 1 つ持ち、初期化・曲の読み込み・描き直し・破棄の窓口になる。
- 形は次のとおり。表示モードの種類と切り替えの決まりは view-modes.md、ズームとエラーのハイライトのメソッドは、基本設計 03 章と 08 章の回に本節へ足す。

```ts
// packages/core/src/rendering/ScoreRenderHost.ts
import type { model } from '@coderline/alphatab';

export interface RenderHostOptions {
  engine: 'svg';                    // 4.1 節
  fontAssetsBasePath: string;       // 4.1 節のフォントの置き場所
  soundFontAssetsBasePath: string;  // 4.1 節の SoundFont の置き場所
}
export type RenderHostEvent = 'renderStarted' | 'renderFinished' | 'renderError';

/** 描く範囲。フォーカスビューのときだけ focusRange を渡す（12.2 節）。 */
export interface ViewModeRenderRequest {
  mode: 'focus' | 'scroll' | 'score';
  focusTrackIndex: number;
  focusRange?: { startBarIndex: number; barCount: number };  // startBarIndex は 0 始まり
}

export class ScoreRenderHost {
  initialize(container: HTMLElement, options: RenderHostOptions): void;
  loadScore(score: model.Score): void;
  render(trackIndices?: number[]): void;   // 描き直しを頼むのは CommandHistory（11 節）
  applyViewMode(request: ViewModeRenderRequest): void;
  applyZoom(scale: number): void;          // 1 が 100%。display.scale に入れて描き直す（view-modes.md 1.3 節）
  on(event: RenderHostEvent, listener: () => void): void;
  off(event: RenderHostEvent, listener: () => void): void;
  get isInitialized(): boolean;
  dispose(): void;
  static parseAlphaTex(tex: string): model.Score;
}
```

- (b) `loadScore` と `parseAlphaTex` の型は、alphaTab の `model.Score` とする。作り直す前は `unknown` だった。Score は alphaTab のデータそのもの（基本設計 AD-1、[[data-model-persistence.md#2]]）なので、型で Score 以外を渡せなくするため。

### 12.2 30fps のための描き方

- alphaTab の描画は Web Worker を使わず、メインスレッドで同期に行う。alphaTab の設定の `core.useWorkers` に `false` を渡す（[[../basic_design/13_design_decision_points.md#3]] B30。Web Worker の自動生成が CSP の `script-src 'self'` とぶつかり、`renderFinished` が返らなかったため）。渡すのは、4.1 節の `core.engine` と 10.3 節の `core.enableLazyLoading` と同じ `initialize` の中の 1 か所だけ。
- 30fps は、フォーカスビューで描く小節を、編集している所の周りの数小節に絞ることで満たす。`applyViewMode` は、フォーカスビューのとき、alphaTab の設定の `display.startBar`（1 始まり。`focusRange.startBarIndex` に 1 を足す）と `display.barCount` に範囲を渡し、その範囲だけを描かせる。遅延描画（10.3 節）には頼らない。 <!-- req 09:a5353947.494c --> <!-- req 09:b10c95b9.e7fa -->
- 全体スクロールビューと、スコア表示の大曲は、alphaTab の描画をそのまま使い、簡易描画のレイヤーを作らない。 <!-- req 09:b10c95b9.b49d --> <!-- req 09:b10c95b9.2097 -->
- 全体スクロールビューとスコア表示の大曲のとき、およびズームの操作中に 30fps に届かないと負荷テスト（10.6 節）で分かったときだけ、[[../basic_design/13_design_decision_points.md#2]] A9 のフォールバックを入れる。フォールバックは 2 つで、(1) 細かい記譜を省いた簡易描画のレイヤーに切り替える、(2) 専用のワーカーのスクリプトを同梱し、非同期の描画に戻す。(2) は `ScoreRenderHost` の中の `core.useWorkers` の切り替えで入れ、公開のシグネチャは変えない。どちらを入れるかは、届かない場面を測ってから決める。 <!-- req 09:a5353947.4d79 --> <!-- req 09:a5353947.1bb9 --> <!-- req 09:a5353947.e255 --> <!-- req 09:b10c95b9.ff69 -->

### 12.3 曲一覧のサムネイル

- 曲一覧のサムネイルは、曲の最初の 1 段（alphaTab のレイアウトでの最初の段）だけを描き、曲全体を描かない（[[../basic_design/13_design_decision_points.md#3]] B7）。作る時機と置き場所は data-model-persistence.md と screens-navigation.md（基本設計 06 章と 03 章の回）に書く。 <!-- req 09:d7d57e7d.9544 -->

### 12.4 印刷用の描画

- 印刷と PDF のための描画は、`ScoreRenderHost` を広げず、別のクラス `PrintLayoutRenderHost` にする（[[../basic_design/13_design_decision_points.md#3]] B21）。中身は export-print.md（基本設計 07 章の回）に書く。
