# タブ譜編集コア 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 4「タブ譜編集コア」
- **ブランチ名**：`feature/editing-core`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 1. スコープ

[[../basic_design/04_editing_core.md]] を受ける。本書は、編集の中身（コマンドと履歴・モデルの項目と変えるコマンド・カーソルとステップ入力・配置と追加の確かめ・タイとスラー・奏法記号の確定・コード名・範囲選択とクリップボード・小節の挿入と削除と拍子）を書く。画面の部品と、キーとマウスの受け方は [[screens-navigation.md#7]]・[[screens-navigation.md#9]]・[[screens-navigation.md#10]]、パートとチューニングの項目とコマンドは [[part-tuning-management.md#2]]、置いた音を鳴らすことと再生は playback-integration.md（基本設計 05 章の回）が受け持つ。

- 編集の操作は、カーソルとコマンドの 2 つの軸で作る。 <!-- req 04:45f3c331.d6ca -->
- カーソルは、今の入力の位置を表す。 <!-- req 04:45f3c331.88d7 -->
- カーソルの位置は、パート・小節・拍の 3 つの階層で表す（2 つ目のボイスを置ける小節では、3.1 節のとおりボイスを足して表す。型は 4.1 節）。 <!-- req 04:45f3c331.88cf -->
- コマンドは、取り消しとやり直しができる変更の単位とする（2 節）。 <!-- req 04:45f3c331.caa6 -->
- 画面の出来事（クリックとキー）は、`EditingService` の中で、カーソルを動かすかコマンドを発行するかのどちらかに必ず行き着かせる。 <!-- req 04:8cd32bea.1396 -->
- 画面の部品が、モデル（`Score` とサイドカー）を直接書き換えることは禁じる（2.1 節の 1 つ目の決まり）。 <!-- req 04:8cd32bea.2c24 -->

## 2. コマンド層と操作の履歴

[[../basic_design/01_architecture.md#3]] AD-2 を受ける。置き場所は `packages/core/src/editing/commands`（[[web-core-foundation.md#2]] の 2.3）。基本設計 04 章 8 節は、2.2 節・2.3 節・2.6 節で受ける。

### 2.1 決まり

- 画面（`packages/ui-desktop` と `packages/core/src/ui`）は `Score` を直接書き換えない。画面が呼べるのは `EditingService` のメソッドだけで、`EditingService` がコマンドを作って `CommandHistory.execute` に渡す。 <!-- req 01:10ffca23.8ffd -->
- `Score` を変えるのは `Command.execute()` と `Command.undo()` の中だけとする。`EditingService` も `CommandHistory` も `Score` を直接は変えない。 <!-- req 01:10ffca23.e832 -->
- コマンドは、実行（`execute`）と、それを打ち消す取り消し（`undo`）の対を必ず持つ（2.2 節の `Command`）。 <!-- req 01:10ffca23.b416 -->
- コマンド層（`packages/core/src/editing/commands`）は、画面のモジュール・`react`・alphaTab の描画と再生の API（`AlphaTabApi` とその下）を import しない。使ってよいのは alphaTab のデータの型（`alphaTab.model`）だけとする。描き直しは `RenderRequester`（2.2 節）を注入で受けて頼む。(b) AD-1 で `Score` 自体が alphaTab のデータなので、「alphaTab に依存しない」はデータの型を除いた描画と再生の API のこととして当てはめた。 <!-- req 01:ee5b3592.7396 -->
- 編集コアの自動テストは、コマンドと `CommandHistory` の単体テストを中心に置く。各コマンドの `execute` と `undo` の対称性は、[[../basic_design/11_test_strategy.md#3]] のとおり C2（条件網羅）まで確かめる。`RenderRequester` と通知を差し替えて、描画と画面を使わずに走らせる。 <!-- req 01:ee5b3592.648e -->
- コマンドの `execute()` と `undo()` は、メモリの中の `Score` とサイドカーへの同期の小さな変更だけを行い、ファイルの I/O を伴わない。保存は自動保存がコマンドの外で非同期に行う（[[web-core-foundation.md#10]] の 10.4 節、基本設計 09 章 1 節の入力の反応 100ms のため）。 <!-- req 09:4148ac6c.51ef -->

### 2.2 型とメソッド

コマンドの型は次の `Command` インターフェースで決める。具象コマンドはこれを実装する。 <!-- req 01:3e762689.d729 -->

```ts
// packages/core/src/editing/commands/Command.ts
export interface Command {
  /** 履歴の中で種類を見分ける名前（例 'place-note'）。 */
  readonly kind: string;
  /** 取り消し・やり直しで利用者に見せるラベルの id（文言の置き場所は下の箇条）。 */
  readonly label: CommandLabelId;
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

- 画面から `Score` を変える編集の操作は、どれも「コマンド」という単位に集め、2.6 節の具象コマンドのどれかにする。 <!-- req 04:74137166.dd9f -->
- 具象コマンドは、上の `Command` が表す責務（識別と表示・実行・取り消し・まとめられるかの判定・まとめ）を持つものとして作る。 <!-- req 04:d6580c3a.0670 -->
- 基本設計 04 章 8.1 節が詳細設計で決めるとした型とメソッドの形は、本節の `Command` と `CommandHistory`、2.3 節の `CompositeCommand`、2.6 節の具象コマンドで決める。 <!-- req 04:a54ef31f.fe14 -->
- `kind` は、取り消しとやり直しの履歴の中でコマンドを見分ける識別の情報とする。 <!-- req 04:a41877eb.b024 -->
- `label` は、取り消しとやり直しで利用者に見せるラベル（例「音符を配置」）の id とする。 <!-- req 04:a41877eb.c3ac -->
- `execute()` は、`Score` とサイドカーに変更を当てる。 <!-- req 04:e22ddfe0.d2f2 -->
- `undo()` は、`execute()` の変更を打ち消し、変更の前の状態へ戻す。`execute()` と `undo()` の対称性は、各コマンドが自分で保証する（確かめ方は 2.3 節の終わり）。 <!-- req 04:506d4082.0af8 --> <!-- req 04:506d4082.0bee --> <!-- req 04:506d4082.667a -->
- `canMergeWith` は、続けて起きる同じ種類の細かい操作（4.2 節の 2 桁のフレットの書き換え）を、履歴の 1 つの項目へまとめられるかを判定する。 <!-- req 04:7781263d.160b -->
- `mergeWith` は、まとめられると判定された 2 つのコマンドを 1 つにまとめる。2 つとも任意で、持たないコマンドはまとめない。 <!-- req 04:20c7ccab.6bd2 -->
- (b) `label` の型は `CommandLabelId`（`packages/core/src/editing/commands/Command.ts` の文字列の並び。2.6 節の各コマンドの id）とし、日本語の文言は `packages/ui-desktop` の `COMMAND_LABELS`（`Record<CommandLabelId, string>`）に置く。画面の文言を書いてよい所を 2 か所に限る [[screens-navigation.md#1]] の決まりに合わせるため。今のコードは `label` に日本語を直に持っていて、ここと違う。直すのは実装の段。
- (b) 文言が 2 か所の外に無いことは、単体テスト `packages/core/src/i18nGuard.test.ts` で見張る。テストは `packages/core/src` と `packages/shared-types/src` の `.ts` と、`apps/desktop/src` の `.ts` と `.tsx`（どれもテストのファイルを除く）を読み、コメントを除いた文字列のリテラルに、ひらがな・カタカナ・漢字が無いことを確かめる。除くのは、`ErrorCodeRegistry` のメッセージテンプレートを置くファイル 1 つだけとする。文言が紛れ込んだときに、ビルドの前に落ちるようにするため（[[screens-navigation.md#1]] の宿題のうち、`Command.label` の分はここで決めた）。`apps/desktop/src` は 2026-10-14 に足した。シェルはメニューの項目の名前（[[screens-navigation.md#8]] の 8.3 節）とフリーズの確かめのダイアログの文言（[[error-logging-foundation.md#2]] の 2.3 節）を `packages/ui-desktop` から import して使い、自分では文言を持たないので、メニューの分の見張りもこのテストで行うため（[[screens-navigation.md#1]] の宿題のうち、メニューの分）。

`CommandHistory` のメソッドの構成は次のとおり。編集ウィンドウ（開いている曲）ごとに 1 つ作る。 <!-- req 01:3e762689.9d10 -->

```ts
// packages/core/src/editing/commands/CommandHistory.ts
/** ScoreRenderHost のうち CommandHistory が使う所だけ（テストで差し替える）。 */
export interface RenderRequester { render(trackIndices?: number[]): void; }
/** NotificationCenter.report のうち CommandHistory が使う所だけ。 */
export interface NotificationReporter { report(code: string, context?: Record<string, unknown>): void; }
export interface CommandHistoryOptions {
  /** 既定は DEFAULT_MEMORY_BUDGET_BYTES（2.3 節）。 */
  memoryBudgetBytes?: number;
  /** 既定は MIN_RETAINED_ENTRIES（2.3 節）。 */
  minRetainedEntries?: number;
  /** 変更のたびに呼ぶ（自動保存の AutoSaveScheduler をつなぐ。data-model-persistence.md 15 節）。 */
  onChange?: () => void;
}

export class CommandHistory {
  constructor(render: RenderRequester, reporter: NotificationReporter, options?: CommandHistoryOptions);
  execute(command: Command): CommandOutcome;
  undo(): CommandOutcome;
  redo(): CommandOutcome;
  canUndo(): boolean;
  canRedo(): boolean;
  /** 取り消しとやり直しのボタンの押せる状態を直すための購読。戻り値で外す。 */
  subscribe(listener: () => void): () => void;
  /** 曲の変更を知りたい所（コード名の推し直し 8 節、再生の同期 05 章の回）の購読。戻り値で外す。 */
  onCommandApplied(listener: (event: CommandAppliedEvent) => void): () => void;
  dispose(): void;
}

// packages/core/src/editing/types.ts
export interface CommandOutcome {
  /** 実行の後のカーソルの動き。PlaceNoteCommand と InsertRestCommand の execute は 'beat'、それ以外と undo は 'none'（4.2 節）。 */
  cursorAdvance: 'beat' | 'none';
}
export interface CommandAppliedEvent {
  /** redo は中では execute を呼び直すが、購読する側が見分けられるように別の値にする。 */
  phase: 'execute' | 'undo' | 'redo';
  kind: string;
  affectedTrackIndices: readonly number[];
}
```

- `execute`・`undo`・`redo` の順番は 2.4 節のとおりで、描き直しを頼んだ後に `onChange` を呼び、最後に `onCommandApplied` の購読と `subscribe` の購読に知らせる。
- (b) `CommandHistory` は、`execute` のときに新しいコマンドの `canMergeWith` に直前の項目のコマンドを渡し、真なら新しいコマンドの `mergeWith` で直前の項目を取り込んで、直前の項目と置き換える（新しい項目を積まない）。まとめられる操作を履歴の 1 つの項目にするため。

### 2.3 履歴の深さ（80MB と 200 件）

```ts
export const DEFAULT_MEMORY_BUDGET_BYTES = 80 * 1024 * 1024;  // C11
export const MIN_RETAINED_ENTRIES = 200;                       // C11 の下限
```

- 1 つの `CommandHistory` の undo と redo の 2 つのスタックに積んだコマンドの `estimateSizeBytes()` の合計を、80MB（`DEFAULT_MEMORY_BUDGET_BYTES`）までとする。超えたら古いほうから捨てる。 <!-- req 01:10ffca23.6fcc -->
- ただし、80MB を超えていても、直近 200 件（`MIN_RETAINED_ENTRIES`）の操作履歴は必ず残す。 <!-- req 01:10ffca23.2b63 --> <!-- req 09:92a2b4b1.3bdb -->
- 各コマンドは、原則として変更の差分だけを持ち、コマンドごとに `Score` 全体の写しを作らない。パート全体を持つ例外のコマンドは下の箇条。 <!-- req 09:92a2b4b1.4afa -->
- `CommandHistory` は、編集ウィンドウ（開いている曲）ごとに 1 つ作る。 <!-- req 04:c567ee31.e938 -->
- 1 つの `CommandHistory` の中で、その曲の全部のパートの操作を 1 つの履歴にする（パートごとに分けない）。 <!-- req 04:c567ee31.f8f2 -->
- `CommandHistory` を置く層は、基本設計 01 章 2 節の表のとおりコマンド層の内側（`packages/core/src/editing/commands`、[[web-core-foundation.md#2]] の 2.3）とする。
- 新しいコマンドを実行したら、redo のスタックを空にする（2.4 節の `execute` の順番）。 <!-- req 04:cda91762.3dec -->
- 各コマンドは、原則として変更の差分（パッチ）だけを持つ。 <!-- req 04:ba3434d3.338f -->
- コマンドごとに `Score` 全体の写し（スナップショット）を作らない。 <!-- req 04:ba3434d3.cb62 -->
- 例外は、パートを消す `RemovePartCommand` で、取り消しで戻すためにパート全体（最大 2048 小節）を持つ。小節を消す `DeleteBarCommand` も、消した小節の全部のパートの中身を持つので大きくなる。 <!-- req 04:ba3434d3.b91a --> <!-- req 09:92a2b4b1.9e4b -->
- 履歴の大きさは、予算制・下限の保証・一番古い項目からの破棄の 3 つを組み合わせて抑える。 <!-- req 04:2c5d7e8e.7681 --> <!-- req 04:2c5d7e8e.2658 --> <!-- req 04:2c5d7e8e.9cd6 -->
- 予算は、`CommandHistory` 1 つ（編集ウィンドウ 1 つ）あたり、undo と redo の 2 つのスタックの推定の大きさの合計で 80MB とする（上の 1 つ目の箇条）。 <!-- req 04:46076dc5.5d3b --> <!-- req 09:92a2b4b1.49f8 -->
- 予算を超えていても、直近の 200 件は必ず残す（上の 2 つ目の箇条）。 <!-- req 04:65918cf3.3b31 -->
- 新しいコマンドを積んだときに、推定の合計が予算を超えていたら、破棄の対象にする。 <!-- req 04:ff57e6f1.0963 -->
- 破棄するのは、undo のスタックの件数が下限（200 件）より多いときに限る。 <!-- req 04:ff57e6f1.5ad0 -->
- undo のスタックの一番古い項目から順に捨てる。 <!-- req 04:ff57e6f1.f56b -->
- 捨てるのは、合計が予算の中に入るか、件数が下限まで減るまで続ける。 <!-- req 04:ff57e6f1.9c55 --> <!-- req 09:92a2b4b1.ab55 -->
- 1 つのコマンドの推定の大きさだけで予算全体を超えるときも、そのコマンドの実行は拒否しない。 <!-- req 04:2f2d679d.3d1a -->
- 代わりに、別の古い項目を、下限の 200 件を残す範囲でできるだけ捨てて場所を空ける。 <!-- req 04:2f2d679d.479b -->
- 実際に破棄が起きて履歴が捨てられたときは、そのセッションで初めての 1 回だけ、Info の知らせを出す。 <!-- req 04:4eca375e.5aa3 --> <!-- req 08:d74a5a9c.061a -->
- 知らせのコードは `EDIT-008` とする。 <!-- req 04:4eca375e.5cd1 -->
- 知らせはトーストで出す（出し方は [[screens-navigation.md#13]]）。 <!-- req 04:4eca375e.7c51 -->
- 2 回目からの破棄では、知らせを出さない。 <!-- req 04:4eca375e.e86a --> <!-- req 08:d74a5a9c.6f1f -->
- (b) 「初めての 1 回」の印は `CommandHistory` が持ち、編集ウィンドウごとに数える。履歴は窓ごとに別で、窓を閉じると履歴も捨てる（下の箇条）ので、窓ごとの履歴の一生を基本設計の「セッション」に当てたため。窓は別々のレンダラーで動き（[[web-core-foundation.md#6]]）、知らせる中身もその窓の曲の履歴のことなので、アプリ全体で 1 つの印を持つやりとりを足さない。
- 貼り付けや小節の挿入のように、いくつかの変更をまとめて 1 回の取り消しで全部戻す操作は、複数の `Command` を `CompositeCommand` にまとめて履歴の 1 つの項目にする。 <!-- req 04:60fdbf31.caf0 -->
- `CompositeCommand` の推定の大きさは、中のコマンドの推定の大きさの合計とし、予算の計算に入れる。 <!-- req 04:60fdbf31.3785 -->

```ts
// packages/core/src/editing/CompositeCommand.ts
export class CompositeCommand implements Command {
  /** execute は children を前から順に、undo は後ろから順に呼ぶ。affectedTrackIndices は children の和集合。 */
  constructor(kind: string, label: CommandLabelId, children: readonly Command[]);
}
```

- 各コマンドの `execute` と `undo` の対称性は、C2（条件の網羅）まで単体テストで確かめる（2.1 節の 5 つ目の箇条）。 <!-- req 04:cf3e1208.49cc -->
- 予算制・下限の保証・破棄・`EDIT-008` の知らせの分かれ道も、C2 まで単体テストで確かめる。 <!-- req 04:56a6d61c.39c7 --> <!-- req 04:56a6d61c.83c3 --> <!-- req 04:56a6d61c.9763 --> <!-- req 04:56a6d61c.4867 -->
- 履歴は、アプリのプロセスのメモリの中にだけ持つ。 <!-- req 04:4490cb63.c1c1 -->
- 履歴は、ファイルには一切書かない。 <!-- req 04:4490cb63.f8ad -->
- 編集ウィンドウを閉じると、その窓の `CommandHistory` も捨てる（`dispose()`）。曲の中身は、コマンドの後の自動保存（[[data-model-persistence.md#15]]）で守る。 <!-- req 04:4490cb63.aec7 -->

### 2.4 描き直しを頼む所

- コマンドは `Score` を変えるだけで、描き直しは頼まない（`RenderRequester` を持たない）。`Score.finish()` も呼ばない（[[../basic_design/13_design_decision_points.md#3]] B33）。 <!-- req 01:c7779337.1cab -->
- 描き直しは `CommandHistory` だけが頼む。 <!-- req 01:c7779337.92c5 -->
- `execute(command)` の順番：コマンドの `execute()` → undo のスタックに積む → redo のスタックを空にする → `render(command.affectedTrackIndices)` を頼む。 <!-- req 01:c7779337.b937 --> <!-- req 01:9e38ea0c.0482 -->
- `undo()` の順番：undo のスタックから取り出したコマンドの `undo()` → redo のスタックに積む → `render(そのコマンドの affectedTrackIndices)` を頼む。 <!-- req 01:c7779337.bc90 --> <!-- req 01:9e38ea0c.2706 -->
- `redo()` の順番：redo のスタックから取り出したコマンドの `execute()` → undo のスタックに積む → `render(そのコマンドの affectedTrackIndices)` を頼む。どの操作でも、描き直しは操作の最後に 1 回だけ頼む。 <!-- req 01:c7779337.1b57 -->

(b) 描き直しを `CommandHistory` の 1 か所で頼むのは、コマンドを書く人が描き直しを忘れる余地をなくすため。

(b) `Score` のどの項目を変えれば描き直しが安全かを、項目ごとに分けない。どのコマンドの実行と取り消しでも、`CommandHistory` が `affectedTrackIndices` のパートだけを同じやり方で描き直す（[[../basic_design/13_design_decision_points.md#2]] A1、[[web-core-foundation.md#11]] の描き直しの方式）。alphaTab は安全に変えられる項目の一覧を出しておらず、版が上がって境目が変わったときに、項目ごとの分け方だと黙って描き崩れるため。描き直しが入力の反応 100ms（基本設計 09 章 1 節）に収まるかは、実装の段で大きな曲で測る。 <!-- req 01:9e38ea0c.85ec -->

### 2.5 モデルとコマンドの対応を検算する

- モデル（`Score` とサイドカー）の変更できる項目には、それぞれ対応するコマンドを必ず 1 つ置く。編集しない項目は「編集不可（理由）」と書く。曲一覧で変える曲名・アーティスト名・タグの 3 つだけは、コマンドを置かずに「編集の履歴の外で変える（理由）」と書く（基本設計 01 章 AD-2 の 2026-10-09 本人決定、3.8 節）。 <!-- req 01:5e051848.1cda -->
- これが満たされていることは、宣言ではなく検算で確かめる。検算は、[[../basic_design/12_traceability.md#6]] の対応表の「変更経路」列にあるコマンドの名前が、本書の具象コマンドの一覧（2.6 節）にすべてあり、一覧のコマンドがすべて表のどこかの行にあることを突き合わせて行う。 <!-- req 01:97bfa2dd.a2e4 -->
- 対応表は [[../basic_design/12_traceability.md#6]] に置き、「変更経路」列を空けない（12 章 6.3 節の運用）。コマンドを足す・項目を足すときは、同じ変更の中で表の行を足す。 <!-- req 01:97bfa2dd.f557 -->

### 2.6 具象コマンドの一覧

2.5 節の検算で [[../basic_design/12_traceability.md#6]] の「変更経路」の列と突き合わせる一覧。パートとチューニングのコマンドの中身は [[part-tuning-management.md#2]] と [[part-tuning-management.md#3]] が正で、ここでは名前と受け持ちだけを並べる。

| コマンド | 変えるもの | `affectedTrackIndices` | 中身 | 今のコード |
|---|---|---|---|---|
| `PlaceNoteCommand` | 拍へ音符を 1 つ足す（休符の拍は音符の拍へ、音のある拍は和音へ、拍が無ければ新しい拍） | そのパート | 4.2 節・4.7 節 | ある（音価は `model.Duration` だけ、G28） |
| `SetNoteFretCommand` | 置いた音符のフレットを 2 桁に書き換える | そのパート | 4.2 節 | 無い |
| `InsertRestCommand` | 休符の拍を挿入する | そのパート | 4.4 節 | ある |
| `DeleteNotesCommand` | 音符を消す・休符の拍を取り除いて詰める | そのパート | 4.5 節 | 無い |
| `SetBeatDurationCommand` | 今ある拍の音価・付点・連符 | そのパート | 4.3 節 | 無い（G28） |
| `SetTieCommand` | `Note.tieToNext` | そのパート | 6 節 | ある |
| `SetSlurCommand` | `Note.slurGroupId` | そのパート | 6 節 | ある |
| `SetTechniqueCommand` | Note の奏法記号とアーティキュレーション | そのパート | 7.3 節 | ある（チョーキングとアクセントのキーは無い、G27） |
| `SetBeatTechniqueCommand` | Beat の奏法記号 | そのパート | 7.3 節 | 無い（G27） |
| `SetChordNameCommand` | `Beat.text`（コード名の手の値） | そのパート | 8 節 | ある |
| `DeleteSelectionCommand` | 選択範囲の音符を消す（切り取りと削除） | そのパート | 9 節 | 無い |
| `PasteCommand` | クリップボードの拍を挿入する（`CompositeCommand`） | 貼り付け先のパート | 9 節 | ある（1 つのコマンド） |
| `DuplicateSelectionCommand` | 選択範囲の写しを後ろに挿入する | そのパート | 9 節 | 無い |
| `InsertBarCommand` | 全部のパートに小節を足す（`CompositeCommand`） | 全部のパート | 10 節 | ある（1 つのコマンド） |
| `DeleteBarCommand` | 全部のパートから小節を消す（`CompositeCommand`） | 全部のパート | 10 節 | ある（1 つのコマンド） |
| `SetTimeSignatureCommand` | 拍子 | 全部のパート | 10 節 | 無い（G26） |
| `SetTempoCommand` | テンポ | 全部のパート | 3.8 節 | ある（タップテンポをまとめる `tapSessionId` は無い） |
| `SetRepeatCommand` | リピート | 全部のパート | 10 節 | 無い（G26） |
| `AddMemoCommand`・`EditMemoCommand`・`DeleteMemoCommand` | 小節メモ | 無し（`[]`） | 3.10 節 | ある |
| `AddSectionMarkerCommand`・`EditSectionMarkerCommand`・`DeleteSectionMarkerCommand` | セクションマーカー | 全部のパート | 3.10 節・10 節 | ある |
| `AddPartCommand`・`RemovePartCommand`・`ReorderPartsCommand`・`RenamePartCommand` | パートを足す・消す・並べ替える・名前を変える | 全部のパート | 下の箇条、[[part-tuning-management.md#2]] | ある（名前を変えるのは無い） |
| `SetPartColorCommand`・`SetPartInstrumentCommand`・`SetStringCountCommand`・`ApplyTuningPresetCommand`・`SetCustomTuningCommand`・`SetCapoFretCommand` | パートの色・音色・弦本数・チューニング・カポ | そのパート | [[part-tuning-management.md#2]]・[[part-tuning-management.md#3]] | 各節（音色と弦本数だけを変えるのは無い） |

- `AddPartCommand` は、足した後のパートの数を `ValidationService.validatePartCount`（5 節、`EDIT-005`）で確かめてから発行する。足すパートには、曲の全部の小節の数だけ小節を作り、各小節に 4.4 節の休符の拍を置く。
- `RemovePartCommand` は、消したパートの全部（`Track` と、パートごとに持つサイドカーの値）を持ち、取り消しで同じ位置に戻す。パートを消す操作は、取り消し（Ctrl+Z）で戻せる（[[screens-navigation.md#12]] の 12.3 節の確かめは、この箇条で答える）。持つ大きさは小節の数に比べて大きくなるので、`estimateSizeBytes()` を小節の数に比例させ、2.3 節の予算に入れる。
- `ReorderPartsCommand(target, order: readonly number[])` は、`order`（今の並びのインデックスを、新しい並びの順に並べたもの）でパートの並びを替える。`Score.tracks` と、パートごとに持つ値の並び（[[part-tuning-management.md#3]] の 3.1 節の `partPresetIds`）を同じ順に並べ替え、`Track.index` を振り直す。`order` が今のインデックスを 1 つずつ全部含まないときは、何もせずに終える（画面からは起きない形）。`undo` は逆の並べ替えを当てる。描き直しは全部のパートとする。
- (b) 並べ替えを、1 つ動かす操作ではなく新しい並び全体で受けるのは、パート管理パネルのドラッグと「↑」「↓」のボタン（[[screens-navigation.md#12]] の 12.3 節）が、どれも 1 回の操作で 1 つの新しい並びを作るので、同じ形の 1 つのコマンドで受けられるため。
- 一覧のコマンドのうち、型を 2.2 節・4 節・7 節・9 節・10 節と上の箇条に書いていないものは次の形にする。どれも `Command`（2.2 節）を実装し、変える対象を `EditTarget` で受ける。パートのコマンドをいつ発行するかと値の決まりは [[part-tuning-management.md#2]] と [[part-tuning-management.md#3]] が正で、ここでは型だけを決める。

```ts
// packages/core/src/editing/types.ts
/** コマンドが変える対象。曲の Score と、サイドカーのうちコマンドが触る部分（メモとセクションマーカー、3.10 節）。 */
export interface EditTarget { score: model.Score; appMeta: AppMetadata; }
/** 範囲選択（9 節）。1 つのパートの 1 つのボイスの中で、start と end の拍を両端に含む。 */
export interface SelectionRange {
  trackIndex: number;
  voiceIndex: 0 | 1;
  startBarIndex: number;
  startBeatIndex: number;
  endBarIndex: number;
  endBeatIndex: number;
}

// packages/core/src/editing/commands/
export class PlaceNoteCommand implements Command {
  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, fret: number, spec: BeatDurationSpec);
}
export class InsertRestCommand implements Command {
  constructor(target: EditTarget, position: CursorPosition, spec: BeatDurationSpec);
}
export class SetTieCommand implements Command {
  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, tied: boolean);
}
export class SetSlurCommand implements Command {
  constructor(target: EditTarget, range: SelectionRange);
}
export class SetChordNameCommand implements Command {
  /** name が null なら手の値を外す。 */
  constructor(target: EditTarget, position: CursorPosition, name: string | null);
}
export class PasteCommand extends CompositeCommand {
  /** kind 'paste'。子は 9 節の箇条の順。はみ出す弦の音符は子を作らず、EDIT-009 を reporter で知らせる。 */
  constructor(target: EditTarget, position: CursorPosition, snapshot: ClipboardSnapshot, reporter: NotificationReporter);
}
export class InsertBarCommand extends CompositeCommand {
  /** kind 'insert-bar'。子は 10 節の箇条の順。 */
  constructor(target: EditTarget, at: number);
}
export class DeleteBarCommand extends CompositeCommand {
  /** kind 'delete-bar'。子は 10 節の箇条の順。 */
  constructor(target: EditTarget, at: number, disposition: BarDeleteDisposition);
}
export class SetTempoCommand implements Command {
  /** tapSessionId はタップテンポが続けて叩いた分に付ける番号。同じ小節で同じ番号のものだけを canMergeWith でまとめる（playback-integration.md の 11 節）。 */
  constructor(target: EditTarget, barIndex: number, bpm: number | null, tapSessionId?: number);
}
export class AddMemoCommand implements Command {
  constructor(target: EditTarget, barIndex: number, text: string, now?: () => Date);
}
export class EditMemoCommand implements Command {
  constructor(target: EditTarget, memoId: string, nextText: string);
}
export class DeleteMemoCommand implements Command {
  constructor(target: EditTarget, memoId: string);
}
export class AddSectionMarkerCommand implements Command {
  constructor(target: EditTarget, barIndex: number, label: string);
}
export class EditSectionMarkerCommand implements Command {
  constructor(target: EditTarget, markerId: string, nextLabel: string);
}
export class DeleteSectionMarkerCommand implements Command {
  constructor(target: EditTarget, markerId: string);
}

// packages/core/src/parts/commands/structuralPartCommands.ts
export interface NewPartSpec {
  name: string;
  instrumentType: 'electric_guitar' | 'bass';
  /** 開放弦の音の高さ（MIDI ノート番号、高音弦から低音弦）。長さが弦本数。 */
  tuning: number[];
  /** 元にしたプリセット（part-tuning-management.md 3.1 節の partPresetIds に入れる）。 */
  presetId?: string;
  /** 識別色（#RRGGBB）。 */
  colorHex: string;
}
export class AddPartCommand implements Command {
  /** at を省くと最後に足す。 */
  constructor(target: EditTarget, spec: NewPartSpec, at?: number);
}
export class RemovePartCommand implements Command {
  constructor(target: EditTarget, trackIndex: number);
}
export class RenamePartCommand implements Command {
  constructor(target: EditTarget, trackIndex: number, name: string);
}

// packages/core/src/parts/commands/partAttributeCommands.ts
export class SetPartColorCommand implements Command {
  constructor(target: EditTarget, trackIndex: number, hex: string);
}
export class SetPartInstrumentCommand implements Command {
  constructor(target: EditTarget, trackIndex: number, instrumentType: 'electric_guitar' | 'bass');
}
export class SetStringCountCommand implements Command {
  /** 外す弦に音符があれば EDIT-006 を reporter で知らせてから消す。 */
  constructor(target: EditTarget, trackIndex: number, stringCount: number, reporter: NotificationReporter);
}
export class SetCapoFretCommand implements Command {
  constructor(target: EditTarget, trackIndex: number, capoFret: number);
}

// packages/core/src/parts/commands/tuningCommands.ts
export class ApplyTuningPresetCommand implements Command {
  /** preset は part-tuning-management.md 3 節の TuningPreset。弦本数もそろえ、partPresetIds に preset.id を入れる。 */
  constructor(target: EditTarget, trackIndex: number, preset: TuningPreset, reporter: NotificationReporter);
}
export class SetCustomTuningCommand implements Command {
  constructor(target: EditTarget, trackIndex: number, stringPitches: number[]);
}
```

- 今のコードとの違い：`PlaceNoteCommand` と `InsertRestCommand` は音価を `model.Duration` で受けている（4.3 節の `BeatDurationSpec` に直すのは G28）。`SelectionRange` に `voiceIndex` が無い。パートのコマンドは `EditTarget` ではなく `model.Score` を受け、`RenamePartCommand`・`SetPartInstrumentCommand`・`SetStringCountCommand` は無い（G49・G50）。`NewPartSpec` は音色を GM のプログラム番号で受け、`presetId` を持たず、色を任意にしている。`ApplyTuningPresetCommand` はプリセットを名前と音の高さだけの `TuningPresetInput` で受ける。`PasteCommand` と `ApplyTuningPresetCommand` の知らせの口は、同じ形の `PasteReporter`・`TuningReporter` という名前で持っている。直すのは実装の段。
- (b) パートのコマンドも `EditTarget` で受けるのは、`partPresetIds`（サイドカー）をパートの並びと同じコマンドの中で直すため（[[part-tuning-management.md#3]] の 3.1 節）。`NewPartSpec` を `instrumentType` と `presetId` で受け、色を要るものにするのは、パートの項目（[[part-tuning-management.md#2]]）をそのまま足し、色の割り当て（既定のパレットから重ならない色）を発行する前に決めておくため。`ApplyTuningPresetCommand` が `TuningPreset` を受けるのは、`partPresetIds` に入れる `id` が要るため。
- (b) `SelectionRange` に `voiceIndex` を持たせるのは、範囲をカーソルの位置（4.1 節の `CursorPosition` はボイスを持つ）から作るので、選んだボイスの拍だけを範囲にするため。

## 3. モデルの項目と変更するコマンド

[[../basic_design/02_data_model.md#3.3]] と [[../basic_design/02_data_model.md#3.4]] を受ける。項目の alphaTab での置き場所の一覧は [[data-model-persistence.md#4]] の対応表にあり、本節はそこから先の決まり（継ぎ方・写し方・変えるコマンド）を書く。コマンドの引数・確かめ・`undo` の中身と、画面から呼ぶ所は、4 節から 10 節。

### 3.1 小節から音符までの階層

- 小節から音符までは、alphaTab の階層（`Bar` → `Voice` → `Beat` → `Note`）をそのまま使い、自前の階層を作らない。 <!-- req 02:cd4824a2.379b -->
- 付点は `Beat.dots` で <!-- req 02:cd4824a2.688e -->、連符は `Beat.tupletNumerator`・`Beat.tupletDenominator` で表す。 <!-- req 02:cd4824a2.70d9 --> スラーはタイと別の属性で持ち、2 つを区別する（3.4 節）。 <!-- req 02:cd4824a2.aff1 -->
- ボイスは 1 小節に 1 つ（`Bar.voices` の 1 つ目）を基本とする。 <!-- req 02:ebdc240b.d89c --> 低音とメロディのように同時に鳴る別の線を分けて書くために、2 つ目のボイスを置ける。 <!-- req 02:ebdc240b.cbff --> (b) 2 つ目は `Bar.voices` の 2 つ目に置く。alphaTab の `Bar` が、同じ小節の複数のボイスを `voices` の並びで持つため。
- 2 つ目のボイスがあるときのカーソルの動き <!-- req 02:69ced3a2.b3a6 -->と、コピーと貼り付けの扱いは <!-- req 02:69ced3a2.7d35 -->、基本設計 03 章と 04 章の回に本書へ書く。2 つ目のボイスの入力と再生の扱いも、03 章から 05 章の回に書く。03 章の回の分は、基本設計 03 章 13.4 節（2026-10-03 本人決定）に従い、次のとおりとする（画面の側の切り替えは [[screens-navigation.md#7]] の 7.3 節。まだ 2 つ目が無い小節での置き方は 4.1 節）。1 つの小節に置けるボイスは 2 つまでで、`Bar.voices` の 3 つ目以降は作らない。 <!-- req 03:566d8614.c227 --> カーソルは、選んでいるボイス（`Bar.voices` の 1 つ目か 2 つ目）の拍（`Beat`）の上だけを動く。 <!-- req 02:69ced3a2.b3a6 --> <!-- req 03:3506df18.a3f9 --> コピーと切り取りは、選んでいるボイスの拍だけを写し <!-- req 03:bb95a024.3e85 -->、貼り付けは選んでいるボイスへ貼り <!-- req 03:bb95a024.8d95 -->、もう一方のボイスの拍は、写しも書き換えもしない。 <!-- req 02:69ced3a2.7d35 --> (b) カーソルの位置は、パート・小節・ボイス・拍の 4 つで表す。ボイスを切り替えたら、同じ小節の中で、それまでの拍の始まりの時刻と同じか、その直前に始まる、切り替えた先のボイスの拍へカーソルを移す。譜面の上の位置が大きく飛ばないため。

### 3.2 小節の拍子とテンポ

- 拍子（論理名 `Bar.timeSignature`）は、値が無い（null）小節では直前の小節の値を継ぐ。 <!-- req 02:06ab5f73.5dfb --> テンポ（論理名 `Bar.tempoBpm`）も、値が無い小節では直前の小節の値を継ぐ。 <!-- req 02:06ab5f73.268f --> 小節を足したときと消したときの継ぎ方は [[../basic_design/13_design_decision_points.md#3]] B5 のとおりで、コマンドの中身は 10 節。
- 拍子とテンポは曲共通で、実体は alphaTab の `MasterBar`（`Score.masterBars`）が持つ。拍子は `timeSignatureNumerator`・`timeSignatureDenominator`、テンポは `tempoAutomations`。 <!-- req 02:06ab5f73.a059 -->
- (b) テンポの「継ぐ」は、その小節の `MasterBar.tempoAutomations` を空にして表す。テンポを変える小節にだけ `tempoAutomations` を置き、置かない小節は直前のテンポが続く。継ぐ状態へ戻すときは、その小節の `tempoAutomations` を空にする。alphaTab の `MasterBar` がテンポの変わり目だけを `tempoAutomations` に持つので、置くか置かないかがそのまま「値が有るか無いか」になるため。

- 拍子を直前の小節から継いでいるか、はっきり入れたかの印は、曲のファイルの `appMeta.settings` の「拍子をはっきり入れた小節」の一覧（`explicitTimeSignatureBars`、[[data-model-persistence.md#6]] の 6.4 節）で持つ（2026-10-01 本人決定）。 <!-- req 02:06ab5f73.5999 --> 一覧に無い小節は、直前の小節の拍子を継ぐ。1 小節目は継ぐ先が無いので、いつも一覧に入れる。alphaTab の `MasterBar` は拍子の値を小節ごとに必ず持ち、継ぐかどうかの印を持つ所が無い（alphaTab 1.8.4 の型定義で確かめた）ので、継いでいる小節の `MasterBar` にも直前の小節と同じ値を置く。一覧を書き換えるのは、拍子を変えるコマンド（値を入れたら一覧に足し、`null` で継ぐ状態へ戻したら一覧から外す）と、小節を足すコマンドと消すコマンド（足した小節は一覧に入れず、一覧の小節の番号を足した数・消した数だけずらし、消した小節は一覧から外す）に限る。どのコマンドも、`undo` で一覧を変更の前に戻す。継いでいる小節の値のそろえ方は B5 のとおりで、コマンドの中身は 10 節。

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
| チョーキング | Note | `Note.bendType`・`Note.bendPoints`（幅の値は 7.3 節） <!-- req 02:adeeb869.704d --> |
| スライド | Note | `Note.slideOutType` <!-- req 02:adeeb869.1511 --> |
| ハンマリング | Note | `Note.isHammerPullOrigin`（始まりの音符に立てる） <!-- req 02:adeeb869.df5f --> |
| プリング | Note | `Note.isHammerPullOrigin`（始まりの音符に立てる） <!-- req 02:adeeb869.72bf --> |
| パームミュート | Note | `Note.isPalmMute` <!-- req 02:adeeb869.52e1 --> |
| ビブラート | Note | `Note.vibrato`（`VibratoType`。付けるときの値は 7.3 節） <!-- req 02:adeeb869.d56b --> |
| ハーモニクス 3 種 | Note | `Note.harmonicType` の `Natural`（自然）・`Artificial`（人工）・`Pinch`（ピンチ） <!-- req 02:adeeb869.6efe --> |
| タッピング | Beat | `Beat.tap` <!-- req 02:adeeb869.20e0 --> |
| スラップ | Beat | `Beat.slap` <!-- req 02:adeeb869.e5e6 --> |
| ポップ | Beat | `Beat.pop` <!-- req 02:adeeb869.1693 --> |
| ブラシ | Beat | `Beat.brushType` |

- タッピング・スラップ・ポップは、Note ではなく Beat の属性として持つ（[[../basic_design/13_design_decision_points.md#3]] B40。alphaTab でも Beat の属性のため）。 <!-- req 02:dd2351e6.68ba --> ブラシも、Note ではなく Beat の属性として持つ。 <!-- req 02:dd2351e6.3f0f -->
- ハンマリングとプリングは、alphaTab では 1 つの属性 `isHammerPullOrigin` で持つ（alphaTab 1.8.4 の型定義に、2 つを分ける属性は無い）。
- スライドの種類は、シフト（`SlideOutType.Shift`） <!-- req 02:b798fe87.9d73 -->・レガート（`SlideOutType.Legato`） <!-- req 02:b798fe87.ce4c -->・下へのスライドアウト（`SlideOutType.OutDown`） <!-- req 02:b798fe87.33ad -->・上へのスライドアウト（`SlideOutType.OutUp`）の 4 つとする。 <!-- req 02:b798fe87.73ae -->
- パームミュートの範囲は、その音だけ <!-- req 02:b798fe87.f9e8 -->と、次の音まで <!-- req 02:b798fe87.721a -->の 2 つとする。(b) 範囲は付けるときの操作の単位とし、データでは音符ごとの `Note.isPalmMute` で表す。「その音だけ」はその音符だけに `isPalmMute` を立て、「次の音まで」はその音符と、同じ弦の次の音符（無ければその音符だけ）の両方に立てる。alphaTab の `Note.isPalmMute` は音符ごとの真偽の値だけを持ち、曲のファイルは alphaTab のデータで持つ（`appMeta` は基本設計 02 章 4.1 節の 5 つに限る）ため。範囲を選ぶ操作は 7.2 節と 7.3 節。
- 奏法記号を確定する操作（自動の候補と、長押しや手での補正）は 7 節に書く。 <!-- req 02:668dcc88.4e4a -->
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
- 打楽器かどうかは alphaTab の `Staff.isPercussion` で表し <!-- req 02:853d96e1.1976 -->、打楽器の種類は `Note.percussionArticulation` で表す。 <!-- req 02:853d96e1.0c96 --> v1 では、種別を表す属性を自前で足さない。 <!-- req 02:057b03cc.000a --> v2 で `instrumentType` に値を足して `Staff.isPercussion` を立てる中身は、[[web-core-foundation.md#13]] の 13.4 節。

### 3.7 同じ弦の重複

- 同じ Beat に同じ弦（論理名 `stringIndex`、alphaTab の `Note.string`）の音符を足す操作は、コマンド層の確かめで拒否する（Error）。 <!-- req 02:dfbace79.6791 --> 確かめる所・エラーコード・画面での知らせ方は 5 節（`EDIT-001`）。

### 3.8 項目と変えるコマンドの対応

- 本節の項目には、それぞれ変えるコマンドを 1 つ置くか、「編集不可」と書く（曲名・アーティスト名・タグの 3 つだけは「編集の履歴の外で変える」と書く、2.5 節）。 <!-- req 02:91f21b28.568a --> 対応は [[../basic_design/12_traceability.md#6]] の対応表で一元に管理し、2.5 節の検算で確かめる。対応の正は 12 章 6 節の表とし、下の表は、今のコードに在るかを添えた索引とする。下の表の「変えるコマンド」の列も、2.5 節の検算で 12 章 6 節の表の「変更経路」の列と突き合わせ、食い違えば 12 章 6 節の表に合わせて下の表を直す。 <!-- req 02:91f21b28.5a40 -->

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
| `Score.title`・`Score.artist` | コマンドにせず、編集の履歴の外で変える。曲一覧の右クリックとメニューバーの「名前を変更」で、曲のファイルを書き直す（[[screens-navigation.md#6]] の 6.3 節、[[data-model-persistence.md#5]]） <!-- req 01:35d8ad64.199c --> <!-- req 01:35d8ad64.52fd --> | コマンドを置かない |
| `appMeta.tags` | コマンドにせず、編集の履歴の外で変える。曲一覧の右クリックとメニューバーの「タグを編集」で、曲のファイルを書き直す（[[screens-navigation.md#6]] の 6.3 節、[[data-model-persistence.md#6]] の 6.3 節） <!-- req 01:35d8ad64.e02b --> | コマンドを置かない |

- 曲名・アーティスト名・タグをコマンドにしないのは、変える入口が曲一覧ウィンドウだけで、操作の履歴（`CommandHistory`）は編集ウィンドウごとに持つため（基本設計 04 章 8.3 節「ウィンドウを閉じればそのウィンドウの`CommandHistory`も破棄される」、03 章 7 節の「元に戻す」の範囲は「編集ウィンドウ全体」）。曲一覧で変えた曲名・アーティスト名・タグは、編集ウィンドウの取り消し（Ctrl+Z）では戻らない。この書き方は、基本設計 01 章 AD-2 の 2026-10-09 本人決定（honnin-queue 64 番）が曲一覧で変える曲名・アーティスト名・タグの 3 つにだけ認めたもので、この 3 つ以外の項目には使わない。 <!-- req 01:5e051848.1cda --> <!-- req 01:52ce0acc.09a5 -->
- Beat の属性の奏法記号を `SetTechniqueCommand` と別のコマンドにするのは、`SetTechniqueCommand` が弦を指定して Note を変えるのに対し、スラップ・ポップ・タップ・ブラシは弦を持たない Beat の属性だから（B40）。

### 3.9 小節とフレットの上限

[[../basic_design/02_data_model.md#4.3]] のうち、編集のコマンドで守らせるものを受ける。パートの数の上限は [[part-tuning-management.md#2]] の 2.3 節、タグと曲の数は [[data-model-persistence.md#6]] の 6.3 節と 9 節、小節メモの文字数は 3.10 節。

- 小節の数は 2048 までとし、小節を足すコマンドの前の確かめで守らせる（超えたら `EDIT-003`、Error。今のコードの `MAX_BAR_COUNT`、`packages/core/src/editing/scoreModel.ts`）。 <!-- req 02:3df4e42e.014d -->
- フレットは 0 から 24 までとし、音符のフレットを入れるときの確かめで守らせる（範囲の外は `EDIT-002`、Error。今のコードの `MAX_FRET`）。 <!-- req 02:bec84375.33fd --> フレットを入れる画面の部品は 4.2 節。

### 3.10 小節メモ・セクションマーカー・リピートのコマンド

[[../basic_design/02_data_model.md#3.5]] と [[../basic_design/02_data_model.md#3.6]] のうち、変えるコマンドと `EDIT-004` の確かめを受ける。データの形は [[data-model-persistence.md#6]] の 6.1 節と 6.2 節。

| 変えるもの | コマンド | 今のコード |
|---|---|---|
| 小節メモ（`appMeta.memos`） | 足す `AddMemoCommand`・変える `EditMemoCommand`・消す `DeleteMemoCommand` | ある（`packages/core/src/editing/commands/memoCommands.ts`） |
| セクションマーカー（`appMeta.sectionMarkers` と写しの `MasterBar.section`） | 足す `AddSectionMarkerCommand`・変える `EditSectionMarkerCommand`・消す `DeleteSectionMarkerCommand` | ある（`packages/core/src/editing/commands/sectionMarkerCommands.ts`） |
| リピート（`MasterBar.isRepeatStart`・`repeatCount`） | `SetRepeatCommand` | 無い（[[00_reference.md#8.1]] の G26） |

- 画面は `EditingService` の `addMemo(barIndex, text)`・`editMemo(memoId, text)` を呼び、`EditingService` が文字数を確かめてから `AddMemoCommand`・`EditMemoCommand` を作って `CommandHistory` に渡す（2.1 節）。 <!-- req 02:4195e21c.b0a5 --> <!-- req 02:4195e21c.5849 -->
- メモを入力している間は、100 文字を超えても入力を止めない。 <!-- req 02:21616253.8f10 --> 超えていれば、入力の欄で Warning（`EDIT-004`）を見せる（見せ方は基本設計 03 章の回）。 <!-- req 02:06c207e3.26fb --> <!-- req 02:21616253.44f4 -->
- メモを確定したとき（`addMemo`・`editMemo` を呼んだとき）に、`EditingService` が `ValidationService.validateMemoText` で文字数を数え（数え方は [[data-model-persistence.md#6]] の 6.2 節）、100 文字を超えていれば `EDIT-004` を知らせ、先頭の 100 文字に切り詰めた本文でコマンドを作る。 <!-- req 02:21616253.de91 --> 切り詰めるのは確定したそのメモだけで、曲のファイルを保存するときには、どのメモも切り詰めない（古いファイルの 100 文字を超えたメモは 6.2 節のとおり、そのまま残る）。基本設計 02 章 4.3 節の「保存時に先頭100文字へ切り詰める」は、同じ表が数え方と古いメモの扱いを譲る 3.6 節で「そのメモを入力・編集して保存したときにだけ切り詰める」と決まっている。メモを確定したときに切り詰めた本文でコマンドを作ると、曲のファイルに書かれるのはいつも切り詰めた本文になり、入力も編集もしていないメモは保存で変わらないので、この決まりと同じ結果になる。 <!-- req 08:31d3875f.0735 -->
- 1 つの小節に置けるメモの件数には、上限を置かない。 <!-- req 02:21616253.2aca -->
- 各コマンドの引数と `undo` の中身、マーカーとリピートを付ける画面の操作は 10 節。`SetRepeatCommand` の反復の回数の範囲は [[../basic_design/13_design_decision_points.md#3]] B39 のとおり。

## 4. カーソルとステップ入力

[[../basic_design/04_editing_core.md#1]]・[[../basic_design/04_editing_core.md#2]]・[[../basic_design/04_editing_core.md#3]] を受ける。キーとマウスの割り当ては [[screens-navigation.md#9]] と [[screens-navigation.md#10]]、入力ツールバーの部品は [[screens-navigation.md#7]] の 7.3 節。

### 4.1 カーソル（`CursorController`）

```ts
// packages/core/src/editing/types.ts
export interface CursorPosition {
  trackIndex: number;
  barIndex: number;
  /** 0 か 1（Bar.voices の 1 つ目か 2 つ目、3.1 節）。 */
  voiceIndex: 0 | 1;
  /** Voice.beats のインデックス。beats.length は、最後の拍の後ろ（次に置く所）を指す。 */
  beatIndex: number;
}

// packages/core/src/editing/CursorController.ts（編集ウィンドウごとに 1 つ）
export class CursorController {
  get position(): CursorPosition;
  /** 手で動かす。和音の入力の途中の印を捨てる（4.7 節。「和音」ボタンの入切は変えない）。 */
  setPosition(position: CursorPosition): void;
  /** 拍の単位で動くだけで、コマンドは出さない（下の ← の箇条と、→ の (b) の箇条）。拍の並びは target の Score から読む。→ キーは EditingService.stepRight が受け、休符や小節を足さないときにこれを呼ぶ。 */
  moveByBeat(target: EditTarget, direction: -1 | 1): void;
  /** 選んでいる弦（1 が最も低い弦。alphaTab の Note.string と同じ数え方）。 */
  get currentString(): number;
  setString(stringNumber: number): void;
  /** 今の入力音価（4.3 節）。 */
  get currentDuration(): BeatDurationSpec;
  setDuration(spec: BeatDurationSpec): void;
  /** 入力ツールバーの「和音」ボタンの入切（4.7 節）。 */
  get chordInputMode(): boolean;
  enterChordInput(): void;
  /** ボタンを切る。和音の入力の途中なら確定して進める（4.7 節）。 */
  exitChordInput(target: EditTarget): void;
  /** コマンドの戻り値でカーソルを動かす。次の位置は target の Score から読む（下の小節の終わりの箇条）。 */
  applyOutcome(outcome: CommandOutcome, target: EditTarget): void;
  get selection(): SelectionRange | null;
  setSelection(range: SelectionRange): void;
  clearSelection(): void;
  onChange(listener: () => void): () => void;
}
```

- カーソルは編集ウィンドウごとに 1 つ持つ画面の状態で、カーソルを動かすことはコマンドにせず、取り消しの対象にしない。
- (b) 選んでいる弦は `CursorPosition` に入れず、`currentString` として別に持つ。基本設計 04 章 1 節は位置をパート・小節・拍で表すと決めていて、弦は次にどの弦へ置くかを決める入力の状態だから（音価の選択と同じ扱い）。
- (b) ↑ ↓ は選んでいる弦を 1 本ずつ変え、一番低い弦と一番高い弦で止める（反対の端へ回らない）。押した向きと逆の端へ飛ばないため。
- (b) ← は、選んでいるボイスの拍を 1 つずつ前へ動く。小節の最初の拍で ← を押すと前の小節の最後の拍へ移り、曲の最初の拍では動かない。小節をまたいでも拍の順に動けば、譜面の上の並びと同じ順になるため。
- 小節が埋まったとき（小節の音価の合計が拍子の長さに届いたか超えたとき）の動きは、次のとおりとする（2026-10-08 本人決定、honnin-queue 55 番）。
- 音か休符を置いて小節が埋まったら、カーソルを次の小節の頭（拍 0）へ送る。埋まっていなければ、同じ小節の次の拍（`beatIndex + 1`）へ進める。
- 埋まったのが曲の最後の小節なら、小節を 1 つ足し（`InsertBarCommand`、10 節）、その頭へ送る。`EditingService.placeNote` と `insertRest` は、置く前に最後の小節が埋まるかを数え、埋まるなら置くコマンド（`PlaceNoteCommand` か `InsertRestCommand`）と `InsertBarCommand` を 1 つの `CompositeCommand` にまとめて発行する。1 回の取り消しで、置いた音か休符と、足した小節の両方が戻る。
- → キーは `EditingService.stepRight()`（4.8 節）が受ける。カーソルが小節の最後の拍の後ろ（`beatIndex` が `beats.length`）にいるとき、小節に空きがあれば、そこに今の入力音価の休符を置いて進む（`InsertRestCommand`、4.4 節。基本設計の「矢印キーでの明示スキップ」）。埋まっていれば次の小節の頭へ移り、最後の小節なら上と同じく小節を 1 つ足して移る（足すのは `InsertBarCommand` の 1 つの履歴の項目で、1 回の取り消しで戻る）。
- (b) → は、小節の最後の拍にいるときは、空きがあれば最後の拍の後ろへ、埋まっていれば次の小節の頭（最後の小節なら上と同じく足して）へ移る。それより前の拍では、同じ小節の次の拍へ移る。休符を置くのは何も無い所だけにして、置いた音の後ろへ → で戻れるようにするため。
- (b) 最後の小節で埋まっているときの → で小節を足すのは、音を置いて埋まったときと同じ動きにそろえ、曲の終わりで → が効かなくなる所を作らないため。
- (b) 2 つ目のボイスがまだ無い小節では、ボイス 2 を選んだときのカーソルの位置は拍 0（最後の拍の後ろ）だけとし、音か休符を置いたときに、その小節の `Bar.voices` に 2 つ目の `Voice` を作る。作った `Voice` は、置いたコマンドの `undo` で外す。音を置いていない小節に空のボイスを残さないため。

### 4.2 ステップ入力の流れ

- 音価のパレットで音価を選ぶと、今の入力音価（`CursorController.setDuration`）を変える。 <!-- req 04:495c68e5.bcbe -->
- 今の入力音価を変えることはコマンドにせず、画面の状態として持つ（取り消しの対象にしない）。 <!-- req 04:495c68e5.cff8 -->
- 弦とフレットは、入力ツールバーのクイック選択バーか、テンキー（数字キーとテンキーの欄）で指定する（[[screens-navigation.md#7]] の 7.3 節）。弦は選んでいる弦（4.1 節）、フレットは選んだ数とする。 <!-- req 04:792228a9.27a8 -->
- 弦とフレットを指定すると、`EditingService.placeNote(stringNumber, fret)` が確かめ（5 節）の後に `PlaceNoteCommand` を発行する。 <!-- req 04:792228a9.d13e -->
- カーソルは、コマンドの実行が成り立った後に動かす。確かめで拒んだときは動かさない。 <!-- req 04:d7b7dca6.39de -->
- 動かす先は、今の音価の分だけ右の、次の拍とする（`CommandOutcome.cursorAdvance` が `'beat'`）。 <!-- req 04:d7b7dca6.01d3 -->
- 同じカーソルの位置のまま、別の弦のフレットを続けて指定したときは、和音の入力（4.7 節）として扱う。 <!-- req 04:27a1f0fe.49ae -->
- フレットを入れる部品 `FretInputBar`（`packages/ui-desktop`）は、0 から 12 のクイック選択バーと、テンキーの欄を持つ。欄は数字だけを受け、確定した値を `EditingService.placeNote` に渡す。0 から 24 の外の値は `ValidationService.validateNotePlacement` が `EDIT-002` で拒み、音を置かない（5 節）。
- 数字キー（[[screens-navigation.md#9]] の 9.2 節の 0 から 9）を押すと、選んでいる弦の、カーソルの拍に、その数のフレットの音をすぐ置く（`PlaceNoteCommand`）。置いた音を鳴らすのは playback-integration.md（基本設計 05 章の回）。
- 置いてから 1 秒以内に次の数字を押し、前の数字と合わせた 2 桁が 10 から 24 になるときは、置いた音のフレットをその 2 桁に書き換える（`SetNoteFretCommand`）。2 桁が 10 から 24 にならないとき（3 の後の 5、0 の後の 7）と、1 秒を過ぎてから押したときは、新しい音として今のカーソルの拍に置く。書き換えた後も、カーソルは 1 つ目の数字で進んだ位置のまま動かさない。
- (b) 書き換えは、前の `PlaceNoteCommand` と履歴の 1 つの項目にまとめる（`SetNoteFretCommand.canMergeWith` が、直前の項目が同じ音符を置いた `PlaceNoteCommand` のときだけ真を返す）。1 回の取り消しで 2 桁の入力が全部戻り、利用者には 1 つの音を置いた操作に見えるため。
- (b) 1 秒は `TWO_DIGIT_FRET_WINDOW_MS = 1000`（`packages/core/src/editing/EditingService.ts`）に 1 か所で持つ。`EditingService` は、前の数字を押した時刻（注入した時計の `now(): number`）と、置いた音符の位置と弦を覚えておき、次の数字のときに比べる。カーソルを動かす・音価を選ぶ・別のコマンドを出したときは、覚えを捨てる。テストで時計を差し替えて 1 秒の前後を確かめるため。

```ts
// packages/core/src/editing/commands/SetNoteFretCommand.ts
export class SetNoteFretCommand implements Command {
  /** kind 'set-note-fret'。affectedTrackIndices は [position.trackIndex]。cursorAdvance は 'none'。 */
  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, fret: number);
}
```

### 4.3 入力音価の 3 つの要素

- 音価のパレットは、分数・付点・連符の 3 つを別々に選べる部品とし、3 つの組で今の入力音価が決まる（[[screens-navigation.md#7]] の 7.3 節）。 <!-- req 04:bd897c73.f9dd -->

```ts
// packages/core/src/editing/types.ts
export interface TupletSpec {
  /** 実際に弾く音符の数（3 連符なら 3）。 */
  readonly numerator: number;
  /** 置き換えられる音符の数（3 連符なら 2）。 */
  readonly denominator: number;
}
export interface BeatDurationSpec {
  readonly duration: model.Duration;
  /** 0 = なし、1 = 付点、2 = 複付点（Beat.dots）。 */
  readonly dots: 0 | 1 | 2;
  /** null は連符でない（alphaTab では分子と分母が 1）。 */
  readonly tuplet: TupletSpec | null;
}
/** 既定の入力音価（4 分音符、付点なし、連符なし）。 */
export const DEFAULT_DURATION_SPEC: BeatDurationSpec;
```

- 分数は、全音符・2 分音符・4 分音符・8 分音符・16 分音符・32 分音符の 6 つ（`Duration.Whole` から `Duration.ThirtySecond`、3.3 節）とする。 <!-- req 04:f7e75d41.e340 --> <!-- req 04:f7e75d41.d325 --> <!-- req 04:f7e75d41.c0b3 --> <!-- req 04:f7e75d41.eacf --> <!-- req 04:f7e75d41.f629 --> <!-- req 04:f7e75d41.23bd -->
- 付点は、なし（`dots` が 0）・付点（1、長さは 1.5 倍）・複付点（2、長さは 1.75 倍）の 3 つとする。 <!-- req 04:aab69108.09db --> <!-- req 04:aab69108.4282 --> <!-- req 04:aab69108.5dbd -->
- 連符は、なし（`tuplet` が null）・3 連符（3:2）・5 連符（5:4）・任意（何連符かを 2 から 12 で入れる）の 4 つとする。 <!-- req 04:29fe136f.0989 --> <!-- req 04:29fe136f.a4cf --> <!-- req 04:29fe136f.6ca1 -->
- (b) 任意の連符は、7.3 節の欄に入れた数（2 から 12）を分子とし、分母は分子より小さい 2 の累乗のうち一番大きいもの（6 なら 4、7 なら 4、9 なら 8）とする。記譜の慣習で、n 連符はその数より小さい一番近い 2 の累乗の数の音符の長さに入れるため。範囲の外は `EDIT-016`（5 節）。 <!-- req 04:29fe136f.8ad1 -->
- 3 つの要素は、新しく置くコマンド（`PlaceNoteCommand` と `InsertRestCommand`）にも、今ある拍の音価を変える `SetBeatDurationCommand` にも、同じ形（`BeatDurationSpec`）で渡す。 <!-- req 04:d3a3f05a.39cb --> <!-- req 04:d3a3f05a.21b6 -->
- `SetBeatDurationCommand` は 1 つの拍だけを変える。 <!-- req 04:6c87bf88.f495 -->
- 範囲選択の全部の拍を変えるときは、拍ごとの `SetBeatDurationCommand` を `CompositeCommand`（2.3 節）にまとめる（[[../basic_design/13_design_decision_points.md#3]] B41）。 <!-- req 04:6c87bf88.ec12 -->

```ts
// packages/core/src/editing/commands/SetBeatDurationCommand.ts
export class SetBeatDurationCommand implements Command {
  /** kind 'set-beat-duration'。affectedTrackIndices は [position.trackIndex]。cursorAdvance は 'none'。undo は前の BeatDurationSpec に戻す。 */
  constructor(target: EditTarget, position: CursorPosition, spec: BeatDurationSpec);
}
```

- 発行の前に `ValidationService.validateBeatDuration(spec)` で確かめる（付点は `EDIT-012`、連符は `EDIT-016`）。小節の音価の合計が拍子を超えても拒まない（5 節）。`EDIT-012`・`EDIT-016` の `context` は、起きた操作で分ける（基本設計 08 章 1 節・03 章 11 節、2026-10-10）。範囲を選んで音価を変えて弾かれたときは `{ trackIndex, barIndex }` を入れ、`ScoreHighlightBinder` がその小節に赤枠を付ける。入力ツールバーの連符の「任意」の欄（[[screens-navigation.md#7]] の 7.3 節）に入れた数を確かめて弾かれたときは `barIndex` を入れず、[[screens-navigation.md#13]] の 13.2 節の `FieldErrorTarget` がその欄に赤枠を付ける。(b) 範囲が 2 つ以上の小節にまたがるときの `barIndex` は、範囲の最初の拍の小節とする。赤枠の要求（`ScoreHighlightRequest`）は 1 つの小節を指す形で、範囲を選び始めた所に赤枠が出るほうが、どの操作が弾かれたかを追いやすいため。 <!-- req 08:33ce40b8.37db -->

### 4.4 休符

- 音価を選んでから「休符」ボタンを押す操作は、カーソルの位置に音を置かずに進める操作として扱う。 <!-- req 04:3bb5b675.7c4f -->
- この操作と、Enter での明示のスキップ（[[screens-navigation.md#9]] の 9.2 節）は、`InsertRestCommand` で休符の拍（音符を持たない拍、3.3 節）をはっきり作り、カーソルを進める。矢印キーでのスキップは、4.1 節の → キーの箇条のとおり、小節に空きがある最後の拍の後ろで → を押したときに休符を置く形とする（honnin-queue 55 番）。 <!-- req 04:3bb5b675.0818 -->
- 何も操作せずに音を置かなかった位置は、小節を作った時点で既に休符として扱われている（暗黙の休符）。追加の操作は要らない。 <!-- req 04:6ddd78a4.8da9 -->
- (b) 小節を作るコマンド（`InsertBarCommand` と、パートを足す `AddPartCommand`）は、新しい小節のボイスに、全音符の長さの休符の拍を 1 つ置く。小節全体の休符は拍子によらず全音符の休符の記号で書く記譜の慣習に合わせ、`PlaceNoteCommand` がその拍を音符の拍に変えて使えるため（今のコードの `PlaceNoteCommand` の、休符の拍を音符の拍に変える形）。
- 明示した休符の拍は、音符と同じ手段で消せる。右クリックの「削除」・消しゴムモードのクリック・Delete キー・Backspace キーの 4 つ（4.5 節）。選択範囲の削除と切り取り（9 節）は、Delete キー・Backspace キーと右クリックの「削除」の入口で、手段に数えない（基本設計 04 章 2 節）。 <!-- req 04:a4aa3953.6071 --> <!-- req 04:a4aa3953.6c15 --> <!-- req 04:f417fea8.bf5b --> <!-- req 04:f417fea8.e168 -->
- 休符の拍を消したときは、その拍を取り除き、後ろの拍を前へ詰める（`DeleteNotesCommand`、4.5 節）。 <!-- req 04:9a677051.240d --> <!-- req 04:9a677051.a9c3 -->

### 4.5 音符と休符を消す

- Delete キーと Backspace キー、右クリックのメニューの「削除」、消しゴムモードのクリックの 3 つの手段と、編集メニューの「削除」は、Delete キー・Backspace キー・編集メニューの「削除」は `EditingService.deleteNotes()` を、右クリックのメニューの「削除」と消しゴムモードのクリックは `EditingService.deleteNoteAt(at)` を呼び、どれも同じ `DeleteNotesCommand` を出す（[[screens-navigation.md#10]] の 10.4 節。入口が違うだけで、消し方と結果は同じ）。
- 消す対象は、Delete キー・Backspace キー・編集メニューでは、選択範囲があればその範囲とし、無ければカーソルの拍の選んでいる弦の音符とする。選択範囲が無く、カーソルの拍が休符の拍なら、その拍を `restBeats` に渡して取り除く。右クリックでは、選択範囲があればその範囲、無ければ右クリックした音符とし、音符の無い所を右クリックしたときは、その拍が休符の拍ならその拍とする。音符の無い所で、その拍に音があるときは、右クリックの「削除」を押せない状態で出し、何も消さない（基本設計 03 章 8 節の右クリックの行、2026-10-09 決定、[[screens-navigation.md#10]] の 10.2 節）。消しゴムでは、クリックした音符 1 つとし、休符の拍をクリックしたときはその拍とする。 <!-- req 04:a4aa3953.1f9b -->
- 和音の中の 1 つの音を消したときは、その音符だけを外す。休符の拍を消したときは、拍を取り除いて後ろを詰める（4.4 節）。
- 拍の最後の 1 つの音を消したとき（和音の音を全部消したときも同じ）は、拍を取り除かず、その拍を同じ長さの休符の拍として残す。後ろの拍の位置は変わらない（2026-10-08 本人決定、honnin-queue 57 番）。休符の拍を消すと拍を取り除いて詰めるのは、4.4 節のとおり基本設計のまま。
- `DeleteNotesCommand` は、`notes` の音符を外した拍に音が残らなければ、拍の長さを変えずに休符の拍（音符を持たない拍、3.3 節）にする。拍を取り除くのは、`restBeats` に渡した休符の拍だけとする。
- `deleteNoteAt(at)` に拍（`CursorPosition`）を渡すのは、その拍が休符の拍のときだけとし、`restBeats` に渡して取り除く。音のある拍を渡されたときは何もしない。右クリックの「削除」は音のある拍の空いた弦では押せず、消しゴムは休符の拍をクリックしたときにだけ拍を渡すため（2026-10-09 決定。空いた弦を右クリックしただけで和音が全部消えるのを避ける）。

```ts
// packages/core/src/editing/types.ts
export interface NoteRef { position: CursorPosition; stringNumber: number }
// packages/core/src/editing/commands/DeleteNotesCommand.ts
export class DeleteNotesCommand implements Command {
  /** kind 'delete-notes'。notes と restBeats は同じパートの中。affectedTrackIndices は [そのパート]。undo は消した音符と拍を元の位置へ戻す。 */
  constructor(target: EditTarget, notes: readonly NoteRef[], restBeats: readonly CursorPosition[]);
}
```

### 4.6 音符を動かす

- 左クリック＋ドラッグで音符を動かすと、`EditingService.moveNote(from: NoteRef, to: NoteRef)` が、元の音符を消す `DeleteNotesCommand` と、行き先に置く `PlaceNoteCommand` を `CompositeCommand`（kind は `'move-note'`）にまとめて出す。1 回の取り消しで元に戻る。
- 行き先は、ドラッグを離した所の拍と弦とする。行き先の同じ拍・同じ弦に音符があるときは `EDIT-001` で拒み、動かさない（5 節）。
- (b) ドラッグの途中は行き先を示すだけでコマンドを出さず、離したときに 1 回だけ出す。途中で出すと、取り消しの履歴にドラッグの途中の位置が積まれるため。
- 別の弦へ動かしたときは、フレットの数を保つ。鳴る音の高さは、行き先の弦のチューニングで変わる（2026-10-08 本人決定、honnin-queue 54 番）。フレットの数の範囲（0 から 24、5 節）はどの弦でも同じなので、動かしたことで範囲の外になることは無い。
- 動かした結果、元の拍に音が残らないときは、その拍を同じ長さの休符の拍として残す（4.5 節、honnin-queue 57 番）。

### 4.7 和音の入力

- 同じカーソルの位置（同じ拍）へ弦を何度か指定したときは、それを 1 つの入力の単位（和音）として扱う。 <!-- req 04:0f1772c5.ca5e -->
- このとき `PlaceNoteCommand` は、拍の音符の並びへの追加として働く（今のコードの、音のある拍へ足す形）。 <!-- req 04:0f1772c5.05e4 -->
- 和音を入れるかどうかは、入力ツールバーの「和音」の入切のボタン（[[screens-navigation.md#7]] の 7.3 節）で分ける（2026-10-08 本人決定、honnin-queue 58 番）。 <!-- req 04:1a2fcc02.f058 -->
- ボタンが入っている間（`CursorController.chordInputMode` が真の間）は、和音の入力が終わるまで、音を置いてもカーソルを次の拍へ進めない。`applyOutcome` は `'beat'` を受けても進めず、置いた拍を「和音の入力の途中」として覚える。 <!-- req 04:d7b7dca6.ac91 --> <!-- req 04:1a2fcc02.d1ac -->
- ボタンが入っている間は、カーソルが同じ拍に留まるので、続けて同じ拍の別の弦に置くと和音になる。 <!-- req 04:27a1f0fe.76f3 -->
- 和音の入力を終える（確定する）操作は、ボタンを切る（`exitChordInput`）・音価を選ぶ（`setDuration`）・→ キー（`EditingService.stepRight`）の 3 つとする。 <!-- req 04:464e61fe.dc43 --> <!-- req 04:464e61fe.090c --> <!-- req 04:464e61fe.ecd3 -->
- 音価を選んで確定するのは `EditingService.setDuration(spec)` とする。`setDuration` は、選択範囲があれば 4.3 節のとおり範囲の拍の音価を変え、無ければ `CursorController.setDuration(spec)` で今の入力音価を変えたうえで、和音の入力の途中なら確定する。`CursorController.setDuration` は今の入力音価を変えるだけで、確定も進めもしない。
- 確定すると、和音の入力の途中なら、置いた拍から 1 つ進める。進め方は 4.1 節の、音を置いたときと同じとする（小節が埋まれば次の小節の頭、最後の小節なら小節を足す）。途中でなければ、ボタンを切っても音価を選んでも動かない（→ は 4.1 節のとおり動く）。 <!-- req 04:464e61fe.e967 -->
- ボタンが切れている間は、4.2 節のとおり、音を置くたびにカーソルを進める。 <!-- req 04:c78f5aab.0002 -->
- (b) 音価を選んで確定したときと、→ で確定したときは、ボタンを入れたままにし、次の拍でも続けて和音を入れられるようにする。ボタンは入切を示すトグルなので、押していないのに切れると、見た目と働きがずれるため。
- (b) 和音の入力の途中で、← やクリックでカーソルを手で動かしたとき（`setPosition` と ← の `moveByBeat`）は、確定せずに途中の印を捨てる（進めない）。手で動かした先を、次に置く所として選んだと読めるため。捨てるのは途中の印だけで、その拍に置いた音はそのまま残り、「和音」ボタンの入切も変えない。
- (b) ボタンの入切は、編集ウィンドウごとの入力の状態として持ち、取り消しの対象にしない。音価の選択と同じく、次の入力の仕方を決める状態で、曲の中身ではないため。
- (b) 最後の小節が和音で埋まり、確定で小節を足すときは、`InsertBarCommand` を 1 つの履歴の項目として発行する（1 回の取り消しで戻る）。置いた音のコマンドは置いたときに履歴へ積んであり、後からまとめられないため。

### 4.8 `EditingService` の口

画面が呼ぶのは次のメソッドだけとする（2.1 節）。どのメソッドも、確かめ（5 節）で拒むときは `report` で知らせてコマンドを出さず（例外を投げない）、通るときは `CommandHistory.execute` に渡し、戻り値の `cursorAdvance` でカーソルを動かす。

```ts
// packages/core/src/editing/EditingService.ts（編集ウィンドウごとに 1 つ）
export class EditingService {
  constructor(target: EditTarget, cursor: CursorController, validation: ValidationService,
              history: CommandHistory, reporter: NotificationReporter, clipboard: ClipboardService,
              barDeleteConfirmer: BarDeleteConfirmer, now: () => number);
  placeNote(stringNumber: number, fret: number): void;            // 4.2 節（数字キーの 2 桁は placeDigit）
  placeDigit(digit: number): void;                                 // 4.2 節
  insertRest(): void;                                              // 4.4 節
  stepRight(): void;                                               // 4.1 節（→ キー。和音の確定を兼ねる、4.7 節）
  deleteNotes(): void;                                             // 4.5 節（対象は選択範囲かカーソル。カーソルの休符の拍も）
  deleteNoteAt(at: NoteRef | CursorPosition): void;                // 4.5 節（右クリックと消しゴム。音符の無い所で休符の拍なら拍を渡す）
  moveNote(from: NoteRef, to: NoteRef): void;                      // 4.6 節
  setDuration(spec: BeatDurationSpec): void;                       // 4.3 節（範囲があれば SetBeatDurationCommand）・4.7 節（範囲が無ければ和音の確定を兼ねる）
  setTie(stringNumber: number, tied: boolean): void;               // 6 節
  setSlur(): void;                                                 // 6 節
  suggestTechniques(placed: NoteRef): readonly TechniqueSuggestion[]; // 7.1 節
  setTechnique(stringNumber: number, patch: NoteTechniquePatch): void; // 7.3 節
  setBeatTechnique(patch: BeatTechniquePatch): void;               // 7.3 節
  setChordName(name: string | null): void;                         // 8 節
  chordNameAt(position: CursorPosition): string | null;            // 8 節
  copySelection(): void;                                           // 9 節
  cutSelection(): void;                                            // 9 節
  copyAt(at: NoteRef | CursorPosition): void;                      // 9 節（右クリック。選択範囲が無いとき）
  cutAt(at: NoteRef | CursorPosition): void;                       // 9 節（右クリック。選択範囲が無いとき）
  paste(): void;                                                   // 9 節
  duplicateSelection(): void;                                      // 9 節
  insertBar(at: number): void;                                     // 10 節
  deleteBar(at: number): Promise<void>;                            // 10 節
  setTimeSignature(barIndex: number, signature: TimeSignatureSpec | null): void; // 10 節
  setTempo(barIndex: number, bpm: number | null): void;            // 3.8 節
  setRepeat(barIndex: number, patch: RepeatPatch): void;           // 10 節
  addMemo(barIndex: number, text: string): void;                   // 3.10 節
  editMemo(memoId: string, text: string): void;                    // 3.10 節
  deleteMemo(memoId: string): void;                                // 3.10 節
  addSectionMarker(barIndex: number, label: string): void;         // 3.10 節・10 節
  editSectionMarker(markerId: string, label: string): void;        // 10 節
  deleteSectionMarker(markerId: string): void;                     // 10 節
  undo(): void;
  redo(): void;
}
```

- 今のコードの `EditingService`（`packages/core/src/editing/EditingService.ts`）は、`placeDigit`・`stepRight`・`deleteNotes`・`deleteNoteAt`・`moveNote`・`setDuration`・`setBeatTechnique`・`cutSelection`・`copyAt`・`cutAt`・`duplicateSelection`・`setTimeSignature`・`setRepeat` を持たず、`deleteBar` が答えを引数で受け、`suggestTechnique` が 1 件だけを返す形で、ここと違う。直すのは実装の段。

## 5. 配置と追加の確かめ

[[../basic_design/04_editing_core.md#4]] と [[../basic_design/04_editing_core.md#11]] を受ける。コードのレベルと文の正は [[00_reference.md#5]]、上限の値の正は基本設計 02 章 4.3 節。

- `PlaceNoteCommand` を実行する前に、`EditingService` が下の表の確かめを `ValidationService` で行う。 <!-- req 04:7aeab172.9d91 -->
- 拒むときは、`EditingService` が `NotificationReporter.report(code, context)` で知らせ、コマンドを出さない（例外を投げない）。

```ts
// packages/core/src/editing/ValidationService.ts
export class ValidationService {
  /** EDIT-002（フレットが 0 から 24 の外）を先に見て、次に EDIT-001（同じ拍の同じ弦）。 */
  validateNotePlacement(target: EditTarget, position: CursorPosition, stringNumber: number, fret: number): ValidationOutcome;
  /** EDIT-003（足した後の小節の数が 2048 を超える）。count は足す小節の数（既定 1）。 */
  validateBarInsertion(target: EditTarget, count?: number): ValidationOutcome;
  /** EDIT-005（足した後のパートの数が 8 を超える）。 */
  validatePartCount(target: EditTarget): ValidationOutcome;
  /** EDIT-004（100 文字を超える）。value は先頭 100 文字に切り詰めた値（3.10 節）。 */
  validateMemoText(text: string): { value: string; outcome: ValidationOutcome };
  /** EDIT-010（拍子の分子か分母が範囲の外）。 */
  validateTimeSignature(signature: TimeSignatureSpec): ValidationOutcome;
  /** EDIT-011（回数が 0 か 2 から 10 の外）と EDIT-015（対応する開始の無い終わり）。 */
  validateRepeat(score: model.Score, barIndex: number, patch: RepeatPatch): ValidationOutcome;
  /** EDIT-012（付点）と EDIT-016（連符）。 */
  validateBeatDuration(spec: BeatDurationSpec): ValidationOutcome;
}
```

| 確かめること | 確かめる時 | 扱い | コード |
|---|---|---|---|
| 同じ拍の同じ弦にもう音符がある | 音符を置くとき・音符を動かすとき | 拒み、その弦の音符を赤枠で示す <!-- req 04:c9f1910b.7c18 --> <!-- req 04:a6384200.879a --> | `EDIT-001` |
| フレットが 0 から 24 の外 | フレットを入れるとき | 入力そのものを受け付けない <!-- req 04:bb6ff68d.3681 --> <!-- req 04:5c319e4e.cbfb --> | `EDIT-002` |
| 足した後の小節の数が 2048 を超える | 小節を足すとき | 拒む <!-- req 04:b774242e.3e2b --> <!-- req 04:fb331e1c.30cc --> | `EDIT-003` |
| 足した後のパートの数が 8 を超える | パートを足すとき（`AddPartCommand` の前） | 拒む <!-- req 04:2763cadc.4039 --> <!-- req 04:9ae56e85.87b7 --> | `EDIT-005` |
| メモが 100 文字を超える | メモを入れているときと確定したとき | 入力は止めず、確定したメモを先頭 100 文字に切り詰めて持つ（3.10 節） <!-- req 04:83f16f6a.5329 --> <!-- req 04:83f16f6a.1821 --> <!-- req 04:83f16f6a.920e --> <!-- req 04:d706cd42.ff38 --> <!-- req 04:d706cd42.3e9d --> | `EDIT-004` |
| タグの数が 50 を超える | タグを新しく作るとき（[[data-model-persistence.md#6]] の 6.3 節） | 拒む <!-- req 04:446f2ad7.eb2c --> | `TAG-001` |
| 曲の数が 900 件（上限の 90%）に届く | 新しく曲を作るとき（[[data-model-persistence.md#9]]） | 拒まずに前もって知らせる <!-- req 04:d7bf4eed.cd0a --> | `SONG-001` |
| 曲の数が 1000 件に届いている | 新しく曲を作るとき | 拒む <!-- req 04:3e7df339.6cc8 --> <!-- req 04:b32982a4.326b --> | `SONG-002` |
| 小節の音価の合計が拍子の長さを超える | 音符を置くとき・音価を変えるとき・拍子を変えるとき | 確かめない（拒まない） <!-- req 04:9d608aed.c76b --> <!-- req 04:9d608aed.6fa6 --> <!-- req 04:9d608aed.9adc --> | — |

- 小節の数・パートの数・タグの数の上限は、超えたら操作そのものを拒むハードキャップなので、Warning から Error に分け直したもの（[[../basic_design/13_design_decision_points.md#3]] B20）として扱う。 <!-- req 04:23e82a7d.d09c --> <!-- req 04:23e82a7d.aec6 --> <!-- req 04:23e82a7d.66a1 --> <!-- req 08:456057c8.a187 -->
- 曲の数の 900 件の知らせは、追加を続けられる予告なので、3 つと違って Warning のままとする。 <!-- req 04:3151b315.946d -->
- 新しく音符を置くときも、拍子と音価の変更と同じく、今ある拍を捨てない。 <!-- req 04:9b6459b8.dd02 -->
- 小節の音価の合計が拍子を超えたら、超えたまま持つ。 <!-- req 04:9b6459b8.6b1d -->
- 合計が拍子より短いときも、超えたときと同じく拒まない。 <!-- req 04:14e8d4fe.7165 -->
- 足りない分は、暗黙の休符（4.4 節）で埋まっているものとして扱う。 <!-- req 04:14e8d4fe.1689 -->
- (b) `EDIT-001` の `context` に `{ trackIndex, barIndex, voiceIndex, beatIndex, stringNumber }` を入れ、`ScoreHighlightBinder`（[[screens-navigation.md#13]] の 13.2 節）が、その弦の今ある音符に赤枠を付ける。基本設計の「該当弦をハイライト」を、Error の赤枠の出し方（13.1 節）にそろえたため。
- (b) `validateNotePlacement` は `EDIT-002` を先に見て、範囲の外なら弦の重複を見ない。入力そのものを受け付けない方を先に知らせるため。
- (b) パートの数の確かめは、`ValidationService` に `validatePartCount` として置き、別のクラスに分けない。確かめを 1 つのクラスに集め、`EditingService` が呼ぶ所を 1 つにするため（[[part-tuning-management.md#2]] の 2.3 節の「コマンド層の検証」をここで受ける）。
- 本節の確かめは、どれも C2（条件の網羅）まで単体テストで確かめる。 <!-- req 04:aab507cc.ec48 -->

## 6. タイとスラー

[[../basic_design/04_editing_core.md#5]] を受ける。alphaTab の属性への写し方は 3.4 節、キーは [[screens-navigation.md#9]]。

- 直前の拍と同じ高さの音を続けて置いたときに、タイを自動の候補として示す。 <!-- req 04:185969b3.a182 -->
- 候補を確定すると、前の音符の `Note.tieToNext` を真にする `SetTieCommand` を発行する。 <!-- req 04:185969b3.371a -->
- (b) 同じ高さは、同じ弦で同じフレットのときとする。alphaTab のタイは同じ弦の次の音符をつなぐ（3.4 節）ので、弦が違うと同じ高さでもタイでつなげないため。
- (b) 候補は、入力ツールバーの「タイ」ボタンを強調して示し、ボタンか Ctrl+T で確定する（[[screens-navigation.md#7]] の 7.3 節）。次に音を置く・カーソルを動かす・Esc で候補を消し、何も付けない。候補を確定するまで曲を変えないため。
- 範囲を選んだ拍に「スラー付与」をすると、範囲の音符に共通の `slurGroupId` を付ける `SetSlurCommand` を発行する。 <!-- req 04:a7216746.1b6b -->
- スラーはタイと別のコマンドにする。 <!-- req 04:a7216746.93d4 -->
- 画面でも、スラー付与はタイと別のボタン（入力ツールバーの「スラー付与」）で出す。 <!-- req 04:a7216746.751a -->
- キーも、タイ（Ctrl+T）と別のキー（Ctrl+Shift+T）で出す。 <!-- req 04:a7216746.a48e -->
- (b) 新しい `slurGroupId` は、その曲で使っていない一番小さい番号を振る。曲のファイルの中でスラーの組を見分けられれば足り、番号に意味を持たせないため。

## 7. 奏法記号の確定

[[../basic_design/04_editing_core.md#6]] を受ける。記号を持つ所（Note と Beat の分け方）は 3.5 節、ポップオーバーと右クリックの画面は [[screens-navigation.md#10]] の 10.2 節と 10.3 節。

### 7.1 自動の候補

- 候補の条件を「タイミングが密接」のようなあいまいな言い方で決めない。 <!-- req 04:382533c3.6ba3 -->
- 条件は下の表の数のしきい値で決め、しきい値は実装で直せる定数として 1 か所に持つ（`TECHNIQUE_SUGGEST_THRESHOLDS`、`packages/core/src/editing/techniqueSuggestion.ts`）。 <!-- req 04:382533c3.f163 -->

| 候補 | 条件 |
|---|---|
| スライド | 同じ弦の続く拍で、直前の拍との間が 1 拍以内、フレットの差が 1 から 4 のとき、自動で示す <!-- req 04:83a2b7f3.745c --> <!-- req 04:83a2b7f3.3bb3 --> <!-- req 04:83a2b7f3.7c05 --> |
| ハンマリング | 同じ条件で、フレットが上がるとき <!-- req 04:089368ff.c8f2 --> |
| プリング | 同じ条件で、フレットが下がるとき <!-- req 04:b0caa0e8.caec --> |
| スタッカート | 音価が 8 分音符以下で、次の拍が休符のとき <!-- req 04:810805eb.ddde --> |

- フレットの差が 4 を超えるときは、候補を出さない。 <!-- req 04:f5e1c5aa.e775 -->
- 直前の拍との間が 1 拍を超えるときも、候補を出さない。 <!-- req 04:f5e1c5aa.e64a -->
- (b) 直前の拍は、同じパートの同じボイスで 1 つ前の拍とし、小節をまたいでも数える。間は、直前の拍の始まりから今の拍の始まりまでの長さとし、1 拍は拍子の分母の音符 1 つの長さとする。スライドとハンマリングは小節の境目でもふつうに弾くため。
- (b) スタッカートの候補は、短い音符の後ろに休符の拍を置いたとき（`InsertRestCommand` の後）に、前の音符に対して示す。次の拍が休符かどうかは、休符を置いたときに初めて決まるため。
- 自動の候補は示すだけにとどめる。 <!-- req 04:85ceb726.7eb6 -->
- 候補を自動では付けない。 <!-- req 04:85ceb726.34c5 -->
- 利用者は、示した候補を 1 回のクリックで承認できる。 <!-- req 04:cf7c2b69.32ce -->
- 利用者は、候補を無視して、別の記号を手で選んでもよい（7.2 節）。 <!-- req 04:cf7c2b69.b619 -->
- 同時に出す候補は 2 件までとする。 <!-- req 04:5521c4d0.453a -->
- スライドとハンマリングかプリングが同時に当たるときは、フレットの上下で決まるハンマリングかプリングと、スライドを並べて出す。 <!-- req 04:5d8840c7.06da -->
- 並べた 2 つのうち、利用者が選んだほうの記号を付ける。 <!-- req 04:5d8840c7.3852 -->
- 流れ：音符を置いた直後（`PlaceNoteCommand` が成り立った後）に、`EditingService.suggestTechniques(placed)` が候補を 0 から 2 件返し、画面はポップオーバーで強調して出す（[[screens-navigation.md#10]] の 10.3 節）。候補をクリックすると、その候補の patch で `SetTechniqueCommand` を発行する。次の入力（音を置く・カーソルを動かす・Esc）で候補を閉じ、何も付けない。

```ts
// packages/core/src/editing/techniqueSuggestion.ts
export interface TechniqueSuggestion {
  kind: 'slide' | 'hammer' | 'pull' | 'staccato';
  /** 記号を付ける音符（スライド・ハンマリング・プリングは前の音符、スタッカートは短い音符）。 */
  target: NoteRef;
  patch: NoteTechniquePatch;
}
export const TECHNIQUE_SUGGEST_THRESHOLDS: {
  readonly minFretDelta: 1;
  readonly maxFretDelta: 4;
  /** 直前の拍との間の上限（拍の数）。 */
  readonly maxGapBeats: 1;
  /** スタッカートの候補を出す一番長い音価。 */
  readonly staccatoMaxDuration: model.Duration.Eighth;
};
/** 0 から 2 件。純粋な関数（Score を変えない）。 */
export function suggestTechniques(score: model.Score, placed: NoteRef): readonly TechniqueSuggestion[];
```

- (b) スライド・ハンマリング・プリングは、始まりの音（前の音符）に付ける（`Note.slideOutType` は `SlideOutType.Shift`、`Note.isHammerPullOrigin` は真）。alphaTab は、この 3 つを始まりの音符の属性で持つため（3.5 節）。スライドを `Shift` にするのは、要件 4.1 がスライドの種類を候補で分けることを求めておらず、種類を変えるのは 7.2 節の手での指定に任せるため。
- 自動の候補の判定は、間とフレットの差の組み合わせなので、C2（条件の網羅）まで単体テストで確かめる。 <!-- req 04:371ad8f2.a313 -->

### 7.2 手での指定

- 機械で推し量れない記号は、いつも手で選ぶ部品から、はっきり指定して付ける。 <!-- req 04:86129f01.4d2d -->
- PC 版の部品は、右クリックのメニューか、ダブルクリックで開くポップオーバー（[[screens-navigation.md#10]] の 10.3 節）とする。 <!-- req 04:86129f01.4cc8 -->
- 右クリックのメニューでは、7 項目の「奏法記号の候補の一覧」で開く一覧（10.3 節と同じポップオーバー）に、自動の候補（7.1 節）に加えて、候補にならないチョーキングの幅と形・ハーモニクスの種別も選べる形で並べる。右クリックの項目は 7 つのままとし、足さない（基本設計 04 章 6.2 節）。 <!-- req 04:5a4f538f.0b79 --> <!-- req 04:5a4f538f.39ec --> <!-- req 04:5a4f538f.7f71 --> <!-- req 04:5a4f538f.553c -->
- チョーキングの幅は、1 音（全音）・半音・1 音半・カスタムから選べる。 <!-- req 04:86129f01.8a3b --> <!-- req 04:86129f01.83fe --> <!-- req 04:86129f01.146c --> <!-- req 04:86129f01.974c -->
- ハーモニクスの種類は、自然・人工・ピンチから選べる（`Note.harmonicType` の `Natural`・`Artificial`・`Pinch`）。 <!-- req 04:86129f01.1ebe --> <!-- req 04:86129f01.0d2b --> <!-- req 04:86129f01.c719 -->
- パームミュートの範囲は、手で指定する（3.5 節の「その音だけ」と「次の音まで」）。 <!-- req 04:86129f01.c9e9 -->
- タッピング・スラップ・ポップは、手で指定して付ける。 <!-- req 04:86129f01.e094 --> <!-- req 04:86129f01.3c19 --> <!-- req 04:86129f01.941b -->

### 7.3 コマンドの形

- 自動の候補で付けても手で付けても、中では、指定したキーだけを変える部分更新の patch を渡す形にそろえる。 <!-- req 04:68003a6e.8a08 -->
- Note の奏法記号（3.5 節の Note の属性）は、patch で指定した所だけを変える。 <!-- req 04:68003a6e.6016 -->
- 形は 2 つとする。Note の単位は `SetTechniqueCommand(position, stringNumber, patch)` とする。 <!-- req 04:ff98cea1.4d8d -->
- Note の単位で扱うのは、チョーキング（`bendType` と `bendPoints`）・スライド・ハンマリング・プリング・ハーモニクス・パームミュート・ビブラート・ゴースト・スタッカート・アクセント（`accentuated`）とする。 <!-- req 04:ff98cea1.34bb --> <!-- req 04:ff98cea1.db56 --> <!-- req 04:ff98cea1.d569 --> <!-- req 04:ff98cea1.b6ef --> <!-- req 04:ff98cea1.b674 --> <!-- req 04:ff98cea1.2ba9 --> <!-- req 04:ff98cea1.bbc6 --> <!-- req 04:ff98cea1.b56b --> <!-- req 04:ff98cea1.e51c --> <!-- req 04:ff98cea1.0aab --> <!-- req 04:ff98cea1.809a --> <!-- req 04:ff98cea1.484a --> <!-- req 04:ff98cea1.ad18 -->
- Beat の単位は `SetBeatTechniqueCommand(position, patch)` とする。 <!-- req 04:b2efe81a.3e54 -->
- Beat の単位で扱うのは、スラップ・ポップ・タップ・ブラシとする（3.5 節）。 <!-- req 04:b2efe81a.0ae5 --> <!-- req 04:b2efe81a.b529 --> <!-- req 04:b2efe81a.26e5 --> <!-- req 04:b2efe81a.9737 -->

```ts
// packages/core/src/editing/commands/noteAttributeCommands.ts
/** 指定したキーだけを変える。 */
export interface NoteTechniquePatch {
  slideOutType?: model.SlideOutType;
  isHammerPullOrigin?: boolean;
  harmonicType?: model.HarmonicType;
  isPalmMute?: boolean;
  vibrato?: model.VibratoType;
  isGhost?: boolean;
  isStaccato?: boolean;
  accentuated?: model.AccentuationType;
  bendType?: model.BendType;
  bendPoints?: readonly BendPointSpec[];
}
/** alphaTab の BendPoint に当たる。value は 1 が 1/4 音。 */
export interface BendPointSpec { readonly offset: number; readonly value: number }
/** 指定したキーだけを変える。 */
export interface BeatTechniquePatch { slap?: boolean; pop?: boolean; tap?: boolean; brushType?: model.BrushType }

export class SetTechniqueCommand implements Command {
  /** kind 'set-technique'。affectedTrackIndices は [position.trackIndex]。undo は patch で指定したキーの前の値だけを戻す（bendPoints は中身を写して持つ）。 */
  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, patch: NoteTechniquePatch);
}
export class SetBeatTechniqueCommand implements Command {
  /** kind 'set-beat-technique'。affectedTrackIndices は [position.trackIndex]。 */
  constructor(target: EditTarget, position: CursorPosition, patch: BeatTechniquePatch);
}
```

- (b) チョーキングの幅は、`bendType` を `BendType.Bend` にし、`bendPoints` を始まり（`offset` 0、`value` 0）と終わり（`offset` 60、`value` は幅）の 2 点で持つ。幅の `value` は、半音が 2、1 音が 4、1 音半が 6 とする。alphaTab の `BendPoint.value` が 1/4 音の単位で、`offset` が拍の中の位置（0 から 60）のため。外すときは `bendType` を `None`、`bendPoints` を空にする。
- チョーキングの幅で「カスタム」を選ぶと、幅と形の両方を選ぶ欄を、同じポップオーバーの中に出す（2026-10-08 本人決定、honnin-queue 56 番。ポップオーバーは [[screens-navigation.md#10]] の 10.3 節）。
- 幅は 1/4 音きざみで、1/4 音から 3 音までの 12 とする（`BendPointSpec.value` の 1 から 12。alphaTab 1.8.4 の `BendPoint.MaxValue` も 12）。選ぶ欄には数をそのまま出さず、呼び方で出す：1 が「1/4 音」、2 が「半音」、3 が「3/4 音」、4 が「1 音」、5 が「1 音と 1/4」、6 が「1 音半」、7 が「1 音と 3/4」、8 が「2 音」、9 が「2 音と 1/4」、10 が「2 音半」、11 が「2 音と 3/4」、12 が「3 音」。呼び方の文言は 1 節の決まりのとおり `packages/ui-desktop` に置く。
- (b) 1 音より上の呼び方は、基本設計 04 章 6 節の「1音半」（1 音に半を足す呼び方）と、決定の「1/4 音・半音・3/4 音・1 音」の刻みを続けた形とする。端数を「と 1/4」「と 3/4」で足すのは、1 音の何倍かと端数を分けて読めるため。
- 形は「上げる」「上げて戻す」「戻す（あらかじめ上げた音を戻す）」の 3 つとし、alphaTab の `bendType` と `bendPoints` へ次のように写す（幅の value を v とする）。

| 形 | `bendType` | `bendPoints`（offset と value の組） |
|---|---|---|
| 上げる | `BendType.Bend` | (0, 0)・(60, v) |
| 上げて戻す | `BendType.BendRelease` | (0, 0)・(20, v)・(40, v)・(60, 0) |
| 戻す | `BendType.PrebendRelease` | (0, v)・(60, 0) |

- 上げる形は、「1 音」「半音」「1 音半」を選んだときと同じ写し方（上の (b) の 2 点）とする。
- (b) 上げて戻す形を 4 点で持つのは、alphaTab 1.8.4 の描画（`alphaTab.core.mjs` の、TAB のチョーキングの点を作る所）が `BendRelease` で 1 つ目・2 つ目・4 つ目の点の値を読み、曲を読み込んだときの `Note` の後処理も、始まりと終わりが同じ値で中の 2 点が上の値の 4 点を `BendRelease` と読むため。中の 2 点の位置（20 と 40）は描画では使わないので、拍の中を 3 つに分けた位置に置く。
- (b) `Note.bendStyle` は変えず、alphaTab の既定（`BendStyle.Default`）のままにする。alphaTab 1.8.4 の再生の側は、`BendStyle.Default` のときに `bendPoints` をそのまま鳴らし（`alphaTab.core.mjs` の `_generateBend`）、別の形（`Gradual`・`Fast`）では `BendRelease` の 1 つ目から 3 つ目の点だけを読んで、4 点の形では戻らないため。記譜の形（`notation.notationMode`）は本書のどこでも変えておらず、alphaTab の既定（GuitarPro）では `bendStyle` を書き換えない（`SongBook` のときだけ書き換える）。
- (b) ビブラートは、付けるときに `VibratoType.Slight`、外すときに `VibratoType.None` とする。要件 4.1 がビブラートの強さを分けていないので、強さを 1 つに決めるため。
- (b) パームミュートの「次の音まで」は、その音符と同じ弦の次の音符への `SetTechniqueCommand` 2 つを `CompositeCommand` にまとめて出す。1 回の取り消しで 2 つとも外れるため（データの持ち方は 3.5 節）。
- アーティキュレーションを外すときも、同じ `SetTechniqueCommand` を使う。 <!-- req 04:f06f4e9e.3ebe -->
- 外すときは、`accentuated` を `None`、`isStaccato` を偽、`isGhost` を偽にする patch を送る。 <!-- req 04:f06f4e9e.1c61 --> <!-- req 04:f06f4e9e.7386 --> <!-- req 04:f06f4e9e.ee4a --> <!-- req 04:f06f4e9e.eac0 -->
- patch は、指定したキーだけを変える。 <!-- req 04:f06f4e9e.7d1d -->
- 譜面の上の記号の描き方は、alphaTab の描画に任せる。 <!-- req 04:375df782.32a2 -->
- 外す対象は、3.5 節のアーティキュレーションの 5 つ（[[../basic_design/02_data_model.md#3.3]]）に限る。 <!-- req 04:14db0c45.0a7a -->

## 8. コードネーム

[[../basic_design/04_editing_core.md#7]] を受ける。表示の入切のメニューは [[screens-navigation.md#8]] の 8.1 節、コード名の手での直しの画面は [[screens-navigation.md#10]] の 10.3 節、フレットボード図は [[screens-navigation.md#12]] の 12.9 節。

- 拍の音符の並び（和音）が確定するたびに、コード名を推し量る。 <!-- req 04:d2c6e77d.37d5 -->
- 推し量るのは `ChordDetectionService` が受け持つ。 <!-- req 04:d2c6e77d.3b55 -->
- 構成音は、弦のチューニングとフレットから実際の音の高さを出して求める（カポの分も足す。[[part-tuning-management.md#2]] の 2.4 節）。音の高さは playback-integration.md の 9.1 節の `computeRealMidiPitch` を呼んで出し、`ChordDetectionService` の中で加算を書かない（基本設計 05 章 10 節。式を 1 か所に置くため）。 <!-- req 04:d2c6e77d.5297 --> <!-- req 05:c5000213.860c -->
- 確定した和音から、ルートの音を推し量る。 <!-- req 04:d2c6e77d.8b01 -->
- 確定した和音から、コードの種類（下の表の 14 の型）を推し量る。 <!-- req 04:d2c6e77d.b1a6 -->
- (b) 確定するたびの推し量りは、`CommandHistory.onCommandApplied`（2.2 節）で、変わったパートの拍の結果を捨て、次に描くときに推し直す形にする。拍の音符を変えるコマンドがどれでも、結果を古いまま残さないため。推し量った結果は曲のファイルに書かない。

```ts
// packages/core/src/editing/ChordDetectionService.ts
export interface ChordDetectionResult {
  /** 出す名前（例 "Am7"、"C/E"）。 */
  name: string;
  /** ルートの音の高さの類（0 が C）。 */
  rootPitchClass: number;
}
export class ChordDetectionService {
  /** Beat.text（手で入れた値）があればそれを、無ければ detect の名前を返す。 */
  resolveDisplayName(score: model.Score, trackIndex: number, beat: model.Beat): string | null;
  /** 当てはまる型が無いときは null。 */
  detect(score: model.Score, trackIndex: number, beat: model.Beat): ChordDetectionResult | null;
}
/** 照らし合わせの本体（純粋な関数）。lowestPitchClass は一番低い音の高さの類。 */
export function detectFromPitchClasses(pitchClasses: ReadonlySet<number>, lowestPitchClass: number): ChordDetectionResult | null;
```

- 推し量り方は、知っているコードの形の辞書との照らし合わせを使う。 <!-- req 04:033d1262.43b0 -->
- 構成音からの和声の解析（転回形を含む）を、辞書の照らし合わせと組み合わせて使う。 <!-- req 04:033d1262.c115 -->
- 候補が 2 つ以上あるときは、最も一般的なものを既定の候補として出す。 <!-- req 04:033d1262.d754 -->
- 最も一般的なものは、開放的な形で、テンションを含まない解釈とする。 <!-- req 04:033d1262.1f97 -->
- 基本設計が詳細設計で決めてよいとした中身（辞書の範囲と転回形の優先の順）は、下の表と、表の後の 3 つの順で決める（2026-10-07 本人決定、honnin-queue 53 番の #3 で、数える要求とした）。 <!-- req 04:033d1262.aae4 -->

| 順 | ルートからの半音 | 名前に付ける字 |
|---|---|---|
| 1 | 0・4・7 | （無し。メジャー） |
| 2 | 0・3・7 | `m` |
| 3 | 0・7 | `5` |
| 4 | 0・5・7 | `sus4` |
| 5 | 0・2・7 | `sus2` |
| 6 | 0・3・6 | `dim` |
| 7 | 0・4・8 | `aug` |
| 8 | 0・4・7・10 | `7` |
| 9 | 0・3・7・10 | `m7` |
| 10 | 0・4・7・11 | `maj7` |
| 11 | 0・4・7・9 | `6` |
| 12 | 0・3・7・9 | `m6` |
| 13 | 0・3・6・10 | `m7b5` |
| 14 | 0・3・6・9 | `dim7` |

- (b) 照らし合わせは、構成音の高さの類の集まり（オクターブの違いを除いたもの）が、表の型を 12 のルートのどれかへずらしたものと、ちょうど同じになるかで見る。集まりで見るので、転回形（どの音が一番下か）によらず同じ型に当たる。表に当たらない集まり（1 つの音だけ・型に無い組み合わせ）は名前を出さない。
- (b) 辞書の照らし合わせと、構成音からの和声の解析は、この手順の中で次のように分かれる。辞書の照らし合わせは、上の表の 14 の型（知っているコードの形）を 12 のルートへずらした集まりと、構成音の集まりを突き合わせる段とする。和声の解析は、当たった解釈のうちどれをルートとするかを、一番低い音（転回形でどの音が下にあるか）と型の音の数で選び（下の箇条の順）、ルートが一番低い音でなければ分数の形にする段（その次の箇条）とする。ここで言う「知っているコードの形」は、押さえ方（指の形）ではなく、ルートからの半音の並び（表の型）とする。押さえ方はチューニングとカポで変わり、同じ和音に押さえ方がいくつもあるため。
- (b) 同じ集まりに 2 つ以上の解釈が当たるとき（C6 と Am7 の 0・4・7・9 と 9・0・4・7）は、(1) 一番低い音をルートとする解釈、(2) 構成音の少ない型、(3) 表の上にある型、の順で 1 つを選ぶ。表は、テンションを含まない 3 和音を上に、4 和音を下に並べている。基本設計の「開放的な形・テンションを含まない解釈」を、低い音をルートに取ることと、音の少ない型を先にすることに当てたため。
- (b) 選んだ解釈のルートが一番低い音でないときは、「ルートの名前/一番低い音の名前」の分数の形（C/E）で出す。音の名前はシャープで書く（C・C#・D・D#・E・F・F#・G・G#・A・A#・B）。転回形で押さえていることを名前から読めるようにし、調によるフラットとシャープの書き分けは推し量らないため。
- 推し量った候補は、拍のコード名の手での指定の欄と組で持つ。 <!-- req 04:ac38ae63.de21 -->
- 欄が空なら推し量った候補を出し、値があれば手で入れた値を優先して出す。 <!-- req 04:ac38ae63.e266 -->
- 利用者が手で直すと、`SetChordNameCommand` でその値を入れる。 <!-- req 04:ac38ae63.7f9f -->
- 手での指定の欄の実体は、alphaTab の `Beat.text` とする。 <!-- req 04:ac38ae63.10a0 -->
- コードダイアグラム（コード名の横に置く小さな指板の図）は、コード名の表示の機能として出さない。押さえる位置の図は、フレットボード図（[[screens-navigation.md#12]] の 12.9 節）だけが出す。 <!-- req 04:3c0f7ef9.36a9 -->
- コード名の表示は、既定でオンとする。 <!-- req 04:a5e0a900.17d0 -->
- 利用者は、表示メニューの「コードネーム表示切替」（`'view.chordNames'`）で、コード名を一時的に隠せる。 <!-- req 04:a5e0a900.de4b -->
- 表示のオンとオフの状態は、編集ウィンドウごとに持つ。 <!-- req 04:a5e0a900.2c95 -->
- 表示のオンとオフは、取り消しとやり直しの対象にしない。 <!-- req 04:a5e0a900.12c2 -->
- 表示の既定をオフにはしない。 <!-- req 04:a5e0a900.6631 -->
- 隠している間も、推し量った結果と手で入れた値は持ち続ける。 <!-- req 04:a5e0a900.9385 -->
- また出したときは、持っていた値をそのまま出す。 <!-- req 04:a5e0a900.bfe8 -->
- (b) 表示のオンとオフは、`ChordNameVisibility`（`packages/core/src/ui`、編集ウィンドウごとに 1 つ。`visible: boolean` と `setVisible(v)` と `onChange`）に持つ。曲のファイルにもアプリの設定にも書かず、窓を開くたびにオンから始める。基本設計が「一時的に隠す」としていて、次に開いたときも隠したままにする決まりが無いため。
- (b) コード名は、alphaTab の `Beat.text` の描画に任せず、alphaTab の設定の `notation.elements` で `NotationElement.EffectText` を切り、譜面の上に `<div>` を重ねて出す（色の帯の `PartColorOverlay` と同じ重ね方、[[view-modes.md#1]] の 1.2 節）。推し量った名前を曲のファイルの `Beat.text` に書かずに出せ、表示の入切で譜面を描き直さずに済むため（alphaTab 1.8.4 の型定義に `EffectText`「The additional beat text shown above the staff.」）。
- フレットボード図の見出しに、カーソルの拍のコード名（手で入れた値があればその値、無ければ推し量った名前）を書き添える（`ChordDetectionService.resolveDisplayName`）。 <!-- req 04:01f26429.bb2b -->
- コード名の表示をオフにしている間は、譜面の上と同じく、フレットボード図の見出しからも消す。 <!-- req 04:01f26429.9054 -->

## 9. 範囲選択とクリップボード

[[../basic_design/04_editing_core.md#9]] を受ける。選択モードの入切と Shift＋クリックと右クリックの入口は [[screens-navigation.md#10]]、2 つ目のボイスがあるときの範囲は 3.1 節。

- 範囲を決めた後にできることは、選択モードの入切・範囲を決める・ハイライト・右クリックのメニューからのコピーと切り取りと削除・貼り付けの一式で閉じ、ここに無い操作を選択範囲の機能として足さない。 <!-- req 04:78e0ca5a.93ed -->
- この一式に、別の節が決めた範囲への操作 3 つを加え、範囲を決めた後にできることを 1 か所にまとめる（2026-10-08 本人決定、honnin-queue 59 番）。加えるのは、範囲の複製（Ctrl+D、下の複製の箇条）・範囲の音価のまとめ変更・範囲へのスラー付与の 3 つとする。この 3 つを加えた一式の外の操作は、選択範囲の機能として足さない。譜面で選んでいる小節を書き出しの範囲に使うのは、書き出し画面の範囲の選び方で、選択範囲への操作に数えない（中身は基本設計 07 章の回）。 <!-- req 04:e8b4b690.e2ad --> <!-- req 04:2ee5fa07.8fae -->
- 範囲の音価のまとめ変更は、音価のパレットか Alt+1 から Alt+6 で選ぶと、選んだ拍の音価・付点・連符をまとめて変える（4.3 節の `SetBeatDurationCommand` を拍ごとに作り、`CompositeCommand` にまとめる）。 <!-- req 04:d1aa0a06.13cf --> <!-- req 04:d1aa0a06.f181 --> <!-- req 04:d1aa0a06.df5d --> <!-- req 04:d1aa0a06.d1e3 --> <!-- req 04:d1aa0a06.8cfc -->
- 範囲へのスラー付与は、「スラー付与」ボタンかキーで、範囲の音符に共通の `slurGroupId` を付ける（6 節の `SetSlurCommand`）。 <!-- req 04:fc070d69.6323 --> <!-- req 04:fc070d69.3ad6 --> <!-- req 04:fc070d69.34da -->
- 範囲選択（コピーと貼り付けのための範囲）は、選択モードのトグルで行う。 <!-- req 04:a282a4fd.2f60 -->
- 選択モードは入切のトグルとする。 <!-- req 04:b37cfa16.0c50 -->
- 始まりの位置をクリックしてから終わりの位置をクリックすると、範囲が決まる。 <!-- req 04:b37cfa16.eece -->
- PC 版では、Shift＋クリックでも範囲を決められる（[[screens-navigation.md#9]]）。 <!-- req 04:b37cfa16.e036 -->
- 範囲は、始まりから終わりまでのクリックで決め、ハイライトで示す。 <!-- req 04:6c92b4f5.aee2 -->
- 決めた範囲には、右クリックのメニューからコピーができる。 <!-- req 04:6c92b4f5.edb5 -->
- 決めた範囲には、右クリックのメニューから切り取りができる。 <!-- req 04:6c92b4f5.d5e2 -->
- 決めた範囲には、右クリックのメニューから削除ができる。 <!-- req 04:6c92b4f5.edfc -->
- その後で、貼り付け先（別のパートでもよい）へカーソルを動かして貼り付けられる。 <!-- req 04:6c92b4f5.2f94 -->
- 基本設計の「コンテキストツールバー」は、PC 版では右クリックのメニュー（[[screens-navigation.md#10]] の 10.2 節）として出す（基本設計 03 章 1 節の読み替えの表のとおり）。 <!-- req 04:822c8ccc.b0be -->
- 範囲は 1 つのパートの中だけとする。 <!-- req 04:5f846f8d.efee -->
- パートをまたいだ選択はできない。 <!-- req 04:5f846f8d.bcf6 -->
- (b) 範囲の始まりと別のパートの拍を Shift＋クリックしたときは、そのクリックを新しい始まりにして範囲を作り直す。パートをまたぐ範囲を作らずに、利用者の新しい選択の向きに合わせるため。
- 決めた範囲は、譜面の上で背景の色を変えて示し、選択を解くまで出し続ける。 <!-- req 04:19abfd3a.6e62 -->
- ハイライトの色は、基本設計 14 章の配色のトークンを使う（accent-soft の背景を重ねる。[[screens-navigation.md#15]] の 15.8 節）。 <!-- req 04:19abfd3a.a24a -->
- 範囲が画面の外へ続いていても、スクロールすれば同じ表示が続く。 <!-- req 04:19abfd3a.2c64 -->
- (b) ハイライトは、範囲の拍の矩形（alphaTab の `boundsLookup.findBeat`）を、色の帯（[[view-modes.md#1]] の 1.2 節の `PartColorOverlay`）と同じく、表示領域の上に重ねた `<div>` で出し、描き直しとスクロールのたびに置き直す。描き直しのたびに同じ範囲を出し続けるため。
- コピーは、選択範囲の拍と音符を、クリップボードの中の形（`ClipboardSnapshot`）に写す。 <!-- req 04:6b10293b.a24a -->
- クリップボードは、アプリのメモリの中に持つ（OS のクリップボードとはつながない）。 <!-- req 04:6b10293b.0ff2 -->
- (b) OS のクリップボードとつながないのは、基本設計が任意としていて、写す形を別のアプリと合わせる決まりが無いため。
- クリップボードは編集ウィンドウごとに 1 つ持ち（`ClipboardService` を編集ウィンドウごとに作る）、別の曲の編集ウィンドウへは貼れない。v1 は同じ曲の中だけとする（2026-10-08 本人決定、honnin-queue 60 番）。
- 注：`ClipboardService` は `EditingService` に外から渡し（4.8 節のコンストラクタの引数 `clipboard`）、写す中身（`ClipboardSnapshot`）は数と真偽だけでできているので、別の曲の編集ウィンドウへ貼る働きを足すときは、渡す `ClipboardService` を差し替えればよい。v1 ではそのための口を作らない（要件 5.1 節の「将来の拡張として見込むのは次の4点に限る」に入らないため。2026-10-08 本人決定、honnin-queue 62 番）。
- (b) 写すのは、拍の音価（`BeatDurationSpec`）と、音符の弦とフレットと Note の奏法記号（`NoteTechniquePatch` の形）と、拍の Beat の単位の奏法記号（`BeatTechniquePatch` の形）とする。タイとスラーの印は写さない。範囲の外の音符とつながる印を写すと、貼った先でつながる相手がいないため。

```ts
// packages/core/src/editing/ClipboardService.ts
export interface ClipboardNote { string: number; fret: number; techniques: NoteTechniquePatch }
export interface ClipboardBeat { duration: BeatDurationSpec; notes: ClipboardNote[]; beatTechniques: BeatTechniquePatch }
export interface ClipboardSnapshot { beats: ClipboardBeat[] }
export class ClipboardService {
  copy(target: EditTarget, range: SelectionRange): void;
  /** 選択範囲が無いときの右クリックの「コピー」「切り取り」。音符なら 1 拍に音符 1 つ、休符の拍なら音符の無い 1 拍を写す（9 節）。 */
  copyAt(target: EditTarget, at: NoteRef | CursorPosition): void;
  hasContent(): boolean;
  getSnapshot(): ClipboardSnapshot | null;
  clear(): void;
}
```

- 切り取りは、コピーと同じ中身をクリップボードへ置く。 <!-- req 04:87026b50.a1ab -->
- 切り取りは、そのうえで選択範囲の拍と音符を消す。 <!-- req 04:87026b50.9f10 -->
- クリップボードへ置く側は、曲の状態を変えないのでコマンドにしない。 <!-- req 04:87026b50.97b5 -->
- 消す側だけを、コマンド（`DeleteSelectionCommand`、ラベルの id は `'cut'`）として履歴に積む。 <!-- req 04:87026b50.4a49 -->
- 切り取りは、取り消しで元に戻せる。 <!-- req 04:87026b50.8bfc -->
- 選択範囲の削除は、クリップボードを変えない。 <!-- req 04:5fc9d7c5.91b8 -->
- 選択範囲の削除は、範囲の中の拍と音符を消す。 <!-- req 04:5fc9d7c5.bff1 -->
- 選択範囲の削除では、小節そのものは消さない。 <!-- req 04:5fc9d7c5.1bb4 -->
- 小節の枠・拍子・テンポ・セクションマーカー・小節メモは、消さずに残す。 <!-- req 04:5fc9d7c5.a986 --> <!-- req 04:5fc9d7c5.09ad --> <!-- req 04:5fc9d7c5.2ef2 --> <!-- req 04:5fc9d7c5.8d15 --> <!-- req 04:5fc9d7c5.9737 -->
- 選択範囲の削除は、取り消しで元に戻せる。 <!-- req 04:5fc9d7c5.26db -->
- 選択範囲の削除では、範囲の中の音のある拍は、音を消して同じ長さの休符の拍として残す。範囲の中の休符の拍は、取り除いて後ろを詰める（4.5 節と 4.4 節と同じ扱い。2026-10-08 本人決定、honnin-queue 57 番）。切り取りの削除の側も同じとする。
- (b) 範囲の中の休符の拍を取り除いて詰めるのは、基本設計 04 章 2 節が明示した休符を消す手段に選択範囲の削除を挙げ、消したときは拍を取り除いて詰めると決めているため。音のある拍を休符にし、休符の拍を取り除くので、範囲を 2 回消すと範囲の拍が詰まる。
- 選択範囲が無いときに右クリックのメニューで「コピー」を選ぶと、右クリックした音符 1 つか休符の拍 1 つを対象にする（基本設計 03 章 8 節、[[screens-navigation.md#10]] の 10.2 節）。`EditingService.copyAt(at)` は、音符（`NoteRef`）なら、その拍の音価と Beat の単位の奏法記号と、その音符 1 つ（弦・フレット・Note の奏法記号）だけを持つ 1 拍を、休符の拍（`CursorPosition`）なら、その音価の音符の無い 1 拍を、`ClipboardService.copyAt` でクリップボードへ写す。 <!-- req 03:11fad8e2.9cd4 -->
- 選択範囲が無いときに右クリックのメニューで「切り取り」を選ぶと、`EditingService.cutAt(at)` が、`copyAt(at)` と同じ中身をクリップボードへ置いたうえで、右クリックした音符か休符の拍を `deleteNoteAt(at)`（4.5 節）と同じ消し方で消す。消す側だけを `DeleteNotesCommand` として履歴に積み、取り消しで元に戻る。 <!-- req 03:11fad8e2.6b64 -->
- (b) 音符 1 つでも 1 拍の形で写すのは、貼り付けが拍を単位にカーソルの前へ挿入する（下の貼り付けの箇条）ので、範囲のコピーと同じ形にしておけば貼り付けを分けずに済むため。音のある拍の空いた弦を右クリックしたときは「コピー」「切り取り」を押せない（10.2 節）ので、`copyAt`・`cutAt` に音のある拍は渡らない。
- 切り取りと削除のコマンドの名前と形は、基本設計 04 章 8.1 節の方針のとおり、本書で次のように決める。 <!-- req 04:edaef515.a23b --> <!-- req 04:edaef515.2484 -->

```ts
// packages/core/src/editing/commands/DeleteSelectionCommand.ts
export class DeleteSelectionCommand implements Command {
  /** kind 'delete-selection'。label は切り取りなら 'cut'、削除なら 'delete-selection'。affectedTrackIndices は [range.trackIndex]。 */
  constructor(target: EditTarget, range: SelectionRange, label: 'cut' | 'delete-selection');
}
```

- 貼り付ける位置は、カーソルの位置とする。 <!-- req 04:69084e23.40f3 -->
- 貼り付け先のパートの、カーソルのある小節と拍の前へ、クリップボードの拍を順に挿入する。 <!-- req 04:69084e23.2dcd -->
- 挿入するので、今ある拍を上書きしない。 <!-- req 04:69084e23.1603 -->
- 挿入で小節の音価の合計が拍子を超えても、拒まない（5 節）。 <!-- req 04:69084e23.0d5f -->
- 貼り付け先は、コピーした元と別のパートでもよい。 <!-- req 04:69084e23.3da2 -->
- `PasteCommand` は、貼り付け先のパートの弦本数とチューニングとの合い方を確かめてから、拍と音符を写す。
- `PasteCommand` は `CompositeCommand`（2.3 節）を継ぎ、子として、クリップボードの拍ごとに、休符の拍を挿入する `InsertRestCommand`、その拍へ音符を置く `PlaceNoteCommand`（音符ごと）、Note の奏法記号を写す `SetTechniqueCommand`（奏法記号のある音符ごと）、Beat の奏法記号を写す `SetBeatTechniqueCommand`（あるときだけ）を、挿入する順に並べる。弦の数の確かめ（はみ出す弦の音符を捨てて `EDIT-009` を出す、下の箇条）は子を作る前に行い、捨てた音符の子は作らない。1 回の取り消しで貼り付け全体が戻る（基本設計 04 章 8.2 節の複合操作）。 <!-- req 04:69084e23.b873 -->
- チューニングの違うパートへ貼るときは、フレットの数を保って写す。鳴る音の高さは、貼り付け先の弦のチューニングで変わる（2026-10-08 本人決定、honnin-queue 54 番）。フレットの数の範囲（0 から 24、5 節）はどのパートでも同じなので、フレットの数で範囲の外になる音は無い。貼り付け先で出せない音は、弦の数が足りないときのはみ出した弦の音だけで、下の箇条のとおり捨てて知らせる（基本設計 04 章 9 節の整合性チェック）。
- 貼り付け先の弦の数が足りないときは、はみ出す弦の音符を捨て、Warning（`EDIT-009`）で知らせる。 <!-- req 04:86c6fe24.3e22 -->
- 貼り付け先の弦の数が多いときは、余った弦を使わない。 <!-- req 04:b3159a59.ae6f -->
- 弦の数が多いときは、知らせを出さない。 <!-- req 04:b3159a59.a7f3 -->
- Ctrl+D の複製（基本設計 03 章 7 節）は、`DuplicateSelectionCommand(target, range)` を発行する。範囲の拍の写しを、範囲の終わりの拍のすぐ後ろ（同じ小節の中）に挿入し、クリップボードは変えない。範囲が無いときは何もしない。 <!-- req 04:7a126aa8.f2f7 --> <!-- req 04:7a126aa8.c5ec -->
- (b) 複製の写しの後ろの拍は、写しの分だけ後ろへずれ、次の小節へは送らない。貼り付けと同じく、挿入で小節の合計が拍子を超えても拒まない決まり（5 節）に合わせるため。同じパートの中の写しなので、弦の数は確かめない。

```ts
// packages/core/src/editing/commands/DuplicateSelectionCommand.ts
export class DuplicateSelectionCommand implements Command {
  /** kind 'duplicate-selection'。affectedTrackIndices は [range.trackIndex]。undo は挿入した拍を外す。 */
  constructor(target: EditTarget, range: SelectionRange);
}
```

## 10. 小節の挿入と削除、拍子とリピートとマーカー

[[../basic_design/04_editing_core.md#10]] を受ける。拍子とテンポの持ち方は 3.2 節、マーカーとメモとリピートのデータは 3.10 節と [[data-model-persistence.md#6]] の 6.1 節。

- `InsertBarCommand` は、カーソルのあるパートだけでなく、曲の全部のパートの小節の並びを同じように変える。 <!-- req 04:966b7745.62db -->
- `DeleteBarCommand` も、曲の全部のパートの小節の並びを同じように変える。 <!-- req 04:966b7745.50c3 -->
- 2 つとも、挿入か削除の位置より後ろの小節の番号を全部のパートで振り直す `CompositeCommand` として作る。 <!-- req 04:966b7745.7e31 -->
- `InsertBarCommand` の子は、曲共通の小節（`MasterBar`）を足して後ろの小節の番号と `explicitTimeSignatureBars`（3.2 節）・セクションマーカー・小節メモの小節の番号をずらす `InsertMasterBarCommand(target, at)` と、パートごとにそのパートの小節を足して 4.4 節の全音符の休符の拍を置く `InsertPartBarCommand(target, trackIndex, at)` とし、曲共通の小節を先に、パートを番号の順に並べる。
- `DeleteBarCommand` の子は、`disposition` が `'delete'` か `'move-to-previous'` のときにマーカーとメモを消すか直前の小節へ移す `MoveBarAnnotationsCommand(target, at, disposition)`、パートごとにそのパートの小節を消す `DeletePartBarCommand(target, trackIndex, at)`、曲共通の小節を消して後ろの番号を詰める `DeleteMasterBarCommand(target, at)` の順とする。
- (b) 子のコマンドは `CompositeCommand` の中だけで使い、履歴に単独で積まないので、2.6 節の一覧と 2.5 節の検算には入れない。変える項目は親のコマンドの行が受け持つため。
- 今のコードの `InsertBarCommand` と `DeleteBarCommand`（`packages/core/src/editing/commands/barCommands.ts`）は、全部のパートを 1 つのコマンドの中で変えていて、ここと違う。直すのは実装の段。
- 新しい小節の拍子は、いつも「直前を継ぐ」（null）で始める。 <!-- req 04:da501957.6bc1 -->
- 新しい小節のテンポも、いつも「直前を継ぐ」（null）で始める。 <!-- req 04:da501957.ba08 -->
- 直前の値を写して固定の値にしない。 <!-- req 04:da501957.8edb -->
- こうすると、後で挿入した位置より前の拍子やテンポを変えたときにも、新しい小節に自動で届く。 <!-- req 04:da501957.be10 -->
- 小節を消しても、前後の小節が持つ継ぐ向きの指定は変わらない（null は値ではなく、継ぐという向きの指定のため）。 <!-- req 04:3ece5295.e915 -->
- (b) 継ぐ向きの指定は、拍子は `explicitTimeSignatureBars` の一覧（3.2 節）、テンポは `MasterBar.tempoAutomations` が空であることで持つ。挿入と削除では一覧の小節の番号をずらすだけで、継ぐという指定そのものは変えない。そのうえで、継いでいる小節の `MasterBar` の拍子の値を、一覧から作り直す 1 つの関数 `resolveInheritedTimeSignatures(score, explicitBars)`（`packages/core/src/editing/scoreModel.ts`）で、挿入・削除・拍子の変更のコマンドの `execute` と `undo` の最後にそろえる。alphaTab の `MasterBar` は拍子の値を小節ごとに必ず持つ（3.2 節）ので、継いでいる小節の値を写し直す所を 1 つにするため。`resolveInheritedTimeSignatures` は `InsertMasterBarCommand`・`DeleteMasterBarCommand`・`SetTimeSignatureCommand` の `execute` と `undo` の最後に呼ぶ。
- (b) `resolveInheritedTimeSignatures` は、継ぐ向きの指定（一覧と null）を作り直す再計算ではなく、変わっていない指定から、alphaTab の `MasterBar` が小節ごとに持つ拍子の値を写し直すだけの処理とする。基本設計 04 章 10 節の「追加の再計算処理は不要」は、継ぐ向きの指定を作り直さないことを言っていて、この写し直しはそれに当たらない。
- 挿入の位置と継ぐ向きの組み合わせを含むこの 2 つ（挿入と削除の継ぎ方）は、C2（条件の網羅）まで自動テストで確かめる。 <!-- req 04:46b41b9d.713b -->
- 小節を消すとき、その小節にセクションマーカーがあれば、扱いを利用者に確かめる（Critical のダイアログ、基本設計 08 章）。 <!-- req 04:e3f0a6c5.90e5 -->
- 小節メモがあるときも、同じく扱いを確かめる。 <!-- req 04:e3f0a6c5.5660 -->
- 選択肢の 1 つは「削除する」とする。 <!-- req 04:e3f0a6c5.2a85 -->
- もう 1 つの選択肢は「直前の小節へ移動する」とする。 <!-- req 04:e3f0a6c5.1568 -->
- 既定（フォーカスのある）ボタンは「直前の小節へ移動する」とする（[[../basic_design/13_design_decision_points.md#3]] B2）。 <!-- req 04:e3f0a6c5.78f4 -->
- 流れ：`EditingService.deleteBar(at)` は、消す小節にマーカーもメモも無ければ、すぐ `DeleteBarCommand(at, 'none')` を発行する。どちらかがあれば、注入した `BarDeleteConfirmer.confirm(context)` で Critical のダイアログ（`EDIT-017`）を出し、選ばれた答え（`'delete'` か `'move-to-previous'`）を `DeleteBarCommand` の `disposition` に渡して発行する。ダイアログを出し、答えを受け取る所は `NotificationUIBinder`（[[screens-navigation.md#13]] の 13.2 節）とする。

```ts
// packages/core/src/editing/EditingService.ts
export type BarDeleteDisposition = 'none' | 'delete' | 'move-to-previous';
export interface BarDeleteConfirmer {
  /** Critical のダイアログ（EDIT-017）を出し、選ばれた答えを返す。ダイアログは応答するまで閉じない。 */
  confirm(context: { barIndex: number; markerCount: number; memoCount: number }): Promise<'delete' | 'move-to-previous'>;
}
```

- (b) ダイアログの文は「小節 N にあるセクションマーカーと小節メモを、どうしますか？」（N は 1 から数えた小節の番号）とし、ボタンは基本設計の 2 つの言葉のままとする。基本設計 08 章 5 節の、ボタンを肯定と否定のはっきりした言葉にし「OK」だけにしない決まりに合わせるため。Critical のダイアログは応答するまで閉じない（[[screens-navigation.md#3]] の 3.3 節）ので、小節の削除そのものを取りやめるのは、消した後の取り消し（Ctrl+Z）で行う。
- (b) 「直前の小節へ移動する」で、消すのが 1 小節目のとき（直前が無いとき）は、次の小節（消した後の 1 小節目）へ移す。マーカーとメモを失わないという B2 の目的を、直前が無いときにも守るため。
- 既存の小節の拍子を変える経路として、`SetTimeSignatureCommand` を置く（G26 の是正）。 <!-- req 04:668eb13b.bcf8 -->
- `SetTimeSignatureCommand` は `null` を渡すと継ぐ状態へ戻せ、その動きは `SetTempoCommand` と対称にする。 <!-- req 04:424c2764.dc8d -->
- 拍子を縮めた結果として小節の合計が拍子を超えるときも、今ある拍を捨てない（[[../basic_design/13_design_decision_points.md#3]] B38）。 <!-- req 04:c962308d.ff9a -->
- 拍子を変える画面の入口は、ステータスバーの拍子の表示をクリックして入力する形とする（[[screens-navigation.md#7]] の 7.4 節）。 <!-- req 04:6b57c348.c162 -->

```ts
// packages/core/src/editing/commands/SetTimeSignatureCommand.ts
export interface TimeSignatureSpec { numerator: number; denominator: number }
export class SetTimeSignatureCommand implements Command {
  /** kind 'set-time-signature'。signature が null なら継ぐ状態へ戻す。affectedTrackIndices は全部のパート。undo は前の値と継ぐ印を戻す。 */
  constructor(target: EditTarget, barIndex: number, signature: TimeSignatureSpec | null);
}
// packages/core/src/editing/commands/SetRepeatCommand.ts
export interface RepeatPatch { isRepeatStart?: boolean; repeatCount?: number }
export class SetRepeatCommand implements Command {
  /** kind 'set-repeat'。指定したキーだけを変える。affectedTrackIndices は全部のパート。 */
  constructor(target: EditTarget, barIndex: number, patch: RepeatPatch);
}
```

- 拍子の範囲の確かめは `ValidationService.validateTimeSignature`（`EDIT-010`、範囲の正は [[00_reference.md#5]]）。
- リピートを付ける・外すのは `SetRepeatCommand` とする。開始を付けるのは `{ isRepeatStart: true }`、外すのは `{ isRepeatStart: false }`、終わりの回数を付けるか変えるのは `{ repeatCount: n }`（2 から 10）、外すのは `{ repeatCount: 0 }` とする（[[screens-navigation.md#8]] の 8.1 節のメニューの形）。回数の確かめは `ValidationService.validateRepeat`（範囲の外は `EDIT-011` で拒み、対応する開始の無い終わりは `EDIT-015` で知らせたうえで発行する。[[../basic_design/13_design_decision_points.md#3]] B39）。`undo` は patch で指定したキーの前の値を戻す。 <!-- req 08:31d3875f.b615 -->
- セクションマーカーを足すのは、メニューの「セクションマーカー管理」（[[screens-navigation.md#8]] の 8.1 節）で `AddSectionMarkerCommand` を発行する。変えるのは `EditSectionMarkerCommand(target, markerId, label)`、消すのは `DeleteSectionMarkerCommand(target, markerId)` で、どちらも譜面の上のマーカーから発行する。
- マーカーの名前を変えるのは、マーカーのダブルクリックか、マーカーの右クリックのメニューの「名前を変える」で、ラベルをその場で文字の入力に切り替え、確定で `EditSectionMarkerCommand` を発行する。消すのは、マーカーにマウスを乗せると出る「×」か、マーカーの右クリックのメニューの「削除」で、`DeleteSectionMarkerCommand` を発行する（2026-10-08 本人決定、honnin-queue 61 番。画面の部品は [[screens-navigation.md#5]] の 5.2 節、メニューは [[screens-navigation.md#10]] の 10.2 節）。
- 名前を空にして確定したときは、マーカーを消さず、コマンドを出さずに前の名前に戻す（同じ決定）。消すのは「×」と右クリックの「削除」だけとし、名前を打ち直している途中で消えないようにする。
- (b) マーカーの 3 つのコマンドの確かめ（data-model-persistence.md 6.1 節が基本設計 04 章の回に回した分、2026-10-14 追記）：`AddSectionMarkerCommand` は、作るときに `barIndex` が曲の小節（`Score.masterBars`）の範囲の中にあることを確かめ、外なら `RangeError` を投げる。`EditSectionMarkerCommand` と `DeleteSectionMarkerCommand` は、`markerId` のマーカーが無ければ `RangeError` を投げる。画面は今ある小節とマーカーにしか発行しないので、どちらもアプリの不具合で起き、利用者向けのエラーコードを作らないため。
- 同じ小節にマーカーがもうあるときに `AddSectionMarkerCommand` を発行したらどうするか（2 つ目を並べる・断る・名前を置き換える）は、利用者に見えるのに基本設計 02 章 3.5 節と 04 章に決まりが無いので、本書では決めない（honnin-queue 114 番）。
- 3 つのマーカーのコマンドの `affectedTrackIndices` は全部のパートとする（`MasterBar.section` に写すので譜面を描き直す。3.10 節）。メモのコマンドは `[]`（譜面に描かず、小節メモ一覧パネルを直すだけ）とする。
