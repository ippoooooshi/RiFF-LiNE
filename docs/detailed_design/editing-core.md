# タブ譜編集コア 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 4「タブ譜編集コア」
- **ブランチ名**：`feature/editing-core`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

1 節（スコープ）は基本設計 04 章の回に書く。

## 2. コマンド層と操作の履歴

[[../basic_design/01_architecture.md#3]] AD-2 を受ける。置き場所は `packages/core/src/editing/commands`（[[web-core-foundation.md#2]] の 2.3）。基本設計 04 章 8 節の中身（破棄の手順・通知・複合コマンド・具象コマンドの一覧）は、04 章の回に本節へ足す。

### 2.1 決まり

- 画面（`packages/ui-desktop` と `packages/core/src/ui`）は `Score` を直接書き換えない。画面が呼べるのは `EditingService` のメソッドだけで、`EditingService` がコマンドを作って `CommandHistory.execute` に渡す。 <!-- req 01:10ffca23.8ffd -->
- `Score` を変えるのは `Command.execute()` と `Command.undo()` の中だけとする。`EditingService` も `CommandHistory` も `Score` を直接は変えない。 <!-- req 01:10ffca23.e832 -->
- コマンドは、実行（`execute`）と、それを打ち消す取り消し（`undo`）の対を必ず持つ（2.2 節の `Command`）。 <!-- req 01:10ffca23.b416 -->
- コマンド層（`packages/core/src/editing/commands`）は、画面のモジュール・`react`・alphaTab の描画と再生の API（`AlphaTabApi` とその下）を import しない。使ってよいのは alphaTab のデータの型（`alphaTab.model`）だけとする。描き直しは `RenderRequester`（2.2 節）を注入で受けて頼む。(b) AD-1 で `Score` 自体が alphaTab のデータなので、「alphaTab に依存しない」はデータの型を除いた描画と再生の API のこととして当てはめた。 <!-- req 01:ee5b3592.7396 -->
- 編集コアの自動テストは、コマンドと `CommandHistory` の単体テストを中心に置く。各コマンドの `execute` と `undo` の対称性は、[[../basic_design/11_test_strategy.md#3]] のとおり C2（条件網羅）まで確かめる。`RenderRequester` と通知を差し替えて、描画と画面を使わずに走らせる。 <!-- req 01:ee5b3592.648e -->
- コマンドの `execute()` と `undo()` は、メモリの中の `Score` とサイドカーへの同期の小さな変更だけを行い、ファイルの I/O を伴わない。保存は自動保存がコマンドの外で非同期に行う（[[web-core-foundation.md#10]] の 10.4 節、基本設計 09 章 1 節の入力の反応 100ms のため）。 <!-- req 09:de1ace60.51ef -->

### 2.2 型とメソッド

コマンドの型は次の `Command` インターフェースで決める。具象コマンドはこれを実装する。 <!-- req 01:3e762689.d729 -->

```ts
// packages/core/src/editing/commands/Command.ts
export interface Command {
  /** 履歴の中で種類を見分ける名前（例 'place-note'）。 */
  readonly kind: string;
  /** 取り消し・やり直しで利用者に見せるラベル（例「音符を配置」）。 */
  readonly label: string;
  /** この変更が及ぶパートの番号（描き直しで使う）。 */
  readonly affectedTrackIndices: readonly number[];
  /** Score とサイドカーに変更を当てる。CommandHistory が二度は呼ばない。 */
  execute(): CommandOutcome;
  /** execute の変更を打ち消す。 */
  undo(): CommandOutcome;
  /** 直前の履歴と 1 つにまとめられるか（任意。無ければまとめない）。 */
  canMergeWith?(other: Command): boolean;
  /** other（古いほう）を this に取り込む（任意）。 */
  mergeWith?(other: Command): void;
  /** 履歴に積んだときの推定サイズ（バイト）。2.3 節の 80MB の判定に使う。 */
  estimateSizeBytes(): number;
}
```

`CommandHistory` のメソッドの構成は次のとおり。編集ウィンドウ（開いている曲）ごとに 1 つ作る。 <!-- req 01:3e762689.9d10 -->

```ts
// packages/core/src/editing/commands/CommandHistory.ts
/** ScoreRenderHost のうち CommandHistory が使う所だけ（テストで差し替える）。 */
export interface RenderRequester { render(trackIndices?: number[]): void; }

export class CommandHistory {
  constructor(render: RenderRequester, reporter: NotificationReporter, options?: CommandHistoryOptions);
  execute(command: Command): CommandOutcome;
  undo(): CommandOutcome;
  redo(): CommandOutcome;
  canUndo(): boolean;
  canRedo(): boolean;
  dispose(): void;
}
```

`CommandOutcome`・`NotificationReporter`・`CommandHistoryOptions` の中身と、購読のメソッドは、基本設計 04 章の回に本節へ足す。

### 2.3 履歴の深さ（80MB と 200 件）

```ts
export const DEFAULT_MEMORY_BUDGET_BYTES = 80 * 1024 * 1024;  // C11
export const MIN_RETAINED_ENTRIES = 200;                       // C11 の下限
```

- 1 つの `CommandHistory` の undo と redo の 2 つのスタックに積んだコマンドの `estimateSizeBytes()` の合計を、80MB（`DEFAULT_MEMORY_BUDGET_BYTES`）までとする。超えたら古いほうから捨てる。 <!-- req 01:10ffca23.6fcc --> <!-- req 09:64bbc678.49f8 --> <!-- req 09:64bbc678.ab55 -->
- ただし、80MB を超えていても、直近 200 件（`MIN_RETAINED_ENTRIES`）の操作履歴は必ず残す。 <!-- req 01:10ffca23.2b63 --> <!-- req 09:64bbc678.3bdb -->
- 各コマンドは、原則として変更の差分だけを持ち、コマンドごとに `Score` 全体の写しを作らない。パート全体を持つ例外のコマンドとその一覧は、基本設計 04 章の回に本節へ足す。 <!-- req 09:64bbc678.4afa -->

### 2.4 描き直しを頼む所

- コマンドは `Score` を変えるだけで、描き直しは頼まない（`RenderRequester` を持たない）。`Score.finish()` も呼ばない（[[../basic_design/13_design_decision_points.md#3]] B33）。 <!-- req 01:c7779337.1cab -->
- 描き直しは `CommandHistory` だけが頼む。 <!-- req 01:c7779337.92c5 -->
- `execute(command)` の順番：コマンドの `execute()` → undo のスタックに積む → redo のスタックを空にする → `render(command.affectedTrackIndices)` を頼む。 <!-- req 01:c7779337.b937 -->
- `undo()` の順番：undo のスタックから取り出したコマンドの `undo()` → redo のスタックに積む → `render(そのコマンドの affectedTrackIndices)` を頼む。 <!-- req 01:c7779337.bc90 -->
- `redo()` の順番：redo のスタックから取り出したコマンドの `execute()` → undo のスタックに積む → `render(そのコマンドの affectedTrackIndices)` を頼む。どの操作でも、描き直しは操作の最後に 1 回だけ頼む。 <!-- req 01:c7779337.1b57 -->

(b) 描き直しを `CommandHistory` の 1 か所で頼むのは、コマンドを書く人が描き直しを忘れる余地をなくすため。

### 2.5 モデルとコマンドの対応を検算する

- モデル（`Score` とサイドカー）の変更できる項目には、それぞれ対応するコマンドを必ず 1 つ置く。編集しない項目は「編集不可（理由）」と書く。 <!-- req 01:5e051848.1cda -->
- これが満たされていることは、宣言ではなく検算で確かめる。検算は、[[../basic_design/12_traceability.md#6]] の対応表の「変更経路」列にあるコマンドの名前が、本書の具象コマンドの一覧（04 章の回に書く）にすべてあり、一覧のコマンドがすべて表のどこかの行にあることを突き合わせて行う。 <!-- req 01:97bfa2dd.a2e4 -->
- 対応表は [[../basic_design/12_traceability.md#6]] に置き、「変更経路」列を空けない（12 章 6.3 節の運用）。コマンドを足す・項目を足すときは、同じ変更の中で表の行を足す。 <!-- req 01:97bfa2dd.f557 -->

## 3. モデルの項目と変更するコマンド

[[../basic_design/02_data_model.md#3.3]] と [[../basic_design/02_data_model.md#3.4]] を受ける。項目の alphaTab での置き場所の一覧は [[data-model-persistence.md#4]] の対応表にあり、本節はそこから先の決まり（継ぎ方・写し方・変えるコマンド）を書く。コマンドの引数・確かめ・`undo` の中身と、画面から呼ぶ所は、基本設計 04 章の回に本書へ足す。

### 3.1 小節から音符までの階層

- 小節から音符までは、alphaTab の階層（`Bar` → `Voice` → `Beat` → `Note`）をそのまま使い、自前の階層を作らない。 <!-- req 02:cd4824a2.379b -->
- 付点は `Beat.dots` で <!-- req 02:cd4824a2.688e -->、連符は `Beat.tupletNumerator`・`Beat.tupletDenominator` で表す。 <!-- req 02:cd4824a2.70d9 --> スラーはタイと別の属性で持ち、2 つを区別する（3.4 節）。 <!-- req 02:cd4824a2.aff1 -->
- ボイスは 1 小節に 1 つ（`Bar.voices` の 1 つ目）を基本とする。 <!-- req 02:ebdc240b.d89c --> 低音とメロディのように同時に鳴る別の線を分けて書くために、2 つ目のボイスを置ける。 <!-- req 02:ebdc240b.cbff --> (b) 2 つ目は `Bar.voices` の 2 つ目に置く。alphaTab の `Bar` が、同じ小節の複数のボイスを `voices` の並びで持つため。
- 2 つ目のボイスがあるときのカーソルの動き <!-- req 02:69ced3a2.b3a6 -->と、コピーと貼り付けの扱いは <!-- req 02:69ced3a2.7d35 -->、基本設計 03 章と 04 章の回に本書へ書く。2 つ目のボイスの入力と再生の扱いも、03 章から 05 章の回に書く。

### 3.2 小節の拍子とテンポ

- 拍子（論理名 `Bar.timeSignature`）は、値が無い（null）小節では直前の小節の値を継ぐ。 <!-- req 02:b12a9f13.5dfb --> テンポ（論理名 `Bar.tempoBpm`）も、値が無い小節では直前の小節の値を継ぐ。 <!-- req 02:b12a9f13.268f --> 小節を足したときと消したときの継ぎ方は [[../basic_design/13_design_decision_points.md#3]] B5 のとおりで、コマンドの中身は基本設計 04 章の回に書く。
- 拍子とテンポは曲共通で、実体は alphaTab の `MasterBar`（`Score.masterBars`）が持つ。拍子は `timeSignatureNumerator`・`timeSignatureDenominator`、テンポは `tempoAutomations`。 <!-- req 02:b12a9f13.a059 -->
- (b) テンポの「継ぐ」は、その小節の `MasterBar.tempoAutomations` を空にして表す。テンポを変える小節にだけ `tempoAutomations` を置き、置かない小節は直前のテンポが続く。継ぐ状態へ戻すときは、その小節の `tempoAutomations` を空にする。alphaTab の `MasterBar` がテンポの変わり目だけを `tempoAutomations` に持つので、置くか置かないかがそのまま「値が有るか無いか」になるため。

**注（基本設計に無いもの）**：拍子の「直前を継ぐ」を、alphaTab と曲のファイルのどこに持つかは、基本設計に書かれていないので本書では決めない。alphaTab の `MasterBar` は拍子の値を小節ごとに必ず持ち、継ぐかどうかの印を持つ所が無い（alphaTab 1.8.4 の型定義で確かめた）。曲のファイルの `appMeta` に入れるものは、基本設計 02 章 4.1 節の 5 つに限る。作り直す前の本書は、`AppMetadata` の側に継ぐ印を持つとしていた。

### 3.3 音価と休符

- 音価（論理名 `Beat.duration`）は、音符の長さ（`Beat.duration`）・付点の数（`Beat.dots`）・連符（`Beat.tupletNumerator`・`Beat.tupletDenominator`）の組で表し、32 分音符と 3 連符も表せる。 <!-- req 02:5962c4c2.7166 --> 音符の長さは、全音符（`Duration.Whole`）から 32 分音符（`Duration.ThirtySecond`）までの 6 つに限る。 <!-- req 02:5962c4c2.8452 -->
- 休符は、音符を持たない Beat（`Beat.notes` が空）で表す。alphaTab の `Beat.isRest` は読み取り専用で、そのとき真になる。
- 小節の中で音を置かない位置は、自動で休符の Beat にする。 <!-- req 02:5ceee7ef.0930 --> 休符の Beat は、画面から明示して置くことも消すこともできる（3.8 節の表）。 <!-- req 02:5ceee7ef.7d5f -->

### 3.4 タイとスラー

- タイ（論理名 `Note.tieToNext`）とスラー（論理名 `Note.slurGroupId`）は別の属性で持ち、譜面ではタイとスラーを別の記号として描き分ける（描くのは alphaTab）。 <!-- req 02:a44049aa.78b1 -->
- スラーの無い音符では、`slurGroupId` は空（null）でよい。 <!-- req 02:a44049aa.8bd9 -->
- (b) alphaTab の `Note` への写し方は次のとおり。 <!-- req 02:a44049aa.b2c2 --> alphaTab の `Note` はタイとスラーを、始まりの音符と終わりの音符をつなぐ参照で持ち、グループの番号の項目を持たないため。今のコード（`packages/core/src/editing/commands/noteAttributeCommands.ts`）も同じ写し方をしている。
  - タイ：音符 A の `tieToNext` が真のとき、同じ弦の次の音符 B の `isTieDestination` を真にし、`B.tieOrigin` に A を、`A.tieDestination` に B を入れる
  - スラー：同じ `slurGroupId` を持つ音符のうち、最初の音符 A と最後の音符 B をつなぐ。`A.slurDestination` に B を、`B.slurOrigin` に A を入れ、`B.isSlurDestination` を真にする。`slurGroupId` が空の音符には、どれも入れない

### 3.5 奏法記号とアーティキュレーション

- 奏法記号（論理名 `Note.techniques`）は、要件4.1「奏法記号フルセット」の一覧を受ける構造として <!-- req 02:240d4a1a.4aca -->、`Note` の属性と `Beat` の属性に分けて持ち、一覧のどれも漏らさずどちらかで持つ（下の表）。 <!-- req 02:adeeb869.2bbb -->

| 要件4.1 の奏法記号 | 持つ所 | alphaTab の属性 |
|---|---|---|
| チョーキング | Note | `Note.bendType`・`Note.bendPoints`（幅の値は基本設計 04 章の回） <!-- req 02:adeeb869.704d --> |
| スライド | Note | `Note.slideOutType` <!-- req 02:adeeb869.1511 --> |
| ハンマリング | Note | `Note.isHammerPullOrigin`（始まりの音符に立てる） <!-- req 02:adeeb869.df5f --> |
| プリング | Note | `Note.isHammerPullOrigin`（始まりの音符に立てる） <!-- req 02:adeeb869.72bf --> |
| パームミュート | Note | `Note.isPalmMute` <!-- req 02:adeeb869.52e1 --> |
| ビブラート | Note | `Note.vibrato`（`VibratoType`。付けるときの値は基本設計 04 章の回） <!-- req 02:adeeb869.d56b --> |
| ハーモニクス 3 種 | Note | `Note.harmonicType` の `Natural`（自然）・`Artificial`（人工）・`Pinch`（ピンチ） <!-- req 02:adeeb869.6efe --> |
| タッピング | Beat | `Beat.tap` <!-- req 02:adeeb869.20e0 --> |
| スラップ | Beat | `Beat.slap` <!-- req 02:adeeb869.e5e6 --> |
| ポップ | Beat | `Beat.pop` <!-- req 02:adeeb869.1693 --> |
| ブラシ | Beat | `Beat.brushType` |

- タッピング・スラップ・ポップは、Note ではなく Beat の属性として持つ（[[../basic_design/13_design_decision_points.md#3]] B40。alphaTab でも Beat の属性のため）。 <!-- req 02:dd2351e6.68ba --> ブラシも、Note ではなく Beat の属性として持つ。 <!-- req 02:dd2351e6.3f0f -->
- ハンマリングとプリングは、alphaTab では 1 つの属性 `isHammerPullOrigin` で持つ（alphaTab 1.8.4 の型定義に、2 つを分ける属性は無い）。
- スライドの種類は、シフト（`SlideOutType.Shift`） <!-- req 02:b798fe87.9d73 -->・レガート（`SlideOutType.Legato`） <!-- req 02:b798fe87.ce4c -->・下へのスライドアウト（`SlideOutType.OutDown`） <!-- req 02:b798fe87.33ad -->・上へのスライドアウト（`SlideOutType.OutUp`）の 4 つとする。 <!-- req 02:b798fe87.73ae -->
- パームミュートの範囲は、その音だけ <!-- req 02:b798fe87.f9e8 -->と、次の音まで <!-- req 02:b798fe87.721a -->の 2 つとする。alphaTab の `Note.isPalmMute` は音符ごとの真偽の値だけを持つので、2 つの範囲の写し方は、手で選ぶ操作と合わせて基本設計 04 章の回に書く。
- 奏法記号を確定する操作（自動の候補と、長押しや手での補正）は、基本設計 04 章の回に本書へ書く。 <!-- req 02:668dcc88.4e4a -->
- アーティキュレーション記号（論理名 `Note.accent`）は、アクセントとスタッカートを含む記号を表す項目で <!-- req 02:e15deba0.a014 -->、次の 5 つに限り、増やさない。 <!-- req 02:e15deba0.f080 --> <!-- req 02:7ae5b265.281a -->

| 記号 | alphaTab の属性 |
|---|---|
| アクセント | `Note.accentuated` の `Normal` <!-- req 02:7ae5b265.9034 --> |
| 強いアクセント | `Note.accentuated` の `Heavy` <!-- req 02:7ae5b265.157e --> |
| テヌート | `Note.accentuated` の `Tenuto` <!-- req 02:7ae5b265.e4d8 --> |
| スタッカート | `Note.isStaccato` <!-- req 02:7ae5b265.416f --> |
| ゴースト | `Note.isGhost` <!-- req 02:7ae5b265.84ac --> |

- 5 つとも、付けるのも <!-- req 02:c147cd92.fa50 -->外すのも <!-- req 02:c147cd92.ba50 -->同じ `SetTechniqueCommand` で行う。 <!-- req 02:c147cd92.6e3c --> 外すときは、`accentuated` を `None`、`isStaccato` と `isGhost` を偽にする指定を送る。

### 3.6 打楽器（v2 のドラム）への備え

- パートの種別は、v1 から `Part.instrumentType` の列挙で抽象化して持つ（[[part-tuning-management.md#2]]）。 <!-- req 02:54c83d89.1560 --> 将来ドラムを足しても、データモデルを作り直さずに済む形にする。 <!-- req 02:54c83d89.1770 -->
- 打楽器かどうかは alphaTab の `Staff.isPercussion` で表し <!-- req 02:853d96e1.1976 -->、打楽器の種類は `Note.percussionArticulation` で表す。 <!-- req 02:853d96e1.0c96 --> v1 では、種別を表す属性を自前で足さない。 <!-- req 02:057b03cc.000a --> v2 で `instrumentType` に値を足して `Staff.isPercussion` を立てる中身は、基本設計 10 章の回に書く。

### 3.7 同じ弦の重複

- 同じ Beat に同じ弦（論理名 `stringIndex`、alphaTab の `Note.string`）の音符を足す操作は、コマンド層の確かめで拒否する（Error）。 <!-- req 02:dfbace79.6791 --> 確かめる所・エラーコード・画面での知らせ方は、基本設計 04 章の回に本書へ書く。

### 3.8 項目と変えるコマンドの対応

- 本節の項目には、それぞれ変えるコマンドを 1 つ置くか、「編集不可」と書く。 <!-- req 02:91f21b28.568a --> 対応は [[../basic_design/12_traceability.md#6]] の対応表で一元に管理し、2.5 節の検算で確かめる。 <!-- req 02:91f21b28.5a40 -->

| 項目 | 変えるコマンド | 今のコード |
|---|---|---|
| `Bar.timeSignature` | `SetTimeSignatureCommand` <!-- req 02:7ec33f19.1d9b --> | 無い（[[00_reference.md#8.1]] G26） |
| `Bar.tempoBpm` | `SetTempoCommand`。値を空にすると継ぐ状態に戻る（3.2 節） <!-- req 02:f18d4356.30cd --> | ある（`packages/core/src/editing/commands/SetTempoCommand.ts`） |
| `Beat.duration`（音符の長さ・付点・連符） | 今ある Beat は `SetBeatDurationCommand` <!-- req 02:edbc887a.b088 -->。新しく置くときは `PlaceNoteCommand` <!-- req 02:edbc887a.d94e -->と `InsertRestCommand` <!-- req 02:edbc887a.87c3 --> | `SetBeatDurationCommand` は無い（G28）。残りの 2 つはある |
| `Beat.isRest` | `InsertRestCommand` <!-- req 02:23b70b50.8efa -->と、休符の位置に音符を置く `PlaceNoteCommand`。 <!-- req 02:23b70b50.82da --> 明示して置いた休符を消すのは、音符を消すのと同じ手段（[[../basic_design/04_editing_core.md#2]]） <!-- req 02:23b70b50.41a1 --> | 前の 2 つはある |
| `Note.tieToNext` | `SetTieCommand` <!-- req 02:c798fc33.2b65 --> | ある |
| `Note.slurGroupId` | `SetSlurCommand` <!-- req 02:c798fc33.2296 --> | ある |
| `Note.techniques`（Note の属性） | `SetTechniqueCommand`（`NoteTechniquePatch` で指定したキーだけを変える） <!-- req 02:391ef28e.7bb4 --> | ある。チョーキング（`bendType`・`bendPoints`）とアクセント（`accentuated`）のキーは無い（G27） |
| 奏法記号のうち Beat の属性 | スラップ <!-- req 02:57b7f63a.bbf1 -->・ポップ <!-- req 02:57b7f63a.8b39 -->・タップ <!-- req 02:57b7f63a.fb02 -->・ブラシ <!-- req 02:57b7f63a.1274 -->は `SetBeatTechniqueCommand` | 無い（G27） |
| `Note.accent` | `SetTechniqueCommand`（`accentuated` のキー） <!-- req 02:d476d2ea.a222 --> | キーが無い（G27） |
| `Part.instrumentType` | `SetPartInstrumentCommand`（[[part-tuning-management.md#2]] の 2.5 節） <!-- req 02:96cbaf97.ab7e --> | 無い（G49） |
| `Part.stringCount` | チューニングプリセットを当てる `ApplyTuningPresetCommand` <!-- req 02:2adebdfc.aca4 -->と、弦本数だけを変える `SetStringCountCommand`（どちらも 2.5 節） <!-- req 02:2adebdfc.7919 --> | 前はある。後は無い（G50） |

- Beat の属性の奏法記号を `SetTechniqueCommand` と別のコマンドにするのは、`SetTechniqueCommand` が弦を指定して Note を変えるのに対し、スラップ・ポップ・タップ・ブラシは弦を持たない Beat の属性だから（B40）。
