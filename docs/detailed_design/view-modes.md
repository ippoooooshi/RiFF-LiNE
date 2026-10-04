# 表示モード 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 6「表示モード」
- **ブランチ名**：`feature/view-modes`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 1. 表示の 3 つのモードと色の帯

[[../basic_design/03_screens_ui_pc.md#5]] のうち、中央の譜面の表示領域・記譜形式・段組みを受ける。表示領域のまわり（ツールバー・パートリスト・入力ツールバー・ステータスバー）は [[screens-navigation.md#7]]。alphaTab の描画を呼ぶ窓口は [[web-core-foundation.md#12]] の `ScoreRenderHost`。

### 1.1 表示領域と 3 つのモード

- 編集ウィンドウの中央の表示領域は alphaTab で描き、タブ譜を出す。 <!-- req 03:8220060d.8aeb --> セクションマーカーは、この表示領域に直接出す（[[screens-navigation.md#5]] の 5.2 節）。 <!-- req 03:a8373793.f1cb -->
- 表示領域の上に、表示モードをフォーカス・全体・スコアの 3 つから切り替える部品を置く。 <!-- req 03:283409de.752e --> 部品はタブの形のセグメントコントロールで、選ぶとすぐに切り替わる。フォーカス表示へ <!-- req 03:bd71c1fa.3cd1 -->も、スコア表示へも、この部品で切り替える。 <!-- req 03:bd71c1fa.6376 --> メニューとキー（Ctrl+1／Ctrl+2／Ctrl+3）の入口は、基本設計 6 節と 7 節の回に screens-navigation.md の 8 節と 9 節へ書く。
- 3 つのモードは、1 つの表示モードの状態（`RenderViewMode` の `'focus' | 'scroll' | 'score'`）の値の違いとして作る（[[screens-navigation.md#3]] の 3.3 節）。
- フォーカス表示では、1 つのパートを出し、音符を入れたり直したりできる。 <!-- req 03:bd71c1fa.e0a0 --> 描くのは、カーソルのある小節の周りの 8 小節だけとする（2026-10-04 本人決定、honnin-queue 27 番。Phase 1 の実機で見直す。描き方は [[web-core-foundation.md#12]] の 12.2 節）。8 小節は、カーソルのある小節の 4 小節前から始める。曲の頭に近くて 4 小節前が無いときは 1 小節目から始め、曲の終わりに近いときはある分だけ描く（今のコードの `FOCUS_RANGE_BAR_SPAN = 8` と範囲の作り方、`packages/core/src/viewmodes/ViewModeController.ts`）。
- 全体スクロール表示でも、1 つのパートを出し、音符を入れたり直したりできる。 <!-- req 03:bd71c1fa.63a8 --> 曲の全部の小節を描き、スクロールで見る。
- スコア表示は、全部のパートを縦に並べて見るだけで、音符の編集はしない（2026-10-03 本人決定、honnin-queue 9 番）。 <!-- req 03:bd71c1fa.49c7 --> (b) スコア表示の間は、編集のコマンドを発行する入口（譜面のクリックでカーソルを置くこと、編集のキー、入力ツールバー）を受け付けない。入口ごとに確かめると漏れるので、入口が呼ぶ編集の処理（`EditingService`）の手前で、今のモードが `'score'` なら何もしない形にする。その間、入力ツールバーは隠し、譜面の表示領域をその分広げる（2026-10-04 本人決定、honnin-queue 28 番。[[screens-navigation.md#7]] の 7.3 節）。
- 曲を開いたときのモードは、曲のファイルの `appMeta.settings.defaultViewMode`（[[data-model-persistence.md#6]] の 6.4 節）とする。
- (b) モードを切り替えても、カーソルの位置と入力中の音価は変えない。モードは見え方だけの違いで、編集の状態を持たないため（作り直す前の本書 4.1 節の決まりを引き継ぐ）。

```ts
// packages/core/src/viewmodes/ViewModeController.ts
/** 編集ウィンドウごとに 1 つ。 */
export class ViewModeController {
  constructor(host: ViewModeRenderHost, cursor: CursorLike, options?: { initialMode?: RenderViewMode; onChange?: () => void });
  get currentMode(): RenderViewMode;
  setViewMode(mode: RenderViewMode): void;
  /** その小節が表示の範囲に入っていなければ、範囲を動かして描き直す。入っていれば何もしない。 */
  revealBar(barIndex: number): void;
  isBarVisible(barIndex: number): boolean;
  onChange(listener: () => void): () => void;
  dispose(): void;
}

/** ViewModeController が使う ScoreRenderHost の部分。 */
export interface ViewModeRenderHost {
  applyViewMode(request: ViewModeRenderRequest): void;
  /** @param scale 1 が 100%。 */
  applyZoom(scale: number): void;
}
/** ViewModeController がカーソルの追従に使う CursorController の部分。 */
export interface CursorLike {
  readonly position: { readonly trackIndex: number; readonly barIndex: number; readonly beatIndex: number };
  onChange(listener: () => void): () => void;
}
```

- (b) カーソルが動くたびに、(1) パートが変わったら描くパートを合わせ、(2) フォーカス表示で、カーソルの小節が今の範囲の外に出たときだけ、範囲を計算し直して描き直す。範囲の中の動きでは描き直さない。描き直しを減らし、譜面がちらつかないため（作り直す前の本書 4.4.2 節の規則を引き継ぐ。再生のカーソルの追従も同じ「範囲の外に出たときだけ」で、[[../basic_design/05_playback_audio.md#5]]）。
- (b) `ViewModeController` は作るときに今のモードを `ScoreRenderHost` へ渡すので、`ScoreRenderHost.initialize()` と `loadScore()` の後に作る。初期化の前の `ScoreRenderHost` を渡すと、例外になるため（作り直す前の実装で起きた不具合。[[../basic_design/13_design_decision_points.md#3]] B36）。

### 1.2 色の帯

- スコア表示では、各パートの段に、パートを見分ける色の半透明の帯を重ね、パートを見分けやすくする（帯を重ねる形は 2026-10-01 本人決定、honnin-queue 4 番）。 <!-- req 03:bd71c1fa.1536 --> 帯の色はパートの `Part.color`（`Track.color`）で、パートの色をスコア表示でパートを見分ける色に使う。 <!-- req 02:9960ee1a.fa68 --> 帯を重ねる矩形は `ScoreRenderHost` が `boundsLookup` から出す（[[part-tuning-management.md#2]] の 2.2 節）。
- フォーカス表示では、パートの色の帯を重ねず、1 色のままにする。色分けは、効く場面（合奏の確認）に限る。 <!-- req 03:bd71c1fa.d765 --> 全体スクロール表示も 1 つのパートを出すので、帯を重ねない。

```ts
// packages/core/src/ui/PartColorOverlay.ts
/** 編集ウィンドウごとに 1 つ。スコア表示のときだけ帯を出す。 */
export class PartColorOverlay {
  constructor(container: HTMLElement);
  /** パートごとの矩形と色から、半透明の帯の <div> を重ねる。 */
  update(regions: readonly PartRegion[], colorByTrackIndex: ReadonlyMap<number, string>): void;
  clear(): void;
  dispose(): void;
}
/** パートの描画の領域（表示領域の左上を原点にした CSS ピクセル）。 */
export interface PartRegion { trackIndex: number; x: number; y: number; width: number; height: number }
```

- (b) 帯は `packages/core/src/ui` の `PartColorOverlay` が作り、モードがスコア表示へ変わったときと、スコア表示で描き直しが終わったとき（`renderFinished`）に `update` を呼ぶ。スコア表示から離れたら `clear` を呼ぶ。描き直すと矩形の位置が変わるので、描き直しのたびに合わせるため。今のコード（G24 で作ったもの）と同じ形。

### 1.3 ズーム

- ズームは、曲の全体を見渡す大きさから 1 つの音符を見る大きさまでを、スライダーで変えられる。 <!-- req 03:bd71c1fa.3052 --> Ctrl＋ホイールでも変えられ、スライダーと両方に対応する。 <!-- req 03:bd71c1fa.b6d2 --> スライダーはステータスバーに置く（2026-10-03 本人決定、honnin-queue 17 番。[[screens-navigation.md#7]] の 7.4 節）。 <!-- req 03:bd71c1fa.3f0c -->
- ズームの値は、表示モードごとに別に持つ（[[../basic_design/13_design_decision_points.md#3]] B16）。フォーカス表示で変えた値は、全体スクロールとスコアの値を変えない。
- 倍率の上下限は、要件 4.5 節のとおり Phase 0 から 1 で技術的に微調整して決める値で <!-- req 03:bd71c1fa.d764 -->、今のコードの値で決め、Phase 1 の実機で見直す（2026-10-04 本人決定、honnin-queue 27 番）。倍率は 25% から 400% までとし、ズームインとズームアウトで 1 回に 10% 変える。モードごとの初めの値は、フォーカス表示 180%・全体スクロール表示 100%・スコア表示 100% とする。値の置き場所は今のコード（`packages/core/src/viewmodes/ZoomController.ts`）の `MIN_ZOOM_PERCENT`・`MAX_ZOOM_PERCENT`・`ZOOM_STEP_PERCENT`・`DEFAULT_ZOOM_PERCENT_BY_MODE` の 1 か所とし、同じ値を別の所に書かない。
- 設定ダイアログの「譜面のデフォルトズームレベル」（[[screens-navigation.md#12]] の設定ダイアログ）は、上のモードごとの初めの値に掛ける倍率で、既定は 100%。 <!-- req 03:63d12087.a6c7 --> 曲を開いたときの各モードの値は、初めの値にこの倍率を掛けた値とし、25% から 400% の外になったら端に丸める。モードごとに別の値を持つことは変えず、1 つの値にまとめない（基本設計 10 節の設定ダイアログの 3 項目目）。 <!-- req 03:63d12087.7827 -->

```ts
// packages/core/src/viewmodes/ZoomController.ts
/** 編集ウィンドウごとに 1 つ。 */
export class ZoomController {
  constructor(host: ViewModeRenderHost, viewMode: ViewModeController, options?: {
    initialZoomPercentByMode?: Partial<Record<RenderViewMode, number>>;
    /** ズームを変えるたびに呼ぶ。ステータスバーの表示に使う。 */
    onZoomChange?: (percent: number, mode: RenderViewMode) => void;
  });
  get zoomPercent(): number;
  zoomPercentOf(mode: RenderViewMode): number;
  setZoom(percent: number): void;
  zoomIn(): void;
  zoomOut(): void;
  /** モードを切り替えた後に呼び、そのモードのズームを描き直しに渡す。 */
  reapplyForCurrentMode(): void;
}
```

- (b) スライダーと Ctrl＋ホイールは、どちらも `setZoom` を呼ぶ（[[screens-navigation.md#3]] の 3.3 節）。上下限の外の値は、上下限に丸めて例外を出さない。ズームの入口が値を確かめずに渡しても、描き直しが壊れないため。
- (b) `ScoreRenderHost` へは `applyZoom(percent / 100)` で渡し、`ScoreRenderHost` は alphaTab の `display.scale` に入れて描き直す。モードを切り替えたら、組み立ての処理（bootstrap）が `viewMode.onChange(() => zoom.reapplyForCurrentMode())` でつなぎ、切り替えた先のモードの値を渡す。

### 1.4 記譜形式と段組み

- 表示領域はタブ譜だけを描き <!-- req 03:c65c6cf4.0d74 -->、五線譜（標準記譜）を並べて描かない（要件 4.1 節）。 <!-- req 03:c65c6cf4.20db --> この決まりは、フォーカス表示 <!-- req 03:8684dc3e.6167 -->・全体スクロール表示 <!-- req 03:8684dc3e.5f00 -->・スコア表示 <!-- req 03:8684dc3e.79f7 -->・印刷プレビュー <!-- req 03:8684dc3e.4697 -->・PDF の出力 <!-- req 03:8684dc3e.e473 -->で同じにする。
- alphaTab の既定のままでは五線譜も描けるので、描き方の設定でタブ譜だけをはっきり指定する。 <!-- req 03:350e409f.6de8 --> (b) 指定は、各パートの alphaTab の `Staff` の `showTablature` を真、`showStandardNotation` を偽にして行う。表示の設定の `display.staveProfile` は、alphaTab 1.8.4 の型定義で非推奨とされ（「Set the notation visibility by modifying the Staff properties.」）、`Staff` の側で決めるよう書かれているため。パートを作るとき（今のコードの `packages/core/src/domain/newSong.ts` と `packages/core/src/parts/partModel.ts`）にこの 2 つを入れ、`ScoreRenderHost.loadScore` でも全部の `Staff` に入れ直してから描く。別のアプリで作った譜面を読んだときも、タブ譜だけにそろえるため。印刷プレビューと PDF の描き方は export-print.md（基本設計 07 章の回）。
- 1 段に並べる小節の数は決めた数にせず <!-- req 03:1ad73499.2af8 -->、画面の幅に合わせて自動で変える。 <!-- req 03:1ad73499.ce14 --> この決まりは、フォーカス表示 <!-- req 03:69b3b5d5.c75c -->・全体スクロール表示 <!-- req 03:69b3b5d5.6052 -->・スコア表示 <!-- req 03:69b3b5d5.e8c9 -->・印刷プレビュー <!-- req 03:69b3b5d5.68a8 -->・PDF の出力 <!-- req 03:69b3b5d5.ca32 -->の全部で同じにする。
- 段組みは alphaTab の標準のレイアウトに委ねる。 <!-- req 03:69b3b5d5.3c05 --> (b) alphaTab の `display.layoutMode` は既定の `LayoutMode.Page`、`display.barsPerRow` は既定の `-1`（自動）のままにし、アプリから 1 段の小節の数を渡さない。1.8.4 の型定義で、`barsPerRow` の `-1` が自動の意味で既定の値であることを確かめたため。
