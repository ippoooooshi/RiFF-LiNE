# パート・チューニング管理 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 5「パート・チューニング管理」
- **ブランチ名**：`feature/part-tuning-management`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 2. パートの項目

[[../basic_design/02_data_model.md#3.2]] を受ける。[[../basic_design/02_data_model.md#2]] の ER 図から降りる `instrumentType` もここで受ける。項目を alphaTab のどこに持つかは [[data-model-persistence.md#4]] の対応表に合わせる。

- パートは、楽器の種類を `instrumentType` で持つ。型は列挙 <!-- req 02:f1b76108.e058 -->で、値は `electric_guitar`（エレキギター） <!-- req 02:f1b76108.45b3 -->と `bass`（ベース） <!-- req 02:f1b76108.c716 -->。v2 で足す値は基本設計 10 章の回に書く。曲のファイルでの持ち方は 2.1 節（今のコードは、MIDI のプログラム番号 `Track.playbackInfo.program` に写している。`packages/core/src/domain/newSong.ts`）。

### 2.1 項目

- **`instrumentType`**：値は MVP ではエレキギターとベースの 2 つに限る。 <!-- req 02:aa2f3acf.c96b --> 編集できる項目で <!-- req 02:aa2f3acf.bd1c -->、変えるときはコマンドを通す（2.5 節）。 <!-- req 02:aa2f3acf.2099 --> (b) 曲のファイルでは、`instrumentType` を別の項目として持たず、`Track.playbackInfo.program`（MIDI のプログラム番号）から決まった対応で読み戻す。曲のファイルの `appMeta` に入れるものは基本設計 02 章 4.1 節の 5 つに限り、音色を変えて変わるのはプログラムだけ（2.5 節）なので、プログラムが同じ情報を持つため。対応は 1 対 1 で、`electric_guitar` がプログラム 30（Distortion Guitar）、`bass` がプログラム 33（Electric Bass (finger)）とする（今のコードの `MIDI_PROGRAM` の値。`packages/core/src/parts/PartManagementService.ts`）。
- **`stringCount`・`tuning`**：`stringCount` は整数、`tuning` は弦ごとの音の高さの並び（`StringPitch[]`。alphaTab では `Staff.stringTuning.tunings` の MIDI ノート番号の並び）。 <!-- req 02:6b3773a6.f787 --> 弦本数は、ギターが 5〜8 弦 <!-- req 02:6b3773a6.143f -->、ベースが 3〜6 弦。 <!-- req 02:6b3773a6.b97a --> この範囲の外になるプリセットの適用は受け付けない。 <!-- req 02:6b3773a6.a357 --> 弦本数の単独の変更でも、範囲の外になるものは受け付けず、コマンドを発行しない（`EDIT-013`、Error）。 <!-- req 02:6b3773a6.2659 --> 一度受け付けてから範囲の中へ直すことはしない。 <!-- req 02:6b3773a6.1422 -->
- **`volume`・`pan`・`solo`・`mute`**：音量は 0 から 100 の整数。 <!-- req 02:668775f1.85b5 --> パンは -50 から 50 の整数。 <!-- req 02:668775f1.6d3f --> ソロとミュートは真偽の値。 <!-- req 02:668775f1.86bd --> alphaTab の `Track.playbackInfo` の `volume`・`balance`・`isSolo`・`isMute` への値の読み替えは、基本設計 05 章の回に playback-integration.md に書く。パンの負の値が左か右かは、基本設計に書かれていないので本書でも決めない（下の注）。
- **`capoFret`**：整数。表示は運指を基準にし <!-- req 02:2fcf3ec9.0651 -->、実音への変換は再生のときだけ行う（2.4 節）。 <!-- req 02:2fcf3ec9.6230 --> 値の 0 はカポなしを表す。 <!-- req 02:2fcf3ec9.10c9 --> 範囲は 0 から 12（2.5 節）。
- **`order`**：整数。 <!-- req 02:a000491a.30ae --> (b) パートの並び順は `Score.tracks` の並び（`Track.index`）で表し、別の項目として持たない。alphaTab の `Score` がすでに並び順を持つので、2 か所に持って食い違うのを避けるため。
- **`color`**：HEX の文字列。 <!-- req 02:9960ee1a.ed0b --> スコア表示モードで、パートを見分ける色として使う。 <!-- req 02:9960ee1a.fa68 --> パートリストでも、パートを見分ける色として使う。 <!-- req 02:9960ee1a.e339 --> alphaTab の `Track.color` に持つ（[[data-model-persistence.md#4]]）。
- **`name`**：パートは、利用者が自由に付けるパート名を持つ（`Track.name`）。 <!-- req 02:f6e740de.0493 --> パート名は、書き出すファイルの名前にも使う（決まりの中身は基本設計 07 章の回に export-print.md に書く）。 <!-- req 02:f6e740de.579f -->

**注（基本設計に無いもの）**：次の 2 つは利用者に見えるが、基本設計に書かれていないので本書では決めない。
- パンの向き（-50 と 50 のどちらが左か）
- パート識別色の既定パレットの色の数と値（基本設計は「8色程度の既定パレット」と書く）

### 2.2 パート別の色分け表示

- パートごとの色分け表示を持つ。 <!-- req 02:5329e842.1f86 -->
- 新しいパートを足したときは、既存のパートと重ならない色を既定のパレットから自動で割り当てる（パレットの色は 2.1 節の注）。 <!-- req 02:cd6ebe4e.d319 --> 割り当てた色は、パート管理パネルから手で変えられる（画面は基本設計 03 章の回に screens-navigation.md に書く）。手で変えるときは、ほかのパートの属性と同じくコマンドを通し（AD-2）、`SetPartColorCommand`（今のコードの `packages/core/src/parts/commands/partAttributeCommands.ts`。HEX の文字列を受け取り `Track.color` を変える）を発行する。 <!-- req 02:cd6ebe4e.d0a5 -->
- alphaTab の描き方は SVG にする。 <!-- req 02:622bbaa6.4bd0 -->
- alphaTab の `Track` の色（`Track.color`）を使う。 <!-- req 02:47daad26.40a4 --> `Track.color` で描けない場合と <!-- req 02:47daad26.c020 -->、表す力が足りない場合は <!-- req 02:47daad26.817c -->、SVG として描いた結果のうち、そのパートに属する描画の上に色を重ねる。 <!-- req 02:47daad26.2662 --> 重ねるときは `stroke`・`fill` を直接当てる。 <!-- req 02:47daad26.3990 -->
- alphaTab 1.8.4 の SVG はパートごとの DOM 要素を持たない（[[../basic_design/13_design_decision_points.md#3]] B34）ので、「そのパートに属する描画」は描画の矩形で決める。(b) 特定の仕方は、`boundsLookup.staffSystems`（`StaffSystemBounds`）→ `bars`（`MasterBarBounds`）→ `bars`（`BarBounds`）とたどり、`BarBounds.bar.staff.track.index` がそのパートのものの `visualBounds` を集める。alphaTab 1.8.4 の型定義で確かめた、描画の矩形からパートまでたどれる道筋だから。 <!-- req 02:4eef9c59.1853 -->
- `ScoreRenderHost` は、スコア表示のときに全部のパートを描く。 <!-- req 02:f7f0fefb.055c --> パートごとの描画の領域は、alphaTab の `boundsLookup`（`staffSystems` の矩形）から出して渡す。 <!-- req 02:f7f0fefb.9d4d --> 色を重ねる DOM と CSS を作るのは画面群の側（基本設計 03 章の回）。

### 2.3 パートの数

- パートの数の上限は 8。 <!-- req 02:f27ee4cd.95d2 --> 想定の使い方（3 から 4 パート）を超えたときに備えた上限。 <!-- req 02:6e95a500.aa28 --> `Song.parts.length <= 8` を、コマンド層の検証で守らせる（超えたら `EDIT-005`、Error。[[00_reference.md#5]]）。 <!-- req 02:e755c960.2b61 -->
- パートの数の下限は 0。 <!-- req 02:f95e9ada.b67f --> 最後の 1 パートも消せる。 <!-- req 02:f95e9ada.1db8 --> 今のコードは最後の 1 パートを残すので、実装の段で直す（[[00_reference.md#8.1]] の G67）。
- パートが 0 になっても、曲に残すもの：小節の数 <!-- req 02:8702a183.759f -->・拍子 <!-- req 02:8702a183.d0f9 -->・テンポ <!-- req 02:8702a183.8589 -->・リピート <!-- req 02:8702a183.ecab -->・小節メモ <!-- req 02:8702a183.dde8 -->・セクションマーカー。 <!-- req 02:8702a183.324e -->
- 小節の数・拍子・テンポ・リピートは alphaTab の `Score.masterBars` に残し <!-- req 02:8702a183.d714 -->、パートが 0 のときは `Score.tracks` だけが空になる。 <!-- req 02:8702a183.129b -->
- 次に足したパートは、残っている小節の数で始まる。 <!-- req 02:8702a183.525c --> 足すパートは、`masterBars` の数だけ空の小節を持って始まる。 <!-- req 02:61ee1e64.0f2b -->
- パートを消すコマンドを作る前に、パートが 0 の曲を保存して読み戻せるかを確かめる。 <!-- req 02:18765c91.743d -->

### 2.4 カポの表示と実音

- カポを使っても、表示（記譜のフレット番号）は変えない。 <!-- req 02:99c0687e.8235 --> <!-- req 02:a168221d.7454 --> カポの位置そのものを常に表示することを、要件の「表示に反映」とする。 <!-- req 02:99c0687e.4d26 --> カポの位置はステータスバーに常に出す（画面は基本設計 03 章の回）。 <!-- req 02:a168221d.8a0d --> 表示は運指の側を採る。 <!-- req 02:2f733d57.c711 -->
- 再生の音の高さは、実音へ変換する。 <!-- req 02:938d2246.ee21 --> MIDI の書き出しも、再生と同じ変換の式を使う。 <!-- req 02:938d2246.bfda --> 式の中身は基本設計 05 章の回に playback-integration.md に書く。

### 2.5 音色・弦本数・チューニング・カポの変え方

- 弦本数は変えられる。 <!-- req 02:0cec386f.abff --> 音色（`instrumentType`）の変え方 <!-- req 02:4f8f1cb0.8953 -->と、弦本数（`stringCount`）の変え方は <!-- req 02:4f8f1cb0.865d -->、どちらも `Score` への変更をコマンドだけに通す決まり（[[../basic_design/01_architecture.md#3]] AD-2）に従い、下のコマンドで行う。

| 変えるもの | コマンド | 決まり |
|---|---|---|
| `instrumentType` | (b) `SetPartInstrumentCommand`（パートの属性を変えるコマンド） | 選べる値は `electric_guitar` <!-- req 02:58379426.e1d7 -->と `bass` <!-- req 02:58379426.63ee -->の 2 つに限る。 <!-- req 02:58379426.1942 --> 変えても記譜とチューニングは変えない。 <!-- req 02:58379426.f335 --> 変わるのは再生の音色（SoundFont のプログラム）だけ。 <!-- req 02:58379426.63a6 --> <!-- req 02:58379426.12e3 --> |
| `stringCount`（プリセット） | `ApplyTuningPresetCommand` | 経路 (a)：チューニングプリセットを当てるとき、弦本数もそろえる。 <!-- req 02:4e11def6.c19a --> |
| `stringCount`（単独） | (b) `SetStringCountCommand` | 経路 (b)：プリセットを使わずに弦本数だけを変える経路を設ける。 <!-- req 02:4e11def6.7d7f --> 弦を足すときは低音の側に足す。 <!-- req 02:4e11def6.3a5c --> 足した弦の音の高さは、それまでの最も低い弦の完全 4 度下を初めの値にする。 <!-- req 02:4e11def6.0c41 --> 弦を減らすときは、最も低い側から外す。 <!-- req 02:4e11def6.86e4 --> 外す弦に音符が残っていれば、プリセットを当てるときと同じく Warning を出して消す（`EDIT-006`）。 <!-- req 02:4e11def6.2f04 --> Warning で知らせてから消し、Undo で外した弦と音符をまとめて戻せる。 <!-- req 02:4e11def6.4483 --> |
| `stringCount`（両方） | ― | プリセットでも単独でも、`EDIT-013` の範囲の外へは変えられない。 <!-- req 02:4e11def6.f137 --> |
| `tuning` | `SetCustomTuningCommand` | チューニング設定パネルで、弦ごとに音の高さを指定できる。 <!-- req 02:8f9b915b.5658 --> 指定すると `SetCustomTuningCommand` を発行する。 <!-- req 02:8f9b915b.112d --> 弦本数は変えない。 <!-- req 02:8f9b915b.2945 --> プリセットから外れるので、プリセット名の表示は外す。 <!-- req 02:8f9b915b.1c45 --> (b) 入力は音名とオクターブ（例 E2）で選び、中では MIDI ノート番号で持つ。値の範囲は MIDI ノート番号の 0 から 127。alphaTab の `Tuning.tunings` が MIDI ノート番号で持ち、要件4.2「弦ごとの自由な音高指定」なので MIDI で表せる範囲より狭めないため。 <!-- req 02:8f9b915b.6e6c --> |
| `capoFret` | `SetCapoFretCommand` | チューニング設定パネルのカポの数の入力から発行する。 <!-- req 02:c71d1cc9.476f --> 0 から 12 の範囲の外なら発行せず、`EDIT-007` にする。 <!-- req 02:c71d1cc9.6345 --> |

- `SetPartInstrumentCommand`・`SetStringCountCommand` の名前は、(b) 今のコードのパートの属性のコマンド（`SetPartColorCommand` と `SetCapoFretCommand`。`packages/core/src/parts`）の付け方にそろえた。どちらも今のコードには無い（[[00_reference.md#8.1]] G49・G50）
