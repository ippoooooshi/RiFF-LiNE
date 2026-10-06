# 詳細設計書：データモデル・永続化

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 2「データモデル・永続化」
- **ブランチ名**：`feature/data-model-persistence`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 1. スコープ

[[../basic_design/02_data_model.md]] と [[../basic_design/06_file_io_persistence.md]] の前文を受ける。

- 本書は、曲のデータの形（2 節から 9 節、基本設計 02 章）と、曲とアプリの側のファイルをどこに置き、どう読み書きするか（10 節から 20 節、基本設計 06 章）を書く。
- 保存先は、ローカル <!-- req 06:982ee1f0.16bb -->・iCloud Drive <!-- req 06:982ee1f0.c71a -->・Google Drive <!-- req 06:982ee1f0.a7e4 -->から選べるようにし、設定画面から変えられるようにする。 <!-- req 06:982ee1f0.8229 --> 主ストレージ 1 つに、ミラー先を 0 個以上足して、複数の保存先を組み合わせられるようにする。 <!-- req 06:982ee1f0.a4e9 --> 選び方は 11 節、変え方は 12 節、組み合わせは 14 節。
- 保存先を選べるようにした要件の変更の経緯は、基本設計 06 章の前文と 12 章が正で、本書には写さない。

## 2. Score モデルとサイドカーメタデータ

