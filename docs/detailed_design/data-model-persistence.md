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
| 曲のファイルに入れるもの | [[../basic_design/02_data_model.md#4.1]] の `appMeta` の一覧 | 本書の 6 節（`appMeta` の中身）と 7 節（曲のファイルの形と `integrity`）。`AppMetadata` の項目は `appMeta` の一覧と 1 対 1 にする |
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

## 6. appMeta の中身

曲のファイルの `appMeta` は、曲のファイルのうち `Score` の外に置く情報で <!-- req 02:1bcf1b71.c483 -->、`tags`（曲に付けたタグ） <!-- req 02:1bcf1b71.9ff1 -->・`memos`（小節メモ） <!-- req 02:1bcf1b71.a925 -->・`sectionMarkers`（セクションマーカー） <!-- req 02:1bcf1b71.a718 -->・`settings`（曲ごとの表示の設定） <!-- req 02:1bcf1b71.6355 -->・`thumbnail`（曲一覧のサムネイル） <!-- req 02:1bcf1b71.3b2f -->の 5 つに限り、これ以外の項目を足さない。 <!-- req 02:1bcf1b71.14d6 --> 曲のファイルに入れる情報の一覧は [[../basic_design/02_data_model.md#4.1]] の 1 か所だけが正で、本節は一覧を写さずに各項目の形だけを書く。 <!-- req 02:dd2b82cc.5836 --> 項目を足すときは、まず基本設計の一覧に足し、8 節の決まり（新しい項目は省いてよく、読むときに既定の値で補う）に従う。6.1 節から 6.5 節の型は今のコード（`packages/core/src/domain/types.ts`）の形。

### 6.1 セクションマーカー（`sectionMarkers`）

[[../basic_design/02_data_model.md#3.5]] を受ける。

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

[[../basic_design/02_data_model.md#3.6]] を受ける。

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
- 100 文字を超えても入力は止めず、Warning（`EDIT-004`）を出す。 <!-- req 02:06c207e3.26fb --> そのメモを保存するときに、先頭の 100 文字へ切り詰める（[[../basic_design/13_design_decision_points.md#4]] C13）。 <!-- req 02:06c207e3.6f88 -->
- 100 文字を超えるメモを含む古いファイルを開いたときは、切り詰めずにそのまま見せる。 <!-- req 02:72a539e5.b139 --> そのメモを入力・編集して保存したときにだけ、そのメモを切り詰める。 <!-- req 02:72a539e5.b4e2 --> それ以外の保存では、そのメモの中身に触れない。 <!-- req 02:31cba116.4d92 -->
- メモを足すコマンドは `AddMemoCommand` <!-- req 02:4195e21c.b0a5 -->、変えるコマンドは `EditMemoCommand` <!-- req 02:4195e21c.5849 -->、消すコマンドは `DeleteMemoCommand` とする。 <!-- req 02:4195e21c.f020 --> 3 つとも今のコード（`packages/core/src/editing/commands/memoCommands.ts`）にある。

### 6.3 曲に付けたタグ（`tags`）

- 曲に付けたタグは `TagRef[]`（`{ tagId: string }` の並び）で持つ。タグの一覧そのものはアプリの側の `tags.json` に置く（基本設計 06 章の回）。曲とタグの関係は 5 節の `tags` の項目のとおり。
- タグの総数の上限は 50 とし、タグを作る操作で、作る前に確かめる（超えたら `TAG-001`、Error）。 <!-- req 02:932d8df0.aa59 --> 確かめる関数は今のコードの `packages/core/src/domain/validation.ts`（`TAG_COUNT_LIMIT`）にある。タグを作る画面と操作は、基本設計 03 章と 06 章の回に書く。

### 6.4 曲ごとの設定（`settings`）

```ts
export interface SongSettings {
  /** 曲を開いたときの表示モード。 */
  defaultViewMode: 'focus' | 'scroll' | 'score';
}
```

- `defaultViewMode` は、曲を開いたときの表示モードを表す。 <!-- req 02:5525a8e0.39e5 --> 値は `focus`（フォーカス）・`scroll`（全体スクロール）・`score`（スコア）の 3 つのどれかとする。 <!-- req 02:5525a8e0.5a2f -->
- `settings` はミキサーの値を持たない。 <!-- req 02:bb8e0f3a.fcfa --> パートごとの音量 <!-- req 02:533bc2a4.fb8b -->・パン <!-- req 02:533bc2a4.f9de -->・ソロ <!-- req 02:533bc2a4.06a5 -->・ミュート <!-- req 02:533bc2a4.a855 -->は、パートが持つ（`Track.playbackInfo`、[[part-tuning-management.md#2]] の 2.1 節）。
- 今のコードの `settings` は `mixerSnapshot` を持っていて、ここと違う（[[00_reference.md#8.1]] の G72）。

### 6.5 サムネイル（`thumbnail`）

```ts
thumbnail: { encoding: 'base64-png'; data: string } | null;
```

- `data` には、PNG の画像を base64 の文字列にしたものを入れる。 <!-- req 02:2bca23c8.b17c --> `encoding` は `base64-png` とする。 <!-- req 02:2bca23c8.cb6f --> まだ作っていないときは `null`（今のコードの形）。
- 画像の範囲は 5 節の `thumbnailRef` のとおり。作る時期と作り方は、基本設計 06 章と 03 章の回に書く。

## 7. 曲のファイルの形と `integrity`

[[../basic_design/02_data_model.md#4.1]] を受ける。`appMeta` の中身は 6 節。型は今のコード（`packages/core/src/domain/types.ts` の `SongFileJson`）の形。

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

- `checksum` は、アトミック書き込みで書いたファイルを確かめるために付け <!-- req 02:2a353628.8c0a -->、落ちたあとの立ち直りで壊れたファイルを見つけるためにも使う。 <!-- req 02:2a353628.7515 --> 確かめる流れは、基本設計 06 章の回に書く。
- ハッシュをかける対象は、`integrity` を除いた `{schemaVersion, song, appMeta}` とする。 <!-- req 02:2a353628.f996 --> ハッシュの種類は SHA-256 とする。 <!-- req 02:2a353628.4ade --> 値は `sha256:` で始まる文字列とする。 <!-- req 02:2a353628.5de3 --> 今のコードでは `packages/core/src/domain/checksum.ts` が作る。
- `savedAtMonotonic` には、保存したときの時刻を壁時計のミリ秒で入れる。 <!-- req 02:2a353628.9d7a --> 曲一覧の更新日時（9 節の `SongSummary.updatedAt`）は、ここから作る。 <!-- req 02:2a353628.bbc4 --> 索引を作り直すときも、ファイルの更新時刻ではなくここから作る（今のコードとの違いは [[00_reference.md#8.1]] の G66）。 <!-- req 02:2a353628.2a86 --> 名前に Monotonic とあるが中身は壁時計で、名前は古いファイルと合わせるため変えない。 <!-- req 02:2a353628.b3ec -->
- 曲のファイルの拡張子は `.tabapp` とする。 <!-- req 02:f73adfca.13cc --> OS との関連付けは、基本設計 06 章の回に書く。

## 8. スキーマの版と移行

[[../basic_design/02_data_model.md#4.2]] を受ける。今のコードでは `packages/core/src/persistence/SchemaMigrator.ts` が移行を受け持ち、今の版は `CURRENT_SCHEMA_VERSION`（`packages/core/src/domain/SongDocument.ts`、`1.0.0`）。

- `schemaVersion` はセマンティックバージョニングの文字列とする。 <!-- req 02:93b0fba9.b699 --> アプリの版とは合わせず、別に管理する。 <!-- req 02:93b0fba9.5ccf -->
- (b) 版の上げ方：曲のファイルの形を変えるときに上げる。省いてよい項目を足すだけなら 2 つ目の数（`1.0.0` → `1.1.0`）を上げ、変換の関数が要る変更なら 1 つ目の数（`1.x.x` → `2.0.0`）を上げる。形を変えない直しでは上げない。セマンティックバージョニングの決まり（前と合う足し方は 2 つ目、前と合わない変更は 1 つ目）に従うと、読む側が変換の要るかを 1 つ目の数だけで見分けられるため。 <!-- req 09:630b9903.2c1e -->
- 新しい項目は、いつも省いてよい項目として足し <!-- req 02:e41359c2.8436 -->、読むときに既定の値で補う。 <!-- req 02:e41359c2.222f --> <!-- req 02:ae53b13d.9bf9 --> 今ある項目の意味は原則として変えず <!-- req 02:e41359c2.18aa -->、消さない。 <!-- req 02:e41359c2.b95b -->
- 曲のファイルを読むときに `schemaVersion` を確かめる。 <!-- req 02:12f418b8.3221 --> 今の版より古ければ、1 版ずつの変換の関数（`SchemaMigrator.register(from, to, fn)` で足したもの）を順につないで当てる（`v1→v2→v3`）。 <!-- req 02:12f418b8.a6fc --> 変換を終えてから、曲をメモリ上に広げる。 <!-- req 02:12f418b8.aaac -->
- 変換した曲は、次の自動保存のときに今の版で上書きする。 <!-- req 02:732e54ad.be8f --> まとめて変換する一括の処理は持たず、開いた曲から順に新しくなる。 <!-- req 02:732e54ad.1a9f -->
- 大きな変更で 1 版ずつの変換の関数だけでは足りないときも、曲のファイルを読む同じ経路で自動で変換する。 <!-- req 02:e0d93190.11a2 --> 本人が手で変換を走らせる手順は作らない。 <!-- req 02:e0d93190.0553 --> 変換するのは、曲のファイルを読む Web コア（`packages/core`）とする。 <!-- req 02:e0d93190.e01d -->
- 変換する前の版を残し、消さない。 <!-- req 02:e0d93190.633c --> 残す置き場所と残す期間は、下の注のとおり本書では決めない。 <!-- req 02:e0d93190.7522 -->

**注（基本設計に無いもの）**：変換する前の版の置き場所と残す期間は、基本設計 02 章 4.2 節が詳細設計で決めるとしているが、アプリの側に置けるファイルは基本設計 06 章 3 節の 2 つの木に限り、そこに置き場所が無いので本書では決めない。

## 9. 曲一覧のインデックス

[[../basic_design/02_data_model.md#5]] を受ける。今のコードでは `packages/core/src/persistence/SongIndexService.ts` が読み書きする。読み書きの時期と、曲のファイルと同時に直す流れは、基本設計 06 章の回に書く。

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
- 曲一覧を読むときは `index.json` だけを読み、曲の数によらずほぼ同じ手間で一覧を得る（基本設計 06 章の索引）。 <!-- req 02:32e10068.a89e --> 曲の数が 900 件になったら、新しい曲を作る前に予告の Warning（`SONG-001`）を出す。 <!-- req 02:32e10068.17d8 --> 1000 件で、新しい曲を作るのを拒む Error（`SONG-002`）を出す。 <!-- req 02:32e10068.6123 --> 数は今のコードの `SONG_COUNT_WARN_THRESHOLD`・`SONG_COUNT_LIMIT`（`packages/core/src/domain/validation.ts`）。
- 今のコードの `SongSummary` は `id`・`title`・`updatedAt`・`tags`・`thumbnailRef` と `isTrashed` で、`artist`・`createdAt`・代表値の 2 つ・相対フォルダが無い（[[00_reference.md#8.1]] の G71）。
