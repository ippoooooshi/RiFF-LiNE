# 画面群・ナビゲーション 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 8「画面群・ナビゲーション」
- **ブランチ名**：`feature/screens-navigation`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 1. 表示の言語と書式

[[../basic_design/09_nonfunctional.md#4]] のローカライズとアクセシビリティの行を受ける。画面ごとの中身は基本設計 03 章の回に書く。

- 画面の文言とエラーメッセージは日本語だけで出し、ほかの言語への切り替えを持たない。i18n の層（メッセージのカタログ、言語の切り替えの仕組み）を作らず、文言は日本語で直接書く。 <!-- req 09:3b7fd0eb.1885 --> <!-- req 09:3b7fd0eb.63bc --> <!-- req 09:3b7fd0eb.86fd -->
- 文言を書いてよい所は 2 つに限る。エラーメッセージは `ErrorCodeRegistry` のメッセージテンプレート（error-logging-foundation.md、基本設計 08 章の回）、画面の文言は各画面の部品（`packages/ui-desktop`）。将来ほかの言語にするときは、この 2 か所を差し替える。 <!-- req 09:3b7fd0eb.6573 --> <!-- req 09:3b7fd0eb.86eb --> <!-- req 09:3b7fd0eb.b178 -->
- (b) エラーメッセージがテンプレートの外で作られないことは、通知の口の形で止める。通知の口（`NotificationCenter.report(code, context)`、error-logging-foundation.md）はエラーコードだけを受け取り、文言を引数に取らない。文言は `ErrorCodeRegistry` がコードから引く。呼ぶ側が文言を渡す道を作らなければ、直書きのエラーメッセージは画面に出ないため。
- 画面の文言がこの 2 か所の外に無いことを機械で見張る方法は、基本設計 03 章と 04 章の回に決める。作り直す前の実装では、コマンドの取り消しの名前（[[editing-core.md#2]] の 2.2 節の `Command.label`）とメニューの項目の名前が、画面の部品の外で日本語の文言を持っていた。これらをどこに置くかを先に決めないと、見張りの範囲が決まらないため。
- 数と日時の書式は、OS のロケールに従わず、日本語の表記で固定する。日時の書式は [[../basic_design/03_screens_ui_pc.md#5]] の保存ボタンのツールチップの書式が正で、ゴミ箱の削除日時と小節メモ一覧の日時も同じ書式で出す。本書では書式を繰り返さない。 <!-- req 09:3b7fd0eb.b845 -->
- (b) 日時を文字にする関数は 1 つにし、ツールチップ・ゴミ箱・小節メモ一覧の 3 か所はそれを呼ぶ。関数の名前と置き場所は 03 章の回に書く。3 か所で書式がずれないため。数と日時を文字にするときに `Intl` と `toLocale…String` を使うなら、ロケールに `'ja-JP'` を必ず渡し、ロケールを省かない。省くと OS のロケールで表記が変わるため。
- スクリーンリーダー（VoiceOver を含む）には対応しない（個人利用のため）。配色のコントラストは [[../basic_design/14_visual_design_system.md#11]] のとおり。 <!-- req 09:dfa30ca4.8ba5 -->

## 2. 上限に近づいたときの見せ方

[[../basic_design/09_nonfunctional.md#5]] を受ける。上限の値は [[../basic_design/02_data_model.md#4.3]] が正、エラーコードとレベルは [[00_reference.md#5]] が正。見せる画面の中身は基本設計 03 章の回に書く。

- 曲の数が 900 件（上限 1000 の 90%）に達したら、Warning の `SONG-001` を出す。これは予告で、1000 件に達するまでは新しい曲を作れる。 <!-- req 09:f756b91e.5895 --> <!-- req 09:f756b91e.6610 -->
- 曲の数が 1000 件に達した状態で新しい曲を作ろうとしたら、Error の `SONG-002` を出して作らない。曲の複製も同じく拒否する（[[../basic_design/06_file_io_persistence.md#10.1]]）。 <!-- req 09:f756b91e.1857 -->
- タグの数の上限は 50 件で、90% での予告の Warning は出さない。50 件に達した状態で新しいタグを作ろうとしたら、Error の `TAG-001` を出して作らない。 <!-- req 09:44b30a9f.0099 --> <!-- req 09:44b30a9f.b3c2 -->
- (b) 曲の数を数えて `SONG-001`・`SONG-002` を出すのは、曲を新しく作る処理（作る前に 1000 件かを見て、作った後に 900 件かを見る）と、曲一覧を読み込む処理（900 件かを見る）の 2 か所とする。曲を作らずに起動しただけでも予告が見えるようにするため。

## 3. 操作の読み替えと、同じ操作の複数の入口

[[../basic_design/03_screens_ui_pc.md]] の前文と [[../basic_design/03_screens_ui_pc.md#1]] を受ける。翻訳表の行と、組ごとの判定（倍になるか）は基本設計が正で、本節は画面の部品と発行するコマンドへの対応を書く。

### 3.1 PC 版の操作の決め方

- PC 版の画面の操作は、iPhone 版のタッチの操作（要件 4.5・4.6 節）を転用せず、マウスとキーボードで使う形を本書で決める。 <!-- req 03:bc06c962.5f47 --> 見た目（配色・文字・部品の形）は基本設計 14 章の回に書く。

### 3.2 iPhone 版の概念の読み替え

- 音符を入れる道具は、編集ウィンドウの下に固定して常に出すドッキングのツールバー（入力ツールバー、7.3 節）に置く。 <!-- req 03:04c3332d.6c6d --> キーボードショートカットも併せて使えるようにする（キーの表は基本設計 7 節の回に 9 節へ書く）。 <!-- req 03:04c3332d.f463 --> カテゴリはタブで切り替えず、全カテゴリを 1 つのツールバーに収める。 <!-- req 03:04c3332d.e4b2 --> 画面の幅が足りないときだけ、折り畳みの矢印で残りの項目を出す。 <!-- req 03:04c3332d.b6da -->
- 軽い調整の画面は、非モーダルのドッキングパネルにする。 <!-- req 03:c57ecc42.1435 --> パネルは表示と非表示を切り替えられ <!-- req 03:c57ecc42.3b35 -->、開いていても他の操作を止めない。 <!-- req 03:c57ecc42.58d5 --> ミキサー <!-- req 03:c57ecc42.b2d2 -->・パート管理 <!-- req 03:c57ecc42.b793 -->・チューニング設定 <!-- req 03:c57ecc42.15a9 -->はこの形にする（5 節の表）。
- 重い画面と複数ステップの画面は、ウィンドウの中に開くモーダルダイアログにする。 <!-- req 03:f134f16f.2bd8 --> エクスポート <!-- req 03:f134f16f.d7ca -->・印刷プレビュー <!-- req 03:f134f16f.e808 -->・新規曲作成 <!-- req 03:f134f16f.5203 -->はこの形にする（5 節の表）。
- ダイアログは、右上の閉じるボタンで閉じられ <!-- req 03:6733bb12.b327 -->、Esc キーでも閉じられる。 <!-- req 03:6733bb12.91fe -->
- タップはクリックに置き換え <!-- req 03:526ed5cb.cb3a -->、長押しは右クリック（コンテキストメニューを出す）に置き換える。 <!-- req 03:526ed5cb.e5a6 -->
- タップで削除する操作は、PC 版では採らない（素の左クリックはカーソルを置く操作に使うため）。 <!-- req 03:577680b2.90f8 --> 音符の削除の入口は、右クリックのコンテキストメニューの「削除」 <!-- req 03:577680b2.91c1 -->・消しゴムモード中の左クリック <!-- req 03:577680b2.424e -->・Delete キー <!-- req 03:577680b2.2dae -->・Backspace キー <!-- req 03:577680b2.5f0c -->とする。マウスの入口は基本設計 8.1 節の回に 10 節へ、キーは 7 節の回に 9 節へ書く。
- ピンチズームは、Ctrl＋マウスホイール <!-- req 03:465b44e2.bf32 -->と、ズームのスライダー <!-- req 03:465b44e2.cf6e -->に置き換える。スライダーはステータスバーに置く（7.4 節）。 <!-- req 03:465b44e2.e672 --> ズームの値の扱いは [[view-modes.md#1]]。
- パートの切り替えは、編集ウィンドウの左に常に出すパートリストのパネルで行い <!-- req 03:abcacecd.7870 -->、行をクリックして切り替える（7.2 節）。 <!-- req 03:abcacecd.5a64 -->
- メニューバーとツールバーを常に置く。 <!-- req 03:2b0586bc.646f --> ウィンドウの中の行き来は、ダイアログとパネルを開く・閉じることで表し <!-- req 03:2b0586bc.ccb5 -->、画面全体を切り替える遷移は最小限にする。 <!-- req 03:2b0586bc.26d1 --> 画面の遷移に当たるのは、曲一覧ウィンドウと編集ウィンドウの間の行き来だけとする（4 節）。 <!-- req 03:2b0586bc.18a3 -->

### 3.3 同じ操作の複数の入口

- 奏法記号の確定は、自動の候補を出す経路を主経路とし <!-- req 03:a008415b.9a44 -->、手での補正を補正の経路とする。 <!-- req 03:a008415b.0714 --> 主経路では、音符を置いた直後に自動の候補を出し <!-- req 03:a008415b.1e9c -->、利用者が候補を承認して確定する。 <!-- req 03:a008415b.29da --> 補正の経路では、音符の手動補正のポップオーバーで選ぶ（ポップオーバーは基本設計 8 節の回に 10 節へ書く）。 <!-- req 03:a008415b.0568 --> どちらの経路も、最後は同じ `SetTechniqueCommand` <!-- req 03:a008415b.c4ad -->と `SetBeatTechniqueCommand` <!-- req 03:a008415b.531d -->を発行する（[[editing-core.md#3]] の 3.8 節）。(b) 経路ごとに別のコマンドを作らない。同じ記号が経路によって違う形で曲に書かれる道を作らないため。候補の出し方の中身は editing-core.md（基本設計 04 章の回）。
- フレット入力のクイック選択バーとテンキーは同格の入口で、違いは入口の画面の部品だけとする。 <!-- req 03:b6e695a3.a660 --> どちらも `PlaceNoteCommand` を発行し <!-- req 03:b6e695a3.80e1 -->、音を置く処理を入口ごとに作らない。 <!-- req 03:b6e695a3.af28 -->
- テンポの数値の直接入力とタップテンポは、実装が倍にならない組として同格に扱う。 <!-- req 03:bd280f42.1f9d --> どちらも、同じテンポを変えるコマンド（`SetTempoCommand`、[[editing-core.md#3]] の 3.8 節の `Bar.tempoBpm` の行）を発行する。 <!-- req 03:bd280f42.8a53 --> 数値の直接入力の入口はステータスバー（7.4 節）、タップテンポの中身は playback-integration.md（基本設計 05 章の回）。
- ダイアログの閉じるボタンと Esc キーは同格の入口とし、どちらもダイアログを閉じるだけの同じ処理を呼ぶ。Esc キーでもダイアログを閉じられる。 <!-- req 03:4433e18d.558d -->
- フォーカス・全体スクロール・スコアの 3 つの表示は、1 つの表示モードという状態の値の違いとして作る（[[view-modes.md#1]] の `ViewModeController`）。 <!-- req 03:668a08a2.648e -->
- ズームのスライダーと Ctrl＋ホイールは、主経路と補正に分けない同格の入口とし、どちらも同じズームの値を変える処理（[[view-modes.md#1]] の `ZoomController`）を呼ぶ。 <!-- req 03:26f3bab9.b5c4 -->
- 音符の削除の 3 つの入口（右クリックの「削除」・消しゴム・Delete／Backspace）は、入口が違うだけで、消す対象と結果を同じにする。 <!-- req 03:f0df95f5.808d --> (b) 3 つの入口は同じ削除の処理を呼び、入口ごとに削除の処理を持たない。入口によって結果がずれる道を作らないため。

## 4. ウィンドウの構成と終了の順

[[../basic_design/03_screens_ui_pc.md#2]] を受ける。`WindowAdapter` のシグネチャは、[[web-core-foundation.md#3]] の 3.3 節の表で本書に回された分を 4.3 節に書く。

### 4.1 開くウィンドウ

- アプリを起動したら、曲一覧ウィンドウを 1 枚だけ開く。 <!-- req 03:6703d1ce.281f -->
- 曲を開くと、曲一覧ウィンドウとは別に、その曲の編集ウィンドウを新しく開く。 <!-- req 03:6d89f703.e201 --> 編集ウィンドウは曲ごとに 1 枚で、別の曲なら複数を同時に開ける。 <!-- req 03:6d89f703.214e -->
- 曲を開く操作では、先に `WindowAdapter.focusExistingWindow(songId)` を呼ぶ。 <!-- req 03:577ed31d.d369 --> その曲の編集ウィンドウがもう開いていれば、そのウィンドウを前に出し <!-- req 03:577ed31d.f110 -->、新しいウィンドウは作らない。 <!-- req 03:577ed31d.d771 --> 開いていなければ `WindowAdapter.openEditWindow(songId)` を呼ぶ（4.3 節）。
- 設定 <!-- req 03:1daee5e1.a785 -->・タグ管理 <!-- req 03:1daee5e1.8f8c -->・ゴミ箱 <!-- req 03:1daee5e1.bb56 -->・ライセンス <!-- req 03:1daee5e1.b251 -->の画面は、曲一覧ウィンドウから開くモーダルダイアログにし、別のウィンドウにしない。 <!-- req 03:1daee5e1.0d91 -->

### 4.2 ウィンドウの大きさと位置

- ウィンドウの大きさは、最小を 800×600、最大をモニタの大きさとする。 <!-- req 03:d2744895.851c --> (b) Electron の `BrowserWindow` に `minWidth: 800`・`minHeight: 600` を渡し、最大の大きさは渡さない。最大化したときに OS がモニタの大きさに合わせるため。
- 編集ウィンドウは曲ごとに、前にその曲を閉じたときの位置と大きさで開く。 <!-- req 03:d2744895.c24a --> ウィンドウを閉じたときに、位置と大きさを自動で記録する。 <!-- req 03:d2744895.7fc9 -->
- この記録は曲の編集と数えない。 <!-- req 03:d2744895.e6a5 --> 記録で、保存ボタンの未保存の●は付かない <!-- req 03:d2744895.5715 -->。取り消しの対象にもしない。 <!-- req 03:d2744895.de0f --> (b) 記録は main の `WindowManager` が、ウィンドウの `close` で `BrowserWindow.getBounds()` を読んで書き、レンダラーの `CommandHistory` を通らない。コマンドを通らなければ、●の印（7.1 節の `SaveStateTracker`）も取り消しの履歴も動かないため。
- 記録した位置が、いまつながっている画面のどれにも入らないときは、画面の中に戻して開く。 <!-- req 03:d2744895.508c --> (b) 開く前に、Electron の `screen.getAllDisplays()` の各画面の作業領域と、記録の矩形が重なるかを見る。どれとも重ならなければ、大きさはそのままで、主の画面の作業領域の中へ移して開く。
- 記録は曲のファイルに入れず、アプリの側の `window-bounds.json`（[[../basic_design/06_file_io_persistence.md#3]]）に曲の `id` ごとに 1 件置く。 <!-- req 03:d2744895.0adb --> ファイルの読み書きの中身は data-model-persistence.md（基本設計 06 章の回）。
- 初めて開く曲（記録の無い曲）の編集ウィンドウは、1280×800 の大きさで、画面の中央に開く（2026-10-04 本人決定、honnin-queue 26 番）。 <!-- req 03:d2744895.8de3 --> 画面の作業領域に 1280×800 が入らなければ、入る大きさに縮めて開く。(b) 開く画面は主の画面とし、中央の位置は Electron の `screen.getPrimaryDisplay().workArea` から計算して `BrowserWindow` の `x`・`y`・`width`・`height` に渡す。記録が画面の外のときに戻す先（上の箇条）と同じ画面にそろえ、縮めたときも同じ計算で中央に置けるため。

### 4.3 `WindowAdapter` のシグネチャ

レンダラーの Webコアが、曲の編集ウィンドウを開くときに使う口。置き場所は [[web-core-foundation.md#3]] の 3.1 節のとおり `packages/core/src/platform`。PC 版で IPC を通るので、どちらのメソッドも `Promise` を返す（3.3 節の非同期の決まり）。

```ts
// packages/core/src/platform/WindowAdapter.ts
export interface WindowAdapter {
  /** その曲の編集ウィンドウが開いていれば前に出して true、開いていなければ何もせずに false で解決する。 */
  focusExistingWindow(songId: string): Promise<boolean>;
  /** その曲の編集ウィンドウを作って開く。もう開いていれば作らずに前に出す。ウィンドウを作れたら解決する。 */
  openEditWindow(songId: string): Promise<void>;
}
```

| メソッド | 引数・戻り値 | エラーのとき |
|---|---|---|
| `focusExistingWindow` | `songId` は曲の `id`（[[data-model-persistence.md#5]]）。戻り値は前に出したかどうか | main の IPC のハンドラが `songId` の形を確かめ（[[web-core-foundation.md#6]] の 6.2 節）、違えば `Error` で reject する |
| `openEditWindow` | 同じ | 同じ。曲のファイルの読み込みに失敗したときは、このメソッドは reject せず、開いた編集ウィンドウの側で `SongRepository.load` のエラーとして知らせる（data-model-persistence.md、基本設計 06 章の回） |

- (b) `openEditWindow` も、もう開いていれば作らない。`focusExistingWindow` と `openEditWindow` の間に別の操作で同じ曲が開かれても、二重に開かないため。
- (b) reject を受けた Webコアは曲を開かず、ログに書く（書き方は error-logging-foundation.md）。`songId` の形が違うのは正しい画面の操作からは起きない Webコアの不具合で、利用者向けの知らせを作らないため。
- 曲一覧ウィンドウを起動のときに開くこと、編集ウィンドウを閉じるときの待ち（4.4 節）、位置と大きさの記録は、main の `WindowManager` が自分で行い、Webコアには出さない。
- 今のコード（`packages/shared-types/src/index.ts` の `WindowAdapter`）は、`focusExistingWindow` が同期で、開いていなければ新しく作り、`openSongListWindow`・`closeEditWindow`・`listOpenEditWindowSongIds` も持っていて、ここと違う。直すのは実装の段。

### 4.4 アプリの終了の順

- 開いているウィンドウが 1 枚も無くなったら、アプリのプロセスを終える。ウィンドウを閉じた後に常駐しない（要件 5.6）。 <!-- req 03:9d9ad6c0.e588 --> 終える前に、次の順の処理を全部終えてから終える。 <!-- req 03:9d9ad6c0.dddc -->
  1. 編集ウィンドウを閉じるときは、その曲の `AutoSaveScheduler.flush(songId)` が終わるのを待ってから閉じる。 <!-- req 03:c9aaed10.8bed -->
  2. 最後のウィンドウが閉じた後、進行中のミラーのコピーが終わるのを待つ。 <!-- req 03:48ded0b2.b3f6 --> 待つのは既定で 15 秒まで（[[../basic_design/13_design_decision_points.md#3]] B26）とし <!-- req 03:48ded0b2.dfd7 -->、過ぎたら Warning をログに書いて終える。 <!-- req 03:48ded0b2.b7b5 -->
- (b) 1 は、main の `WindowManager` がウィンドウの `close` を一度止め（`preventDefault()`）、レンダラーに flush を頼んで、終わりの知らせを受けてから閉じる。レンダラーは自分の曲の `AutoSaveScheduler` を持ち、main からは直接呼べないため。flush とミラーの待ちの中身は data-model-persistence.md（基本設計 06 章の回）。

## 5. 画面の一覧と種別

[[../basic_design/03_screens_ui_pc.md#3]] を受ける。画面の部品（React）は `packages/ui-desktop` に置く（[[web-core-foundation.md#7]] の 7.1 節）。各ダイアログとパネルの中身は、基本設計 10 節の回に 12 節へ書く。小節メモ一覧パネルの中身は 5.3 節。

### 5.1 画面ごとの種別と開き方

| # | 画面 | 種別 | 開き方 |
|---|---|---|---|
| 1 | 曲一覧ウィンドウ | ルートのウィンドウ。アプリを起動したときに開く（4.1 節） <!-- req 03:e34fe616.386f --> | 起動 |
| 2 | 新規曲作成ダイアログ | 複数ステップのウィザードのモーダルダイアログ <!-- req 03:3a9d8813.2ce9 --> | 曲一覧の「新規作成」ボタン <!-- req 03:3a9d8813.4c42 -->と Ctrl+N <!-- req 03:3a9d8813.8e64 --> |
| 3 | タブ譜編集ウィンドウ | メインのウィンドウ。複数を同時に開ける。曲一覧から開く（4.1 節） <!-- req 03:79c38609.0384 --> | 曲一覧から |
| 4 | ミキサーパネル | 非モーダルのパネル <!-- req 03:0b7ac9d5.7447 -->。ドッキングとフローティングを切り替えられる <!-- req 03:0b7ac9d5.ef58 --> | 編集ウィンドウのツールバー <!-- req 03:0b7ac9d5.2cc4 -->と表示メニュー <!-- req 03:0b7ac9d5.673e --> |
| 5 | フレットボード図 | 編集ウィンドウの中の右下に固定したオーバーレイ <!-- req 03:f87a1e2f.72bb --> | ツールバーのトグル <!-- req 03:f87a1e2f.03ec --> |
| 6 | パート管理パネル | 非モーダルのパネル <!-- req 03:797dc5db.4f7b --> | 編集ウィンドウのツールバー <!-- req 03:797dc5db.86d0 -->と表示メニュー <!-- req 03:797dc5db.b800 --> |
| 7 | チューニング設定パネル | 非モーダルのパネル <!-- req 03:4966acc5.57dd --> | パート管理パネルから <!-- req 03:4966acc5.9a5a -->と、パートの右クリックから <!-- req 03:4966acc5.72df --> |
| 8 | セクションマーカー | 画面を持たず、譜面の上で直接扱う（5.2 節） | 譜面の上で直接 |
| 9 | 小節メモ一覧パネル | 非モーダルのパネル <!-- req 03:3184c49b.4ef7 -->。編集ウィンドウの右のサイドパネルとして出す（5.3 節） <!-- req 03:3184c49b.9041 --> | 編集ウィンドウのツールバー <!-- req 03:3184c49b.9271 --> |
| 10 | エクスポートダイアログ | モーダルダイアログ <!-- req 03:8476a15d.d746 --> | Ctrl+E <!-- req 03:8476a15d.0658 -->とファイルメニュー <!-- req 03:8476a15d.6974 --> |
| 11 | 印刷プレビューダイアログ | 画面の一覧に置く <!-- req 03:45d7ef0e.3280 -->モーダルダイアログ <!-- req 03:45d7ef0e.f8ef --> | Ctrl+P <!-- req 03:45d7ef0e.c2cd -->とファイルメニューの「印刷」 <!-- req 03:45d7ef0e.4f1b -->だけ。エクスポートダイアログからは移らない <!-- req 03:45d7ef0e.511f --> |
| 12 | 設定ダイアログ | モーダルダイアログ <!-- req 03:de9d3232.a51d --> | 曲一覧の設定ボタン <!-- req 03:de9d3232.8561 -->と曲一覧のメニュー <!-- req 03:de9d3232.ae47 --> |
| 13 | タグ管理ダイアログ | 設定ダイアログの子のモーダルダイアログ。設定ダイアログから開く <!-- req 03:76938b96.d207 --> | 設定ダイアログから |
| 14 | ゴミ箱ダイアログ | モーダルダイアログ <!-- req 03:38154368.7d06 --> | 曲一覧のボタン <!-- req 03:38154368.894c -->と曲一覧のメニュー <!-- req 03:38154368.211d --> |
| 15 | ライセンス／クレジットダイアログ | ライセンス <!-- req 03:1e0a45dc.0fae -->とクレジット <!-- req 03:1e0a45dc.3858 -->を出すモーダルダイアログ <!-- req 03:1e0a45dc.1fbd --> | 設定ダイアログの「アプリ情報」タブから <!-- req 03:1e0a45dc.9f49 --> |
| 16 | オンボーディングオーバーレイ | 非モーダルの簡易なコーチマーク型のオーバーレイ <!-- req 03:a8047a00.aece --> | 初めて起動したときに、曲一覧ウィンドウの上へ自動で出す <!-- req 03:a8047a00.870b --> |

- 一覧に無い画面を足すときは、要件 4.6 節の 2 つの条件をそのまま尺度にして種別を決める。 <!-- req 03:a6feb3ce.eae4 --> プレビューか複数ステップを含む画面は重い系としてモーダルダイアログにし <!-- req 03:1309ed6c.2af9 -->、どちらも含まない画面は軽い系として非モーダルのパネルにする。 <!-- req 03:1309ed6c.8659 -->
- この尺度を当てるのはパネル <!-- req 03:f36dd55c.3706 -->とダイアログ <!-- req 03:f36dd55c.f5af -->で、ウィンドウ <!-- req 03:f36dd55c.d40d -->とオーバーレイ <!-- req 03:f36dd55c.2f5b -->には当てない。
- 例外は、曲一覧ウィンドウから開く設定 <!-- req 03:94132898.f944 -->・タグ管理 <!-- req 03:94132898.9335 -->・ゴミ箱 <!-- req 03:94132898.de52 -->・ライセンス <!-- req 03:94132898.63a0 -->の 4 つで、尺度によらずモーダルダイアログにする（4.1 節）。
- (b) 非モーダルのパネルは、編集ウィンドウと同じレンダラーの中に作る。パネルは曲ごとの編集ウィンドウの状態（`CommandHistory` とカーソル）を使い、レンダラーは編集ウィンドウ（曲）ごとに 1 つと決めているため（[[web-core-foundation.md#10]] の 10.2 節）。ミキサーをフローティングにしても、編集ウィンドウの外へは出さず、ウィンドウの中で浮かせて動かす。外へ出すには別の `BrowserWindow` が要るが、曲一覧・編集・印刷用の見えないウィンドウの 3 種類の外に `BrowserWindow` を増やさないと決めているため（[[web-core-foundation.md#10]] の 10.2 節）。
- 基本設計 6 節のメニューバーの表は「主な項目」を挙げていて、ミキサーをツールメニューに、パート管理パネルを開く項目をパートメニューに置いている。上の表の表示メニューの入口と合わせて、両方のメニューから開ける形でメニューを組む（基本設計 6 節の回に 8 節へ書く）。

### 5.2 セクションマーカー

- セクションマーカーは、譜面の上に直接出す。 <!-- req 03:d25f511c.d254 --> マーカーの編集も譜面の上でその場で行い、モーダルを使わない（iPhone 版と同じ方針）。 <!-- req 03:d25f511c.5031 -->
- マーカーを足す <!-- req 03:d25f511c.37b7 -->・変える <!-- req 03:d25f511c.f60c -->・消すのは、どれも編集ウィンドウの譜面の上で直接行う。 <!-- req 03:d25f511c.eb5c --> マーカーのための別の画面も <!-- req 03:d25f511c.696a -->、別のダイアログも設けない。 <!-- req 03:d25f511c.95d3 -->
- 3 つの操作は `AddSectionMarkerCommand`・`EditSectionMarkerCommand`・`DeleteSectionMarkerCommand` を発行する（[[editing-core.md#3]] の 3.10 節）。マーカーの形は [[data-model-persistence.md#6]] の 6.1 節。譜面の上の入口（メニューの「セクションマーカー管理」と、マーカーの上の操作）は、基本設計 6 節と 8 節の回に 8 節と 10 節へ書く。

### 5.3 小節メモ一覧パネル

- パネルは、編集ウィンドウの右のサイドパネルとして出す（2026-10-04 本人決定、honnin-queue 22 番）。 <!-- req 03:9873ec9b.47c6 -->
- 一覧の行には、小節番号 <!-- req 03:f9d1bfa7.c9b3 -->・本文の先頭（1 行に収まる分） <!-- req 03:f9d1bfa7.982c -->・日時 <!-- req 03:f9d1bfa7.1ef5 -->を出す（2026-10-04 本人決定、honnin-queue 22 番）。日時はメモを作った日時（`Memo.createdAt`、[[data-model-persistence.md#6]] の 6.2 節）とし <!-- req 03:f9d1bfa7.18bf -->、7.1 節の日時の関数で保存ボタンと同じ書式にして <!-- req 03:f9d1bfa7.5b60 -->、「最終保存」の語を付けずに出す。 <!-- req 03:f9d1bfa7.ad93 -->
- 行は、メモを作った日時の順に並べる（[[data-model-persistence.md#6]] の 6.2 節）。 <!-- req 02:2a72cdb0.2d62 -->
- 行をクリックすると、そのメモが付いている小節へ、譜面のカーソルと表示の位置を動かす。 <!-- req 03:3184c49b.86b1 --> (b) カーソルを `CursorController` で動かし、表示は `ViewModeController.revealBar(barIndex)`（[[view-modes.md#1]]）で動かす。表示の範囲を動かす口を 1 つにするため。
- 行をクリックして小節へ動いた後も、パネルは開いたままにし、続けて別の行へ動ける。 <!-- req 03:3184c49b.5a2c -->
- 行をダブルクリックすると、そのメモの本文をその場で直せる。確定すると `EditMemoCommand` を発行する。 <!-- req 03:3184c49b.a145 --> 各行の「削除」ボタンで、そのメモを消す（`DeleteMemoCommand`）。 <!-- req 03:3184c49b.393c --> どちらも `EditingService` を通して `CommandHistory` に渡す（[[editing-core.md#3]] の 3.10 節）。
- 本文を直している間は、文字数を数え、100 文字を超えたら Warning（`EDIT-004`）を出す。入力は止めない（[[editing-core.md#3]] の 3.10 節）。 <!-- req 02:21616253.44f4 --> Warning の出し方は基本設計 11 節の Warning の行（トースト）に従う。出すのは、本文が 100 文字を超えている間に、文字を入れる（打つ・貼り付ける）たびとし、100 文字を超えたまま文字を消したときは出さない（2026-10-04 本人決定）。文字の数え方は [[data-model-persistence.md#6]] の 6.2 節と同じ関数を使う。(b) 「文字を入れた」か「消した」かは、欄の `input` イベントの `InputEvent.inputType` で決め、`insert` で始まるもの（打つ `insertText` と貼り付ける `insertFromPaste` を含む）を入れた、`delete` で始まるものを消したとみなす。選んだ文字を短い文字で貼り替えたときも「入れた」と分かり、どの入れ方でも同じ所で判定できるため。

## 6. 曲一覧ウィンドウ

[[../basic_design/03_screens_ui_pc.md#4]] を受ける。曲の項目は [[data-model-persistence.md#5]]、並べ替えの値の出どころと `index.json` は [[data-model-persistence.md#9]] が正。

### 6.1 ウィンドウの構成

- メニューバーに「ファイル」 <!-- req 03:24d63ceb.9769 -->・「編集」 <!-- req 03:24d63ceb.27b3 -->・「表示」 <!-- req 03:24d63ceb.e1c8 -->・「ヘルプ」 <!-- req 03:24d63ceb.2596 -->の 4 つのメニューを置く。各メニューの項目は、基本設計 6 節の回に 8 節へ書く。
- ツールバーに、「新規作成」ボタン <!-- req 03:8789f153.fa68 -->・並べ替えのドロップダウン（[並べ替え▾]） <!-- req 03:8789f153.92da -->・グリッド表示とリスト表示の切り替え <!-- req 03:8789f153.0a41 -->・設定ボタン <!-- req 03:8789f153.e651 -->を置く。
- 「新規作成」ボタンをクリックすると新規曲作成ダイアログを開き <!-- req 03:0fc80426.f1fb -->、曲一覧ウィンドウで Ctrl+N を押しても同じく開く。 <!-- req 03:0fc80426.c270 -->
- グリッド表示では、曲ごとのカードに、サムネイルの画像 <!-- req 03:f5e38e41.7605 -->・曲名 <!-- req 03:33a57011.744f -->・タグ <!-- req 03:19907ceb.9428 -->を出す。サムネイルの画像は `SongSummary.thumbnailRef` の写しを使う（[[data-model-persistence.md#5]]）。
- グリッド表示とリスト表示は、設定ダイアログの既定値とは別に、ツールバーからも直接切り替えられる。 <!-- req 03:c0ad43dc.4601 -->
- ウィンドウの下に、曲の数を「今の数/1000」の形で出し <!-- req 03:cab81296.a7da -->、ゴミ箱ダイアログを開くボタンを置く。 <!-- req 03:cab81296.546d --> 曲の数の予告と上限の知らせは 2 節。

### 6.2 並べ替え

- 並べ替えのキーは、曲名 <!-- req 03:b460a5fe.2b04 -->・アーティスト名 <!-- req 03:b460a5fe.4e24 -->・更新日時 <!-- req 03:b460a5fe.4969 -->・作成日時 <!-- req 03:b460a5fe.cce3 -->・パート種別 <!-- req 03:b460a5fe.ed8b -->・チューニング名 <!-- req 03:b460a5fe.d56c -->の 6 つとし、6 つ全部に対応する。 <!-- req 03:b460a5fe.5388 --> キーは要件 4.5 節が名指しした 6 つと過不足なく同じで、足しも減らしもしない。 <!-- req 03:b460a5fe.48c2 -->
- キーはツールバーのドロップダウンで選ぶ。 <!-- req 03:b460a5fe.4842 --> 昇順と降順を切り替えられ <!-- req 03:b460a5fe.348c -->、向きはキーと別に切り替える。 <!-- req 03:427087db.0398 -->
- キーごとの値の出どころは次のとおり。

| キー | 値 |
|---|---|
| 曲名 | `Song.title` <!-- req 03:b666c911.2ca9 --> |
| アーティスト名 | `Song.artist`。タグで代わりにせず、`Song` の専用の項目を使う（[[data-model-persistence.md#5]]） <!-- req 03:dbf14292.da24 --> <!-- req 03:dbf14292.3dfd --> |
| 更新日時 | `SongSummary.updatedAt` <!-- req 03:85698578.1713 --> |
| 作成日時 | `SongSummary.createdAt` <!-- req 03:f1040a55.5b47 --> |
| パート種別 | `Part.instrumentType`。 <!-- req 03:c351f00d.a7ed --> 1 曲に複数のパートがあるときは、先頭のパートの種別を代表の値にする <!-- req 03:c351f00d.5c40 --> |
| チューニング名 | パートに記録したプリセットの名前 <!-- req 03:aa3c23c3.b429 -->で、当面は `stringTuning.name` を使う。 <!-- req 03:aa3c23c3.2194 --> 代表の値は、パート種別と同じく先頭のパートの値にする <!-- req 03:aa3c23c3.8319 --> |

- 選んだキー <!-- req 03:427087db.3ed6 -->と向き <!-- req 03:427087db.5797 -->は、アプリの側の設定として、曲一覧の表示方式の既定値と同じ所に持つ。(b) 置くのはアプリの側の `preferences.json`（[[../basic_design/06_file_io_persistence.md#3]]）で、読み書きの中身は data-model-persistence.md（基本設計 06 章の回）。曲一覧の表示方式の既定値と同じ扱いにすると基本設計が決めているため。
- (b) 並べ替えは `index.json` の `SongSummary` の並び（[[data-model-persistence.md#9]]）だけで行い、曲のファイルを開かない。曲の数によらず同じ手間で並べ替えるため。

### 6.3 曲の右クリックのメニュー

- 曲を右クリックすると、「開く」 <!-- req 03:8ca30629.d37a --> <!-- req 03:96ee96b1.b688 -->・「名前を変更」 <!-- req 03:8ca30629.a70c -->・「タグを編集」 <!-- req 03:8ca30629.74af --> <!-- req 03:96ee96b1.ab98 -->・「フォルダへ移動」 <!-- req 03:8ca30629.778f -->・「ゴミ箱へ移動」 <!-- req 03:8ca30629.7ae8 --> <!-- req 03:96ee96b1.1cea --> <!-- req 03:cabd0c6c.6d23 -->・「複製」 <!-- req 03:8ca30629.c525 -->の 6 つを出す。
- 「名前を変更」では、曲名とアーティスト名を編集できる。 <!-- req 03:96ee96b1.507a --> <!-- req 02:3faf5c16.ef22 --> <!-- req 02:c7f15df5.f749 --> 変えるのは `Song.title` と `Song.artist`（[[data-model-persistence.md#5]]）。
- 「フォルダへ移動」で、曲を別のフォルダへ移せる（6.4 節）。 <!-- req 03:96ee96b1.955f -->
- 「ゴミ箱へ移動」は、曲一覧で曲を削除する入口とする（ゴミ箱の中身は [[../basic_design/06_file_io_persistence.md#7]]）。
- 「複製」は、要件では不要とされているが、ファイルのコピーで作れるので入口として残す。 <!-- req 03:96ee96b1.d4fe --> 複製の処理は、基本設計 06 章のファイルのコピーだけで作り、独自の作る・消す処理を持たない。 <!-- req 03:96ee96b1.2695 --> 1000 件に達しているときは拒否する（2 節）。

### 6.4 フォルダ分け

- フォルダ分けは、タグで代わりにせずに用意する。 <!-- req 03:52fc3f6a.9c6b --> フォルダの実体は、保存先の `TabApp/songs/` の下に利用者が作るサブフォルダで、曲のファイルをそこに置く。 <!-- req 03:87c3b7fd.7b06 -->
- 曲一覧は、このサブフォルダの構造をそのまま階層で出す。 <!-- req 03:9771fb10.d41f -->
- 曲一覧の中で、フォルダを作る <!-- req 03:ac429c15.9570 -->・名前を変える <!-- req 03:ac429c15.687f -->・消す（中が空のときだけ）ことができる。 <!-- req 03:ac429c15.7b21 --> (b) 中に曲かフォルダがあるときは、消す項目を押せない状態で出す。押させてから断るより、押す前に分かるため（基本設計 8 節の右クリックで、選択範囲が無いときに使えない項目を無効表示にするのと同じ形）。
- 曲を別のフォルダへ移すのは、曲の右クリックの「フォルダへ移動」 <!-- req 03:ac429c15.5e34 -->と、曲をフォルダへドラッグする操作 <!-- req 03:ac429c15.ca94 -->の 2 つで行う。
- 移すときは、曲のファイルを `songs/` の下で動かし <!-- req 03:aa5129c9.19a8 -->、`index.json` のその曲の所属フォルダを差分で書き換える。 <!-- req 03:aa5129c9.8d5c --> 動かし方と書き換え方の中身は data-model-persistence.md（基本設計 06 章の回）。

### 6.5 置かないもの

- 先に用意するのはタグのデータ構造だけで <!-- req 03:1c8db080.7846 -->、検索とタグの絞り込みの画面の部品は、空の器も含めて置かない。 <!-- req 03:1c8db080.0400 -->
- 曲一覧の整理の手段は、新規作成・一覧・削除・並べ替え・フォルダ分けの 5 つに限り <!-- req 03:2222ee63.af04 -->、この 5 つの外の手段を足さない。 <!-- req 03:2222ee63.99ef --> 一括の操作は要らないものとする。 <!-- req 03:0d1986fd.85f2 -->
- 複数の曲をまとめて消す <!-- req 03:4bf8c1f0.3b7b -->・まとめてタグを付ける <!-- req 03:4bf8c1f0.4814 -->・まとめて移す <!-- req 03:4bf8c1f0.2832 -->機能は置かない。曲一覧の操作は、選んだ 1 曲にだけ行う。 <!-- req 03:e43be0d7.a928 --> 曲一覧の部品に複数を選ぶ仕組みを持たせず、いつも 1 曲だけを選べる。 <!-- req 03:8bf3ce83.9d3f -->

## 7. 編集ウィンドウの構成

[[../basic_design/03_screens_ui_pc.md#5]] のうち、上のツールバー・左のパートリスト・下の入力ツールバー・ステータスバーを受ける。中央の譜面の表示領域は [[view-modes.md#1]]。

- 編集ウィンドウのメニューバーには、「ファイル」「編集」「表示」「再生」「パート」「ツール」「ヘルプ」の 7 つのメニューを、この順に置く。 <!-- req 03:1e52acbd.0bf7 --> 各メニューの項目は、基本設計 6 節の回に 8 節へ書く。

### 7.1 ツールバーと保存ボタン

- ツールバーには、左から、保存（未保存の●の印つき）・Undo・Redo のまとまり、再生・停止・ループ・メトロノームのまとまり、ミキサー・パート・チューニング・フレットボード・メモ一覧のまとまりを、区切りの線で分けてこの順に置く。 <!-- req 03:9c26eaea.a5c0 --> 3 つ目のまとまりのボタンは、それぞれのパネル（5.1 節）の表示と非表示を切り替える。
- 保存ボタンの●は、まだ保存されていない編集があることを示す印で <!-- req 03:48ca0c1d.ec41 -->、保存されると消える。 <!-- req 03:48ca0c1d.8e00 --> ●が消えることを保存の完了の合図とする。 <!-- req 03:48ca0c1d.7ee6 -->
- 保存ボタンにマウスを乗せると、最後に保存した時刻をツールチップに出す。 <!-- req 03:48ca0c1d.5bd2 --> まだ一度も保存していない曲では、時刻の行を出さない。
- ツールチップの時刻の書式は、[[../basic_design/03_screens_ui_pc.md#5]] が正で、本書は書式を繰り返さない（[[screens-navigation.md#1]]）。書式の決まりは、保存したのが今日のとき <!-- req 03:48ca0c1d.60e1 -->・今日より前で同じ年のとき <!-- req 03:48ca0c1d.6ae1 -->・年が違うとき <!-- req 03:48ca0c1d.fe69 -->の 3 通りの形と、時・分・秒の 2 桁 <!-- req 03:48ca0c1d.f4cd -->、月・日に 0 を付けないこと <!-- req 03:48ca0c1d.5525 -->、「今日」 <!-- req 03:48ca0c1d.8040 -->と「年」 <!-- req 03:48ca0c1d.46ee -->を PC の時計の日付で決めることで、どれも基本設計 5 節の文のとおりにする。
- 日時を文字にする関数は次の 1 つにし、保存ボタンのツールチップ・ゴミ箱の削除日時 <!-- req 03:48ca0c1d.8965 -->・小節メモ一覧の日時 <!-- req 03:48ca0c1d.4167 -->の 3 か所はこれを呼ぶ（1 節の宿題）。「最終保存」の語は保存ボタンのツールチップだけが前に付け、ゴミ箱の削除日時と小節メモ一覧の日時には付けない。 <!-- req 03:48ca0c1d.46c7 -->

```ts
// packages/core/src/ui/formatLocalDateTime.ts
/**
 * 日時を基本設計 03 章 5 節の書式の文字列にする（「最終保存」の語は付けない）。
 * @param at 文字にする日時（epoch ms）
 * @param now 「今日」と「年」を決める PC の時計の今（epoch ms）
 */
export function formatLocalDateTime(at: number, now: number): string;
```

- (b) 置き場所は `packages/core/src/ui` とする。React を使わない文字の関数で、iPhone 版でもそのまま使えるため（[[web-core-foundation.md#7]] の 7.1 節と、置き場所の決め方の 3 番目）。`now` を引数で受けるのは、テストで「今日」を決めた時計を渡すため。
- 保存ボタンを押すと、Ctrl+S と同じく、すぐに保存する。 <!-- req 03:48ca0c1d.4564 --> どちらも `AutoSaveScheduler.flush(songId)` を呼ぶ。
- 保存の完了は、自動保存のとき <!-- req 03:48ca0c1d.0171 -->も、Ctrl+S のとき <!-- req 03:48ca0c1d.cf6d -->も、保存ボタンのとき <!-- req 03:48ca0c1d.20ca -->も、トーストで知らせない（`FILE-006` は欠番、[[00_reference.md#5]]）。

```ts
/** 保存ボタンの状態。SaveStateTracker が満たす。 */
export interface SaveStateSource {
  /** まだ保存されていない編集がある（●を出す）。 */
  readonly hasUnsavedEdits: boolean;
  /** 最後に保存した時刻（epoch ms）。一度も保存していなければ null。 */
  readonly lastSavedAt: number | null;
  onStateChanged(listener: () => void): () => void;
}

/** 編集ウィンドウ（songId）ごとに 1 つ。 */
export class SaveStateTracker implements SaveStateSource {
  /** 開いた曲の SongSummary.updatedAt を初めの値にする。まだ保存していない曲は null。 */
  constructor(initialSavedAt: number | null);
  markEdited(): void;
  markSaveStarted(): void;
  markSaved(savedAt: number): void;
  readonly hasUnsavedEdits: boolean;
  readonly lastSavedAt: number | null;
  onStateChanged(listener: () => void): () => void;
}
```

- (b) 保存の状態は、新しい知らせを作らず、今ある 3 つの呼び口を組み立ての処理（bootstrap）がつなぐ。

| 今ある呼び口 | いつ呼ばれるか | つなぐ先 |
|---|---|---|
| `CommandHistory` の変更の知らせ（[[editing-core.md#2]]。bootstrap が `AutoSaveScheduler.notifyDirty(songId)` もつないでいるもの） | 編集のたび | `markEdited()`：編集の通し番号を 1 つ進め、`hasUnsavedEdits` を真にする |
| `AutoSaveScheduler` の `resolveDocument(songId)` | 保存の処理が、書き出す中身を取り出す直前 | `markSaveStarted()`：その時の通し番号を「保存中の番号」として控える |
| `AutoSaveHooks.onSaved(songId)` | 保存に成功した後 | `markSaved(Date.now())`：`lastSavedAt` を書き換え、通し番号が「保存中の番号」から進んでいなければ `hasUnsavedEdits` を偽にする |

- 通し番号を控えるのは、保存中に来た編集で●を消さないため。`AutoSaveScheduler` は保存中に来た編集をもう 1 周で書くが、1 周目の `onSaved` の時には、その編集はまだ書かれていない。
- 保存の再試行が全部失敗したとき（`onError`、`FILE-001`）は `markSaved` を呼ばず、●は残る。
- 窓の位置と大きさの記録（4.2 節）は `CommandHistory` を通らないので、`markEdited()` を呼ばない。

### 7.2 左のパートリスト

- 左のパネル（パートリスト）は、いつも出しておく。 <!-- req 03:2948f0a5.7887 --> パネルの下に「パート追加」ボタンを置く（中身は基本設計 10 節の回に 12 節へ書く）。 <!-- req 03:a8373793.435e -->
- 各行の先頭に、パートを見分ける色の丸（スウォッチ）を出す。 <!-- req 03:4e87a7c1.398a --> <!-- req 03:2948f0a5.a74d --> 色は、そのパートの `Part.color`（alphaTab の `Track.color`、[[part-tuning-management.md#2]] の 2.1 節）で塗る。 <!-- req 02:9960ee1a.e339 -->
- 行の色の丸の前に出す ▶ は、いま編集しているパートの印とする。行をクリックしてパートを切り替えると、▶ も切り替えた先の行へ動く（2026-10-04 本人決定、honnin-queue 28 番）。基本設計 5 節の図で ▶ が先頭の行にあるのは、先頭のパートを編集している場面の図として読む。 <!-- req 03:4e87a7c1.3cd8 -->
- 各行に、ミュートの簡易なトグル <!-- req 03:2948f0a5.a080 -->・ソロの簡易なトグル <!-- req 03:2948f0a5.d97e -->・音量のミニスライダー <!-- req 03:2948f0a5.a00c -->を置く。細かい調整（音量・パン・ソロ・ミュート）は、非モーダルのミキサーパネルで行う。 <!-- req 03:2948f0a5.7916 --> (b) 行のトグルとスライダーは、ミキサーパネルと同じパートの属性を変えるコマンドを発行し、値を 2 か所で別に持たない。どちらで変えても、もう一方の表示がそろうため。値の範囲と再生への反映は playback-integration.md（基本設計 05 章の回）。
- 行をクリックすると、そのパートに切り替える（3.2 節）。
- ウィンドウの幅に合わせて、アイコンだけの表示へ自動で縮めることはしない（[[../basic_design/13_design_decision_points.md#3]] B10）。 <!-- req 03:2948f0a5.c486 --> 対応するウィンドウの幅（800px から）では、いつもパート名のラベルを付けて出す。 <!-- req 03:2948f0a5.9599 --> 譜面の領域を広げたいときは、パネルの境をドラッグして幅を手で変える。幅の下限の目安は 120px とする。 <!-- req 03:2948f0a5.ec6f -->

### 7.3 下の入力ツールバー

- 入力ツールバーは、ウィンドウの下に固定して出す。 <!-- req 03:a1a13c04.de35 --> 音価のパレット（♩♪♬ の音価の記号） <!-- req 03:a1a13c04.a5df -->・フレットの入力 <!-- req 03:d42a9e9f.dfc2 -->・奏法記号を選ぶドロップダウン（▾） <!-- req 03:a1a13c04.efdf --> <!-- req 03:d42a9e9f.b1f8 -->を、タブで切り替えずに横に並べて同時に出す。
- 右の端に、「移動」のトグルボタン <!-- req 03:d42a9e9f.3ebd --> <!-- req 03:a1a13c04.53dd -->と「消しゴム」のトグルボタン <!-- req 03:d42a9e9f.42f8 --> <!-- req 03:a1a13c04.932e -->を置く。消しゴムのボタンが押された状態の間を、消しゴムモードとする。 <!-- req 03:d42a9e9f.3f51 --> 消しゴムモードの中身は基本設計 8.1 節の回に 10 節へ書く。
- 画面の幅が狭いときだけ、入力ツールバーを折り畳む。 <!-- req 03:d42a9e9f.ec9c --> 折り畳みの規則は [[../basic_design/14_visual_design_system.md#8.2]] が正（基本設計 14 章の回）。
- スコア表示の間は、入力ツールバーを隠し、譜面の表示領域をその分広げる（2026-10-04 本人決定、honnin-queue 28 番）。フォーカス表示か全体スクロール表示へ戻したら、また出す。スコア表示で編集しないことは [[view-modes.md#1]] の 1.1 節。
- フレットの入力は、クイック選択バー（0〜12）とテンキーを開く形の組み合わせを、要件 4.1 節のまま使う。 <!-- req 03:d42a9e9f.37e1 --> テンキーでの数の入力にも対応する。 <!-- req 03:a1a13c04.425f --> どちらも `PlaceNoteCommand` を発行する（3.3 節）。
- 音価のパレットの隣に「休符」ボタンを置く。 <!-- req 03:d42a9e9f.c31d --> 押すと、カーソルの位置に休符を置いて次の拍へ進む（`InsertRestCommand`）。 <!-- req 03:d42a9e9f.ba78 --> キーでは Enter（基本設計 7 節の回に 9 節へ書く）。
- 音価のパレットに、付点（なし・付点・複付点）の切り替え <!-- req 03:d42a9e9f.4816 -->と、連符（なし・3 連符・5 連符・任意）の切り替えを置く。 <!-- req 03:d42a9e9f.deab --> 連符の「任意」を選ぶと、何連符かを入れる小さな欄を出し <!-- req 03:d42a9e9f.c55e -->、2 から 12 までを受け付ける（2026-10-03 本人決定、honnin-queue 12 番）。 <!-- req 03:d42a9e9f.992d -->
- 範囲選択があるときにパレットで選ぶと、選んだ拍の音価・付点・連符をまとめて変える（`SetBeatDurationCommand`）。 <!-- req 03:d42a9e9f.e090 --> 範囲選択が無いときは、次に置く音の音価を選ぶ。 <!-- req 03:d42a9e9f.7d9a --> 音価はキーでも選べる（基本設計 13.6 節。13 節の回に 9 節へ書く）。 <!-- req 03:d42a9e9f.3740 -->
- 「タイ」ボタンを置く。 <!-- req 03:d42a9e9f.6aa8 --> 直前と同じ高さの音を続けて置いたときに出たタイの候補を、このボタンで確定する。 <!-- req 03:d42a9e9f.20e9 --> カーソルの位置の音符にタイを付ける・外すのにも使う（`SetTieCommand`）。 <!-- req 03:d42a9e9f.1bca -->
- 「スラー付与」ボタンを、「タイ」と別に置く。 <!-- req 03:d42a9e9f.2fe1 --> 範囲選択した拍の音符にスラーを付ける（`SetSlurCommand`）。 <!-- req 03:d42a9e9f.7d4d -->
- 入力ツールバーに「ボイス 1／2」の切り替えを置く（2026-10-03 本人決定、honnin-queue 10 番）。 <!-- req 03:d42a9e9f.9de0 --> 切り替えたときのカーソルとコピーの扱いは、基本設計 13.4 節の回に本節へ書く。
- 入力ツールバーのボタンが発行するコマンドの引数と確かめは、[[editing-core.md#3]] に基本設計 04 章の回に書く。

### 7.4 ステータスバー

- ステータスバーに、小節の位置 <!-- req 03:b0097691.181f -->・拍子 <!-- req 03:b0097691.0245 -->・テンポ <!-- req 03:b0097691.b7e9 -->・カポ <!-- req 03:b0097691.d5b0 -->をいつも出す。小節の位置は「小節 今の番号/全部の数」の形で出す。 <!-- req 03:d350dd6e.0bb0 --> 拍子 <!-- req 03:d350dd6e.2425 -->・テンポ <!-- req 03:d350dd6e.aff5 -->・カポ <!-- req 03:d350dd6e.6505 -->は、その時の値を出す。
- ステータスバーに、ズームのスライダー（[-|====|+] の形）を置く（2026-10-03 本人決定、honnin-queue 17 番）。 <!-- req 03:d350dd6e.530e --> ズームの値の扱いは [[view-modes.md#1]]。
- ステータスバーに、Info・Warning・Error の知らせの表示域を設ける。 <!-- req 03:d350dd6e.fa99 --> Info と Warning のトーストは、この表示域に出す（基本設計 08 章）。 <!-- req 03:b0097691.2aa7 --> Error のメッセージも、この表示域に出す。 <!-- req 03:b0097691.6f83 -->
- Error は赤枠と一緒に出す。赤枠は、譜面の該当する箇所 <!-- req 03:b0097691.2ad4 -->、または操作した入力欄 <!-- req 03:b0097691.35cd -->や一覧 <!-- req 03:b0097691.1811 -->に付け、それと一緒にステータスバーにメッセージを出す。 <!-- req 03:b0097691.710d --> Critical はステータスバーに出さず、モーダルで出す。 <!-- req 03:b0097691.059d --> レベルごとの出し方の中身は、基本設計 11 節の回に 13 節へ書く。
- ステータスバーの数の書体は、基本設計 14 章 4 節の数字の幅がそろう書体の決まりに従う。 <!-- req 03:b0097691.5ff5 -->
- テンポの表示は、クリックすると数の直接入力に変わる。 <!-- req 03:b0097691.2d16 --> 確定すると `SetTempoCommand` を発行する（3.3 節）。
- 拍子の表示は、クリックすると分子と分母の入力に変わる。 <!-- req 03:b0097691.08ec --> 確定すると、カーソルのある小節に拍子を入れる `SetTimeSignatureCommand` を発行し <!-- req 03:b0097691.cb41 -->、その小節から拍子が変わる。 <!-- req 03:b0097691.aeb6 -->
- 拍子の入力に「前の小節に合わせる」を置く。 <!-- req 03:b0097691.4b55 --> 選ぶと、その小節の拍子の指定を外して、直前の小節の拍子を継ぐ状態に戻す（`SetTimeSignatureCommand` に `null` を渡す。継ぐ印は [[data-model-persistence.md#6]] の 6.4 節の `explicitTimeSignatureBars`）。 <!-- req 03:b0097691.143d -->
- 分子か分母が範囲の外のときは、コマンドを発行せずに `EDIT-010` を出す。 <!-- req 03:b0097691.960c --> 範囲は [[00_reference.md#5]] の `EDIT-010` の行が正。
- 拍子の変更は、Undo <!-- req 03:b0097691.b7c4 -->と Redo <!-- req 03:b0097691.124b -->の対象にする（コマンドを通すので、`CommandHistory` に積まれる）。
- カポの表示は、カポの位置そのもの（`Part.capoFret`）を示す。 <!-- req 03:b0097691.fe7b --> カポを変えても、譜面のフレットの番号は変えない（[[part-tuning-management.md#2]] の 2.4 節）。 <!-- req 03:b0097691.b058 -->

### 7.5 ツールバーとステータスバーの状態のクラス

```ts
export interface HistoryStateSource {
  canUndo(): boolean; canRedo(): boolean;
  subscribe(listener: () => void): () => void;
}
export interface PlaybackStateSource {
  readonly isPlaying: boolean;
  onStateChanged(listener: () => void): () => void;
}

/** 編集ウィンドウごとに 1 つ。 */
export class ToolbarViewModel {
  constructor(history: HistoryStateSource, playback: PlaybackStateSource, save: SaveStateSource);
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

/** 編集ウィンドウごとに 1 つ。 */
export class StatusBarViewModel {
  constructor(cursor: CursorLike, barCount: () => number, zoom: ZoomPercentSource, context: StatusBarContextProvider);
  getState(): StatusBarState;
  onChange(listener: () => void): () => void;
  /** テンポや拍子を変えたときに、表示を作り直す。 */
  refresh(): void;
  dispose(): void;
}

export interface ToolbarState {
  canUndo: boolean; canRedo: boolean; isPlaying: boolean;
  hasUnsavedEdits: boolean; lastSavedAt: number | null;
  panels: { mixer: boolean; partManagement: boolean; tuning: boolean; fretboard: boolean; memoList: boolean };
}
/** ステータスバーに出す数。barNumber は 1 から。 */
export interface StatusBarState {
  barNumber: number; barCount: number; timeSignature: string; tempoBpm: number; capoFret: number; zoomPercent: number;
}
export type ToolbarPanelName = keyof ToolbarState['panels'];
```

- (b) 2 つのクラスは React を使わない状態の持ち手として `packages/core/src/ui` に置き、画面の部品（`packages/ui-desktop`）はこれを読むだけにする。画面の部品から `Score` と `ScoreRenderHost` を直接触らないため（[[../basic_design/01_architecture.md#3]] AD-2）。
- (b) パネルの表示と非表示は編集ウィンドウごとに持ち、取り消しの対象にしない。表示の状態で、曲の中身ではないため。
- `CursorLike` は [[view-modes.md#1]] の型。`barCount` は曲の小節の数（`Score.masterBars.length`）を返す。
- 今のコードの `ToolbarViewModel` は `playback` と `save` を省いてよい形で、`StatusBarState` は `barCount` を持たず、ここと違う。直すのは実装の段。

## 8. メニューバー

[[../basic_design/03_screens_ui_pc.md#6]] を受ける。メニューを組み立てる所（シェル）は [[web-core-foundation.md#7]] の 7.2 節の ⑥。

### 8.1 編集ウィンドウのメニューの項目

| メニュー | 項目 | 選んだときに呼ぶもの |
|---|---|---|
| ファイル | 新規曲作成 <!-- req 03:3546b194.5db4 --> | 新規曲作成ダイアログを開く（5.1 節の #2） |
| ファイル | 開く <!-- req 03:3546b194.24ee --> | 中身は 8.4 節 |
| ファイル | 保存 <!-- req 03:3546b194.66ea --> | `AutoSaveScheduler.flush(songId)`（7.1 節の保存ボタンと同じ） |
| ファイル | 名前を付けて保存 <!-- req 03:3546b194.9c56 --> | 中身は 8.4 節 |
| ファイル | エクスポート（Ctrl+E） <!-- req 03:3546b194.27fb --> | エクスポートダイアログを開く |
| ファイル | 印刷（Ctrl+P） <!-- req 03:3546b194.bd4b --> | 印刷プレビューダイアログを開く |
| ファイル | 閉じる <!-- req 03:3546b194.8e1e --> | その編集ウィンドウを閉じる（4.4 節の順で、flush を待ってから閉じる） |
| 編集 | 元に戻す（Ctrl+Z） <!-- req 03:a0ae20fd.5e4b --> | その窓の `CommandHistory.undo()` |
| 編集 | やり直す（Ctrl+Y） <!-- req 03:a0ae20fd.095d --> | その窓の `CommandHistory.redo()` |
| 編集 | 切り取り <!-- req 03:a0ae20fd.dcf7 -->・コピー <!-- req 03:a0ae20fd.08fd -->・貼り付け <!-- req 03:a0ae20fd.c71c --> | 選択範囲の切り取りとコピー、クリップボードの中身の貼り付け（コマンドの中身は editing-core.md、基本設計 04 章の回） |
| 編集 | 削除 <!-- req 03:a0ae20fd.d670 --> | 選択範囲の音符を消す（3.3 節の削除の処理と同じ） |
| 編集 | 全選択 <!-- req 03:a0ae20fd.f354 --> | 今のパートの中を全部選ぶ（9 節の Ctrl+A と同じ） |
| 編集 | 選択モード切替 <!-- req 03:a0ae20fd.df9f --> | 範囲選択のトグルモードの入切（9 節の Shift＋クリックと並べる） |
| 編集 | 小節を削除 <!-- req 03:a0ae20fd.ef2c --> | カーソルのある小節を全部のパートから消す `DeleteBarCommand`（キーは 9 節の Ctrl+Delete） |
| 編集 | リピート記号 | カーソルのある小節に「リピート開始」「リピート終了（回数）」を付ける <!-- req 03:a0ae20fd.de49 -->・外す <!-- req 03:a0ae20fd.958a -->（`SetRepeatCommand`） |
| 表示 | フォーカスビュー <!-- req 03:861ca2f0.5bac -->・全体スクロールビュー <!-- req 03:861ca2f0.fd01 -->・スコア表示 <!-- req 03:861ca2f0.7e0f --> | `ViewModeController.setViewMode`（[[view-modes.md#1]]）。並びは 9 節の Ctrl+1／Ctrl+2／Ctrl+3 の番号と同じ |
| 表示 | ズームイン <!-- req 03:861ca2f0.78aa -->・ズームアウト <!-- req 03:861ca2f0.dd2d -->・ズームを 100% に戻す <!-- req 03:861ca2f0.e7cb --> | `ZoomController.zoomIn`・`zoomOut`・`setZoom(100)`（[[view-modes.md#1]]） |
| 表示 | フレットボード図表示切替 <!-- req 03:861ca2f0.cd79 --> | フレットボード図の表示と非表示（7.1 節のツールバーのボタンと同じ状態） |
| 表示 | コードネーム表示切替 <!-- req 03:861ca2f0.07ed --> | 譜面のコード名の表示の入切（入切の状態の持ち方は editing-core.md、基本設計 04 章の回） |
| 表示 | ミキサー・パート管理パネル | 5.1 節の表の「表示メニュー」の入口。7.1 節のツールバーのボタンと同じ状態を切り替える |
| 再生 | 再生／停止（Space） <!-- req 03:e9152e04.2656 -->・区間ループ設定 <!-- req 03:e9152e04.930a -->・セクションループ <!-- req 03:e9152e04.e247 -->・ソロ再生 <!-- req 03:e9152e04.48cc -->・減速再生 <!-- req 03:e9152e04.8310 -->・メトロノーム ON-OFF <!-- req 03:e9152e04.85bf -->・カウントイン ON-OFF <!-- req 03:e9152e04.22ad -->・タップテンポ <!-- req 03:e9152e04.9c65 --> | 再生の操作。呼ぶ先と中身は playback-integration.md（基本設計 05 章の回） |
| パート | パート追加 <!-- req 03:bcc4cf46.49c9 -->・削除 <!-- req 03:bcc4cf46.f02c -->・並べ替え <!-- req 03:bcc4cf46.6508 --> | パートの操作（中身は基本設計 10 節の回に 12 節へ書く） |
| パート | チューニング設定 <!-- req 03:bcc4cf46.5d49 --> | 今のパートのチューニング設定パネルを開く |
| パート | 音色の変更：エレキギター <!-- req 03:bcc4cf46.cc18 -->・ベース <!-- req 03:bcc4cf46.e0ac --> | `SetPartInstrumentCommand`（[[part-tuning-management.md#2]] の 2.5 節） |
| パート | パート管理パネルを開く <!-- req 03:bcc4cf46.bf60 --> | パート管理パネルの表示（ツールバーのボタンと同じ状態） |
| ツール | ミキサー <!-- req 03:a19d9eb5.f924 -->・小節メモ一覧 <!-- req 03:a19d9eb5.14de --> | それぞれのパネルの表示（ツールバーのボタンと同じ状態） |
| ツール | セクションマーカー管理 <!-- req 03:a19d9eb5.b5e9 --> | 下の箇条 |
| ツール | 設定 <!-- req 03:a19d9eb5.7023 --> | 設定ダイアログを開く（どの窓に出すかは 8.4 節） |
| ヘルプ | ヘルプ画面（使い方とキーボードショートカット一覧） <!-- req 03:bdf10e4e.b457 --> | ヘルプ画面を開く（中身は基本設計 13 節の回に 12 節へ書く） |
| ヘルプ | ライセンス <!-- req 03:bdf10e4e.bc97 -->・クレジット <!-- req 03:bdf10e4e.d7d0 -->・バージョン情報 <!-- req 03:bdf10e4e.6f10 --> | 中身は 8.4 節 |

- リピート終了を選ぶと、回数を入れる小さな欄を出す。 <!-- req 03:a0ae20fd.fab4 --> 欄は 0（なし）か 2 から 10 までを受け付け <!-- req 03:a0ae20fd.dedf -->、範囲の外は `EDIT-011` とする（[[../basic_design/13_design_decision_points.md#3]] B39）。 <!-- req 03:a0ae20fd.e9c1 -->
- 「セクションマーカー管理」は、別の画面もダイアログも開かない。 <!-- req 03:a19d9eb5.6904 --> カーソルのある小節にセクションマーカーを 1 つ足し（`AddSectionMarkerCommand`）、そのラベルを譜面の上でその場で入力できる状態にする入口とする。 <!-- req 03:a19d9eb5.4d4e --> マーカーを変える・消すのは、譜面の上のマーカーで直接行う（5.2 節）。 <!-- req 03:a19d9eb5.7c8a -->
- 使えないとき（パートが 0 の曲の再生・書き出し・印刷）の見せ方は、基本設計 10 節の回に 12 節へ書く。

### 8.2 曲一覧ウィンドウのメニューの項目

- 曲一覧ウィンドウのメニューバーは「ファイル」「編集」「表示」「ヘルプ」の 4 つ（6.1 節）。設定ダイアログとゴミ箱ダイアログは、このメニューからも開ける（5.1 節の #12 と #14）。
- 各メニューの項目は次のとおり（2026-10-04 本人決定、honnin-queue 29 番）。

| メニュー | 項目 | 選んだときに呼ぶもの |
|---|---|---|
| ファイル | 新規曲作成（Ctrl+N） | 新規曲作成ダイアログを開く（5.1 節の #2、6.1 節の「新規作成」ボタンと同じ） |
| ファイル | 設定 | 設定ダイアログを開く（5.1 節の #12） |
| ファイル | ゴミ箱 | ゴミ箱ダイアログを開く（5.1 節の #14） |
| 編集 | 開く・名前を変更・タグを編集・フォルダへ移動・ゴミ箱へ移動・複製 | 選んでいる曲に、右クリックの同じ名前の項目と同じ処理をする（6.3 節） |
| 表示 | グリッド表示・リスト表示 | 曲一覧の表示方式を切り替える（6.1 節のツールバーの切り替えと同じ状態） |
| 表示 | 並べ替え：曲名・アーティスト名・更新日時・作成日時・パート種別・チューニング名 | 並べ替えのキーを選ぶ（6.2 節のツールバーのドロップダウンと同じ状態） |
| 表示 | 並べ替え：昇順・降順 | 並べ替えの向きを選ぶ（6.2 節） |
| ヘルプ | ヘルプ画面・ライセンス・クレジット・バージョン情報 | 編集ウィンドウのヘルプメニューと同じ（8.1 節と 8.4 節） |

- (b) 曲を選んでいないときは、編集メニューの 6 項目を押せない状態で出す。どの曲に行うかが決まらないため（基本設計 8 節の右クリックで、選択範囲が無いときに使えない項目を無効表示にするのと同じ形）。
### 8.3 組み立て方

- メニューバーは、OS 標準（Windows のアプリのメニュー）の文字のメニューとし、飾りを足さない（[[../basic_design/14_visual_design_system.md#7.1]]）。 <!-- req 03:ae89f62f.6f8a -->
- (b) main が Electron の `Menu.buildFromTemplate` で窓の種類ごとに組み、`BrowserWindow.setMenu` で窓ごとに付ける。曲一覧ウィンドウと編集ウィンドウでメニューが違うため。起動したときに `Menu.setApplicationMenu(null)` を呼び、Electron が自動で作る既定のメニューを使わない（Electron 44 の型定義に「The default menu will be created automatically if the app does not set one. It contains standard items such as `File`, `Edit`, `View`, and `Window`.」）。既定のメニューの役割の項目とそのキーを残さないため。`null` を渡した後に窓ごとの `setMenu` で付いて出ることは、実装の段で起動して確かめる。
- (b) メニューの項目に `role: 'minimize'` を置かない。置くときは `registerAccelerator: false` にして、既定のキー（CommandOrControl+M）を登録しない。Ctrl+M は基本設計 7 節がメトロノームに当てていて、Windows の最小化は OS のキー（Windows キー＋↓）とタイトルバーのボタンで足りるため（turn 115 のチャット側の決定）。
- (b) 項目の横にキー（`accelerator`）は出すが、`registerAccelerator: false` にして OS に登録しない。キーを受けるのはレンダラーの `KeyboardShortcutRouter`（9 節）の 1 か所だけにする。フォーカスが譜面か入力欄かで働きを変えるキーが多く、OS に登録すると入力欄の中でも横取りされるため（Electron 44 の型定義の `registerAccelerator`「If false, the accelerator won't be registered with the system, but it will still be displayed.」）。
- (b) 選ばれた項目は、main がその窓のレンダラーへ `webContents.send` で項目の id を送る（[[web-core-foundation.md#6]] の 6.3 節）。チャンネルは `menu:invoke`、項目の id は次の型とし、どちらも `packages/shared-types` に置く。レンダラーは、id ごとに上の表の「呼ぶもの」を呼ぶ。

```ts
// packages/shared-types/src/menu.ts
export const MENU_CHANNELS = { invoke: 'menu:invoke', route: 'menu:route' } as const;
/** 8.1 節と 8.2 節の表の項目。'songList.' で始まるものは曲一覧ウィンドウだけの項目。 */
export type MenuItemId =
  | 'file.newSong' | 'file.open' | 'file.save' | 'file.saveAs' | 'file.export' | 'file.print' | 'file.close'
  | 'edit.undo' | 'edit.redo' | 'edit.cut' | 'edit.copy' | 'edit.paste' | 'edit.delete' | 'edit.selectAll'
  | 'edit.toggleSelectMode' | 'edit.deleteBar' | 'edit.repeat'
  | 'view.focus' | 'view.scroll' | 'view.score' | 'view.zoomIn' | 'view.zoomOut' | 'view.zoomReset'
  | 'view.fretboard' | 'view.chordNames' | 'view.mixer' | 'view.partManager'
  | 'play.playStop' | 'play.regionLoop' | 'play.sectionLoop' | 'play.solo' | 'play.slowDown'
  | 'play.metronome' | 'play.countIn' | 'play.tapTempo'
  | 'part.add' | 'part.delete' | 'part.reorder' | 'part.tuning' | 'part.instrumentGuitar' | 'part.instrumentBass' | 'part.manager'
  | 'tools.mixer' | 'tools.memoList' | 'tools.sectionMarker' | 'tools.settings'
  | 'help.help' | 'help.license' | 'help.credit' | 'help.version'
  | 'songList.settings' | 'songList.trash'
  | 'songList.open' | 'songList.rename' | 'songList.editTags' | 'songList.moveToFolder' | 'songList.moveToTrash' | 'songList.duplicate'
  | 'songList.layoutGrid' | 'songList.layoutList'
  | 'songList.sortTitle' | 'songList.sortArtist' | 'songList.sortUpdatedAt' | 'songList.sortCreatedAt'
  | 'songList.sortInstrument' | 'songList.sortTuning' | 'songList.sortAsc' | 'songList.sortDesc';
export interface MenuInvokeMessage { id: MenuItemId }
```

- (b) 曲一覧ウィンドウの「新規曲作成」とヘルプメニューの 4 項目は、編集ウィンドウと同じ id（`'file.newSong'` と `'help.'` で始まる 4 つ）を使う。曲一覧だけの項目は `'songList.'` で始め、同じ id を 2 つの窓で別の意味に使わない。受けたレンダラーが、窓の種類によらず id だけで呼ぶものを決められるため。

- (b) メニューの項目の名前（日本語の文言）と並びとキーの表示は、`packages/ui-desktop` に文字のデータとして置き、main はそれを import して組む。画面の文言を書いてよい所を 1 節の 2 か所に限る決まりに合わせるため（L5 は L1 を import してよい、[[web-core-foundation.md#2]] の 2.2 節）。文言が 2 か所の外に無いことを機械で見張る方法は、`Command.label` の置き場所と一緒に基本設計 04 章の回に決める（1 節の宿題のうち、メニューの分はここで決めた）。 <!-- req 09:3b7fd0eb.86eb -->

### 8.4 「開く」「名前を付けて保存」と、曲一覧のダイアログを開く項目

基本設計 6 節の表に名前だけがある次の項目の中身は、2026-10-04 本人決定（honnin-queue 29 番）による。

- 「ファイル」の「開く」は、曲一覧ウィンドウを前に出す。曲は曲一覧から開く設計で、ファイルを選ぶダイアログを主経路にしないため（基本設計 7 節の Ctrl+O の行）。
- 「ファイル」の「名前を付けて保存」は、今の曲を複製し、新しい曲名を入れて、複製した曲を新しい編集ウィンドウで開く。複製は曲一覧の「複製」と同じ処理で作り（6.3 節）、1000 件に達しているときは `SONG-002` で拒否する（2 節）。今の曲の編集ウィンドウは開いたまま残す。
  - (b) 複製の前に `AutoSaveScheduler.flush(songId)` を呼んで終わりを待つ。複製は曲のファイルのコピーで作るので、まだ書いていない編集を写すため。
  - (b) 新しい曲名を入れる欄を先に出し、確定したら複製して、複製した曲の `Song.title` をその名前にする（6.3 節の「名前を変更」と同じ処理）。欄を閉じて取りやめたら、何もしない。取りやめたときに曲が増えないようにし、名前を入れる処理を 2 つ作らないため。
- 編集ウィンドウで「新規曲作成」「設定」「ライセンス」「クレジット」「バージョン情報」を選んだとき（Ctrl+N を押したときも同じ）は、曲一覧ウィンドウを前に出し、そのダイアログを曲一覧ウィンドウの上に出す。設定・ライセンスのダイアログは曲一覧ウィンドウから開くモーダルとしている（4.1 節）ことを、編集ウィンドウから選んだときも守るため。
- 「ヘルプ」の「バージョン情報」は、設定ダイアログを「アプリ情報」タブを選んだ状態で開く。バージョンはそのタブにあるので、別の画面を作らない（基本設計 10 節の設定ダイアログの 8 項目目）。
- 「ライセンス」と「クレジット」は、どちらも 5.1 節の #15 のライセンス／クレジットダイアログを開く（1 つのダイアログにライセンスとクレジットを出すため）。
- (b) 曲一覧ウィンドウへ回す項目は、main が振り分ける。編集ウィンドウのメニューで選ばれたら、main が曲一覧ウィンドウを前に出し、曲一覧ウィンドウのレンダラーへ `menu:invoke` でその id を送る。編集ウィンドウのレンダラーがキー（Ctrl+N）で受けたときは、`menu:route` で id を main へ送り、main が同じく振り分ける。ダイアログを出すレンダラーを曲一覧ウィンドウの 1 つに限り、どの窓から選んでも同じダイアログが同じ所に出るため。チャンネルは `MENU_CHANNELS` に `route: 'menu:route'` として足す（8.3 節の型）。

## 9. キーの表

[[../basic_design/03_screens_ui_pc.md#7]] と 13.4 節・13.6 節のキーを受ける。どのキーを何に当てるかと、その線引きの理由は基本設計が正で、本節はキーを受ける所と、フォーカスの位置による振り分けと、呼ぶものを書く。

### 9.1 キーを受ける所

- (b) キーはレンダラーの `KeyboardShortcutRouter`（`packages/core/src/ui`、窓ごとに 1 つ）だけで受ける。窓の `keydown` を受けて `handleKeyEvent` に渡し、当てたキーなら既定の動きを止める（`preventDefault`）。メニューのキーは表示だけで、OS に登録しない（8.3 節）。キーの振り分けを 1 か所にまとめ、メニューとキーで呼ぶものがずれないため。
- (b) フォーカスの位置を次の 4 つに分け、キーごとに働く所を決める。「譜面」は譜面の表示領域にフォーカスがあるとき、「入力欄」は文字を入れる欄（`input`・`textarea`・その場で文字を入れる要素）にフォーカスがあるとき、「パネル・ダイアログ」はそれ以外の部品にフォーカスがあるとき、「窓全体」は 3 つのどれでもよいとき。下の表の「働く所」の外では、キーを当てずに既定の動き（入力欄の文字の操作やフォーカスの移動）に任せる。

```ts
// packages/core/src/ui/KeyboardShortcutRouter.ts
export type KeyFocus = 'score' | 'textInput' | 'other';
export interface KeyEventLike { key: string; code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
export interface ShortcutBinding {
  /** 正規化したキーの組（例 'ctrl+shift+z'）。 */
  combo: string;
  /** 働く所。'window' は窓全体。 */
  where: 'score' | 'window';
  run: () => void;
}
/** 窓ごとに 1 つ。 */
export class KeyboardShortcutRouter {
  register(binding: ShortcutBinding): void;
  /** 当てたキーを実行したら true（呼んだ側が preventDefault する）。 */
  handleKeyEvent(event: KeyEventLike, focus: KeyFocus): boolean;
  registeredCombos(): string[];
}
```

- (b) 入力欄にフォーカスがあるときは、`where: 'window'` のキーのうち、入力欄にも同じ意味のキーがあるもの（Ctrl+Z・Ctrl+Y・Ctrl+Shift+Z）を当てず、入力欄の動きに任せる。下の表の「入力欄では」の列のとおり。
- 数字キーは `KeyEventLike.code`（`Digit0` から `Digit9` と `Numpad0` から `Numpad9`）で見て、テンキーを開かなくても受ける。

### 9.2 キーと呼ぶもの

| キー | 働く所 | 入力欄では | 呼ぶもの |
|---|---|---|---|
| Ctrl+Z <!-- req 03:3c88619f.9324 --> | 窓全体 <!-- req 03:3c88619f.9ba8 --> | その欄の取り消し <!-- req 03:3c88619f.5a11 --> | `CommandHistory.undo()` |
| Ctrl+Y <!-- req 03:3c88619f.dd0f -->・Ctrl+Shift+Z <!-- req 03:3c88619f.3e05 --> <!-- req 03:5c9856b8.3938 --> | 窓全体 | その欄のやり直し | `CommandHistory.redo()` |
| Ctrl+C <!-- req 03:74daa423.299a -->・Ctrl+X <!-- req 03:74daa423.8451 -->・Ctrl+V <!-- req 03:74daa423.3f66 --> | 譜面 <!-- req 03:74daa423.65cb --> | ふつうの文字の操作のまま、横取りしない <!-- req 03:74daa423.6259 --> | 選択範囲のコピー・切り取り・貼り付け |
| Ctrl+S <!-- req 03:9576dbae.1044 --> | 窓全体 | 当てる | `AutoSaveScheduler.flush(songId)`。すぐに書き出す合図で <!-- req 03:9576dbae.9beb -->、自動保存は止めずに併せて動く <!-- req 03:9576dbae.9196 --> |
| Ctrl+N | 曲一覧ウィンドウ <!-- req 03:2e4a5846.b8b3 -->と編集ウィンドウ <!-- req 03:2e4a5846.1e9b -->の窓全体 | 当てる | 新規曲作成ダイアログを開く |
| Ctrl+E <!-- req 03:03471286.ec8e --> | 窓全体 | 当てる | エクスポートダイアログを開く |
| Ctrl+P <!-- req 03:ed5cca65.ae0c --> | 窓全体 | 当てる | 印刷プレビューダイアログを開く。開く入口は Ctrl+P とメニューの「印刷」の 2 つだけで <!-- req 03:ed5cca65.6808 -->、エクスポートダイアログで PDF を選んでも移らない <!-- req 03:ed5cca65.fc9d --> |
| Space <!-- req 03:a07d4a1d.2118 --> | 譜面 <!-- req 03:a07d4a1d.ce75 --> | 空白の文字の入力のまま <!-- req 03:a07d4a1d.1bdd --> | 再生と停止（playback-integration.md、基本設計 05 章の回） |
| Shift+Space <!-- req 03:9f677330.e7cf --> <!-- req 03:1b35a5bd.f741 --> | 譜面だけ <!-- req 03:9f677330.5fbc --> | 当てない | 曲頭から再生（同上） |
| ← → <!-- req 03:feebac96.6d8a --> | 譜面 | 当てない | カーソルを拍の単位で動かす（`CursorController`、editing-core.md の 04 章の回） |
| ↑ ↓ <!-- req 03:feebac96.5733 --> | 譜面 | 当てない | カーソルを弦の単位で動かす（同上） |
| Delete <!-- req 03:ae0a09c4.2104 -->・Backspace <!-- req 03:ae0a09c4.27e1 --> | 譜面 <!-- req 03:ae0a09c4.ddd6 --> | 当てない | 音符を消す（3.3 節の削除の処理と同じ） |
| Ctrl＋ホイール <!-- req 03:e05d3fb1.088a -->・Ctrl+＋ <!-- req 03:e05d3fb1.4793 -->・Ctrl+－ <!-- req 03:e05d3fb1.0bfb -->・Ctrl+0 <!-- req 03:e05d3fb1.f931 --> | 譜面の表示領域 <!-- req 03:e05d3fb1.ea66 --> | 当てない | `ZoomController.setZoom`・`zoomIn`・`zoomOut`・`setZoom(100)`（[[view-modes.md#1]]） |
| Ctrl+A <!-- req 03:8fd54394.dafa --> | 譜面 | 欄の中の全選択 <!-- req 03:8fd54394.c0e9 --> | 今のパートの中を全部選ぶ |
| 0 から 9 <!-- req 03:f6f65c42.f798 --> | 譜面 | 当てない | 押した数字のフレットに、すぐ音を置いて鳴らす。 <!-- req 03:f6f65c42.dd54 --> 1 秒以内に次の数字を押し、2 桁が 10 から 24 になるときは、置いた音をその 2 桁のフレットに書き換える（2026-10-03 本人決定、honnin-queue 16 番）。 <!-- req 03:f6f65c42.953f --> 置く・書き換えるコマンドの中身は editing-core.md（基本設計 04 章の回） |
| Shift＋クリック <!-- req 03:6a11071a.1f45 --> | 譜面 | — | 範囲選択を始める。編集メニューの「選択モード切替」のトグルモードでも範囲選択できる <!-- req 03:6a11071a.a0e8 --> |
| Esc | 窓全体 | 当てる | 開いているモーダルダイアログかポップオーバーを閉じる。 <!-- req 03:03948d9f.2f5c --> 開いていなければ、範囲選択を解除する <!-- req 03:03948d9f.b46f --> |
| F1 | 全部の窓 <!-- req 03:2d80366e.61f7 --> | 当てる | ヘルプ画面を開く（基本設計 13.2 節、2026-10-03 本人決定） <!-- req 03:2d80366e.53a0 --> |
| Home <!-- req 03:a9535602.be73 -->・End <!-- req 03:a9535602.05a7 --> | 譜面 | 行の頭・行の終わりへの移動のまま <!-- req 03:a9535602.f4e8 --> | 小節の先頭・末尾へ動く |
| Ctrl+Home <!-- req 03:90b3adef.48a4 -->・Ctrl+End <!-- req 03:90b3adef.844a --> | 譜面 | 当てない | 曲頭・曲末へ動く |
| PageUp <!-- req 03:e9f4c152.b347 -->・PageDown <!-- req 03:e9f4c152.f1fb --> | 譜面の表示領域 | 当てない | 1 画面ぶん送る |
| Tab <!-- req 03:20d0234b.f34f -->・Shift+Tab <!-- req 03:20d0234b.a9d5 --> | 譜面だけ <!-- req 03:4d04c04e.7ee1 --> | 当てない | 次・前の拍へ動く |
| F6・Shift+F6 | 窓全体 | 当てる | 譜面 → ツールバー → 開いているパネル → 譜面の順に、フォーカスを巡らせる（Shift+F6 は逆の向き）。 <!-- req 03:d10dc37e.9ce8 --> <!-- req 03:d10dc37e.d03e --> |
| Ctrl+L <!-- req 03:9d0f9d73.6975 --> <!-- req 03:1b35a5bd.12af --> | 窓全体 | 当てる | 区間ループの入切（playback-integration.md、基本設計 05 章の回） |
| Ctrl+M <!-- req 03:38fc73e6.2f4d --> <!-- req 03:1b35a5bd.fb66 --> | 窓全体 | 当てる | メトロノームの入切（同上） |
| Ctrl+1 <!-- req 03:f91f59ae.ee84 --> <!-- req 03:1b35a5bd.b963 -->・Ctrl+2 <!-- req 03:f91f59ae.cb59 --> <!-- req 03:1b35a5bd.cf14 -->・Ctrl+3 <!-- req 03:f91f59ae.63cd --> <!-- req 03:1b35a5bd.6207 --> | 窓全体 | 当てる | フォーカスビュー・全体スクロールビュー・スコア表示へ切り替える。番号は表示メニューの並び順と同じ <!-- req 03:1b35a5bd.67a4 --> |
| Ctrl+B <!-- req 03:932a118d.e9a9 --> <!-- req 03:1b35a5bd.3b09 --> | 窓全体 <!-- req 03:932a118d.b640 --> | 当てる | フレットボード図の表示と非表示 |
| Ctrl+D <!-- req 03:4440c8aa.47b8 --> <!-- req 03:1b35a5bd.b67e --> | 譜面で、選択範囲があるときだけ <!-- req 03:4440c8aa.9dce --> | 当てない | 選択範囲を複製し、写しを選んだ範囲のすぐ後ろに挿入する（2026-10-03 本人決定、honnin-queue 15 番）。 <!-- req 03:4440c8aa.5deb --> クリップボードは変えない。 <!-- req 03:4440c8aa.a5a0 --> 選択範囲が無いときは何もしない <!-- req 03:4440c8aa.cb9b --> |
| Insert（修飾キー無し） <!-- req 03:cd67c1be.a0e5 --> <!-- req 03:1b35a5bd.8ba8 --> | 譜面 | 当てない | カーソルのある小節の直前に小節を挿入する |
| Enter <!-- req 03:16828efd.5a66 --> | 譜面 | 当てない | 休符を置いて次の拍へ進む（`InsertRestCommand`。入力ツールバーの「休符」ボタンと同じ、7.3 節） |
| Ctrl+Shift+1 <!-- req 03:1b35a5bd.e877 --> <!-- req 03:566d8614.3ada -->・Ctrl+Shift+2 <!-- req 03:1b35a5bd.1dfd --> <!-- req 03:566d8614.921b --> | 譜面 <!-- req 03:566d8614.b151 --> | 当てない | ボイス 1・ボイス 2 に切り替える（入力ツールバーの「ボイス 1／2」と同じ状態、7.3 節） |
| Ctrl+Delete <!-- req 03:ce3b07e0.2795 --> <!-- req 03:c9516b9b.b7b0 --> <!-- req 03:c055aad6.fa86 --> | 譜面 <!-- req 03:ce3b07e0.004c --> | 右の単語の削除のまま、横取りしない <!-- req 03:ce3b07e0.4f82 --> <!-- req 03:c055aad6.bf77 --> | 編集メニューの「小節を削除」と同じ `DeleteBarCommand` <!-- req 03:ce3b07e0.66e8 --> |
| Alt+1 から Alt+6 | 譜面 <!-- req 03:9d240e1f.004c --> | 当てない | 音価を選ぶ。Alt+1 <!-- req 03:9d240e1f.50f6 -->は全音符 <!-- req 03:9d240e1f.dce3 -->、Alt+2 <!-- req 03:9d240e1f.ea84 -->は 2 分音符 <!-- req 03:9d240e1f.dd92 -->、Alt+3 <!-- req 03:9d240e1f.a18b -->は 4 分音符 <!-- req 03:9d240e1f.36ca -->、Alt+4 <!-- req 03:9d240e1f.0c30 -->は 8 分音符 <!-- req 03:9d240e1f.63ba -->、Alt+5 <!-- req 03:9d240e1f.9a03 -->は 16 分音符 <!-- req 03:9d240e1f.7453 -->、Alt+6 <!-- req 03:9d240e1f.1b8a -->は 32 分音符 <!-- req 03:9d240e1f.f46a -->。長い音価から順に 1 から 6 とする <!-- req 03:83b7ac59.3d06 --> <!-- req 03:83b7ac59.71f4 --> <!-- req 03:83b7ac59.fbbc --> <!-- req 03:83b7ac59.282b -->。入力ツールバーの音価のパレットで選ぶのと同じで <!-- req 03:9d240e1f.e3a0 -->、範囲選択が有るときは選んだ拍の音価をまとめて変え <!-- req 03:9d240e1f.c4a4 -->、無いときは次に置く音の音価を選ぶ <!-- req 03:9d240e1f.e162 --> |
| Ctrl+T <!-- req 03:e8550dcb.d673 --> <!-- req 03:5347b5f0.1ba7 --> | 譜面 <!-- req 03:e8550dcb.004c --> | 当てない | 入力ツールバーの「タイ」ボタンと同じ `SetTieCommand` <!-- req 03:e8550dcb.6752 --> |
| Ctrl+Shift+T <!-- req 03:fb73980b.7fdf --> <!-- req 03:5347b5f0.e463 --> | 譜面 <!-- req 03:fb73980b.12a5 --> | 当てない | 入力ツールバーの「スラー付与」ボタンと同じ `SetSlurCommand` <!-- req 03:fb73980b.8853 --> |

- Tab と Shift+Tab を「次・前の拍へ」に当てるのは、譜面にフォーカスがあるときだけとする。ダイアログ <!-- req 03:4d04c04e.a2ef -->・パネル <!-- req 03:4d04c04e.702a -->・入力欄 <!-- req 03:4d04c04e.81c9 -->では、今までどおりフォーカスの移動に使う。 <!-- req 03:20d0234b.c466 -->
- 譜面と各パネルの間の移動は、F6 <!-- req 03:4d04c04e.eb8d -->と Shift+F6 <!-- req 03:4d04c04e.97a3 -->に当てる（Windows のペインの移動の慣習）。 <!-- req 03:20d0234b.7c35 --> 譜面にフォーカスがある状態でも、キーボードだけで譜面から抜けられるようにするため。 <!-- req 03:20d0234b.ad32 --> 開いているパネルが 2 つ以上あるときは、画面の位置の順（上から下へ、同じ高さでは左から右へ）に巡る（2026-10-04 本人決定、honnin-queue 28 番）。たとえば、左のパートリスト → 右の小節メモ一覧パネル → 下の入力ツールバー、の順になる。
- (b) 巡る順は、F6 を押したときの各パネルの矩形の左上の点で決める。上の辺の y が小さい順に並べ、y が同じなら x が小さい順にする。ミキサーを浮かせて動かしたときも、動かした先の位置で並べるため。入力ツールバーは巡る先に入れ、スコア表示で隠している間（7.3 節）は飛ばす。フレットボード図は、図から操作する部品を持たない（基本設計 10 節の「読み取り専用」）ので巡る先に入れない。
- (b) Alt+1 から Alt+6 は、Windows では Alt を押すとメニューバーへ移る動きがあるので、`keydown` で当てたときに既定の動きを止めて、メニューへ移らないようにする。止めずにメニューへ移るかは、実装の段で起動して確かめる。

### 9.3 キーの全集合と、当てないキー

- キーの全集合は、基本設計 7 節の表のキーと、13 節のボイスの切り替え <!-- req 03:bd389c31.509d -->・小節の削除 <!-- req 03:bd389c31.1374 -->・音価 <!-- req 03:bd389c31.967f -->・タイ <!-- req 03:bd389c31.0595 -->・スラー <!-- req 03:bd389c31.6a63 -->のキーとし、9.2 節の表はこれと同じものを並べる。この外のキーは当てない。 <!-- req 03:bd389c31.ab96 --> <!-- req 03:4031cb43.6e47 --> (b) `KeyboardShortcutRouter` に登録するキーは、9.2 節の表から作った 1 つの一覧だけにし、ヘルプ画面のキーボードショートカット一覧（基本設計 13.2 節）も同じ一覧から作る。一覧の外のキーが登録されないことと、ヘルプの一覧と実際のキーがずれないことを、単体テストで一覧と `registeredCombos()` を比べて確かめるため。
- Windows の慣習のうち、次のキーを対象に含める。編集の元に戻す <!-- req 03:f3da363a.bba2 -->・やり直す <!-- req 03:f3da363a.0ff5 -->・切り取り <!-- req 03:f3da363a.0002 -->・コピー <!-- req 03:f3da363a.8c2f -->・貼り付け <!-- req 03:f3da363a.f49d -->・全選択 <!-- req 03:f3da363a.5eab -->。ファイルの新規作成 <!-- req 03:f3da363a.5cde -->・保存 <!-- req 03:f3da363a.f487 -->・エクスポート <!-- req 03:f3da363a.7915 -->・印刷 <!-- req 03:f3da363a.3a5c -->。ダイアログを Esc で閉じること <!-- req 03:f3da363a.52b9 -->。ヘルプの F1 <!-- req 03:f3da363a.b8aa -->。移動の Home <!-- req 03:f3da363a.ec4c -->・End <!-- req 03:f3da363a.7021 -->・Ctrl+Home <!-- req 03:f3da363a.0ee1 -->・Ctrl+End <!-- req 03:f3da363a.dace -->・PageUp <!-- req 03:f3da363a.6818 -->・PageDown <!-- req 03:f3da363a.a92d -->・Tab <!-- req 03:f3da363a.19f4 -->・F6 <!-- req 03:f3da363a.58e9 -->。ズームの Ctrl＋ホイール <!-- req 03:f3da363a.2a1c -->・Ctrl+＋ <!-- req 03:f3da363a.380c -->・Ctrl+－ <!-- req 03:f3da363a.fda3 -->・Ctrl+0 <!-- req 03:f3da363a.00bf -->。
- Ctrl+Insert <!-- req 03:0acf1b4c.7eef -->と Shift+Insert <!-- req 03:0acf1b4c.f67a -->は当て直さない。Windows の昔からのコピー <!-- req 03:0acf1b4c.fd65 -->と貼り付け <!-- req 03:0acf1b4c.3787 -->として、OS の既定の動きのまま受ける。9.2 節の表の Insert は、修飾キーを伴わないときだけを指す。 <!-- req 03:0acf1b4c.fb9d -->
- Ctrl+O（開く） <!-- req 03:c18f27a5.013e -->・Alt+F4（閉じる。OS の既定の動きに任せる） <!-- req 03:c18f27a5.846a -->・Ctrl+Shift+S（名前を付けて保存） <!-- req 03:c18f27a5.91fb -->は当てない。Ctrl+F と Ctrl+W も当てない（基本設計 7 節の対象外の行）。

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

**通知の表示規則（2026-09-24 追記、[[../basic_design/08_error_logging.md#1]]・[[../basic_design/08_error_logging.md#4]]・[[../basic_design/03_screens_ui_pc.md#11]]）**：`NotificationChannelSinks` の各実装はこの表に従う。この表は画面に出す記録（`showOnScreen: true`）に当てはめる。画面に出さない設定のコード（[[00_reference.md#5]]の印「画面に出さない」、例：`PLAY-003`）は、どの行にも出さない。色は直値を使わず、[[../basic_design/14_visual_design_system.md#3]]のトークンを CSS 変数（`--color-` ＋表の名前。例：`--color-surface`・`--color-warning`・`--color-danger`。14 章 3 節の冒頭と [[../basic_design/08_error_logging.md#4]]のとおり）で参照する。CSS 変数の定義は [[web-core-foundation.md#4.2]] の Tailwind CSS v4 の `@theme` にだけ置く（2026-09-24 追記）。

| レベル | 出し方 | 色トークン | アイコン | 消えるまで | 操作 |
|---|---|---|---|---|---|
| Info | ステータスバー付近のトースト | 専用色を持たない。背景・文字は `surface` 系 | Info 用のアイコン | `INFO_TOAST_DURATION_MS`（=3000）で自動消滅 | 止めない |
| Warning | 同じトーストで、Info と見分けられるよう目立たせる | 背景 `warning-soft`、枠・文字 `warning` | Warning 用のアイコン | 自動消滅（Info と同じ定数） | 止めない |
| Error | 譜面上の該当箇所は `ScoreHighlightBinder` の赤枠（4.5.1節）＋ステータスバーのメッセージ。譜面の小節を指せない Error（`barIndex` を持たないもの。`TAG-001` が該当）は、その操作をした入力欄や一覧（例：タグ管理ダイアログの入力欄）を赤枠にしてメッセージを添える。赤枠を付ける入力欄や一覧も無い再生の失敗（`PLAY-001`・`PLAY-002`、旧詳細設計 `playback-integration.md` §10.4（`2759936` 時点））は、赤枠を出さずステータスバーのメッセージだけにする | 赤枠 `danger`、背景 `danger-soft` | — | ハイライトは `DEFAULT_HIGHLIGHT_DURATION_MS`（旧詳細設計 `00_reference.md` §4（`2759936` 時点）） | 該当する操作だけを拒否し、他の操作は続けられる |
| Critical | モーダルダイアログ | 見出し・肯定ボタン `danger` | — | 応答するまで | **応答するまで背後の操作を受け付けない。Esc・外側クリック・×では閉じない**。見出し・本文・ボタンは `NotificationEvent` の `title`／`message`／`buttons`（[[error-logging-foundation.md#2.1]]）を使い、**「OK」だけのボタンにしない** |

- **トーストのキュー**：トーストが同時に複数発生したら、`NotificationUIBinder` がキューに積んで 1 件ずつ出す。キューは **Warning を Info より先に**出し、同じレベルの中は発生順にする（[[../basic_design/08_error_logging.md#1.1]]）
- アイコンの素材は [[../basic_design/14_visual_design_system.md#7.2]] のアイコンライブラリから選ぶ
