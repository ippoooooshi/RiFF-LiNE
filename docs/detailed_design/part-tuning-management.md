# パート・チューニング管理 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 5「パート・チューニング管理」
- **ブランチ名**：`feature/part-tuning-management`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 2. パートの項目

[[../basic_design/02_data_model.md#3.2]] を受ける。[[../basic_design/02_data_model.md#2]] の ER 図から降りる `instrumentType` もここで受ける。項目を alphaTab のどこに持つかは [[data-model-persistence.md#4]] の対応表に合わせる。

- パートは、楽器の種類を `instrumentType` で持つ。型は列挙 <!-- req 02:36752e3f.e058 -->で、値は `electric_guitar`（エレキギター） <!-- req 02:36752e3f.45b3 -->と `bass`（ベース） <!-- req 02:36752e3f.c716 -->。v2 で足す値は [[web-core-foundation.md#13]] の 13.4 節。曲のファイルでの持ち方は 2.1 節（今のコードは、MIDI のプログラム番号 `Track.playbackInfo.program` に写している。`packages/core/src/domain/newSong.ts`）。

### 2.1 項目

- **`instrumentType`**：値は MVP ではエレキギターとベースの 2 つに限る。 <!-- req 02:aa2f3acf.c96b --> 編集できる項目で <!-- req 02:aa2f3acf.bd1c -->、変えるときはコマンドを通す（2.5 節）。 <!-- req 02:aa2f3acf.2099 --> (b) 曲のファイルでは、`instrumentType` を別の項目として持たず、`Track.playbackInfo.program`（MIDI のプログラム番号）から決まった対応で読み戻す。曲のファイルの `appMeta` に入れるものは基本設計 02 章 4.1 節の 5 つに限り、音色を変えて変わるのはプログラムだけ（2.5 節）なので、プログラムが同じ情報を持つため。対応は 1 対 1 で、`electric_guitar` がプログラム 30（Distortion Guitar）、`bass` がプログラム 33（Electric Bass (finger)）とする（今のコードの `MIDI_PROGRAM` の値。`packages/core/src/parts/PartManagementService.ts`）。
- **`stringCount`・`tuning`**：`stringCount` は整数、`tuning` は弦ごとの音の高さの並び（`StringPitch[]`。alphaTab では `Staff.stringTuning.tunings` の MIDI ノート番号の並び）。 <!-- req 02:6b3773a6.f787 --> 弦本数は、ギターが 5〜8 弦 <!-- req 02:6b3773a6.143f -->、ベースが 3〜6 弦。 <!-- req 02:6b3773a6.b97a --> この範囲の外になるプリセットの適用は受け付けない。 <!-- req 02:6b3773a6.a357 --> 弦本数の単独の変更でも、範囲の外になるものは受け付けず、コマンドを発行しない（`EDIT-013`、Error）。 <!-- req 02:6b3773a6.2659 --> 一度受け付けてから範囲の中へ直すことはしない。 <!-- req 02:6b3773a6.1422 --> <!-- req 08:98d50317.f08d -->
- **`volume`・`pan`・`solo`・`mute`**：音量は 0 から 100 の整数。 <!-- req 02:c29ee1a3.85b5 --> パンは -50 から 50 の整数。 <!-- req 02:c29ee1a3.33a7 --> パンは -50 を左の端、0 を中央、50 を右の端とする（2026-10-01 本人決定）。 <!-- req 02:c29ee1a3.823e --> ソロとミュートは真偽の値。 <!-- req 02:c29ee1a3.86bd --> alphaTab の `Track.playbackInfo` の `volume`・`balance`・`isSolo`・`isMute` への値の読み替えは、基本設計 05 章の回に playback-integration.md に書く（パンの向きを `balance` と MIDI の Pan へ読み替える式もそこに書く）。
- **`capoFret`**：整数。表示は運指を基準にし <!-- req 02:2fcf3ec9.0651 -->、実音への変換は再生のときだけ行う（2.4 節）。 <!-- req 02:2fcf3ec9.6230 --> 値の 0 はカポなしを表す。 <!-- req 02:2fcf3ec9.10c9 --> 範囲は 0 から 12 で、上限は弦の音の高さによって下がることがある（2.5 節）。 <!-- req 13:a5b3919e.4811 -->
- **`order`**：整数。 <!-- req 02:a000491a.30ae --> (b) パートの並び順は `Score.tracks` の並び（`Track.index`）で表し、別の項目として持たない。alphaTab の `Score` がすでに並び順を持つので、2 か所に持って食い違うのを避けるため。
- **`color`**：HEX の文字列。 <!-- req 02:9960ee1a.ed0b --> スコア表示モードで、パートを見分ける色として使う。 <!-- req 02:9960ee1a.fa68 --> パートリストでも、パートを見分ける色として使う。 <!-- req 02:9960ee1a.e339 --> alphaTab の `Track.color` に持つ（[[data-model-persistence.md#4]]）。
- **`name`**：パートは、利用者が自由に付けるパート名を持つ（`Track.name`）。 <!-- req 02:f6e740de.0493 --> パート名は、書き出すファイルの名前にも使う（決まりの中身は基本設計 07 章の回に export-print.md に書く）。 <!-- req 02:f6e740de.579f -->

**既定パレット**：パート識別色の既定パレットは 8 色とし（2026-10-01 本人決定）、新しいパートには、使われていない色を次の並びの先頭から割り当てる。
- `#16a21b`（緑）・`#059669`（エメラルド）・`#dc2626`（赤）・`#d97706`（アンバー）・`#0891b2`（シアン）・`#c026d3`（フクシア）・`#db2777`（ピンク）・`#65a30d`（ライム）。 <!-- req 02:f23966da.c306 --> 今のコードの `PART_COLOR_PALETTE`（`packages/core/src/parts/PartColorAllocator.ts`）は前の 8 色のままで、1 色目と 6 色目が違う（[[00_reference.md#8.1]] の G73）。
- (b) 替えた 2 色：本人の決定で、前の 8 色のうちアクセントカラーに近いインディゴ `#4f46e5`（色相 243 度）とバイオレット `#7c3aed`（262 度）を替えた。替えた先は、緑 `#16a21b`（122 度）とフクシア `#c026d3`（293 度）にした。アクセント `#5850ec`（[[../basic_design/14_visual_design_system.md#3.2]]）の色相は 243 度で、前の 2 色はそこから 0 度と 19 度しか離れていなかった。緑とフクシアは、残す 6 色の色相（0・32・85・161・192・333 度）の間で広く空いている所の中ほどにあり、アクセントから 121 度と 50 度離れる。これで 8 色すべてがアクセントの色相から 50 度以上離れ、パートの色を操作できる要素の色と見誤りにくくなるため。 <!-- req 02:bf9bd4c4.ef1e -->

### 2.2 パート別の色分け表示

- パートごとの色分け表示を持つ。 <!-- req 02:5329e842.1f86 -->
- 新しいパートを足したときは、既存のパートと重ならない色を既定のパレットから自動で割り当てる（パレットの色は 2.1 節の既定パレット）。 <!-- req 02:bf9bd4c4.7e38 --> 割り当てた色は、パート管理パネルから手で変えられる（画面は基本設計 03 章の回に screens-navigation.md に書く）。手で変えるときも、パートの属性を変えるコマンドの 1 つとして AD-2 のとおりコマンドを通し、`SetPartColorCommand`（今のコードの `packages/core/src/parts/commands/partAttributeCommands.ts`。HEX の文字列を受け取り `Track.color` を変える）を発行する。 <!-- req 02:f23966da.d0a5 -->
- alphaTab の描き方は SVG にする。 <!-- req 02:622bbaa6.4bd0 -->
- alphaTab の `Track` の色（`Track.color`）を使う。 <!-- req 02:9caa0c41.40a4 --> `Track.color` で描けない場合と <!-- req 02:9caa0c41.0369 -->、表す力が足りない場合は <!-- req 02:9caa0c41.2029 -->、そのパートの描画の領域（下の矩形）に、パートの色の半透明の帯を重ねて見分ける。 <!-- req 02:9caa0c41.4b81 --> 音符や線そのものには色を付けない（2026-10-01 本人決定。[[00_reference.md#8.1]] の G24 で作った `PartColorOverlay` の、矩形に半透明の帯の `<div>` を重ねる形）。(b) 描けない場合の条件：alphaTab 1.8.4 の描画は `Track.color` を使わないので、スコア表示ではいつも帯を重ね、`Track.color` には帯の色の値を持たせるだけにする。`alphaTab.js` で `track.color` に当たる 4 か所は、alphaTex と GPIF（Guitar Pro 7 の形式）を読む所と書く所だけで、描画の側には無いことを確かめたため。
- alphaTab 1.8.4 の SVG はパートごとの DOM 要素を持たない（[[../basic_design/13_design_decision_points.md#3]] B34）ので、「そのパートに属する描画」は描画の矩形で決める。(b) 特定の仕方は、`boundsLookup.staffSystems`（`StaffSystemBounds`）→ `bars`（`MasterBarBounds`）→ `bars`（`BarBounds`）とたどり、`BarBounds.bar.staff.track.index` がそのパートのものの `visualBounds` を集める。alphaTab 1.8.4 の型定義で確かめた、描画の矩形からパートまでたどれる道筋だから。 <!-- req 02:4eef9c59.1853 --> <!-- req 13:a0e77b51.629e --> <!-- req 13:953ef585.ebad -->
- `ScoreRenderHost` は、スコア表示のときに全部のパートを描く。 <!-- req 02:2ce0f251.ddb6 --> パートごとの描画の領域は、alphaTab の `boundsLookup`（`staffSystems` の矩形）から出して渡す。 <!-- req 02:2ce0f251.9d4d --> 色を重ねる DOM と CSS を作るのは画面群の側（基本設計 03 章の回）。 <!-- req 13:a0e77b51.5662 --> <!-- req 13:a0e77b51.fd09 --> <!-- req 13:a0e77b51.49e0 --> <!-- req 13:ff67c0e8.f1f1 -->

### 2.3 パートの数

- パートの数の上限は 8。 <!-- req 02:f27ee4cd.95d2 --> 想定の使い方（3 から 4 パート）を超えたときに備えた上限。 <!-- req 02:6e95a500.aa28 --> `Song.parts.length <= 8` を、コマンド層の検証で守らせる（超えたら `EDIT-005`、Error。[[00_reference.md#5]]）。 <!-- req 02:e755c960.2b61 --> <!-- req 08:456057c8.4376 --> <!-- req 13:1b794120.3a6d -->
- パートの数の下限は 0。 <!-- req 02:f95e9ada.b67f --> 最後の 1 パートも消せる。 <!-- req 02:f95e9ada.1db8 --> 今のコードは最後の 1 パートを残すので、実装の段で直す（[[00_reference.md#8.1]] の G67）。
- パートが 0 になっても、曲に残すもの：小節の数 <!-- req 02:8702a183.759f -->・拍子 <!-- req 02:8702a183.d0f9 -->・テンポ <!-- req 02:8702a183.8589 -->・リピート <!-- req 02:8702a183.ecab -->・小節メモ <!-- req 02:8702a183.dde8 -->・セクションマーカー。 <!-- req 02:8702a183.324e -->
- 小節の数・拍子・テンポ・リピートは alphaTab の `Score.masterBars` に残し <!-- req 02:8702a183.d714 -->、パートが 0 のときは `Score.tracks` だけが空になる。 <!-- req 02:8702a183.129b -->
- 次に足したパートは、残っている小節の数で始まる。 <!-- req 02:8702a183.525c --> 足すパートは、`masterBars` の数だけ空の小節を持って始まる。 <!-- req 02:61ee1e64.0f2b -->
- パートを消すコマンドを作る前に、パートが 0 の曲を保存して読み戻せるかを確かめる。 <!-- req 02:18765c91.743d -->

### 2.4 カポの表示と実音

- カポを使っても、表示（記譜のフレット番号）は変えない。 <!-- req 02:99c0687e.8235 --> <!-- req 02:a168221d.7454 --> カポの位置そのものを常に表示することを、要件の「表示に反映」とする。 <!-- req 02:99c0687e.4d26 --> カポの位置はステータスバーに常に出す（画面は基本設計 03 章の回）。 <!-- req 02:a168221d.8a0d --> 表示は運指の側を採る。 <!-- req 02:2f733d57.c711 --> <!-- req 13:07d4555b.a232 --> <!-- req 13:07d4555b.2596 --> <!-- req 13:07d4555b.51cf -->
- 再生の音の高さは、実音へ変換する。 <!-- req 02:938d2246.ee21 --> MIDI の書き出しも、再生と同じ変換の式を使う。 <!-- req 02:938d2246.bfda --> 式の中身は基本設計 05 章の回に playback-integration.md に書く。

### 2.5 音色・弦本数・チューニング・カポの変え方

- 弦本数は変えられる。 <!-- req 02:0cec386f.abff --> 音色（`instrumentType`）の変え方 <!-- req 02:4f8f1cb0.8953 -->と、弦本数（`stringCount`）の変え方は <!-- req 02:4f8f1cb0.865d -->、どちらも `Score` への変更をコマンドだけに通す決まり（[[../basic_design/01_architecture.md#3]] AD-2）に従い、下のコマンドで行う。

| 変えるもの | コマンド | 決まり |
|---|---|---|
| `instrumentType` | (b) `SetPartInstrumentCommand`（パートの属性を変えるコマンド） | 選べる値は `electric_guitar` <!-- req 02:f8917b7a.e1d7 -->と `bass` <!-- req 02:f8917b7a.63ee -->の 2 つに限る。 <!-- req 02:f8917b7a.1942 --> 変えても記譜とチューニングは変えない。 <!-- req 02:f8917b7a.f335 --> 変わるのは再生の音色（SoundFont のプログラム）だけ。 <!-- req 02:f8917b7a.63a6 --> <!-- req 02:f8917b7a.12e3 --> 変えた後の弦本数が、変えた先の楽器の範囲（ギター 5 から 8 弦、ベース 3 から 6 弦、下の stringCount の行と同じ）を外れる変更は受け付けず、コマンドを発行せずに `EDIT-013` を出す（基本設計 02 章 3.2 節）。 <!-- req 02:f8917b7a.496f --> <!-- req 02:f8917b7a.fd13 --> |
| `stringCount`（プリセット） | `ApplyTuningPresetCommand` | 経路 (a)：チューニングプリセットを当てるとき、弦本数もそろえる。 <!-- req 02:45b9dde0.c19a --> <!-- req 13:3d64bdd3.c9b6 --> |
| `stringCount`（単独） | (b) `SetStringCountCommand` | 経路 (b)：プリセットを使わずに弦本数だけを変える経路を設ける。 <!-- req 02:45b9dde0.7d7f --> 弦を足すときは低音の側に足す。 <!-- req 02:45b9dde0.3a5c --> 足した弦の音の高さは、それまでの最も低い弦の完全 4 度下を初めの値にする。 <!-- req 02:45b9dde0.0c41 --> 弦を減らすときは、最も低い側から外す。 <!-- req 02:45b9dde0.86e4 --> 外す弦に音符が残っていれば、プリセットを当てるときと同じく Warning を出して消す（`EDIT-006`）。 <!-- req 02:45b9dde0.2f04 --> Warning で知らせてから消し、Undo で外した弦と音符をまとめて戻せる。 <!-- req 02:45b9dde0.4483 --> <!-- req 08:31d3875f.c187 --> |
| `stringCount`（両方） | ― | プリセットでも単独でも、`EDIT-013` の範囲の外へは変えられない。 <!-- req 02:45b9dde0.f137 --> |
| `tuning` | `SetCustomTuningCommand` | チューニング設定パネルで、弦ごとに音の高さを指定できる。 <!-- req 02:8f9b915b.5658 --> 指定すると `SetCustomTuningCommand` を発行する。 <!-- req 02:8f9b915b.112d --> 弦本数は変えない。 <!-- req 02:8f9b915b.2945 --> プリセットから外れるので、プリセット名の表示は外す。 <!-- req 02:8f9b915b.1c45 --> (b) 入力は音名とオクターブ（例 E2）で選び、中では MIDI ノート番号で持つ。alphaTab の `Tuning.tunings` が MIDI ノート番号で持つため。選べる値の範囲は、そのパートのカポの位置に合わせて変わり、0 から（127 − `capoFret` − 24）までとする（カポ 0 なら 0 から 103、カポ 12 なら 0 から 91。どの設定でも MIDI ノート番号の 0 から 127 の内側。2026-10-17 本人決定、honnin-queue 142 番）。24 はフレットの上限（[[editing-core.md#3]] の 3.9 節）。弦の音の高さにカポとフレットを足した実音（[[playback-integration.md#9]] の 9.1 節）が、MIDI ノート番号の 127 を超えないようにするため。範囲の外の音の高さは、チューニング設定パネルの選択肢に出さない（[[screens-navigation.md#12]] の 12.4 節）。 <!-- req 02:8f9b915b.6e6c --> |
| `capoFret` | `SetCapoFretCommand` | チューニング設定パネルのカポの数の入力から発行する。 <!-- req 02:cc175576.476f --> 0 から 12 の範囲の外なら発行せず、`EDIT-007` にする。 <!-- req 02:cc175576.6345 --> <!-- req 13:a5b3919e.b513 --> あわせて、カポの上限は、12 と（127 − 24 − そのパートのいちばん高い弦の音の高さ）の小さい方とし、それを超える値も発行せずに `EDIT-007` にする（2026-10-17 本人決定、honnin-queue 142 番。上の `tuning` の行と同じく、足した実音が 127 を超えないため）。上限が 12 より下がるのは、いちばん高い弦が 92 以上のときだけ（92 なら 11、103 なら 0）。同梱のプリセットはいちばん高い弦が 64（3.3 節）なので、上限は 12 のまま変わらない <!-- req 02:cc175576.33e3 --> <!-- req 02:cc175576.ce32 --> <!-- req 02:cc175576.210a --> <!-- req 13:a5b3919e.3edb --> <!-- req 13:a5b3919e.6f32 --> <!-- req 13:a5b3919e.ac98 --> <!-- req 08:98d50317.5611 --> <!-- req 08:98d50317.3936 --> |

- `SetPartInstrumentCommand`・`SetStringCountCommand` の名前は、(b) 今のコードのパートの属性のコマンド（`SetPartColorCommand` と `SetCapoFretCommand`。`packages/core/src/parts`）の付け方にそろえた。どちらも今のコードには無い（[[00_reference.md#8.1]] G49・G50）

### 2.6 パートを扱うクラス

コマンドの形は [[editing-core.md#2]] の 2.6 節の型の一覧が正で、ここでは画面から呼ぶサービスと色の割り当ての形を書く。 <!-- req 13:468fb76f.c5a4 -->

```ts
// packages/core/src/parts/PartColorAllocator.ts
/** 2.1 節の既定パレットの 8 色。この並びの順に割り当てる。 */
export const PART_COLOR_PALETTE: readonly string[];
/** 状態を持たない。呼ぶたびに、今使っている色を受け取る。 */
export class PartColorAllocator {
  /** usedColors と reserved に無い色を、パレットの先頭から 1 つ返す。比べるときは # の有無と大文字・小文字をそろえる。8 色とも使われていれば先頭の色を返す。 */
  allocate(usedColors: Iterable<string>, reserved?: Iterable<string>): string;
}

// packages/core/src/parts/PartManagementService.ts
export type InstrumentType = 'electric_guitar' | 'bass';
/** 画面に出すパートの値（読むだけの写し）。 */
export interface PartSummary {
  trackIndex: number;
  name: string;
  instrumentType: InstrumentType;
  colorHex: string;
  stringCount: number;
  /** 開放弦の音の高さ（MIDI ノート番号、高音弦から低音弦）。 */
  tuning: number[];
  capoFret: number;
  /** 元にしたプリセット（3.1 節の partPresetIds）。無ければ null。 */
  presetId: string | null;
  volume: number;
  pan: number;
  solo: boolean;
  mute: boolean;
}
export interface AddPartRequest {
  name: string;
  instrumentType: InstrumentType;
  /** 省くと、その楽器の標準のチューニング（3.3 節の builtin-guitar-standard か builtin-bass-standard）。 */
  tuning?: number[];
  /** tuning を元にしたプリセット（3.1 節）。 */
  presetId?: string;
  /** 足す位置。省くと最後。 */
  at?: number;
}
/** 編集ウィンドウごとに 1 つ。パートの操作を受け、確かめてからコマンドを発行する。 */
export class PartManagementService {
  constructor(target: EditTarget, history: CommandHistory, validation: ValidationService, reporter: NotificationReporter);
  listParts(): PartSummary[];
  summaryOf(trackIndex: number): PartSummary;
  /** 足した後の数が 8 を超えるなら EDIT-005 を知らせて発行しない（2.3 節）。色は PartColorAllocator で決める。 */
  addPart(request: AddPartRequest, reservedColors?: readonly string[]): void;
  /** addPart が次に割り当てる色。何パートかをまとめて足すときに、先に決めた色を reservedColors に入れるのに使う。 */
  peekNextColor(reservedColors?: readonly string[]): string;
  /** 最後の 1 パートも消す（2.3 節）。範囲の外の trackIndex では何もしない。 */
  removePart(trackIndex: number): void;
  reorderParts(order: readonly number[]): void;
  renamePart(trackIndex: number, name: string): void;
  setColor(trackIndex: number, hex: string): void;
  /** 変えた先の楽器で弦本数が範囲の外なら EDIT-013 を知らせて発行しない（2.5 節）。 */
  setInstrument(trackIndex: number, instrumentType: InstrumentType): void;
  /** 範囲の外なら EDIT-013 を知らせて発行しない（2.5 節）。 */
  setStringCount(trackIndex: number, stringCount: number): void;
  /** stringPitches の長さが今の弦本数と違うとき、0 から maxStringPitch(今の capoFret) の外の整数を含むときは発行せず、@throws RangeError（どちらも画面からは起きない形で、起きればアプリの不具合。下の (b)）。 */
  setCustomTuning(trackIndex: number, stringPitches: number[]): void;
  /** 0 から maxCapoFret(今の弦の音の高さ) の整数でないなら EDIT-007 を知らせて発行しない（2.5 節）。context の max に今の上限を入れる。 */
  setCapo(trackIndex: number, capoFret: number): void;
}

// packages/core/src/parts/pitchLimits.ts
/** カポの位置の上限の 12（B14）。コードではここにだけ持つ。 */
export const MAX_CAPO_FRET = 12;
/** 弦の音の高さの上限（2.5 節の tuning の行）：127 − capoFret − MAX_FRET。MAX_FRET は editing の scoreModel の 24。 */
export function maxStringPitch(capoFret: number): number;
/** カポの上限（2.5 節の capoFret の行）：MAX_CAPO_FRET と（127 − MAX_FRET − stringPitches のいちばん大きい値）の小さい方。 */
export function maxCapoFret(stringPitches: readonly number[]): number;
```

- (b) パート管理パネルとチューニング設定パネル（[[screens-navigation.md#12]] の 12.3 節と 12.4 節）と、パートリストの「パート追加」は、パートの属性を変えるときに `PartManagementService` だけを呼び、コマンドを自分で作らない。範囲の確かめ（`EDIT-005`・`EDIT-007`・`EDIT-013`）を、コマンドを発行する前の 1 か所に集めるため。
- (b) 音量・パン・ソロ・ミュートは `PartManagementService` に置かない。`PlaybackService` の `setPartVolume`・`setPartPan`・`setPartSolo`・`setPartMute`（[[playback-integration.md#1]] の 1.2 節と 7 節）が受けて同じコマンドを発行する。値を変える口を 1 つにして、パートリストとミキサーの表示がそろうため。
- (b) 弦の音の高さとカポの上限は、`pitchLimits.ts` の `maxStringPitch`・`maxCapoFret` の 2 つにだけ書き、`PartManagementService`・`TuningPresetService`（3.4 節）・チューニング設定パネル（[[screens-navigation.md#12]] の 12.4 節）はどれもこれを呼ぶ。上限の式を 1 か所にして、画面で選べる範囲と、コマンドの前の確かめが食い違わないため。
- (b) 弦の音の高さが範囲の外のときにエラーコードを足さない。画面では範囲の外を選べない形にし（12.4 節）、`setCustomTuning` と `applyPreset` は範囲の外を受けたら発行せずに `RangeError` を投げる。画面が選ばせないので、サービスに範囲の外が来るのはアプリの不具合で、黙って捨てると不具合が見えないまま残るため。投げた `RangeError` は画面に出さない（[[editing-core.md#10]] の `AddSectionMarkerCommand` の確かめと同じ扱い、2026-10-17 チャット側の決定）。弦の音の高さの範囲の外を表すコードは基本設計 08 章 1 節の表に無く、`EDIT-013` は弦本数の範囲の外を表すコードとして基本設計 02 章 3.2 節と 08 章 1 節で決まっているので、使い回すと意味が変わるため。カポは前から `EDIT-007` があるので、上限が下がったときもそれを使う。
- 今のコードとの違い：`PartManagementService` は `setVolume`・`setPan`・`setSolo`・`setMute` を持ち、`renamePart`・`setInstrument`・`setStringCount`・`setCustomTuning` を持たない。`removePart` は最後の 1 パートを残す（G67）。ctor は `PartValidationService` を受け（G77）、知らせの口は同じ形の `PartNotificationReporter` という名前で持つ。`PartSummary` に `instrumentType` と `presetId` が無く、`AddPartRequest` に `presetId` が無い（G22）。パレットの色は G73。`pitchLimits.ts` が無く、`setCapo` はカポの上限を 12 で固定して確かめ、`SetCustomTuningCommand` は音の高さの範囲を確かめない。どれも本書の形に直すのは実装の段（[[00_reference.md#8.1]] の G78）。

## 3. チューニングプリセット

[[../basic_design/02_data_model.md#3.7]] を受ける。型は今のコード（`packages/core/src/domain/types.ts` の `TuningPreset`）の形で、利用者のプリセットの論理削除の項目（`isDeleted`・`deletedAt`）の中身と、利用者のプリセットを置くファイル（`tuning-presets.json`）は [[data-model-persistence.md#13]] の 13.4 節。

```ts
export interface TuningPreset {
  id: string;
  name: string;
  /** 同梱の組み込みなら true。利用者が足したものは false。 */
  builtin: boolean;
  /** 弦ごとの開放弦の音の高さ（MIDI ノート番号）。高音弦から低音弦の順。 */
  stringPitches: number[];
}
```

### 3.1 プリセットとパートの関係

- 定番のプリセットをアプリに同梱し <!-- req 02:e91f51fc.56eb -->、利用者が自分のプリセットを足せる（`TuningPresetService.create`、`packages/core/src/parts/TuningPresetService.ts`）。 <!-- req 02:e91f51fc.3c21 -->
- プリセットは曲に属さない独立したデータで <!-- req 02:3914b32c.a1ff -->、アプリ全体で共有する。 <!-- req 02:3914b32c.544a -->
- パートは、元にしたプリセットの `presetId` を任意の項目として持つ。 <!-- req 02:3914b32c.0d00 --> チューニングは、プリセットへの参照ではなく値の写し（`Staff.stringTuning.tunings`）で持つ。 <!-- req 02:3914b32c.49d8 --> プリセットを消しても、曲のチューニングは変わらない。
- パートの `presetId` は、曲のファイルの `appMeta.settings` の `partPresetIds` に、パートごとに持つ（2026-10-01 本人決定、[[data-model-persistence.md#6]] の 6.4 節）。 <!-- req 02:148d83ee.3d94 --> プリセットから作っていないパートの値は `null` とする。プリセットの名前は、今までどおり `Staff.stringTuning.name` にも書く。今のコードは名前だけを書いている（[[00_reference.md#8.1]] の G22）。
- (b) パートとの対応：`partPresetIds` は、パートの並び（`Score.tracks` の並び、`Track.index`）と同じ順の配列にする。パートを足す・消す・並べ替えるコマンドは、同じコマンドの中で `partPresetIds` も同じように足す・消す・並べ替え、`undo` でいっしょに戻す。プリセットを当てるコマンドはそのパートの値をプリセットの `id` に、プリセットを使わずに弦の音の高さや弦本数を変えるコマンドは `null` にする。alphaTab 1.8.4 の `Track` はパートの id を持たず（並び順は 2.1 節の `order` のとおり `Track.index` だけで表す）、id を鍵にするには曲のファイルにパートの id を別に持たせる必要があるため。

### 3.2 弦の並び

- `stringPitches` の並びは、alphaTab の `Staff.stringTuning.tunings` の並びにそろえる。 <!-- req 02:abe0daea.5dc9 --> 並びは高音弦から低音弦の順で、先頭がタブ譜の最上線（最も高い弦）に当たる。 <!-- req 02:abe0daea.d65d -->
- 音符の弦番号 `Note.string` は alphaTab の決まりに従い、1 が最も低い弦（タブ譜の最下線） <!-- req 02:b1d858a2.e43e -->で、上へ 1 ずつ増える。 <!-- req 02:b1d858a2.469f --> そのため `Note.string` の番号の並びは、`stringPitches` の番号の並びと逆になる（`n` 番の弦の開放弦の音の高さは `stringPitches[stringPitches.length - n]`）。 <!-- req 02:b1d858a2.af03 -->

### 3.3 同梱する組み込みのプリセット

- 同梱するのは、ギター用 8 種 <!-- req 02:316999ff.a47f -->とベース用 4 種 <!-- req 02:316999ff.30cd -->の計 12 種。 <!-- req 02:316999ff.8584 --> `stringPitches` は高音弦から低音弦の順に並べ <!-- req 02:316999ff.1066 -->、値は MIDI ノート番号で書く。 <!-- req 02:316999ff.68e8 -->

| id | 表示名 | 弦数 | `stringPitches`（高音弦から低音弦） | 印 |
|---|---|---|---|---|
| `builtin-guitar-standard` | ギター標準（EADGBE） | 6 | `[64, 59, 55, 50, 45, 40]` | <!-- req 02:500f0f99.9baf --> |
| `builtin-guitar-drop-d` | ドロップD | 6 | `[64, 59, 55, 50, 45, 38]` | <!-- req 02:af086a6d.1df5 --> |
| `builtin-guitar-dadgad` <!-- req 02:7741095c.2ed5 --> | DADGAD <!-- req 02:7741095c.f2d6 --> | 6 <!-- req 02:7741095c.3245 --> | `[62, 57, 55, 50, 45, 38]` <!-- req 02:7741095c.4fb4 --> | |
| `builtin-guitar-half-down` | 半音下げ | 6 | `[63, 58, 54, 49, 44, 39]` | <!-- req 02:7b2554ca.f506 --> |
| `builtin-guitar-drop-c-sharp` | ドロップC# | 6 | `[63, 58, 54, 49, 44, 37]` | <!-- req 02:72b54832.4b63 --> |
| `builtin-guitar-drop-b` | ドロップB | 6 | `[61, 56, 52, 47, 42, 35]` | <!-- req 02:b49011b5.55d9 --> |
| `builtin-guitar-open-g` | オープンG | 6 | `[62, 59, 55, 50, 43, 38]` | <!-- req 02:29b39f3b.d4ac --> |
| `builtin-guitar-open-d` | オープンD | 6 | `[62, 57, 54, 50, 45, 38]` | <!-- req 02:6c0e4797.d10c --> |
| `builtin-bass-standard` | ベース標準（EADG） | 4 | `[43, 38, 33, 28]` | <!-- req 02:969a76a9.641c --> |
| `builtin-bass-drop-d` | ベース ドロップD | 4 | `[43, 38, 33, 26]` | <!-- req 02:96d2f35d.6952 --> |
| `builtin-bass-standard-5` | ベース5弦レギュラー（BEADG） | 5 | `[43, 38, 33, 28, 23]` | <!-- req 02:6a6215e5.5811 --> |
| `builtin-bass-standard-6` | ベース6弦レギュラー（BEADGC） | 6 | `[48, 43, 38, 33, 28, 23]` | <!-- req 02:c9d0fe9a.2214 --> |

- 組み込みの id は `builtin-<楽器>-<名称>` の形とする。 <!-- req 02:67f81b27.2ba8 --> `builtin-` は、利用者のプリセットと重ならないための予約の接頭辞とする。 <!-- req 02:67f81b27.a5a4 --> (b) 予約は、利用者のプリセットの id の作り方で守る。利用者のプリセットの id は `TuningPresetService.create` が `user-` と UUID（`crypto.randomUUID()`）をつないで作り、利用者が id を入れる所は設けないので、`builtin-` で始まる id はできない。今のコードもこの作り方で、id を確かめる手順とエラーコードを足さずに済むため。
- 組み込みは `tuning-presets.json` に保存せず、アプリに同梱する。 <!-- req 02:bbc527f3.9657 --> 組み込みは論理削除の対象にしない。 <!-- req 02:bbc527f3.cded --> 利用者のプリセットを消すのは `TuningPresetService.delete(presetId)`（`isDeleted` を立てて `deletedAt` を書く）、消した直後の「元に戻す」は `restore(presetId)`（2 つを外す）、一覧は `list()`（消した印のあるものを除く）、溜まった印のあるものを消すのは `purgeExpired()` とする（今のコードの `packages/core/src/parts/TuningPresetService.ts` の形。[[../basic_design/13_design_decision_points.md#3]] B27）。消す・戻すは `CommandHistory` を通らない（曲に属さないデータのため）。7 日と 20 件の決まりと、消す時機は [[data-model-persistence.md#13]] の 13.4 節。 <!-- req 13:b11ac464.c750 --> <!-- req 13:470a60c3.0d03 -->
- 7 弦ギターのプリセットは同梱しない。 <!-- req 02:2f1534c4.f667 --> 5 弦ベースは `builtin-bass-standard-5` <!-- req 02:2f1534c4.6308 -->、6 弦ベースは `builtin-bass-standard-6` として、上の表のとおり同梱する。 <!-- req 02:2f1534c4.74c9 --> 同梱するのは上の表のものだけとし、5・7・8 弦ギターと 3 弦ベースは、ユーザー定義のプリセットか弦本数の単独変更（2.5 節の `SetStringCountCommand`）で対応する（基本設計 02 章 3.7 節）。 <!-- req 02:2f1534c4.c991 --> <!-- req 02:2f1534c4.6f53 --> <!-- req 02:2f1534c4.51fb -->
- 今のコードの組み込み（`BUILTIN_TUNING_PRESETS`、`packages/core/src/parts/TuningPresetService.ts`）は 6 種で、ドロップC#・ドロップB・オープンG・オープンD・ベース5弦レギュラー・ベース6弦レギュラーが無い（[[00_reference.md#8.1]] の G70）。

### 3.4 プリセットを扱うクラス

```ts
// packages/core/src/parts/TuningPresetService.ts
/** 消した印のある利用者のプリセットを残す日数と件数。値は data-model-persistence.md の 13.4 節が正で、コードではここにだけ持つ。 */
export const PRESET_TRASH_RETENTION_DAYS: number;
export const PRESET_TRASH_MAX_ENTRIES: number;
/** 3.3 節の表の 12 種。tuning-presets.json には書かない。 */
export const BUILTIN_TUNING_PRESETS: readonly TuningPreset[];
/** アプリ全体で 1 つ（プリセットは曲に属さない。3.1 節）。 */
export class TuningPresetService {
  constructor(store: TuningPresetStore, reporter: NotificationReporter, now?: () => Date);
  /** 組み込みと利用者のプリセット。消した印のあるものは除く。 */
  list(): Promise<TuningPreset[]>;
  /** 消した印のあるものも含む、利用者のプリセット。 */
  listIncludingDeleted(): Promise<TuningPreset[]>;
  /** id は `user-` と crypto.randomUUID() をつないで作る（3.3 節）。 */
  create(name: string, stringPitches: number[]): Promise<TuningPreset>;
  /** isDeleted を立てて deletedAt を書き、purgeExpired を呼ぶ。組み込みの id では何もしない。 */
  delete(presetId: string): Promise<void>;
  /** isDeleted と deletedAt を外す。 */
  restore(presetId: string): Promise<void>;
  /** 残す日数を過ぎたものと、件数を超えた分の古いものを消す。戻り値は消した数。 */
  purgeExpired(): Promise<number>;
  /** その曲の CommandHistory へ ApplyTuningPresetCommand を発行する。弦本数がそのパートの楽器の範囲の外なら EDIT-013 を知らせて発行しない（2.1 節）。プリセットのいちばん高い弦が maxStringPitch(そのパートの capoFret) を超えるときは、発行せずに @throws RangeError（2.6 節、画面では選べない形で、起きればアプリの不具合）。 */
  applyPreset(target: EditTarget, history: CommandHistory, trackIndex: number, preset: TuningPreset): void;
  /** そのパートの今のチューニングの写し（新規曲作成とパート追加の「今あるパートのチューニングを写す」）。プリセットとしては保存しない。 */
  snapshotTuningFrom(target: EditTarget, trackIndex: number): { stringPitches: number[] };
}

// packages/core/src/parts/TuningPresetStore.ts
/** 利用者のプリセットのファイル（tuning-presets.json、data-model-persistence.md の 13.4 節）を読み書きする。 */
export class TuningPresetStore {
  constructor(adapter: FileSystemAdapter);
  /** 消した印のあるものも含む。ファイルが無ければ空の配列。 */
  load(): Promise<TuningPreset[]>;
  save(presets: TuningPreset[]): Promise<void>;
}
```

- (b) プリセットを当てるときの弦本数の確かめ（`EDIT-013`）は `applyPreset` の中で行い、`ApplyTuningPresetCommand` は確かめ済みの値を受ける。パートの属性の確かめを、コマンドを発行する前に置く 2.6 節の形にそろえるため。
- 今のコードとの違い：`applyPreset` は弦本数と弦の音の高さの上限を確かめずに発行し、知らせの口は同じ形の `TuningReporter` という名前で持つ。組み込みは G70。本書の形に直すのは実装の段（[[00_reference.md#8.1]] の G78）。 <!-- req 13:468fb76f.c5a4 -->
