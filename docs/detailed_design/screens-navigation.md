# 画面群・ナビゲーション 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 8「画面群・ナビゲーション」
- **ブランチ名**：`feature/screens-navigation`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 下書き（08 の試走で直した文。章ごとに確かめ直す）

以下は作り直す前の本書の節を写したもの。見出しの番号は作り直す前のまま。

#### 4.9.5 `NotificationUIBinder`（アプリ全体単一）／`ScoreHighlightBinder`（編集ウィンドウ単位）

```ts
export interface NotificationSource {
  subscribe(handler: (event: NotificationEvent) => void): () => void;
}
export interface NotificationChannelSinks {
  toast(event: NotificationEvent): void;
  highlight(event: NotificationEvent): void;
  modal(event: NotificationEvent): void;
}

export class NotificationUIBinder {
  constructor(sinks: NotificationChannelSinks);
  /** NotificationCenter を購読し、レベルから決まるチャンネルへ振り分ける。showOnScreen が false の記録は飛ばす（2026-09-24）。戻り値で解除。 */
  attach(source: NotificationSource): () => void;
  detach(): void;
}

export interface ScoreHighlightHost {
  showErrorHighlight(request: ScoreHighlightRequest): void;
  clearErrorHighlight(): void;
}

export class ScoreHighlightBinder {
  constructor(host: ScoreHighlightHost);
  /** Error レベル通知の context（trackIndex / barIndex 等）からハイライト要求を組み立てる。 */
  handle(event: NotificationEvent): void;
}
```

