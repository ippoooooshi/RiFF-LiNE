# 詳細設計書：Webコア基盤構築

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 1「Webコア基盤構築」
- **ブランチ名**：`feature/web-core-foundation`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 1. 目的・スコープ

[[../basic_design/01_architecture.md#1]] を受ける。

- 本書は、Webコア（プラットフォームに依存しない部分）とプラットフォームラッパー（PC 版の Electron、将来の iPhone 版の Expo）の境界を、パッケージとフォルダの単位で決める。Webコアは `packages/core`・`packages/ui-shared`・`packages/ui-desktop`、ラッパーは `apps/desktop` と `apps/mobile` とし、`packages/shared-types` は両側が共有する型だけを置く境界とする（層ごとの置き場所は 2.1 節）。 <!-- req 01:71ceacea.e7a7 --> <!-- req 12:5d66d2e3.c8d1 --> <!-- req 12:5d66d2e3.bb5f --> <!-- req 12:041c1bea.63f8 --> <!-- req 00:4e8d2b9b.ab0b -->
- 防ぐ対象は、PC 版を作っている間に Electron に依存するコードが Webコアに入り込むこと（要件書リスク#8）とする。具体的には、`packages/core`・`packages/ui-shared`・`packages/ui-desktop` の中での `electron`・`expo-*`・Node.js の組み込みモジュール（`node:` で始まるもの）・`apps/**` の import を指す。 <!-- req 01:71ceacea.e98f -->
- 防ぎ方は、レビューで見つけるという運用の決まりに頼らず、構造で行う。(1) `packages/core`・`packages/ui-shared`・`packages/ui-desktop` の `package.json` の依存に `electron` と `expo-*` を入れない。(2) ESLint の `no-restricted-imports` で上の import をエラーにし、CI の `pnpm lint` が通らなければマージできないようにする（2.2 節）。 <!-- req 01:71ceacea.6d1d --> <!-- req 12:b98541f4.ecb2 --> <!-- req 00:4e8d2b9b.4eae -->

**詳細設計書で決めること**：各詳細設計書は、受け持つクラスごとに次の 5 つを書く。書き方は本書で決めた（(b)）。TypeScript の宣言で書くのは、実装とそのまま突き合わせられるため。

| 決めること | 書き方 |
|---|---|
| クラス構成 | 置き場所（パッケージとフォルダ）、クラスとインターフェースの一覧、どれがどれを持つか。[[00_reference.md#3]] の登録簿にも 1 行ずつ載せる <!-- req 01:ddb7c423.c57e --> |
| メソッドのシグネチャ | `export class …`／`export interface …` の TypeScript の宣言をコードブロックで書く <!-- req 01:ddb7c423.e60a --> <!-- req 12:40b24240.113f --> <!-- req 12:40b24240.acc0 --> |
| 引数 | 宣言の中で名前と型を書く。省略できる引数は、省いたときの値をコメントで書く <!-- req 01:ddb7c423.dcfa --> |
| 戻り値の型 | 宣言の中で書く。非同期のものは `Promise<…>` で書く <!-- req 01:ddb7c423.13ac --> |
| 例外仕様 | メソッドごとに、投げるエラーのクラスか、出す通知のコード（[[00_reference.md#5]]）を表で書く。まだ決められない範囲は「未確定」と書いて [[00_reference.md#8.1]] に G 番号で載せ、空けたままにしない <!-- req 01:ddb7c423.a8e6 --> |

基本設計はインターフェースを責務と契約の水準で書くところに留める。インターフェースの具体的な型定義とメソッドのシグネチャは、アダプタに限らずすべてのインターフェースについて、詳細設計書が上の表の書き方で書く（基本設計 13 章 B13）。基本設計には、具体的な型定義（type 宣言を含む TypeScript のコードそのものと、それと同じ種類のコード）とメソッドの名前を書かず、型定義と同じ考え方で文章の表現にそろえる。基本設計の水準はモジュールの責務の水準とし、詳細設計の水準の記述が基本設計に混ざっているのを見つけたら、基本設計の側を文章に直して正す（基本設計 12 章 3.11 節と 5 節の記録）。 <!-- req 13:688bb0ae.f56e --> <!-- req 13:688bb0ae.146f --> <!-- req 12:6083efac.f6ef --> <!-- req 12:6083efac.7c00 --> <!-- req 12:6083efac.aab6 --> <!-- req 12:0c7a6317.fdab --> <!-- req 12:1555350b.2fad --> <!-- req 12:40b24240.d765 --> <!-- req 12:40b24240.f49e --> <!-- req 12:40b24240.a630 --> <!-- req 12:560ed991.6cab --> <!-- req 12:560ed991.6621 --> <!-- req 12:560ed991.a7e2 --> <!-- req 12:3cadc6ef.4eae --> <!-- req 12:3261ac0d.7f59 --> <!-- req 12:f156da77.6f28 --> <!-- req 00:4888e822.783e --> <!-- req 00:0d342f1f.1d14 --> <!-- req 00:0d342f1f.5679 -->

詳細設計の工程の位置づけ（基本設計と実装のあいだに置く独立した工程とすること）は、15 章の回で書く。 書いた先は 15.2 節。 <!-- req 13:6903fe5c.33d8 --> <!-- req 13:6903fe5c.41b0 --> <!-- req 12:02e22ba6.900e -->

## 2. レイヤー構成と依存の規則

[[../basic_design/01_architecture.md#2]] を受ける。層の定義と図は基本設計が正で、本節はパッケージとフォルダへの当てはめと、依存を見張る仕組みを書く。 <!-- req 00:ee2625fc.e307 --> <!-- req 00:ee2625fc.341c -->

### 2.1 層とパッケージ・フォルダの対応

| 層 | 置き場所 | 置くもの |
|---|---|---|
| L1 プレゼンテーション | `packages/ui-desktop` | PC 版の画面の入れ物（パネル・ダイアログ・ウィンドウの配置と開け閉めをする React のコンポーネント、03 章）。Webコアに属する <!-- req 01:f5da8c39.324c --> |
| L1 プレゼンテーション | `packages/ui-shared` | PC 版・iPhone 版・iPad 版で共通の画面の中身の部品（React のコンポーネント）。Webコアに属する（2026-10-13 本人決定、5.1 節） <!-- req 01:f5da8c39.d5ab --> <!-- req 01:9c6130cb.e761 --> |
| L1 プレゼンテーション | `packages/core/src/ui` | 見た目に関係しない画面の処理（ViewModel・Binder・Store・Router・Overlay） |
| L1 プレゼンテーション | `packages/core/src/rendering` | alphaTab の描画領域の窓口。(b) 基本設計 AD-5 の木には無いフォルダだが、alphaTab の描画の API に触る所を 1 か所に閉じるために置く |
| L2 アプリケーションサービス | `packages/core/src/editing`・`packages/core/src/playback`・`packages/core/src/export` | 編集サービス・コマンド層・バリデーション（`editing`）、再生制御（`playback`）、書き出し（`export`） |
| L3 ドメイン | `packages/core/src/domain` | Score のラッパーとサイドカーメタデータ（[[data-model-persistence.md#2]]） |
| L4 プラットフォーム抽象 | `packages/core/src/platform`・`packages/shared-types` | PlatformAdapter のインターフェース（実装は置かない）、IPC の型 |
| L5 プラットフォーム実装 | `apps/desktop`（Phase 1）・`apps/mobile`（Phase 3） | main・preload・レンダラーの起動と DI の組み立て。**画面の部品は置かない** <!-- req 01:f5da8c39.cf77 --> |
| 層の外 | `packages/core/src/errors` | エラーと通知（08 章）。(b) どの層から使ってもよく、`errors` からはほかの層を import しない。L3 の読み込みの失敗も L1 の表示も同じ通知の仕組みを使うので、どれか 1 つの層に入れると逆向きの依存が出るため |

### 2.2 依存の向き

- 上の層は下の層を import してよい（L1 → L2 → L3 → L4）。 <!-- req 01:cfe39104.1eb4 -->
- 下の層は上の層を import しない（下の表に無い向きはすべて禁止）。 <!-- req 01:cfe39104.e306 -->

層ごとに、import してよい先を次の表に限る（表に無い向きはすべて禁止）。 <!-- req 01:cfe39104.8f78 -->

| import する側 | import してよい先 |
|---|---|
| L1（`packages/ui-desktop`・`packages/ui-shared`・`packages/core/src/ui`・`packages/core/src/rendering`） | L2・L3・L4・`errors`・React（`packages/ui-desktop` と `packages/ui-shared` だけ）。`packages/ui-shared` は `packages/ui-desktop` を import しない（中身は入れ物を import しない、13.5 節） |
| L2 | L3・L4・`errors` |
| L3 | L4・`errors`・`packages/shared-types` |
| L4 | `packages/shared-types`。L5 は import しない（L5 が L4 のインターフェースを実装して起動時に注入する、AD-3 の依存性逆転。基本設計 2 節の図の L4 → L5 の矢印は、import ではなく実装の向き） |
| `errors` | `packages/shared-types` |
| L5（`apps/desktop`） | L1〜L4・`errors`・`electron`（DI の組み立てのため）。L5 は層の番号では一番下だが、パッケージの依存の向きは基本設計 AD-5 の `apps/desktop` → `packages/ui-desktop` → `packages/ui-shared` → `packages/core` → `packages/shared-types` に従い、組み立てのために L1〜L4 を import する。L5 が L1 の画面（`packages/ui-desktop`）を読み込むのは、基本設計 01 章 2 節の「組み立ての根としての例外」に当たり、それ以外の逆方向の依存は持たない <!-- req 01:6c825e98.be91 --> |

**ESLint で見張る**：設定はリポジトリ直下の `eslint.config.js`（フラットコンフィグ）1 つにまとめる。ESLint の組み込みの `no-restricted-imports`（パターン指定）で、上の表に無い向きの import と、`packages/core/**`・`packages/ui-shared/**`・`packages/ui-desktop/**` から `electron`・`expo-*`・Node.js の組み込みモジュール・`apps/**` への import をエラーにする。`packages/core` から `react` の import もエラーにする（[[../basic_design/13_design_decision_points.md#3]] B36 の理由 (1)）。`packages/ui-shared/**` から `@riff-line/ui-desktop` の import もエラーにする（2026-10-13 本人決定、B36）。(b) 組み込みのルールを使うのは、作り直す前の実装で動いていた形で、`eslint-plugin-import` を足さずに済むため。`packages/ui-desktop` と `packages/ui-shared` の分は、それぞれのパッケージを作るときに足す。ビルドの構成（electron-vite と Electron Builder）の import の禁止も同じ設定に入れる（中身は 8.4 節）。 <!-- req 01:09054c00.d4eb -->

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

Webコア（`packages/core`・`packages/ui-shared`・`packages/ui-desktop`）のコードは、4 系統について具象クラスを import せず、`packages/core/src/platform` のインターフェースだけを型として使う。具象クラスは `apps/**` にあるので、import すると 2.2 節の ESLint の規則でエラーになる。 <!-- req 01:384bef0d.34b6 -->

具象の実装は、PC 版は Electron アダプタとして `apps/desktop` に、iPhone 版（Phase 3）は Expo アダプタとして `apps/mobile` に置く。L5 が起動時に具象を作り、次の `PlatformAdapters` 1 つにまとめて、Webコアの組み立ての関数に引数で渡す（依存性逆転）。Webコアの中でアダプタを使うクラスは、コンストラクタの引数で受け取り、グローバルな置き場（シングルトン・モジュールの変数）から取らない。Phase 3 の iPhone 版の保存先の契約は、基本設計 13 章 A12 で作り直す前提とし、本書の `FileSystemAdapter` の契約は PC 版（Phase 1）のものとする。(b) 1 つの型にまとめて渡すのは、4 つのどれかを渡し忘れたときに型の検査で見つけるため。コンストラクタで受け取るのは、テストで偽物に差し替えるため。 <!-- req 01:384bef0d.7e73 --> <!-- req 13:2662ecdf.612c -->

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

`FileSystemAdapter` のレンダラーの側のクラスは `IpcFileSystemAdapter` とし、保存先のルートごとにそれを作るファクトリは `IpcFileSystemAdapterFactory` とする（どちらも `apps/desktop/src/renderer/ipcFileSystem.ts`）。2 つとも preload が出す `window.riffLineApi` だけに依存する（基本設計 13 章 B31）。 <!-- req 13:14e16918.cd31 -->

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

4 つのアダプタのメソッドのシグネチャ（引数、戻り値の型、非同期か同期か、エラーのときの扱い）は、次の受け先で、1 節の「詳細設計書で決めること」の表の書き方で書く。本節には書かない。 <!-- req 01:caf80338.5bff --> <!-- req 01:caf80338.943b --> <!-- req 01:caf80338.c8f3 --> <!-- req 12:0c7a6317.86e5 --> <!-- req 12:0c7a6317.61ab --> <!-- req 12:0c7a6317.1829 -->

| アダプタ | シグネチャの受け先 | 書く回 |
|---|---|---|
| `FileSystemAdapter` | data-model-persistence.md | 基本設計 06 章の回 |
| `AudioSessionAdapter` | playback-integration.md | 基本設計 05 章の回 |
| `WindowAdapter` | screens-navigation.md | 基本設計 03 章の回 |
| `UpdateCheckAdapter` | 本書の 13.3 節 | 基本設計 10 章の回 |

非同期か同期かは、受け先で書くときに次の決まりに従う：PC 版で IPC を通るメソッド（`FileSystemAdapter`・`WindowAdapter`）は `Promise<…>` を返す非同期にする（Electron の `ipcRenderer.invoke` が `Promise` を返すため）。IPC を通らないメソッド（PC 版の `AudioSessionAdapter`）も、iPhone 版で非同期になりうるものは `Promise<…>` を返す形にそろえ、プラットフォームで同期と非同期を変えない。 <!-- req 01:caf80338.7615 --> <!-- req 01:caf80338.90ef -->

## 4. 言語・UI・状態管理・ビルド・スタイリング

[[../basic_design/01_architecture.md#3]] AD-4 を受ける。選んだ理由は基本設計が正で、本節はどのパッケージにどう入れるかを書く。

### 4.1 選んだもの

| 項目 | 決まり |
|---|--- <!-- req 01:684cea3b.e2e0 --> |
| 言語 | TypeScript。`packages/*` と `apps/*` のソースは `.ts`／`.tsx` で書く <!-- req 01:da104e4f.da60 --> |
| UI | React。React を import してよいのは `packages/ui-desktop` と `packages/ui-shared` だけ（2.2 節の表）。`apps/desktop` のレンダラーは React を import せず、`packages/ui-desktop` が出す「画面を DOM に載せる関数」を呼んで、組み立てたアダプタとサービスを渡す。(b) 2.2 節の表で L5 の import してよい先に React が無いため。関数の形は基本設計 03 章の回に screens-navigation.md に書く <!-- req 01:15b5ef7e.c567 --> |
| 状態管理 | Zustand。ストアは `packages/core/src/ui` に置き、`zustand/vanilla` の `createStore` で作る（React を import しない）。画面の部品（`packages/ui-desktop` と `packages/ui-shared`）は `zustand` の `useStore` でストアを読む。(b) `packages/core` が React を import しない決まり（2.2 節）を守ったまま、ストアを Webコアの見た目に関係しない側に置けるため <!-- req 01:47958bb6.ef05 --> |
| コマンド層 | 状態管理のライブラリを使わず、`packages/core/src/editing/commands` に自前で書く（[[editing-core.md#2]]） <!-- req 01:47958bb6.023d --> |
| Undo/Redo の対象 | Score の変更だけ。`CommandHistory` に積むのは Score を変えるコマンドだけにする <!-- req 01:47958bb6.3b76 --> |
| 画面の状態 | Score の外にある画面の状態（選択範囲・表示モードを含む）は、状態管理のストアに置き、`CommandHistory` に積まない。ストアの値の変更は Undo/Redo で戻らない <!-- req 01:47958bb6.4f3b --> <!-- req 12:cd94b2c9.df0d --> |
| ビルド | Vite を土台にした electron-vite で、main・preload・レンダラーの 3 つを組む。設定は `apps/desktop/electron.vite.config.ts` の 1 つ。(b) 3 つのプロセスを 1 つの設定で組めるため <!-- req 01:612cc1fc.58f5 --> |
| alphaTab | `@coderline/alphatab` を fork したもの（下の「alphaTab の fork」の行）を入れ、依存に書くのは `packages/core`（描画と再生）。版は `package.json` で 1 つに固定する（今の元は本家の `1.8.4`）。(b) 依存の名前は `@coderline/alphatab` のままにし、`package.json` の参照先だけを fork の作り物に向ける。アプリのコードの import を変えずに済み、本家へ戻すときも参照先を 1 か所直せば済むため <!-- req 01:5712243c.f50c --> <!-- req 01:5712243c.e538 --> |
| alphaTab の fork | 本家の同じ版を元にし、足すのは再生中のパンの命令 `changeTrackPan`（[[playback-integration.md#2]] の 2.2 節）の 1 つだけとする（2026-10-11 本人決定、基本設計 13 章 A13）。足したものの一覧（足したファイル・直したファイル・足した命令の通り道）は fork の側に 1 つのファイルで残す。本家の版を上げるときは、fork に本家の新しい版を取り込み、一覧のとおりに足したものを当て直し、playback-integration.md 2.2 節の 2 つの単体テスト（アプリの側と fork の側）と 12 節の Phase 0 の確かめをやり直す。版を上げる PR では 8.2 節のライセンスの確かめも通す。fork のソースは、GitHub で本家を fork した公開のリポジトリに置き、このリポジトリには入れない。アプリに取り込むのは、fork をビルドした作り物だけとする（2026-10-12 本人決定、honnin-queue 83 番）。本家の新しい版を取り込むときは、GitHub の fork の機能で本家との差分を fork に取り込む。fork のリポジトリは公開しているので、配るときの「fork で直したファイルのソースを公開する」（基本設計 01 章 5 節、本書 8.2 節）は、このリポジトリを示せば満たす。fork のリポジトリは Phase 0 で作り、名前と URL はそのときに書く。(b) fork をビルドした作り物（`dist`）を `packages/core` の `package.json` から pnpm のファイルの参照で指し、アプリのビルドで alphaTab を組み直さない。アプリのビルドの手順を本家のままの形に保つため。作り物をこのリポジトリのどこに置くかと、ファイルの参照の書き方は、Phase 0 で fork を作るときに pnpm の版の説明で確かめて書く <!-- req 01:5712243c.c532 --> <!-- req 01:5712243c.0477 --> <!-- req 01:5712243c.b4fe --> <!-- req 01:5712243c.b1d5 --> <!-- req 01:5712243c.ca70 --> <!-- req 01:5712243c.5e6d --> <!-- req 01:5712243c.8697 --> |
| SoundFont とフォント | alphaTab（fork）のパッケージの `dist/soundfont` と `dist/font` を、ビルドの前にコピーするスクリプト（`apps/desktop/scripts`）で `apps/desktop/src/renderer/public/alphatab/` に置き、アプリと一緒に配る。読み込みはアプリの中の相対パスで行い、`http:`・`https:` の URL から読まない（要件 5.1、外部の CDN を使わない）。どの SoundFont を配るかは playback-integration.md（基本設計 05 章の回） <!-- req 01:5712243c.76f9 --> |
| 描画エンジン | SVG。alphaTab の設定の `core.engine`（`CoreSettings.engine`）に `'svg'` を渡す。渡すのは `packages/core/src/rendering` の 1 か所だけ <!-- req 01:3230a605.a839 --> |

### 4.2 スタイリングと見た目のトークン

画面の見た目は Tailwind CSS v4 系で書き、[[../basic_design/14_visual_design_system.md]] のトークンを CSS の `@theme` に定義する。**色・文字・余白・角丸・影のトークンの値を書くのは、本節と本節で決める CSS ファイル 1 つだけ**にする（ほかの詳細設計書・ほかのファイルは値を持たず、名前で参照する）。 <!-- req 00:b63e6466.5aa1 --> <!-- req 00:b63e6466.a0f3 --> <!-- req 00:b63e6466.30be --> <!-- req 00:b63e6466.5a5f --> <!-- req 00:b63e6466.1954 -->

| 項目 | 決まり |
|---|---|
| 入れるもの | `tailwindcss` と `@tailwindcss/vite`（Vite のプラグイン）の 2 つ。どちらも v4 系で、細かい版は入れるときに `package.json` で固定する（今は入っていない） <!-- req 01:4be59a2d.8748 --> <!-- req 01:4be59a2d.ca34 --> |
| Vite への入れ方 | `@tailwindcss/vite` を `apps/desktop/electron.vite.config.ts` の `renderer.plugins` に足す（公式の Vite での入れ方：`import tailwindcss from '@tailwindcss/vite'` と `plugins: [tailwindcss()]`） <!-- req 01:4be59a2d.638c --> |
| 定義を置くファイル | `packages/ui-desktop/theme.css` の 1 つ。先頭に `@import "tailwindcss";` と `@source "./src";` と `@source "../ui-shared/src";`、続けて `@theme static { … }` にトークンを並べる（下の CSS）。(b) PC 版の画面の入れ物が `packages/ui-desktop` にあるので、トークンも同じパッケージに置く。`../ui-shared/src` も書くのは、中身の部品（`packages/ui-shared`）のクラス名も探させるため。iPhone 版の入れ物（Phase 3）でトークンをどう読み込むかは、Phase 3 の詳細設計で決める。`@source` を書くのは、Tailwind が既定ではビルドを走らせる作業ディレクトリ（`apps/desktop`）からクラス名を探し、`node_modules` の中を探さないため（公式文書 Detecting classes in source files：「Tailwind uses the current working directory as its starting point when scanning for class names by default.」「Use `@source` to explicitly register source paths relative to the stylesheet」） |
| 読み込み方 | レンダラーの入口（`apps/desktop/src/renderer` の `main.ts`）で `import '@riff-line/ui-desktop/theme.css';` を 1 回だけ行う。`packages/ui-desktop` の `package.json` の `exports` に `./theme.css` を載せる |
| トークンの範囲 | 14 章の 3 節（色）・4 節（文字）・5 節（余白）・6 節（角丸と影）の値をすべて `@theme` に書き、CSS 変数にする <!-- req 01:4be59a2d.2332 --> <!-- req 01:4be59a2d.3b48 --> <!-- req 01:4be59a2d.49c5 --> <!-- req 01:4be59a2d.e9ec --> <!-- req 01:4be59a2d.7e81 --> <!-- req 01:4be59a2d.028c --> <!-- req 13:530ab8de.5915 --> |
| `static` を付ける理由 | Tailwind v4 は、既定では使われたテーマ変数だけを CSS 変数として出す（公式文書 Theme variables：「By default only used CSS variables will be generated in the final CSS output.」）。`packages/core` の描画の側は Tailwind のクラスを使わず `var(--color-danger)` の形で参照するので、使われていなくても全トークンを CSS 変数として出す `static` にする。これで `@theme` に書いたトークンがすべて CSS 変数になる <!-- req 01:4be59a2d.32ca --> |
| 既定のテーマを外す | `@theme static` の最初に `--*: initial;` を書き、Tailwind の既定のテーマ変数（例：`red-500`）をすべて外す。**画面が使えるのは 14 章のトークンから作られたクラスだけ**になる（公式文書：「Now none of the default utility classes that are driven by theme variables will be available」） <!-- req 01:4be59a2d.5ffb --> |
| 直値を書かない | 画面の部品（`packages/ui-desktop` と `packages/ui-shared`）は、色・文字・余白・角丸・影を、トークンから作られた Tailwind のクラス（`bg-surface`・`text-danger`・`p-3`・`rounded-md` の形）だけで書く。色・長さの直値（例：`#c62a3f`）、角括弧で値を書く任意値のクラス（例：`[#c62a3f]`・`[13px]`）、`style` 属性のどれも書かない（`style` 属性に `var(--…)` を書くことも含む、[[../basic_design/08_error_logging.md#4]]）。`var(--…)` で参照してよいのは、クラスを付けられない `packages/core/src/rendering` の SVG の着色だけ。(b) 画面の部品ではなく、alphaTab が描いた SVG の要素に色を付ける所なので <!-- req 01:4be59a2d.4bfe --> <!-- req 01:4be59a2d.5ffb --> <!-- req 08:ee543f5b.4a5e --> <!-- req 14:20e92645.0395 --> |
| ダークの値 | 14 章 3 節の表のダークの値と 6 節のダークの影は、将来ダークモードを足すときに使う控えで、v1 では `@theme` に入れない（14 章 3 節の「v1の実装にはダーク値を入れない」）。控えの値は下の「色のトークンの使い道とダークの控え」の表の右の列に持つ。影のダークの控えは `0 4px 12px rgb(0 0 0 / 0.45)`。入れるときは同じファイルに上書きの規則を足す <!-- req 14:fb087205.3517 --> <!-- req 14:fb087205.1fce --> <!-- req 14:af97cae7.9ba9 --> |
| パート識別色 | `Part.color`（データとしてのパートの色、14 章 3.2 節）は、アクセントの色とは別の色の体系として扱い、`--color-*` のトークンに入れない。曲データの値なので、描画のときに渡す。既定のパレットの 8 色は [[part-tuning-management.md#2]] の 2.1 節の `PART_COLOR_PALETTE` の 1 か所に持ち、並びの番号で `part-color-1` から `part-color-8` と呼ぶ。8 色は、アクセント（インディゴの `#5850ec`）と色相が隣り合わないよう、わざとずらして選んである（2026-10-01 本人決定、honnin-queue 2 番）。(b) パレットを CSS 変数にしないのは、選んだ色が HEX の文字列で曲のファイルに入り、割り当ての処理（TypeScript）が値を使うので、CSS と TypeScript の 2 か所に値を持たないため <!-- req 14:8d71b484.a943 --> <!-- req 14:4f65c325.0202 --> <!-- req 14:ed168089.839d --> <!-- req 14:ed168089.4a8b --> |

色は 14 章 3 節の表の全トークン（21 個）を、表の名前に `--color-` を付けて、ライトの値のまま並べる（[[../basic_design/08_error_logging.md#4]] の「`--color-` ＋表の名前」）。色のほか（14 章 4〜6 節）は、Tailwind の名前空間（公式文書の表：`--font-*`・`--text-*`・`--font-weight-*`・`--spacing-*`・`--radius-*`・`--shadow-*`）に合わせて、下の対応表の名前にする。 <!-- req 08:ee543f5b.14a8 --> <!-- req 08:ee543f5b.0d34 --> <!-- req 14:20e92645.a3dd --> <!-- req 14:20e92645.5bf8 --> <!-- req 13:530ab8de.f343 -->

```css
@import "tailwindcss";
@source "./src";
@source "../ui-shared/src";

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
| 4 節 フォントスタック「UI基本」 | `"Segoe UI", "Yu Gothic UI", "Meiryo UI", "Hiragino Kaku Gothic ProN", sans-serif` | `--font-ui`（同じ値）。PC 版は Windows の標準の書体を先頭に置いた、この並びの順のまま使う | `font-ui` <!-- req 14:881d9ab0.50e2 --> <!-- req 14:45547963.8e5e --> <!-- req 12:8a1eb838.d9ef --> <!-- req 12:db1ac14f.6444 --> |
| 4 節 フォントスタック「数値・技術情報用（等幅）」 | `"Cascadia Mono", "Consolas", ui-monospace, monospace` | `--font-mono`（同じ値）。数と技術の情報の表示に使う（使う所は [[screens-navigation.md#15]] の 15.2 節） | `font-mono` <!-- req 14:d475d16c.a8f8 --> <!-- req 14:d475d16c.0843 --> |
| 4 節 ダイアログ見出し | 15px相当・600 | `--text-heading: 0.9375rem`（15px）／`--font-weight-heading: 600` | `text-heading`・`font-heading` <!-- req 14:46fa6f5d.90ab --> |
| 4 節 本文・標準UI文字 | 13.5px相当・400 | `--text-body: 0.84375rem`（13.5px）／`--font-weight-body: 400` | `text-body`・`font-body` <!-- req 14:79e1c28f.c96a --> |
| 4 節 ラベル・見出し小 | 12px相当・600 | `--text-label: 0.75rem`（12px）／`--font-weight-label: 600` | `text-label`・`font-label` <!-- req 14:22effc43.3fbb --> |
| 4 節 補助文字・タイムスタンプ | 11px相当・500 | `--text-caption: 0.6875rem`（11px）／`--font-weight-caption: 500` | `text-caption`・`font-caption` <!-- req 14:48490a85.7c46 --> |
| 5 節 space-1〜space-5 | 4／8／12／16／20px | `--spacing: 4px` の 1 つだけ。Tailwind の数値の余白クラスは `--spacing` の倍数になる（公式文書 padding：「`padding: calc(var(--spacing) * <number>);`」）。space-1＝`*-1`（4px）、space-2＝`*-2`（8px）、space-3＝`*-3`（12px）、space-4＝`*-4`（16px）、space-5＝`*-5`（20px）。余白は 4px の格子にそろえる | `p-3`・`gap-4` <!-- req 14:027dd337.91c6 --> <!-- req 12:8a1eb838.3e0f --> |
| 6 節 radius-sm／radius-md／radius-lg | 4／6／8px | `--radius-sm`／`--radius-md`／`--radius-lg`（名前も値もそのまま） | `rounded-sm`・`rounded-md`・`rounded-lg` |
| 6 節 影（浮いている要素だけに使う、1 種類） | ライト `0 4px 12px rgb(0 0 0 / 0.12)` | `--shadow-float`（同じ値）。影はこの 1 つだけで、別の影のトークンを作らない。(b) 14 章に名前が無いので、用途（浮いている要素）から名前を付けた | `shadow-float` <!-- req 14:af97cae7.e479 --> <!-- req 14:af97cae7.1639 --> |

- 文字の大きさは、14 章 4 節の「相対単位で定義する」に従って `rem` で書く（1rem＝16px として換算した）。OS の表示の拡大（UI のスケーリング）に合わせて大きさが変わるようにするため <!-- req 14:753144e7.86d2 -->
- ツールバーの高さ（14 章 5 節の目安 44〜48px）は `@theme` のトークンにせず、`--spacing` の倍数（`h-12`＝48px）で書く。(b) 高さは 14 章でトークンになっていないので、目安の幅の上の端を 4px の倍数で取った。ツールバー（[[screens-navigation.md#7]] の 7.1 節の上のツールバー）の 1 段の高さは `h-12`（48px）とし、2 段に折り返したときは段の数に合わせて伸ばす（[[screens-navigation.md#15]] の 15.5 節）。中のアイコンは 16px のまま（同じ 15 節の 15.3 節、14 章 9 節の 15〜16px） <!-- req 14:6ef6273f.3c3c -->
- メニューバーの高さは OS 標準のメニューに任せ、アプリの側で決めない（2026-10-13 本人決定、honnin-queue 89 番）。メニューバーは OS 標準のメニュー（[[screens-navigation.md#8]] の 8.3 節の `BrowserWindow.setMenu`）で、高さを OS が決めるので、アプリの CSS で高さを当てない <!-- req 14:6ef6273f.f355 -->
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
| accent | `#5850ec` | プライマリボタン・アクティブなナビ・アクティブなタブ・フォーカスリング | `#8b84f5` <!-- req 14:282a6a13.6f03 --> <!-- req 14:282a6a13.ba6c --> <!-- req 14:282a6a13.f01e --> <!-- req 14:282a6a13.228d --> <!-- req 13:530ab8de.2873 --> |
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

- 14 章の値は方針として決まった値で、Phase 0 から 1 のあいだに、alphaTab が実際に描いた譜面と並べて見ながら微調整してよい <!-- req 14:d1ab0d15.1a20 --> <!-- req 00:b63e6466.886d --> <!-- req 00:b63e6466.f2fd -->
- 微調整は、実装のときに OS のアクセシビリティの設定（コントラスト比を含む）を確かめながら行ってよい <!-- req 14:4214acb0.4a2c -->
- 直すのは値だけとし、トークンの名前と役割（何のためのトークンか）は変えない <!-- req 14:4214acb0.7c77 --> <!-- req 14:4214acb0.deff -->
- 本人が決めた値（14 章で「本人決定」と書いた値：4 節の文字の大きさと太さ、5 節の space-5、6 節の影、3.1 節の overlay）は変えない。微調整してよいのは、それ以外の値に限る <!-- req 14:4214acb0.4301 --> <!-- req 14:4214acb0.5213 -->
- alphaTab が描く譜面の部分の色は 14 章の範囲の外で、本節のトークンでは決めない。alphaTab の既定のテーマの設定と、[[../basic_design/13_design_decision_points.md#2]] A2 の確かめの結果と合わせて Phase 0 から 1 のあいだに決め、決めたら本節に書く <!-- req 14:2d490140.2bd4 --> <!-- req 14:2d490140.ebd2 --> <!-- req 00:b63e6466.06af -->

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
│  │     ├─ persistence/         保存と読み込み
│  │     ├─ parts/               パートとチューニングの管理
│  │     ├─ viewmodes/           表示モードとズーム
│  │     ├─ testing/             開発用サンプルデータ
│  │     └─ platform/            PlatformAdapter のインターフェース
│  ├─ ui-shared/                 @riff-line/ui-shared
│  │  └─ src/                    PC 版・iPhone 版・iPad 版で共通の中身の部品（React）
│  ├─ ui-desktop/                @riff-line/ui-desktop
│  │  ├─ theme.css               4.2 節
│  │  └─ src/                    PC 版の入れ物（React）
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

- `packages/` には、プラットフォームに依存しない 4 つのパッケージ（`@riff-line/core`・`@riff-line/ui-shared`・`@riff-line/ui-desktop`・`@riff-line/shared-types`）を置く。 <!-- req 01:634f2a2f.7d3b --> <!-- req 01:38436633.fef8 --> <!-- req 01:9c6130cb.4f03 --> <!-- req 01:262248db.2f87 -->
- `packages/core` は Webコア本体で、L1 のうち見た目に関係しない処理と、L2・L3、L4 のうちインターフェースの定義（`platform`）を持つ。プラットフォーム固有の API（`electron`・`expo-*`・Node.js の組み込みモジュール）を直接参照しない（5.2 節で止める）。 <!-- req 01:62f312e4.d63f --> <!-- req 01:62f312e4.8679 -->
- `packages/core/src/ui` には、画面の見た目に関係しない処理（2.1 節の ViewModel・Binder・Store・Router・Overlay、曲アクションの新規作成と上限警告〈[[../basic_design/11_test_strategy.md]] の `UT-SONGACT-*`〉を含む）を置き、React の部品を置かない。React の部品は `packages/ui-shared`（中身）と `packages/ui-desktop`（入れ物）に置く。 <!-- req 01:33916b10.c336 --> <!-- req 01:33916b10.a109 --> <!-- req 01:33916b10.7892 --> <!-- req 01:33916b10.92e9 --> <!-- req 13:53a45705.c035 --> <!-- req 13:2ec53369.4281 --> <!-- req 13:2ec53369.da24 --> <!-- req 13:2ec53369.e6a7 --> <!-- req 13:2ec53369.55cf --> <!-- req 13:2ec53369.e95f -->
- 2.1 節の表の「見た目に関係しない画面の処理」には、画面が使う Service も入る（[[data-model-persistence.md#13]] の 13.3 節の `AppPreferencesService`）。`packages/core/src/ui` に置くのは、ViewModel・Binder・Service・Store・Router・Overlay とする（基本設計 13 章 B36 の (b)）。 <!-- req 13:53a45705.b564 -->
- `packages/core/src/editing` には、編集サービスとコマンド層（`Command`・`CommandHistory`、[[editing-core.md#2]]）を置く。 <!-- req 01:a1b976a5.86d0 --> <!-- req 01:a1b976a5.efb6 -->
- `packages/core/src/playback` には、再生制御（基本設計 05 章、playback-integration.md）を置く。 <!-- req 01:d52f6760.46c0 --> <!-- req 01:d52f6760.49ef -->
- `packages/core/src/domain` には、Score のラッパーとメタデータのモデル（基本設計 02 章、[[data-model-persistence.md#2]]）を置く。 <!-- req 01:2746c543.6112 --> <!-- req 01:2746c543.f908 -->
- `packages/core/src/export` には、PDF・alphaTex・MIDI の書き出し（基本設計 07 章、export-print.md）を置く。 <!-- req 01:0cccc02e.b2ae --> <!-- req 01:0cccc02e.9d8d --> <!-- req 01:0cccc02e.1458 --> <!-- req 01:0cccc02e.38e2 -->
- `packages/core/src/errors` には、エラーとログの基盤（基本設計 08 章、error-logging-foundation.md）を置く。 <!-- req 01:0e391442.b41a -->
- `packages/core/src/persistence`・`packages/core/src/parts`・`packages/core/src/viewmodes` には、保存と読み込み（基本設計 06 章、data-model-persistence.md）・パートとチューニングの管理（part-tuning-management.md）・表示モード（view-modes.md）を置く。(b) 基本設計 01 章 AD-5 の木には無いが、基本設計 11 章 3.1 節がテストの置き場所としてこの 3 つのフォルダを挙げていて（14.4 節）、今のコードもこの 3 つに分けているため。
- `packages/core/src/platform` には、PlatformAdapter のインターフェース（3 節）だけを置き、実装を置かない。 <!-- req 01:ae8384d2.9a86 --> <!-- req 01:ae8384d2.1d91 -->
- 開発用サンプルデータ（要件 9 章）は `packages/core/src/testing` に置く。そのための `tools/` はリポジトリに設けない（2026-09-27 本人決定）。フィクスチャの中身は 14.9 節。 <!-- req 01:e02f7bf5.90d2 --> <!-- req 01:e02f7bf5.1fe0 -->
- `packages/ui-desktop` には、PC 版の画面の入れ物（パネル・ダイアログ・ウィンドウの配置と開け閉めをする React のコンポーネント、基本設計 03 章）を置く。Webコアの L1 に属する（2.1 節）。参照するのは `apps/desktop` だけとする。 <!-- req 01:38436633.87af --> <!-- req 01:38436633.1149 --> <!-- req 01:38436633.b2f7 --> <!-- req 01:38436633.7951 --> <!-- req 01:38436633.5f5f --> <!-- req 01:38436633.883b --> <!-- req 13:53a45705.137e -->
- `packages/ui-shared` には、PC 版・iPhone 版・iPad 版で共通の画面の中身の部品（パネルとダイアログの中身を、値と操作を props で受けて描く React のコンポーネント）を置く。Webコアの L1 に属し（2.1 節）、PC 版と iPhone 版の両方のアプリから、それぞれの入れ物を通して参照する（2026-10-13 本人決定、基本設計 13 章 B36・15 章 5 節）。 <!-- req 01:9c6130cb.085e --> <!-- req 01:9c6130cb.d84c --> <!-- req 01:9c6130cb.95de --> <!-- req 01:9c6130cb.9eb6 --> <!-- req 01:9c6130cb.e761 --> <!-- req 13:53a45705.74f7 -->
- 入れ物と中身の分け方は 13.5 節の決まりに従う。本書以外の詳細設計書で、画面の部品の置き場所を「`packages/ui-desktop`」とだけ書いている所は、2026-10-13 の決定の前の書き方で、入れ物と中身の両方を指す。部品ごとの置き場所は、入れ物なら `packages/ui-desktop`、中身なら `packages/ui-shared` と、この決まりで読む。(b) 部品の一つずつに置き場所を書き直さず、分け方の決まりを 1 か所に置くため。
- `packages/shared-types` には、`packages/core` と各ラッパー（`apps/*`）が共有する型の定義だけを置き、実行されるコードを置かない。 <!-- req 01:262248db.dea3 -->
- `apps/` はリポジトリ直下に置く。 <!-- req 01:f77cce6a.7804 -->
- `apps/desktop` は、PC 版（Phase 1）の Electron のラッパーとする。持つのは、基本設計 01 章 4.1 節のシェル側責務 7 点と、レンダラーの起動・DI の組み立てだけで、ほかの仕事を持たない（2026-09-27 本人決定）。7 点のうち①から④（ファイル I/O・オーディオセッション制御・ウィンドウ管理・自動更新チェック）は、AD-3 のアダプタの実装として main・preload・レンダラーで実装する（3.1 節）。⑤から⑦（OS 標準のダイアログの呼び出し・ネイティブのメニューの構築・クラッシュ検知）は、アダプタを通さずに `apps/desktop` で実装する。どのプロセスに置くかは 7.2 節。`packages/ui-desktop` の画面は、`apps/desktop` の DI の組み立ての中で組み立てる。画面の部品は置かない。 <!-- req 01:7da038e8.6755 --> <!-- req 01:7da038e8.edb8 --> <!-- req 01:7da038e8.3851 --> <!-- req 01:7da038e8.9bad --> <!-- req 01:7da038e8.3f52 --> <!-- req 01:7da038e8.1e0f --> <!-- req 01:7da038e8.c93d --> <!-- req 01:7da038e8.809e --> <!-- req 01:7da038e8.89a5 -->
- `apps/mobile` は、iPhone 版の Expo＋WebView のラッパーとし、Phase 3 で作る。 <!-- req 01:7405ea98.068b --> <!-- req 01:7405ea98.d8ae --> <!-- req 01:7405ea98.5eb1 -->

### 5.2 依存の定義と、import したらビルドが失敗する仕組み

パッケージの依存の向きは `apps/desktop` → `packages/ui-desktop` → `packages/ui-shared` → `packages/core` → `packages/shared-types` とし、逆向きの依存を書かない。各パッケージの `package.json` の `dependencies` に書いてよいものを次の表に限る。 <!-- req 01:ca300c86.aa1b --> <!-- req 01:ca300c86.12d7 -->

| パッケージ | `dependencies` に書いてよいもの | 書かないもの |
|---|---|---|
| `@riff-line/shared-types` | なし | ワークスペースのほかのパッケージすべて |
| `@riff-line/core` | `@riff-line/shared-types`・`@coderline/alphatab`・`zustand` | `electron`・`expo-*`・`react`・`@riff-line/ui-shared`・`@riff-line/ui-desktop`・`apps/*` のパッケージ |
| `@riff-line/ui-shared` | `@riff-line/core`・`@riff-line/shared-types`・`react`・`zustand` | `electron`・`expo-*`・`react-dom`・`@riff-line/ui-desktop`・`apps/*` のパッケージ。(b) `react-dom` を書かないのは、DOM に載せるのは入れ物の側（4.1 節の「画面を DOM に載せる関数」）の仕事で、中身の部品は要らないため <!-- req 01:0a341626.79ad --> <!-- req 01:0a341626.dc38 --> <!-- req 01:0a341626.a486 --> |
| `@riff-line/ui-desktop` | `@riff-line/ui-shared`・`@riff-line/core`・`@riff-line/shared-types`・`react`・`react-dom`・`zustand` | `electron`・`expo-*`・`apps/*` のパッケージ <!-- req 01:02a0c5e8.d137 --> <!-- req 01:02a0c5e8.cb41 --> <!-- req 01:02a0c5e8.8572 --> <!-- req 01:02a0c5e8.7799 --> <!-- req 01:02a0c5e8.6cdc --> <!-- req 01:02a0c5e8.1261 --> <!-- req 13:53a45705.78b4 --> <!-- req 13:53a45705.4afb --> |
| `@riff-line/desktop` | `@riff-line/ui-desktop`・`@riff-line/core`・`@riff-line/shared-types`。開発用（`devDependencies`）に `electron`・`electron-vite`・`@vitejs/plugin-react`・`tailwindcss`・`@tailwindcss/vite` | `react`・`react-dom`（上の UI の行） |

`packages/core`・`packages/ui-shared`・`packages/ui-desktop` から `electron`・`expo-*` を import した時点でビルドが失敗するように、次の 2 つを重ねる。`packages/ui-shared` と `packages/ui-desktop` の禁止も `packages/core` と同じ 2 つで止める。 <!-- req 01:abd3cf77.6a75 --> <!-- req 01:02a0c5e8.a84a -->

1. **依存の定義**：上の表のとおり、`packages/core`・`packages/ui-shared`・`packages/ui-desktop` の `package.json` に `electron`・`expo-*` を書かない。 <!-- req 01:abd3cf77.2d2e -->
2. **lint のルール**：2.2 節の ESLint の `no-restricted-imports` で、その import をエラーにする。(b) リポジトリ直下の `build` の最初に `pnpm lint` を走らせ、lint のエラーでビルドを止める。依存の定義だけでは import が解決できてしまうことがあるため（リポジトリ直下の `.npmrc` に「Electron 関連はホイストする」の `public-hoist-pattern[]=*electron*` がある）、import を見て止めるのは ESLint に任せ、それをビルドの一部にする。CI（2.2 節）でも同じ `build` を走らせる。 <!-- req 01:abd3cf77.6c94 -->

## 6. プロセス構成・IPC・セキュリティの既定値

[[../basic_design/01_architecture.md#4]] を受ける。プロセスの図は基本設計が正で、本節はプロセスごとの置き場所、ウィンドウを作るときの既定値、IPC の決まりを書く。シェル側の責務をどのプロセスで実装するかは 7 節。

### 6.1 プロセスとウィンドウ

| プロセス | 数 | 置き場所 | 持つもの <!-- req 01:41c05390.b0c1 --> |
|---|---|---|--- <!-- req 01:b0881589.03b0 --> |
| main | 1 | `apps/desktop/src/main` | アダプタの実際の仕事（3.1 節・3.2 節）、⑤から⑦（7.2 節）、IPC のハンドラ <!-- req 01:684cea3b.5bd9 --> |
| preload | ウィンドウごとに 1 | `apps/desktop/src/preload` | `contextBridge.exposeInMainWorld` で出す呼び口だけ（3.1 節） |
| レンダラー | 曲一覧ウィンドウに 1、編集ウィンドウ（曲）ごとに 1、印刷と PDF の生成のあいだだけ見えないウィンドウに 1（10.2 節） | 入口は `apps/desktop/src/renderer`、中身は Webコア | Webコアの一式（`packages/core`・`packages/ui-shared`・`packages/ui-desktop`）。見えないウィンドウに載せるものは export-print.md（基本設計 07 章の回） |

曲一覧ウィンドウと編集ウィンドウの分け方は [[../basic_design/03_screens_ui_pc.md#2]] が正。

### 6.2 セキュリティの既定値

- `BrowserWindow` を作るときは、`webPreferences` に `contextIsolation: true` と `nodeIntegration: false` を必ず渡し、どのウィンドウでも変えない。 <!-- req 01:dc789b0c.d9e1 --> <!-- req 01:dc789b0c.6b09 -->
- 同じ所に `sandbox: true` も渡す。(b) Electron の既定値に頼らず明示する。作り直す前の実装で、既定値に黙って頼っていたのをレビューで直した経緯があるため（[[../basic_design/00_overview.md]] の 0.19）
- レンダラーの Webコアは Node.js の API に直接触れず、必ず preload が出した呼び口から IPC で main に頼む（3.1 節の 3 か所の実装）。 <!-- req 01:dc789b0c.a0fd -->
- main の IPC のハンドラは、受け取った引数を確かめてから使う。(b) レンダラーを信頼の境界の外として扱い、Webコアの不具合が main でのファイル操作に直接つながらないようにするため
- レンダラーの CSP は `script-src 'self'` のまま緩めない（要件 5.1 の完全オフライン。[[../basic_design/13_design_decision_points.md#3]] B30 は、CSP を緩めない前提で alphaTab の描き方を決めている） <!-- req 13:e6a4a9ca.74b2 -->
- v1 のアプリは、ネットワーク I/O を行う実装を持たず、通信なしですべての機能が動く（要件 5.1、[[../basic_design/09_nonfunctional.md#4.1]]）。alphaTab 本体は npm の依存としてビルドでアプリに組み込み、SoundFont とフォントは 4.1 節のとおりアプリと一緒に配って、どちらも外部の CDN から読まない。更新の確認（3.2 節の `UpdateCheckAdapter`）は v1 では通信しない。将来通信する実装にしても、問い合わせの失敗は無視して起動・編集・再生を続け、更新の確認を起動・編集・再生に欠かせない経路に置かない。 <!-- req 09:bee9a72a.461c --> <!-- req 09:0f5a59a2.6756 --> <!-- req 09:0aaf1b07.f7fa --> <!-- req 09:0aaf1b07.a7c6 --> <!-- req 09:4acadeee.1bb4 -->
- 保存先が iCloud Drive と Google Drive のどちらの同期フォルダでも、同期は OS の同期クライアントが行い、アプリは同期の処理をしない（3.2 節の表の後の段落）。同期が止まっていても、アプリはそのフォルダをローカルのフォルダとして読み書きし続け、同期の状態を確かめたり待ったりしない。読み書きの作りは data-model-persistence.md（基本設計 06 章の回）に書く。 <!-- req 09:5c312fba.f7bd --> <!-- req 09:5c312fba.77c5 -->
- (b) ネットワーク I/O を持たないことは、import を機械で止め、動きを受け入れ確認で確かめる。`packages/core`・`packages/ui-shared`・`packages/ui-desktop` は Node.js の組み込みモジュールの import をもう止めている（2.2 節）。`apps/desktop/src/**` にも、2.2 節の ESLint の `no-restricted-imports` で `node:http`・`node:https`・`node:net`・`node:tls`・`node:dgram`（`node:` の付かない名前も）と、`electron` の `net` の import を止める。レビューに頼らず止めるため。Phase 1 の受け入れ確認では、ネットワークアダプタを無効にした状態から起動し、曲の新規作成・編集・保存・再生・書き出し・印刷プレビューまでを一通り通す（手順は 14.6 節の 7 件の #1）。 <!-- req 09:a4831e54.592c --> <!-- req 09:a4831e54.9560 --> <!-- req 09:a4831e54.6d71 --> <!-- req 09:a4831e54.8566 --> <!-- req 09:a4831e54.40c0 --> <!-- req 09:a4831e54.94c1 -->

### 6.3 IPC の決まり

- レンダラーから main への頼みは、`ipcRenderer.invoke`／`ipcMain.handle` で行い、戻り値は `Promise` にする（3.3 節の非同期の決まり）。
- main からレンダラーへの知らせ（メニューで選ばれた項目、7.2 節の⑥）は、main が `webContents.send` で送り、preload が出す購読の関数でレンダラーが受ける。
- チャンネルの名前と、要求と応答の型は `packages/shared-types` に置く（3.1 節）。(b) 本書にはチャンネルの一覧を持たない。チャンネルは、それを使うアダプタや機能の受け先（ファイル I/O は data-model-persistence.md、ログとクラッシュは error-logging-foundation.md、ウィンドウとメニューは screens-navigation.md、印刷は export-print.md）で、シグネチャと一緒に書く。同じ事実を 2 か所に書かないため

## 7. シェル側の責務の一覧

[[../basic_design/01_architecture.md#4.1]] を受ける。7 点の定義と、7 点をシェル側の責務の全体とする理由は基本設計が正で、本節は 7 点を PC 版のどのプロセスのどこで実装するかを書く。

### 7.1 7 点の外へ足さない

- シェル側（`apps/desktop`・`apps/mobile`）の責務は、7.2 節の表の 7 点だけとする。要件 6 章の書き方どおり、シェル側だけを限定して並べ、Webコアの責務は一つずつ並べずに「7 点のほか全部」とする。 <!-- req 01:74ee13c1.1a95 --> <!-- req 01:5a45b866.737f --> <!-- req 01:5a45b866.fe7e --> <!-- req 00:4e8d2b9b.c98a -->
- 詳細設計でも、シェル側の責務はこの 7 点に限って扱い、7 点の外へ足さない。7 点のどれにも当たらない機能は、新しいものも前からあるものも、Webコア（`packages/core`・`packages/ui-shared`・`packages/ui-desktop`）に置く。ただし、基本設計 01 章 AD-3 の形で足す新しいアダプタ（3.1 節の 6 つの将来の機能）の実装は、この決まりの例外とし、足すときに要件 6 章のシェル側の列挙から直して 7.2 節の表に行を足す（2026-10-10 本人決定）。 <!-- req 01:d2029e53.bf8e --> <!-- req 01:45dce2c8.0278 --> <!-- req 01:2068a9a4.640d --> <!-- req 01:56324cb4.d322 --> <!-- req 01:71f70a6f.76e5 --> <!-- req 01:aafb2517.2a2f -->
- 編集ロジック（`packages/core/src/editing`）・データモデル（`packages/core/src/domain`）・再生エンジン（`packages/core/src/playback`）は、PC 版と iPhone 版で同じコードを使い、別に作らない。 <!-- req 01:d2029e53.989a --> <!-- req 01:d2029e53.aebf --> <!-- req 01:d2029e53.4ab2 -->
- 画面の入れ物（配置と開け閉め）は PC 版と iPhone 版で別に作る。PC 版の入れ物（React）は `packages/ui-desktop` に置き、iPhone 版はこれを使わない。画面の中身の部品は `packages/ui-shared` に置き、PC 版と iPhone 版で同じものを使う（2026-10-13 本人決定、要件 6 章の開発順序の「UIのコンテンツ側は二重実装せずに済む」、5.1 節と 13.5 節）。 <!-- req 01:d2029e53.f89c -->
- 画面の部品（入れ物と中身）は 7 点のどれにも当たらないので、Webコアの `packages/ui-desktop` と `packages/ui-shared` に置き、シェルの `apps/desktop` には置かない（5.1 節）。 <!-- req 01:185a77c7.ab10 --> <!-- req 01:185a77c7.8de4 --> <!-- req 01:185a77c7.18aa --> <!-- req 13:53a45705.823e -->

### 7.2 7 点の実装の置き場所

①から④は AD-3 のアダプタとして Webコアへ注入する（3 節）。⑤から⑦はアダプタを通さず、OS に直接触れる実装として `apps/desktop` の main に置く。 <!-- req 01:40249078.8462 --> <!-- req 01:40249078.5fbb -->

| # | 責務 | 実装の形 | PC 版で置くプロセス | 中身の受け先 |
|---|---|---|---|---|
| ① | ファイル I/O | `FileSystemAdapter`（3 節）を注入する | main が `fs/promises` で行い、レンダラーの側のクラスが IPC で呼ぶ（3.2 節） | data-model-persistence.md（基本設計 06 章の回） <!-- req 01:40249078.0976 --> <!-- req 01:a0e77481.20de --> |
| ① に含める | main の `Logger` によるログファイルへの書き出し | レンダラーから `log:append` の IPC で受け、main がファイルに書く | main | error-logging-foundation.md（基本設計 08 章の回） <!-- req 01:a0e77481.fcfc --> |
| ② | オーディオセッション制御 | `AudioSessionAdapter`（3 節）を注入する。実際の処理を持つのは iPhone 版だけ | PC 版は何もしない実装をレンダラーの側に置く（3.2 節） | playback-integration.md（基本設計 05 章の回） <!-- req 01:40249078.5689 --> <!-- req 01:3b7c8d0b.9fd0 --> <!-- req 01:3b7c8d0b.4bcc --> |
| ③ | ウィンドウ管理 | `WindowAdapter`（3 節）を注入する | main | screens-navigation.md（基本設計 03 章の回） <!-- req 01:40249078.f639 --> <!-- req 01:6dab0106.eaa3 --> |
| ④ | 自動更新チェック | `UpdateCheckAdapter`（3 節）を注入する。v1 は通信しないダミー（3.2 節） | PC 版のダミーはレンダラーの側（13.3 節） | 本書の 13.3 節（基本設計 10 章の回） <!-- req 01:40249078.c416 --> <!-- req 01:8359d666.81a9 --> <!-- req 01:8359d666.1ede --> |
| ⑤ | OS 標準のダイアログの呼び出し（印刷・ファイル選択） | アダプタを通さず、OS のダイアログを直接開く | main | 印刷は export-print.md（基本設計 07 章の回）、ファイル選択は 7.3 節 <!-- req 01:40249078.2bf0 --> <!-- req 01:40249078.c51d --> <!-- req 01:71678ac4.f525 --> <!-- req 01:71678ac4.1aed --> |
| ⑥ | メニューバーと右クリックメニューの構築 | アダプタを通さず、main の `Menu`／`Menu.buildFromTemplate` で作る。選ばれた項目は IPC でレンダラーの Webコアへ知らせる（6.3 節） | main | 項目は screens-navigation.md（基本設計 03 章の回） <!-- req 01:40249078.9185 --> <!-- req 01:40249078.135c --> <!-- req 01:61a9764d.45f5 --> <!-- req 01:61a9764d.7b13 --> <!-- req 01:61a9764d.2331 --> <!-- req 01:f3133cb2.30ee --> <!-- req 01:f3133cb2.a88f --> <!-- req 01:f3133cb2.55ef --> |
| ⑦ | クラッシュ検知 | アダプタを通さず、main が各ウィンドウの `webContents` の `render-process-gone` を見張る。検知したら、そのウィンドウのレンダラーを、直前の自動保存のデータから読み込み直す | main | error-logging-foundation.md（基本設計 08 章の回） <!-- req 01:40249078.9565 --> <!-- req 01:fc2e1762.1640 --> <!-- req 01:7e4c4791.ec29 --> <!-- req 01:7e4c4791.3f13 --> |
| ⑦ に含める | レンダラーが落ちた後のクラッシュログの記録（main の `Logger` と、直近の履歴の保持） | レンダラーの中の `Logger` はレンダラーと一緒に失われ、自分のクラッシュを書けないので、main に置く | main | error-logging-foundation.md（基本設計 08 章の回） <!-- req 01:fc2e1762.7f49 --> |

### 7.3 ⑤ のうちファイル選択のダイアログ

- OS 標準のファイル選択のダイアログをシェル側で開くのは、次の 3 つだけとする。(a) 保存先フォルダの指定（[[../basic_design/06_file_io_persistence.md#2]] の「カスタムフォルダを選択」）。(b) 書き出し画面の保存先フォルダの欄の「参照…」で開くフォルダ選択（[[../basic_design/07_export_print.md#2]]）。(c) ミラー先のフォルダの指定（[[../basic_design/06_file_io_persistence.md#2]] の「ミラー（バックアップ）先」、設定ダイアログの 10 項目目。[[data-model-persistence.md#11]]）。 <!-- req 01:3ae7674a.6b1c --> 3 つとも基本設計 01 章 4.1 節の「⑤のうちファイル選択ダイアログ」に挙げてある。 <!-- req 01:ed9d890f.6ebc --> <!-- req 01:3ae7674a.371c --> <!-- req 01:3ae7674a.36ae --> <!-- req 13:dcf8dce0.3b23 -->
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
| React | UI のフレームワーク。import してよいのは `packages/ui-desktop` と `packages/ui-shared` だけ（4.1 節） | `packages/ui-desktop` と `packages/ui-shared` の依存（5.2 節） <!-- req 01:5f6fab94.8e39 --> |
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
- アプリの版の持ち方（`apps/desktop`・`apps/mobile`・`packages/core` の版をどう刻むか）は、15 章の回で書く。 書いた先は 15.8 節。 <!-- req 13:216ea5db.1316 --> <!-- req 13:216ea5db.37bd --> <!-- req 13:216ea5db.85eb --> <!-- req 13:216ea5db.b160 --> <!-- req 13:216ea5db.0faa --> <!-- req 13:216ea5db.a0fb --> <!-- req 13:216ea5db.632c --> <!-- req 13:216ea5db.4c4f --> <!-- req 13:f2451ce3.26da -->

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

- カポの位置は、alphaTab の標準機能の `Staff.capo` に持つ。基本設計 02 章の `capoFret` を変えたときは、`Staff.capo` にもその値を入れる。 <!-- req 01:17b05df6.0a4a --> <!-- req 01:e9a0918b.f0f2 --> <!-- req 12:3aa511e1.4459 --> <!-- req 12:354144c7.58ab -->
- 実音への読み替え（開放弦の音高＋`capoFret`＋記譜のフレット）は、alphaTab の標準機能に委ねず自作する。 <!-- req 01:17b05df6.49ab --> <!-- req 13:1ba4f8e7.ed29 -->
- 読み替えは 1 つの関数にまとめ、[[../basic_design/05_playback_audio.md#10]] の変換式をそこだけに書く。関数の名前とシグネチャは playback-integration.md（基本設計 05 章の回）に書く。 <!-- req 01:17b05df6.7c5c --> <!-- req 01:e9a0918b.e92b -->
- MIDI 書き出しとコード推定（[[../basic_design/04_editing_core.md#7]]）の 2 か所は、その関数を呼び、自分の中で加算を書かない。 <!-- req 01:e9a0918b.0925 --> <!-- req 01:e9a0918b.dacf --> <!-- req 13:a95f400c.aa34 -->
- 再生は、その関数を呼ばず、alphaTab が `Staff.capo` を足して出す音の高さに任せる。そこと関数の値が同じになることを単体テストで見張る（[[../basic_design/13_design_decision_points.md#2]] A14 の (b)、2026-10-10 本人決定。テストの組み方は playback-integration.md の 9.2 節）。 <!-- req 01:e9a0918b.e774 --> <!-- req 01:e9a0918b.40c5 -->
- (b) 関数の置き場所は `packages/core/src/domain` とする。呼ぶ 2 か所（`packages/core/src/export`・`packages/core/src/editing`）と、再生と比べる単体テスト（`packages/core/src/playback` の側）はどれも L2 で、2.2 節の表では L2 どうしは import できないので、共に import できる L3 に置く。
- alphaTab のシンセが `Staff.capo` を再生の音の高さに足すかは、Phase 0 の実機で [[../basic_design/13_design_decision_points.md#2]] A14 として確かめる。足さないと分かったときの再生への渡し方は、playback-integration.md の 9.2 節に書く。 <!-- req 13:a95f400c.c111 -->

### 9.3 自作する範囲 <!-- req 01:99fa2738.9142 --> <!-- req 01:99fa2738.783c --> <!-- req 01:99fa2738.e23d -->

- 自作するのは、エディタの UI（`packages/ui-desktop`・`packages/ui-shared`・`packages/core/src/ui`）、アプリ独自のデータモデル（`packages/core/src/domain` の Score のラッパーとサイドカーのメタデータ）、各ラッパー層の統合部分に限る。(b) 「各ラッパー層」は、alphaTab を包む窓口（`packages/core/src/rendering` と、再生の窓口）と、プラットフォームを包むアダプタ（3 節）の両方と読む。 <!-- req 01:cc6799d4.3cf2 --> <!-- req 01:cc6799d4.b037 --> <!-- req 01:cc6799d4.e3c1 -->
- 9.1 節の表の範囲（9.2 節のカポの読み替えと、要件 9 章が自前で作ると定めている MIDI 書き出し〈export-print.md、基本設計 07 章の回〉は除く）について、下位の設計（詳細設計と実装）で自前の描画の規則と解釈の規則を新しく起こさない。9.2 節のカポの位置の保持（`Staff.capo` に持つこと）も、この範囲に入れる。
- alphaTab の標準機能で足りないと分かったときは、実装のコードを先に書かず、まず [[../basic_design/13_design_decision_points.md]] に分岐点として起こし、そこで方針を決めてから実装に進む。 <!-- req 01:417b4b86.b21d -->

## 10. 起動・メモリ・描画の方針

[[../basic_design/01_architecture.md#6]] を受ける。目標値は基本設計 09 章が正で、本節はアーキテクチャの側で決めることだけを書く。 <!-- req 12:467ffe48.a517 -->

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

- 100 小節を超える曲でも速さを保つため、フォーカス表示で描く小節を絞り、全部の小節を一度に DOM に描く仕組みを自前で作らない。 <!-- req 01:1bc94906.a335 --> <!-- req 12:6ad3bdd2.202c -->
- alphaTab の遅延描画（画面の外の小節を後で描くしくみ）は使わない。alphaTab の設定の `core.enableLazyLoading`（既定は `true`）に `false` を渡す（[[../basic_design/13_design_decision_points.md#3]] B30）。渡すのは、4.1 節の `core.engine` と同じ `packages/core/src/rendering` の 1 か所だけ。 <!-- req 01:1bc94906.b94e --> <!-- req 13:e6a4a9ca.78ed -->
- 大曲の全体表示の速さは、[[../basic_design/13_design_decision_points.md#2]] A9 で実機を使って確かめる。 <!-- req 01:1bc94906.1559 -->
- 30fps のための描き方は 12 節。

### 10.4 入力の反応と再生の開始

[[../basic_design/09_nonfunctional.md#1]] の入力の反応（100ms）と再生の開始（200ms）を受ける。

- 音符の入力に対して、画面への反映とシンセへの反映（ノートオン）を分けて処理する。上限は画面と音で片方ずつ 100ms とし、内訳（画面に何 ms、音に何 ms）は決めない。 <!-- req 09:4148ac6c.a5a2 --> <!-- req 09:4148ac6c.cc9b -->
- 画面への反映を先に行う。同じ入力のイベントの処理の中で AlphaSynth にノートオンを出し、入力から発音までを 100ms の内側に収める。ノートオンの出し方は playback-integration.md（基本設計 05 章の回、[[../basic_design/05_playback_audio.md#3.2]]）に書く。 <!-- req 09:4148ac6c.029e --> <!-- req 09:4148ac6c.9eb6 --> <!-- req 09:4148ac6c.3337 --> <!-- req 13:d2196294.3faf -->
- 再生中は、ノートオンを試しの音用の 2 つ目の AlphaSynth に出し、曲を止めずに鳴らす（[[playback-integration.md#8]] の 8.2 節の `PreviewSynth`。止めているときも同じシンセで鳴らす）。 <!-- req 09:4148ac6c.c39a --> <!-- req 13:d2196294.1751 -->
- コマンドの実行はファイルの I/O を伴わない（[[editing-core.md#2]] の 2.1 節）。自動保存はコマンドの実行とは別に非同期で行い、数秒の間隔でまとめて保存する（デバウンス）。秒数と保存の手順は data-model-persistence.md（基本設計 06 章の回、[[../basic_design/06_file_io_persistence.md#5]]）に書く。 <!-- req 09:4148ac6c.123f --> <!-- req 09:9039fe30.4f75 -->
- 再生ボタンを押してから音が出るまでを 200ms 以内にする。音源の読み込みの時機と、読み終わるまで再生ボタンを押せないことは playback-integration.md（基本設計 05 章の回、[[../basic_design/05_playback_audio.md#9]]）に書く。 <!-- req 09:21da7cff.757d -->

### 10.5 自動保存のシリアライズの重さ

- 自動保存で曲全体を毎回シリアライズせず、変更のあった小節（Bar）やパート（Part）だけを差分でシリアライズする方式を検討する。 <!-- req 09:25f6e257.48d9 --> <!-- req 09:25f6e257.d67b -->
- (b) 差分にするかは、実装のときに JSON のシリアライズの時間を 2048 小節の大曲のデータ（10.6 節）で測ってから決める（[[../basic_design/13_design_decision_points.md#2]] A6）。曲全体の 1 回のシリアライズが 100ms 未満なら、簡潔さを優先して差分にしない。シリアライズは入力と同じレンダラーで動くので、入力の反応の上限（10.4 節）を線にするため。 <!-- req 09:25f6e257.687d --> <!-- req 09:25f6e257.fb6b --> <!-- req 13:b3467249.d90f -->
- 測った曲全体の 1 回のシリアライズが 100ms 以上なら、変更のあった小節（Bar）とパート（Part）だけを差分でシリアライズする方式へ切り替える（基本設計 13 章 A6 の (b)）。 <!-- req 13:b3467249.dbc3 -->

### 10.6 負荷テスト

- Phase 1 の後半に、2048 小節・全部の奏法記号を含む開発用サンプルデータ（`packages/core/src/testing`、5.1 節）を、想定利用の 4 パートと上限の 8 パートの 2 つ用意する。09 章 1 節と 3 節の目標値は、4 パートのデータで満たすことを実測で確かめる。8 パートのデータでは落ちずに動くことを確かめて測った値を記録し、目標値を超えても不合格にしない（[[../basic_design/09_nonfunctional.md#2]]、2026-09-28 本人決定）。 <!-- req 09:d75ce8cf.5088 --> <!-- req 09:d75ce8cf.5d4d --> <!-- req 09:d75ce8cf.bbfb --> <!-- req 09:d75ce8cf.5b17 --> <!-- req 09:d75ce8cf.64d8 --> <!-- req 09:f4718ad1.0b1d --> <!-- req 09:f4718ad1.e6fe --> <!-- req 09:f4718ad1.6852 --> <!-- req 09:f4718ad1.c94f --> <!-- req 09:f4718ad1.f7ff -->
- 同じ負荷テストで、[[../basic_design/13_design_decision_points.md#2]] の A6（シリアライズ）・A8（描き直しと 100ms）・A9（全体スクロールとズーム中の fps）を確かめる。手順は 14.8 節。 <!-- req 09:1d2c825a.8aa8 --> <!-- req 09:1d2c825a.7e68 --> <!-- req 09:1d2c825a.5dab --> <!-- req 13:575e4e1d.498a --> <!-- req 13:575e4e1d.0e2d --> <!-- req 13:ddaee6e8.720a -->
- 負荷テストより前に、Phase 0 で SoundFont を選ぶときに、試しの音用の 2 つ目の AlphaSynth に同じ SoundFont を読ませたときのメモリの増えを測る（基本設計 13 章 A15 の条件 ③）。通常の編集の 400MB にゆとりを持って収まらなければ、[[playback-integration.md#8]] の 8.2 節の `PreviewSynth` を 'song-boundary' の形にする（playback-integration.md 12 節）。(b) ゆとりの幅は、SoundFont を選んで 1 つ目の常駐の大きさが分かってから、測った値と並べて本人が決める。今の時点では、決める材料（1 つ目の大きさ）が無いため。 <!-- req 13:d2196294.531e -->

## 11. alphaTab の検証事項

[[../basic_design/01_architecture.md#7]] を受ける。

- 編集は alphaTab の専用の API を使わず、アプリの側で Score のオブジェクトを直接変えてから、描き直しを頼む方式とする（[[../basic_design/13_design_decision_points.md#2]] A1）。描き直しを頼むのは `CommandHistory`（[[editing-core.md#2]]）。 <!-- req 01:9e38ea0c.124a -->
- A1 の自前の方式では、コマンド層が Score のモデルを直接変えた後、描き直しに alphaTab の `AlphaTabApi.renderScore(score, trackIndices)`（内部は `ScoreRenderer.renderScore`）を呼ぶ。これを呼ぶのは 12.1 節の `ScoreRenderHost.render(trackIndices)` の中だけで、`CommandHistory` は `render` を呼ぶ。 <!-- req 13:0188afa2.3f9b -->
- Score のどのプロパティを変えれば安全かの切り分けは、[[../basic_design/13_design_decision_points.md#2]] A1 で、プロパティごとには分けず、コマンドの実行と取り消しのたびに `CommandHistory` が対象のトラックだけを一律に描き直す方式に決まっている。この決定と理由は editing-core.md（基本設計 04 章の回）に書く。
- 描画エンジンは SVG とする（A2。設定は 4.1 節の `core.engine`）。 <!-- req 01:47c71afa.1e6f --> <!-- req 13:6e832a7a.0e46 -->
- パートが 0 の曲を alphaTab がそのまま描けるかは、まだ確かめていない。描けない前提で、パートが 0 のときはアプリの側で描画を呼ばず、案内を出す（案内の中身は [[../basic_design/03_screens_ui_pc.md#10]]、screens-navigation.md に書く）。(b) 描画を呼ぶかどうかの判断は `packages/core/src/rendering` の窓口で行う。alphaTab を呼ぶ所がそこだけだから（2.1 節）。 <!-- req 01:9eabe9c3.bcd0 -->
- 描けるかどうかは実装の前に確かめ、確かめた結果で本節を直す。 <!-- req 01:9eabe9c3.7630 -->

## 12. 描画の窓口

[[../basic_design/09_nonfunctional.md#1]] の描画 30fps と、[[../basic_design/09_nonfunctional.md#2]] の大曲の描き方を受ける。目標値は基本設計 09 章が正で、本節は alphaTab の描画を呼ぶ窓口の形と、30fps のための描き方を書く。

### 12.1 窓口のクラス

- alphaTab の描画を呼ぶのは、`packages/core/src/rendering` の `ScoreRenderHost` だけとする（2.1 節）。ほかのモジュールは alphaTab の `AlphaTabApi` に直接触れない。`ScoreRenderHost` は `AlphaTabApi` を 1 つ持ち、初期化・曲の読み込み・描き直し・破棄の窓口になる。
- 形は次のとおり。表示モードの種類と切り替えの決まりは view-modes.md。ズーム（`applyZoom`）・エラーのハイライト（`showErrorHighlight`・`clearErrorHighlight`）・パートの描画の領域（`getPartRegions`）のメソッドも本節に置く（基本設計 03 章と 08 章の回から本節へ申し送られていた分を、2026-10-14 に足した）。 <!-- req 13:db3aa32d.3322 --> <!-- req 13:db3aa32d.5938 -->

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
  activeVoiceIndex?: 0 | 1;  // 編集で選んでいるボイス。もう一方を薄く出す（view-modes.md 1.5 節）。'score' では見ない
}

/** Error のハイライトの要求。screens-navigation.md 13.2 節の ScoreHighlightBinder が組み立てる。小節の番号は 0 始まり。 */
export interface ScoreHighlightRequest {
  trackIndex: number;
  startBarIndex: number;
  barCount: number;     // 1 以上
  code?: string;        // 知らせたエラーコード。重ねる <div> の data-code に入れる
  durationMs?: number;  // 省いたら DEFAULT_HIGHLIGHT_DURATION_MS
}
/** ハイライトを外すまでの既定の長さ（ミリ秒）。 */
export const DEFAULT_HIGHLIGHT_DURATION_MS = 4000;

export class ScoreRenderHost {
  initialize(container: HTMLElement, options: RenderHostOptions): void;
  loadScore(score: unknown): void;         // 下の (b)。model.Score でなければ描かずに renderError で知らせる
  render(trackIndices?: number[]): void;   // 描き直しを頼むのは CommandHistory（11 節）。描く前に rebuildDerivedLinks を呼ぶ（下の「描く前の作り直し」）
  applyViewMode(request: ViewModeRenderRequest): void;
  applyZoom(scale: number): void;          // 1 が 100%。display.scale に入れて描き直す（view-modes.md 1.3 節）
  showErrorHighlight(request: ScoreHighlightRequest): void;  // 下の「エラーのハイライト」
  clearErrorHighlight(): void;
  getPartRegions(): PartRegion[];          // PartRegion の形は view-modes.md 1.2 節。型は packages/core/src/rendering から出す
  on(event: RenderHostEvent, listener: () => void): void;
  off(event: RenderHostEvent, listener: () => void): void;
  get isInitialized(): boolean;
  dispose(): void;
  static parseAlphaTex(tex: string): model.Score;
}

// packages/core/src/rendering/rebuildDerivedLinks.ts
import type { Settings } from '@coderline/alphatab';
/** 描く前の作り直し。タイの指定が外れた音符のつながりを空にしてから score.finish(settings) を呼ぶ。 */
export function rebuildDerivedLinks(score: model.Score, settings: Settings): void;
```

- (b) `parseAlphaTex` の戻り値の型は、alphaTab の `model.Score` とする（作り直す前は `unknown`）。Score は alphaTab のデータそのもの（基本設計 AD-1、[[data-model-persistence.md#2]]）で、戻り値の型を詳しくしても、前からの呼ぶ側はそのまま通るため。`loadScore` の引数の型は前からの `unknown` のままとし、中で alphaTab の `model.Score` かを確かめ、違えば描かずに `renderError` で知らせる。引数の型を `model.Score` に狭めると、Score 以外を渡している前からの呼ぶ側が通らなくなり、下の決まりに反するため（2026-10-16、13 章の回の照合で直した）。
- 公開のシグネチャは足す形でだけ広げ、前からあるメソッドの名前・引数・戻り値を変えない（基本設計 13 章 B34。B30 から B33 と同じ決まり）。表示モードとズームの `applyViewMode`・`applyZoom`（パッケージ 6）と、エラーのハイライトとパートの領域の `showErrorHighlight`・`clearErrorHighlight`・`getPartRegions`（パッケージ 8）は、どれも前からある `initialize`・`loadScore`・`render`・`on`・`off`・`dispose`・`parseAlphaTex` を変えずに足したメソッドとする。12.2 節の (2) のフォールバックも、公開のシグネチャを変えずに入れる。上の (b) で変えた型は `parseAlphaTex` の戻り値だけで、引数の型は変えていない。 <!-- req 13:8453f7e8.54e3 -->
- 描く前の作り直し（[[../basic_design/13_design_decision_points.md#3]] B33、2026-10-17 本人決定、honnin-queue 141 番の案 A）：`render(trackIndices)` は、alphaTab の描き直し（11 節の `AlphaTabApi.renderScore`）を呼ぶ前に、読み込んだ曲の `Score.finish` を呼び、`finish()` が作る派生情報の 4 つ（拍の番号 `beat.index`、前後の拍 `previousBeat`・`nextBeat`、タイによるフレットの写しとつながり `tieOrigin`・`tieDestination`、スライドの行き先 `slideTarget`）をまとめて作り直す。alphaTab 1.8.4 の描き直しの通り道は `Score.finish` を呼ばない（[[editing-core.md#3]] の 3.4 節の注）ため。コマンドと `CommandHistory` は `Score.finish` を呼ばない（[[editing-core.md#2]] の 2.4 節）。 <!-- req 13:d61592c0.8cde --> <!-- req 13:d61592c0.d3ff -->
- `render` の中の順は次の 3 つとする。(1) タイの指定（`isTieDestination`）が偽で `tieOrigin` が空でない音符について、その `tieOrigin` の `tieDestination` がこの音符なら空にし、この音符の `tieOrigin` を空にする (2) `score.finish(api.settings)` を呼ぶ (3) `renderScore(score, trackIndices)` を呼ぶ。(1) を (2) の前にするのは、alphaTab 1.8.4 の `Note.chain` が、`tieOrigin` が空でなければタイの指定が偽の音符でも先へ進み（6496 行の条件）、取り消したタイをもう一度張ってフレットを写すため。
- (b) (1) と (2) は、上の `rebuildDerivedLinks` に切り出し、`render` はこれを呼ぶ。描き直しの DOM が無い単体テストからも、同じ作り直しを呼んで確かめられるようにするため。`applyViewMode`・`applyZoom` は曲の中身を変えないので、作り直さずに描き直す。単体テストの行は [[editing-core.md#3]] の 3.4 節のタイの写し方の下に置く。
- Phase 0 で確かめること（2026-10-17 本人決定）：(1) 同じ曲に `Score.finish` を続けて 2 回呼んで、拍の番号・前後の拍・タイのつながりとフレット・スライドの行き先が 1 回目の後と変わらないこと (2) 2048 小節の曲（14.8 節の手順 1 のフィクスチャ）で、作り直しを含む描き直しが、基本設計 13 章 A8 の目安の 100ms（基本設計 09 章 1 節）に収まること。
- Phase 0 の (1) か (2) が成り立たなかったときは、案 B に替える：タイとスライドのコマンドの中でつながりも張る・外す（今のコードのタイの形）。拍の番号と前後の拍をどこで作り直すかは、替えるときに決める。替えるときは、基本設計 13 章 B33 と、本節と、editing-core.md の 2.4 節と 3.4 節を同じ変更の中で直す。
- 今のコードとの違い：今の `ScoreRenderHost.render`（`packages/core/src/rendering/ScoreRenderHost.ts`）は `Score.finish` を呼ばず、`rebuildDerivedLinks` も無い。直すのは実装の段（[[00_reference.md#8.1]] の G78）。
- エラーのハイライト（基本設計 03 章 11 節と 08 章 1 節の、Error の「譜面上の該当箇所を赤枠ハイライト」）：`ScoreRenderHost` は、[[screens-navigation.md#13]] の 13.2 節の `ScoreHighlightHost`（`showErrorHighlight`・`clearErrorHighlight`）を、名前と引数をそろえて満たし、`ScoreHighlightBinder` から呼ばれる。`showErrorHighlight` は、`trackIndex` のパートの、`startBarIndex` から `barCount` 個の小節を囲む赤い枠を、表示領域の上に重ねた `<div>` で出す。alphaTab が描いた SVG は書き換えない。前に出ていたハイライトは外してから出し、同時に出すハイライトは 1 つにする。`durationMs`（省いたら `DEFAULT_HIGHLIGHT_DURATION_MS` の 4000 ミリ秒）たったら外す。`clearErrorHighlight` は、出ていないときに呼んでも何もしない。`dispose` でも外す。 <!-- req 11:79ee6792.618b -->
- (b) 小節の矩形は、alphaTab の `boundsLookup.findMasterBarByIndex(小節の番号)` が返す `MasterBarBounds` の `bars`（`BarBounds` の並び）から、`bar.staff.track.index` が `trackIndex` に当たるものの `visualBounds` を取り、範囲の小節を段ごとに 1 つの枠へまとめる（範囲が段をまたげば、段ごとに枠を出す）。範囲の小節が今の描画に無い（フォーカス表示の範囲の外）ときは、描いている小節だけに枠を出し、1 つも無いか、描く前で `boundsLookup` が無いときは枠を出さない（ステータスバーのメッセージは [[screens-navigation.md#13]] の 13.1 節のとおり出る）。alphaTab 1.8.4 の型定義（`BoundsLookup.findMasterBarByIndex`・`MasterBarBounds.bars`・`BarBounds.bar`・`BarBounds.visualBounds`）で、小節の番号からパートごとの矩形までたどれることを確かめたため。
- (b) 枠の色は、[[screens-navigation.md#13]] の 13.2 節の表の Error の行のとおり `danger` のトークン（CSS 変数 `--color-danger`）で、直値を書かない（基本設計 08 章 4 節）。枠には `pointer-events: none` を付け、クリックを下の譜面へ通す。ハイライトが出ている間も、譜面の上の操作を止めないため（同じ表の Error の行の「他の操作は続けられる」）。
- パートの描画の領域：`getPartRegions` は、今描いている譜面の、パートごとの矩形を返す。スコア表示の色の帯（[[view-modes.md#1]] の 1.2 節の `PartColorOverlay`）が使う。矩形は段（`boundsLookup.staffSystems` の 1 つ）ごと・パートごとに 1 つとし、[[part-tuning-management.md#2]] の 2.2 節のたどり方（`StaffSystemBounds.bars` → `MasterBarBounds.bars` → `BarBounds.bar.staff.track.index`）で同じパートの `BarBounds.visualBounds` を合わせた矩形にする。座標は表示領域の左上を原点にした CSS ピクセル。描く前（`boundsLookup` が無い）は空の配列を返す。(b) alphaTab 1.8.4 の `StaffSystemBounds` はパートごとの矩形を持たない（型定義の項目は `index`・`visualBounds`・`realBounds`・`bars`・`boundsLookup`・`isFinished`）ので、小節の側から組み立てるため。 <!-- req 11:79ee6792.17f1 -->
- 今のコードとの違い：今の `resolvePartRegions`（`packages/core/src/rendering/ScoreRenderHost.ts`）は、1.8.4 の `StaffSystemBounds` に無い `tracks` を読むので、いつも空の配列を返し、色の帯もパートの矩形を使うハイライトも出ない。今の `showErrorHighlight` は、小節の範囲を見ずにパートの矩形全体に枠を出し、色を直値（`#d64545`）で書き、矩形が無いときに表示領域の上端に帯を出す。どれも本節に合わせて実装の段で直す（[[00_reference.md#8.1]] の G76）。

### 12.2 30fps のための描き方

- alphaTab の描画は Web Worker を使わず、メインスレッドで同期に行う。alphaTab の設定の `core.useWorkers` に `false` を渡す（[[../basic_design/13_design_decision_points.md#3]] B30。Web Worker の自動生成が CSP の `script-src 'self'` とぶつかり、`renderFinished` が返らなかったため）。渡すのは、4.1 節の `core.engine` と 10.3 節の `core.enableLazyLoading` と同じ `initialize` の中の 1 か所だけ。 <!-- req 13:e6a4a9ca.4356 --> <!-- req 13:c93c2074.f129 -->
- 30fps は、フォーカスビューで描く小節を、編集している所の周りの数小節に絞ることで満たす。`applyViewMode` は、フォーカスビューのとき、alphaTab の設定の `display.startBar`（1 始まり。`focusRange.startBarIndex` に 1 を足す）と `display.barCount` に範囲を渡し、その範囲だけを描かせる。遅延描画（10.3 節）には頼らない。 <!-- req 09:a5353947.494c --> <!-- req 09:b10c95b9.e7fa -->
- 全体スクロールビューと、スコア表示の大曲は、alphaTab の描画をそのまま使い、簡易描画のレイヤーを作らない。 <!-- req 09:b10c95b9.b49d --> <!-- req 09:b10c95b9.2097 --> <!-- req 13:ddaee6e8.2b46 --> <!-- req 13:ddaee6e8.094f --> <!-- req 13:ddaee6e8.1878 --> <!-- req 13:9d33f89c.b62a -->
- 全体スクロールビューとスコア表示の大曲のとき、およびズームの操作中に 30fps に届かないと負荷テスト（10.6 節）で分かったときだけ、[[../basic_design/13_design_decision_points.md#2]] A9 のフォールバックを入れる。フォールバックは 2 つで、(1) 細かい記譜を省いた簡易描画のレイヤーに切り替える、(2) 専用のワーカーのスクリプトを同梱し、非同期の描画に戻す。(2) は `ScoreRenderHost` の中の `core.useWorkers` の切り替えで入れ、公開のシグネチャは変えない。どちらを入れるかは、届かない場面を測ってから決める。 <!-- req 09:a5353947.4d79 --> <!-- req 09:a5353947.1bb9 --> <!-- req 09:a5353947.e255 --> <!-- req 09:b10c95b9.ff69 --> <!-- req 13:ddaee6e8.903a --> <!-- req 13:ddaee6e8.2a21 --> <!-- req 13:ddaee6e8.5d5e --> <!-- req 13:e6a4a9ca.2e5e -->
- (2) を入れるときも、10.3 節の `core.enableLazyLoading: false` は変えない。(2) で行うのは、非同期の描画へ戻すことだけとする（基本設計 13 章 A9 の (c)、2026-10-09 の是正）。 <!-- req 13:ddaee6e8.1c58 -->

### 12.3 曲一覧のサムネイル

- 曲一覧のサムネイルは、曲の最初の 1 段（alphaTab のレイアウトでの最初の段）だけを描き、曲全体を描かない（[[../basic_design/13_design_decision_points.md#3]] B7）。作る時機と置き場所は data-model-persistence.md と screens-navigation.md（基本設計 06 章と 03 章の回）に書く。 <!-- req 09:d7d57e7d.9544 --> <!-- req 13:322eeba4.0746 -->

### 12.4 印刷用の描画

- 印刷と PDF のための描画は、`ScoreRenderHost` を広げず、別のクラス `PrintLayoutRenderHost` にする（[[../basic_design/13_design_decision_points.md#3]] B21）。中身は export-print.md（基本設計 07 章の回）に書く。 <!-- req 13:138b5e11.f3f3 -->

## 13. 将来の拡張の受け方

[[../basic_design/10_extensibility_future.md]] を受ける。将来の機能をどの仕組みで受けるかの決まりは基本設計が正で、本節は、その決まりを v1 のパッケージ・アダプタ・クラスのどこで受けるかと、v1 で置かないものを書く。v1 で作らない機能のクラスとシグネチャは、その Phase の着手時の詳細設計で書く。同時に編集したときの限界（基本設計 10 章 7 節）は [[data-model-persistence.md#14]] の 14.3 節に書く。 <!-- req 00:a444063b.7df6 --> <!-- req 00:a444063b.2f09 --> <!-- req 00:a444063b.2a76 --> <!-- req 00:a444063b.4658 --> <!-- req 00:a444063b.e093 --> <!-- req 00:a444063b.e20f --> <!-- req 00:a444063b.45f2 -->

### 13.1 拡張の範囲

- 要件で「不要」と判定した機能も、一つずつ並べて受けるのではなく、仕組みとして拡張を妨げない形で受ける。 <!-- req 10:3e2c5305.ed02 -->
- 要件定義書の「不要」の表記は、すべてこの形の対象とする。対象は要件定義書を「不要」で全文検索して決め、13.2 節の表は代表を並べたもので、網羅の一覧ではない。 <!-- req 10:afe9eb01.d9e2 -->
- 検索で当たった各行について、将来の追加をどの仕組みで受けるかが、基本設計 10 章のいずれかの節か、その判定を引き受けた設計書の節に書かれていることとする。詳細設計では、本節と各書の「v1 では作らない」の文がそれを受ける。 <!-- req 10:c88e22fd.7777 -->
- 設計書の側で「不要」「提供しない」と決めた機能は、その判定を引き受けた節が自分の言葉で理由を持ち、要件や別の章へ「要件により不要」と投げ返さない。詳細設計の各書も、この決まりで書く。 <!-- req 10:e4269176.375d -->
- v1 で構造の余地を用意する拡張点は、次の表の 4 つに限る。将来の拡張として見込むのも、この 4 つだけとする。 <!-- req 10:6f45545d.6c30 --> <!-- req 10:04e486f9.3971 --> <!-- req 12:8689c2b1.6734 --> <!-- req 00:a444063b.1a39 -->

| # | 拡張点 | v1 の余地の所在 |
|---|---|---|
| ① | パート種別の抽象化（将来のドラム） | `Part.instrumentType` を列挙の型で持つ（[[part-tuning-management.md#2]]）。打楽器かどうかは、データモデルの土台の alphaTab の型が持つ `Staff.isPercussion` で受け、打楽器の種類は `Note.percussionArticulation` で受ける（[[editing-core.md#3]] の 3.6 節）。 <!-- req 10:04e486f9.9a84 --> <!-- req 10:ba93d221.918d --> <!-- req 10:ba93d221.37d1 --> <!-- req 10:ba93d221.5a54 --> |
| ② | ストレージ層の複数のバックエンド | 保存先を 1 つの「フォルダのパス」として扱い、バックエンドごとの分かれ道を持たない（3.2 節）。v1 で、ローカル・iCloud Drive・Google Drive・カスタムフォルダの 4 つを持つ（[[../basic_design/06_file_io_persistence.md#2]]）。 <!-- req 10:04e486f9.f28a --> <!-- req 10:2ef19114.b968 --> <!-- req 10:2ef19114.ab23 --> |
| ③ | 書き出しの形式の追加 | 形式ごとの変換を、差し替えられる別々のクラス（`AlphaTexExportService`・`MidiExportService`・PDF の `PrintWindowController`）に分けて持ち、`ExportService` が形式で呼び分ける（[[export-print.md#1]]・[[export-print.md#2]]）。形式を足すときは、変換のクラスを 1 つ足して `ExportService` から呼ぶ。v1 の形式は PDF・alphaTex・MIDI の 3 つ <!-- req 10:04e486f9.e030 --> <!-- req 10:c52a4896.5875 --> <!-- req 10:c52a4896.1559 --> <!-- req 10:c52a4896.67e3 --> <!-- req 10:c52a4896.b075 --> |
| ④ | 音源（SoundFont）の差し替え | SoundFont は、アプリに同梱するファイルとして持つ（4.1 節）。再生エンジンは、そのファイルを読む側として作る（[[playback-integration.md#1]] の 1.1 節の `player.soundFont`）。差し替えはファイルの入れ替えで済み、コードを変えない。 <!-- req 10:04e486f9.409e --> <!-- req 10:8cb83235.be8b --> <!-- req 10:8cb83235.e700 --> <!-- req 10:8cb83235.260c --> |

- この 4 つは、v1 の時点で上の表の構造の余地を持つ。後から足しても、データモデルを作り直さない。層の構成（2 節）も作り直さない。 <!-- req 10:b89aac02.a11c --> <!-- req 10:b89aac02.0d73 --> <!-- req 10:b89aac02.50ed --> <!-- req 00:4e8d2b9b.e98a -->
- 4 つの外の拡張には、v1 で先回りの構造を作らない。13.2 節の表の行（「不要」と判定した機能の受け方）も、v1 で構造を作る対象ではない。 <!-- req 10:63d050f3.ba66 --> <!-- req 10:cbecb6b0.36ae -->
- ただし、要件定義書 9 章のフェーズの計画で Phase 2 に入っているものと Phase 3 に入っているもののための構造は、4 つの外でも v1 で置いてよい。 <!-- req 10:0482c14a.6ad6 --> <!-- req 10:0482c14a.ce27 -->
- 計画に無い将来の機能（13.2 節の表の行のうち、要件 9 章の Phase 2 にも Phase 3 にも入っていないもの）のためには、v1 で構造を作らない。 <!-- req 10:5aa3b868.2a50 --> ピッチ検出による自動採譜（音を聞かせて自動でタブ譜にする機能）は、完全にスコープの外とし、将来の Phase の拡張点も用意しない。13.2 節の表にも行を置かない。将来欲しくなったときは、要件定義からやり直す（基本設計 00 章 6 節）。 <!-- req 00:fdd36a09.0bc8 --> <!-- req 00:fdd36a09.3df4 --> <!-- req 00:fdd36a09.1d80 --> <!-- req 00:fdd36a09.e518 -->

### 13.2 「不要」と判定した機能の受け方

| 機能 | v1 | 足すときの受け方 |
|---|---|---|
| アプリロック | 作らない。`AuthAdapter` の空の型も置かない（3.1 節）。空の型を先に置くと、使われない型が単一の真実源を濁らせるだけで、足すときの容易さには役立たないため（3.1 節の将来の 6 つのアダプタの型を v1 で置かないのも同じ理由）。 | 必要になった時点で、3.1 節の形で `AuthAdapter` を新しく定義する。足すのはアダプタ 1 つと起動のときの注入だけで、既存の流れ（コマンド層・データモデル・画面）には手を入れない。 <!-- req 10:8f58f3be.4484 --> <!-- req 10:8f58f3be.9036 --> <!-- req 10:8f58f3be.1a19 --> <!-- req 13:7f1b756e.111b --> |
| 自動アップデート | `UpdateCheckAdapter` のダミーの実装（13.3 節） | 13.3 節 |
| コード署名 | 署名しない。署名の無い実行ファイルに Windows SmartScreen が出す警告は、そのまま許す。署名でない回避策（配り方を変えること、ダウンロードの実績を積んで評判を上げること）は、どれも取らない。効くのは証明書での署名だけで、署名でない手立ては個人の配布の規模では効きが見込めないため。 | 署名すると決めたら、8.4 節の Electron Builder の設定ファイルに署名の工程を足すだけにする <!-- req 10:0d072623.a7bc --> <!-- req 10:0d072623.e64a --> <!-- req 10:0d072623.53af --> <!-- req 12:612b52fb.64b2 --> |
| ダークモード | ダーク用の構造を作らない。 | 基本設計 10 章 1 節の 3 つの作業で足す <!-- req 10:d9b6bc13.3700 --> |
| 曲一覧の検索・タグの絞り込み | 曲一覧に、検索の欄の器も置かない。 | 足すときも、v1 のタグのデータ（[[data-model-persistence.md#6]] の 6.3 節の `tags`）をそのまま使う。 <!-- req 10:fb7751e9.1254 --> <!-- req 10:fb7751e9.e265 --> |
| 曲のステータス管理 | 専用の項目（`status`）を持たない。進捗の区別は、利用者が自分で作って付けるタグで代わりにし、既定のステータスのタグを 1 つも用意しない（[[../basic_design/02_data_model.md#3.1]] の `tags` の行、[[data-model-persistence.md#6]] の 6.3 節）。用意すると、要件が避けたステータスの専用の機能を、名前だけ変えて持つことになるため | 足すときも、タグ（`tags`）の上に作る |
| 移調 | 移調のための構造を作らない。 | 選んだ範囲の音符のフレットを書き換えるコマンドを 1 つ、コマンド層（[[editing-core.md#2]]）に足すだけにし、データモデルを変えない。 <!-- req 10:a8c364ba.069e --> <!-- req 10:a8c364ba.5bb6 --> |
| 通知 | 通知のための構造を作らない。 | OS の通知を出す口を、3.1 節の形で新しいアダプタとして足す。既存のコマンド層とデータモデルには手を入れない。 <!-- req 10:dd459e4e.e3ec --> <!-- req 10:dd459e4e.c32f --> <!-- req 10:dd459e4e.2b07 --> |
| 音声メモ | 作らない | 小節メモ（[[data-model-persistence.md#6]]）に音声のファイルを指す項目を 1 つ足し、録音はアダプタを 1 つ足して受ける。メモの並びと小節の参照は変えない。 <!-- req 10:b407392f.a6e0 --> <!-- req 10:b407392f.d92c --> |
| EQ とリバーブ | 作らない（ミキサーは音量・パン・ソロ・ミュートだけ、[[screens-navigation.md#12]] の 12.5 節） | ミキサーのパートの設定に効果の値を足し、`PlaybackService` の音の出口に効果を挟んで受ける。AlphaSynth の出口に効果を挟めるかは未確認（推測）で、足すときに確かめる |
| 曲一覧の一括操作 | 作らない | 曲一覧の選択を複数の曲を持てる形にし、今の 1 曲ずつの操作を選んだ曲の数だけ呼ぶ。1 曲ずつの操作の中身は変えない。 <!-- req 10:988e5099.4987 --> |
| コードダイアグラム | 作らない | コード名のデータに押さえ方（弦ごとのフレット）を足し、alphaTab のコードダイアグラムの表示を使う。表示の形を自作しない（9.3 節）。 <!-- req 10:1324f43e.0c94 --> |
| データの暗号化 | 作らない | ストレージの書き込みと読み込みの口（`FileSystemAdapter`、3.2 節）に暗号化を挟む。データモデルは変えない。 <!-- req 10:928c4ba4.0663 --> |
| アクセシビリティ | 作らない | データモデルと層の構成（2 節）を変えずに受ける。 <!-- req 10:cbdcd11e.cec4 --> <!-- req 10:cbdcd11e.8842 --> |
| システムトレイの常駐 | 作らない。開いているウィンドウが 1 枚も無くなったらプロセスを終える。 | トレイのアイコンとそのメニューは 7.2 節の⑥（メニューの構築）の中で作る。ウィンドウを全部閉じてもプロセスを残す動きは、③（ウィンドウ管理）の中で受ける。7 点の外へシェル側の責務を足さない（7.1 節）。 <!-- req 10:48075fad.eeef --> <!-- req 10:48075fad.cfbc --> <!-- req 10:48075fad.d7ca --> <!-- req 10:48075fad.af5e --> <!-- req 10:48075fad.e0c2 --> |
| 省電力 | 省電力のための構造を作らない。 | iPhone 版で足すなら、OS の省電力の状態を受け取るアダプタを 3.1 節の形で新しく足す。足すときに、要件 6 章のシェル側の列挙から直す（7.1 節の例外）。 <!-- req 10:52d54055.4442 --> <!-- req 10:52d54055.e332 --> <!-- req 10:52d54055.ed84 --> |

### 13.3 自動更新の確認（`UpdateCheckAdapter`）

3.3 節の表で本節に回したシグネチャと、7.2 節の表の④の置くプロセスを書く。

- `UpdateCheckAdapter` は、v1 では通信しないダミーの実装とし、将来は実際に問い合わせる実装に差し替えるだけにする（3.2 節）。 <!-- req 10:1d28ad8b.b37f --> <!-- req 12:612b52fb.40bb -->
- インターフェースが持つのは「チェック」の 1 段だけとする。 <!-- req 10:1d28ad8b.9442 -->
- 「ユーザーの確認」と「適用」の 2 段は、インターフェースにも持たせない。3 段ぶんの空のインターフェースを先に置かない。使われない型は単一の真実源を濁らせるだけだから（13.2 節のアプリロックと同じ理由）。サーバーから配る形に移るときに、2 段を含む形へ `UpdateCheckAdapter` ごと差し替える。 <!-- req 10:1d28ad8b.6e2f --> <!-- req 10:1d28ad8b.523b -->
- 確かめずに更新するサイレント更新は、将来も採らない。 <!-- req 10:1d28ad8b.24ef -->
- 将来の問い合わせ先は、有償のサーバーを常に置かずに済む無償のもの（GitHub の Releases）とする。 <!-- req 10:1d28ad8b.84c9 -->

```ts
// packages/core/src/platform/UpdateCheckAdapter.ts
/** v1 は「更新なし」の 1 つだけ。サーバーから配る形に移るときに、ユーザーの確認と適用の 2 段を含む形へ差し替える。*/
export type UpdateCheckResult = { kind: 'none' };
export interface UpdateCheckAdapter {
  /** 更新があるかを確かめる。失敗しても reject せず、{ kind: 'none' } を返す。*/
  check(): Promise<UpdateCheckResult>;
}
```

- (b) PC 版のダミーはレンダラーの側に置き、IPC を使わない。通信しないので、main に置く理由が無いため。7.2 節の表の④の置くプロセスはこれとする。
- (b) `check` を呼ぶのは、曲一覧ウィンドウのレンダラーが起動した後の 1 回とする。v1 のダミーは「更新なし」を返すので、画面には何も出さない。実際に問い合わせる実装に差し替えたときに、呼ぶ側を変えずに済むため。失敗で reject しないのは、更新の確認の失敗で起動を止めないため。

### 13.4 v2 のドラムと 3 つの音色

- v2 でドラムをパートの種別として足しても、パート（`Part`）の構造は変えない。 <!-- req 10:3e991de0.0df5 -->
- データモデルの中心には、alphaTab の Score の階層をそのまま使う（[[data-model-persistence.md#2]]）。v1 では、打楽器の種別を表す属性を自前で足さない（[[editing-core.md#3]] の 3.6 節）。 <!-- req 10:510da077.f261 --> <!-- req 10:760e94a8.bf64 -->
- v2 でドラムを足すときは、`Part.instrumentType` に値を足し、そのパートの `Staff.isPercussion` を立てる。 <!-- req 10:14e41a42.49cb --> <!-- req 10:14e41a42.512a -->
- 打楽器のパートでは、Note の弦の番号（`stringIndex`）とフレットを使わない。 <!-- req 10:266344a3.7b67 --> <!-- req 10:266344a3.fc20 -->
- ドラム譜の入力・表示・再生が alphaTab の型で足りるかは、v2 の着手時に技術調査する。足りなければ、そのときに基本設計 13 章に分岐点として起こす。 <!-- req 10:e0a65144.a24d --> <!-- req 10:e0a65144.ab7c --> <!-- req 10:e0a65144.65ae -->
- v2 でドラムを足すときに、描画の層（`packages/core/src/rendering`、12 節）にドラム専用の描き方を足す。 <!-- req 10:bce99ea8.fe17 -->
- v2 で足す音色は、要件 4.2 節が挙げる 3 つに限る。アコースティックギター・クリーンエレキ・歪みエレキの 3 つとする。 <!-- req 10:23dcd73a.bb99 --> <!-- req 10:23dcd73a.e1e3 --> <!-- req 10:23dcd73a.f1f3 --> <!-- req 10:23dcd73a.bfb0 -->
- 3 つとも、`Part.instrumentType` に値を足し、SoundFont のプログラムの番号の対応（[[part-tuning-management.md#2]] の 2.1 節）に行を足すだけで受ける。データモデルと画面の処理の構造は変えない。 <!-- req 10:0ff5ddcd.1f03 --> <!-- req 10:0ff5ddcd.3596 --> <!-- req 10:0ff5ddcd.8338 --> <!-- req 10:0ff5ddcd.71be -->

### 13.5 iPhone 版（Phase 3）

- 着手の時期は決めない。PC 版を完成させ、製品として使えると本人が判断した時点で着手する。 <!-- req 10:03deabfc.9d33 --> <!-- req 12:7e1a74d6.e48e -->
- 3 節の 4 つのアダプタを、Expo 版として `apps/mobile` に実装する。 <!-- req 10:3dfb730f.f49a -->

| アダプタ | iPhone 版 |
|---|---|
| `FileSystemAdapter` | 保存先をアプリの設定で選べる形（3.2 節の 4 つの種類）を、iOS でも PC 版と同じにする。使う iOS の API とクラス構成とシグネチャは、Phase 3 の詳細設計に着手する前に、基本設計 13 章 A12 の契約の見直しを済ませてから決める（3.1 節）。 <!-- req 10:2ed9bbed.daf3 --> <!-- req 10:2ed9bbed.91aa --> <!-- req 13:2662ecdf.8e3c --> |
| `AudioSessionAdapter` | expo-audio で、AVAudioSession に `mixWithOthers` を設定する。Phase 3 の詳細設計（クラス構成とシグネチャ）に着手する前に、基本設計 13 章 A11 の実機のスパイク検証をする。実機が無いときは、少なくともフォールバックの候補を絞り込む。 <!-- req 10:a96d18cc.4c28 --> <!-- req 10:a96d18cc.5633 --> <!-- req 10:a96d18cc.ea29 --> <!-- req 13:41d84b47.e813 --> <!-- req 13:41d84b47.1518 --> <!-- req 13:401fd5fb.b712 --> <!-- req 13:401fd5fb.6a3a --> |
| `WindowAdapter` | ウィンドウが 1 つだけなので、簡単な実装にする。フォーカスの処理は持たない。 <!-- req 10:77e8f7ae.a8d7 --> <!-- req 10:77e8f7ae.b84c --> |
| `UpdateCheckAdapter` | App Store を通した更新に任せる、ダミーの実装とする（13.3 節と同じ形）。 <!-- req 10:425c6384.053f --> |

- 基本設計 13 章のカテゴリ A（技術検証待ち）の項目は、一律に同じ重みで扱わない。上の表の A11（`AudioSessionAdapter` の行）と A12（`FileSystemAdapter` の行）は、検証の結果次第で Phase 3 のアーキテクチャの方針そのものの見直しに発展しうるので、実機で確かめればどれかの選択肢に収まる残りの A の項目とは、重み付けが異なる項目とする（基本設計 13 章 5 節）。 <!-- req 13:ce206e8c.9211 --> <!-- req 13:ce206e8c.deb8 -->
- A11 と A12 は、Phase 3 の詳細設計に着手する前に優先して検証し、再検討する。A11 の実機のスパイク検証は、Phase 3 の着手の前に、Phase 3 の検証のうち最初に、最優先で行う（基本設計 13 章 A11）。スパイクで確かめるのは、ネイティブの側で `expo-audio` が設定する `AVAudioSession` の `mixWithOthers` を、WebView の中（alphaTab と AlphaSynth の Web Audio API の出力）の音が継いで、バックグラウンドの音楽アプリと同時に鳴るか（要件④、A11 の (a) か (b) か）とする。 <!-- req 13:ce206e8c.1faa --> <!-- req 13:41d84b47.b94b --> <!-- req 13:41d84b47.228d --> <!-- req 00:69d9ad1e.e452 -->
- 鳴らないと分かったときの代わりの形の候補は、次の 3 つとする（基本設計 13 章 A11 の (i) から (iii)。優先の順ではなく、どれも実機の検証と合わせて選ぶ）。(i) ネイティブの側（`expo-audio`）で無音の音声を `mixWithOthers` で先に鳴らし始めてから、WebView の中の音を鳴らす。(ii) AlphaSynth の音の出力を WebView の中で終わらせず、ネイティブの側のオーディオへ橋渡しする形へ本格的に移る。Webコアを共有して薄いラッパーにする方針から大きく外れるので、最後の手段とする。(iii) 要件④を iPhone 版では技術的な制約として受け入れ、本人と話し合い直す。 <!-- req 12:2c1d603b.9f5f --> <!-- req 12:2c1d603b.8a45 --> <!-- req 12:2c1d603b.8ab1 -->
- A12 の契約の見直しでは、今の「任意の絶対パスのフォルダへ続けて自由に読み書きできる」モデルが、iOS のサンドボックスの方式（`UIDocumentPickerViewController` のフォルダピッカーと、セキュリティスコープブックマーク）の上でそのまま成り立つかを確かめる。 <!-- req 13:2662ecdf.9dbe -->
- A12 の (b) のとおり、`relativePath` を元にした自由な読み書きという今の契約は、iOS のモデルと根本からかみ合わない見込みが高い。Phase 3 の `FileSystemAdapter` は、今の契約をそのまま使わず、ブックマークのトークンの保存・失効の検知・取り直しを前提にした別の契約として作り直す前提で計画する。 <!-- req 13:2662ecdf.bb8c --> <!-- req 00:2443cc30.fe6a --> <!-- req 00:2443cc30.70d5 -->
- iOS のブックマークは、対象の移動・リネーム・同期先の再構成で失効（`isStale`）しうる。作り直す契約は、この失効を前提にして、失効を検知して取り直す流れを持つ。 <!-- req 13:2662ecdf.635c -->
- A12 は、今の段階では実機を使わず、公開されている情報の調査だけで進める。実機の検証は、机上の調査で解決しない残り（ブックマークが失効したときの取り直しの実際の操作感と、iCloud Drive と Google Drive の両方でのダウンロードの待ち時間の体感）に絞って行う。 <!-- req 13:2662ecdf.876d --> <!-- req 13:c79971b1.1647 --> <!-- req 13:c79971b1.4a4a -->

- Webコアの組み立ての成果物と同梱の SoundFont（実行のときに読むアセットの全部）は、アプリに同梱する。WebView へ `file://` で読み込む。サーバーから配らない。 <!-- req 10:ff22f04f.4772 --> <!-- req 10:ff22f04f.fed8 --> <!-- req 10:028f1754.7a66 -->
- iPhone 版では、WebView を見張る。クラッシュとフリーズを見つけて読み込み直すのは、シェルの側（Expo のラッパー、7.2 節の⑦）とする。扱いは PC 版と同じで、クラッシュは確かめずに、フリーズは確かめてから読み込み直す（[[error-logging-foundation.md#3]] の 3.2 節）。 <!-- req 10:77c66fa5.c7b2 --> <!-- req 10:f37f8a9d.6ba7 --> <!-- req 10:f37f8a9d.1489 --> <!-- req 13:ffe87661.e452 -->
- WebView が消えたことと応答しないことを見つけるイベントは、Phase 3 の着手時に確かめて選ぶ。 <!-- req 10:48d2cf52.9fd5 -->
- AVAudioSession のオプションは `mixWithOthers` とする。カテゴリと、設定する時機（アプリの起動のときか、再生を始めるときか）は、A11 の実機のスパイク検証の結果を受けて、Phase 3 の着手時に決める。 <!-- req 10:a63413b3.eb11 --> <!-- req 10:772e8f58.297e --> <!-- req 10:772e8f58.4e82 -->
- 設定を置いただけでは、対応を終えたとしない。実機の検証とそろって、対応したとする。 <!-- req 10:5ba062cd.d630 --> <!-- req 10:5ba062cd.bc04 -->
- iPhone 版の画面の入れ物は、PC 版とは別に作る（7.1 節）。中身の部品は PC 版と同じ `packages/ui-shared` を使う（下の (b) と 13.6 節）。Phase 3 の画面の設計は、要件定義書 4.5 節と 4.6 節のタッチの操作の仕様（ピンチでのズームを含む）を、そのまま起点に使う。 <!-- req 10:e8d937e4.02ca --> <!-- req 10:e8d937e4.fc7b --> <!-- req 12:7e1a74d6.b4f2 --> <!-- req 12:10f85270.1c9f -->
- Webコアの編集のロジック・データモデル・再生エンジンは、PC 版と同じコードを使い、iPhone 版のために別に作らない（7.1 節）。 <!-- req 10:e8d937e4.0401 --> <!-- req 10:e8d937e4.661b --> <!-- req 10:e8d937e4.9a66 --> <!-- req 10:e8d937e4.5d0b --> <!-- req 12:5d66d2e3.7225 --> <!-- req 00:4e8d2b9b.9637 -->
- 画面の部品（パネルとダイアログ）は、コンテナと中身（コンテンツ、ミキサーの中身・パートリストの中身）に分けて作る。コンテナは配置と開け閉めを受け持ち、中身は自分の置き場所と開け閉めを知らない部品とする。 <!-- req 10:eb49f323.9ae7 --> <!-- req 10:eb49f323.b63d --> <!-- req 10:eb49f323.6168 --> <!-- req 10:eb49f323.ec54 -->
- パネルをボトムシートへ、ダイアログをフルスクリーンモーダルへ 差し替えるときに、コンテナを替えるだけで済むようにするため。 <!-- req 10:eb49f323.8f1d --> <!-- req 10:eb49f323.11ab -->
- この分け方は、要件 9 章の Phase 3（iOS 向けの画面の調整）の計画のための構造で、13.1 節の 4 つの外でも v1 で置く。 <!-- req 10:260464e9.1c5d -->
- v1 では、パネルとダイアログを、コンテナのコンポーネント（置き場所と開け閉め）と、中身のコンポーネント（値と操作を props で受けるだけのもの）の 2 つに分けて作る。中身のコンポーネントは `packages/ui-shared` に、PC 版のコンテナのコンポーネントは `packages/ui-desktop` に置く（2026-10-13 本人決定、基本設計 13 章 B36）。iPhone 版のコンテナは Phase 3 で別のパッケージ（`packages/ui-mobile` の形）に置き、今は作らない。
- (b) 中身のコンポーネントはコンテナを import しない（2.2 節の ESLint で `packages/ui-shared` から `@riff-line/ui-desktop` の import を止める）。コンテナを替えるときに、中身に手を入れずに済むため。
- EAS Build（クラウドでのビルド）で組み立てる。TestFlight で配る。TestFlight のビルドは 90 日で失効するので、定期的に組み立て直すと配り直す 運用の決まりを、Phase 3 の運用を始めるときに決める。 <!-- req 10:87722e08.2d53 --> <!-- req 10:87722e08.4107 --> <!-- req 10:95253890.b010 --> <!-- req 10:95253890.a76e -->
- 収益化するときは、TestFlight での配布から、App Store の正式な配布（審査あり）へ切り替える（13.8 節）。 <!-- req 10:5b2d72b2.da08 -->

### 13.6 iPad と Apple Pencil の余地

- iPad の実機への対応そのものは、Phase 3 以降へ送る。Phase 1 から Phase 3 の設計は、iPad への対応を妨げない形にする。 <!-- req 10:24a50d24.95d8 --> <!-- req 10:24a50d24.1d1b --> <!-- req 12:e3fece5a.ff97 -->
- iPad の余地は要件 9 章の Phase 3 の計画に入っているので、下の余地は 13.1 節の 4 つの外でも置く。 <!-- req 10:ddca56ab.79bc --> <!-- req 12:48ae5a2a.911f -->
- iPad の広い画面の幅と Split View（画面を分けてアプリを並べる表示）には、13.5 節のコンテナ（配置）を差し替えるだけで対応する。 <!-- req 10:4b49c1c2.93d5 --> <!-- req 10:4b49c1c2.a5a6 --> <!-- req 12:f93323a7.e51e -->
- 中身の部品（ミキサーの中身・パートリストの中身）は、PC 版・iPhone 版・iPad 版で共通にする。3 つの版とも `packages/ui-shared` の同じ部品を使い、版ごとに作り直さない（2026-10-13 本人決定、honnin-queue 103 番、基本設計 13 章 B36）。 <!-- req 10:4b49c1c2.6d2d --> <!-- req 10:4b49c1c2.3902 -->
- 将来、Apple Pencil のストロークとジェスチャーを読み取る `PencilInputAdapter` を足しても、既存の `PlaceNoteCommand` をそのまま呼ぶ形でつなげる（コマンド層を通す、[[editing-core.md#2]]）。ドメインのロジックは変えない。 <!-- req 10:ed4cac70.4997 --> <!-- req 12:e3fece5a.3e81 --> <!-- req 12:f93323a7.95ec -->
- 「タブ譜の数字と記号を手書きのストロークから読み取るか」と「タップの位置の代わりの指し示しとして使うか」は、Phase 3 以降の詳細設計で決める。本書では決めない。 <!-- req 10:0786b242.896e --> <!-- req 10:0786b242.82d8 --> <!-- req 10:0786b242.67ac -->
- iPad に正式に対応するときは、Phase 3 の iPhone 版の着手時か、その後の専用のフェーズで、別にスパイク検証をする。 <!-- req 10:59a4228d.9afb -->

### 13.7 外部ファイルの取り込み（Phase 4）と参照音源の加工（Phase 5）

- 取り込みは「一度きりの変換」として扱う。外部のファイルを alphaTab の読み込み（インポーター）で Score にし、曲のファイルの形（[[data-model-persistence.md#3]]）に書いて、以後は通常の `.tabapp` の曲と同じに扱う一方向の変換とする。外部のファイルとの同期と、双方向の編集はしない。 <!-- req 10:3e715e9c.c4b9 --> <!-- req 10:c3ea8a34.7fd5 --> <!-- req 10:c3ea8a34.9235 --> <!-- req 10:c3ea8a34.91fd -->
- ファイルのドラッグ＆ドロップでの読み込みは、Electron のドロップのイベントを受けて、この変換を呼ぶだけにする。 <!-- req 10:b8d87c1a.1b47 -->
- 音声ファイルのプレーヤー（Phase 5）は、タブ譜の再生とは別の系統の新しいモジュールとして作る。`PlaybackService` とは別のモジュールとして足し、合奏の再生の作り（[[playback-integration.md#2]]）に手を入れない。 <!-- req 10:e238a6b6.5ea8 --> <!-- req 10:c4d8f2c1.e5ed --> <!-- req 10:c4d8f2c1.29b0 -->

### 13.8 クレジットの中身と収益化

- 第三者のライブラリとアセットを採るたびに確かめるライセンスの条項（8.2 節）があり、確かめた表示はライセンス／クレジットダイアログ（[[screens-navigation.md#5]] の 5.1 節の #15）に足していく。 <!-- req 10:3193fc7d.69bd --> <!-- req 10:3193fc7d.9c2d -->
- ダイアログの中身は、画面の部品に書き込まない。ライブラリの名前・ライセンスの種類・アプリに同梱した条項の文を 1 件とする配列のデータとして持ち、足すときは 1 件を書き足すだけで済むようにする（条項の文の持ち方と出し方は [[screens-navigation.md#8]] の 8.4 節、2026-10-14 本人決定）。 <!-- req 10:f4c72393.7b0d --> <!-- req 10:f4c72393.805b --> <!-- req 10:f4c72393.6ef5 --> <!-- req 10:f4c72393.c1f2 --> <!-- req 10:f4c72393.e328 -->
- この配列は v1 のダイアログの中身の書き方で、13.1 節の 4 つの外に置く拡張の構造ではない。 <!-- req 10:29830845.8f01 -->
- (b) 配列は、クレジットのダイアログの中身の部品（`packages/ui-shared`、13.5 節）の隣に、型を付けた定数のファイル 1 つとして置く。8.3 節の出荷の確かめのスクリプトが見るファイルの一覧とは別に持つ（表示の中身と、パッケージに入れるファイルは別のものなので）。
- 課金の形は、買い切り（一括購入）を採る。今は、サブスクリプションと投げ銭を含め、買い切りでない課金の形を採らない。 <!-- req 10:1fb08672.9560 --> <!-- req 10:b16bb7e7.76ab --> <!-- req 10:b16bb7e7.9d5e --> <!-- req 13:7f1b756e.96f1 --> <!-- req 12:5dfdbbbc.0d2e -->
- iPhone 版は、App Store での買い切りのアプリ内課金（StoreKit）か、App Store の有料アプリとしての配布を見込む。どちらにするかは、Phase 3 で TestFlight から App Store の正式な配布と審査へ移るときに決める（要件 5.6 節の「App Store の正式な配布が別に要る」を受け継ぐ）。 <!-- req 10:0243df8f.716c --> <!-- req 10:0243df8f.7b8c --> <!-- req 10:0243df8f.7146 --> <!-- req 13:7f1b756e.6bd2 --> <!-- req 13:7f1b756e.9ddb --> <!-- req 13:7f1b756e.e623 -->
- PC 版は、ライセンスキーの方式（アプリの中でキーを入れて機能を開ける）か、販売のプラットフォームを通した配布（候補は itch.io と Gumroad）を見込む。 <!-- req 10:756f59c1.152e --> <!-- req 10:756f59c1.b41c --> <!-- req 10:756f59c1.ebee --> <!-- req 13:7f1b756e.8ba0 --> <!-- req 12:76f43978.0443 -->
- PC 版の方式は、Phase 3 以降、収益化に着手する段階で決める。本書でも決めない。 <!-- req 10:756f59c1.9d08 --> <!-- req 10:756f59c1.09bc --> <!-- req 13:7f1b756e.a990 --> <!-- req 13:7f1b756e.b34d --> <!-- req 12:4b1297fa.5967 --> <!-- req 12:4b1297fa.d0be -->
- 今は、課金とライセンスの確かめの機能を作らない。Phase 1 と Phase 2 の設計に影響させない。 <!-- req 10:8b61d947.ab0d --> <!-- req 10:8b61d947.fd9c --> <!-- req 12:5dfdbbbc.e2a3 -->
- 将来ライセンスの確かめを足すときは、3.1 節のアダプタの形に倣う。`LicenseAdapter`（ライセンスの状態の確かめ）のインターフェースを足す形でつなげられるようにしておく。 <!-- req 10:f4ead270.a76b --> <!-- req 10:f4ead270.0ce4 --> <!-- req 10:f4ead270.4604 --> <!-- req 13:7f1b756e.45b0 --> <!-- req 12:4b1297fa.ef13 -->
- `LicenseAdapter` は、アプリロックの `AuthAdapter`（認証の主体が違う）とは別のアダプタとする。既存のコマンド層とデータモデルには手を入れない。 <!-- req 10:f4ead270.2401 --> <!-- req 10:f4ead270.b2c0 --> <!-- req 10:f4ead270.f1ca -->
- ライセンスの確かめは、ビルドの工程には入れない。コードの側（`LicenseAdapter`）に足す。ストアの審査への対応は、Phase 3 の iPhone 版の配布（13.5 節）の話として別に扱う。 <!-- req 10:7b314e4a.1acc --> <!-- req 10:7b314e4a.80ef --> <!-- req 10:7b314e4a.25be -->
- 決済との連携とライセンスキーの発行の作りは、Phase 3 以降で足りる。Phase 3 の後の専用のフェーズで作ることも見込む。本書では、妨げない設計になっていることを確かめるところまでに留める。 <!-- req 10:e3bf8227.cc7e --> <!-- req 10:e3bf8227.371d --> <!-- req 10:e3bf8227.4a03 --> <!-- req 10:e3bf8227.133c --> <!-- req 13:7f1b756e.4fa0 --> <!-- req 13:7f1b756e.3777 --> <!-- req 12:5dfdbbbc.c75d --> <!-- req 12:5dfdbbbc.6614 --> <!-- req 12:4b1297fa.5c2f -->
- 受け皿は、3.1 節のアダプタを足す形と、組み立てがビルドの設定だけで終わり、課金やライセンスの確かめの段とつながっていない形（8 節）の 2 つとする。収益化のために、今の組み立ての工程へ段を前もって足さない（基本設計 12 章 3.6 節）。 <!-- req 12:4b1297fa.e114 -->

### 13.9 外部の DAW との MIDI の連携（Phase 6） <!-- req 13:7783a97a.7001 -->

- アプリそのものを VST プラグインとして動かす形は採らない。代わりに、MIDI の出力でゆるくつなぐ形を採る。 <!-- req 10:f0faca72.976c --> <!-- req 10:061bbc2e.ba70 --> <!-- req 13:7783a97a.f3a0 --> <!-- req 13:7783a97a.da8a -->
- 曲の再生に合わせて、MIDI のノートの情報をその場で外へ送り続ける。外部の DAW とソフト音源の側で音を鳴らせるようにする。 <!-- req 10:71e5b0ef.7775 --> <!-- req 10:71e5b0ef.b6bb --> <!-- req 10:71e5b0ef.845c --> <!-- req 12:cf19dbab.f130 -->
- 再生のサービス（`PlaybackService`、[[playback-integration.md#1]]）が、alphaTab の中の再生と並べて、選択中のパートの Note On と Note Off のイベントを外部の MIDI 出力ポートへ送る。 <!-- req 10:341d04f8.eb58 -->
- ポートは、OS の側の仮想 MIDI ドライバが作るものを使い、アプリはポートを作らない。アプリは、OS が出すポートの一覧から送り先を選ぶところまでとする。 <!-- req 10:341d04f8.e42a --> <!-- req 10:341d04f8.00ad -->
- Windows には OS 標準の仮想 MIDI ポートが無いので、利用者が仮想 MIDI ドライバ（loopMIDI を想定）を入れることを前提とする。Mac は OS に入っている IAC Driver を使う。 <!-- req 10:341d04f8.6254 --> <!-- req 10:341d04f8.5d9d --> <!-- req 13:93f6633d.89f1 --> <!-- req 12:c44f3028.7178 -->
- Windows で、外部の DAW とのその場の MIDI の連携（Phase 6）が Electron の Web MIDI API だけでできるか、利用者が仮想 MIDI ドライバを足して入れることが要るかは、まだ確かめていない（基本設計 13 章 A7 の技術検証待ち。13 章 C10 がこの前提を A7 に分けた）。上の loopMIDI の前提は A7 の (a) を置いたもので、連携の方式は Phase 6 の着手時に実機で確かめて確定する。 <!-- req 13:93f6633d.6a57 --> <!-- req 13:93f6633d.6283 --> <!-- req 13:7783a97a.dc10 -->
- DAW からアプリへの入力は、将来の検討の候補として、DAW の MIDI クロックと MTC を受けて再生の位置を合わせること、外部の MIDI キーボードとギターの MIDI 変換器からのノートの入力を編集の操作として取り込むこと、を挙げるだけとする。 <!-- req 10:d2443909.2114 --> <!-- req 10:d2443909.a391 --> <!-- req 10:d2443909.f700 -->
- 入力の向きは方向性だけを書き、具体的な設計は Phase 6 の着手時に別に検討する。Phase 6 の最初の実装の範囲には入れない。 <!-- req 10:d2443909.1d16 --> <!-- req 10:d2443909.a782 -->
- 外部の DAW のトラックの指定とつなぎ方は、DAW の側で行う。アプリの側は、送り先の仮想 MIDI ポートを選ぶところまでとする。 <!-- req 10:c60c63ba.2f53 --> <!-- req 10:3fe5957c.1430 -->
- MIDI で送るのは、今選んでいるパートだけとする。パートごとに MIDI のチャンネルを分けて別のトラックへ送るのは将来の拡張とし、今は作らない。 <!-- req 10:6eac9fca.6793 --> <!-- req 10:b7d77815.0b3b -->
- 内蔵の音源（AlphaSynth）での再生と MIDI の出力は、どちらか一方とすることも両方とすることも、設定で選べる。 <!-- req 10:d3b0a7ab.499c --> <!-- req 10:d3b0a7ab.42c4 --> <!-- req 10:d3b0a7ab.ecbb -->
- 既定では、MIDI へ送っている選択中のパートは内蔵の音源で鳴らさず、選択中でないパートは内蔵の音源で鳴らす。両方で鳴らすと音が二重になるため。 <!-- req 10:aae9ba2d.47ef --> <!-- req 10:aae9ba2d.5e23 -->
- 本書では、MIDI の連携を概念の位置づけを書くところまでに留める。具体的なシグネチャと作り方は、Phase 6 の着手時の詳細設計で決める。v1 では `MidiAdapter` の型を置かない（3.1 節）。 <!-- req 10:a13b1968.7f54 --> <!-- req 10:a13b1968.23bd --> <!-- req 12:45433bc4.d0ba -->
- 外部の DAW との連携は将来の Phase の候補として置くもので、Phase 1（PC 版の MVP）の完了の条件には入れない（基本設計 12 章 3.12 節）。 <!-- req 12:45433bc4.05fc --> <!-- req 12:a92aea9f.a30f -->
- 外部の DAW とのその場の MIDI の連携は、書き出しの MIDI ファイル（[[export-print.md#1]] の 1.3 節、Phase 2）とは別の方式とする。ファイルに書き出して渡すのではなく、再生に合わせて MIDI のノートの情報を送り続ける（基本設計 12 章 3.12 節）。 <!-- req 12:daf558f3.f992 -->
- iPhone 版（Expo と WebView）で Web MIDI API が使えるかは、別に確かめる。確かめるのは Phase 6 の着手時で、対応するのは Phase 3 以降とする。 <!-- req 10:3fc6d749.dd85 --> <!-- req 10:3fc6d749.afaf --> <!-- req 10:3fc6d749.31a4 -->
- DAW の側の音源のプラグインをアプリの中で読み込んで鳴らす VST のホストは、本節の範囲に入れない。将来強い求めが出たときは、要件定義から考え直す。 <!-- req 10:7dc319a1.68a7 --> <!-- req 10:4faf4ad5.3f69 -->

## 14. テストと品質の確かめ

[[../basic_design/11_test_strategy.md]] を受ける。目標値の正は基本設計 11 章 0.1 節、テスト ID の接頭辞の予約の正は基本設計 11 章 3.1 節で、本節は、それを本書の仕組み（Vitest・ESLint・コミットの前のフック・CI）のどこで確かめるかと、テストの段・置き場所・形を書く。作業パッケージをまたぐテストの決まりは本節の 1 か所に置き、パッケージごとのテストの観点（どのクラスのどの条件を確かめるか）は、各詳細設計書のテストの節に書く（14.3 節の表）。(b) 本書に置くのは、基本設計 15 章が自動テスト基盤を単独の作業パッケージにせず、各作業パッケージの完了条件に組み込むと決めていて（[[../basic_design/15_development_process.md#4.1]]）、テストの道具の設定を最初に置くのが本書の作業パッケージ（実施順 1）だから。 <!-- req 13:ad1be9c7.1a32 -->

### 14.1 品質の目標値と、確かめる場所

- テストも設計も、一人で作ることを理由に緩めず、品質を最優先にする。目標値（KPI）を決めて、それに従って進める（基本設計 11 章の前文、2026-09-02 本人の方針）。
- 自動にした工程は緩めない。Lint の強制（14.7 節）と、セルフレビューをする範囲（サイズを問わず全件、下の表の「セルフレビューの実施率」の行）を、作業の量を理由に外さない。 <!-- req 11:07c9658f.4355 --> <!-- req 13:03a08501.e0ea -->
- この方針はテストだけでなく設計にも当てはめる。達成する品質の基準は、曖昧な言葉ではなく数値とチェック項目で決め、基本設計 11 章 0.1 節の 1 か所に集める。0.1 節は、設計の側の目標値（要件のトレーサビリティ・設計分岐点の未決着・ドキュメントの同期）も持つ。 <!-- req 00:501c97d3.bd72 --> <!-- req 00:501c97d3.4f20 --> <!-- req 00:36803fb8.b59e -->
- 0.1 節は数値の目標を集める場所に限る。判定の手順（トレーサビリティの完了基準・設計分岐点の運用）は基本設計 12 章と 13 章に任せ、本節にも書かない。 <!-- req 11:2d4b6252.643e --> <!-- req 11:2d4b6252.758c -->
- 次の表は、目標値ごとに、数値の定義元と、実際に確かめる場所（ゲート）を並べる。目標値と定義元は基本設計 11 章 0.1 節が正で、本節が足すのは右の列の、本書の仕組みでの確かめ方。 <!-- req 11:759c2b92.add1 --> <!-- req 11:759c2b92.69a8 -->

| 領域 | 目標値 | 定義元 | 確かめる場所 |
|---|---|---|---|
| 単体テストのカバレッジ C0（命令網羅） | 実装した全メソッドで 100% | 基本設計 11 章 2 節 | CI の単体テスト（14.7 節）で、Vitest のカバレッジのしきい値 `statements` と `lines` を 100 にする。作業パッケージの DoD 基準 3（基本設計 15 章 7 節）でも確かめる <!-- req 11:b18d7a3a.7c2c --> |
| 単体テストのカバレッジ C1（分岐網羅） | 実装した全メソッドで 100% | 基本設計 11 章 2 節 | 同じ CI の段で、しきい値 `branches` と `functions` を 100 にする。DoD 基準 3 <!-- req 11:5598f06c.2ee1 --> |
| 単体テストのカバレッジ C2（条件網羅） | 14.3 節の対象ロジックの一覧で 100% | 基本設計 11 章 2 節 | 14.3 節の組み合わせの表を、CI の単体テストとして回す。DoD 基準 3 <!-- req 11:1e6d4ec7.ff78 --> |
| Lint と型チェック | ESLint の違反と、`tsc --noEmit` で出る型エラーが 0 件 | 基本設計 15 章 2 節 | コミットの前のフック（`.husky/pre-commit` の lint-staged と `pnpm typecheck`）と、CI の `pnpm lint`・`pnpm typecheck`（14.7 節） <!-- req 11:a7fa3816.bb31 --> <!-- req 11:a7fa3816.7860 --> <!-- req 11:a7fa3816.77b5 --> |
| コミット規約 | commitlint の違反が 0 件 | 基本設計 15 章 3.2 節 | コミットのメッセージのフック（`.husky/commit-msg`）。CI でも PR のコミットを確かめる（14.7 節） <!-- req 11:c36c4148.858b --> |
| 起動時間 | 起動から曲一覧の表示まで 3 秒以内 | 基本設計 09 章 1 節 | 負荷テスト（14.8 節） <!-- req 11:83896368.e5e3 --> <!-- req 12:65fb2c4c.7f56 --> |
| 入力の反応 | 音符の入力から画面への反映まで 100ms 以内 | 基本設計 09 章 1 節 | 負荷テスト <!-- req 11:c1ae70ee.d848 --> |
| 入力の反応（発音） | 音符の入力から発音まで 100ms 以内 | 基本設計 09 章 1 節 | 負荷テスト <!-- req 11:080abf85.9ad4 --> |
| 描画の速さ | フレームレート 30fps 以上 | 基本設計 09 章 1 節 | 負荷テスト <!-- req 11:c95f94da.0cb0 --> |
| 再生の開始 | 再生ボタンから発音まで 200ms 以内 | 基本設計 09 章 1 節 | 負荷テスト <!-- req 11:063ac8a5.0d62 --> |
| メモリ（アイドル時） | 150MB 以内 | 基本設計 09 章 3 節 | 負荷テスト（測る状態は 10.2 節） <!-- req 11:8fed2e9c.5d84 --> |
| メモリ（通常の編集、1 編集ウィンドウあたり） | 400MB 以内 | 基本設計 09 章 3 節 | 負荷テスト <!-- req 11:277b3191.a8c4 --> |
| メモリ（2048 小節の大曲の編集、1 編集ウィンドウあたり） | 600MB 以内 | 基本設計 09 章 3 節 | 負荷テスト <!-- req 11:84019121.82cc --> |
| Undo と Redo の履歴 | 1 編集ウィンドウ（`CommandHistory` の 1 つ）あたり 80MB 以内。直近の 200 件は、予算を超えても下限として持つ | 基本設計 13 章 C11 | 単体テスト（14.3 節の C2 の対象、[[editing-core.md#2]] の 2.3 節）と負荷テスト <!-- req 11:626bf351.cd03 --> <!-- req 11:626bf351.5565 --> |
| セルフレビューの実施率 | 完了した作業パッケージのうち、セルフレビューをしたものの割合が、サイズを問わず 100% | 基本設計 15 章 6 節 | DoD 基準 4（基本設計 15 章 7 節） <!-- req 11:b92d59df.8269 --> <!-- req 13:03a08501.3881 --> |
| 要件のトレーサビリティ | 要件定義書の機能要件のうち、基本設計のどれかの文書に対応づけたものの割合が 100% | 基本設計 12 章 | 基本設計の完了基準（基本設計 12 章 5 節） <!-- req 12:47bacf93.5557 --> | <!-- req 00:82a141f0.0a5c --> <!-- req 00:82a141f0.f18f --> <!-- req 00:5249627c.4bb6 --> <!-- req 00:5249627c.0e94 -->
| 設計分岐点の未決着（カテゴリ B と C） | その Phase の詳細設計に着手する時点で、工学判断で決める事項と、ヒアリングで決める事項の未決が、どちらも 0 件（着手の前に必ず決める） | 基本設計 13 章 5 節 | 各作業パッケージの詳細設計を作るとき（DoD 基準 2 の前提） <!-- req 11:12f51762.b655 --> <!-- req 11:12f51762.9ad4 --> <!-- req 12:00ebf349.9d8f --> |
| 設計分岐点の未決着（カテゴリ A） | その Phase のシステムテストをする時点で、技術検証待ちの事項のうちフォールバックが決まっていないものが 0 件 | 基本設計 13 章 2 節 | システムテストに入る前の確かめ（14.6 節） <!-- req 11:d412c33f.4086 --> <!-- req 12:00ebf349.ece9 --> |
| ドキュメントの同期 | 基本設計・詳細設計・実装のあいだの食い違いを、どこで見つかったか（セルフレビュー・本人のレビュー・テスト・実装の作業）を問わず、見つけるたびに 0 にして残さない | 基本設計 15 章 9 節 | セルフレビューの観点（基本設計 15 章 6 節） <!-- req 11:682198e9.0c38 --> <!-- req 11:682198e9.1382 --> <!-- req 11:682198e9.0195 --> |

- 目標値は、一人で作ることや隙間の時間で作ることを理由に下げない。測って届かなかったときに見直すのは設計と実装で、目標値ではない（例：大曲のメモリが 600MB を超えたときの対策は 10.2 節に書き、目標値は動かさない）。 <!-- req 11:90026d1f.24e2 --> <!-- req 11:90026d1f.dc9f --> <!-- req 11:90026d1f.4a28 --> <!-- req 11:90026d1f.8fba -->
- 自動で測れるもの（カバレッジ・Lint・コミット規約）は、CI で PR ごとに機械で確かめる（14.7 節）。 <!-- req 11:66e2bc53.495b --> <!-- req 11:66e2bc53.ffdc --> <!-- req 11:66e2bc53.74c4 -->
- 手で測るもの（上の表で確かめる場所が負荷テストの行：起動時間・入力の反応・発音・フレームレート・再生の開始・メモリの 3 つの場面）は、Phase 0 から Phase 1 に着手した後に、実機の負荷テスト（14.8 節）で測る。 <!-- req 11:66e2bc53.a9b7 --> <!-- req 11:66e2bc53.7058 --> <!-- req 11:66e2bc53.1e7b -->
- 設計の側の目標値（要件のトレーサビリティ・設計分岐点の未決着の件数）は、コードのように機械で測れない。基本設計 12 章 5 節の完了基準のチェックリストと 13 章 5 節の運用の決まりを使い、文書を直すたびに Claude Code のセルフレビューと本人のレビューで確かめる。 <!-- req 11:aa164475.280e --> <!-- req 11:aa164475.0a67 -->
- 基本設計の段の完了の基準として、要件定義書の全項目（機能要件に加えて、7 章の未決事項と 8 章のリスク一覧も含む）が基本設計のどれかの文書で扱われていることを、基本設計 12 章 1 節の表（要件の章と設計書の対応）と 5 節の完了基準のチェックリストで確かめる（基本設計 12 章の冒頭）。 <!-- req 12:193d3cef.1a14 --> <!-- req 12:193d3cef.13a2 -->
- 新しい品質の観点が決まったら、基本設計 11 章 0.1 節の表に行を足し、本節の表に確かめる場所の行を足す。

### 14.2 テストの 4 つの段

- テストは次の 4 つの段で、この順に積み上げる。下の段で保証しきれない範囲を上の段で補い、どれか 1 つの段だけで品質を担保しない。 <!-- req 11:836d8999.de54 --> <!-- req 11:e1594ffe.211c --> <!-- req 11:e1594ffe.8324 --> <!-- req 13:daca3568.0c60 --> <!-- req 12:b98541f4.7b67 --> <!-- req 12:64ff20e5.f4ce --> <!-- req 12:e7a49425.c26a -->

| 段 | 単位 | 確かめること | するとき | 置き場所 |
|---|---|---|---|---|
| 単体テスト | メソッド | 一つずつの処理の正しさを、14.3 節のカバレッジの基準で保証する | 各作業パッケージの実装の直後（基本設計 15 章 5 節） | 対象と同じフォルダの `*.test.ts`（14.4 節） <!-- req 11:e329c82a.c104 --> <!-- req 11:e329c82a.a11c --> <!-- req 13:daca3568.74fa --> |
| 結合テスト | モジュール（サービスの層をまたぐ組み合わせ） | サービスどうしの連携とデータの受け渡しが、設計どおりに働く | 単体テストが済んだ後、作業パッケージを完了する前後 | 14.5 節 <!-- req 11:58e77c78.cb43 --> <!-- req 11:58e77c78.6911 --> <!-- req 11:58e77c78.e86b --> <!-- req 13:daca3568.32df --> |
| システムテスト | アプリ全体（実際の操作のシナリオ） | 要件定義書のユースケースが、端から端まで成り立つ | 主要な作業パッケージがそろったとき、Phase の節目 | 14.6 節 <!-- req 11:b0f5e4ca.0e62 --> <!-- req 11:b0f5e4ca.3b4e --> <!-- req 13:daca3568.4985 --> |
| 運用テスト | 実際の耳コピの作業（本番と同じ使い方） | 実際の利用に耐えるか、実際の作業の流れで違和感が無いか | Phase 1 の完了の前後、それ以降の主要な機能を足したとき | 14.6 節 <!-- req 11:4315fa8e.4b5c --> <!-- req 11:4315fa8e.0d22 --> <!-- req 11:4315fa8e.b1d8 --> <!-- req 13:daca3568.1d80 --> |

- (b) 単体テストと結合テストは同じ Vitest で走らせ、ファイルの名前（結合テストは `*.integration.test.ts`）で分ける。リポジトリ直下の `vitest.config.ts` の 3 つのプロジェクト（`core`・`desktop`・`desktop-renderer`）が両方を拾い、CI の 1 つの段（14.7 節）で回せるようにするため。
- V 字モデルでの開発の段とテストの段の対応づけは、15 章の回で書く。 書いた先は 15.2 節の表。 <!-- req 13:6903fe5c.6a7a --> <!-- req 13:6903fe5c.d433 --> <!-- req 13:6903fe5c.3e97 --> <!-- req 13:6903fe5c.8589 --> <!-- req 13:6903fe5c.0a08 -->
- 設計分岐点のカタログの運用の決まり（実装中に新しい分岐点に気づいたら、まず基本設計 13 章に書いてカテゴリ A から C のどれかに分けること、カテゴリ A は検証の結果が出たら「解決済み」にして、決まった方式を該当の設計書に書くこと、カテゴリ A が 0 件になったら 12 章の完了基準を「検証待ち事項なし」と言えること、Phase 0 と Phase 1 の技術検証を基本設計の段の完了条件に入れないこと）は、15 章の回で書く（基本設計 13 章 5 節、2026-10-16 本人決定）。 書いた先は 15.9 節。 <!-- req 13:665781b9.ff5c --> <!-- req 13:665781b9.53bf --> <!-- req 13:a5ac1ae6.e315 --> <!-- req 13:a5ac1ae6.69eb --> <!-- req 13:0698e5ae.d881 --> <!-- req 13:0698e5ae.e641 -->

### 14.3 単体テストのカバレッジ

単体テストの完了の条件は、次のカバレッジの基準とする。 <!-- req 11:51d52801.47cd -->

| 種類 | 当てる範囲 | 基準 |
|---|---|---|
| C0（命令網羅） | 実装した全メソッド | 100%。すべての実行文を、少なくとも 1 回は通す <!-- req 11:e2f6d1df.1885 --> <!-- req 13:daca3568.c55e --> |
| C1（分岐網羅） | 実装した全メソッド | 100%。`if` 文・`switch` 文・三項演算子の分岐のすべてを、真と偽の両方で少なくとも 1 回は通す <!-- req 11:2b5959b9.c63a --> <!-- req 11:2b5959b9.33c0 --> <!-- req 11:2b5959b9.ef8b --> <!-- req 13:daca3568.0e01 --> |
| C2（条件網羅） | 下の対象ロジックだけ | `&&` と `||` でつないだ複合の条件の要素の一つずつを、真と偽の組み合わせで確かめる <!-- req 11:39933fd3.5f03 --> <!-- req 11:39933fd3.6243 --> <!-- req 13:daca3568.f564 --> |

- (b) C0 と C1 は、Vitest のカバレッジ（v8）の値で測る。C1 は `branches` で測り、v8 が分岐として数えるもの（`&&`・`||`・`??` の短絡と、省いた引数の初めの値を含む）もすべて 100% にする。分岐の数え方を道具にそろえ、数え漏れを人の目で探さないため。
- (b) C2 は、カバレッジの道具では測れない。対象のメソッドのテストに、複合の条件の要素ごとの真と偽の組み合わせを並べた表を置き、`it.each` で回す。表は 14.9 節の `allCombinations` で要素の名前から作り、組み合わせの全部（要素が n 個なら 2 の n 乗）を、手で書かずに機械で並べる。期待する結果は、組み合わせごとにテストの側の別の式で出す。表を手で書かないのは、組み合わせの書き漏れをレビューで探さずに済ませるため。

C2 を当てる対象ロジックと、テストの観点を書く節は次の表。基本設計 11 章 2 節の一覧が正で、新しく複合の条件を持つ重要なロジックを足したときは、その一覧と本表に行を足す。

| 対象ロジック | 複合の条件 | テストの観点を書く節 |
|---|---|---|
| コマンド層の execute と undo（基本設計 04 章 8 節） | 各コマンドのバリデーションと、元に戻すときの条件。Undo と Redo が非対称になるとデータを失うため | [[editing-core.md#2]] の 2.2 節と 2.6 節 <!-- req 11:99ae5d09.c5a6 --> <!-- req 11:99ae5d09.00cb --> <!-- req 12:e9bca71d.3808 --> |
| Undo と Redo の履歴のメモリの予算の判定・下限の保証・エビクション（基本設計 04 章 8.2 節、13 章 C11） | 予算を超えたか × 下限の 200 件を超えているか | [[editing-core.md#2]] の 2.3 節 <!-- req 11:7b2b0cdd.3d97 --> <!-- req 11:7b2b0cdd.933a --> <!-- req 11:7b2b0cdd.2b9c --> |
| Undo と Redo の履歴のエビクションの知らせ（`EDIT-008`、基本設計 08 章 1 節の Info の行） | エビクションが起きたか × そのセッションで最初の 1 回か。Undo の側でも Redo の側でも、最初の 1 回だけ知らせる | [[editing-core.md#2]] の 2.3 節 <!-- req 11:cb83d187.0509 --> <!-- req 11:cb83d187.affe --> <!-- req 11:cb83d187.1e4e --> |
| バリデーションの上限の判定と重複の判定（基本設計 04 章 11 節、02 章 4.3 節） | 上限の種類ごとの範囲の判定と、同じ弦の重複の判定 | [[editing-core.md#5]] <!-- req 11:53da802e.98b7 --> <!-- req 11:53da802e.ab95 --> <!-- req 12:e9bca71d.e31b --> |
| 奏法記号の自動の候補の判定（基本設計 04 章 6.1 節） | 音の間隔 × フレットの差 | [[editing-core.md#7]] の 7.1 節 <!-- req 11:d72e83ec.1a78 --> |
| 拍子とテンポの継承の鎖の再計算（基本設計 04 章 10 節、13 章 B5） | 拍子の継承と、テンポの継承のそれぞれ | [[editing-core.md#10]] <!-- req 11:b08ed8c5.9465 --> <!-- req 11:b08ed8c5.22b4 --> |
| 拍子・繰り返し記号・音価のコマンドのバリデーションと、execute と undo の対称性（2026-09-10 追加） | `SetTimeSignatureCommand`（`null` で継承に戻すことと、実際の値の往復）、`SetRepeatCommand`（`repeatCount` の範囲 × 対応する開始のリピートがあるか、13 章 B39）、`SetBeatDurationCommand`（付点の数 × 連符の分子と分母）、`SetBeatTechniqueCommand` と `NoteTechniquePatch`（`bendPoints` の配列の深いコピーの往復）。どれもバリデーションを C2 まで確かめる | [[editing-core.md#10]] と [[editing-core.md#3]] の 3.8 節 <!-- req 11:432b6ebd.234c --> <!-- req 11:432b6ebd.4892 --> <!-- req 11:432b6ebd.fa90 --> <!-- req 11:432b6ebd.dba6 --> <!-- req 11:432b6ebd.89cf --> <!-- req 11:432b6ebd.b392 --> <!-- req 11:432b6ebd.049d --> <!-- req 11:432b6ebd.f60a --> |
| スキーマの版の移行（基本設計 02 章 4.2 節） | 版の読み取りと、移す経路があるか。データを失わないことを最優先にするため | [[data-model-persistence.md#8]] <!-- req 11:636bc6eb.537c --> |
| ファイル I/O のアトミックな書き込みと整合性の確かめ（基本設計 06 章 5 節） | 書き込みの途中で止まったか × チェックサムが合うか | [[data-model-persistence.md#15]] <!-- req 11:5b2d05d4.dc94 --> <!-- req 11:5b2d05d4.ccb1 --> |
| `NotificationCenter` のレベル別の振り分け（基本設計 08 章 1.1 節） | Info・Warning・Error・Critical の 4 つのレベルの振り分けの条件 | [[error-logging-foundation.md#6]] <!-- req 11:b14e632a.5daf --> <!-- req 11:b14e632a.3c66 --> <!-- req 11:b14e632a.df8f --> <!-- req 11:b14e632a.05ed --> |
| フォーカス表示の表示範囲の追従（2026-09-09 追加） | モードがフォーカス表示か × カーソルが範囲（`start ≤ barIndex ≤ end`）を外れたか | [[view-modes.md#1]] の 1.1 節 <!-- req 11:668984f7.a0a8 --> |
| 再生の同期の dirty のトラックの管理と、小節の境のフラッシュの判定（2026-09-09 追加） | 再生中か × 小節の番号の変わり方（前へ進んだ・ループで戻った）× dirty の集合が空か | [[playback-integration.md#3]] の 3.2 節 <!-- req 11:839dc948.3fe3 --> <!-- req 11:839dc948.dd7f --> |
| カポの運指から実音への変換 `computeRealMidiPitch` | 分岐を持たない足し算だが、境界の値（`capoFret` の 0 と 12、フレットの 0 と 24）を網羅する | [[playback-integration.md#9]] の 9.1 節 <!-- req 11:839dc948.f51c --> <!-- req 11:839dc948.e446 --> <!-- req 11:839dc948.186b --> <!-- req 11:839dc948.fb72 --> |

- 上の表の外（画面の部品の見た目の分岐、単純なゲッターとセッター）は、C0 と C1 だけを満たせばよく、C2 は求めない。 <!-- req 11:7931e005.7384 --> <!-- req 11:7931e005.223f --> <!-- req 11:7931e005.8dcb --> <!-- req 11:7931e005.de0e --> <!-- req 11:7931e005.dac1 -->
- 全メソッドで C0 と C1 を 100% にし、重要なロジックは C2 まで満たす。要件 5.5 の自動テストの方針を、数値の基準まで決めたもの。 <!-- req 11:8697a6cd.d6d6 --> <!-- req 11:8697a6cd.1062 --> <!-- req 11:8697a6cd.ecc3 --> <!-- req 12:b98541f4.d2fe -->
- 主要なロジックのテストは、実装した後にまとめて書く（基本設計 15 章 5 節）。L と XL のサイズの作業パッケージは、サブ機能ごとに区切って書く。 <!-- req 11:372a83e3.bb5d --> <!-- req 11:372a83e3.26ca --> <!-- req 13:03a08501.a1f1 -->
- 作業パッケージの進め方（ブランチの切り方、1 つずつ順に進めること、別の視点でのセルフレビュー、L と XL のサイズでテストを書く時機）は、15 章の回で書く。 書いた先は 15.3 節から 15.6 節。 <!-- req 13:03a08501.02f0 --> <!-- req 13:03a08501.2855 --> <!-- req 13:03a08501.aeb5 --> <!-- req 13:03a08501.1112 --> <!-- req 13:03a08501.9753 --> <!-- req 13:03a08501.8e1a --> <!-- req 12:02e22ba6.ee47 --> <!-- req 12:9f2c4f8b.c193 --> <!-- req 12:46b8e728.e1a5 --> <!-- req 12:94582639.0a45 -->

単体テストの対象と優先度は次の表。

| 対象 | テストの種類 | カバレッジ | 優先度 | 観点を書く節 |
|---|---|---|---|---|
| コマンド層の各 `Command` の execute と undo の対称性 | 単体 | C0・C1・C2 | 最高（Undo と Redo の信頼性は要件の必須事項） | [[editing-core.md#2]] <!-- req 11:69199a9d.ea4b --> |
| バリデーション（各上限・重複） | 単体 | C0・C1・C2 | 高 | [[editing-core.md#5]] <!-- req 11:b2fe29e1.b481 --> <!-- req 11:b2fe29e1.bb0e --> |
| 奏法記号の自動の候補の判定 | 単体 | C0・C1・C2 | 中 | [[editing-core.md#7]] の 7.1 節 <!-- req 11:27bf63c8.2403 --> |
| 拍子とテンポの継承の鎖の再計算 | 単体 | C0・C1・C2 | 高 | [[editing-core.md#10]] <!-- req 11:fee0e243.ef9c --> <!-- req 11:fee0e243.e4ee --> |
| コードネームの自動の検出 | 単体（既知のコード進行のフィクスチャで確かめる） | C0・C1 | 中 | [[editing-core.md#8]] <!-- req 11:1fab4cec.cd8a --> |
| スキーマの版の移行 | 単体（旧版の JSON を新しい版に変えた結果を確かめる） | C0・C1・C2 | 高（データを失うのは致命的） | [[data-model-persistence.md#8]] <!-- req 11:4998fad9.5fe6 --> |
| MIDI のシリアライザ（自前で作る） | 単体と往復のテスト（変えた後に読み戻して、元のデータと比べる） | C0・C1 | 高 | [[export-print.md#7]] <!-- req 11:4742a5c8.d027 --> <!-- req 11:4742a5c8.d29c --> |
| alphaTex の書き出し（`AlphaTexExporter` を使う） | 単体（書き出した結果を alphaTex として読み戻して元の Score と比べる往復の確かめと、書き出しの設定の確かめ）。自前の処理の網羅ではなく、ライブラリの呼び方の正しさを確かめる | C0・C1 | 中 | [[export-print.md#1]] の 1.2 節と [[export-print.md#7]] <!-- req 11:d80a34f4.0d10 --> <!-- req 11:d80a34f4.116c --> <!-- req 11:d80a34f4.cb00 --> |
| `NotificationCenter` のレベル別の振り分け | 単体（`report()` を直接呼ぶ） | C0・C1・C2 | 高 | [[error-logging-foundation.md#6]] <!-- req 11:360de5ac.6e3c --> |
| ファイル I/O のアトミックな書き込み | 単体（整合性を確かめる処理）と結合（実際の I/O、14.5 節） | C0・C1・C2 | 中 | [[data-model-persistence.md#15]] <!-- req 11:0c3e2ddb.ebc6 --> <!-- req 11:0c3e2ddb.713f --> <!-- req 11:0c3e2ddb.539c --> <!-- req 11:0c3e2ddb.1568 --> <!-- req 11:0c3e2ddb.157c --> <!-- req 11:0c3e2ddb.94d1 --> |
| 上の表に無い全メソッド | 単体（すべて） | C0・C1 | — | 各詳細設計書 <!-- req 11:88145a9d.4667 --> <!-- req 11:88145a9d.051c --> <!-- req 11:88145a9d.6b33 --> |

### 14.4 テスト ID とテストのファイルの置き場所

- テスト ID の接頭辞（領域と対象の略号）の予約は、基本設計 11 章 3.1 節の表だけを正とする。下の表は、その接頭辞ごとのテストのファイルの置き場所と、対象のクラスを決めた詳細設計書の節を足したもの。 <!-- req 11:4b0cc26a.a6dc -->
- テスト ID は `<UT|IT>-<領域>-<対象の略号>-<2 桁の連番>` とする。領域と対象の略号は 3.1 節で予約したものだけを使い、予約せずに使わない。新しい対象を足すときは、実装と同じターンで 3.1 節の表に行を足す。連番は同じ対象の中で 01 から振り、使った番号を使い直さない（消したテストの番号は欠番のまま残す）。 <!-- req 11:befb85f4.c523 --> <!-- req 11:711c698c.1ecf --> <!-- req 11:711c698c.f6dc --> <!-- req 11:711c698c.496a --> <!-- req 11:4efbefed.e063 --> <!-- req 11:4efbefed.9c08 --> <!-- req 11:fa646ff9.a624 --> <!-- req 11:fa646ff9.f505 --> <!-- req 11:fa646ff9.dc76 --> <!-- req 12:c1111d5e.34a8 -->

| 接頭辞 | 対象 | テストのファイルの置き場所 | 対象を決めた節 |
|---|---|---|---|
| `UT-CORE-*` | ドメインの純粋な関数（`SongDocument`・`checksum`・`sha256`・`pitch`・`validation`） | `packages/core/src/domain` | [[data-model-persistence.md#2]]・[[data-model-persistence.md#7]] <!-- req 11:e3983e33.eacd --> <!-- req 11:e3983e33.774c --> <!-- req 11:e3983e33.248b --> <!-- req 11:e3983e33.160f --> <!-- req 11:e3983e33.66e3 --> |
| `UT-FS-*` | `FileSystemAdapter` の契約と、軽いエラーのクラス | `packages/core/src/platform`、`apps/desktop/src/renderer/ipcFileSystem.ts` の隣 | [[data-model-persistence.md#10]] <!-- req 11:8f6a6071.c374 --> <!-- req 11:8f6a6071.e7c9 --> |
| `UT-PERSIST-*` | 永続化（`SongRepository`・`AutoSaveScheduler`・`SchemaMigrator`・`TrashService`・`MirrorSyncService`・`LocalBackupService`・`SongIndexService`・`StorageConfigService`・`StorageMigrationService`） | `packages/core/src/persistence` | [[data-model-persistence.md#8]]・[[data-model-persistence.md#9]]・[[data-model-persistence.md#11]]・[[data-model-persistence.md#12]]・[[data-model-persistence.md#14]]・[[data-model-persistence.md#15]]・[[data-model-persistence.md#17]]・[[data-model-persistence.md#20]] <!-- req 11:7a9b5d4f.ecd9 --> <!-- req 11:7a9b5d4f.adba --> <!-- req 11:7a9b5d4f.0676 --> <!-- req 11:7a9b5d4f.22b4 --> <!-- req 11:7a9b5d4f.5ba6 --> <!-- req 11:7a9b5d4f.521c --> <!-- req 11:7a9b5d4f.a948 --> <!-- req 11:7a9b5d4f.cf37 --> <!-- req 11:7a9b5d4f.907c --> <!-- req 12:9b889550.fbf2 --> |
| `UT-ERR-*` | エラーとログの基盤（`NotificationCenter`・`Logger`・`ErrorCodeRegistry`・`LogRingBuffer`・メッセージのテンプレート） | `packages/core/src/errors`、`apps/desktop/src/main` | [[error-logging-foundation.md#2]] <!-- req 11:651bccac.62bf --> <!-- req 11:651bccac.1aae --> <!-- req 11:651bccac.a93b --> <!-- req 11:651bccac.82f1 --> <!-- req 11:651bccac.da54 --> <!-- req 11:651bccac.3914 --> <!-- req 11:651bccac.c39c --> |
| `UT-EDIT-*` | タブ譜の編集のコア（コマンド層・`CursorController`・`EditingService`・`ValidationService`・`ChordDetectionService`・`ClipboardService`・`CommandHistory`） | `packages/core/src/editing` | [[editing-core.md#2]]・[[editing-core.md#4]]・[[editing-core.md#5]]・[[editing-core.md#8]]・[[editing-core.md#9]] <!-- req 11:362f6561.120f --> <!-- req 11:362f6561.a397 --> <!-- req 11:362f6561.5b2e --> <!-- req 11:362f6561.e6ef --> <!-- req 11:362f6561.5f2f --> <!-- req 11:362f6561.de19 --> <!-- req 11:362f6561.7e98 --> |
| `UT-PART-*` | パートとチューニングの管理 | `packages/core/src/parts` | [[part-tuning-management.md#2]]・[[part-tuning-management.md#3]] <!-- req 11:f9e22979.81c4 --> <!-- req 11:f9e22979.223e --> <!-- req 12:421af41b.3e06 --> <!-- req 12:082934e9.db54 --> <!-- req 12:0ca14b27.0e38 --> <!-- req 12:9351e3e0.d173 --> |
| `UT-VIEW-*` | 表示モード（`ViewModeController`・`ZoomController`） | `packages/core/src/viewmodes` | [[view-modes.md#1]] <!-- req 11:7dcd4aa9.b3a6 --> <!-- req 11:7dcd4aa9.5e53 --> <!-- req 12:cd94b2c9.655b --> |
| `UT-RENDER-*` | `ScoreRenderHost`（描画・ハイライト・パートの領域） | `packages/core/src/rendering` | 12 節 <!-- req 11:79ee6792.3fde --> <!-- req 11:79ee6792.618b --> <!-- req 11:79ee6792.17f1 --> |
| `UT-PLAY-*` | 再生のエンジンの統合（`PlaybackService`・`PlaybackSyncController`・`TempoFactorSelector`・`PlaybackCursorFollow`・`CountInController`・`TapTempoController`・`MetronomeService`・`PlaybackMixerBinder`・`NotePreviewer` の 9 つのクラスと、`AudioSyncStrategy`・`PanControlChannel`・`PreviewSynth` を満たすクラスと、`tickMap`） | `packages/core/src/playback` | [[playback-integration.md#1]] <!-- req 11:c9eb2825.7603 --> <!-- req 11:c9eb2825.9cd3 --> <!-- req 12:07d26efd.ceb6 --> |
| `UT-UI-*` | 画面の処理（ViewModel・Binder・Store・Router・Overlay） | `packages/core/src/ui`、`packages/core/src/rendering`（`UT-UI-SRH` の `ScoreRenderHost.highlight.test.ts`、下の表） | 2.1 節 <!-- req 11:11ebfbfd.f3ce --> <!-- req 11:11ebfbfd.7b6c --> <!-- req 11:11ebfbfd.465f --> <!-- req 11:11ebfbfd.9576 --> <!-- req 11:11ebfbfd.33f7 --> <!-- req 11:11ebfbfd.3f28 --> |
| `UT-WIN-*` | `WindowManager` とウィンドウの IPC | `apps/desktop/src/main` | [[screens-navigation.md#4]] <!-- req 11:4269a19c.69dd --> <!-- req 11:4269a19c.3fb8 --> |
| `UT-EB-*` | `ErrorBoundary`（レンダラー） | `packages/ui-desktop`（ウィンドウを包む入れ物の側、13 章 B36） | [[error-logging-foundation.md#2]] の 2.5 節 <!-- req 11:950980bc.a47e --> |
| `UT-FLUSH-*` | 閉じるときの自動保存の flush の橋渡し | `apps/desktop/src/main`、`apps/desktop/src/renderer` | [[data-model-persistence.md#15]]・[[screens-navigation.md#4]] の 4.4 節 <!-- req 11:9637b004.1e7c --> |
| `UT-SONGACT-*` | 曲のアクション（新しい曲を作る・曲の数の上限の警告）・曲一覧の「タグを編集」で曲にタグを付け外しする処理・曲一覧の「名前を変更」で曲名とアーティスト名を変える処理（2 つの操作は [[screens-navigation.md#6]] の 6.3 節、テストの対象に足したのは基本設計 11 章 3.1 節の 2026-10-19 本人決定） | `packages/core/src/ui`、`apps/desktop/src/renderer/songActions.test.ts`（基本設計 11 章 3.1 節の 2026-10-19 本人決定、honnin-queue 167 番） | [[screens-navigation.md#6]] <!-- req 11:0d61b9b2.2fb8 --> <!-- req 11:0d61b9b2.88f3 --> <!-- req 12:a9a16159.d66c --> <!-- req 11:0d61b9b2.5888 --> <!-- req 11:0d61b9b2.c3fb --> <!-- req 11:0d61b9b2.876a --> <!-- req 11:0d61b9b2.8b06 --> |
| `IT-BOOT-*` | レンダラーの起動（DI の組み立てと初期化の順） | `apps/desktop/src/renderer/appBootstrap.test.tsx` | 2.1 節の L5 の行 <!-- req 11:68d251ad.5dda --> <!-- req 11:68d251ad.7111 --> |
| `IT-FS-*` | 実際の I/O と IPC の契約の往復 | `apps/desktop/src/main` | [[data-model-persistence.md#10]] <!-- req 11:5f35d0e8.6311 --> <!-- req 11:5f35d0e8.7b9a --> |
| `IT-EDIT-*` | 編集のコアの通し（コマンド → 履歴 → 描き直し） | `packages/core/src/editing/editing.integration.test.ts` | [[editing-core.md#2]] <!-- req 11:5360cadf.a103 --> |
| `IT-PART-*` | パートの操作の通し | `packages/core/src/parts/parts.integration.test.ts` | [[part-tuning-management.md#2]] <!-- req 11:501e679d.6a42 --> |
| `IT-VIEW-*` | 表示モードの通し | `packages/core/src/viewmodes/viewmodes.integration.test.ts` | [[view-modes.md#1]] <!-- req 11:82b9bd26.be5e --> <!-- req 12:cd94b2c9.3254 --> |
| `IT-PLAY-*` | 再生の通し（コマンドの適用 → 同期 → ミキサー） | `packages/core/src/playback/playback.integration.test.ts` | [[playback-integration.md#3]]・[[playback-integration.md#7]] <!-- req 11:ce6bfe2b.faba --> |
| `IT-ERR-LOG-*` | エラーの発行 → ログの書き込みの通し | `apps/desktop/src/main/errorLogging.integration.test.ts` | [[error-logging-foundation.md#7]] <!-- req 11:dd9cf2e7.9ca9 --> |
| `IT-SCREENS-*` | 画面群の通し | `packages/core/src/ui/screensNavigation.integration.test.ts` | [[screens-navigation.md#5]] <!-- req 11:831d2804.1f1b --> |
| `IT-WIN-*` | ウィンドウの管理の通し | `apps/desktop/src/main/WindowManager.test.ts`、`apps/desktop/src/main/windowIpc.test.ts` | [[screens-navigation.md#4]] <!-- req 11:077cabba.2ce7 --> <!-- req 11:077cabba.ec48 --> |

- (b) `IT-PLAY-*` のファイルの名前は、3.1 節が「要追加」として場所（`packages/core/src/playback`）だけを決めているので、`IT-EDIT-*`・`IT-PART-*`・`IT-VIEW-*` のファイルの名前にそろえて `playback.integration.test.ts` とする。
- テスト ID の決まりは、`pnpm check:test-ids`（`.claude/scripts/check-tests.mjs`）で機械で確かめる。確かめるのは、(1) すべてのテストのファイルが、3.1 節で予約した接頭辞の ID を少なくとも 1 つ持つこと、(2) 使っている ID の接頭辞が、すべて 3.1 節の表にあること、の 2 つ。 <!-- req 11:80b67e67.2faf --> <!-- req 11:80b67e67.221f --> <!-- req 11:80b67e67.1b16 -->
- この確かめは `pnpm check:quality` に含め、CI の段（14.7 節）で止める。 <!-- req 11:adf6ebaf.3c02 -->
- 対象略号の予約の正は、基本設計 11 章 3.1 節の表の「予約した対象略号」の欄とする（2026-10-19 本人決定、honnin-queue 153 番）。本書は次の表で、対象略号ごとのテストのファイルを足す。対象略号を持たない接頭辞（`UT-WIN-*`・`UT-EB-*`・`UT-FLUSH-*`・`UT-SONGACT-*`・`IT-BOOT-*`・`IT-EDIT-*`・`IT-PART-*`・`IT-VIEW-*`・`IT-PLAY-*`・`IT-ERR-LOG-*`・`IT-SCREENS-*`・`IT-WIN-*`）は、3.1 節の欄が「—」で、この表に行を持たない。これらの接頭辞のテスト ID は、対象略号を入れずに `<UT|IT>-<領域>-<2 桁の連番>` とする（2026-10-19 本人決定、honnin-queue 158 番）。 <!-- req 11:86b184e6.50a5 -->
- 「要追加」の 4 つは、今のコードにテストのファイルが無い（基本設計 12 章 6.2 節の「要追加」）。(b) ファイルは、テストする部品を宣言したファイルの隣に同じ名前で置く（`SetBeatDurationCommand` は [[editing-core.md#4]] の 4.3 節、`SetTimeSignatureCommand` と `SetRepeatCommand` は [[editing-core.md#10]]、`SetBeatTechniqueCommand` は [[editing-core.md#7]] の 7.3 節の `noteAttributeCommands.ts`）。今のテストが `SetTempoCommand.test.ts`・`PlaceNoteCommand.test.ts` のように、部品のファイルの隣に同じ名前で置いているため。
- 基本設計 12 章 6.2 節の対応表で、テストの列が「要追加」のコマンドのうち、上の 4 つと別のものは、今あるテストのファイルにテストを足す。(b) 足す先は、コマンドを宣言したファイルの隣にある今のテストのファイルとする。上の 4 つと同じく、部品のファイルの隣にテストを置く今の形にそろえるため。
  - `UT-EDIT-ATTR`（`packages/core/src/editing/commands/noteAttributeCommands.test.ts`）に、ゴースト（`SetTechniqueCommand` の `isGhost` のキー）を付けて外し、取り消すテストを足す（12 章 6.2 節の「ゴースト」の行。キーは今のコードに在り、テストが無い）。 <!-- req 12:5a44a5c1.3d8b -->
  - `UT-PART-ATTR`（`packages/core/src/parts/commands/partAttributeCommands.test.ts`）に、音色を変える `SetPartInstrumentCommand`・弦の本数だけを変える `SetStringCountCommand`・パートの色を変える `SetPartColorCommand` のテストを足す（12 章 6.2 節の「パートの音色変更」「弦本数の変更」の (b)・「譜面のパート別色分け表示」の行。3 つは [[editing-core.md#2]] の 2.6 節で `partAttributeCommands.ts` に宣言している）。 <!-- req 12:421af41b.3e06 --> <!-- req 12:082934e9.db54 --> <!-- req 12:9351e3e0.d173 -->
  - `UT-PART-STRUCT`（`packages/core/src/parts/commands/structuralPartCommands.test.ts`）に、`AddPartCommand`・`RemovePartCommand`・`ReorderPartsCommand`・`RenamePartCommand` のテストを足す（12 章 6.2 節の「パートの追加・削除・並べ替え・名前」の行。`AddPartCommand`・`RemovePartCommand`・`RenamePartCommand` は 2.6 節で `structuralPartCommands.ts` に宣言し、`ReorderPartsCommand` は 2.6 節の箇条で決めて今のコードの同じファイルに在る。`RenamePartCommand` は今のコードに無いので、コマンドと同じ変更の中で足す）。 <!-- req 12:0ca14b27.0e38 -->
- 基本設計 12 章 6.2 節の対応表で、テストの列が「要追加」の「タグ付け」の行（曲一覧の「タグを編集」）は、コマンドではなく編集の履歴の外で曲のファイルを書き直す処理なので、上の 2 つの箇条（「要追加」の 4 つと、コマンドの「要追加」）のどちらにも入らない。この処理のテストは今のコードに無く、`UT-SONGACT-*`（基本設計 11 章 3.1 節、2026-10-19 本人決定、honnin-queue 163 番）として足す。(b) 足す先は、今の `UT-SONGACT-*` のテストのファイル（`apps/desktop/src/renderer/songActions.test.ts`）とし、選んだ 1 曲にタグを付けて外したとき、その曲のファイルの `appMeta.tags`（[[data-model-persistence.md#6]] の 6.3 節）が変わることを確かめる。曲一覧の「名前を変更」（12 章 6.2 節の「曲名・アーティスト名」の行）のテストも同じファイルに足す。今の曲のアクションのテストが 1 つのファイルにまとまっているため。上の表の置き場所には、基本設計 11 章 3.1 節に合わせてこのファイルを足した（2026-10-19 本人決定、honnin-queue 167 番）。 <!-- req 12:a9a16159.d66c --> <!-- req 11:0d61b9b2.5888 --> <!-- req 11:0d61b9b2.c3fb -->
- 自動保存は、単体テスト（`UT-PERSIST-AUTOSAVE` と `UT-FLUSH-*`）に加えて、編集の通しのテスト（`IT-EDIT-*`、`packages/core/src/editing/editing.integration.test.ts`）でも確かめる（12 章 6.2 節の「保存方式（自動保存）」の行）。`IT-EDIT-*` は、コマンドを出したあとに `AutoSaveScheduler.notifyDirty` が呼ばれ、編集が止まってから 2 秒（`AUTOSAVE_DEBOUNCE_MS`、[[data-model-persistence.md#15]]）で `SongRepository.save` が呼ばれることを、コマンドから描き直しまでの通しと同じテストのファイルで確かめる。 <!-- req 12:9b889550.fbf2 -->

| テスト ID の頭（接頭辞と対象略号） | テストのファイル |
|---|---|
| `UT-CORE-CHECKSUM` | `packages/core/src/domain/checksum.test.ts` <!-- req 11:e3983e33.b3d4 --> |
| `UT-CORE-PITCH` | `packages/core/src/domain/pitch.test.ts` <!-- req 11:e3983e33.ad39 --> |
| `UT-CORE-SHA256` | `packages/core/src/domain/sha256.test.ts` <!-- req 11:e3983e33.851b --> |
| `UT-CORE-SONGDOC` | `packages/core/src/domain/SongDocument.test.ts` <!-- req 11:e3983e33.e31a --> |
| `UT-CORE-VALID` | `packages/core/src/domain/validation.test.ts` <!-- req 11:e3983e33.e0b7 --> |
| `UT-FS-ERRORS` | `packages/core/src/platform/errors.test.ts` <!-- req 11:8f6a6071.0154 --> |
| `UT-FS-IPCADAPTER` | `apps/desktop/src/renderer/ipcFileSystem.test.ts` <!-- req 11:8f6a6071.ca19 --> |
| `UT-FS-RETRY` | `apps/desktop/src/main/onDemandRetry.test.ts` <!-- req 11:8f6a6071.8436 --> |
| `UT-PERSIST-AUTOSAVE` | `packages/core/src/persistence/AutoSaveScheduler.test.ts` <!-- req 11:7a9b5d4f.8779 --> |
| `UT-PERSIST-BACKUP` | `packages/core/src/persistence/LocalBackupService.test.ts` <!-- req 11:7a9b5d4f.8029 --> |
| `UT-PERSIST-CONFIG` | `packages/core/src/persistence/StorageConfigService.test.ts` <!-- req 11:7a9b5d4f.4867 --> |
| `UT-PERSIST-INDEX` | `packages/core/src/persistence/SongIndexService.test.ts` <!-- req 11:7a9b5d4f.a080 --> |
| `UT-PERSIST-MIGRATE` | `packages/core/src/persistence/SchemaMigrator.test.ts` <!-- req 11:7a9b5d4f.a6bf --> |
| `UT-PERSIST-MIRROR` | `packages/core/src/persistence/MirrorSyncService.test.ts` <!-- req 11:7a9b5d4f.a7a1 --> |
| `UT-PERSIST-REPO` | `packages/core/src/persistence/SongRepository.test.ts` <!-- req 11:7a9b5d4f.6882 --> |
| `UT-PERSIST-STORAGEMIG` | `packages/core/src/persistence/StorageMigrationService.test.ts` <!-- req 11:7a9b5d4f.e43a --> |
| `UT-PERSIST-TRASH` | `packages/core/src/persistence/TrashService.test.ts` <!-- req 11:7a9b5d4f.3ddb --> |
| `UT-ERR-CODES` | `packages/core/src/errors/coreErrorCodes.test.ts` <!-- req 11:651bccac.7111 --> |
| `UT-ERR-CRC` | `apps/desktop/src/main/CrashRecoveryController.test.ts` <!-- req 11:651bccac.8ad8 --> |
| `UT-ERR-LOG` | `packages/core/src/errors/Logger.test.ts` <!-- req 11:651bccac.21a9 --> |
| `UT-ERR-NC` | `packages/core/src/errors/NotificationCenter.test.ts` <!-- req 11:651bccac.eea4 --> |
| `UT-ERR-REG` | `packages/core/src/errors/ErrorCodeRegistry.test.ts` <!-- req 11:651bccac.f8ae --> |
| `UT-ERR-RING` | `apps/desktop/src/main/LogRingBuffer.test.ts` <!-- req 11:651bccac.a5ed --> |
| `UT-ERR-TMPL` | `packages/core/src/errors/messageTemplate.test.ts` <!-- req 11:651bccac.71bd --> |
| `UT-EDIT-ATTR` | `packages/core/src/editing/commands/noteAttributeCommands.test.ts` <!-- req 11:362f6561.49d5 --> <!-- req 12:75655045.57d1 --> <!-- req 12:18b27c18.fccb --> <!-- req 12:4087ed32.7a3b --> <!-- req 12:17204800.ec0f --> <!-- req 12:24e72919.e689 --> <!-- req 12:780414b5.db48 --> <!-- req 12:fdd24556.a314 --> <!-- req 12:aa6a03a3.cb12 --> <!-- req 12:ffda1de4.aed0 --> <!-- req 12:5a44a5c1.3d8b --> <!-- req 12:9c5597a7.7be0 --> |
| `UT-EDIT-BAR` | `packages/core/src/editing/commands/barCommands.test.ts` <!-- req 11:362f6561.813b --> <!-- req 12:27e8fbee.0c8e --> |
| `UT-EDIT-BEATTECH` | `packages/core/src/editing/commands/noteAttributeCommands.test.ts`（要追加） <!-- req 11:362f6561.2730 --> |
| `UT-EDIT-CHORD` | `packages/core/src/editing/ChordDetectionService.test.ts` <!-- req 11:362f6561.ac3e --> <!-- req 12:ffbd1a5b.84c2 --> |
| `UT-EDIT-COMPOSITE` | `packages/core/src/editing/CompositeCommand.test.ts` <!-- req 11:362f6561.7c04 --> |
| `UT-EDIT-CURSOR` | `packages/core/src/editing/CursorController.test.ts` <!-- req 11:362f6561.7a9c --> <!-- req 12:c813662e.2930 --> <!-- req 12:fb4e7c62.c6f0 --> |
| `UT-EDIT-DURATION` | `packages/core/src/editing/commands/SetBeatDurationCommand.test.ts`（要追加） <!-- req 11:362f6561.0cd0 --> |
| `UT-EDIT-HIST` | `packages/core/src/editing/CommandHistory.test.ts` <!-- req 11:362f6561.2722 --> <!-- req 12:75c4f0b9.afab --> |
| `UT-EDIT-INSERTREST` | `packages/core/src/editing/commands/InsertRestCommand.test.ts` <!-- req 11:362f6561.63e0 --> <!-- req 12:3e4f2e85.7fd2 --> |
| `UT-EDIT-MEMO` | `packages/core/src/editing/commands/memoCommands.test.ts` <!-- req 11:362f6561.a377 --> <!-- req 12:0b0a892d.cdf7 --> |
| `UT-EDIT-PASTE` | `packages/core/src/editing/commands/PasteCommand.test.ts` <!-- req 11:362f6561.6421 --> <!-- req 12:9cc593c8.32f5 --> |
| `UT-EDIT-PLACENOTE` | `packages/core/src/editing/commands/PlaceNoteCommand.test.ts` <!-- req 11:362f6561.7ba1 --> <!-- req 12:6b98293b.bd7a --> <!-- req 12:fb4e7c62.6fd2 --> <!-- req 12:50e1df1d.bb79 --> |
| `UT-EDIT-REPEAT` | `packages/core/src/editing/commands/SetRepeatCommand.test.ts`（要追加） <!-- req 11:362f6561.7324 --> <!-- req 12:48f50f74.1acb --> |
| `UT-EDIT-SECTION` | `packages/core/src/editing/commands/sectionMarkerCommands.test.ts` <!-- req 11:362f6561.27a7 --> <!-- req 12:9e0bbadd.84da --> |
| `UT-EDIT-SVC` | `packages/core/src/editing/EditingService.test.ts` <!-- req 11:362f6561.f685 --> |
| `UT-EDIT-TEMPO` | `packages/core/src/editing/commands/SetTempoCommand.test.ts` <!-- req 11:362f6561.2d8d --> <!-- req 12:49af6515.2dca --> <!-- req 12:07d26efd.1c28 --> |
| `UT-EDIT-TIMESIG` | `packages/core/src/editing/commands/SetTimeSignatureCommand.test.ts`（要追加） <!-- req 11:362f6561.2137 --> <!-- req 12:86ad12a6.452f --> |
| `UT-EDIT-VALID` | `packages/core/src/editing/ValidationService.test.ts` <!-- req 11:362f6561.410e --> <!-- req 12:a36211d9.6da8 --> <!-- req 12:6ad3bdd2.27c0 --> |
| `UT-PART-ATTR` | `packages/core/src/parts/commands/partAttributeCommands.test.ts` <!-- req 11:f9e22979.0e16 --> <!-- req 12:354144c7.5785 --> <!-- req 12:3aa511e1.bd88 --> |
| `UT-PART-CODES` | `packages/core/src/parts/partErrorCodes.test.ts` <!-- req 11:f9e22979.90c9 --> |
| `UT-PART-COLOR` | `packages/core/src/parts/PartColorAllocator.test.ts` <!-- req 11:f9e22979.bdd5 --> |
| `UT-PART-MGMT` | `packages/core/src/parts/PartManagementService.test.ts` <!-- req 11:f9e22979.5cf5 --> |
| `UT-PART-PRESET` | `packages/core/src/parts/TuningPresetService.test.ts` <!-- req 11:f9e22979.33b7 --> <!-- req 12:b417fcd4.0e8f --> |
| `UT-PART-STRUCT` | `packages/core/src/parts/commands/structuralPartCommands.test.ts` <!-- req 11:f9e22979.4984 --> |
| `UT-PART-TUNING` | `packages/core/src/parts/commands/tuningCommands.test.ts` <!-- req 11:f9e22979.8a1b --> <!-- req 12:b417fcd4.d840 --> <!-- req 12:082934e9.3f17 --> |
| `UT-PART-VALID` | `packages/core/src/parts/PartValidationService.test.ts` <!-- req 11:f9e22979.c41d --> |
| `UT-VIEW-MODE` | `packages/core/src/viewmodes/ViewModeController.test.ts` <!-- req 11:7dcd4aa9.ee71 --> |
| `UT-VIEW-ZOOM` | `packages/core/src/viewmodes/ZoomController.test.ts` <!-- req 11:7dcd4aa9.54b7 --> |
| `UT-RENDER-HOST` | `packages/core/src/rendering/ScoreRenderHost.test.ts` <!-- req 11:79ee6792.786e --> |
| `UT-PLAY-COUNTIN` | `packages/core/src/playback/CountInController.test.ts` <!-- req 11:c9eb2825.00a1 --> <!-- req 12:a721c35f.ca87 --> |
| `UT-PLAY-CURSOR` | `packages/core/src/playback/PlaybackCursorFollow.test.ts` <!-- req 11:c9eb2825.f9a0 --> |
| `UT-PLAY-METRONOME` | `packages/core/src/playback/MetronomeService.test.ts` <!-- req 11:c9eb2825.a58d --> <!-- req 12:a721c35f.a566 --> |
| `UT-PLAY-MIXER` | `packages/core/src/playback/PlaybackMixerBinder.test.ts` <!-- req 11:c9eb2825.6836 --> |
| `UT-PLAY-STRATEGY` | `packages/core/src/playback/AudioSyncStrategy.test.ts` <!-- req 11:c9eb2825.d66f --> |
| `UT-PLAY-SVC` | `packages/core/src/playback/PlaybackService.test.ts` <!-- req 11:c9eb2825.7d14 --> <!-- req 12:adc80cb3.a95f --> |
| `UT-PLAY-SYNC` | `packages/core/src/playback/PlaybackSyncController.test.ts` <!-- req 11:c9eb2825.4b4a --> |
| `UT-PLAY-TAPTEMPO` | `packages/core/src/playback/TapTempoController.test.ts` <!-- req 11:c9eb2825.34fa --> |
| `UT-PLAY-TICKMAP` | `packages/core/src/playback/tickMap.test.ts` <!-- req 11:c9eb2825.a310 --> |
| `UT-UI-APS` | `packages/core/src/ui/AppPreferencesService.test.ts` <!-- req 11:11ebfbfd.efe3 --> |
| `UT-UI-ERR` | `packages/core/src/ui/uiErrorCodes.test.ts` <!-- req 11:11ebfbfd.6cfd --> |
| `UT-UI-KSR` | `packages/core/src/ui/KeyboardShortcutRouter.test.ts` <!-- req 11:11ebfbfd.bd0a --> |
| `UT-UI-MB` | `packages/core/src/ui/MenuBarController.test.ts` <!-- req 11:11ebfbfd.32a1 --> |
| `UT-UI-NUB` | `packages/core/src/ui/NotificationUIBinder.test.ts` <!-- req 11:11ebfbfd.e845 --> |
| `UT-UI-PCO` | `packages/core/src/ui/PartColorOverlay.test.ts` <!-- req 11:11ebfbfd.d37d --> |
| `UT-UI-PPA` | `packages/core/src/ui/PlaybackPreferencesAdapter.test.ts` <!-- req 11:11ebfbfd.c299 --> |
| `UT-UI-SB` | `packages/core/src/ui/StatusBarViewModel.test.ts` <!-- req 11:11ebfbfd.7b45 --> |
| `UT-UI-SHB` | `packages/core/src/ui/ScoreHighlightBinder.test.ts` <!-- req 11:11ebfbfd.b09c --> |
| `UT-UI-SRH` | `packages/core/src/rendering/ScoreRenderHost.highlight.test.ts` <!-- req 11:11ebfbfd.6257 --> <!-- req 12:1708da5a.a5c4 --> |
| `UT-UI-TAG` | `packages/core/src/ui/TagStore.test.ts` <!-- req 11:11ebfbfd.cba0 --> |
| `UT-UI-TB` | `packages/core/src/ui/ToolbarViewModel.test.ts` <!-- req 11:11ebfbfd.3c94 --> |
| `UT-UI-TG` | `packages/core/src/ui/ThumbnailGenerator.test.ts` <!-- req 11:11ebfbfd.85e3 --> |
| `IT-FS-ADAPTER` | `apps/desktop/src/main/ElectronFileSystemAdapter.test.ts` <!-- req 11:5f35d0e8.2b0e --> |
| `IT-FS-APPCONFIG` | `apps/desktop/src/main/ElectronAppLocalConfigService.test.ts` <!-- req 11:5f35d0e8.c7df --> |
| `IT-FS-FACTORY` | `apps/desktop/src/main/ElectronFileSystemAdapterFactory.test.ts` <!-- req 11:5f35d0e8.e54a --> |
| `IT-FS-IPC` | `apps/desktop/src/main/ipc.test.ts` <!-- req 11:5f35d0e8.3332 --> |

### 14.5 結合テスト

- 単体テストで確かめたモジュールどうしを組み合わせ、サービスの層をまたぐ連携が設計どおりに働くかを確かめる。 <!-- req 11:f95dce1f.5bb7 -->

| 組み合わせ | 確かめること | ID とファイル |
|---|---|---|
| 編集サービス＋コマンド層＋ドメインのモデル | UI のイベントにあたる入力から、コマンドの発行 → モデルの更新 → カーソルの移動までの流れ（基本設計 04 章 1 節） | `IT-EDIT-*`（14.4 節） <!-- req 11:c55e396e.f0c9 --> |
| 再生のサービス＋alphaTab（AlphaSynth） | 合奏の再生・ソロの再生・ループの境での部分の差し替え（基本設計 05 章 3.2 節）が、実際の alphaTab の API とかみ合うか | `IT-PLAY-*` <!-- req 11:7a5a0625.c6f0 --> <!-- req 11:7a5a0625.7f97 --> <!-- req 11:7a5a0625.d20b --> |
| ファイル I/O＋保存先の切り替え | ローカル・iCloud Drive・Google Drive のそれぞれのフォルダへの読み書きと、保存先の移行の流れ（基本設計 06 章 2.2 節） | `IT-FS-*` <!-- req 11:57661de1.2ec5 --> <!-- req 11:57661de1.9d74 --> <!-- req 11:57661de1.83c6 --> <!-- req 11:57661de1.ad71 --> |
| エラーの知らせの経路 | 各サービスの層で起きたエラーが、`NotificationCenter` を通ってログの記録と、画面の表示の要求まで届く経路。14.3 節で単体テストした振り分けを、実際の呼び出し元のサービスと組み合わせて確かめ直す | `IT-ERR-LOG-*`。観点は [[error-logging-foundation.md#7]] <!-- req 11:df13a22b.58f3 --> <!-- req 11:df13a22b.fd2e --> <!-- req 11:df13a22b.f9e3 --> |
| スキーマの移行＋ファイルの読み込み | 旧版の `.tabapp` を実際に読み込ませ、移した後に正しく編集と保存ができるか | `IT-FS-*` <!-- req 11:55ef229c.6cf6 --> <!-- req 11:55ef229c.7c1e --> <!-- req 11:55ef229c.b1cd --> |

- (b) ローカルのフォルダへの読み書きと保存先の移行は、一時フォルダを保存先にして CI で回す。iCloud Drive と Google Drive のフォルダは、同期のクライアントを入れた実機で手で回す（CI の環境に同期のクライアントが無いため）。手順は、(1) 同期フォルダを保存先にして曲を作って保存する、(2) 同期を待ってから、もう 1 台の PC で曲一覧に出て開けることを見る、(3) もう 1 台で直して保存し、元の PC で読み込み直して直した中身が出ることを見る、(4) 同期フォルダの曲がまだ PC に降りていない状態で開き、読み込みを待つ処理（[[data-model-persistence.md#16]]）を通って開けることを見る、の 4 つ。同期フォルダへ読み書きできるかは Phase 0、Windows 版の iCloud の安定は Phase 1 の前半、Google Drive for Desktop は Phase 1 の前半から中盤に、この手順で確かめる（[[data-model-persistence.md#16]]）。 <!-- req 12:833fee95.b3a7 --> <!-- req 12:833fee95.a6b7 -->
- (b) スキーマの移行の結合テストは、版ごとに 1 つずつの旧版の `.tabapp` をテストのフィクスチャとして `apps/desktop/src/main` のテストの隣に置き、実際の I/O で読み込む。旧版のファイルは、その版を出したときの形を残しておくため、作る関数ではなくファイルで置く。
- (b) 再生の結合テストは、実際の alphaTab を動かす。音を出す先の無い環境（Vitest の jsdom）で AlphaSynth が動くかは確かめていないので、Phase 0 で確かめる。動かないときは、この結合テストを実機のシステムテスト（14.6 節）に移す。

### 14.6 システムテストと運用テスト

- システムテストは、Claude Code が要件定義書のユースケースごとに、操作のシナリオで通して確かめる。シナリオの例は、4/4 拍子の 8 小節をステップ入力し、途中でタイとチョーキングを付け、Undo と Redo で意図どおりに戻ることを確かめるもの、曲を新しく作ってパートを足し、合奏で再生して書き出すまでを通すもの。 <!-- req 11:8e8695c3.0636 --> <!-- req 11:8e8695c3.1386 --> <!-- req 11:8e8695c3.d2f7 --> <!-- req 11:8e8695c3.262c --> <!-- req 11:8e8695c3.d3d3 -->
- 実際に Electron のアプリを起動した状態で確かめ、単体テストと結合テストでは見えない、UI を通した不具合（ショートカットのぶつかり・レイアウトの崩れ・基本設計 14 章 8 節のレスポンシブの原則の破綻）を洗い出す。 <!-- req 11:ca36a41e.1993 --> <!-- req 11:ca36a41e.ca51 --> <!-- req 11:ca36a41e.c5b6 --> <!-- req 11:ca36a41e.0c25 --> <!-- req 11:ca36a41e.8f4f --> <!-- req 11:ca36a41e.b22a -->
- 主要な作業パッケージがそろったときと、Phase の節目にする。入る前に、その Phase の技術検証待ち（13 章のカテゴリ A）のうちフォールバックが決まっていないものが 0 件であることを確かめる（14.1 節の表）。 <!-- req 11:1f473536.693d --> <!-- req 11:1f473536.8952 -->
- (b) 操作は、production のビルドを Chrome DevTools Protocol（CDP）でつないで起動したアプリに、キーとマウスの入力を送って行い、結果を画面の写しとログで確かめる。error-logging-foundation.md 8 節の基準 5 を 2026-09-08 に確かめたときと同じ形で、開発のサーバー（`pnpm dev`）を通らない動きを見るため。

要件定義書が「こう決める」と「実際にそうなっている」の 2 つを 1 文で求めている次の 7 件は、全件をシステムテストの合格の条件として扱う。後半は文書を書いても満たせないので、ここで合格の条件として確かめる。 <!-- req 11:1374b1ae.db50 -->

| # | 要求 | 合格の条件 | 確かめ方 |
|---|---|---|---|
| 1 | 全部の機能がオフラインで動く（要件 3.1） | OS のネットワークアダプタを無効にした状態でアプリを起動し、曲の新規作成・編集・保存・再生・書き出し・印刷プレビューの 6 つを順に通せる。途中で通信のエラーの知らせが 1 件も出ない（基本設計 09 章 4.1 節） | (b) Windows の設定でネットワークアダプタを無効にした実機で、6 つを 1 回ずつ通す <!-- req 11:f2db53c4.793d --> <!-- req 11:f2db53c4.64ea --> <!-- req 11:f2db53c4.4188 --> |
| 2 | 通信が一切ない状態でも全部の機能が完全に動く（要件 5.1） | #1 と同じ手順で確かめる。加えて、アプリの通信を観測して、外へのリクエストが 0 件（更新のチェックのダミーの実装が実際に問い合わせていないことを含む） | (b) 観測は OS の側で行う（Windows のリソースモニターのネットワークのタブで、アプリのプロセスの送り先が 0 件）。アプリの中の仕組みで数えると、その仕組みを通らない通信を見落とすため <!-- req 11:6932ff87.0af7 --> <!-- req 11:6932ff87.8794 --> |
| 3 | サポートの下限の目安として Windows 10 以降で動く（要件 5.5） | 基本設計 09 章 4.2 節の規則で決まる下限の版（2026 年の時点では Windows 10）の実機か仮想の環境で、アプリが起動して #1 の 6 操作を通せる。上限の側（最新の版）でも同じことを確かめる | (b) 下限の側は仮想の環境でよく、上限の側は開発機とは別の環境で確かめる <!-- req 11:7bb333ac.64a9 --> <!-- req 11:7bb333ac.c741 --> <!-- req 11:7bb333ac.e6ae --> |
| 4 | ビルドしたものが Windows で起動して動く（要件 6 章） | 配布用にビルドしたパッケージを、開発の環境ではない別の Windows の環境へ置いて起動できる。開発機の `pnpm dev` での起動は、この項目の合格の根拠にしない（依存が開発の環境に残っていても気づけないため） | (b) #3 の仮想の環境に、ビルドしたパッケージだけを置いて起動する <!-- req 11:58a54634.eff6 --> <!-- req 11:58a54634.ba9f --> <!-- req 11:58a54634.b669 --> |
| 5 | 背景で動く音楽アプリの音と混ぜて、同時に鳴らせる（要件 4.3） | PC 版：別の音楽アプリで再生したまま本アプリで合奏を再生し、両方の音が同時に聞こえる（どちらかが止まったり音量が下がったりしない）。iPhone 版（Phase 3）：同じことを実機で確かめる。要件書のリスク#1 のとおり実機でしか確かめられないので、Phase 3 の最優先の項目にする（基本設計 10 章 4 節） | 実機で耳で確かめる <!-- req 11:d5dbebe4.8f0a --> <!-- req 11:d5dbebe4.b217 --> <!-- req 11:d5dbebe4.8dcf --> |
| 6 | Webコアが特定の OS と実行環境の API に依存せずに動く（要件 6 章） | `packages/core` から `electron` か `expo-*` を直接 import するコードを 1 つ書き足したとき、ビルドか Lint が実際に落ちる（5.2 節）。「Lint の違反 0 件」はこの項目の合格の根拠にせず、禁止を見つけられることのほうを確かめる（ルールが書かれていなければ違反も 0 件になるため） | (b) 確かめのための一時のブランチで `packages/core` に 1 行の import を足し、`pnpm build`（最初に `pnpm lint` を走らせる、5.2 節）が失敗することを見てから、ブランチを捨てる <!-- req 11:df0409ef.0013 --> <!-- req 11:df0409ef.ce0e --> <!-- req 11:df0409ef.fbe7 --> <!-- req 11:df0409ef.3425 --> |
| 7 | ショートカットの対応表が決まっていて、実装されている（要件 5.6） | 基本設計 03 章 7 節の表の全部の行について、書かれているキーを実際に押すと、書かれている操作が起き、書かれている「有効になる画面とフォーカスの状態」の外では起きない。表の行の数と、確かめた行の数が一致する | 表の正は [[screens-navigation.md#9]]。(b) 確かめた行に印を付けた写しを残し、行の数を数えて比べる <!-- req 11:a84bd3d2.110f --> <!-- req 11:a84bd3d2.3251 --> <!-- req 11:a84bd3d2.bb03 --> <!-- req 11:a84bd3d2.adbb --> |

- この 7 件は、システムテストと同じとき（主要な作業パッケージがそろったときと、Phase の節目）に確かめる。#5 の iPhone 版と、#3 の iOS の側は Phase 3 で確かめる。 <!-- req 11:700ce241.3438 --> <!-- req 11:700ce241.5935 --> <!-- req 11:e3743795.83af --> <!-- req 11:e3743795.7171 -->

運用テスト：

- 運用テストは、開発者の本人が、実際の演奏と突き合わせて行うテストとする。実際の耳コピの作業の流れを通しで行い、UX の違和感（要件 4.5 の複数の操作のしかたが働いているかを含む）と、システムテストまでの工程では気づけない、実際の運用の課題を確かめる。 <!-- req 11:cf0a0c3c.adbe --> <!-- req 11:f9b489c0.fe58 --> <!-- req 11:f9b489c0.8044 --> <!-- req 11:f9b489c0.9e1a -->
- Phase 1 の完了の前と後、それ以降の主要な機能を足したときにする。 <!-- req 11:37bcd62c.43dc --> <!-- req 11:37bcd62c.7da2 --> <!-- req 11:37bcd62c.ce1e -->

### 14.7 継続的インテグレーション（CI）

- CI は GitHub Actions（`.github/workflows/ci.yml`）で動かし、PR を作るたびと、更新するたびに自動で走らせる。 <!-- req 11:a1d404a2.4bf6 --> <!-- req 11:a1d404a2.a211 --> <!-- req 11:a1d404a2.2799 -->
- 走らせるものは次の 4 つ。 
  - カバレッジの計測を含む単体テストと結合テスト（14.3 節）：`vitest run --coverage`。しきい値は 14.1 節の表の C0 と C1 の行 <!-- req 11:3141f33d.a934 -->
  - Lint：`pnpm lint`（ESLint） <!-- req 11:a67e0d7c.54a3 -->
  - 型チェック：`pnpm typecheck`。出力のファイルを作らずに型だけを見る `tsc --noEmit` と同じ型の検査をする <!-- req 11:a67e0d7c.50bc -->
  - 書式の確かめ：`pnpm format`（Prettier の `--check`） <!-- req 11:a67e0d7c.7500 -->
- 上の 4 つに加えて、今の `ci.yml` にある `pnpm run check:quality`（文書のリンク・ダミーの配線・テスト ID、14.4 節）と `pnpm build`（5.2 節）と、PR のコミットの commitlint も走らせる。
- `pnpm run check:quality` は、設計書の相互参照の確かめ（`pnpm check:docs`）、UI の配線のダミーのハンドラの見つけ出し（`pnpm check:stubs`）、テスト ID の確かめ（`pnpm check:test-ids`）の 3 つをつないだものとする。CI はこれを品質のゲートとして走らせ、作業パッケージ 1〜8 のマージの後に見つかった崩れ方（ダミーの配線と、設計書の相互参照の切れ）を、同じ形で機械で見つける（基本設計 13 章 B37）。 <!-- req 13:16f0e974.6c64 --> <!-- req 13:16f0e974.4ca6 -->
- ブランチの保護のルールで、上のステータスのチェックを必須にし、失敗している間は `main` へのマージを止める（基本設計 15 章 3.1 節の PR ベースの運用）。 <!-- req 11:e68c47f5.5499 --> <!-- req 11:e68c47f5.17c9 -->
- カバレッジの道具（Vitest の `--coverage`）の結果を CI のステータスに反映し、C0 と C1 の 100% を機械で確かめる。対象ロジックの C2 は、14.3 節の組み合わせの表がテストとして通ることで確かめる。 <!-- req 11:85620152.260b --> <!-- req 11:85620152.d398 --> <!-- req 11:85620152.0015 -->
- 今の `ci.yml` と `package.json` には、カバレッジの計測としきい値と、Prettier の確かめがまだ入っていない（[[00_reference.md#8.1]] の G75）。
- 負荷テスト（14.8 節）は CI で自動にせず、Phase 0 から Phase 1 に着手した後に手で行う。起動時間・fps・メモリの実測には、Electron のアプリを実際に起動する実機の環境が要り、今の CI の環境（画面を持たずに動かす前提）では代わりにならないため。Electron を画面なしで動かせる環境が整えば自動にすることを検討するが、今は範囲の外とする。 <!-- req 11:a463c56e.15e6 --> <!-- req 11:a463c56e.3f70 --> <!-- req 11:a463c56e.533f --> <!-- req 11:fc5c2bcc.1bd1 -->

### 14.8 負荷テストの手順

10.6 節の負荷テストを、次の手順で行う。 

| 手順 | すること |
|---|---|
| 1 | 開発用サンプルデータ（14.9 節）で、2048 小節・全部の奏法記号を含むフィクスチャを、4 パートと 8 パートの 2 つ作る（基本設計 09 章 2 節） <!-- req 11:e6be99bc.0efb --> <!-- req 11:e6be99bc.2c6f --> |
| 2 | 基本設計 09 章 1 節の目標値（起動・入力の反応・発音・fps・再生の開始）を測る（14.1 節の表）。fps は、スクロールの間と、ズームの操作の間（Ctrl＋ホイールとスライダー）の両方で測る（要件 5.2 の、譜面のスクロールとズームの描画の 30fps）。目標値は 4 パートのデータで満たすことを確かめ、8 パートのデータでは落ちずに動くことを確かめて、測った値を記録する <!-- req 11:191e28bd.3b4f --> <!-- req 11:191e28bd.8ecc --> <!-- req 11:191e28bd.ec77 --> <!-- req 11:191e28bd.769f --> <!-- req 11:191e28bd.e159 --> <!-- req 11:191e28bd.c6a1 --> <!-- req 11:191e28bd.3fff --> <!-- req 11:191e28bd.fcd2 --> <!-- req 11:191e28bd.ec2c --> <!-- req 13:ddaee6e8.92a1 --> |
| 3 | 基本設計 09 章 3 節のメモリの目標値を、アイドル時・通常の編集・大曲の編集の場面ごとに測る（測る状態は 10.2 節）。4 パートのデータで満たすことを確かめ、8 パートのデータは測った値を記録する <!-- req 11:2dadffc4.ae63 --> <!-- req 11:2dadffc4.a7e6 --> <!-- req 11:2dadffc4.32cd --> <!-- req 11:2dadffc4.83e9 --> <!-- req 11:2dadffc4.11ba --> |
| 4 | 4 パートのデータで目標に届かない項目があれば、その設計書（基本設計 05 章・06 章・09 章と、それを受ける詳細設計書）に返して、対策の案を書き足す。目標値は下げない（14.1 節） <!-- req 11:0d3750e5.7ff6 --> <!-- req 11:0d3750e5.9a7d --> <!-- req 11:0d3750e5.e38c --> |

- 同じ手順の中で、10.6 節の A6（シリアライズ）・A8（描き直しと 100ms）・A9（全体スクロールとズームの間の fps）を確かめる。
- (b) 測った値は、測った日・アプリの版・PC の型番・データ（4 パートか 8 パート）と並べて、基本設計 13 章 2 節の該当する項目（A6・A8・A9）に書く。8.1 節の G33 の判定の条件（13 章 2 節の各項目に結果を書けること）にそろえるため。
- A8 の描き直しの方式で、(a) 今の方式のまま、(b) 続けての入力を `canMergeWith` でまとめて描き直しの回数を減らす、(c) 変えた中身ごとの安全な部分の描き直しへ移す、のどれを採るかは、今は決めていない。この手順で測った結果で決める（基本設計 13 章 A8）。 <!-- req 13:575e4e1d.aa89 -->
- 負荷テストは、14.2 節の 4 つの段のうち、システムテストと運用テストのあいだに置く。機能の正しさではなく、非機能の要件を満たしているかを確かめる、段をまたぐ軸として扱う。 <!-- req 11:85031113.604a -->

### 14.9 開発用サンプルデータ

- 開発用サンプルデータ（要件 9 章。利用者に向けて同梱するサンプルとは別）は、`packages/core/src/testing` に置き、`tools/` を設けない（2026-09-27 本人決定、5.1 節）。 <!-- req 11:95237549.eaef --> <!-- req 11:95237549.b210 -->
- 用意するフィクスチャは次の 3 つ。

| フィクスチャ | 中身 | 使うテスト |
|---|---|---|
| 奏法記号の網羅 | 短い曲に、奏法記号のすべて（チョーキング・スライド・HP-PO〈ハンマリングとプリング〉・パームミュート・ビブラート・ハーモニクスの 3 種・タッピング・スラップ・ポップ・ブラシ・アーティキュレーションの 5 つ〈基本設計 02 章 3.3 節〉）を少なくとも 1 回ずつ含む。基本設計 04 章 6 節の Note の単位と Beat の単位の 2 行にある、実装する奏法記号をすべて含める | 機能の網羅のテスト <!-- req 11:680df968.3fd5 --> <!-- req 11:680df968.c799 --> <!-- req 11:680df968.4bf7 --> <!-- req 11:680df968.ef33 --> <!-- req 11:680df968.20de --> <!-- req 11:680df968.1f81 --> <!-- req 11:680df968.be9b --> <!-- req 11:680df968.474c --> <!-- req 11:680df968.81c5 --> <!-- req 11:680df968.3eb8 --> <!-- req 11:680df968.30ec --> <!-- req 11:680df968.edd1 --> |
| 大曲 | 2048 小節で、4 パートと 8 パートの 2 つ（14.8 節）。機械で作ってよく、実際の演奏として自然である必要はない | 負荷テスト <!-- req 11:584175b9.2d72 --> <!-- req 11:584175b9.20bc --> |
| 複数のパート | 複数のパート（上限の 8 パート）・複数のチューニング・カポの設定を含む | パートの管理とチューニングの機能のテスト <!-- req 11:5d38a226.ecc3 --> <!-- req 11:5d38a226.ea5e --> <!-- req 11:5d38a226.92d6 --> |

- 2048 小節の大曲のフィクスチャは、データのファイルをリポジトリにコミットせず、テストのたびに作る関数として置く（データの大きさと、更新の手間を避けるため）。 <!-- req 11:95237549.75ae --> <!-- req 11:95237549.314f -->
- (b) 関数は次の形にし、今の `editingFixtures.ts`（`makeSong`・`makeSongWithBars`）と同じフォルダに置く。

```ts
// packages/core/src/testing/scoreFixtures.ts
/** 奏法記号の網羅のフィクスチャ。毎回新しい Score を返す */
export function makeTechniqueCoverageScore(): Score;
/** 大曲のフィクスチャ。小節の数とパートの数を受け、毎回作り直す */
export function makeLargeScore(options: { barCount: number; partCount: 4 | 8 }): Score;
/** 複数のパート・複数のチューニング・カポのフィクスチャ */
export function makeMultiPartScore(): Score;

// packages/core/src/testing/combinations.ts
/** C2 の組み合わせの表（14.3 節）。keys の要素ごとの真と偽の組み合わせを、2 の keys.length 乗の行で返す */
export function allCombinations<K extends string>(keys: readonly K[]): Array<Record<K, boolean>>;
```

- (b) どの関数も毎回新しいオブジェクトを返す。あるテストがフィクスチャを書き換えても、別のテストに影響が出ないようにするため。

## 15. 開発の進め方

[[../basic_design/15_development_process.md]] を受ける。何をテストするかは 14 節（基本設計 11 章）が受け、本節は、どういう手順と体制で作るか（開発モデル・詳細設計の工程・ブランチの運用・コミットの規約・Claude Code との協働のサイクル・テストとセルフレビューの時機・完了の基準・リリースの運用）を、作業パッケージをまたぐ決まりとして 1 か所に置く。 <!-- req 15:dc1d7edd.f576 --> <!-- req 15:dc1d7edd.2e8b --> <!-- req 15:dc1d7edd.0052 --> <!-- req 15:dc1d7edd.7026 --> <!-- req 15:dc1d7edd.d448 --> <!-- req 15:dc1d7edd.c853 --> <!-- req 15:dc1d7edd.ff89 --> <!-- req 12:02e22ba6.900e --> <!-- req 12:02e22ba6.ee47 --> <!-- req 12:02e22ba6.bdc0 -->
- 開発の進め方は、実装の段に先送りせず、基本設計の段で基本設計 15 章として足して決めてある（基本設計 12 章 3.8 節）。本節はそれを詳細設計の水準で受ける。基本設計の各章は Phase 1 に当たる範囲を受け持ち、Phase 2 から後は基本設計 10 章が受け持つ。作業パッケージの実施の順と進め方は、基本設計 15 章 4 節に従う（15.4 節）。 <!-- req 12:cf19dbab.7983 --> <!-- req 12:cf19dbab.3d91 --> <!-- req 12:9f2c4f8b.c193 --> <!-- req 12:46b8e728.e1a5 --> <!-- req 12:94582639.0a45 -->
- (b) 本節を本書に置くのは、作業パッケージをまたぐ決まりで、その道具の設定（コミットの前のフック・CI）を最初に置くのが本書の作業パッケージ（実施順 1）だから。14 節を本書に置くのと同じ理由。

### 15.1 進め方の原則

- 厳密さを「誰の時間で」測るかで決める。手戻りを防ぐ厳密さと、一人で隙間の時間に作ることに耐える軽さの 2 つを同じ重さで並べる考え方は採らない。 <!-- req 15:23c7983a.945f -->
- 「隙間の時間で作る」という制約が効くのは、本人が自分の時間を割く工程（本人が全部の差分を読むレビューと、本人が手でテストを書くこと）だけとする。自動にした工程（Git のフックでの Lint と型チェック、CI でのビルドとテスト、Claude Code のセルフレビューのセッション）は本人の時間を使わないので、「一人で作るから」「隙間の時間だから」を理由に緩めない。費用がほとんどかからない自動の工程は、当てる範囲をできるだけ広げる。 <!-- req 15:c136239d.98a3 --> <!-- req 15:c136239d.6eae --> <!-- req 15:9a8870fa.4067 --> <!-- req 15:9a8870fa.9530 --> <!-- req 15:9a8870fa.fc5b --> <!-- req 15:9a8870fa.38cf --> <!-- req 15:9a8870fa.2e50 --> <!-- req 15:9a8870fa.df34 -->
- 本人の時間を守る決めごとは 2 つに集める。レビューは本人がせず、Claude Code へのセルフレビューの依頼に任せる（15.6 節）。テストは本人が手で書かず、Claude Code が実装の後に足す（15.5 節）。 <!-- req 15:479905a1.fa8e --> <!-- req 15:479905a1.150c -->
- 自動の工程を緩めないという是正の対象の外に置くのは、テストの後書き（TDD を採らない、15.5 節）と、小粒の作業で実施の順を崩してよいこと（15.4 節）の 2 つだけとする。どちらも本人の時間を守るための決めごとで、品質を緩めるものではない。テストの後書きは、L と XL のサイズでサブ機能の区切りごとに足して、まだ確かめていないコードが積み上がる期間を短くする。順を崩す場合も、セルフレビューと完了の基準（DoD）は省かない。 <!-- req 15:e5a776a2.0b2a --> <!-- req 15:53eee672.d1c0 --> <!-- req 15:53eee672.2ff4 --> <!-- req 15:53eee672.1300 --> <!-- req 15:78017ac2.3f66 --> <!-- req 15:78017ac2.255d --> <!-- req 15:78017ac2.5a4e -->
- 品質は、一人で作ることに関係なく最優先にし、目標値（KPI）を決めてそれに従って運用する。達成する水準はできるだけ具体的な数値にし、機械で判定できる形か、チェックリストで判定できる形にする。目標値の一覧は、テストの目標値と設計の目標値を横に並べた 1 つの表として基本設計 11 章 0 節に置き（本書 14.1 節）、テスト・性能・メモリの目標値と、設計分岐点の未決着の件数を含む。完了の基準（15.7 節）は、この一覧を参照する。 <!-- req 15:65292d2a.ae40 --> <!-- req 15:ad468447.8829 --> <!-- req 15:ad468447.a52a --> <!-- req 15:ad468447.e02a --> <!-- req 15:ad468447.154b --> <!-- req 15:ad468447.0b63 --> <!-- req 15:ad468447.4df2 --> <!-- req 15:85917870.5608 --> <!-- req 15:65292d2a~1.6834 --> <!-- req 15:ad3e9762.5952 --> <!-- req 15:ad3e9762.35ee --> <!-- req 15:ad3e9762.ffcb --> <!-- req 15:55ba9f70.c249 --> <!-- req 15:55ba9f70.3351 --> <!-- req 15:55ba9f70.1376 --> <!-- req 15:55ba9f70.94cf -->
- 判断の理由は、会話の中ではなく文書の中に置く。そのために次の 5 つの運用を、どれも省かない。サイズを理由にも、儀式になることを理由にも、当てる範囲を絞らない。 <!-- req 15:b3258a01.be6e --> <!-- req 15:10c902dc.de11 --> <!-- req 15:b972a967.6f9b --> <!-- req 15:b972a967.bc4b -->
  - 設計分岐点のカタログ（基本設計 13 章）：会話の中でその場で決めた設計の判断を残し、後から別のセッションが参照できる形にする <!-- req 15:21b393e9.7c98 --> <!-- req 15:21b393e9.131e -->
  - 詳細設計書（`docs/detailed_design/`）：構造の判断（クラスの構成・シグネチャ・状態の移り変わり）を残す（15.2 節） <!-- req 15:b7759fe8.0a44 --> <!-- req 15:b7759fe8.9f3b --> <!-- req 15:b7759fe8.19c9 -->
  - 横断リファレンス（[[00_reference.md]]）：複数の詳細設計書にまたがるインターフェースの契約を 1 か所に集める <!-- req 15:021ce35b.ac32 -->
  - セルフレビュー：実装のセッションと会話の履歴を共有しない別のセッションに頼み、PR の差分と関連する設計書を読ませ、会話の履歴は渡さない（15.6 節） <!-- req 15:3690eb55.6b7f --> <!-- req 15:3690eb55.aaa6 --> <!-- req 15:3690eb55.1cb9 --> <!-- req 15:3690eb55.63c9 -->
  - 品質の目標値の一覧：抽象的な意図を、達成できたかを後から誰でも判定できる形で残し、判定できる形の 1 つとして数値を持つ <!-- req 15:27ab326c.6e9c --> <!-- req 15:27ab326c.0680 -->

### 15.2 V 字モデルと詳細設計の工程

- 開発は V 字モデルに厳密に沿う。左の側（設計と分解）の工程ごとに、右の側（検証）のどのテストの段で確かめるかを、次の表で対応づける。テストの段の中身は 14.2 節。 <!-- req 15:df2e81d9.4908 --> <!-- req 15:92944ab4.c616 --> <!-- req 15:283c3bc4.eca6 --> <!-- req 15:283c3bc4.1ea6 --> <!-- req 15:283c3bc4.72a0 -->

| 左の側の工程 | 成果物 | 確かめる右の側のテストの段 | 本書の節 |
|---|---|---|---|
| 要件定義 | `docs/tab_app_requirements.md` | 運用テスト：実際の耳コピの運用が、要件定義書のユースケースを満たすか | 14.6 節 <!-- req 15:557ebc10.67d7 --> <!-- req 15:557ebc10.ec16 --> |
| 基本設計 | `docs/basic_design/` の 00 から 15 の文書 | システムテスト：アプリ全体のシナリオが、基本設計の画面と機能の仕様のとおりに動くか | 14.6 節 <!-- req 15:e0eec6ef.04b0 --> <!-- req 15:e0eec6ef.4f28 --> |
| 詳細設計 | 作業パッケージごとの詳細設計書 | 結合テスト：モジュールどうしの連携が、詳細設計の想定どおりに働くか | 14.5 節 <!-- req 15:b712fab5.c9b0 --> <!-- req 15:b712fab5.1a11 --> |
| 実装（コーディング） | ソースコード | 単体テスト：メソッドごとに C0（命令網羅）と C1（分岐網羅）を満たし、重要なロジックは C2 も満たすか | 14.3 節 <!-- req 15:70e451dd.d8f9 --> <!-- req 15:70e451dd.42d7 --> <!-- req 15:70e451dd.590b --> <!-- req 15:70e451dd.ac47 --> <!-- req 15:70e451dd.b853 --> |

- 基本設計と実装のあいだに、独立した工程として詳細設計を置く。クラスとインターフェースの構成・主要なメソッドのシグネチャ・状態の移り変わり・シーケンスは、実装のセッションの中で暗黙に決めず、詳細設計で決めて、作業パッケージごとの詳細設計書として明示して残す。 <!-- req 15:1ed2af22.04ca --> <!-- req 15:1ed2af22.094b --> <!-- req 15:4d74cf91.ce1d --> <!-- req 15:4d74cf91.902d --> <!-- req 15:4d74cf91.d3d5 --> <!-- req 15:4d74cf91.a693 --> <!-- req 15:4d74cf91.8986 --> <!-- req 15:4d74cf91.e757 --> <!-- req 15:4d74cf91.06dc -->
- 詳細設計書の決まりは次の表。詳細設計書の中で、受け持つクラスごとに何をどう書くかは 1 節の表。

| 項目 | 決まり |
|---|---|
| 単位 | 基本設計 15 章 4.1 節の作業パッケージ 1 つに、詳細設計書を 1 つ作る。XL のサイズの作業パッケージを 15.3 節に従ってサブ機能に分けたときは、サブ機能ごとに詳細設計書を分けてよい <!-- req 15:d3bff14a.814c --> <!-- req 15:d3bff14a.c6cb --> | <!-- req 00:36b4d93c.ff75 -->
| 置き場所 | プロジェクトの中に設けた `docs/detailed_design/` のフォルダに、`docs/detailed_design/<作業パッケージの英語のスラッグ>.md` として置く。スラッグは、ブランチの名前 `feature/<スラッグ>`（15.3 節）と同じにする <!-- req 15:f32612bc.692c --> <!-- req 15:f32612bc.75ab --> <!-- req 15:f32612bc.b593 --> | <!-- req 00:36b4d93c.b031 -->
| 中身 | 受け持つクラスとインターフェースの一覧とそれぞれの責務、主要なメソッドのシグネチャ（引数・戻り値・例外とエラーのときの動き）、該当するときは状態遷移図とシーケンス図。基本設計 13 章で未解決だった分岐点があれば、詳細設計で実装の水準の解き方を決める <!-- req 15:32a875bb.652f --> <!-- req 15:32a875bb.d328 --> <!-- req 15:32a875bb.9555 --> <!-- req 15:32a875bb.03ed --> <!-- req 15:32a875bb.0d2b --> <!-- req 15:32a875bb.37d5 --> <!-- req 15:32a875bb.48ad --> <!-- req 15:32a875bb.c670 --> <!-- req 15:32a875bb.db21 --> <!-- req 15:32a875bb.0daf --> |
| 作るとき | セッションの流れ（15.4 節）の手順 2 で、該当する基本設計書を読み合わせた直後、実装に着手する前に作る。Phase 1 に着手してから、作業パッケージごとに順に作る <!-- req 15:1eb874ae.3f6c --> <!-- req 15:1eb874ae.f309 --> <!-- req 15:1eb874ae.a629 --> <!-- req 12:73d28825.4e47 --> | <!-- req 00:36b4d93c.bc1a -->
| 基本設計との関係 | 基本設計書（`docs/basic_design/`）の記載を前提とし、矛盾する中身を含めない。基本設計の側を変える必要が出たら、基本設計 13 章 5 節の運用の決まりに従って基本設計を先に直してから、詳細設計に進む <!-- req 15:157d9b1d.63ef --> <!-- req 15:157d9b1d.d208 --> <!-- req 15:157d9b1d.6eae --> |
| 実装との関係 | 詳細設計書のシグネチャと構成と、実装が離れたら、実装を詳細設計に合わせるか、詳細設計書を直すかを、その都度選んで離れを解消する。離れたまま放置しない（15.9 節） <!-- req 15:c5c88ccb.1998 --> <!-- req 15:c5c88ccb.9f2c --> <!-- req 15:c5c88ccb.eaff --> <!-- req 15:c5c88ccb.9dbc --> |

### 15.3 道具・ブランチ・コミット

- リポジトリは、基本設計 01 章 AD-5 のモノレポ（`packages/core`・`packages/ui-shared`・`packages/ui-desktop`・`packages/shared-types`・`apps/desktop`・`apps/mobile`）を、そのまま 1 つの Git のリポジトリで持つ。`tools/` のフォルダは設けない（5.1 節）。 <!-- req 15:77374a5a.df2c --> <!-- req 15:77374a5a.e51e --> <!-- req 15:77374a5a.cab8 --> <!-- req 15:77374a5a.736f --> <!-- req 15:77374a5a.fa24 --> <!-- req 15:77374a5a.12d8 --> <!-- req 15:77374a5a.13b9 --> <!-- req 15:77374a5a.fbdc -->
- パッケージマネージャは pnpm とする。モノレポのワークスペースの管理が、pnpm の標準の機能で済むため。 <!-- req 15:1b6cdcec.4fa8 --> <!-- req 15:41a6770f.9438 -->
- TypeScript の strict のモードを有効にする（4 節）。`any` は原則として使わず、使ったところは ESLint で見つける。 ESLint の `@typescript-eslint/no-explicit-any` を `error` にして見つける（`eslint.config.js`）。テストのファイル（`*.test.ts` と `*.test.tsx`）だけは、テストの差し替えの部品を書くために `off` にする。 <!-- req 15:85c7094b.4142 --> <!-- req 15:85c7094b.9b05 --> <!-- req 15:85c7094b.bd93 -->
- ESLint（基本設計 01 章 2 節の層の依存の規則を機械で強制する設定を含む、2.2 節）・Prettier・`tsc --noEmit` の型チェックを入れる。Husky と lint-staged でコミットの前のフック（`.husky/pre-commit`）を置き、コミットするファイルに自動で走らせ、違反があればコミットそのものを止める。 <!-- req 15:0f253fdd.32fb --> <!-- req 15:0f253fdd.d02b --> <!-- req 15:0f253fdd.22cc --> <!-- req 15:c29c3130.50ec --> <!-- req 15:c29c3130.37d7 --> <!-- req 15:c29c3130.c004 --> <!-- req 15:c29c3130.89d6 --> <!-- req 15:c29c3130.c406 --> <!-- req 15:c29c3130.4a16 --> <!-- req 15:c29c3130.b83d --> <!-- req 15:c29c3130.5719 -->
- CI は GitHub Actions で動かし、PR を作るたびと更新するたびに、Lint・型チェック・書式の確かめ・単体テスト（基本設計 11 章 0 節の目標値を機械で確かめる）を自動で走らせる。ブランチの保護のルールで、そのステータスのチェックを必須にし、失敗している間は `main` へマージできないようにする（14.7 節）。ビルドしたものを配る自動化は CI の範囲に入れず、CI は品質のゲートとしての最小限に留める。 <!-- req 15:0f253fdd.4179 --> <!-- req 15:0f253fdd.f299 --> <!-- req 15:f946a69b.170d --> <!-- req 15:f946a69b.bd4e --> <!-- req 15:f946a69b.af41 --> <!-- req 15:f946a69b.dad1 --> <!-- req 15:f946a69b.74ed --> <!-- req 15:f946a69b.35c8 --> <!-- req 15:f946a69b.209f --> <!-- req 15:f946a69b.8e67 --> <!-- req 15:f946a69b.c280 --> <!-- req 15:f946a69b.982c -->
- Lint・書式・型チェックは、コミットの前のフックと CI の両方で強制する。強制はいつもかけ、緩めない。 <!-- req 15:4e972e59.5bf3 --> <!-- req 15:4e972e59.1ca3 --> <!-- req 15:271792e5.f3c2 --> <!-- req 15:271792e5.a5c4 --> <!-- req 15:271792e5.d710 --> <!-- req 15:271792e5.1fb8 --> <!-- req 15:271792e5.2b48 --> <!-- req 15:271792e5.df94 -->
- コミットのメッセージは、commitlint で下の規約を機械で強制する。(b) commitlint は、コミットのときに Git が呼ぶフックのうち、メッセージを受け取る `.husky/commit-msg` から動かす（基本設計 15 章が「pre-commit hook 経由」と書くもの）。メッセージを確かめられるのは、このフックだけのため。 <!-- req 15:2d11141c.ed24 --> <!-- req 15:2d11141c.06f7 --> <!-- req 15:fbb52d6a.9a85 --> <!-- req 15:6cad64a0.1c38 --> <!-- req 15:6cad64a0.8d83 --> <!-- req 15:6cad64a0.c4c4 -->
- Node.js の版は、`.nvmrc` でリポジトリに固定して明記し、Claude Code のセッションのあいだで環境の差が出ないようにする。(b) 固定の手段は `.nvmrc` の 1 つにする。手段を 2 つ持つと、どちらが正かを確かめる手間が増えるため。 <!-- req 15:cafe129a.656b --> <!-- req 15:cafe129a.4f24 --> <!-- req 15:9363271d.14dc --> <!-- req 15:9363271d.fbcf --> <!-- req 15:9363271d.d869 -->
- 費用は、できるだけ無料の枠の中に収め、必須の費用として認めるのは Apple Developer Program（年 99 ドル）だけとする。道具・CI（GitHub Actions の公開と無料の枠）・配布は、すべて無償で運用できる構成に限り、有償で運用する構成を採らない。有償のサービス・ライブラリ・ホスティングを前提にした設計は採らず、有償の解析の基盤と、有償のサーバーを常に置く必要がある自動アップデートの配信も前提にしない。自動アップデートの将来の問い合わせ先は、無償の GitHub の Releases にする（13.3 節）。Apple Developer Program の費用は、Phase 3 で必要になったときに払う。 <!-- req 15:e64ef4db.8e64 --> <!-- req 15:e64ef4db.da30 --> <!-- req 15:e64ef4db.7f45 --> <!-- req 15:e64ef4db.df5b --> <!-- req 15:e64ef4db.2248 --> <!-- req 15:e64ef4db.95ec --> <!-- req 15:e64ef4db.0ed6 --> <!-- req 15:e64ef4db.7f97 --> <!-- req 15:e64ef4db.da9d --> <!-- req 15:e64ef4db.a20e --> <!-- req 15:e64ef4db.0492 --> <!-- req 15:e64ef4db.290b --> <!-- req 15:e64ef4db.7987 --> <!-- req 15:e64ef4db.f02f -->
- 依存ライブラリの脆弱性は、定期のスキャンをせず、問題が分かったときにその都度、依存を更新して対応する。`pnpm audit` を常に走らせることと、Dependabot の自動のスキャンは、CI に組み込まない（常設のスキャンを CI に足さない）。問題が分かるきっかけは、アップデートのときの警告と、公開された情報とする。 <!-- req 15:35dbc40d.1c45 --> <!-- req 15:35dbc40d.118f --> <!-- req 15:35dbc40d.4325 --> <!-- req 15:35dbc40d.42fe --> <!-- req 15:35dbc40d.6b23 --> <!-- req 15:35dbc40d.d2cd --> <!-- req 15:35dbc40d.5cd3 -->
- ブランチは機能（作業パッケージ）ごとに切り、作業はブランチを切って行う。ブランチを切らずに `main` へ直接コミットしていく方式は採らない。 <!-- req 15:2797281c.3802 --> <!-- req 15:2797281c.68e9 --> <!-- req 15:97f419da.75e4 -->
- ブランチの名前は `feature/<作業パッケージの名前の英語のスラッグ>` とする。粒度は基本設計 9 章の作業パッケージを基本にし、XL のサイズの作業パッケージは、必要に応じてサブ機能ごと（例：`feature/editing-core-step-input`）にさらに分けてよい。同じスラッグを、詳細設計書のファイルの名前（15.2 節）にも使う。 <!-- req 15:f3d0f8f4.a642 --> <!-- req 15:f3d0f8f4.872e --> <!-- req 15:f3d0f8f4.1d3b --> <!-- req 15:f3d0f8f4.3ba2 -->
- `main` のブランチは、いつもビルドでき、アプリが起動できる状態に保つ。動かないコードを `main` にマージしない。 <!-- req 15:3749e58b.2045 --> <!-- req 15:3749e58b.d306 --> <!-- req 15:3749e58b.c76d -->
- マージは、GitHub で Pull Request を作り、CI のステータスのチェックが通ってから、Squash merge で `main` にまとめ、まとめた後に feature のブランチを消す。 <!-- req 15:39d4566c.66cd --> <!-- req 15:39d4566c.1f83 --> <!-- req 15:39d4566c.76d7 --> <!-- req 15:39d4566c.2923 -->
- 実験の変更（技術検証と Phase 0 のスパイク）は、`spike/` で始まる専用のブランチで扱ってよい。`spike/` のブランチは `main` にマージしない使い捨てのブランチとして扱ってよい。 括弧の中の 2 つは例で、別の実験の変更にも `spike/` のブランチを使ってよい。 <!-- req 15:12024384.2a86 --> <!-- req 15:12024384.183d --> <!-- req 15:12024384.7eb6 -->
- コミットのメッセージは Conventional Commits の形にし、接頭辞は `feat:`・`fix:`・`refactor:`・`test:`・`docs:`・`chore:` を使う。形は、上の commitlint で機械で強制する。 <!-- req 15:9b6377c6.48f6 --> <!-- req 15:9b6377c6.c094 --> <!-- req 15:9b6377c6.133c --> <!-- req 15:9b6377c6.e773 --> <!-- req 15:9b6377c6.2ee0 --> <!-- req 15:9b6377c6.0c6b --> <!-- req 15:9b6377c6.cbd3 --> <!-- req 15:9b6377c6.df45 --> <!-- req 15:9b6377c6.4078 --> <!-- req 15:9b6377c6.8e48 -->

### 15.4 作業パッケージの順とセッションの流れ

- 作業パッケージは 1 つずつ順に完了させてから、次へ進む。実施の順は依存の関係を踏まえて決め、基本設計 15 章 4.1 節の表に従う。Phase 1 の順は次の表。 <!-- req 15:9f374ec5.f0a8 --> <!-- req 15:320ad2fa.360f --> <!-- req 15:b1b72f61.735d -->

| 順 | 作業パッケージ | 依存する前提 | 中身 | 詳細設計書 |
|---|---|---|---|---|
| 1 | Webコア基盤構築 | なし（最初の土台） | alphaTab の統合・Electron の雛形・環境の構築を含む | 本書 <!-- req 15:b0eca881.503b --> <!-- req 15:b0eca881.1a02 --> <!-- req 15:b0eca881.6a90 --> |
| 2 | データモデル・永続化 | 1 | Song・Part・Bar の構造のデータと、自動保存と保存先の切り替えの基盤 | [[data-model-persistence.md]] <!-- req 15:dd5ad720.3f1d --> <!-- req 15:dd5ad720.f7a3 --> <!-- req 15:dd5ad720.ccbe --> <!-- req 15:dd5ad720.a586 --> |
| 3 | エラー・警告基盤とログ基盤 | 1・2 | `NotificationCenter` は、早めに骨組みだけを用意する（別の作業パッケージから横断的に呼ばれるため） | [[error-logging-foundation.md]] <!-- req 15:6b285c27.cece --> <!-- req 15:6b285c27.7ba4 --> <!-- req 15:6b285c27.7ee5 --> <!-- req 15:6b285c27.1781 --> |
| 4 | タブ譜編集コア | 2・3 | コマンド層（Undo と Redo）を含む。必要に応じてサブ機能ごとにブランチを分ける | [[editing-core.md]] <!-- req 15:a391dcab.8664 --> <!-- req 15:a391dcab.aa01 --> <!-- req 15:a391dcab.1eb8 --> <!-- req 15:a391dcab.ada6 --> |
| 5 | パート・チューニング管理 | 2・4 | 4 の直後に着手する | [[part-tuning-management.md]] <!-- req 15:fafcb48d.fb37 --> <!-- req 15:fafcb48d.adcd --> |
| 6 | 表示モード | 4 | フォーカス表示・全体表示・スコア表示の切り替え | [[view-modes.md]] <!-- req 15:1ce9af0f.a515 --> <!-- req 15:1ce9af0f.2fa0 --> <!-- req 15:1ce9af0f.4c75 --> <!-- req 15:1ce9af0f.3606 --> |
| 7 | 再生エンジン統合 | 2・4 | alphaTab と AlphaSynth との統合 | [[playback-integration.md]] <!-- req 15:2b9bcefd.b56c --> <!-- req 15:2b9bcefd.5960 --> <!-- req 15:2b9bcefd.6791 --> <!-- req 15:2b9bcefd.003f --> |
| 8 | 画面群・ナビゲーション | 4・5・6・7 | ミキサー・パート管理・チューニング設定・小節メモ一覧・設定・タグ管理・ライセンス・オンボーディングの各画面を、操作する先のサービスがそろってから配線する | [[screens-navigation.md]] <!-- req 15:cfe7a6ff.6b48 --> <!-- req 15:cfe7a6ff.b9e2 --> <!-- req 15:cfe7a6ff.edc6 --> <!-- req 15:cfe7a6ff.a02b --> <!-- req 15:cfe7a6ff.3154 --> <!-- req 15:cfe7a6ff.7764 --> <!-- req 15:cfe7a6ff.fee1 --> <!-- req 15:cfe7a6ff.cce8 --> <!-- req 15:cfe7a6ff.8f0e --> <!-- req 15:cfe7a6ff.706b --> <!-- req 15:cfe7a6ff.c656 --> |
| 9 | Phase 1 完成・製品化 | 1 から 8 のすべて | 横断のパッケージ（XL のサイズ相当） | [[phase1-productization.md]] |

- 上の表の「順」は、依存の関係による実施の順を表す。 <!-- req 15:a9af39d2.27e7 -->
- 自動テストの基盤は、単発の作業パッケージとして実施せず、15.5 節の時機で各作業パッケージに結びつけて続けて行う（完了の基準 3）。 <!-- req 15:d73d664f.76c7 --> <!-- req 15:d73d664f.65e9 -->
- 開発用サンプルデータは、2 の直後から 4 の着手の前後までに用意し、置き場所は `packages/core/src/testing/editingFixtures.ts`（14.9 節）とする。負荷テストの大曲のフィクスチャは、Phase 1 完成・製品化の F（E2E と負荷）に着手する前に整える。 <!-- req 15:c8d9448f.edef --> <!-- req 15:c8d9448f.09f7 --> <!-- req 15:c8d9448f.0c3e -->
- Phase 2 の実施の順も、依存の関係の順で決める。1 は書き出し（alphaTex・MIDI・PDF）で、Phase 1 の完了の一式（特に 2 データモデル・永続化、4 タブ譜編集コア、5 パート・チューニング管理）に依存し、`PrintPipelineService` の PDF の生成を含めて、変換の処理の一式を 1 で先に確かにする。2 は印刷プレビューで、1 に依存し、1 で確かにした PDF の生成の流れ（`PrintPipelineService`）をそのまま使って、印刷ダイアログを作る。1 と 2 の詳細設計書は、基本設計 9 章の作業パッケージの単位と別に [[export-print.md]] の 1 つにまとめ、実施の順は 1 から 2 への直列とする。 <!-- req 15:c1ba9477.fde2 --> <!-- req 15:6457e445.3d07 --> <!-- req 15:6457e445.5445 --> <!-- req 15:6457e445.a67b --> <!-- req 15:6457e445.4317 --> <!-- req 15:6457e445.3dc9 --> <!-- req 15:6457e445.473d --> <!-- req 15:6457e445.16b0 --> <!-- req 15:6457e445.8a4d --> <!-- req 15:685790f5.f0bf --> <!-- req 15:685790f5.e35f --> <!-- req 15:685790f5.3c05 --> <!-- req 15:0acea4e7.ffb5 --> <!-- req 15:0acea4e7.d7ff -->
- Phase 3 から後（iPhone 版）の実施の順は、Phase 2 の完了の後に、Phase 2 と同じ考え方で決める。iPhone 版に着手する条件は、PC 版を完成させることと、製品として実用に耐えると本人が判断したときに達することで、具体的な時期は決めない（13.5 節）。 <!-- req 15:fbe2dccb.c57e --> <!-- req 15:fbe2dccb.98fb --> <!-- req 15:119b55fc.468e --> <!-- req 15:119b55fc.e6fa --> <!-- req 15:1530c02e.8f0e -->
- 1 回のセッションは、1 つの作業パッケージ（または 15.3 節で分けたサブ機能）を主題にし、次の 6 つの手順の流れを基本とする。 <!-- req 15:b8d3549e.180e --> <!-- req 15:b8d3549e.c250 -->
  1. 該当する基本設計書の該当する章を読み合わせる。実装の方針に不明な点があれば、基本設計 13 章に準じて、その場で解消する <!-- req 15:d8d2d167.6e4c --> <!-- req 15:d8d2d167.9b69 -->
  2. 詳細設計書を作る（15.2 節）。クラスとインターフェースの構成・主要なメソッドのシグネチャ・状態の移り変わり・シーケンスをここで決め、`docs/detailed_design/<スラッグ>.md` として残す <!-- req 15:8b55ef5d.dc09 --> <!-- req 15:8b55ef5d.965a --> <!-- req 15:8b55ef5d.6b19 --> <!-- req 15:8b55ef5d.5692 --> <!-- req 15:8b55ef5d.cfe1 --> <!-- req 15:8b55ef5d.ed72 -->
  3. 詳細設計書に書いた構成とシグネチャに従って実装する。離れが出たら、15.2 節の表の「実装との関係」に従う <!-- req 15:5d3aadad.5fd5 --> <!-- req 15:5d3aadad.71af -->
  4. 15.5 節の時機で自動テストを足す <!-- req 15:45f0c191.e7b1 -->
  5. 15.6 節に従ってセルフレビューを頼む。サイズを問わず、全部の作業パッケージが対象 <!-- req 15:d7db756f.3bfb --> <!-- req 15:d7db756f.032e -->
  6. 完了の基準（15.7 節）を満たしたら PR を作り、CI が通ったことを確かめてからマージし、次の作業パッケージへ進む <!-- req 15:49511413.d02b --> <!-- req 15:49511413.468a --> <!-- req 15:49511413.57ef -->
- 手順の並びの意図：詳細設計を実装の前に置く（15.2 節の表の「作るとき」）。テスト（手順 4）を実装（手順 3）の後に置く（テストの後書き）。セルフレビュー（手順 5）をテストの後、PR（手順 6）の前に置き、サイズを問わず全部の作業パッケージでする。 <!-- req 15:fc09cd04.3a14 --> <!-- req 15:f20de9f3.2dbf --> <!-- req 15:2311edf4.bf1c --> <!-- req 15:2311edf4.31f6 -->
- 依存の関係が薄い小粒の作業（例：バグの修正、ドキュメントの更新）は、基本設計 15 章 4.1 節の実施の順を待たずに、順を崩してでもその都度対応してよい。崩してよいのは実施の順の融通だけで、別の決まりには及ばない。順を崩す場合も、セルフレビューと完了の基準は省かない。既存の詳細設計書に影響する変更なら、そのファイルを直す。 <!-- req 15:434e014a.1548 --> <!-- req 15:40d1df8c.c979 --> <!-- req 15:40d1df8c.e3b3 --> <!-- req 15:40d1df8c.79e5 --> <!-- req 15:5781a8a3.cd3b --> <!-- req 15:f7865a58.90e0 --> <!-- req 15:f7865a58.db60 --> <!-- req 15:f7865a58.9071 -->

### 15.5 テストを書く時機

- 自動テストは、主要なロジックを実装した後にまとめて書く運用とし、TDD（実装の前にテストを書く運用）は採らない。 <!-- req 15:8711637b.1e59 --> <!-- req 15:5442131b.58c4 --> <!-- req 15:5442131b.138c --> <!-- req 15:132368bf.772f --> <!-- req 15:132368bf.212b -->
- 各作業パッケージの実装が一区切りついたときに、基本設計 11 章 3 節の対象の一覧（本書 14.3 節の表）のうち、該当する項目のテストをまとめて足す（例：タブ譜編集コアを終えたらコマンド層とバリデーションのサービスのテスト、データモデル・永続化を終えたら移行のテスト）。実装した全メソッドが 14.3 節のカバレッジの基準（C0 と C1 は全メソッドで 100%、重要なロジックは C2 まで。基本設計 11 章 0 節の目標値の一覧にも集めてある）を満たすことを、単体テストの完了の条件とする。 <!-- req 15:c18ddf92.30ae --> <!-- req 15:c18ddf92.a961 --> <!-- req 15:c18ddf92.29c8 --> <!-- req 15:c18ddf92.9be1 --> <!-- req 15:c18ddf92.b4d3 --> <!-- req 15:c18ddf92.b198 --> <!-- req 15:c18ddf92.9bfa --> <!-- req 15:c18ddf92.cff5 -->
- L と XL のサイズの作業パッケージは、パッケージ全体の完了を待たず、15.3 節でブランチを分けるサブ機能が完了するたびにテストを足し、まだ確かめていない期間を短く保つ。量の多いロジックが長い期間確かめないまま積み上がるのを避けるため、テストを書く区切りを大きくしすぎない。 <!-- req 15:8711637b.9033 --> <!-- req 15:f67d7a78.c965 --> <!-- req 15:f67d7a78.c58c --> <!-- req 15:f67d7a78.de93 --> <!-- req 15:3f9ca4f2.1dbb --> <!-- req 15:3f9ca4f2.20a7 --> <!-- req 15:3f9ca4f2.54f1 -->
- テストを書く区切りを作業パッケージの完了の時点にまとめていた旧い決まりは、撤回したまま戻さない。テストを足すのは Claude Code の工程で、本人の時間を守るための配慮をしない。
- 単体テストがそろったら、該当する範囲の結合テスト（14.5 節）をする。作業パッケージの中で閉じる結合はこの時点でし、複数の作業パッケージにまたがる結合は、両方が完了した時点でする。結合テストは、その作業パッケージの詳細設計書の想定どおりに連携できているかの確かめでもある。 <!-- req 15:dbc56754.0f9a --> <!-- req 15:dbc56754.9ccc --> <!-- req 15:dbc56754.ee3f --> <!-- req 15:dbc56754.1214 -->
- 「自動テスト基盤」という単独の作業パッケージを設けず、自動テストを各作業パッケージの完了の基準（15.7 節）に組み込む。テストを独立の工程に切り出すと、後回しにされて最後に積み残るため。規模を理由にした緩めではなく、テストを確実にするための組み込みとする。 <!-- req 15:0b3ad32a.31e5 --> <!-- req 15:0b3ad32a.4520 --> <!-- req 15:7f5b1a67.cbed --> <!-- req 15:7f5b1a67.7473 -->
- システムテスト・運用テスト（14.6 節）と負荷テスト（14.8 節）は、Phase 1 の後半、主要な機能が一通りそろったときに、まとめてする。 <!-- req 15:7545b528.4985 --> <!-- req 15:7545b528.ef4e --> <!-- req 15:7545b528.82b0 --> <!-- req 15:7545b528.3310 -->

### 15.6 セルフレビュー

- 作業パッケージを完了するときに、Claude Code にセルフレビューを頼む。対象は基本設計 15 章 4.1 節と 4.1.1 節の全部の作業パッケージで、サイズで絞らない。セルフレビューは Claude Code がする工程で、本人の時間を使わない。 <!-- req 15:755f58df.797d --> <!-- req 15:755f58df.90e4 --> <!-- req 15:755f58df.e43b --> <!-- req 15:7d6c8997.e792 --> <!-- req 15:05d48242.c603 --> <!-- req 15:05d48242.d44e --> <!-- req 15:05d48242.284c --> <!-- req 15:05d48242.783e --> <!-- req 15:73b95479.e144 --> <!-- req 15:73b95479.ecd2 --> <!-- req 15:73b95479.b033 --> <!-- req 15:73b95479.8b7d --> <!-- req 15:73b95479.0633 --> <!-- req 15:73b95479.edcd -->
- 頼み方：実装のセッションと別の、レビュー専用のセッションか、サブエージェントに頼む。実装との会話の履歴は渡さず、PR の差分と関連する設計書だけを渡して、実装の経緯を知らない読み手としてふるまわせる。同じセッションの中でレビューを頼まない（実装のときに見落とした前提を、レビューでも引きずるため）。人のチームの第三者のレビューが持つ独立を、こうして得る。 <!-- req 15:8488ab6f.b8b1 --> <!-- req 15:8488ab6f.4a5a --> <!-- req 15:8488ab6f.c348 --> <!-- req 15:8488ab6f.e170 --> <!-- req 15:8488ab6f.0b8b --> <!-- req 15:8488ab6f.f63d --> <!-- req 15:fab8f554.a905 --> <!-- req 15:fab8f554.8516 --> <!-- req 15:fab8f554.378e -->
- 観点は、基本設計 13 章・各設計書の該当する章・基本設計 11 章 0 節の目標値の一覧と、突き合わせて確かめる。 <!-- req 15:9cbe1198.4b1a --> <!-- req 15:9cbe1198.315c --> <!-- req 15:9cbe1198.21fc --> <!-- req 15:9cbe1198.8295 -->
  - 要件と基本設計との食い違い（例：バリデーションのしきい値が基本設計 04 章 6.1 節と合っているか） <!-- req 15:0ddba861.112c --> <!-- req 15:0ddba861.d734 --> <!-- req 15:0ddba861.80a5 -->
  - 詳細設計書と実装の食い違い（クラスの構成とメソッドのシグネチャが離れていないか） <!-- req 15:262be666.6f3a --> <!-- req 15:262be666.bac5 --> <!-- req 15:262be666.ac9c -->
  - Undo と Redo の非対称と、データを失うことにつながるエッジケース <!-- req 15:31039278.5310 --> <!-- req 15:31039278.1a91 --> <!-- req 15:31039278.5e12 -->
  - 基本設計 01 章 2 節の層の依存の規則の違反（Webコアからプラットフォームに固有の API を直接参照していないか） <!-- req 15:07cf3ceb.fab7 --> <!-- req 15:07cf3ceb.db31 -->
  - セキュリティと堅牢さ（基本設計 06 章のアトミックな書き込みが守られているか、基本設計 08 章のエラーの扱いに漏れが無いか） <!-- req 15:308e59e5.1416 --> <!-- req 15:308e59e5.bfbc --> <!-- req 15:308e59e5.0dfd --> <!-- req 15:308e59e5.08ea -->
  - カバレッジの基準（全メソッドの C0 と C1、対象ロジックの C2、14.3 節）を満たしているか <!-- req 15:98d89aa3.a32e --> <!-- req 15:98d89aa3.54f6 --> <!-- req 15:98d89aa3.e1a0 --> <!-- req 15:98d89aa3.fe41 -->
- 見つかった指摘は、軽いものはその場で直し、設計の方針に関わるものは基本設計 13 章に新しい分岐点として書いてから対応する（13 章 5 節の運用の決まり）。 <!-- req 15:ddc52525.8045 --> <!-- req 15:ddc52525.1db7 --> <!-- req 15:ddc52525.4374 -->
- S と M のサイズの作業パッケージ（パート・チューニング管理を含む）も、バリデーションのしきい値の取り違えと、層の依存の規則の違反を確かめる。規模を理由に確かめを省かない。対象を広げた分の負担は、Claude Code のセッションの数が増えることとして扱い、本人の隙間の時間を使わない。 <!-- req 15:c4b554f5.59d8 --> <!-- req 15:c4b554f5.fac2 --> <!-- req 15:c4b554f5.0c19 -->
- 本人のレビューは、基本設計・詳細設計・基本設計 15 章のような設計の文書の側に絞り、実装の全部の差分を本人がその都度レビューする運用は採らない。Claude Code のセルフレビューを一次の防波堤とし、この役割の分担を前提にする。この分担が、本人に負ってもらう唯一の続けての作業で、基本設計 15 章は、読めば思想まで追える文書であろうとする。Claude Code の側が担う工程（セルフレビューを含む）を、一人で作ることを理由に削らない。 <!-- req 15:c51b062d.d507 --> <!-- req 15:c51b062d.6f0c --> <!-- req 15:c51b062d.7e24 --> <!-- req 15:c51b062d.c177 --> <!-- req 15:c51b062d.c7f9 -->

### 15.7 完了の基準（Definition of Done）

- 作業パッケージを完了と判定する基準を、次の 6 つにそろえる。数値の基準は基本設計 11 章 0 節の目標値の一覧（本書 14.1 節）に集めてあり、基準ごとの合否に迷ったら、その一覧を参照する。 <!-- req 15:1c92bf5b.a22c --> <!-- req 15:42b82c00.c7ec --> <!-- req 12:94582639.3e81 -->

| # | 基準 | 確かめる場所 |
|---|---|---|
| 1 | 該当する基本設計書の記載を満たしている。満たせないときは、設計書の側を直すか、基本設計 13 章に新しい分岐点として書く | セルフレビュー（15.6 節） <!-- req 15:be9beb64.ba65 --> <!-- req 15:be9beb64.f754 --> |
| 2 | 詳細設計書（`docs/detailed_design/<スラッグ>.md`、15.2 節）を作ってあり、実装と食い違っていない | セルフレビュー <!-- req 15:ab97152f.314e --> <!-- req 15:ab97152f.059f --> |
| 3 | 15.5 節の時機で、該当する単体テストを足し、目標値の一覧のカバレッジの基準（全メソッドの C0 と C1、対象ロジックの C2）を満たして通っている。該当する範囲の結合テスト（14.5 節）もしてある | CI（14.7 節） <!-- req 15:ff216087.29e3 --> <!-- req 15:ff216087.88ed --> <!-- req 15:ff216087.305d --> <!-- req 15:ff216087.a040 --> <!-- req 15:ff216087.512e --> <!-- req 15:ff216087.d7e7 --> |
| 4 | 15.6 節のセルフレビューをして、指摘に対応してある。この基準は全部の作業パッケージに当てる | 14.1 節の表の「セルフレビューの実施率」 <!-- req 15:e323ac1f.c53a --> <!-- req 15:53b358c5.5a0c --> <!-- req 15:53b358c5.56c0 --> <!-- req 15:53b358c5.1e00 --> |
| 5 | Claude Code が、手でシナリオを確かめた（14.6 節のシステムテストの観点）。少なくとも 1 つのシナリオ | セッションの記録 <!-- req 15:dd8badd0.470b --> <!-- req 15:dd8badd0.85d0 --> |
| 6 | CI が通り、`main` のブランチにマージしてあり、アプリが起動して動く状態を保っている | CI とブランチの保護（14.7 節） <!-- req 15:599fce34.ec13 --> <!-- req 15:599fce34.80e3 --> <!-- req 15:599fce34.9c9d --> <!-- req 15:599fce34.58fc --> |

- 6 つの基準は、15.1 節から 15.6 節で決めた工程（基本設計との整合・詳細設計書を作ること・テスト・セルフレビュー・手でシナリオを確かめること・CI の通過と `main` への統合）を、そのまま完了の定義として並べ直したもので、独立の基準を新しく考え出さない。工程を実際に全部したかを確かめるチェックリストとして使う。
- 基準 5（手でシナリオを確かめること）だけは、別の節から直接は出ず、完了の基準で新しく足したもの。自動テスト（基準 3）はメソッドとモジュールの単位の正しさを保証するが、実際の操作の流れとして違和感なく動くか（システムテストの観点）は、自動テストだけでは覆えない。そのため、少なくとも 1 つのシナリオを手で確かめることを、明文の基準として足す。 <!-- req 15:b20cf255.4ffb -->
- 完了の基準は「何をしたか」のチェックリストで、「どこまでやれば十分か」という水準は、目標値の一覧が決める。両者を分けるのは、完了の基準が作業パッケージを完了するときの一度きりの確かめで、目標値の一覧はプロジェクト全体を通して保つ水準であり、更新の頻度と見直しの単位が違うため。

### 15.8 版の刻み方とリリース

- 版は、プラットフォーム（アプリ）ごとに独立させる。`apps/desktop`（PC 版）と `apps/mobile`（iPhone 版）は、それぞれの `package.json` で版を持ち、セマンティックバージョニング（x.y.z）で刻む。PC 版と iPhone 版を 1 つの版の番号に縛らず、PC 版と iPhone 版を通した 1 つの製品の版を前提にした決まりを置かない。 <!-- req 15:43a81a7a.c74e --> <!-- req 15:fba030e8.2cb2 --> <!-- req 15:c37c2ab9.c1f8 --> <!-- req 15:c37c2ab9.d1ab --> <!-- req 15:c37c2ab9.b694 -->
- PC 版は、iPhone 版のための使い捨ての踏み台ではなく、作った後も実際に使い続ける製品とする。PC 版が v1.0.0 に届くかは、iPhone 版（Phase 3）に着手する時期に左右されず、iPhone 版に着手しない場合でも、PC 版は自分の出来に応じて独立して v1.0.0 に届く。 <!-- req 15:fba030e8.8168 --> <!-- req 15:fba030e8.f05d --> <!-- req 15:fba030e8.724f -->
- PC 版（`apps/desktop`）：Phase 1（8 つの作業パッケージ）を完了した時点は v0.x とし、本人が実際の耳コピの作業で使い始める実運用に入った時点で v1.0.0 にする。この判定と時機は、iPhone 版の着手の状況と独立に決める。 <!-- req 15:11dd18ff.4c17 --> <!-- req 15:11dd18ff.ceed --> <!-- req 15:11dd18ff.ae3e -->
- iPhone 版（`apps/mobile`）：Phase 3 で着手し、TestFlight で配る段階は v0.x、App Store で配る正式の運用に入った時点で v1.0.0 にする。PC 版のその時の版とは独立した、iPhone 版自身の版の系列として持つ。PC 版が v1.4.0 のときに iPhone 版が初めて v1.0.0 になるのは、正常な状態とする。 <!-- req 15:c0d8dab6.a675 --> <!-- req 15:c0d8dab6.ac38 --> <!-- req 15:c0d8dab6.5206 --> <!-- req 15:c0d8dab6.3baa --> <!-- req 15:c0d8dab6.63b2 -->
- 作業パッケージごとのマージでは、パッチとマイナーの版を機械的に上げず、各アプリの Phase の節目で版を切る。詳しいリリースノートの運用は設けない。 <!-- req 15:e53e7573.1a76 --> <!-- req 15:e53e7573.6006 --> <!-- req 15:e53e7573.3bf7 --> <!-- req 15:e53e7573.5ebe -->
- `packages/core`（Webコア）は、両方のアプリから参照され、今はモノレポの中の 1 つのワークスペースとして扱い、独立した公開の API の版（破壊的な変更の管理）は入れない。`packages/core` を別のリポジトリへ切り出す事情か、3 つ目のプラットフォームが加わる事情が出たときに、改めて考える。`packages/ui-desktop`（PC 版の入れ物で、配置と開け閉めを担う）は `apps/desktop` だけが参照し、`packages/ui-shared`（中身の部品）は両方のアプリが参照する。この 2 つもモノレポの中のワークスペースとして扱い、独自の版を刻まない。 <!-- req 15:ca2951bf.ef02 --> <!-- req 15:ca2951bf.abe2 --> <!-- req 15:ca2951bf.aafd --> <!-- req 15:ca2951bf.94e7 --> <!-- req 15:ca2951bf.1b6e --> <!-- req 15:ca2951bf.b108 --> <!-- req 15:ca2951bf.efab --> <!-- req 15:ca2951bf.1ea0 -->
- ビルドと配布は、Electron Builder で Windows 向けにまとめる（8 節）。コードの署名を入れない今の方針（基本設計 10 章 9 節）を引き継ぎ、その都度手元でビルドして使う。配布の自動化（CI を通してビルドしたものを公開すること）は範囲の外とし、必要になったときに改めて設計する。 <!-- req 15:3c4a5cca.70f6 --> <!-- req 15:3c4a5cca.49fa --> <!-- req 15:3c4a5cca.7246 -->

### 15.9 設計書との同期と、運用の見直し

- 実装の中で基本設計の記載と違う判断が必要になったら、基本設計 13 章 5 節の運用の決まりに従い、まず 13 章に分岐点として書いてから、該当する設計書を直す。基本設計書を、実装の後に古いまま放置しない。 <!-- req 15:202e11ae.abff --> <!-- req 15:202e11ae.0a6d --> <!-- req 15:202e11ae.4191 --> <!-- req 15:202e11ae.2b31 -->
- 詳細設計書（`docs/detailed_design/`）も基本設計書と同じ運用の対象とし、実装の中で判断を変えたらその都度直し、実装の完了の後に古いまま放置しない（完了の基準 2）。 <!-- req 15:ce63d5e7.68f4 --> <!-- req 15:ce63d5e7.0a15 --> <!-- req 15:ce63d5e7.e4b8 -->
- 基本設計 12 章の完了の基準のチェックリストは、Phase 1 の完了のときに、実装の結果を踏まえて確かめ直し、必要なら直す。 <!-- req 15:79a08b50.7ffa --> <!-- req 15:79a08b50.cd71 --> <!-- req 15:79a08b50.c6ca -->
- 13 章 5 節の運用の決まりを本節からも参照するのは、判断の理由を文書に置く原則（15.1 節）を、実装の段に入った後も保つため。実装の中で生じた設計の変更を、コードだけ直して終わりにしない。基本設計書と実装が離れる状態と、詳細設計書と実装が離れる状態を防ぎ、次にその機能を触るセッション（自分自身も含む）が古い設計書を信じるおそれを防ぐ。Phase を完了した後に、別の章への申し送りを古いままにしない。設計書と実装の同期の運用の決まりは、本節に置く。
- 基本設計 13 章のカテゴリ B（工学判断で決めたもの）とカテゴリ C（ヒアリングで決めたもの）の分岐点は、決めた方式を、13 章の各行の反映先の設計書に書いてある状態を保つ（基本設計 12 章 5 節の完了の基準）。 <!-- req 12:18c0b84c.dd8d -->
- 設計分岐点のカタログの運用（基本設計 13 章 5 節、2026-10-16 本人決定、honnin-queue 138 番）：実装の中で新しい分岐点に気づいたら、まず基本設計 13 章に書いて、カテゴリ A から C のどれかに分ける。カテゴリ A は、検証の結果が出たら「解決済み」にして、決まった方式を該当する設計書に書く。カテゴリ A が 0 件になったら、基本設計 12 章の完了の基準を「検証待ち事項なし」と言える。Phase 0 と Phase 1 の技術検証は、基本設計の段の完了の条件に入れない。
- 基本設計 15 章の見出しの番号（1.1・4.1・4.1.1・4.2 を含む）は、別の文書から番号で参照されているので変えない。基本設計 15 章は、各節の末尾に、決めた方針の理由とトレードオフを書く形を保つ。 <!-- req 15:50d94d51.4d47 --> <!-- req 15:490851bb.61cb --> <!-- req 15:490851bb.5a1d --> <!-- req 15:490851bb.caef -->
- 基本設計 15 章は、本人にヒアリングで決めた方針と、実務の判断で決めた方針（レビューで特に見てほしいもの）を区別して書き、実務の判断で決めた方針は、各節の末尾の「設計思想」の小節に理由とトレードオフを書く。決まったことと提案していることの境目は、各節の末尾の説明で示す。 <!-- req 15:79e5b252.20d9 --> <!-- req 15:cb149d7d.6f21 --> <!-- req 15:a4df9107.0dcb -->
- 実務の判断で決めた事項に異論があれば、本人がその都度指摘し、基本設計 13 章と同じ要領で分岐点として扱って直す。 <!-- req 15:e4dcd0ce.1a31 --> <!-- req 15:0386fede.242c --> <!-- req 15:0386fede.c063 -->
- 本節の運用（ブランチの粒度・レビューの対象の範囲・テストの時機）は固定の決まりではなく、実装を進める中で不都合が出れば見直してよい。見直したら基本設計 15 章を直し、変えた理由を残す。 <!-- req 15:bdaaab3c.71ef --> <!-- req 15:bdaaab3c.16cc -->
- V 字モデル（15.2 節）と詳細設計の工程（15.2 節）の運用も、過不足があれば調整する。第 1 回（Webコア基盤構築）を実際に回して、過不足を確かめて調整する。 <!-- req 15:af024c0a.a694 -->
- 「厳密さを誰の時間で測るか」の原則（15.1 節）も、見直しの対象に含める。ある工程が想定と違って Claude Code だけでは終わらず、本人の時間を使っていると分かったら、それを見直しのきっかけにし、その都度 15.1 節の区別に立ち返って、該当する節を直す。一方で、「一人で作るから」「隙間の時間で作るから」という理由だけで自動にした工程を緩めることは、今後もしない。 <!-- req 15:71deac82.09ff --> <!-- req 15:71deac82.be72 --> <!-- req 15:71deac82.7d83 --> <!-- req 15:71deac82.af93 --> <!-- req 15:71deac82.300c --> <!-- req 15:71deac82.c1f9 -->
- 目標値の一覧（基本設計 11 章 0 節）も固定ではなく、新しい品質の観点が決まるたびに足す。足すのは目標値の追加で、既存の目標値を一人で作ることを理由に下げる方向には使わない。 <!-- req 15:493fe9fe.4d2a --> <!-- req 15:493fe9fe.0661 --> <!-- req 15:493fe9fe.d193 -->
