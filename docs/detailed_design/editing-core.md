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
