# 詳細設計書：データモデル・永続化

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 2「データモデル・永続化」
- **ブランチ名**：`feature/data-model-persistence`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

1 節（スコープ）は基本設計 02 章・06 章の回に書く。

## 2. Score モデルとサイドカーメタデータ

[[../basic_design/01_architecture.md#3]] AD-1 を受ける。

- 1 曲は `SongDocument`（`packages/core/src/domain`）で表す。中身の中核は alphaTab の `Score`（`alphaTab.model.Score`）をそのまま持つ `score` で、アプリ独自の曲のモデルを別に作らない。書き出しと再生は、この `score` をそのまま alphaTab に渡す。 <!-- req 01:5542e325.c7c1 -->
- サイドカーに入れるのは、alphaTab の `Score` が持たない情報か、アプリ固有の情報だけとする。新しい情報を足すときは、先に `Score` に同じ意味の項目が無いかを確かめ、あれば `Score` のほうを使う。 <!-- req 01:9f185d99.6b28 -->
- `Score` とその下のオブジェクト（`Track`・`Staff`・`Bar`・`Voice`・`Beat`・`Note`）には、アプリ独自のプロパティを足さない。 <!-- req 01:9f185d99.8f9c -->
- サイドカーは `Score` の外に持つ。曲のファイルに入れるものは `SongDocument.appMeta`（型 `AppMetadata`）に、曲のファイルに入れないものはアプリの側のファイルに持つ。曲のファイル（`.tabapp`）では、`Score` を `song` に、サイドカーを `appMeta` に分けて置き、同じ JSON の中で混ぜない。`song` は alphaTab の `JsonConverter.scoreToJson(score)` の結果を `JSON.parse` して入れ、読むときは `JsonConverter.jsonToScore(JSON.stringify(song))` で戻す（alphaTab 1.8.4 の型定義にある 2 つ）。`appMeta` はアプリの型 `AppMetadata` で読み書きする。(b) alphaTab の変換を使うのは、`Score` の形が版上げで変わっても、変換は alphaTab の側で追いつくため。 <!-- req 01:9f185d99.af65 -->

**サイドカーの一覧は本節に並べない**：何をどこに置くかの一覧は、基本設計の 1 か所が正で、詳細設計でもその受け先の節 1 か所にだけ書く。本節は一覧の置き場所を決めるだけにする。

| 置き場所 | 一覧の正（基本設計） | 詳細設計で書く所 |
|---|---|---|
| 曲のファイルに入れるもの | [[../basic_design/02_data_model.md#4.1]] の `appMeta` の一覧 | 本書のうち基本設計 02 章 4.1 節を受ける節（02 章の回に書く）。`AppMetadata` の項目は `appMeta` の一覧と 1 対 1 にする |
| アプリの側に置くもの（曲のファイルに入れないもの） | [[../basic_design/06_file_io_persistence.md#3]] のファイル構成（2 つの木） | 本書のうち基本設計 06 章 3 節を受ける節（06 章の回に書く） <!-- req 01:f8b143e1.d823 --> |

サイドカーの情報を足すときは、まず上の表の基本設計の一覧に足し、次に詳細設計の受け先の節に足す。本節は直さない。

```ts
// packages/core/src/domain/SongDocument.ts
export class SongDocument {
  readonly id: string;
  readonly score: alphaTab.model.Score;   // 中核。アプリ独自のプロパティを足さない
  readonly appMeta: AppMetadata;          // サイドカーのうち曲のファイルに入れるもの
  readonly schemaVersion: string;
  readonly createdAt: string;
  toFileJson(savedAtMonotonic?: number): SongFileJson;   // 省くと今の時刻
  static fromFileJson(json: SongFileJson): SongDocument;
}
```

`AppMetadata` の項目と `SongFileJson` の形は、基本設計 02 章の回に本書で書く。

曲のファイルの形（スキーマ）を変えるときは、[[../basic_design/02_data_model.md#4.2]] のスキーマのバージョンと移行の方針に従う。`schemaVersion` の上げ方と移行の仕組みは、基本設計 02 章の回に本書で書く。 <!-- req 09:630b9903.2c1e -->

## 3. 保存の形と alphaTex

[[../basic_design/02_data_model.md#1]] を受ける。

- 実行しているときの曲のモデルは、alphaTab の `Score` 系（`Score`・`Track`・`Staff`・`Bar`・`Voice`・`Beat`・`Note`）を土台にする。持ち方は 2 節のとおり。 <!-- req 02:fd63facf.ae1f -->
- 曲のファイルは、保存のたびに alphaTex へ変換する形にはしない。 <!-- req 02:0290894c.0e48 -->
- 曲のファイルの形は、本アプリが自分で決める（alphaTex の形に頼らない）。 <!-- req 02:0290894c.5478 -->
- 曲のファイルは、版を管理する構造化 JSON で、保存するたびにその時点の曲の全体を書き出す（スナップショット）。形は 2 節の `SongFileJson`。 <!-- req 02:0290894c.deb1 --> <!-- req 02:61f6b909.f924 -->
- 曲のファイルは、自前の形の版として `schemaVersion` を持つ。版の上げ方と移行は、基本設計 02 章 4.2 節を受ける節（02 章の回に本書で書く）に書く。 <!-- req 02:412b7e3b.fcd2 -->
- alphaTex は、書き出しの成果物の 1 つとして扱う。 <!-- req 02:61f6b909.1cb7 -->
- alphaTex への変換は、保存のたびではなく、書き出しの操作をしたときだけ行う 1 つの機能とする。 <!-- req 02:759a6505.332a --> 変換には alphaTab の `AlphaTexExporter` を使う（alphaTab 1.8.4 の型定義にある `exportToString(score, settings)`）。 <!-- req 02:759a6505.fce3 -->
- 変換のもとは、書き出しの操作をした編集ウィンドウがメモリ上に持つ `SongDocument` の `score` とする。 <!-- req 02:759a6505.9a4d --> 保存済みの曲のファイルは読み直さない（[[../basic_design/13_design_decision_points.md#3]] B23。自動保存は遅れて書かれるので、ファイルは直近の編集を反映していないことがあるため）。 <!-- req 02:759a6505.44dd -->
- 要件4.4「alphaTex形式（内部データそのまま）」は、変換で情報を失わない（もとに近い形に戻せる）ことと読む。変換の完全性の確かめは、基本設計 07 章を受ける export-print.md に書く（07 章の回）。 <!-- req 02:bd709592.182c --> <!-- req 02:bd709592.d73a -->

## 4. 論理モデルと alphaTab のクラスの対応表

[[../basic_design/02_data_model.md#2]] の ER 図（論理モデル）と、alphaTab 1.8.4 のクラスの対応を本節に置く。基本設計は、この対応表を詳細設計で別に起こすとしている。 <!-- req 02:9438bac0.ab5c -->

(b) 表の中身は本書で決めた。項目の名前は alphaTab 1.8.4 の型定義（`alphaTab.d.ts`）で確かめたものだけを書く。もっともらしい名前を書くと、実装で食い違うため。値の変換（音量やパンの範囲の読み替え）と、奏法記号・タイ・スラーの写し方は、その項目を受ける回（基本設計 02 章 3.2 節から 3.4 節）に書く。

| 論理モデル | 実体（alphaTab） | 実体（アプリの側） |
|---|---|---|
| SONG | `Score`（曲名は `Score.title`、アーティスト名は `Score.artist`） | `SongDocument`（`id`・`createdAt`・`schemaVersion`）。残りの項目は 5 節 |
| PART | `Track`（パート名は `Track.name`、識別色は `Track.color`、音量・パン・ソロ・ミュートは `Track.playbackInfo` の `volume`・`balance`・`isSolo`・`isMute`）と、そのパートの譜表 `Track.staves[0]`（`Staff`。カポは `Staff.capo`） | `instrumentType` は [[part-tuning-management.md#2]] |
| TUNING | `Staff.stringTuning`（`Tuning`）の `tunings`（弦ごとの MIDI の音の高さ） | なし |
| TUNING_PRESET | なし | `tuning-presets.json`（置き場所は基本設計 06 章の回） |
| BAR | パートの小節は `Bar`（`Staff.bars`）。拍子・テンポ・リピートは曲共通の小節 `MasterBar`（`Score.masterBars`）が持つ（拍子は `timeSignatureNumerator`・`timeSignatureDenominator`、テンポは `tempoAutomations`、リピートは `isRepeatStart`・`repeatCount`）。拍子とテンポの「直前を継ぐ」の写し方は [[editing-core.md#3]] の 3.2 節 | なし |
| VOICE | `Voice`（`Bar.voices`。2 つ目のボイスは並びの 2 つ目） | なし |
| BEAT | `Beat`（`Voice.beats`。音価は `duration`・`dots`・`tupletNumerator`・`tupletDenominator`、休符かどうかは `isRest`。`isRest` は読み取り専用で、`notes` が空の Beat が休符） | なし |
| NOTE | `Note`（`Beat.notes`。弦は `string`、フレットは `fret`。タイは `isTieDestination`・`tieOrigin`・`tieDestination`、スラーは `slurOrigin`・`slurDestination`・`isSlurDestination` で、写し方は [[editing-core.md#3]] の 3.4 節。奏法記号とアーティキュレーションの属性は 3.5 節） | なし |
| SECTION_MARKER | `MasterBar.section`（`Section`。譜面に名前を描かせるための写し） | 正は `appMeta.sectionMarkers` |
| MEMO | なし | `appMeta.memos` |
| TAG・TAG_REF | なし | タグの一覧はアプリの側（基本設計 06 章の回）、曲に付けたタグは `appMeta.tags` |
| SONG_SETTINGS | なし | `appMeta.settings` |

## 5. 曲の項目（Song）

[[../basic_design/02_data_model.md#3.1]] を受ける。項目をどこに持つかは 4 節の対応表に合わせる。

- **`id`**（UUID の文字列、`SongDocument.id`）：(b) 版 4 の UUID を `crypto.randomUUID()` で作る。依存を足さずに作れ、今のコード（`packages/core/src/persistence/SongRepository.ts` の `create`）も同じ作り方のため。 <!-- req 02:9ea704df.eb01 --> 曲のファイルの名前（`{id}.tabapp`）にも使う。 <!-- req 02:9ea704df.6ad0 --> 曲のファイルは自分の場所を持たない。 <!-- req 02:9ea704df.5df9 --> 場所は、`id` と、`index.json` が持つ `songs/` からの相対フォルダで決まる。 <!-- req 02:9ea704df.6f49 -->
- **`title`**（文字列、`Score.title`）：曲名。(b) `Score` が同じ意味の項目 `title` を持つので、2 節の決まり（`Score` に同じ意味の項目があれば `Score` を使う）に従ってそこに持つ。 <!-- req 02:3faf5c16.ca61 --> 新規曲作成ダイアログのステップ 1 で入力する。 <!-- req 02:3faf5c16.74f0 --> 曲一覧の右クリック「名前を変更」で編集する（画面は基本設計 03 章の回に screens-navigation.md に書く）。 <!-- req 02:3faf5c16.ef22 --> 書き出すファイルの名前は、この曲名にパート名と日付を足して作る（決まりの中身は基本設計 07 章の回に export-print.md に書く）。 <!-- req 02:3faf5c16.843f -->
- **`tags`**（`Tag[]`、曲に付けたタグは `appMeta.tags`）：曲とタグは多対多。 <!-- req 02:5bd1f38c.2716 --> <!-- req 02:5bd1f38c.2f77 --> タグの総数の上限は 50。 <!-- req 02:5bd1f38c.bc2d --> 曲の進捗の区別もタグで表し <!-- req 02:5bd1f38c.c009 -->、`status` という名前の専用の項目は持たない。 <!-- req 02:5bd1f38c.035e --> 進捗を表すタグは利用者が自分で作って付け <!-- req 02:5bd1f38c.10f3 -->、アプリは既定のステータスタグを 1 つも用意しない。 <!-- req 02:5bd1f38c.c448 -->
- **`artist`**（文字列、空でもよい、`Score.artist`）：(b) `title` と同じ理由で `Score.artist` に持つ。 <!-- req 02:c7f15df5.0020 --> 曲一覧の並べ替えキーに使う。 <!-- req 02:c7f15df5.004e --> タグで代わりにしない専用の項目。 <!-- req 02:c7f15df5.de13 --> 新規曲作成ダイアログのステップ 1 で入力できる。 <!-- req 02:c7f15df5.663c --> 曲一覧の右クリック「名前を変更」で、曲名と一緒に編集できる。 <!-- req 02:c7f15df5.f749 --> 省略してよい。 <!-- req 02:c7f15df5.6e5a --> 古いファイルに無いときは、空の文字列として読む。 <!-- req 02:c7f15df5.9381 -->
- **`thumbnailRef`**（文字列）：曲のファイルには持たない。 <!-- req 02:7e9956a4.687c --> `index.json` の `SongSummary` だけが持つ、アプリの側に置いた曲一覧用の画像の写しの場所。 <!-- req 02:7e9956a4.7120 --> 画像の正は曲のファイルの `appMeta.thumbnail` <!-- req 02:7e9956a4.ce33 -->で、写しはそこから作り直せる。 <!-- req 02:7e9956a4.2a6d --> 画像の範囲は、alphaTab のレイアウトでの最初の 1 段。 <!-- req 02:7e9956a4.9c0c --> 作る時期と作り方は、基本設計 06 章と 03 章の回に書く。
- **`isTrashed`・`trashedAt`**（真偽・日時）：(b) 曲のファイルには持たず、ファイルの置き場所（`songs/` か `trash/`）と、ゴミ箱の索引 `trash-index.json` の削除日時から作る。曲のファイルの `appMeta` に入れるものは基本設計 02 章 4.1 節の 5 つに限るため。 <!-- req 02:bbe8d513.f4bc --> ゴミ箱に入れてから 30 日（保持期間）で完全に消す。保持期間の持ち方と消す時期は、基本設計 06 章の回に書く。 <!-- req 02:bbe8d513.3405 -->
- **`schemaVersion`**（文字列、`SongDocument.schemaVersion`）：型は文字列 <!-- req 02:0c840c07.7ed7 -->で、中身はセマンティックバージョニングの文字列（基本設計 02 章 4.2 節）。 <!-- req 02:0c840c07.33f7 --> 読み込むときに、移行が要るかの判断に使う。 <!-- req 02:0c840c07.94f8 -->
- **`createdAt`・`updatedAt`**：`createdAt` は曲のファイルに持つ（2 節の `SongDocument`）。`updatedAt` は曲のファイルに持たず、曲のファイルの `integrity.savedAtMonotonic`（保存したときの時刻、壁時計のミリ秒）から作る。索引を作り直すときも同じ（[[../basic_design/02_data_model.md#4.1]]、2026-09-29 本人決定）。今のコードは索引を作り直すときにファイルの更新時刻を使っているので、[[00_reference.md#8.1]] の G66 で直す。
