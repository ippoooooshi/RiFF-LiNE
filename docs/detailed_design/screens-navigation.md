
# 画面群・ナビゲーション 詳細設計書

- **対応作業パッケージ**：画面群・ナビゲーション（実施順序8、[[../basic_design/13_design_decision_points.md#3]]B11、Lサイズ。Phase 1（PC版MVP）の最終パッケージ）
- **ブランチ**：`feature/screens-navigation`
- **前提ドキュメント**：[[../basic_design/03_screens_ui_pc.md]]（全節、画面インベントリ・レイアウト・操作パターン）、[[../basic_design/14_visual_design_system.md]]（全節、配色・タイポグラフィ・コンポーネントの見た目）、[[../basic_design/13_design_decision_points.md]]（B10パートリスト非縮退、C3設定項目、C5〜C7ビジュアル関連、B20エラーレベル再分類）、[[../basic_design/01_architecture.md#3]]AD-2（UIはScoreモデル/ScoreRenderHost/AlphaSynthを直接操作しない）・AD-3（`PlatformAdapter`群）、[[00_reference.md]]（横断リファレンス、本書で新規に確定するクラスもここへ反映する）、および全既存詳細設計書（[[web-core-foundation.md]]／[[data-model-persistence.md]]／[[error-logging-foundation.md]]／[[editing-core.md]]／[[part-tuning-management.md]]／[[view-modes.md]]／[[playback-integration.md]]、それぞれの引き継ぎ事項節）

## 1. スコープ

**含む**：曲一覧ウィンドウ・編集ウィンドウの複数ウィンドウ管理（`WindowAdapter`の新規定義）、新規曲作成ウィザード、メニューバー・ツールバー・キーボードショートカット・ステータスバー、ミキサーパネル・フレットボード図オーバーレイ・パート管理パネル・チューニング設定パネル・小節メモ一覧パネル、設定ダイアログ（12項目）・タグ管理ダイアログ・ゴミ箱ダイアログ・ライセンス/クレジットダイアログ・初回オンボーディングオーバーレイ、`NotificationCenter`購読によるToast/Highlight/Modal表示、これまでのパッケージが確定した各種`Service`/`Controller`をUIから呼び出す配線（AD-2の層構造を維持）。あわせて、詳細設計を通じて判明した3件の横断的な未決着事項（3.1〜3.3節）をここで解消する。

**含まない（他パッケージ・他フェーズに委譲）**：
- 実際のPDF／alphaTex／MIDI生成ロジック（Phase 2、[[../basic_design/07_export_print.md]]）。本パッケージはエクスポート・印刷プレビューダイアログの**UIシェルのみ**を用意する（3.6節で境界を確定）。
- alphaTabのレンダリング自体・Score再描画API → パッケージ1（[[web-core-foundation.md]]）
- コマンド・バリデーション・再生等のドメインロジック本体 → パッケージ4〜7（本パッケージは呼び出すのみ）
- ビジュアルデザインの具体的なトークン値 → [[../basic_design/14_visual_design_system.md]]（本パッケージはトークンを参照するのみで新規に値を定義しない）
- セクションマーカーの譜面上インライン表示・編集自体（画面インベントリ#8） → 編集コア（[[editing-core.md#6.4]]の`AddSectionMarkerCommand`等）と`ScoreRenderHost`の既存レンダリングで実現される。本パッケージが新たな画面・パネルとして実装するものではない（**2026-09-02追記**、セルフレビューで発見。8節のDoD表現もあわせて是正した）。

## 2. 全体構造図

```mermaid
flowchart TB
    subgraph MainProc["Electronメインプロセス（本パッケージで拡張）"]
        WM["WindowManager\n(WindowAdapter実装)"]
    end
    subgraph UI["UI層（本パッケージ）"]
        SONGLIST["曲一覧ウィンドウ"]
        WIZARD["新規曲作成ウィザード"]
        EDITWIN["タブ譜編集ウィンドウ\n(メニュー/ツールバー/ステータスバー)"]
        PANELS["ミキサー/パート管理/チューニング/\nフレットボード/小節メモ各パネル"]
        DIALOGS["設定/タグ管理/ゴミ箱/ライセンス\nダイアログ"]
        ONBOARD["オンボーディングオーバーレイ"]
        NOTIFYUI["NotificationUIBinder\n(Toast/Highlight/Modal)"]
    end
    subgraph Prefs["本パッケージ新設サービス"]
        APS["AppPreferencesService"]
        TAGSTORE["TagStore"]
    end
    subgraph Pkg1["パッケージ1"]
        HOST["ScoreRenderHost"]
    end
    subgraph Pkg2["パッケージ2"]
        REPO["SongRepository/SongIndexService/TrashService/StorageConfigService"]
    end
    subgraph Pkg3["パッケージ3"]
        NC["NotificationCenter"]
    end
    subgraph Pkg4to7["パッケージ4〜7"]
        SVC["EditingService/PartManagementService/\nTuningPresetService/ViewModeController/\nZoomController/PlaybackService等"]
    end

    WM --> SONGLIST
    WM --> EDITWIN
    SONGLIST --> WIZARD
    SONGLIST --> REPO
    SONGLIST --> DIALOGS
    SONGLIST --> ONBOARD
    WIZARD --> SVC
    WIZARD --> APS
    EDITWIN --> PANELS
    EDITWIN --> SVC
    PANELS --> SVC
    DIALOGS --> APS
    DIALOGS --> TAGSTORE
    DIALOGS --> REPO
    NC --> NOTIFYUI
    NOTIFYUI --> HOST
    EDITWIN --> NOTIFYUI
    REPO -->|保存フック| HOST
```

## 3. 新規設計決定

### 3.1 `AppPreferencesService`の新設（設定ダイアログ項目の格納先確定）

[[../basic_design/03_screens_ui_pc.md#10]]の設定ダイアログ12項目のうち、項目9（保存先設定）・10（ミラー先設定）・12（ゴミ箱保持期間）は[[data-model-persistence.md#3.2]]の`StorageConfigService`（`{アクティブなストレージルート}/TabApp/settings.json`）が既に管轄しているが、残る項目1〜6・8・11（チューニング/音色初期値、メトロノーム音量・音色、デフォルトズーム、カウントイン長さ、タップテンポ感度、パート別デフォルト音量、アプリ情報表示、曲一覧表示方式既定値）は、これまでのどの詳細設計書にも格納先が定義されていなかった（横断的な見落とし）。**2026-09-02修正**：項目7「タグ管理」は永続化対象の設定値を持たないタグ管理ダイアログへの導線に過ぎないため、本サービスの対象から除外した（当初の書き方は範囲を「1〜8・11」としており項目7を誤って含意していた。セルフレビューで発見）。

**確定方針**：`StorageConfigService`とは責務を分離した新規サービス`AppPreferencesService`を本パッケージで新設する。保存先は`{アクティブなストレージルート}/TabApp/preferences.json`とし、`StorageConfigService`の`settings.json`（ストレージ構成そのものの設定）とはファイルを分ける（ストレージ移行のたびに書き換わるべき情報と、そうでない情報を混在させないため）。あわせて、初回オンボーディング（12節）の表示済みフラグ（`onboardingSeen: boolean`）もここに格納する（曲固有でもストレージ構成でもない、アプリ全体の状態のため）。

| 責務 | 内容 |
|---|---|
| 読み書き | `load(): Promise<AppPreferences>`／`save(prefs: AppPreferences): Promise<void>`（責務レベル。`FileSystemAdapter`を注入して使う、[[web-core-foundation.md#3.2]]と同じ非破壊拡張パターン） |
| 既定値 | 未保存時は組み込みの既定値（メトロノーム音色＝アコースティック系、デフォルトズーム＝各表示モードの目安値[[view-modes.md#3.2]]、曲一覧表示方式＝グリッド等）を返す |
| 消費元 | `PartManagementService.AddPartCommand`構築時の初期値（[[part-tuning-management.md#5]]）、`MetronomeService`/`CountInController`/`TapTempoController`の設定値（[[playback-integration.md#4.4]]、3.4節で後述）、`ZoomController`の初期ズーム値（[[view-modes.md#4.2]]）、`SongListView`の既定表示方式、オンボーディングオーバーレイの表示要否判定 |

**[[playback-integration.md#4.4]]への非破壊追記**：`MetronomeService`／`CountInController`／`TapTempoController`は責務表のみで「設定値をどこから得るか」を明記していなかった。本パッケージ経由で`AppPreferencesService`の値を参照する契約を追加する（既存の責務定義自体は変更しない、値の入力元を明確化するのみ）。**2026-09-02修正**：本追記は当初この節で「行った」と記載されていたが、実際には[[playback-integration.md#4.4]]本文への反映が漏れていた（セルフレビューで発見）。あらためて[[playback-integration.md#4.4]]へ実際に追記し、記載と実体を一致させた。

### 3.2 `TagStore`インターフェースの確定（未定義だった契約の具体化）

[[data-model-persistence.md#7]]は「タグ作成時に`SongIndexService`とは別の`TagStore`（`tags.json`）でバリデーションする」と`TagStore`の存在を前提にしていたが、同書の3節クラス一覧には`TagStore`自体の責務・メソッドが定義されていなかった（横断的な見落とし）。タグ管理ダイアログ（4.8節）が最初に必要とするため、本パッケージで確定する。

| 責務 | 内容 |
|---|---|
| 一覧取得 | `list(): Promise<Tag[]>` |
| 作成 | `create(name: string): Promise<Tag>`（上限50件チェック、超過時`TAG-001`、3.5節） |
| 名称変更 | `rename(tagId: string, name: string): Promise<void>` |
| 削除 | `delete(tagId: string): Promise<void>`（既存曲からの参照除去は[[data-model-persistence.md#3.1]]の`AppMetadata.tags`側で対応、本サービスは`tags.json`のマスタ削除のみ） |

実体は`{アクティブなストレージルート}/TabApp/tags.json`（[[data-model-persistence.md#7]]が既に前提としていたファイル）。`FileSystemAdapterFactory`は不要（アクティブルート固定でよい）。

### 3.3 サムネイル生成ロジックの所在の是正

[[data-model-persistence.md#11]]は「サムネイル生成は表示モードパッケージでロジックが揃った時点で`SongRepository.save()`のフックとして接続する」と表示モードパッケージへ申し送っていたが、[[view-modes.md]]の実際のスコープ・成果物にはサムネイル生成が含まれていなかった（申し送り先と実装内容が食い違っていた横断的な見落とし）。曲一覧ウィンドウ（[[../basic_design/03_screens_ui_pc.md#4]]）がサムネイル表示を必要とする以上、これ以上先送りできないため、**本パッケージがサムネイル生成ロジックを引き取って実装する**。

**方式**：[[../basic_design/13_design_decision_points.md#3]]B7で確定済みの定義（「alphaTabレイアウトでの最初の1段（システム）」）に従い、`ScoreRenderHost`が保持する現在パートのレンダリング結果から先頭1段のSVGを切り出し、`base64-png`相当（[[data-model-persistence.md#3.1]]の`AppMetadata.thumbnail`型）へラスタライズする`ThumbnailGenerator`（本パッケージ新設、責務レベル）を用意し、`SongRepository.save()`呼び出し前後のフックとして`AutoSaveScheduler`／明示保存の経路へ接続する。既存の保存フローのシグネチャは変更しない（フック追加による非破壊拡張）。

### 3.4 3.1節の反映：メトロノーム/カウントイン/タップテンポの設定値供給

3.1節の通り。`MetronomeService`が`AppPreferencesService`から音色プリセットIDを、`CountInController`が小節数倍率を、`TapTempoController`が感度パラメータを、それぞれ設定ダイアログ保存時に反映する（設定変更の即時反映か次回再生からの反映かは実装時の詳細と位置づけ、本書では確定しない）。**2026-09-02追記**：設定ダイアログ項目③「デフォルトズームレベル」（[[../basic_design/03_screens_ui_pc.md#10]]）は、[[view-modes.md#3.2]]がモードごとに独立保持すると確定したズーム値そのものを1つの数値に統合するものではなく、各モードの目安初期値に対する倍率調整として扱う（[[../basic_design/03_screens_ui_pc.md#10]]側の記述をあわせて修正、セルフレビューで発見）。

### 3.5 タグ数・曲数上限のエラーコード登録（[[00_reference.md#8.1]]G5の解消）

[[data-model-persistence.md#7]]にバリデーション関数の存在は示されていたが、対応する`ErrorCodeRegistry`登録コードが未登録だった（[[00_reference.md#8.1]]G5として記録済み）。本パッケージのタグ管理ダイアログ・曲一覧ウィンドウの実装に伴い、以下を新規登録する。

| コード | レベル | 発生条件 |
|---|---|---|
| `TAG-001` | Error | タグ総数が50件を超える作成操作（**2026-09-02修正**：Warningから再分類、[[../basic_design/13_design_decision_points.md#3]]B20。50件はハードキャップであり超過時は作成自体を拒否するため） |
| `SONG-001` | Warning | 曲数が900件（上限1000の90%）に到達（追加自体は継続可能な予告的警告、B20の対象外） |
| `SONG-002` | Error | 曲数が上限1000件に到達した新規曲作成（**2026-09-03新規**：1000件到達時の挙動が未定義だったレビュー指摘（[[../review/design_review_2026-09-03.md]]A-3）を受け、他のハードキャップと同様に新規作成を拒否するErrorとして確定した。[[../basic_design/13_design_decision_points.md#4]]C12） |

### 3.6 エクスポート／印刷ダイアログのPhase 1スコープ境界（B19として追加）

[[../basic_design/03_screens_ui_pc.md#3]]の画面インベントリはエクスポートダイアログ・印刷プレビューダイアログをPC版画面の一部として列挙しているが、実際のPDF／alphaTex／MIDI生成ロジックは要件定義書9章でPhase 2の作業パッケージとして明確に切り出されている（[[../basic_design/07_export_print.md]]冒頭）。両者の対応関係が既存ドキュメントに明記されておらず、Phase 1完了時にエクスポート機能がどこまで動くべきかが曖昧だったため、ここで確定する。

**確定方針**：本パッケージ（Phase 1）は、エクスポートダイアログ・印刷プレビューダイアログの**UIシェル（形式選択・ファイル名編集フィールド・レイアウトプレビュー領域の枠）のみ**を実装し、「エクスポート実行」「印刷」ボタンは**Phase 2未実装であることを示す無効化状態（ツールチップ「Phase 2で対応予定」）**とする。メニューバー・ツールバーからダイアログ自体は開けるが、実際の変換・出力処理は呼び出さない。理由：(a) ダイアログの構造自体は03章で確定済みでUIとしての実装コストは小さい、(b) Phase 1完了時点で「ボタンはあるが動かない」ことを明示的な無効化状態で示す方が、ボタン自体を隠すよりも今後の拡張（Phase 2）の接続先が分かりやすい。これを**B19**として[[../basic_design/13_design_decision_points.md#3]]へ追加する。

## 4. モジュール構成

### 4.1 `WindowManager`（`apps/desktop/src/main`、`WindowAdapter`の新規実装）

[[web-core-foundation.md#3.2]]の注記通り、[[../basic_design/01_architecture.md#3]]AD-3の`PlatformAdapter`4種のうち`AudioSessionAdapter`・`WindowAdapter`・`UpdateCheckAdapter`は未定義のままだった。本パッケージで`WindowAdapter`を新規定義する（既存の`FileSystemAdapter`とは独立した新規インターフェースであり、非破壊拡張ではなく新規追加）。

| 責務 | 内容 |
|---|---|
| 曲一覧ウィンドウの生成 | アプリ起動時に単一の曲一覧ウィンドウを生成する（[[../basic_design/01_architecture.md#3]]の単一インスタンスロックと連携） |
| 編集ウィンドウの生成・重複防止 | `focusExistingWindow(songId)`で既存ウィンドウがあれば前面化、なければ新規に編集ウィンドウを生成する（[[../basic_design/03_screens_ui_pc.md#2]]）。生成時、当該曲専用の`CommandHistory`／`CursorController`／`ViewModeController`／`ZoomController`／`PlaybackService`インスタンス一式（いずれも編集ウィンドウ単位スコープ、[[00_reference.md#2]]）をこのウィンドウに紐付ける |
| ウィンドウクローズ時の後始末 | 編集ウィンドウを閉じる際、[[data-model-persistence.md#3.2]]の`AutoSaveScheduler.flush(songId)`を待ってからウィンドウ破棄・上記インスタンス一式の破棄を行う |
| モーダル系ダイアログの生成 | 設定・タグ管理・ゴミ箱・ライセンスは曲一覧ウィンドウの子ダイアログとして生成する（[[../basic_design/03_screens_ui_pc.md#2]]） |

### 4.2 `MenuBarController`

[[../basic_design/03_screens_ui_pc.md#6]]のメニュー構成をOSネイティブメニューとして構築し、各項目を対応する下位パッケージのAPI呼び出しへ配線する（責務レベル。例：「元に戻す」→ 当該編集ウィンドウの`CommandHistory.undo()`、「エクスポート」→ 3.6節のシェルダイアログを開く）。UIからScoreモデル・`ScoreRenderHost`・AlphaSynthを直接操作しないというAD-2の層構造を、メニュー項目の配線においても維持する。

### 4.3 `KeyboardShortcutRouter`

[[../basic_design/03_screens_ui_pc.md#7]]のショートカット一覧を、フォーカスのある編集ウィンドウのコンテキストに対して配線する（責務レベル）。OS標準ショートカット（Ctrl+C等）と競合しないよう、テキスト入力欄にフォーカスがある場合はアプリ側のショートカットより入力欄側の既定動作を優先する。

### 4.4 `ToolbarViewModel` / `StatusBarViewModel`（編集ウィンドウごと）

| 責務 | 内容 |
|---|---|
| Undo/Redoボタン状態 | 当該ウィンドウの`CommandHistory.subscribe(listener)`（[[editing-core.md#6.2]]）を購読し活性状態を更新する |
| 再生系ボタン状態 | 当該ウィンドウの`PlaybackService`の状態を反映する（責務レベル） |
| パネル表示トグル | ミキサー／パート管理／チューニング／フレットボード／メモ一覧各パネルの表示・非表示を保持する（編集ウィンドウ単位、Undo/Redo対象外） |
| ステータスバー数値 | 小節位置／拍子／テンポ／カポ（`CursorController`・当該パートの`Part`情報から取得）、ズーム％（`ZoomController`）を等幅フォント表示する（[[../basic_design/14_visual_design_system.md#4]]） |

### 4.5 通知UI：`NotificationUIBinder` / `ScoreHighlightBinder`

[[error-logging-foundation.md#1]]の`NotificationCenter`は購読契約（`subscribe(handler)`）のみを定義し、実際のToast/Highlight/Modal表示コンポーネントはこのパッケージの担当と明記されていた（[[error-logging-foundation.md]]冒頭スコープ外節）。

| モジュール | 責務 |
|---|---|
| `NotificationUIBinder` | `NotificationCenter.subscribe(handler)`を購読し、`NotificationEvent.channel`（`toast`/`highlight`/`modal`）に応じて対応するUIコンポーネントへ振り分ける（[[../basic_design/03_screens_ui_pc.md#11]]のレベル別配置表：Info/Warning＝ステータスバー付近の自動消滅トースト、Error＝譜面ハイライト＋ステータスバーメッセージ、Critical＝モーダルダイアログ） |
| `ScoreHighlightBinder` | `channel === 'highlight'`のイベントを受け取り、`context`内の慣例フィールド（`barIndex`／`trackIndex`等、エラーコード発生元が既に`report()`へ渡している値、例：[[editing-core.md#7]]の`EDIT-001`/`EDIT-002`、小節数・パート数・タグ数上限系の`EDIT-003`/`EDIT-005`/`TAG-001`もB20により本チャンネルの対象になった）をもとに、4.5.1節で新設する`ScoreRenderHost`のハイライト用非破壊拡張を呼び出して赤枠ハイライトを表示する |

#### 4.5.1 `ScoreRenderHost`のハイライト表示用非破壊拡張（新規）

[[web-core-foundation.md#3.1]]の`ScoreRenderHost`（既存メソッドのシグネチャ変更なし）へ、Errorレベル通知の視覚化のためのメソッドを追加する。

| 追加メソッド（責務レベル） | 内容 |
|---|---|
| ハイライト表示 | 指定されたトラック・小節（範囲）に赤枠ハイライトを一定時間表示する |
| ハイライト解除 | 明示的に、または一定時間経過後に自動でハイライトを解除する |

具体的なalphaTabのDOM/SVG要素への装飾方法は、[[view-modes.md#4.3]]の表示モード適用メソッドと同様、実装時にalphaTab公式ドキュメントで確認のうえ確定する実装詳細と位置づける（意図的にシグネチャレベルまで踏み込まない）。

### 4.6 `AppPreferencesService`（3.1節で確定）

3.1節の表の通り。

### 4.7 `TagStore`（3.2節で確定）

3.2節の表の通り。

### 4.8 画面・パネル・ダイアログ一覧（責務レベル）

| # | 画面/パネル/ダイアログ | 主な責務・接続先 |
|---|---|---|
| 1 | 曲一覧ウィンドウ（`SongListView`） | `SongIndexService.load()`で一覧取得、`ThumbnailGenerator`（3.3節）で生成済みのサムネイルを表示、グリッド/リスト切替（既定値は`AppPreferencesService`）、右クリックメニュー（開く/名前変更/タグ編集/ゴミ箱へ/複製）、曲数表示（`SONG-001`警告閾値、3.5節） |
| 2 | 新規曲作成ウィザード | ステップ1（パート数・楽器）→`PartManagementService`、ステップ2（チューニング、既存パートからのコピー含む）→`TuningPresetService`、初期値は`AppPreferencesService`。完了時`SongRepository.create()`→`WindowManager`が編集ウィンドウを開く |
| 3 | タブ譜編集ウィンドウ（シェル） | 4.2〜4.4節のメニュー/ツールバー/ステータスバーを内包し、`ScoreRenderHost`のレンダリング領域をホストする（[[web-core-foundation.md#3.5]]の最小シェルを本パッケージで実際のUIに置き換える） |
| 4 | ミキサーパネル | `PartManagementService`（音量/パン/ソロ/ミュート、[[part-tuning-management.md#4.1]]）を呼び出す非モーダルパネル |
| 5 | フレットボード図オーバーレイ | `CursorController`の現在Beatのノート群・`ChordDetectionService`の推定結果（[[editing-core.md#8]]）を読み取り指板図を描画する（読み取り専用） |
| 6 | パート管理パネル | `PartManagementService`（追加/削除/並替/色、[[part-tuning-management.md#4.1]][[#4.3]]）を呼び出す非モーダルパネル |
| 7 | チューニング設定パネル | `TuningPresetService`（[[part-tuning-management.md#4.2]]）を呼び出す非モーダルパネル |
| 8 | 小節メモ一覧パネル | `AppMetadata.memos`（[[data-model-persistence.md#3.1]]）の一覧表示、[[editing-core.md#6.4]]の`AddMemoCommand`/`EditMemoCommand`/`DeleteMemoCommand`を呼び出す、クリックで該当小節へジャンプ（`CursorController`更新） |
| 9 | 設定ダイアログ | タブ4分類（編集/再生/保存先/その他）で12項目（[[../basic_design/03_screens_ui_pc.md#10]]）を表示。保存先/ミラー先/ゴミ箱保持日数→`StorageConfigService`、項目7（タグ管理）→タグ管理ダイアログへの導線のみ、それ以外→`AppPreferencesService`（3.1節） |
| 10 | タグ管理ダイアログ | `TagStore`（3.2節）のCRUDを呼び出す |
| 11 | ゴミ箱ダイアログ | `TrashService`（[[data-model-persistence.md#3.2]]）の一覧・復元・完全削除、残り日数表示 |
| 12 | ライセンス／クレジットダイアログ | 静的コンテンツ（alphaTab、同梱SoundFont、UIアイコンライブラリ等のライセンス表記、[[../basic_design/14_visual_design_system.md#7.2]]）。サービス接続なし |
| 13 | 初回オンボーディングオーバーレイ | `AppPreferencesService.load().onboardingSeen`が`false`の場合のみ自動表示。「スキップ」「次へ」操作の結果を`AppPreferencesService.save()`で永続化。設定ダイアログの「アプリ情報」タブから再表示可能（[[../basic_design/03_screens_ui_pc.md#12]]） |
| 14 | エクスポートダイアログ（UIシェルのみ） | 形式選択・ファイル名編集フィールドのUIのみ実装。「エクスポート実行」は無効化（3.6節B19） |
| 15 | 印刷プレビューダイアログ（UIシェルのみ） | ページめくりUIの枠のみ実装。「印刷」は無効化（3.6節B19） |

（画面インベントリ#8「セクションマーカー」は本表に含まれない。1節末尾の通り、譜面上インライン表示・編集は編集コアパッケージのコマンド群と`ScoreRenderHost`の既存レンダリングで実現されるため、本パッケージが独立した画面/パネルとして実装するものではない）

## 5. シーケンス図

### 5.1 アプリ起動〜曲を開く（複数ウィンドウ・重複防止）

```mermaid
sequenceDiagram
    participant User
    participant WM as WindowManager
    participant SONGLIST as 曲一覧ウィンドウ
    participant REPO as SongRepository(パッケージ2)
    participant EDITWIN as 編集ウィンドウ

    WM->>SONGLIST: 起動時に生成
    User->>SONGLIST: 曲Aを開く
    SONGLIST->>WM: focusExistingWindow(songA)
    alt 既に開いている
        WM-->>SONGLIST: 既存ウィンドウを前面化
    else 未オープン
        WM->>REPO: load(songA)
        REPO-->>WM: SongDocument
        WM->>EDITWIN: 新規ウィンドウ生成\n(CommandHistory/CursorController/ViewModeController/ZoomController/PlaybackService一式を紐付け)
    end
```

### 5.2 新規曲作成ウィザード

```mermaid
sequenceDiagram
    participant User
    participant WIZ as 新規曲作成ウィザード
    participant APS as AppPreferencesService
    participant PMS as PartManagementService
    participant TPS as TuningPresetService
    participant REPO as SongRepository
    participant WM as WindowManager

    User->>WIZ: ステップ1(パート数・楽器)
    WIZ->>APS: 初期チューニング/音色の既定値取得
    User->>WIZ: ステップ2(チューニング、既存パートコピー可)
    WIZ->>REPO: create(initialSetup)
    REPO-->>WIZ: SongDocument
    WIZ->>PMS: 初期パート構成を反映
    WIZ->>TPS: 初期チューニングを反映
    WIZ->>WM: 編集ウィンドウを開く
```

### 5.3 通知のUI振り分け（Error時の譜面ハイライトを含む）

```mermaid
sequenceDiagram
    participant SRC as 各サービス層
    participant NC as NotificationCenter(パッケージ3)
    participant BINDER as NotificationUIBinder
    participant TOAST as トーストUI
    participant HL as ScoreHighlightBinder
    participant HOST as ScoreRenderHost
    participant MODAL as モーダルUI

    SRC->>NC: report(code, context)
    NC->>BINDER: 購読ハンドラへ通知(NotificationEvent)
    alt channel=toast
        BINDER->>TOAST: 表示(自動消滅)
    else channel=highlight
        BINDER->>HL: context(barIndex,trackIndex等)を渡す
        HL->>HOST: ハイライト表示(4.5.1節の非破壊拡張)
    else channel=modal
        BINDER->>MODAL: モーダル表示(確認必須)
    end
```

### 5.4 設定ダイアログの保存（項目の振り分け）

```mermaid
sequenceDiagram
    participant User
    participant DLG as 設定ダイアログ
    participant SCS as StorageConfigService
    participant APS as AppPreferencesService

    User->>DLG: 項目を編集して保存
    DLG->>DLG: 項目9/10/12か、それ以外かを判定
    alt 保存先/ミラー先/ゴミ箱保持日数
        DLG->>SCS: save(config)
    else その他の項目
        DLG->>APS: save(prefs)
    end
```

### 5.5 初回オンボーディングの表示判定

```mermaid
sequenceDiagram
    participant WM as WindowManager
    participant SONGLIST as 曲一覧ウィンドウ
    participant APS as AppPreferencesService
    participant ONBOARD as オンボーディングオーバーレイ

    WM->>SONGLIST: 起動
    SONGLIST->>APS: load()
    alt onboardingSeen=false
        SONGLIST->>ONBOARD: 自動表示
        User->>ONBOARD: スキップ or 完了
        ONBOARD->>APS: save({onboardingSeen: true})
    else onboardingSeen=true
        Note over SONGLIST: 何もしない
    end
```

## 6. ビルド・テストに関する補足

- `WindowManager`の重複起動防止ロジック（同一`songId`での`focusExistingWindow`挙動）は複合条件を含むため、[[../basic_design/11_test_strategy.md#2]]の方針によりC2まで単体テスト対象とする。
- `AppPreferencesService`・`TagStore`の読み書き・上限バリデーション（`TAG-001`、3.5節）はC1〜C2で単体テスト対象とする。
- `NotificationUIBinder`のchannel振り分け（toast/highlight/modal）はC1（3値の分岐網羅）で十分。
- `ThumbnailGenerator`（3.3節）の実際の画質・サイズ確認は手動シナリオ確認とし、単体テストでは`ScoreRenderHost`をモック化してフック呼び出しのタイミングのみ検証する。
- 複数編集ウィンドウを同時に開いた状態で、各ウィンドウのツールバー状態・パネル表示状態が独立していることを結合テストで確認する（[[editing-core.md#6.2]]と同じスコープ設計のテストパターンを再利用）。

## 7. 新たに確定した設計決定（本書のまとめ）

- **`AppPreferencesService`の新設**（3.1節）：設定ダイアログ項目1〜6・8・11、およびオンボーディング表示済みフラグの格納先を確定。`StorageConfigService`とはファイルを分離。項目7（タグ管理）は対象外。
- **`TagStore`インターフェースの確定**（3.2節）：未定義だった契約を具体化。
- **サムネイル生成ロジックの所在是正**（3.3節）：パッケージ6への申し送りが実装されていなかった問題を、本パッケージが引き取ることで解消。
- **`ScoreRenderHost`のハイライト表示用非破壊拡張**（4.5.1節）：Errorレベル通知の視覚化を可能にする。
- **`TAG-001`・`SONG-001`の新規エラーコード登録**（3.5節）：[[00_reference.md#8.1]]G5を解消。`TAG-001`はErrorレベルで登録（B20）。
- **`SONG-002`の新規エラーコード登録**（**2026-09-03追加**、3.5節）：曲数上限1000件到達時の挙動未定義というレビュー指摘（[[../review/design_review_2026-09-03.md]]A-3）を受け、新規曲作成を拒否するErrorとして新規登録した（[[../basic_design/13_design_decision_points.md#4]]C12）。
- **エクスポート／印刷ダイアログのPhase 1スコープ境界（B19）**（3.6節）：UIシェルのみ実装し、実処理はPhase 2へ委譲することを明記。
- **`playback-integration.md`への非破壊追記を実際に反映**（3.1節）：本書からの参照のみで実体が伴っていなかった食い違いを是正（セルフレビューで発見）。

## 8. Definition of Done

- 本書で定義した`WindowManager`（`WindowAdapter`実装）・`MenuBarController`・`KeyboardShortcutRouter`・`ToolbarViewModel`／`StatusBarViewModel`・`NotificationUIBinder`／`ScoreHighlightBinder`・`AppPreferencesService`・`TagStore`・`ThumbnailGenerator`、および4.8節の全画面/パネル/ダイアログが実装され、[[../basic_design/11_test_strategy.md#2]]のカバレッジ基準を満たす単体テストが揃っている。
- [[../basic_design/03_screens_ui_pc.md]]の画面インベントリ16件のうち、本パッケージが担当する15件（#8セクションマーカーを除く。セクションマーカーは譜面上インライン表示・編集のため[[editing-core.md#6.4]]のコマンド群と`ScoreRenderHost`の既存レンダリングで実現され、本パッケージが新たに画面/パネルとして実装するものではない）が、本書が定めた接続先（サービス/コントローラ）を通じて動作することを結合テストで確認できる（AD-2のUI/ドメイン層分離が守られていること）。**2026-09-02修正**：本項は当初「16件すべて」としていたが、#8は本パッケージのスコープ外であるため、担当範囲を正確に15件へ訂正した（セルフレビューで発見）。
- Info/Warning/Error/Criticalの4段階が、[[../basic_design/03_screens_ui_pc.md#11]]の配置表通りに表示されることを手動シナリオで確認する（`TAG-001`/`SONG-001`/`SONG-002`を含む）。
- 複数編集ウィンドウでの独立動作（5.1節）が結合テストで確認できる。
- 新規曲作成→編集→保存→曲一覧でのサムネイル確認、という一連の操作が手動シナリオで確認できる。
- エクスポート／印刷ダイアログがPhase 1では無効化状態で表示され、誤って実処理を呼び出さないことを確認する（B19）。
- 本書で新規登録した`TAG-001`・`SONG-001`・`SONG-002`、および新設した`AppPreferencesService`・`TagStore`・サムネイル生成の所在是正が[[00_reference.md]]（3節・4節・5節・8.1節）へ反映されている。
- **パッケージ1〜5から繰り越された実 UI 手動シナリオ（[[00_reference.md#8.1]] G23）を、本パッケージの UI 上で実施済みである**。9節の着手時チェックリストの全項目に結果（PASS／要修正）を記録し、G23 行を「解消済み（日付）」へ書き換える。実施中に判明した不具合は、原因パッケージの詳細設計・実装へ差し戻すか、本パッケージのバインダ層の問題として是正する。

## 9. 引き継ぎ事項（Phase 2・実装フェーズへ）

### 9.0 本パッケージ着手時に実施する繰り越し手動シナリオ（[[00_reference.md#8.1]] G23）

パッケージ1〜5 は実 UI が本パッケージ実装前だったため、DoD 基準5（[[../basic_design/15_development_process.md#7]]・[[../basic_design/11_test_strategy.md#6]]）を代替手段で暫定的に満たしてマージ済み。本パッケージの実 UI が揃った時点で、以下を実 UI で通し実施し、各項目に結果（PASS／要修正＋差し戻し先）を記録する。全項目 PASS で G23 を解消済みにする。

- [ ] **P1**：編集ウィンドウ内で alphaTab のサンプル譜面が SVG 描画される（`run-app.cmd` / `pnpm dev`）。
- [ ] **P2-a**：曲を新規作成 → 3秒後に自動保存が発火 → アプリ再起動後に内容が復元される（3.3.1 節のブートストラップ合成点を本パッケージで配線した経路で）。
- [ ] **P2-b**：ゴミ箱への移動と復元／保存先切替（ローカル2フォルダ間）が UI から実行できる。
- [ ] **P2-c**：`LocalBackupService` の1世代バックアップ生成と `restore()`（B25）、終了時 `AutoSaveScheduler.flush()`→`MirrorSyncService.awaitPending()`（B26）がウィンドウクローズ／`before-quit` で動作する。
- [ ] **P3-a**：保存先フォルダを読み取り専用にすると `FILE-001` が Error として通知表示される。
- [ ] **P3-b**：レンダラーを意図的にクラッシュさせると `SYS-001` の復旧通知が編集ウィンドウ内に表示され、`logs/` にも記録される。
- [ ] **P4**：フレット入力バー・音価パレット等の実 UI から、ステップ入力・和音・タイ／スラー・奏法記号・コード検出・Undo/Redo・範囲選択コピー＆ペースト・小節挿入削除が一連の操作として違和感なく動く。
- [ ] **P5**：パート追加・削除・並べ替え・ミキサー操作・カポ設定・チューニングプリセットの適用／論理削除／復元、新規曲作成ウィザードの複数パート同時追加（色の重複が起きない）が UI から実行できる。

### 9.1 Phase 2・実装フェーズ・Phase 3 への申し送り

- **Phase 2（エクスポート・印刷）**：本パッケージが用意したエクスポート／印刷プレビューダイアログのUIシェル（4.8節#14・#15）に対し、[[../basic_design/07_export_print.md]]の実際の変換ロジックを接続し、無効化状態を解除する（3.6節B19の解消）。
- **実装フェーズ全体**：本書を含む全8パッケージの詳細設計が完了したことで、Phase 1（PC版MVP）のV字モデル詳細設計工程が完了する。[[00_reference.md#8.1]]の既存ギャップのうちG5（タグ・曲数上限のエラーコード未登録）・G6（サムネイル生成ロジックの所在未定）は本書で解消し、あわせて`TagStore`の契約未定義（同種の見落とし、3.2節で解消）も対応した。G1（パッケージ1〜3とパッケージ4〜7の記述粒度の不統一）のみ残課題として実装フェーズ、または希望があれば専用の埋め戻しパスへ引き継ぐ。
- **Phase 3（iPhone版）**：`WindowAdapter`（4.1節）はPC版（複数ウィンドウ）を前提に設計しているため、iPhone版（単一画面・画面遷移ベース）では別実装が必要になる。[[../basic_design/01_architecture.md#3]]AD-3の疎結合方針に従い、インターフェース自体（`focusExistingWindow`相当の概念）をどこまで転用できるかはPhase 3着手時に再検討する。