[[../basic_design/01_architecture.md#3]] AD-1 を受ける。

- 1 曲は `SongDocument`（`packages/core/src/domain`）で表す。中身の中核は alphaTab の `Score`（`alphaTab.model.Score`）をそのまま持つ `score` で、アプリ独自の曲のモデルを別に作らない。書き出しと再生は、この `score` をそのまま alphaTab に渡す。 <!-- req 01:5542e325.c7c1 -->
- サイドカーに入れるのは、alphaTab の `Score` が持たない情報か、アプリ固有の情報だけとする。新しい情報を足すときは、先に `Score` に同じ意味の項目が無いかを確かめ、あれば `Score` のほうを使う。 <!-- req 01:9f185d99.6b28 -->
- `Score` とその下のオブジェクト（`Track`・`Staff`・`Bar`・`Voice`・`Beat`・`Note`）には、アプリ独自のプロパティを足さない。 <!-- req 01:9f185d99.8f9c -->
- サイドカーは `Score` の外に持つ。曲のファイルに入れるものは `SongDocument.appMeta`（型 `AppMetadata`）に、曲のファイルに入れないものはアプリの側のファイルに持つ。曲のファイル（`.tabapp`）では、`Score` を `song` に、サイドカーを `appMeta` に分けて置き、同じ JSON の中で混ぜない。`song` は alphaTab の `JsonConverter.scoreToJson(score)` の結果を `JSON.parse` して入れ、読むときは `JsonConverter.jsonToScore(JSON.stringify(song))` で戻す（alphaTab 1.8.4 の型定義にある 2 つ）。`appMeta` はアプリの型 `AppMetadata` で読み書きする。(b) alphaTab の変換を使うのは、`Score` の形が版上げで変わっても、変換は alphaTab の側で追いつくため。 <!-- req 01:9f185d99.af65 -->

**サイドカーの一覧は本節に並べない**：何をどこに置くかの一覧は、基本設計の 1 か所が正で、詳細設計でもその受け先の節 1 か所にだけ書く。本節は一覧の置き場所を決めるだけにする。

| 置き場所 | 一覧の正（基本設計） | 詳細設計で書く所 |
|---|---|---|
| 曲のファイルに入れるもの | [[../basic_design/02_data_model.md#4.1]] の `appMeta` の一覧 | 本書の 6 節（`appMeta` の中身）と 7 節（曲のファイルの形と `integrity`）。`AppMetadata` の項目は `appMeta` の一覧と 1 対 1 にする |
| アプリの側に置くもの（曲のファイルに入れないもの） | [[../basic_design/06_file_io_persistence.md#3]] のファイル構成（2 つの木） | 本書の 13 節（基本設計 06 章 3 節を受ける） <!-- req 01:f8b143e1.d823 --> |

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

`AppMetadata` の項目は 6 節、`SongFileJson` の形は 7 節に書く。

曲のファイルの形（スキーマ）を変えるときは、[[../basic_design/02_data_model.md#4.2]] のスキーマのバージョンと移行の方針に従う。`schemaVersion` の上げ方と移行の仕組みは 8 節に書く。 <!-- req 09:630b9903.2c1e -->

## 3. 保存の形と alphaTex

[[../basic_design/02_data_model.md#1]] を受ける。

- 実行しているときの曲のモデルは、alphaTab の `Score` 系（`Score`・`Track`・`Staff`・`Bar`・`Voice`・`Beat`・`Note`）を土台にする。持ち方は 2 節のとおり。 <!-- req 02:fd63facf.ae1f -->
- 曲のファイルは、保存のたびに alphaTex へ変換する形にはしない。 <!-- req 02:0290894c.0e48 -->
- 曲のファイルの形は、本アプリが自分で決める（alphaTex の形に頼らない）。 <!-- req 02:0290894c.5478 -->
- 曲のファイルは、版を管理する構造化 JSON で、保存するたびにその時点の曲の全体を書き出す（スナップショット）。形は 2 節の `SongFileJson`。 <!-- req 02:0290894c.deb1 --> <!-- req 02:61f6b909.f924 -->
- 曲のファイルは、自前の形の版として `schemaVersion` を持つ。版の上げ方と移行は 8 節に書く。 <!-- req 02:412b7e3b.fcd2 -->
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
| PART | `Track`（パート名は `Track.name`、識別色は `Track.color`、音量・パン・ソロ・ミュートは `Track.playbackInfo` の `volume`・`balance`・`isSolo`・`isMute`、並び順の `order` は `Score.tracks` の並び〈`Track.index`〉で別の項目として持たない。[[part-tuning-management.md#2]] の 2.1 節）と、そのパートの譜表 `Track.staves[0]`（`Staff`。カポは `Staff.capo`） | `instrumentType` は [[part-tuning-management.md#2]] |
| TUNING | `Staff.stringTuning`（`Tuning`）の `tunings`（弦ごとの MIDI の音の高さ） | なし |
| TUNING_PRESET | なし | `tuning-presets.json`（置き場所と形は 13 節の 13.4 節） |
| BAR | パートの小節は `Bar`（`Staff.bars`）。拍子・テンポ・リピートは曲共通の小節 `MasterBar`（`Score.masterBars`）が持つ（拍子は `timeSignatureNumerator`・`timeSignatureDenominator`、テンポは `tempoAutomations`、リピートは `isRepeatStart`・`repeatCount`）。拍子とテンポの「直前を継ぐ」の写し方は [[editing-core.md#3]] の 3.2 節 | なし |
| VOICE | `Voice`（`Bar.voices`。2 つ目のボイスは並びの 2 つ目） | なし |
| BEAT | `Beat`（`Voice.beats`。音価は `duration`・`dots`・`tupletNumerator`・`tupletDenominator`、休符かどうかは `isRest`。`isRest` は読み取り専用で、`notes` が空の Beat が休符） | なし |
| NOTE | `Note`（`Beat.notes`。弦は `string`、フレットは `fret`。タイは `isTieDestination`・`tieOrigin`・`tieDestination`、スラーは `slurOrigin`・`slurDestination`・`isSlurDestination` で、写し方は [[editing-core.md#3]] の 3.4 節。奏法記号とアーティキュレーションの属性は 3.5 節） | なし |
| SECTION_MARKER | `MasterBar.section`（`Section`。譜面に名前を描かせるための写し） | 正は `appMeta.sectionMarkers` |
| MEMO | なし | `appMeta.memos` |
| TAG・TAG_REF | なし | タグの一覧はアプリの側の `tags.json`（13 節の 13.4 節）、曲に付けたタグは `appMeta.tags` |
| SONG_SETTINGS | なし | `appMeta.settings` |

## 5. 曲の項目（Song）

[[../basic_design/02_data_model.md#3.1]] を受ける。項目をどこに持つかは 4 節の対応表に合わせる。

- **`id`**（UUID の文字列、`SongDocument.id`）：(b) 版 4 の UUID を `crypto.randomUUID()` で作る。依存を足さずに作れ、今のコード（`packages/core/src/persistence/SongRepository.ts` の `create`）も同じ作り方のため。 <!-- req 02:9ea704df.eb01 --> 曲のファイルの名前（`{id}.tabapp`）にも使う。 <!-- req 02:9ea704df.6ad0 --> 曲のファイルは自分の場所を持たない。 <!-- req 02:9ea704df.5df9 --> 場所は、`id` と、`index.json` が持つ `songs/` からの相対フォルダで決まる。 <!-- req 02:9ea704df.6f49 -->
- **`title`**（文字列、`Score.title`）：曲名。(b) `Score` が同じ意味の項目 `title` を持つので、2 節の決まり（`Score` に同じ意味の項目があれば `Score` を使う）に従ってそこに持つ。 <!-- req 02:3faf5c16.ca61 --> 新規曲作成ダイアログのステップ 1 で入力する。 <!-- req 02:3faf5c16.74f0 --> 曲一覧の右クリック「名前を変更」で編集する（画面は基本設計 03 章の回に screens-navigation.md に書く）。 <!-- req 02:3faf5c16.ef22 --> 書き出すファイルの名前は、この曲名にパート名と日付を足して作る（決まりの中身は基本設計 07 章の回に export-print.md に書く）。 <!-- req 02:3faf5c16.843f -->
- **`tags`**（`Tag[]`、曲に付けたタグは `appMeta.tags`）：曲とタグは多対多。 <!-- req 02:5bd1f38c.2716 --> <!-- req 02:5bd1f38c.2f77 --> タグの総数の上限は 50。 <!-- req 02:5bd1f38c.bc2d --> 曲の進捗の区別もタグで表し <!-- req 02:5bd1f38c.c009 -->、`status` という名前の専用の項目は持たない。 <!-- req 02:5bd1f38c.035e --> 進捗を表すタグは利用者が自分で作って付け <!-- req 02:5bd1f38c.10f3 -->、アプリは既定のステータスタグを 1 つも用意しない。 <!-- req 02:5bd1f38c.c448 -->
- **`artist`**（文字列、空でもよい、`Score.artist`）：(b) `title` と同じ理由で `Score.artist` に持つ。 <!-- req 02:c7f15df5.0020 --> 曲一覧の並べ替えキーに使う。 <!-- req 02:c7f15df5.004e --> タグで代わりにしない専用の項目。 <!-- req 02:c7f15df5.de13 --> 新規曲作成ダイアログのステップ 1 で入力できる。 <!-- req 02:c7f15df5.663c --> 曲一覧の右クリック「名前を変更」で、曲名と一緒に編集できる。 <!-- req 02:c7f15df5.f749 --> 省略してよい。 <!-- req 02:c7f15df5.6e5a --> 古いファイルに無いときは、空の文字列として読む。 <!-- req 02:c7f15df5.9381 -->
- **`thumbnailRef`**（文字列）：曲のファイルには持たない。 <!-- req 02:7e9956a4.687c --> `index.json` の `SongSummary` だけが持つ、アプリの側に置いた曲一覧用の画像の写しの場所。 <!-- req 02:7e9956a4.7120 --> 画像の正は曲のファイルの `appMeta.thumbnail` <!-- req 02:7e9956a4.ce33 -->で、写しはそこから作り直せる。 <!-- req 02:7e9956a4.2a6d --> 画像の範囲は、alphaTab のレイアウトでの最初の 1 段。 <!-- req 02:7e9956a4.9c0c --> 作る時期と作り方は 9.1 節。
- **`isTrashed`・`trashedAt`**（真偽・日時）：(b) 曲のファイルには持たず、ファイルの置き場所（`songs/` か `trash/`）と、ゴミ箱の索引 `trash-index.json` の削除日時から作る。曲のファイルの `appMeta` に入れるものは基本設計 02 章 4.1 節の 5 つに限るため。 <!-- req 02:bbe8d513.f4bc --> ゴミ箱に入れてから 30 日（保持期間）で完全に消す。保持期間の持ち方と消す時期は 17 節。 <!-- req 02:bbe8d513.3405 -->
- **`schemaVersion`**（文字列、`SongDocument.schemaVersion`）：型は文字列 <!-- req 02:0c840c07.7ed7 -->で、中身はセマンティックバージョニングの文字列（基本設計 02 章 4.2 節）。 <!-- req 02:0c840c07.33f7 --> 読み込むときに、移行が要るかの判断に使う。 <!-- req 02:0c840c07.94f8 -->
- **`createdAt`・`updatedAt`**：`createdAt` は曲のファイルに持つ（2 節の `SongDocument`）。`updatedAt` は曲のファイルに持たず、曲のファイルの `integrity.savedAtMonotonic`（保存したときの時刻、壁時計のミリ秒）から作る。索引を作り直すときも同じ（[[../basic_design/02_data_model.md#4.1]]、2026-09-29 本人決定）。今のコードは索引を作り直すときにファイルの更新時刻を使っているので、[[00_reference.md#8.1]] の G66 で直す。

## 6. appMeta の中身

曲のファイルの `appMeta` は、曲のファイルのうち `Score` の外に置く情報で <!-- req 02:93ed52ba.c483 -->、中身は基本設計 02 章 4.1 節の一覧に挙げた 5 つの項目に限り、これ以外の項目を足さない。 <!-- req 02:5d94c9b4.14d6 --> 曲のファイルに入れる情報の一覧は [[../basic_design/02_data_model.md#4.1]] の 1 か所だけが正で、本節は一覧を写さず、項目ごとに 6.1 節から 6.5 節でその形だけを書く。 <!-- req 02:dd2b82cc.5836 --> 項目を足すときは、まず基本設計の一覧に足し、8 節の決まり（新しい項目は省いてよく、読むときに既定の値で補う）に従う。6.1 節から 6.5 節の型は今のコード（`packages/core/src/domain/types.ts`）の形。

### 6.1 セクションマーカー（`sectionMarkers`）

`appMeta` の `sectionMarkers` は、セクションマーカーを持つ。 <!-- req 02:93ed52ba.a718 --> [[../basic_design/02_data_model.md#3.5]] を受ける。

```ts
export interface SectionMarker {
  id: string;
  /** マーカーを置いた曲共通の小節（MasterBar）の番号を、文字列にしたもの。 */
  barId: string;
  /** セクション名。 */
  label: string;
}
```

- セクション名（`label`）は文字列で持つ。 <!-- req 02:57d4aeca.86af --> イントロ・Aメロ・サビのように利用者が自由に付ける名前で、決まった選択肢に限らない。 <!-- req 02:57d4aeca.2988 -->
- マーカーは、パートの小節ではなく曲共通の小節（`MasterBar`）の位置で持つ。 <!-- req 02:3d914772.c916 --> (b) 位置は、`barId` に `Score.masterBars` の番号を文字列で入れて表す。今のコードの小節を足す・消すコマンド（`packages/core/src/editing/commands/barCommands.ts`）が、`barId` を小節の番号として読んでずらしているため。
- パートを全部消しても、マーカーは消さずに残す（[[part-tuning-management.md#2]] の 2.3 節）。 <!-- req 02:3d914772.ced1 -->
- 1 つのセクションの区間は、そのマーカーの小節から、次のマーカーの小節の手前までとする。 <!-- req 02:cfff9221.7f28 --> 最後のマーカーのセクションは、そのマーカーの小節から曲の終わりまでとする。 <!-- req 02:cfff9221.7b69 -->
- セクションの区間は、ループ再生の再生範囲に使い <!-- req 02:3d914772.4b7c -->、マーカーで区切った区間をループ再生できるようにする。 <!-- req 02:2573dd59.d1a3 --> ループ再生の中身は、基本設計 05 章の回に playback-integration.md に書く。
- マーカーの正は `appMeta.sectionMarkers` とする。 <!-- req 02:15f1380c.ba34 --> 譜面にセクション名を描かせるために、alphaTab の `MasterBar.section`（`Section`）へ写す。 <!-- req 02:15f1380c.7f40 --> 写しは正として読まず、曲を開くときに `appMeta.sectionMarkers` から作り直す。 <!-- req 02:2911bcaa.be1b --> 今のコードには、曲を開くときに作り直す所が無い（[[00_reference.md#8.1]] の G69）。
- マーカーを足すコマンドは `AddSectionMarkerCommand` <!-- req 02:91b73c0e.fe78 -->、変えるコマンドは `EditSectionMarkerCommand` <!-- req 02:91b73c0e.bad4 -->、消すコマンドは `DeleteSectionMarkerCommand` とする。 <!-- req 02:91b73c0e.79e7 --> 3 つとも今のコード（`packages/core/src/editing/commands/sectionMarkerCommands.ts`）にある。引数と確かめは、基本設計 04 章の回に editing-core.md に書く。
- 繰り返し記号（リピート）は `appMeta` に持たず、alphaTab の `MasterBar.isRepeatStart`（開始） <!-- req 02:34ce84c0.a233 -->と `MasterBar.repeatCount`（反復の回数）で持つ。 <!-- req 02:34ce84c0.fcfc --> 変えるコマンドは `SetRepeatCommand`（今のコードには無い、G26）。 <!-- req 02:1820c86e.43e9 --> 反復の回数の範囲と、対応する開始の無い終わりの扱いは [[../basic_design/13_design_decision_points.md#3]] B39 のとおりで、コマンドの中身は基本設計 04 章の回に editing-core.md に書く。

### 6.2 小節メモ（`memos`）

`appMeta` の `memos` は、小節メモを持つ。 <!-- req 02:93ed52ba.a925 --> [[../basic_design/02_data_model.md#3.6]] を受ける。

```ts
export interface Memo {
  id: string;
  /** メモを付けた曲共通の小節（MasterBar）の番号を、文字列にしたもの。 */
  barId: string;
  /** 本文（テキストだけ）。 */
  text: string;
  /** 作った日時（ISO 8601）。 */
  createdAt: string;
}
```

- 1 つの小節に、メモを何件でも置ける（[[../basic_design/13_design_decision_points.md#3]] B1）。 <!-- req 02:b04969c4.0dc5 --> 同じ小節のメモは上書きせず、足していく。 <!-- req 02:4756b319.87c6 -->
- メモは作った日時 `createdAt` を持つ。 <!-- req 02:2a72cdb0.9bb4 --> 小節メモ一覧パネルでは、作った日時の順に並べる（画面は基本設計 03 章の回に screens-navigation.md に書く）。 <!-- req 02:2a72cdb0.2d62 -->
- メモは曲共通の小節（`MasterBar`）の位置を指し <!-- req 02:ac7b91f3.b205 -->、パートの小節の位置は指さない。 <!-- req 02:ac7b91f3.0fc9 --> 位置の持ち方は 6.1 節のマーカーと同じ（`barId` に `Score.masterBars` の番号）。パートを全部消しても、メモは消さずに残す。 <!-- req 02:33c8241c.710c -->
- メモはテキストだけを持ち <!-- req 02:5d17f51f.63a3 -->、音声は持たない。 <!-- req 02:5d17f51f.b5ed -->
- 本文の文字数には上限を置き <!-- req 02:9c99fb8e.93ae -->、上限は 100 文字とする（`MEMO_MAX_LENGTH`、`packages/core/src/domain/validation.ts`）。 <!-- req 02:9c99fb8e.4efc -->
- 文字数は、見た目の 1 文字を 1 文字と数える。 <!-- req 02:da880066.e848 --> 絵文字も 1 つで 1 文字と数える。 <!-- req 02:da880066.d868 --> 本文には改行を入れられ <!-- req 02:da880066.866c -->、改行も 1 文字と数える。 <!-- req 02:da880066.4f24 --> (b) 数え方は、`Intl.Segmenter`（`granularity: 'grapheme'`）で区切った数とする。見た目の 1 文字（書記素のまとまり）で区切る標準の手段で、いくつかの符号位置からできた絵文字も 1 つに、改行の CR と LF の組も 1 つに数えるため（Node.js 24 で確かめた）。今のコードの `clampMemoText` は符号位置（`Array.from`）で数えていて、ここと違う（G68）。
- 100 文字を超えても入力は止めず、Warning（`EDIT-004`）を出す。 <!-- req 02:06c207e3.26fb --> そのメモを確定したとき（[[editing-core.md#3]] の 3.10 節）に先頭の 100 文字へ切り詰め、曲のファイルには切り詰めた本文が書かれる（[[../basic_design/13_design_decision_points.md#4]] C13。基本設計 02 章 3.6 節の「そのメモを入力・編集して保存したときにだけ切り詰める」を、確定したときに切り詰める形で満たす）。 <!-- req 02:06c207e3.6f88 -->
- 100 文字を超えるメモを含む古いファイルを開いたときは、切り詰めずにそのまま見せる。 <!-- req 02:72a539e5.b139 --> そのメモを入力・編集して保存したときにだけ、そのメモを切り詰める。 <!-- req 02:72a539e5.b4e2 --> それ以外の保存では、そのメモの中身に触れない。 <!-- req 02:31cba116.4d92 -->
- メモを足すコマンドは `AddMemoCommand` <!-- req 02:4195e21c.b0a5 -->、変えるコマンドは `EditMemoCommand` <!-- req 02:4195e21c.5849 -->、消すコマンドは `DeleteMemoCommand` とする。 <!-- req 02:4195e21c.f020 --> 3 つとも今のコード（`packages/core/src/editing/commands/memoCommands.ts`）にある。

### 6.3 曲に付けたタグ（`tags`）

- `appMeta` の `tags` は、曲に付けたタグを持つ。 <!-- req 02:93ed52ba.9ff1 --> 曲に付けたタグは `TagRef[]`（`{ tagId: string }` の並び）で持つ。タグの一覧そのものはアプリの側の `tags.json` に置く（13 節の 13.4 節）。曲とタグの関係は 5 節の `tags` の項目のとおり。
- タグの総数の上限は 50 とし、タグを作る操作で、作る前に確かめる（超えたら `TAG-001`、Error）。 <!-- req 02:932d8df0.aa59 --> 確かめる関数は今のコードの `packages/core/src/domain/validation.ts`（`TAG_COUNT_LIMIT`）にある。タグを作る画面は [[screens-navigation.md#12]] の 12.10 節、タグの一覧を置くファイルは 13 節の 13.4 節。

### 6.4 曲ごとの設定（`settings`）

```ts
export interface SongSettings {
  /** 曲を開いたときの表示モード。 */
  defaultViewMode: 'focus' | 'scroll' | 'score';
  explicitTimeSignatureBars: number[]; // 拍子をはっきり入れた小節の番号（MasterBar.index、0 から、小さい順）
  partPresetIds: (string | null)[]; // パートごとの presetId（Track.index の順）。プリセットから作っていないパートは null
}
```

- `appMeta` の `settings` は曲ごとの設定で、表示の設定（`defaultViewMode`）を持つ。 <!-- req 02:93ed52ba.936f --> <!-- req 02:4d79cf66.3726 --> `defaultViewMode` は、曲を開いたときの表示モードを表す。 <!-- req 02:5525a8e0.39e5 --> 値は `focus`（フォーカス）・`scroll`（全体スクロール）・`score`（スコア）の 3 つのどれかとする。 <!-- req 02:5525a8e0.5a2f -->
- `settings` はミキサーの値を持たない。 <!-- req 02:bb8e0f3a.fcfa --> パートごとの音量 <!-- req 02:533bc2a4.fb8b -->・パン <!-- req 02:533bc2a4.f9de -->・ソロ <!-- req 02:533bc2a4.06a5 -->・ミュート <!-- req 02:533bc2a4.a855 -->は、パートが持つ（`Track.playbackInfo`、[[part-tuning-management.md#2]] の 2.1 節）。
- `explicitTimeSignatureBars` は、拍子を直前の小節から継がずにはっきり入れた小節の一覧（2026-10-01 本人決定）。 <!-- req 02:4d79cf66.c15e --> 中身と、一覧を書き換えるコマンドは [[editing-core.md#3]] の 3.2 節。`partPresetIds` は、パートがどのプリセットから作られたかの `presetId` の並び（2026-10-01 本人決定）。 <!-- req 02:4d79cf66.a8ab --> パートとの対応のさせ方は [[part-tuning-management.md#3]] の 3.1 節。(b) この 2 つを読むときに曲のファイルに無ければ（8 節の `1.0.0` の曲）、`partPresetIds` はパートの数だけ `null` を並べ、`explicitTimeSignatureBars` は 1 小節目と、`MasterBar` の拍子の値が直前の小節と違う小節を入れて作る。空の一覧として読むと、前の版で途中の小節に入れた拍子が「継ぐ」と読まれ、前の小節の拍子を変えたときに一緒に書き換わってしまうため。今のコードの `settings` は `mixerSnapshot` を持っていて、ここと違う（[[00_reference.md#8.1]] の G72）。今のコードの `settings` にこの 2 つは無い（G22・G73）。

### 6.5 サムネイル（`thumbnail`）

```ts
thumbnail: { encoding: 'base64-png'; data: string } | null;
```

- `appMeta` の `thumbnail` は、曲一覧のサムネイルを持つ。 <!-- req 02:5d94c9b4.3b2f --> `data` には、PNG の画像を base64 の文字列にしたものを入れる。 <!-- req 02:2bca23c8.b17c --> `encoding` は `base64-png` とする。 <!-- req 02:2bca23c8.cb6f --> まだ作っていないときは `null`（今のコードの形）。
- 画像の範囲は 5 節の `thumbnailRef` のとおり。作る時期と作り方は 9.1 節。

## 7. 曲のファイルの形と `integrity`

[[../basic_design/02_data_model.md#4.1]] を受ける。`appMeta` の中身は 6 節。型は今のコード（`packages/core/src/domain/types.ts` の `SongFileJson`）の形。曲のファイルのいちばん上の階層は、下の型の 6 つの項目に限り、これ以外を置かない（基本設計 02 章 4.1 節）。 <!-- req 02:8b6927e9.dacb --> <!-- req 02:8b6927e9.dc01 --> <!-- req 02:8b6927e9.35db --> <!-- req 02:8b6927e9.0c67 --> <!-- req 02:8b6927e9.6d74 --> <!-- req 02:8b6927e9.213a --> `appMeta` の型 `AppMetadataJson` は、6.1 節から 6.5 節の見出しの括弧の中の名前を項目名とし、その節の型を値の型とする形で、曲のファイルの上とメモリの上で同じ形を使う（今のコードは `type AppMetadataJson = AppMetadata`、同じ `types.ts`）。今のコードの `settings` は、6.4 節の 2 つの項目をまだ持たない（[[00_reference.md#8.1]] の G73）。

```ts
export interface SongFileJson {
  schemaVersion: string;           // 8 節
  id: string;                      // 5 節の id。ファイルの名前と同じ
  createdAt: string;               // 5 節の createdAt
  song: unknown;                   // Score を JsonConverter で JSON にしたもの（2 節）
  appMeta: AppMetadataJson;        // 6 節
  integrity: {
    savedAtMonotonic: number;      // 保存したときの時刻（壁時計のミリ秒）
    checksum: string;              // 'sha256:' で始まる
  };
}
```

- `checksum` は、アトミック書き込みで書いたファイルを確かめるために付け <!-- req 02:2a353628.8c0a -->、落ちたあとの立ち直りで壊れたファイルを見つけるためにも使う。 <!-- req 02:2a353628.7515 --> 確かめる流れは 15 節。
- ハッシュをかける対象は、`integrity` を除いた `{schemaVersion, song, appMeta}` とする。 <!-- req 02:2a353628.f996 --> ハッシュの種類は SHA-256 とする。 <!-- req 02:2a353628.4ade --> 値は `sha256:` で始まる文字列とする。 <!-- req 02:2a353628.5de3 --> 今のコードでは `packages/core/src/domain/checksum.ts` が作る。
- `savedAtMonotonic` には、保存したときの時刻を壁時計のミリ秒で入れる。 <!-- req 02:2a353628.9d7a --> 曲一覧の更新日時（9 節の `SongSummary.updatedAt`）は、ここから作る。 <!-- req 02:2a353628.bbc4 --> 索引を作り直すときも、ファイルの更新時刻ではなくここから作る（今のコードとの違いは [[00_reference.md#8.1]] の G66）。 <!-- req 02:2a353628.2a86 --> 名前に Monotonic とあるが中身は壁時計で、名前は古いファイルと合わせるため変えない。 <!-- req 02:2a353628.b3ec -->
- 曲のファイルの拡張子は `.tabapp` とする。 <!-- req 02:f73adfca.13cc --> OS との関連付けは 19 節。

## 8. スキーマの版と移行

[[../basic_design/02_data_model.md#4.2]] を受ける。今のコードでは `packages/core/src/persistence/SchemaMigrator.ts` が移行を受け持ち、今の版は `CURRENT_SCHEMA_VERSION`（`packages/core/src/domain/SongDocument.ts`、`1.0.0`）。6.4 節の `settings` に省いてよい 2 つの項目（`explicitTimeSignatureBars`・`partPresetIds`）を足すので、下の (b) の上げ方に照らして、この設計の版は 2 つ目の数を上げた `1.1.0` とする（読むときに無いものの補い方は 6.4 節。今のコードは `1.0.0` のまま、[[00_reference.md#8.1]] の G73）。

- `schemaVersion` はセマンティックバージョニングの文字列とする。 <!-- req 02:93b0fba9.b699 --> アプリの版とは合わせず、別に管理する。 <!-- req 02:93b0fba9.5ccf -->
- (b) 版の上げ方：曲のファイルの形を変えるときに上げる。省いてよい項目を足すだけなら 2 つ目の数（`1.0.0` → `1.1.0`）を上げ、変換の関数が要る変更なら 1 つ目の数（`1.x.x` → `2.0.0`）を上げる。形を変えない直しでは上げない。セマンティックバージョニングの決まり（前と合う足し方は 2 つ目、前と合わない変更は 1 つ目）に従うと、読む側が変換の要るかを 1 つ目の数だけで見分けられるため。 <!-- req 09:630b9903.2c1e -->
- 新しい項目は、いつも省いてよい項目として足し <!-- req 02:e41359c2.8436 -->、読むときに既定の値で補う。 <!-- req 02:e41359c2.222f --> <!-- req 02:ae53b13d.9bf9 --> 今ある項目の意味は原則として変えず <!-- req 02:e41359c2.18aa -->、消さない。 <!-- req 02:e41359c2.b95b -->
- 曲のファイルを読むときに `schemaVersion` を確かめる。 <!-- req 02:12f418b8.3221 --> 今の版より古ければ、1 版ずつの変換の関数（`SchemaMigrator.register(from, to, fn)` で足したもの）を順につないで当てる（`v1→v2→v3`）。 <!-- req 02:12f418b8.a6fc --> 変換を終えてから、曲をメモリ上に広げる。 <!-- req 02:12f418b8.aaac -->
- 変換した曲は、次の自動保存のときに今の版で上書きする。 <!-- req 02:732e54ad.be8f --> まとめて変換する一括の処理は持たず、開いた曲から順に新しくなる。 <!-- req 02:732e54ad.1a9f -->
- 大きな変更で 1 版ずつの変換の関数だけでは足りないときも、曲のファイルを読む同じ経路で自動で変換する。 <!-- req 02:ed7744dd.11a2 --> 本人が手で変換を走らせる手順は作らない。 <!-- req 02:ed7744dd.0553 --> 変換するのは、曲のファイルを読む Web コア（`packages/core`）とする。 <!-- req 02:ed7744dd.e01d -->
- 版を調べる前に、ファイルの形を確かめる。(1) JSON として読めない、(2) いちばん上がオブジェクトでない、(3) `schemaVersion` が空でない文字列でない、のどれかなら、壊れたファイルとして `CorruptSongFileError` を投げ、Critical の `FILE-008` を出す。形が正しく、`schemaVersion` から今の版へ移す変換の関数がつながらないとき（今より新しい版のとき）だけ、`UnsupportedSchemaVersionError` を投げて Critical の `FILE-004` を出す。壊れたファイルで `FILE-004` は出さない。(1) は `SongRepository.load` が `JSON.parse` の失敗を、(2)(3) は `SchemaMigrator.migrate` が受け持つ。コードの文と復元の手段（`LocalBackupService.restore`、20 節）は [[00_reference.md#5]]。
- 変換するときは、変換する前の版を残し、変換の不具合で曲を失わないようにする。 <!-- req 02:ed7744dd.633c --> 置き場所は、その PC のアプリの領域で、`LocalBackup` と同じ場所（基本設計 06 章 3 節の 2 つ目の木、Electron では `app.getPath('userData')`）とする（2026-10-01 本人決定）。 <!-- req 02:ed7744dd.5884 --> 残した版は、残してから 30 日で消す（2026-10-01 本人決定）。 <!-- req 02:ed7744dd.6ddf -->

(b) 置き方と消す時機：変換の前に、読んだ曲のファイルを中身を変えずに `PreMigration/{songId}.{変換する前の schemaVersion}.tabapp` へ写す（`LocalBackup/` と並ぶフォルダ）。30 日を過ぎたものは、アプリを起動したときに消す。`LocalBackup/` は保存の直前に 1 世代だけを入れ替える（`LocalBackupService.rotate`）ので、同じフォルダに置くと変換した曲を保存したときに変換前の版が消えうるため、別のフォルダにする。起動のときに消すのは、ゴミ箱の期限を過ぎた曲を起動のときに消す（基本設計 06 章 7 節）のと同じ時機にそろえるため。今のコードに変換前の版を残す処理は無い（[[00_reference.md#8.1]] の G73）。

## 9. 曲一覧のインデックス

[[../basic_design/02_data_model.md#5]] を受ける。今のコードでは `packages/core/src/persistence/SongIndexService.ts` が読み書きする。読み書きの時期と、曲のファイルと同時に直す流れは 9.1 節。

- 曲のファイルを全部読まずに曲一覧を出せる軽い索引 `index.json` を、曲のファイルとは別に持つ（置き場所は基本設計 06 章 3 節の `TabApp/index.json`）。 <!-- req 02:bf63b23f.1076 -->
- `index.json` は、1 曲を 1 件の `SongSummary` で持つ。 <!-- req 02:bf63b23f.8fc0 -->

```ts
export interface SongSummary {
  id: string;
  title: string;
  artist: string;                        // 空でもよい
  createdAt: string;                     // ISO 8601
  updatedAt: string;                     // ISO 8601。7 節の savedAtMonotonic から作る
  tags: string[];                        // タグの名前（TagRef を名前に直したもの）
  thumbnailRef: string | null;
  firstPartInstrumentType: 'electric_guitar' | 'bass' | null;  // パートが 0 なら null
  firstPartTuningName: string | null;    // 先頭のパートの Staff.stringTuning.name。パートが 0 なら null
  folder: string;                        // songs/ からの相対フォルダ。songs/ の直下なら空の文字列
}
```

- 項目は、`id` <!-- req 02:bf63b23f.8a63 -->・`title` <!-- req 02:bf63b23f.f069 -->・`artist` <!-- req 02:bf63b23f.53b7 -->・`createdAt` <!-- req 02:bf63b23f.ad46 -->・`updatedAt` <!-- req 02:bf63b23f.bc7d -->・`tags` <!-- req 02:bf63b23f.443c -->・`thumbnailRef` <!-- req 02:bf63b23f.854b -->の 7 つ。 <!-- req 02:d17f761a.5132 --> これに、並べ替えの代表値として先頭のパートの楽器の種類 <!-- req 02:bf63b23f.5cda -->とチューニングの名前 <!-- req 02:bf63b23f.b782 -->、`songs/` からの相対フォルダを足す。 <!-- req 02:bf63b23f.f033 --> <!-- req 02:d17f761a.1532 -->
- (b) 足す 3 つの名前は `firstPartInstrumentType`・`firstPartTuningName`・`folder` とし、パートが 0 の曲では代表値の 2 つを `null` にする。基本設計 03 章 4 節の並べ替えのキーが「先頭パート」の値と決めていて、パートが 0 の曲（[[part-tuning-management.md#2]] の 2.3 節）でも索引を作れるようにするため。
- 曲一覧の 6 つの並べ替えのキーは、この索引だけで並べる。曲名は `title`、アーティスト名は `artist` <!-- req 02:c7f15df5.004e -->、更新日時は `updatedAt`、作成日時は `createdAt`、パート種別は `firstPartInstrumentType`、チューニング名は `firstPartTuningName` を使う。フォルダ分けは `folder` を使う。並べ替えの画面は、基本設計 03 章の回に書く。
- 曲一覧を読むときは `index.json` だけを読み、曲の数によらずほぼ同じ手間で一覧を得る（基本設計 06 章の索引）。 <!-- req 02:32e10068.a89e --> 曲の数が 900 件に達したら、予告の Warning（`SONG-001`）を出す。数えて出す時機は [[screens-navigation.md#2]] の (b) のとおりで、曲を作った後と、曲一覧を読み込んだときとする（基本設計 08 章 1 節の「曲数900/1000＝90%到達」と 09 章の「900件に到達した時点」に合わせる）。 <!-- req 02:32e10068.17d8 --> 1000 件で、新しい曲を作るのを拒む Error（`SONG-002`）を出す。 <!-- req 02:32e10068.6123 --> 数は今のコードの `SONG_COUNT_WARN_THRESHOLD`・`SONG_COUNT_LIMIT`（`packages/core/src/domain/validation.ts`）。
- 今のコードの `SongSummary` は `id`・`title`・`updatedAt`・`tags`・`thumbnailRef` と `isTrashed` で、`artist`・`createdAt`・代表値の 2 つ・相対フォルダが無い（[[00_reference.md#8.1]] の G71）。

### 9.1 索引を直す時機と作り直し

[[../basic_design/06_file_io_persistence.md#10]] を受ける。

- `index.json` は、全部の曲のファイルから作り直さずに、変わった曲の 1 件だけを差分で直す。 <!-- req 06:4ec5d28e.5af8 --> 直すのは `SongIndexService.upsert(summary)`（足す・替える）と `remove(songId)`（消す）で、ファイルへは直した後の一覧を 15 節と同じ一時ファイルからの改名で書く。
- 直す時機は、曲を新しく作ったとき <!-- req 06:4ec5d28e.736b -->・曲を保存したとき（更新日時が変わる） <!-- req 06:4ec5d28e.3bfe -->・曲を消したとき（ゴミ箱へ入れたとき、17 節） <!-- req 06:4ec5d28e.3698 -->・曲名を変えたとき <!-- req 06:4ec5d28e.2204 -->・アーティスト名を変えたとき <!-- req 06:4ec5d28e.2d76 -->・タグを変えたとき <!-- req 06:4ec5d28e.5488 -->・サムネイルを作り直したとき <!-- req 06:4ec5d28e.90fb -->・先頭のパートの楽器の種類 <!-- req 06:4ec5d28e.7a47 -->かチューニング <!-- req 06:4ec5d28e.782d -->を変えたとき・曲をフォルダへ移したとき <!-- req 06:4ec5d28e.d622 -->とする。
- (b) 曲名・アーティスト名・タグ・先頭のパートの変更は、どれも曲の編集で、自動保存（15 節）で曲のファイルを書いた後に `SongRepository.save` が `upsert` を呼ぶ 1 つの経路で直す。曲一覧の右クリックの「名前を変更」「タグを編集」も、曲のファイルを書き直してから同じ経路で直す。経路を 1 つにすれば、曲のファイルと索引が食い違う時機が保存の 1 か所に限られるため。ゴミ箱・フォルダの移動・複製は、それぞれ 17 節・9.2 節・18 節の処理の終わりに直す。
- サムネイルは、自動保存の確定に合わせて非同期で作り直し <!-- req 06:fdbb8fc6.73ec -->、作り直したら `index.json` の `thumbnailRef` を直す。 <!-- req 06:fdbb8fc6.a06e --> 画像の範囲は、alphaTab のレイアウトでの最初の 1 段（画面の幅で折り返された最初の段）とする（[[../basic_design/13_design_decision_points.md#3]] B7、[[web-core-foundation.md#12]] の 12.3 節）。 <!-- req 06:fdbb8fc6.e901 -->
- (b) 作り直しは編集ウィンドウのレンダラーで行う。`AutoSaveScheduler` の `onSaved`（15 節）を受けて、最初の 1 段を描いた PNG を作り、`appMeta.thumbnail`（6.5 節）に入れて、次の自動保存で曲のファイルへ書く。曲を描いているのはそのレンダラーだけで、曲一覧ウィンドウでは alphaTab を読み込まない（[[web-core-foundation.md#10]] の 10.1 節）ため。写し（`thumbnailRef` が指す画像）は `appMeta.thumbnail` から作り直す。
- 写しは、主ストレージの `TabApp/thumbnails/{songId}.png` に置き、`thumbnailRef` にはこの `TabApp/` からの相対パス（`thumbnails/{songId}.png`）を入れる。保存先の移行では一緒に移す（13.1 節。2026-10-06 本人決定、honnin-queue 49 番）。この置き場所は基本設計 06 章 3 節の木にまだ無く、次の基本設計の直しで足す。
- (b) 写しは `SongRepository.save` が、`appMeta.thumbnail` が前の保存から変わったときに、base64 を PNG のバイト列に戻して 15 節と同じ一時ファイルからの改名で書き、そのあと `index.json` の `thumbnailRef` を直す。`appMeta.thumbnail` が `null` なら写しを作らず、`thumbnailRef` も `null` にする。曲のファイルを書く所と写しを書く所を 1 つにすれば、写しが曲のファイルより新しくなることが無いため。
- (b) 曲一覧が `thumbnailRef` の写しを見つけられないとき（別の PC で同期が終わる前、写しを消したとき）は、そのカードを曲名だけの枠で出し、main が裏でその曲のファイルを読んで `appMeta.thumbnail` から写しを作り直し、できたら曲一覧に知らせて描き直す。曲一覧を出す処理は `index.json` だけで済ませ（9 節）、写しの無い曲だけを後から埋めるため。
- (b) 写しはミラー先へ写さない（14.1 節の写すものに入れない）。曲のファイルの `appMeta.thumbnail` から作り直せ、ミラー先を主ストレージに切り替えたときも上の作り直しで埋まるため。
- (b) 曲を複製したときは、元の曲の写しを `thumbnails/{新id}.png` へ写す（`copyFile`、18 節）。ゴミ箱へ入れても写しは残し、ゴミ箱から完全に消したときに消す（17 節）。
- `index.json` が読めないとき（壊れている・無い）は、`songs/` の下の曲のファイルを全部読んで作り直し（`rebuildFromSongsFolder()`）、Warning の `SONG-003`（「曲一覧を読み込めなかったため作り直しました」、`context` に作り直した曲の数）を出す。作り直した一覧は `index.json` に書く。

### 9.2 曲一覧のフォルダの実体

曲一覧のフォルダ分け（[[screens-navigation.md#6]] の 6.4 節）の、ファイルの側の処理。

- 曲一覧のフォルダは、`songs/` の下のサブフォルダとして作る（13 節）。フォルダの中にフォルダを作れ、曲一覧はその階層をそのまま出す（[[screens-navigation.md#6]] の 6.4 節）。`SongSummary.folder` は `songs/` からの相対パス（区切りは `/`）とする。
- フォルダを作ると、選んでいるフォルダの中（選んでいなければ `songs/` の直下）にサブフォルダを作る（`ensureDirectory`）。名前を変えると、そのサブフォルダの名前を変え（`renameFile`）、その下にある曲の全部の `folder` の先頭を新しいパスに直す。消すのは中が空のときだけで、空のフォルダを消しても `index.json` は変わらない。
- 曲をフォルダへ移すときは、曲のファイルを `songs/` の下で動かし（`renameFile`）、`index.json` のその曲の `folder` を差分で直す（9.1 節）。動かすのはファイルだけで、曲のファイルの中身は変えない。
- Windows のファイル名に使えない文字（`\ / : * ? " < > |`）は、フォルダの名前の欄で打っても入らない（2026-10-06 本人決定、honnin-queue 48 番の (3)。欄の下の説明は [[screens-navigation.md#6]] の 6.4 節）。エラーのコードと知らせは足さない。
- (b) 貼り付けた文字も、使えない文字を除いてから欄に入れる。確定するときは、名前の末尾の点と空白を取り除き、取り除いて空になれば、作るときは作らず、名前を変えるときは前の名前のままにする。Windows は末尾の点と空白を黙って落とすので、欄に見えている名前とフォルダの名前を食い違わせないため。
- (b) 名前が Windows の予約名（`CON`・`PRN`・`AUX`・`NUL`・`COM1` から `COM9`・`LPT1` から `LPT9`。大文字と小文字を区別せず、後ろに `.` と文字が続くものも含む）なら、名前の後ろに `_` を足して作る（「CON」なら「CON_」）。予約名はフォルダとして作れないが、知らせを足さない決まり（honnin-queue 48 番の (3)）なので、黙って拒まずに作れる名前にするため。

## 10. 保存先の抽象と `FileSystemAdapter`

[[../basic_design/06_file_io_persistence.md#1]] を受ける。

- [[../basic_design/01_architecture.md#3]] AD-3 の `FileSystemAdapter` は、決まったクラウドへ書く口ではなく、設定で決めたローカルのフォルダのパスの下を読み書きする口として作る。 <!-- req 06:1b1cfcf3.0fca -->
- iCloud Drive は、Windows 版 iCloud がこの PC の中に作る同期フォルダを、main の Node.js の `fs` で読み書きする。 <!-- req 06:5f49d6c4.3ab2 --> Google Drive も、Google Drive for Desktop がこの PC の中に作る同期フォルダを、同じく `fs` で読み書きする。 <!-- req 06:5f49d6c4.a8a8 --> どちらでも、アプリはクラウドの API を呼ばない。
- そのため、クラウドの API の認証（トークンの管理を含む） <!-- req 06:7a39df88.bccb -->と、ネットワークの例外の処理 <!-- req 06:7a39df88.d751 -->をアプリに持たない。
- どの保存先を選んでも、要件 5.1 の完全オフラインの動作を保つ。 <!-- req 06:66d3d0fb.2a64 --> アプリ自身はローカルのファイルの読み書きだけをし <!-- req 06:66d3d0fb.a805 -->、クラウドとの同期は OS の側の同期クライアントの仕事とする。 <!-- req 06:66d3d0fb.16d5 --> 同期の状態を確かめたり待ったりしないことは [[web-core-foundation.md#6]] の 6.2 節。
- アプリから見ると、ローカル <!-- req 06:1455de0a.0cfa -->・iCloud Drive <!-- req 06:1455de0a.4d65 -->・Google Drive <!-- req 06:1455de0a.6e0b -->は、どれも 1 つのフォルダのパスで、同じ `FileSystemAdapter` で扱う。種類の違いは、設定に残す種別（11 節の `StorageType`）と、候補の見つけ方（11 節）にだけ出る。

### 10.1 `FileSystemAdapter` のシグネチャ

[[web-core-foundation.md#3]] の 3.3 節の表で本書に回された分。PC 版で IPC を通るメソッドは `Promise` を返す（同じ 3.3 節の非同期の決まり）。

```ts
// packages/core/src/platform（今のコードは packages/shared-types/src/index.ts に置いている）
export interface FileSystemAdapter {
  readFile(relativePath: string): Promise<Uint8Array>;
  writeFile(relativePath: string, data: Uint8Array): Promise<void>;
  listDirectory(relativePath: string): Promise<DirEntry[]>;
  ensureDirectory(relativePath: string): Promise<void>;
  renameFile(fromRelativePath: string, toRelativePath: string): Promise<void>;
  deleteFile(relativePath: string): Promise<void>;
  copyFile(fromRelativePath: string, toRelativePath: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  /** 作ったときに渡されたルートの絶対パス。IPC を通らない。 */
  getRootPath(): string;
}
export interface DirEntry { name: string; isDirectory: boolean; sizeBytes: number; modifiedAt: string; }
export interface FileSystemAdapterFactory {
  createForRoot(absoluteRootPath: string): FileSystemAdapter;
}
```

| メソッド | 引数・戻り値 | エラーのとき |
|---|---|---|
| `readFile` | ルートからの相対パス（区切りは `/`）。中身のバイト列 | 無ければ `FileNotFoundError`、読めなければ `FileReadError`（`packages/core/src/platform/errors.ts`）。同期フォルダの実体を待つ読み直しは 16 節 |
| `writeFile` | 相対パスと中身 | 書けなければ `FileWriteError`。このメソッドは書き直しをしない（書き直しは 15 節の `AutoSaveScheduler`） |
| `listDirectory` | 相対パス。フォルダの中の一覧 | 無ければ `FileNotFoundError`、読めなければ `FileReadError` |
| `ensureDirectory` | 相対パス。親のフォルダごと作る | 既にあってもエラーにしない。作れなければ `FileWriteError` |
| `renameFile` | 同じルートの中で、移す前と後の相対パス | 移す前が無ければ `FileNotFoundError`、移せなければ `FileWriteError` |
| `deleteFile` | 相対パス | 無くてもエラーにしない。消せなければ `FileWriteError` |
| `copyFile` | 同じルートの中で、写す前と後の相対パス | 写せなければ `FileWriteError` |
| `exists` | 相対パス。在るかどうか | 調べられなければ `FileReadError` |
| `getRootPath` | ルートの絶対パス | エラーにならない |

- (b) 主ストレージ・ミラー先・移行先は別のフォルダなので、任意の絶対パスをルートにした `FileSystemAdapter` を `FileSystemAdapterFactory.createForRoot` で作る。ミラー（14 節）と移行（12 節）が、複数のフォルダを同時に読み書きするため。main の側は、同じルートには 1 つだけ作って使い回す（今のコードの `apps/desktop/src/main/ElectronFileSystemAdapterFactory.ts`）。
- (b) レンダラーからは IPC で main を呼ぶ。ルートを付けて呼ぶチャンネル（`fs:readFileAt` の形。`{ rootPath, relativePath }` を渡す）を使い、main は `rootPath` が絶対パスかを確かめ、ルートの外（`..`）を指す相対パスを拒む。レンダラーが渡したパスで、選んでいないフォルダの外を読み書きさせないため。IPC の決まりは [[web-core-foundation.md#6]] の 6.3 節。

## 11. 保存先の設定と同期フォルダの見つけ方

[[../basic_design/06_file_io_persistence.md#2.1]] を受ける。設定ダイアログの 9・10 項目目の画面は [[screens-navigation.md#12]] の 12.10 節。

- 主ストレージは、アプリが曲を実際に読み書きするフォルダで <!-- req 06:a4794b91.15f3 -->、1 つだけ決める。 <!-- req 06:a4794b91.8ff6 --> 既定はローカルで、その PC のアプリの領域とする。 <!-- req 06:a4794b91.2a87 --> (b) 基本設計の「`%APPDATA%/TabApp/`相当」を、Electron がアプリごとに用意する `app.getPath('userData')`（Windows では `%APPDATA%` の下のアプリのフォルダ）と読む。クラウドに頼らずにいつも書ける場所で、13 節のローカル既定パスと同じ領域にそろえられるため。曲のファイルはその下の `TabApp/` に入るので、ローカル既定パスの木（13.2 節）のファイルと重ならない。
- 保存先の設定は次の型で持つ。置き場所は 13 節の `settings.json`。

```ts
export type StorageType = 'local' | 'icloud' | 'gdrive' | 'custom';
export interface StorageLocation {
  /** 選んだフォルダの絶対パス。この下に TabApp/ を作る。 */
  root: string;
  type: StorageType;
}
export interface StorageSettings {
  storageLocation: StorageLocation;      // 主ストレージ
  mirrorLocations: StorageLocation[];    // ミラー先。0 個以上（14 節）
}
```

- 今のコードは `StorageConfig`（`primaryRoot`・`primaryType`・`mirrors`・`trashRetentionDays`、`packages/core/src/persistence/StorageConfigService.ts`）で、ゴミ箱の保持期間をこの型に持っている。保持期間は 13.3 節のとおり `preferences.json` に置く（2026-10-06 本人決定、honnin-queue 43 番）ので、ここと違う（[[00_reference.md#8.1]] の G74）。
- 起動したとき <!-- req 06:aa5af064.f8f2 -->と、設定ダイアログの保存先のタブを開いたとき <!-- req 06:aa5af064.1d3d -->に、知られているパスの形で同期フォルダの場所を探す。探すのは、iCloud Drive のフォルダ <!-- req 06:aa5af064.decb -->と、Google Drive for Desktop のフォルダ <!-- req 06:aa5af064.bbf9 -->とする。
- 見つかったものを、9 項目目のプルダウンの選択肢に出す。 <!-- req 06:aa5af064.d53d --> 見つからないときも、「カスタムフォルダを選択」で好きなフォルダを決められる。 <!-- req 06:aa5af064.5eb7 --> フォルダを選ぶダイアログは [[web-core-foundation.md#7]] の 7.3 節の (a)。
- (b) 探す処理は `StorageLocationDetector.detectCandidates(): Promise<{ type: 'icloud' | 'gdrive'; path: string }[]>` とする（今のコードと同じ形。今は何も見つけない仮の実装 `NullStorageLocationDetector`）。main が `fs` でフォルダが在るかを見るだけで、クラウドの API は呼ばない（10 節）。
- 同期フォルダの場所は環境によって違うので、1 つのパスの形に決めず、いくつかの形を順に見て、フォルダが在ったものを候補にする（2026-10-06 本人決定、honnin-queue 44 番の #11）。 <!-- req 06:aa5af064.9993 --> (b) 見る形は、基本設計の例にある `%USERPROFILE%\iCloudDrive\`（iCloud Drive）と `%USERPROFILE%\Google Drive\`（Google Drive for Desktop）と、Google Drive for Desktop が割り当てたドライブレターの 3 つとする。基本設計が例として挙げた形をそのまま使い、確かめていない形を書かないため。割り当てたドライブレターの見分け方は、`StorageLocationDetector` を実装するときに Google Drive for Desktop の公式の説明で確かめてから書く（未確認）。
- ミラー先は、主ストレージへの保存が成功するたびに追加の写しを作るフォルダで <!-- req 06:ccaf90c0.2d5b -->、0 個以上決められる。 <!-- req 06:ccaf90c0.a797 --> 動きと組み合わせの決まりは 14 節。

## 12. 保存先の移行（`StorageMigrationService`）

[[../basic_design/06_file_io_persistence.md#2.2]] を受ける。確かめと失敗を知らせるダイアログの出し方は [[screens-navigation.md#13]]。

- アプリが動いている間に、保存先を変えられるようにする。 <!-- req 06:49bd0443.45f6 --> 流れは次のとおり。
  1. 設定ダイアログで新しいフォルダを選ぶと、移している間は編集できないことを書いた Critical のダイアログで確かめる。
  2. 確かめたら、各編集ウィンドウを一時的にロックしてから、`StorageMigrationService.migrate(fromRoot, toRoot, onProgress?)` で、古いフォルダから新しいフォルダへ、13 節で「移す」としたファイルを 1 つずつ写す。
  3. 写すときは、移す先に 15 節と同じ一時ファイルからの改名で書き、書いた後に移す先から読み戻して、古いほうとバイトが全部同じかを確かめる。曲のファイルは、読み戻したものの `integrity.checksum` も確かめる。 <!-- req 06:8fcc5336.7ff4 -->
  4. 全部を写せたら、主ストレージを新しいフォルダに切り替え（13 節の `settings.json` と、ローカル既定パスのポインタを書き換える）、Info で終わりを知らせ、古いフォルダはそのまま残すことを伝える。
  5. 1 つでも失敗したら、Critical で失敗した中身を出し、主ストレージは古いフォルダのままにして切り替えない。
- 移している間は、開いている編集ウィンドウを全部一時的にロックし <!-- req 06:c21b200e.88a4 -->、ロックの間は保存しない。 <!-- req 06:c21b200e.b65b --> (b) ロックの前に、各編集ウィンドウの `AutoSaveScheduler.flush(songId)` の終わりを待ってから、その `AutoSaveScheduler` の保存を止め、編集のコマンドを受け付けないようにする。ロックの前の編集を古いフォルダに書いてから写すため。
- ロックを始めるのは、`FILE-012` の確かめで利用者が移すことを選んだ後とし、上の `flush` を待って保存を止めてから、各編集ウィンドウに覆いを出す。ロックを解くのは、移行が成功したときと失敗したときのどちらでもとする（2026-10-06 本人決定、honnin-queue 47 番）。覆いの形と文は [[screens-navigation.md#7]] の 7.6 節、進み具合（何件中何件）は設定ダイアログに出す（[[screens-navigation.md#12]] の 12.10 節の 9 項目目）。
- (b) 成功したときは、主ストレージを新しいフォルダに切り替えてからロックを解き、そのあとで `FILE-014` を出す。失敗したときは、主ストレージを古いフォルダのままにしてロックを解き、そのあとで `FILE-013` を出す。ロックを解いた後の保存が、切り替えた後の主ストレージにだけ届くようにするため。
- 古いフォルダのファイルは、自動で消さない。 <!-- req 06:1b9db19a.dcdc --> 本人が中身を確かめてから手で片付ける（誤った操作で消えるのを避けるため）。
- (b) 主ストレージを切り替える（ポインタを書く）のは `StorageMigrationService` ではなく、結果（`MigrationResult`）を受けた設定ダイアログの側とする（今のコードの形）。サービスはファイルを写すことだけを受け持ち、切り替えるかの判断を 1 か所に置くため。
- 移す前の確かめは Critical の `FILE-012`、移行の失敗は Critical の `FILE-013`、移行の終わりは Info の `FILE-014` で出す（2026-10-06 チャット側の決定、honnin-queue 46 番。コードの一覧は [[00_reference.md#5]]。基本設計 08 章 1 節の例示には、次の基本設計の直しで足す）。

## 13. アプリの側のファイルの一覧と中身

[[../basic_design/06_file_io_persistence.md#3]] を受ける。2 節の表で、アプリの側に置くものの受け先とした節。

### 13.1 主ストレージの木

- 木のいちばん上は、設定で選んだフォルダ（アクティブなストレージルート）とし <!-- req 06:06c3b4e6.db40 --> <!-- req 06:06c3b4e6.9ad7 -->、ローカル <!-- req 06:06c3b4e6.d0af -->・iCloud Drive <!-- req 06:06c3b4e6.ba88 -->・Google Drive <!-- req 06:06c3b4e6.9308 -->・カスタム <!-- req 06:06c3b4e6.5346 -->のどれでもよい（11 節）。その下に `TabApp/` を作り <!-- req 06:9a4757b9.b507 -->、アプリのファイルは全部この下に置く。

| `TabApp/` の下のパス | 中身 | 保存先の移行（12 節） |
|---|---|---|
| `songs/` <!-- req 06:3dee81f8.eba5 --> | 曲のファイル `{songId}.tabapp` <!-- req 06:3dee81f8.6555 -->。曲一覧のフォルダ分けはサブフォルダ `songs/{フォルダ名}/` で表し <!-- req 06:3dee81f8.e20f -->、フォルダに入れない曲は `songs/` の直下に置く（9.2 節） <!-- req 06:3dee81f8.63cd --> | 移す（サブフォルダごと） |
| `trash/` <!-- req 06:fc588e57.637a --> | ゴミ箱に入れた曲のファイル `{songId}.tabapp` <!-- req 06:fc588e57.31f4 -->。サブフォルダは作らず、元のサブフォルダは `trash-index.json` に書く（17 節） | 移す |
| `trash-index.json` <!-- req 06:921a1d80.e3d9 --> | ゴミ箱の曲ごとの削除日時と元のサブフォルダの索引（17 節） <!-- req 06:921a1d80.fa0b -->。`index.json` と同じく `TabApp/` の直下に置き <!-- req 06:6c325cc9.90b1 -->、`trash/` の下に入れない <!-- req 06:6c325cc9.548f --> | 移す |
| `index.json` <!-- req 06:c959ada3.f9ff --> | 曲一覧の索引（9 節） | 移す |
| `thumbnails/` | 曲一覧のサムネイルの写し `{songId}.png`（9.1 節。2026-10-06 本人決定、honnin-queue 49 番。基本設計 06 章 3 節の木には次の基本設計の直しで足す） | 移す |
| `tuning-presets.json` <!-- req 06:bbe0d95b.e9b4 --> | 利用者が作ったチューニングプリセット（13.4 節） | 移す |
| `tags.json` <!-- req 06:77d4b505.b112 --> | タグの一覧（13.4 節） | 移す |
| `settings.json` | 保存先の設定 `StorageSettings`（11 節）。主ストレージ <!-- req 06:e6f12988.ac29 -->とミラー先 <!-- req 06:e6f12988.ccfb -->を持つ | 移す |
| `preferences.json` | アプリ全体の設定（13.3 節） | 移す <!-- req 06:33b7b621.6fd5 --> |
| `logs/` <!-- req 06:d51fdc7a.eb69 --> | ログ（[[error-logging-foundation.md#2]]） | 移さない <!-- req 06:59c4ed7b.577f --> |

- `logs/` を移さないので、移した後は古い保存先の `logs/` がそのまま残り <!-- req 06:9f20e713.7528 -->、アプリからは追わない。それでよいとする。 <!-- req 06:9f20e713.dd19 --> 移すものを増やすと移行の処理が込み入って失敗しやすくなる一方、ログは個人で使う規模では重要度が低いため（[[../basic_design/13_design_decision_points.md#4]] C14）。
- ログを見る手段は、設定ダイアログの「アプリ情報」タブから OS のエクスプローラーでフォルダを開くボタンだけとし（[[screens-navigation.md#12]] の 12.10 節の 8 項目目） <!-- req 06:35a084ab.35fc -->、アプリの中にログを見る画面は作らない。 <!-- req 06:35a084ab.b1ab -->

### 13.2 ローカル既定パスの木

- ローカル既定パスは、その PC の中の、主ストレージとは別の場所で <!-- req 06:37e25ca7.3ada -->、Electron の `app.getPath('userData')` とする（11 節の (b)）。

| ローカル既定パスの下のパス | 中身 |
|---|---|
| `settings.json` | 主ストレージが決まるまでは設定全体（`StorageSettings`） <!-- req 06:cac1e51b.3830 -->、決まった後は主ストレージの場所を指すポインタ（`StorageRootPointer`：`rootAbsolutePath`・`storageType`）だけ <!-- req 06:cac1e51b.cfef --> |
| `window-bounds.json` | 曲ごとの窓の位置 <!-- req 06:681bf1dd.ceca -->と大きさ <!-- req 06:681bf1dd.1806 -->。曲の `id` ごとに 1 件 <!-- req 06:681bf1dd.f339 --> |
| `export-folders.json` <!-- req 06:15dcf4c3.11d6 --> | 曲ごとに前回書き出したフォルダ。曲の `id` ごとに 1 件 <!-- req 06:15dcf4c3.0977 --> |
| `LocalBackup/` <!-- req 06:37e25ca7.82b5 --> | 保存の直前の 1 世代（20 節の `LocalBackupService`） <!-- req 06:37e25ca7.2026 --> |
| `PreMigration/` <!-- req 06:37e25ca7.26c1 --> | 曲のファイルを新しい版へ変換する前の版。残してから 30 日で消す（8 節） <!-- req 06:37e25ca7.6ddf --> |

- アプリの側に置くファイルは、曲のファイルに入れない情報だけとし <!-- req 06:d6e55354.1587 -->、13.1 節と 13.2 節の 2 つの木に限る。 <!-- req 06:d6e55354.8ec5 --> 足すときは、先に基本設計 06 章 3 節の図に足し、次に本節に足す（2 節の表の決まり）。
- 初めて起動して主ストレージがまだ決まっていないときは、`settings.json` をローカル既定パスに置き <!-- req 06:0f898bd0.1dd8 -->、決まった後は、主ストレージが今どこかを指すポインタだけをローカル既定パスにも写しておく。 <!-- req 06:0f898bd0.0452 --> 同期フォルダの同期が終わる前でも、アプリが自分の設定を見失わないため。
- (b) 主ストレージが決まったと数えるのは、初めての起動で既定のローカルの `TabApp/` を作り終えたときと、12 節の移行で切り替えたときとする。起動のときは、まずローカル既定パスの `settings.json` を読み、ポインタがあればその先を主ストレージとし、無ければ既定のローカルにする。今のコードはポインタを `storage-pointer.json`（`apps/desktop/src/main/ElectronAppLocalConfigService.ts`）に置いていて、ここと違う（G74）。
- 曲ごとの窓の位置 <!-- req 06:a6f7c966.68e7 -->と大きさ <!-- req 06:a6f7c966.a410 -->は、主ストレージではなくローカル既定パスの `window-bounds.json` に、曲の `id` ごとに 1 件置き <!-- req 06:a6f7c966.cafd -->、移行の対象に入れない。 <!-- req 06:a6f7c966.efa4 --> 主ストレージの側の `preferences.json` にも入れない。 <!-- req 06:bfb57938.05b1 --> 窓の位置はその PC の画面の並びによるので、別の PC と分け合うと画面の外に開くことが増えるため。書く時機（窓を閉じたとき）と、画面の外のときに戻すことは [[screens-navigation.md#4]] の 4.2 節。
- 書き出し画面の保存先のフォルダの欄に入れる「その曲で前回書き出したフォルダ」も、主ストレージではなくローカル既定パスの `export-folders.json` に置き <!-- req 06:68f2c751.2040 -->、曲の `id` ごとに 1 件とし <!-- req 06:68f2c751.023d -->、移行の対象に入れない。 <!-- req 06:68f2c751.7b53 --> フォルダのパスはその PC のものなので、別の PC と分け合うと無いフォルダを指すため。覚えていたフォルダが見つからないときに「ドキュメント」フォルダを欄に入れることは、書き出し画面の中身として export-print.md（基本設計 07 章の回）に書く。 <!-- req 06:c466158e.2cc3 -->
- `export-folders.json` は `window-bounds.json` と別のファイルにする。 <!-- req 06:885d05d8.76e2 --> 書く時機（窓を閉じたとき／書き出したとき）が違い、片方の書き込みがもう片方の中身を巻き込まないため。
- (b) 2 つとも、曲の `id` をキーにした 1 つの JSON のオブジェクトとし、`window-bounds.json` の 1 件は `{ x, y, width, height }`（Electron の `BrowserWindow.getBounds()` の形）、`export-folders.json` の 1 件はフォルダの絶対パスの文字列とする。書くときは読んでその曲の 1 件だけを替え、15 節と同じ一時ファイルからの改名で書く。曲をゴミ箱から完全に消したときは、その曲の 1 件を両方から消す。消した曲の記録が残り続けないため。

### 13.3 `preferences.json` の項目

- `preferences.json` はアプリ全体の設定を持ち <!-- req 06:33b7b621.6dfe -->、`AppPreferencesService`（`packages/core/src/ui/AppPreferencesService.ts`）が読み書きする。 <!-- req 06:33b7b621.9705 --> 持つのは次の 4 つのまとまりとする（2026-10-06 本人決定、honnin-queue 43 番）。
  - 設定ダイアログの 1 から 6 項目目 <!-- req 06:33b7b621.bfb6 -->・8 項目目 <!-- req 06:33b7b621.8c43 -->・11 項目目 <!-- req 06:33b7b621.bf39 -->・12 項目目（ゴミ箱の保持期間） <!-- req 06:33b7b621.9070 -->の値
  - 曲一覧の表示方式 <!-- req 06:33b7b621.025e -->
  - 曲一覧の並べ替えのキー <!-- req 06:33b7b621.cb49 -->と向き <!-- req 06:33b7b621.7881 -->（[[screens-navigation.md#6]] の 6.2 節）
  - オンボーディングを見た印 `onboardingSeen` <!-- req 06:33b7b621.3853 -->（[[screens-navigation.md#14]]）
- 設定ダイアログの 7 項目目（タグ）は `tags.json`、9・10 項目目（保存先・ミラー先）は `settings.json`、13 項目目（チューニングプリセット）は `tuning-presets.json` に置き、`preferences.json` には入れない。
- 各項目の値の範囲と既定は、設定ダイアログの各項目（[[screens-navigation.md#12]] の 12.10 節）が正で、本節は置き場所と型を決める。12 項目目の `trashRetentionDays` は、7・14・30・60・90 の 5 つの値のどれかとし、既定は 30 とする（2026-10-06 本人決定、honnin-queue 45 番）。
- (b) 並べ替えは `{ key: SongListSortKey; direction: 'asc' | 'desc' }` の形の 1 つの項目 `songListSort` で持ち、`SongListSortKey` は [[screens-navigation.md#6]] の 6.2 節の 6 つのキーとする。ゴミ箱の保持期間は `trashRetentionDays`（日の数、型は `7 | 14 | 30 | 60 | 90`）で持つ。キーと向きは 2 つそろって 1 つの並べ方を決めるので、別々に書いて片方だけ古い値が残らないため。
- (b) 読んだ `trashRetentionDays` が 5 つの値のどれでもないとき（手で書き換えた、数でない）は、5 つのうちその値を下回らないいちばん小さい値に読み替え、90 を超えるなら 90、数でなければ既定の 30 とする。短いほうへ読み替えると、利用者が思っていたより早く曲が完全に消えるため。
- 読んだファイルに無い項目は、既定の値で補う。古い `preferences.json` もそのまま読めるようにするため。今のコードの `AppPreferences`（`packages/core/src/ui/types.ts`）は、ゴミ箱の保持期間と並べ替えのキーと向きを持たない（G74）。

### 13.4 `tags.json` と `tuning-presets.json`

- `tags.json` は、タグの一覧 `Tag[]`（`{ id: string; name: string }`）を持つ。タグの数の上限 50 の確かめは 6.3 節。曲に付けたタグは曲のファイルの `appMeta.tags`（6.3 節）で、タグを消したときに曲から外す処理は [[screens-navigation.md#12]] の 12.10 節の 7 項目目。
- `tuning-presets.json` は、利用者が作ったチューニングプリセットだけを持つ（組み込みは同梱し、このファイルに入れない、[[part-tuning-management.md#3]] の 3.3 節）。1 件は [[part-tuning-management.md#3]] の `TuningPreset` に、消した印の 2 つの項目（省いてよい）を足した形とする。今のコードは、この 2 つを `TuningPreset` の型そのものに持たせている（`packages/core/src/domain/types.ts`）。

```ts
export interface StoredTuningPreset extends TuningPreset {
  /** 消した（論理削除した）なら true。 */
  isDeleted?: boolean;
  /** 消した日時（ISO 8601）。isDeleted のときだけ持つ。 */
  deletedAt?: string;
}
```

- 利用者のプリセットを消すときは、ファイルから消さずに `isDeleted` を立てて `deletedAt` を書く（[[../basic_design/13_design_decision_points.md#3]] B27 の (c)）。消した直後の「元に戻す」は、この 2 つを外して戻す。プリセットの一覧を返すときは、消した印のあるものをいつも除く。
- 消した印のあるものは、消してから 7 日を過ぎたとき、または消した印のあるものが 20 件を超えたときに古いものから、どちらか早いほうでファイルから消す（B27）。(b) 消すのはアプリの起動のときに 1 回とし、ゴミ箱の期限を過ぎた曲を消す時機（17 節）にそろえる。消したものがファイルに溜まり続けないため。
- 消す・戻すの操作（`TuningPresetService` のメソッド）と画面は [[part-tuning-management.md#3]] と [[screens-navigation.md#12]] の 12.10 節の 13 項目目。

## 14. ミラー（`MirrorSyncService`）

[[../basic_design/06_file_io_persistence.md#4]] を受ける。設定ダイアログの 10 項目目の画面は [[screens-navigation.md#12]] の 12.10 節。

### 14.1 動き

- 主ストレージへのアトミックな書き込み（15 節）が成功した後に <!-- req 06:095bb07f.4306 -->、設定したミラー先のフォルダそれぞれへ、同じ中身を写す。 <!-- req 06:095bb07f.70fc --> 写しは非同期で行い <!-- req 06:095bb07f.4b20 -->、できるかぎり行うが、失敗してもよい（ベストエフォート）。 <!-- req 06:095bb07f.5551 --> ミラーは保険で、主の保存を犠牲にしないため。
- ミラー先への書き込みの失敗は、Warning の `FILE-005` を出してログに書き <!-- req 06:4d49e53d.21b6 -->、主ストレージへの保存は止めない。 <!-- req 06:4d49e53d.5d4b -->

```ts
export class MirrorSyncService {
  constructor(sourceAdapter: FileSystemAdapter, adapterFactory: FileSystemAdapterFactory);
  /** 待たずに写しを始める。失敗は中で受けて FILE-005 を出し、外へ投げない。 */
  syncAfterSave(songId: string, mirrorRoots: string[]): void;
  /** 進んでいる写しが全部終わるか、timeoutMs が過ぎるまで待つ。過ぎても投げず、終われば true、過ぎたら false で解決する。 */
  awaitPending(timeoutMs?: number): Promise<boolean>;   // 既定は MIRROR_AWAIT_PENDING_TIMEOUT_MS（15000）
}
```

- (b) 写すのは、保存した曲のファイル（`songs/{サブフォルダ/}{id}.tabapp`）を、ミラー先の `TabApp/` の下の同じ相対パスへ写すことと、`index.json` を写すことの 2 つとする。どちらも一時ファイルからの改名で書く。ミラー先から曲のファイルを消す処理は持たない（ゴミ箱へ入れても、ミラー先の曲は残す）。ミラーは主ストレージで誤って消したときの保険でもあるため。
- (b) `syncAfterSave` は `AutoSaveScheduler` の `onSaved`（15 節）でつなぎ、`SongRepository` には `MirrorSyncService` を渡さない（今のコードの形）。保存の処理がミラーを待たない作りを、呼ぶ所が 1 つであることで守るため。
- 編集ウィンドウを閉じるときは、その曲の `AutoSaveScheduler.flush(songId)` の終わりを待ってから閉じ（15 節）、最後のウィンドウが閉じた後に `awaitPending()` で進んでいる写しの終わりを待つ。待つのは既定で 15 秒までで、過ぎたら Warning をログに書いて終える（`awaitPending` が `false` を返したら、呼んだ main の終了の処理がログに書く。[[screens-navigation.md#4]] の 4.4 節、[[../basic_design/13_design_decision_points.md#3]] B26）。このログは Warning の `FILE-015` とし、画面に出さずログにだけ書く（2026-10-06 チャット側の決定、honnin-queue 46 番）。
- (b) 15 秒は `MIRROR_AWAIT_PENDING_TIMEOUT_MS`（`packages/core/src/persistence/constants.ts`）に持ち、`awaitPending` の引数を省いたときに使う。待つ時間を 1 か所で変えられるようにするため。

### 14.2 組み合わせ

| 組み合わせ | 扱い |
|---|---|
| 主＝ローカルだけ（ミラーなし） | できる。既定 <!-- req 06:2d4a9284.6133 --> |
| 主＝iCloud Drive のフォルダ | できる <!-- req 06:43ee296a.5be4 -->。Windows 版 iCloud が要る <!-- req 06:43ee296a.4b23 --> |
| 主＝Google Drive のフォルダ | できる <!-- req 06:1cfbbc69.a82e -->。Google Drive for Desktop が要る <!-- req 06:1cfbbc69.7a5c --> |
| 主＝ローカル＋ミラー＝iCloud Drive | できる。勧める構成の 1 つ <!-- req 06:ef4441bf.4b9d -->。ふだんの読み書きはローカルで速く確かにし、クラウドへの保管は保険として非同期で行う <!-- req 06:ef4441bf.647c --> |
| 主＝ローカル＋ミラー＝iCloud Drive＋ミラー＝Google Drive | できる <!-- req 06:2f50d3b9.9dff -->。ミラー先は複数決められる <!-- req 06:2f50d3b9.5ccc --> |
| 主＝iCloud Drive＋ミラー＝Google Drive | できるが冗長 <!-- req 06:be39c62f.5c38 -->。設定ダイアログでこの組み合わせを選んだら、参考として Info で知らせる <!-- req 06:be39c62f.05e3 --> |
| 同じフォルダを主ストレージとミラー先の両方にする | できない。確かめで止める <!-- req 06:7b635e0c.2464 -->。書き込みが二重になって食い違うおそれがあるため <!-- req 06:7b635e0c.842f --> |
| 1 つのフォルダを iCloud Drive と Google Drive の両方の同期の対象にする | できない（OS と同期クライアントの制約） <!-- req 06:cfe4f383.a89e -->。両方のクラウドに置きたいときは、別々のフォルダをそれぞれの同期の対象にし <!-- req 06:cfe4f383.92df -->、ミラーで使い分ける <!-- req 06:cfe4f383.0b6e -->。設定ダイアログで iCloud Drive 用と Google Drive 用に同じパスを選ぼうとしたら Error を出す <!-- req 06:cfe4f383.1b4c --> |

- (b) 確かめは `StorageConfigService.validateMirrorConfig(settings: StorageSettings): ValidationResult` とし、`ValidationResult` は `{ ok: boolean; errors: string[]; infos: string[] }` とする。止める 2 つ（主とミラー先が同じフォルダ、iCloud Drive と Google Drive に同じパス）と、ミラー先どうしが同じフォルダのときを `errors` に入れて `ok` を `false` にし、冗長の組み合わせは止めないので `infos` に入れる。止めるものと知らせるだけのものを、呼ぶ側が分けて出せるようにするため。今のコードの `ValidationResult` は `infos` を持たない（G74）。
- (b) 同じフォルダかは、パスの末尾の区切りを除き、大文字と小文字を区別せずに比べる（Windows のファイルシステムの比べ方に合わせる）。
- 同じフォルダを主ストレージとミラー先の両方にしたときは Error の `FILE-009`、iCloud Drive 用と Google Drive 用に同じパスを選んだときは Error の `FILE-010`、冗長の組み合わせは Info の `FILE-011` で出す（2026-10-06 チャット側の決定、honnin-queue 46 番）。
- (b) ミラー先どうしが同じフォルダのときも `FILE-009` とする。どちらも「同じフォルダへ二重に書く」という 1 つの発生条件で、採番規則 (2)（[[00_reference.md#5]]）の 1 つの条件に当たるため。`ValidationResult` の `errors` と `infos` には、コードの文字列（`'FILE-009'` の形）を入れ、呼ぶ側はそれを `NotificationCenter.report` に渡す。
- 設定ダイアログでの見せ方は [[screens-navigation.md#13]] の 13.1 節の、譜面の小節を指せない Error の形（入力欄を赤枠にしてメッセージを添える）とする。

### 14.3 複数の PC で同時に編集したときの限界

- 本設計は、1 つの曲を書くのは 1 か所だけという前提（単一ライター）とする。 <!-- req 06:66848e23.04ab --> 同じ PC の中で同じ曲を二重に開かないことは [[screens-navigation.md#4]] の 4.1 節で守るが、別の PC からの同時の編集の食い違いは、見つけも直しもしない。 <!-- req 06:66848e23.be14 --> 同期フォルダを複数の PC で分け合い、同時に同じ曲を編集すると、同期クライアントが競合のコピー（例：「ファイル名 (競合版).tabapp」）を作ることがある。
- 将来の iPhone 版との併用で表に出る話は、[[../basic_design/10_extensibility_future.md]] を受ける回（基本設計 10 章の回）に書く。

## 15. 自動保存とアトミックな書き込み（`AutoSaveScheduler`・`SongRepository`）

[[../basic_design/06_file_io_persistence.md#5]] を受ける。

- 自動保存は、編集が止まってから 2 秒で保存する。編集が続いていても、最後の保存から 10 秒たったら、止まるのを待たずに保存する（2026-10-06 本人決定、honnin-queue 42 番）。(b) 2 秒は `AUTOSAVE_DEBOUNCE_MS`、10 秒は `AUTOSAVE_MAX_DELAY_MS`（`packages/core/src/persistence/constants.ts`）に持つ。まだ一度も保存していない曲では、10 秒は最初の未保存の編集から数える。今のコードの `AUTOSAVE_DEBOUNCE_MS` は 3000 で、ここと違う（G74）。
- 保存の流れは次のとおり。
  1. 編集のコマンドが `AutoSaveScheduler.notifyDirty(songId)` を呼ぶ。
  2. 上の秒数を待って、`SongRepository.save(document)` を呼ぶ。
  3. `save` は、`integrity.checksum` を作ってファイルの中身に入れ（7 節） <!-- req 06:8fcc5336.68c1 --> <!-- req 06:8fcc5336.5ff4 -->、`LocalBackupService.rotate(songId)` で今の本ファイルを 1 世代だけ退かし（20 節）、一時ファイル `songs/{サブフォルダ/}{id}.tabapp.tmp` に書く。 <!-- req 06:bdfb1065.30ec -->
  4. 書き終えたら、`rename` で本ファイル `songs/{サブフォルダ/}{id}.tabapp` へアトミックに置き換える。 <!-- req 06:bdfb1065.11b5 -->
  5. `index.json` の 1 件を直す（9.1 節）。
  6. `AutoSaveScheduler` の `onSaved` が、ミラーの写し（14 節）とサムネイルの作り直し（9.1 節）を待たずに始める。
- (b) 3 の一時ファイルは、main が書いた後に Node.js の `FileHandle.sync()`（`fs/promises`、`@types/node` 24 の型定義にある `sync(): Promise<void>`）でディスクへ書き出してから閉じ、そのあとで 4 の改名をする。基本設計の図の「fsync→rename」のとおり、改名の前に中身がディスクにあることを確かにして、落ちたときに中身の無い本ファイルが残らないため。今のコードの `ElectronFileSystemAdapter` は書き出しをしていない（G74）。
- (b) サブフォルダは `index.json` の `folder`（9 節）で決め、`folder` が空の文字列なら `songs/` の直下とする。今のコードはパスを `songs/{id}.tabapp` に固定していて（`packages/core/src/persistence/paths.ts`）、サブフォルダを見ない（G74）。
- 保存が失敗したら、1 秒・3 秒・9 秒の間を空けて 3 回まで書き直し、それでも失敗したら Error の `FILE-001` を出す（今のコードの `AUTOSAVE_RETRY_DELAYS_MS`）。保存が終わったことはトーストで知らせず、ツールバーの保存ボタンで見せる（[[screens-navigation.md#7]]）。
- 強制終了で `{id}.tabapp.tmp` が残っていても、本ファイルは改名の前の完全な版のままなので、読むときは本ファイルだけを見て `.tmp` は使わない。 <!-- req 06:077979f5.bffb --> 起動のときに `.tmp` を掃除しない。 <!-- req 06:077979f5.1851 --> 保存先が同期フォルダのとき、別の PC が書いている途中の `.tmp` を消すおそれがあるため。残った `.tmp` は、次に同じ曲を保存するときに上書きされる。
- 曲を読むとき（`SongRepository.load(songId)`）は、本ファイルを読み（同期フォルダの待ちは 16 節）、形を確かめ（8 節の `FILE-008`）、`integrity.checksum` を確かめてから <!-- req 06:8fcc5336.589c -->版を移し（8 節）、曲をメモリに広げる。チェックサムが合わなければ Critical の `FILE-002` を出し、`LocalBackupService.restore(songId)`（20 節）で戻すかを聞く。移行のときに確かめることは 12 節。
- `flush(songId)` は、未保存の編集があれば待たずに保存し、保存（書き直しを含む）が終わるまで待つ。保存の途中で呼ばれたら、その保存が終わった後に、まだ未保存の編集があればもう 1 回保存してから終える。編集ウィンドウを閉じるときと、移行のロックの前（12 節）に呼ぶ。閉じるときの順は [[screens-navigation.md#4]] の 4.4 節。

## 16. 同期フォルダの読み込みの待ち

[[../basic_design/06_file_io_persistence.md#6]] を受ける。

- iCloud Drive と Google Drive for Desktop は、どちらも、PC の中に中身の無い「プレースホルダーファイル」を置いた状態になることがある。読むときに中身が届くのを待つ読み直しを挟む。 <!-- req 06:a6c46b3f.8633 --> 2 つのサービスに共通の処理として、保存先の種類によらず同じにする。
- (b) 読み直しは main の `ElectronFileSystemAdapter.readFile` の中で行い、`FileSystemAdapter` の口には出さない（呼ぶ側はふつうの `readFile` として扱える）。空のデータが返ったら、200ms・400ms・800ms・1600ms・3200ms の間を空けて 5 回まで読み直す（今のコードの `ONDEMAND_RETRY_BACKOFF_MS`、`apps/desktop/src/main/onDemandRetry.ts`）。それでも空なら Error の `FILE-003` を出す。回数と間隔は、Phase 1 の実機の確かめ（[[../basic_design/13_design_decision_points.md#2]] A5）で直せるように定数に持つ。
- 同期フォルダへそもそも読み書きできるかは Phase 0 で確かめ <!-- req 06:9bcdc4ee.0869 -->、Windows 版 iCloud の `fs` での読み書きの安定は Phase 1 の前半で確かめる。Google Drive for Desktop も、Phase 1 の前半から中盤に同じ確かめをする。 <!-- req 06:9bcdc4ee.0759 --> 確かめの手順は、基本設計 11 章の回に書く。
- アプリ自身はクラウドの API を呼ばずにローカルの `fs` だけを使うので、保存先の種類によらず完全オフラインで動く（10 節）。ただし、同期が終わっていないファイルをオフラインで開くと、上の読み直しが尽きて `FILE-003` になる。データを守るうえでの注意として残る。

## 17. ゴミ箱（`TrashService`）

[[../basic_design/06_file_io_persistence.md#7]] を受ける。ゴミ箱ダイアログは [[screens-navigation.md#12]] の 12.8 節。

```ts
export interface TrashEntry {
  songId: string;
  /** ゴミ箱に入れた日時（ISO 8601）。5 節の trashedAt はこの値（今のコードの名前に合わせて deletedAt とする）。 */
  deletedAt: string;
  /** 元のサブフォルダ（SongSummary.folder と同じ形。songs/ の直下なら空の文字列）。 */
  folder: string;
}
export class TrashService {
  moveToTrash(songId: string): Promise<void>;
  restore(songId: string): Promise<void>;
  permanentlyDelete(songId: string): Promise<void>;
  /** 保持期間を過ぎた曲を消し、消した数を返す。 */
  purgeExpired(retentionDays: number): Promise<number>;
  /** 完全に消すまでの残りが thresholdDays 日以下の曲の id を返す。 */
  findExpiringSoon(retentionDays: number, thresholdDays: number): Promise<string[]>;
  /** ゴミ箱の曲の一覧（trash-index.json の中身）。ここに在る曲が 5 節の isTrashed の真の曲。 */
  listTrashed(): Promise<TrashEntry[]>;
}
```

- 入れるときは、`songs/{サブフォルダ/}{id}.tabapp` を `trash/{id}.tabapp` へ移し <!-- req 06:64bb992d.ff15 -->、`trash-index.json` に削除日時と元のサブフォルダを書く。 <!-- req 06:64bb992d.c10a --> そのあと `index.json` からその曲を消す（9.1 節）。入口は曲一覧の右クリックの「ゴミ箱へ移動」（[[screens-navigation.md#6]] の 6.3 節）。
- 戻すときは、ゴミ箱の一覧から選んで、`trash/` から `songs/` の元のサブフォルダへ戻す。元のサブフォルダが無くなっていれば `songs/` の直下へ戻す。 <!-- req 06:25e349ed.f76a --> `index.json` も直す。 <!-- req 06:25e349ed.f1c1 --> (b) 戻す先に同じ `id` の曲が既にあるとき（19 節の取り込みで同じ `id` の曲が入ったとき）は、戻す曲に新しい `id` を付けて戻す。どちらの曲も消さずに残すため。
- 保持期間は 30 日に決めてあり <!-- req 06:0437a96c.7ae6 -->、設定ダイアログの 12 項目目で変えられる値として `preferences.json` の `trashRetentionDays` に持つ（13.3 節）。 <!-- req 06:0437a96c.5b16 -->
- 保持期間を過ぎた曲は、アプリの起動のときの裏の処理で完全に消す（`purgeExpired`）。 <!-- req 06:e5462edd.21f2 --> ゴミ箱の画面から、すぐに完全に消すこともできる（`permanentlyDelete`）。 <!-- req 06:e5462edd.49be --> (b) 完全に消すときは、曲のファイルと `trash-index.json` の 1 件に加えて、サムネイルの写し `thumbnails/{songId}.png`（9.1 節）と、13.2 節の 2 つのファイルのその曲の 1 件を消す。同じ `id` の曲が `songs/` にあるときの例外は 19 節。
- 復元できる残りが 3 日以下の曲があれば、Warning の `FILE-007` で知らせる。 <!-- req 06:296a36be.896b --> 知らせるのは、アプリの起動ごとに 1 回までとする。 <!-- req 06:296a36be.fe8e --> (b) 起動のときに `purgeExpired` の後で `findExpiringSoon(retentionDays, TRASH_EXPIRY_WARNING_DAYS)`（`TRASH_EXPIRY_WARNING_DAYS` = 3）を 1 回だけ呼び、1 件以上なら `report('FILE-007', { count })` を出す（`count` は返った id の数）。起動の処理の中で 1 回だけ呼ぶことで、起動ごとに 1 回までを守る。
- (b) 完全に消す時刻は「削除日時 ＋ 保持期間の日数 × 24 時間」とし、残りはその時刻から今を引いた長さで比べる（残りが 3 × 24 時間以下なら知らせる、0 以下なら消す）。ゴミ箱ダイアログの各行に出す残りの日数（[[screens-navigation.md#12]] の 12.8 節）は、残りの長さを 24 時間で割って切り上げた数とする。日付の変わり目やタイムゾーンで数え方が揺れないため。
- (b) 保持期間を短く変えたときは、次の起動の `purgeExpired` で、新しい保持期間で数えて過ぎた曲を消す。変えた日数で数え直すと決めておけば、変えたときに何が消えるかが設定の値だけで決まるため。
- 今のコードの `TrashEntry`（`packages/core/src/persistence/TrashService.ts`）は `folder` を持たず、`TrashService` に `findExpiringSoon` が無い（G74）。

## 18. 曲の複製

[[../basic_design/06_file_io_persistence.md#10.1]] を受ける。入口は曲一覧の右クリックの「複製」（[[screens-navigation.md#6]] の 6.3 節）。

- 要件が認めた「ファイルのコピーだけ」の範囲で、複製の導線だけを用意する。 <!-- req 06:b88370be.b266 --> <!-- req 06:4517acaa.56a7 --> 版を管理する仕組みや、どの曲から複製したかの記録は持たない。 <!-- req 06:1bb536db.219b -->
- (b) 処理は `SongRepository.duplicate(songId): Promise<SongDocument>` とする。曲を作る処理（`create`）と同じクラスに置き、曲のファイルの読み書きを 1 つのクラスにまとめるため。
- `songs/{元id}.tabapp` を読み、新しい `id` を作って `songs/{新id}.tabapp` として書く。 <!-- req 06:567adeea.1b23 --> 書き込みは 15 節のアトミックな書き込みを使う。 <!-- req 06:567adeea.401b --> 複製は、元の曲と同じサブフォルダに置き、`SongSummary.folder` も元の曲の値を引き継ぐ（2026-10-06 本人決定、honnin-queue 48 番の (1)）。元の曲が `songs/` の直下なら、複製も直下に置く。
- 書き換える値：`id` は新しく作る（5 節と同じ作り方）。 <!-- req 06:72e43ae4.fd5e --> `title` は「<元の曲名> のコピー」とし、同じ名前の曲が既にあれば「<元の曲名> のコピー 2」「<元の曲名> のコピー 3」と、空いているいちばん小さい数を足す（2026-10-06 本人決定、honnin-queue 40 番）。 <!-- req 06:72e43ae4.b43a --> `createdAt` は複製した時刻にする。 <!-- req 06:72e43ae4.fc13 -->
- (b) 同じ名前があるかは `index.json` の `title` だけで調べ、曲のファイルは開かない。ゴミ箱の曲の名前は数えない。曲一覧に並ぶ名前どうしを重ならないようにするのが目的で、曲一覧に出るのは `songs/` の曲だけのため。
- `song` の本体 <!-- req 06:72e43ae4.d219 -->と `appMeta`（6 節の 5 つの項目の全部） <!-- req 06:72e43ae4.cac8 -->は、そのまま引き継ぐ。
- `index.json` に新しい `SongSummary` を足す。経路は 9.1 節の差分の更新と同じものを使う。 <!-- req 06:7575aed2.a6cb -->
- サムネイルは、元の曲のものをそのまま引き継ぎ、作り直さない（中身が同じため）。 <!-- req 06:25e02b9b.11af -->
- 曲の数の上限 1000（要件 5.3）の確かめの対象に入れ <!-- req 06:952d0ee6.dbc7 -->、上限に達していれば複製を拒み、`SONG-002` を出す。 <!-- req 06:952d0ee6.c39e --> 見せ方は [[screens-navigation.md#2]]。
- 複製した後の保存は、14 節のミラーの対象に入れる。 <!-- req 06:7289c266.2dfb --> (b) 複製は `AutoSaveScheduler` を通らないので、`SongRepository.duplicate` が終わった後に、それを呼んだ曲一覧の「複製」の処理が `MirrorSyncService.syncAfterSave(新id, mirrorRoots)` を呼ぶ。`SongRepository` に `MirrorSyncService` を渡さない 14.1 節の形を保ったまま、複製の曲のファイルと `index.json` をミラー先へ写すため。

## 19. ファイルの関連付けと取り込み

[[../basic_design/06_file_io_persistence.md#11]] を受ける。

- `.tabapp` の拡張子を OS の関連付けに登録し <!-- req 06:115fcafb.a9f9 --> <!-- req 06:4d8dfec1.15e3 -->、エクスプローラーでダブルクリックすると、その曲の編集ウィンドウを開く。 <!-- req 06:115fcafb.efa1 --> <!-- req 06:4d8dfec1.bdf9 --> もう開いていれば前に出す。これは曲一覧から開くときと同じ処理を使う（[[screens-navigation.md#4]] の 4.1 節）。 <!-- req 06:115fcafb.58be -->
- (b) 登録は、Electron Builder の設定ファイルの、ファイルの関連付けの項目で行う（[[web-core-foundation.md#8]] の 8.4 節。設定ファイルの名前と項目の名前は、Electron Builder を足すときに公式の説明で確かめてから書く）。ビルドと配布の手順を設定ファイルだけで済ませる決まり（同じ 8.4 節）に合わせるため。
- 関連付けるのは `.tabapp`（曲のファイル）だけとする。 <!-- req 06:4d8dfec1.7d61 --> 書き出したファイルは関連付けず、OS の既定のアプリで開かれるままにする。alphaTex <!-- req 06:4d8dfec1.4222 -->も MIDI <!-- req 06:4d8dfec1.97c2 -->も PDF <!-- req 06:4d8dfec1.9674 -->も同じとする。
- ダブルクリックで起動したときは、main が起動の引数（`process.argv`）から `.tabapp` のパスを取り出す。 <!-- req 06:06d1175f.8332 --> もう起動しているときは、単一インスタンスのロック（`app.requestSingleInstanceLock()`）で 2 つ目の起動を止め <!-- req 06:06d1175f.6fbe -->、`second-instance` のイベントで届いた `argv` からパスを取り出す。 <!-- req 06:06d1175f.3717 --> 取り出したパスの曲を、曲一覧から開くときと同じ `WindowAdapter.focusExistingWindow`・`openEditWindow`（[[screens-navigation.md#4]] の 4.3 節）で開く。 <!-- req 06:06d1175f.ed88 --> 基本設計 06 章 8 節と 11 節の `openSongWindow` は、この 2 つのメソッドで開く処理を指す。
- (b) `argv` のうち、末尾が `.tabapp`（大文字と小文字を区別しない）で、ファイルとして在るものを使う。いくつもあれば、それぞれを開く。Electron の型定義の `open-file` の説明（Windows では main で `process.argv` を読む）のとおり、Windows では引数でしかパスが届かないため。今のコードの `second-instance`（`apps/desktop/src/main/main.ts`）は前のウィンドウを前に出すだけで `argv` を見ない（[[00_reference.md#8.1]] の G38）。
- パスが保存先の `songs/` の外にあるときは、`songs/` に写してから <!-- req 06:06d1175f.546a -->開く。 <!-- req 06:06d1175f.4a2a --> 曲一覧は `songs/` の中身を出す作りなので、外のファイルをその場で開くと、曲一覧に出てこない曲ができるため。(b) 写す前に 8 節と 15 節の確かめで曲のファイルとして読めるかを見て、読めなければ写さずに開かず、そのコード（`FILE-008`・`FILE-002`・`FILE-004`）を出す。写す先は `songs/` の直下とし、写したら `index.json` に 1 件を足す（9.1 節）。曲が 1 つ増えるときは、曲の数の上限 1000 を確かめ、上限なら写さずに `SONG-002` を出す。
- 同じ曲（同じ `id`）が `songs/` に既にあるときは <!-- req 06:06d1175f.8393 -->、「上書きする」「別の曲として取り込む」「やめる」を選ぶダイアログを出し、両方の更新日時を並べて見せる（2026-10-06 本人決定、honnin-queue 41 番。ダイアログの形は [[screens-navigation.md#12]] の 12.12 節）。
  - 上書きする：いまの曲は消さずにゴミ箱へ移してから（17 節）、取り込む曲を同じ `id` で写す。間違えても、保持期間の間は戻せる。(b) ゴミ箱へ移すいまの曲には新しい `id` を付けてから移す。ゴミ箱と `songs/` に同じ `id` が並ぶと、戻すときにぶつかるため。
  - 別の曲として取り込む：新しい `id` を付けて写す。曲名は、同じ名前の曲があれば 18 節の決まり（「<曲名> のコピー」と空いている数）で重ならないようにする。
  - やめる：写さず、開かない。
- 取り込む曲と同じ `id` の曲がゴミ箱にだけあるとき（`songs/` には無いとき）は、ダイアログを出さずに、同じ `id` のまま取り込む。ゴミ箱の曲は、戻すときに 17 節のとおり新しい `id` を付けて戻す（2026-10-06 本人決定、honnin-queue 48 番の (2)）。
- (b) `songs/` と `trash/` に同じ `id` の曲が並ぶ間、曲一覧と `index.json` は `songs/` の曲を指し、ゴミ箱ダイアログは `trash-index.json` の曲を指す。ゴミ箱の曲を完全に消すときは `trash/{id}.tabapp` と `trash-index.json` の 1 件だけを消し、`window-bounds.json`・`export-folders.json` の 1 件（13.2 節）とサムネイルの写し（9.1 節）は、同じ `id` の曲が `songs/` にあれば消さない。どれも `songs/` の曲のものになっているため。

## 20. データ保護（`LocalBackupService`・暗号化しない・アンインストールで残す）

[[../basic_design/06_file_io_persistence.md#12]] を受ける。

| 守るもの | 手段 |
|---|---|
| 保存の途中で落ちたときの壊れ | 15 節のアトミックな書き込み |
| 誤って消したとき | 17 節のゴミ箱 |
| アプリやレンダラーが落ちたとき | 基本設計 06 章 9 節の自動の立ち直り（[[error-logging-foundation.md#2]] の 2.3 節と [[error-logging-foundation.md#3]] の 3.2 節） <!-- req 06:a8c93d72.13c4 --> |
| 1 つの保存先が壊れた・無くなったとき | 14 節のミラー |
| 機種の変更・端末をなくしたとき | 主ストレージに同期フォルダを選んでいれば、その同期がバックアップの代わりになる |
| 保存の直前の状態へ戻すとき | 下の `LocalBackupService` |

- 保存のたびに過去の版を溜めて、あとから好きな時点へ戻せる、利用者が操作する世代のバックアップの機能は作らない。 <!-- req 06:e61bd9cc.31c7 --> 戻したい場面は、ゴミ箱と、保存の直前の状態へ戻すことの 2 つで足りているため。
- アプリとしての暗号化はしない。 <!-- req 06:ddc0f209.0fc5 --> ファイルの保護は、OS のユーザーアカウント <!-- req 06:ddc0f209.c695 -->・ファイルの権限 <!-- req 06:ddc0f209.6d36 -->・ディスクの暗号化（BitLocker） <!-- req 06:ddc0f209.0dfa -->に任せる。保存先に同期フォルダを選んだときも、アプリの側で暗号化を足さない。 <!-- req 06:ddc0f209.a9e0 -->
- 保存した曲のデータは、アプリをアンインストールしても端末に残す。 <!-- req 06:7bf34884.d8f2 --> 既定の主ストレージ（11 節の `userData` の下）は、インストーラの既定の動きのままだとアンインストールで消されうるので、配布のパッケージの設定で、データのフォルダを消す対象から外す。 <!-- req 06:7bf34884.c6fa --> (b) 外す設定は Electron Builder の設定ファイルに書く（[[web-core-foundation.md#8]] の 8.4 節）。項目の名前は、Electron Builder を足すときに型定義で確かめてから書く（未確認）。
- 主ストレージに同期フォルダかカスタムのフォルダを選んでいるときは、アプリが管理するフォルダの外なので、消す対象から外す設定の対象にせず、もともとアンインストールの影響を受けない。 <!-- req 06:7bf34884.ebdb --> アプリの本体・キャッシュ・ログは、アンインストールで消してよい。 <!-- req 06:7bf34884.8e36 -->

### 20.1 `LocalBackupService`

```ts
export class LocalBackupService {
  /** 保存の直前に、今の本ファイルを 1 世代だけ退かす。本ファイルが無ければ何もしない。 */
  rotate(songId: string): Promise<void>;
  /** 退かした版を読んで返す。無ければ null。 */
  restore(songId: string): Promise<SongDocument | null>;
}
```

- `LocalBackupService` は、曲を保存するときに、その PC のローカルに 1 世代ぶんの写しを持つ。 <!-- req 06:663f1aa9.0ba2 --> 利用者が意識して使う世代のバックアップではなく、`SongRepository.save()` の中だけで使う、外に出さない作りの上の安全網とする（[[../basic_design/13_design_decision_points.md#3]] B25）。 <!-- req 06:663f1aa9.0b37 -->
- 写しは、主ストレージ・ミラー先とは別の、ローカル既定パスの `LocalBackup/`（13.2 節）にだけ置く。 <!-- req 06:663f1aa9.1938 --> 複数の PC の同期の対象に入れないので、複数の PC で使う構成に影響しない。
- `rotate` が失敗しても、主の保存は続ける（写しの失敗で保存の全体を失敗させない）。`restore` は、`FILE-002`（チェックサムが合わない）と `FILE-008`（壊れたファイル）のダイアログで「戻す」を選んだときに使う。