ドメイン層は `NotificationCenter.report(code, context)` を呼ぶだけで、表示チャンネルはコードから機械的に決まる（`LEVEL_TO_CHANNEL`）。**2026-09-24 追記（本人決定）**：`NotificationUIBinder` は画面に出す受け手で、`NotificationEvent.showOnScreen` が `false` の記録はどのシンクにも渡さずに飛ばす（ログにはログの受け手が書く、[[error-logging-foundation.md#2.1]]）。ドメイン層は自分がどう表示されるかを知らない（旧詳細設計 `00_reference.md` §2（`2759936` 時点））。

**通知の表示規則（2026-09-24 追記、[[../basic_design/08_error_logging.md#1]]・[[../basic_design/08_error_logging.md#4]]・[[../basic_design/03_screens_ui_pc.md#11]]）**：`NotificationChannelSinks` の各実装はこの表に従う。この表は画面に出す記録（`showOnScreen: true`）に当てはめる。画面に出さない設定のコード（[[00_reference.md#5]]の印「画面に出さない」、例：`PLAY-003`）は、どの行にも出さない。色は直値を使わず、[[../basic_design/14_visual_design_system.md#3]]のトークンを CSS 変数（`--color-` ＋表の名前。例：`--color-surface`・`--color-warning`・`--color-danger`。14 章 3 節の冒頭と [[../basic_design/08_error_logging.md#4]]のとおり）で参照する。CSS 変数の定義は [[web-core-foundation.md#3.5.1]] の Tailwind CSS v4 の `@theme` にだけ置く（2026-09-24 追記）。

| レベル | 出し方 | 色トークン | アイコン | 消えるまで | 操作 |
|---|---|---|---|---|---|
| Info | ステータスバー付近のトースト | 専用色を持たない。背景・文字は `surface` 系 | Info 用のアイコン | `INFO_TOAST_DURATION_MS`（=3000）で自動消滅 | 止めない |
| Warning | 同じトーストで、Info と見分けられるよう目立たせる | 背景 `warning-soft`、枠・文字 `warning` | Warning 用のアイコン | 自動消滅（Info と同じ定数） | 止めない |
| Error | 譜面上の該当箇所は `ScoreHighlightBinder` の赤枠（4.5.1節）＋ステータスバーのメッセージ。譜面の小節を指せない Error（`barIndex` を持たないもの。`TAG-001` が該当）は、その操作をした入力欄や一覧（例：タグ管理ダイアログの入力欄）を赤枠にしてメッセージを添える。赤枠を付ける入力欄や一覧も無い再生の失敗（`PLAY-001`・`PLAY-002`、旧詳細設計 `playback-integration.md` §10.4（`2759936` 時点））は、赤枠を出さずステータスバーのメッセージだけにする | 赤枠 `danger`、背景 `danger-soft` | — | ハイライトは `DEFAULT_HIGHLIGHT_DURATION_MS`（旧詳細設計 `00_reference.md` §4（`2759936` 時点）） | 該当する操作だけを拒否し、他の操作は続けられる |
| Critical | モーダルダイアログ | 見出し・肯定ボタン `danger` | — | 応答するまで | **応答するまで背後の操作を受け付けない。Esc・外側クリック・×では閉じない**。見出し・本文・ボタンは `NotificationEvent` の `title`／`message`／`buttons`（[[error-logging-foundation.md#2.1]]）を使い、**「OK」だけのボタンにしない** |

- **トーストのキュー**：トーストが同時に複数発生したら、`NotificationUIBinder` がキューに積んで 1 件ずつ出す。キューは **Warning を Info より先に**出し、同じレベルの中は発生順にする（[[../basic_design/08_error_logging.md#1.1]]）
- アイコンの素材は [[../basic_design/14_visual_design_system.md#7.2]] のアイコンライブラリから選ぶ

#### 4.9.6 `ToolbarViewModel` / `StatusBarViewModel`（いずれも編集ウィンドウ単位）

```ts
export interface HistoryStateSource {
  canUndo(): boolean; canRedo(): boolean;
  subscribe(listener: () => void): () => void;
}
export interface PlaybackStateSource {
  readonly isPlaying: boolean;
  onStateChanged(listener: () => void): () => void;
}

/** 保存ボタンの状態（2026-09-24 追加）。SaveStateTracker が充足する。 */
export interface SaveStateSource {
  /** まだ保存されていない編集がある（●を出す）。 */
  readonly hasUnsavedEdits: boolean;
  /** 最後に保存した時刻（epoch ms）。一度も保存していなければ null。 */
  readonly lastSavedAt: number | null;
  onStateChanged(listener: () => void): () => void;
}

/** 編集ウィンドウ（songId）ごとに 1 つ。bootstrap が既存の通知へつなぐ（下の表）。 */
export class SaveStateTracker implements SaveStateSource {
  /** 開いた曲の SongSummary.updatedAt を初期値にする。まだ保存していない曲は null。 */
  constructor(initialSavedAt: number | null);
  markEdited(): void;
  markSaveStarted(): void;
  markSaved(savedAt: number): void;
  readonly hasUnsavedEdits: boolean;
  readonly lastSavedAt: number | null;
  onStateChanged(listener: () => void): () => void;
}

export class ToolbarViewModel {
  /** playback は未配線の間 null を渡してよい（再生ボタンは非活性）。save も同じ（●と時刻を出さない）。 */
  constructor(history: HistoryStateSource, playback?: PlaybackStateSource | null, save?: SaveStateSource | null);
  getState(): ToolbarState;
  onChange(listener: () => void): () => void;
  togglePanel(name: ToolbarPanelName): void;
  setPanelVisible(name: ToolbarPanelName, visible: boolean): void;
  dispose(): void;
}

export interface StatusBarContext {
  timeSignature: string; tempoBpm: number; capoFret: number;
}
export interface StatusBarContextProvider { read(): StatusBarContext; }
export interface ZoomPercentSource { readonly zoomPercent: number; }

export class StatusBarViewModel {
  constructor(cursor: CursorLike, zoom: ZoomPercentSource, context: StatusBarContextProvider);
  getState(): StatusBarState;
  onChange(listener: () => void): () => void;
  /** 外部要因（テンポ変更等）での再計算を促す。 */
  refresh(): void;
  dispose(): void;
}

export interface ToolbarState {
  canUndo: boolean; canRedo: boolean; isPlaying: boolean;
  hasUnsavedEdits: boolean; lastSavedAt: number | null;
  panels: { mixer: boolean; partManagement: boolean; tuning: boolean; fretboard: boolean; memoList: boolean };
}
/** 等幅表示する数値群（14章 §4）。barNumber は 1 始まり。 */
export interface StatusBarState {
  barNumber: number; timeSignature: string; tempoBpm: number; capoFret: number; zoomPercent: number;
}
export type ToolbarPanelName = keyof ToolbarState['panels'];
```

**保存の状態をツールバーへ渡す経路（2026-09-24 追加、[[../basic_design/03_screens_ui_pc.md#5]]）**：新しい通知は作らず、既存の 3 つの呼び出し口を bootstrap がつなぐ。

| 既存の呼び出し口 | いつ呼ばれるか | つなぐ先 |
|---|---|---|
| `CommandHistory` の `onChange`（旧詳細設計 `editing-core.md` §6.6.3（`2759936` 時点）の `CommandHistoryOptions`。bootstrap が `AutoSaveScheduler.notifyDirty(songId)` をつないでいるもの） | 編集のたび | `markEdited()`：編集の通し番号を 1 つ進め、`hasUnsavedEdits` を true にする |
| `AutoSaveScheduler` の `resolveDocument(songId)`（旧詳細設計 `data-model-persistence.md` §3.2（`2759936` 時点）） | 保存ループが、書き出す内容を取り出す直前 | `markSaveStarted()`：その時点の通し番号を「保存中の番号」として控える |
| `AutoSaveHooks.onSaved(songId)` | 保存に成功したあと | `markSaved(Date.now())`：`lastSavedAt` を更新し、通し番号が「保存中の番号」から進んでいなければ `hasUnsavedEdits` を false にする |

- 通し番号を控えるのは、保存中に来た編集で●を消さないため。`AutoSaveScheduler` は保存中に来た編集をもう 1 周で書く（`rerunRequested`）が、1 周目の `onSaved` の時点では、その編集はまだ書かれていない
- 保存がリトライ全滅（`onError`、`FILE-001`）なら `markSaved` は呼ばれず、●は残る
- 保存ボタンの押下とメニューの `'file.save'`（Ctrl+S）は、どちらも `AutoSaveScheduler.flush(songId)` を呼ぶ。保存の完了ではトーストを出さない（`FILE-006` は欠番、[[00_reference.md#5]]）
- ツールチップの時刻は `lastSavedAt` を PC のローカル時刻で出す。**書式（今日なら時刻だけ、今日より前なら月/日、年が違えば年/月/日を足す）は [[../basic_design/03_screens_ui_pc.md#5]] が正**で、本書では繰り返さない（2026-09-24 改訂、本人決定）。「今日」との比較は、ツールチップを出すときの PC の日付で行う。`lastSavedAt` が null のあいだは時刻の行を出さない
