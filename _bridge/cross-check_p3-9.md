---
turn: 199
from: claude-code
subject: 作業パッケージ 3〜9 の詳細設計の横の照らし合わせ（置き場所・持ち主・呼ぶ時機）
---

# 作業パッケージ 3〜9 の詳細設計の横の照らし合わせ（turn 199）

**作業用の AI 9 体が挙げた数の合計は 94 件。この一覧では種類ごとに 94 行（置き場所 21・持ち主 17・呼ぶ時機 31・その他 25）に並べ直した。** X25 は製品化の 4 件を 1 行にまとめ、O16 は T4 の報告の後ろ半分を分けた行。同じことを 2 体以上が挙げたもの・同じ根の別の面は「重なり」の列に書いた（重なりを除いた数は数えていない）。ほかに、既知のギャップ G65 に当たるものが 1 件（数に入れていない）。

- 直していない・決めていない・honnin-queue に積んでいない（to-cc-detail 3 節のとおり）
- 原文の引用は、作業用の AI が設計書を開いて写したもの。**本体はこの一覧の引用を開き直して確かめていない**（未確認）。決める前に、その行を開いて確かめること
- 作業パッケージは基本設計 15 章 4.1 節の名前で書く（1 Webコア基盤・2 データモデル・永続化・3 エラー・ログ基盤・4 タブ譜編集コア・5 パート・チューニング管理・6 表示モード・7 再生エンジン統合・8 画面群・ナビゲーション・9 Phase 1 完成・製品化）。本体が作業用の AI に渡した文で 4 と 5 の番号を取り違えていたので、名前に直して書いた
- 「重なり」の列は、同じことを挙げたほかの行の番号

## 2026-10-29 の決め方（turn 200 で書き足し。原文は _bridge/archive/to-cc-detail_t200.md の 1・3 節）

- 本人の決定：K1 窓どうしの知らせ（変えた窓から main を通して、ほかの開いている窓へ非同期に「何が変わったか」だけを送る。kind は tuningPresets・preferences・tags・storage・song）／K2 開いている曲の名前・タグは K1 の道で窓の中の曲に当てる／K3 右クリックのメニューは画面で描く／K4 閉じるときは保存が終わるまで待ち、5 秒の打ち切りは画面が応答しないときだけの見張り／K5 main で起きたエラーは main が自分でログに書き、画面への知らせは開いている窓へ送る／K6 書き出すボタンは押せる形にし、押したら「今後のバージョンで対応予定」と知らせる。ほかの欄は見えるが動かない／K7 曲を開いたときは、その曲で最後に使っていた表示モードで開く
- チャット側の決め方：D1 詳細設計の本文が正（00_reference.md を本文に合わせる）／D2 型や部品を定義している節が正／D3 呼ぶ所が無いものは main の起動・終了の順か窓の組み立てが呼ぶ／D4 数え間違い・書き漏れは数え直す／D5 編集窓を閉じるときの dispose は呼ばない／D6 分担の決め直しは受け持ちのパッケージのターンで／D7 G29・G36 の判定条件を今の行へ向け直す／D8 完全に消したときの export-folders.json の 1 件を消す
- 「4節」は、作業パッケージ 3 の分として turn 200 の指示（to-cc-detail 4 節）が当て方を書いた行
- 各行の終わりの【決め方：…】が当てた決め方。（未）はまだ設計書に当てていない、（当てた turn 200）は当てた。印なしの行は、受け持ちのパッケージを始めるターンで決め方を選ぶ


| 種類 | 件数 |
|---|---|
| 置き場所 | 21 |
| 持ち主 | 17 |
| 呼ぶ時機 | 31 |
| その他（名前・数・シグネチャの食い違い） | 25 |

| 見た文書（作業用の AI 1 体ずつ） | 件数 |
|---|---|
| error-logging-foundation.md 全体 | 13 |
| part-tuning-management.md・view-modes.md 全体 | 9 |
| editing-core.md 1〜480 行 | 7（ほかに G65 が 1） |
| editing-core.md 481〜1139 行 | 13 |
| playback-integration.md 全体 | 14 |
| screens-navigation.md 1〜483 行 | 10 |
| screens-navigation.md 484〜826 行 | 10 |
| screens-navigation.md 827〜1216 行 | 10 |
| phase1-productization.md 全体・export-print.md の Phase 1 の分（391〜395・214・405 行） | 8 |

略号：EL＝error-logging-foundation.md、DM＝data-model-persistence.md、WC＝web-core-foundation.md、SN＝screens-navigation.md、EC＝editing-core.md、PT＝part-tuning-management.md、VM＝view-modes.md、PI＝playback-integration.md、EP＝export-print.md、P1＝phase1-productization.md、REF＝00_reference.md（どれも docs/detailed_design/ の下）

## 1. 置き場所（21 件）

| # | 受け持ち | 何が足りないか・どこが違うか | 原文 | 重なり |
|---|---|---|---|---|
| L1 | エラー・ログ・画面群 | main の MirrorSyncService が出す FILE-005 を、renderer に在る notificationCenter のシングルトンへ直に出す形のまま | EL:293「共有シングルトン `notificationCenter` を各サービスから直接呼ぶ」／DM:475「`MirrorSyncService` は main に置き…main で出た `FILE-005` を画面へ届けるつなぎは…作業パッケージ 8」 | T4 【決め方：K5・4節（未）】 |
| L2 | エラー・ログ | CrashRecoveryController をアプリに 1 つか、ウィンドウごとかが無い（`consumeRecoveryState()` はウィンドウを取らないのに、数え方は「同一ウィンドウ」） | EL:62「`consumeRecoveryState(): CrashRecoveryState`」／EL:64「同一ウィンドウ・同一アプリセッション内で3回」 | 【決め方：4節（未）】 |
| L3 | エラー・ログ・画面群 | ErrorBoundary（packages/ui-desktop）から report() と「画面を開き直す」の IPC に届く注入口が無い | EL:108-111 の ErrorBoundaryProps（children と windowKind）／SN:121-126 の RendererDeps／EL:128「renderer が `window:reloadAfterRenderError` の IPC…で main に頼み」 | 【決め方：4節（未）】 |
| L4 | エラー・ログ・Webコア基盤 | EL が main に置いた 3 つ（フリーズのネイティブダイアログ・ログフォルダを開く口・main の未捕捉の例外の受け口）が、シェルの仕事 7 点のどれに入るかが無い（⑦ に入れて読むかは推測） | WC:446「7 点の外へ足さない」、WC:462「⑤ OS 標準のダイアログの呼び出し（印刷・ファイル選択）」／EL:71「`dialog.showMessageBox` で Critical のネイティブダイアログ」 | 【決め方：4節（未）】 |
| L5 | 画面群 | NotificationUIBinder を「アプリ全体で 1 つ」としているが、NotificationCenter は renderer ごと、mountWindow がウィンドウごとに attach する | SN:1027「`NotificationUIBinder`（アプリ全体で 1 つ）」／EL:85「renderer（Webコア）…の共有シングルトン」 | L9 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| L6 | 表示モード（か Webコア基盤） | `PartRegion` の型の置き場所が 2 か所で違う | WC:681「型は packages/core/src/rendering から出す」／VM:89・103 `// packages/core/src/ui/PartColorOverlay.ts` の中で `export interface PartRegion` | 【決め方：D2（未）】 |
| L7 | 表示モード・画面群 | 色の帯の DOM を作る所と受け持ちが 3 か所で違う | PT:37「色を重ねる DOM と CSS を作るのは画面群の側」／VM:106「帯は `packages/core/src/ui` の `PartColorOverlay` が作り」／REF:268「色オーバーレイ本体と DoD 基準5 はパッケージ8へ繰り越し」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| L8 | 表示モード | 型を置くファイルが食い違う（ViewModeRenderRequest・ViewModeRenderHost） | VM:26「packages/core/src/rendering/types.ts」／WC:641・655 は `ScoreRenderHost.ts` の中／VM:57 は `ViewModeController.ts` の中、REF:279「（型、`viewmodes/types.ts`）」 | 【決め方：D2（未）】 |
| L9 | パート・チューニング・画面群 | 「アプリ全体で 1 つ」の部品が 3 つ（TuningPresetService・NotificationUIBinder・FieldErrorTarget）あるが、レンダラーはウィンドウごと。tuning-presets.json を 2 つのレンダラーが書き、同時に書いたときの決まりが無い | PT:211「アプリ全体で 1 つ」／WC:581「編集ウィンドウ（曲）ごとにレンダラーのプロセスを分ける」／PT:238 `TuningPresetStore.save(presets)`（全体を書き直す） | L5・O14 【決め方：K1（未）】 |
| L10 | タブ譜編集コア | CommandHistory のフォルダが 2 か所で違う | EC:76「// packages/core/src/editing/commands/CommandHistory.ts」／WC:1085「`packages/core/src/editing/CommandHistory.test.ts`」 | 【決め方：D2（当てた turn 216）】 |
| L11 | タブ譜編集コア | CompositeCommand の置き場所が同じ文書の中で違う | EC:156「// packages/core/src/editing/CompositeCommand.ts」／EC:24「`packages/core/src/editing/commands`」、WC:81 | 【決め方：D2（当てた turn 216）】 |
| L12 | タブ譜編集コア | i18nGuard.test.ts が apps のファイルを読むのに node:fs が要り、テストにもかかる import の禁止に当たる（推測。読み方が書いていない） | EC:71／WC:71「…`apps/**`・`react` の禁止は、テストのファイルにもかける」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| L13 | タブ譜編集コア・パート・チューニング | パートの数の確かめ（validatePartCount）を呼ぶ側が 2 つの設計書で違う | EC:750「`EditingService` が呼ぶ所を 1 つにするため」／PT:116 `PartManagementService.addPart` が「8 を超えるなら EDIT-005」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| L14 | タブ譜編集コア・画面群 | コード名を重ねる `<div>` と範囲選択のハイライトの `<div>` を作る部品の名前と置き場所が無い | EC:976・1004 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| L15 | 画面群・Webコア基盤 | 右クリックのメニューを main で組むか画面で出すかが逆（基本設計 01 章 163 行も main で組む書き方） | WC:463「⑥ メニューバーと右クリックメニューの構築｜…main の `Menu`」／SN:728「レンダラーの画面の部品（`packages/ui-desktop`）で出し、Electron の `Menu.popup` は使わない」 | 【決め方：K3（当てた turn 200）】 |
| L16 | 画面群（REF は製品化） | メニューの組み立て役の置き場所と、項目の id の型と数が違う。main でメニューを組む部品の名前とファイルが無い | REF:319「`MenuBarController`（`packages/core/src/ui`）…22 種」／SN:556-578 は `packages/shared-types/src/menu.ts`、22 種より多い／SN:588「main はそれを import して組む」 | 【決め方：D1（未）】 |
| L17 | 画面群 | `keydown` を聴き KeyFocus を決める部品の置き場所が無い | SN:613「窓の `keydown` を受けて `handleKeyEvent` に渡し」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| L18 | 画面群 | SaveStateTracker にファイルの置き場所が無い。「bootstrap」が App.tsx か mountWindow かも無い | SN:280-300／SN:303「組み立ての処理（bootstrap）がつなぐ」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| L19 | 画面群 | highlight の受け口で振り分ける部品の持ち主と置き場所が無い。FieldErrorTarget のパッケージも無い。曲一覧ウィンドウには ScoreHighlightBinder が無い | SN:1062「8 つのコードを受けたら ScoreHighlightBinder へは渡さずに `FieldErrorTarget.showError`」／REF:323 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| L20 | 画面群 | 取り込み（12.12 節）の写す・index.json を直す・上限 1000・moveToTrash を main とレンダラーのどちらが行うかが無い。上書きのとき開いている曲の扱いも無い | DM:590「main が…パスを取り出す」まで | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| L21 | 画面群 | ヘルプ画面を曲一覧ウィンドウでどう出すかが無い（5.1 節の表にヘルプの行が無い） | SN:667（F1 は全部の窓）／SN:1004「非モーダルのパネル」／SN:165「編集ウィンドウと同じレンダラーの中に作る」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |

## 2. 持ち主（17 件）

| # | 受け持ち | 何が足りないか・どこが違うか | 原文 | 重なり |
|---|---|---|---|---|
| O1 | エラー・ログ | 終了の処理で main が出す FILE-015 をログに書く経路が無い（main は LogEntry を組み立てない決まり、最後のウィンドウを閉じた後は renderer が無い） | EL:85「NotificationCenter \| renderer（Webコア）」、EL:141「main は `LogEntry` を組み立てず」／DM:476「main の終了の処理がログに書く…`FILE-015`」 | 【決め方：K5・4節（未）】 |
| O2 | エラー・ログ・データモデル | 保存先を動いている途中で移した後、main の Logger の書き込み先を誰がいつ移すかが無い | EL:86「アクティブルート用アダプタを注入して生成」／DM:364「アプリが動いている間に、保存先を変えられる」 | T15 【決め方：K1・4節（未）】 |
| O3 | エラー・ログ | SYS-002 の context.logFolder を renderer が手に入れる道が無い | EL:242「`context` は今までどおり `{logFolder}`＝`getLogFolderAbsolutePath()`」／EL:89・REF:233 の CrashRecoveryState は 2 つだけ | 【決め方：4節（未）】 |
| O4 | 表示モード（かデータモデル） | `appMeta.settings.defaultViewMode` を書く側が無い | VM:22「曲を開いたときのモードは…`defaultViewMode`」（detailed_design 全体の 4 件はどれも読む側か型） | 【決め方：K7（未）】 |
| O5 | タブ譜編集コア・画面群 | 開いている曲の名前・タグを曲一覧で変えたとき、1 つのファイルを書く所が 2 つになる（推測：次の自動保存が古い名前で上書きする） | EC:452「曲一覧の右クリックとメニューバーの「名前を変更」で、曲のファイルを書き直す」／DM:257 | O11 【決め方：K1・K2（未）】 |
| O6 | パート・チューニング | ChordDetectionService の結果を誰が持ち、onCommandApplied に誰が登録するかが無い。EditingService のコンストラクタも受け取っていない | EC:916／EC:926-931（コンストラクタ無し）／EC:660-662・677 | 【決め方：D6（未）】 |
| O7 | Webコア基盤・タブ譜編集コア | alphaTab の `NotationElement.EffectText` を切る所を、alphaTab の設定を持つ WC が受けていない | EC:976／WC:157「渡すのは `packages/core/src/rendering` の 1 か所だけ」 | 【決め方：D6（未）】 |
| O8 | Webコア基盤・画面群 | EDIT-001 の赤枠を音符に付けると書くが、ScoreHighlightRequest は音符を指せない | EC:748「その弦の今ある音符に赤枠を付ける」／WC:663-669（trackIndex・startBarIndex・barCount） | 【決め方：D6（未）】 |
| O9 | タブ譜編集コア・画面群 | Error の EDIT-002・003・010・011 の赤枠の出先と context の中身が無い | REF:377・378・385・386／SN:1062 | T25 【決め方：D6（未）】 |
| O10 | 再生 | 一時のソロの集合を誰が持つかが閉じていない。作る順が輪になる | PI:550 `temporarySolo: { get(); onChange() }`／PI:103 は `setTemporarySolo` だけ／PI:66 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| O11 | 再生 | カウントインの入切の値を持つ部品の名前が無い | PI:692「`PlaybackPreferences` には入れず、編集ウィンドウを閉じるまで持つ」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| O12 | 画面群 | タグを消したとき、曲のファイルからタグを外す処理の持ち主が無い（TagStore は REF:214 だけ）。開いている曲の扱いも無い | DM:439「screens-navigation.md の 12.10 節の 7 項目目」／SN:933「そのタグが付いていた曲からタグが外れ」 | O5 【決め方：K1・K2（未）】 |
| O13 | 画面群・データモデル | 「名前を付けて保存」で複製した写しを誰がミラーへ回すかが無い | SN:595（編集ウィンドウで複製）／DM:580「曲一覧の「複製」の処理が…`syncAfterSave`」、DM:569 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| O14 | 画面群 | tuning-presets.json と preferences.json の既定の値を、設定ダイアログ（曲一覧）で変えたことを編集ウィンドウへ知らせる口が無い | SN:939「作ったプリセットは、チューニング設定パネル（12.4 節）のプリセットの選択にも出る」 | T8 【決め方：K1（未）】 |
| O15 | パート・チューニング（かデータモデル） | MIDI のプログラムが 30・33 以外の曲の instrumentType が無い | PT:18「`Track.playbackInfo.program`…から決まった対応で読み戻す」（対応は 30 と 33 だけ） | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| O16 | エラー・ログ | （O1 の裏）main で出た通知を main の側でログに書く購読が無い | EL:87 で購読するのは「renderer の `errorLoggingBootstrap`」だけ | O1・L1 【決め方：K5・4節（未）】 |
| O17 | Phase 2（参考） | 完全に消したときの export-folders.json の 1 件を消すことを、受け手の EP が書いていない | DM:422／EP の export-folders は 194・197・378・379 行で、どれも消すことではない | 【決め方：D8（当てた turn 200）】 |

## 3. 呼ぶ時機（31 件）

| # | 受け持ち | 何が足りないか・どこが違うか | 原文 | 重なり |
|---|---|---|---|---|
| T1 | エラー・ログ・画面群 | Logger.flush() を終了で誰が呼ぶかが無い（終了の順は 2 段だけ） | EL:96「アプリ終了処理・テスト用」／SN:108-110 | 【決め方：D3・4節（未）】 |
| T2 | エラー・ログ・画面群 | ウィンドウを作るたびに CrashRecoveryController.attach を誰が呼ぶかが無い。印刷用の見えないウィンドウに attach しないことも無い | EL:62／REF:317 の WindowManagerDeps／EP:340 | 【決め方：D3・4節（未）】 |
| T3 | エラー・ログ・画面群 | renderer の起動の順に errorLoggingBootstrap の 4 つ（error・unhandledrejection の登録、onMainUncaught、freeze:recovered、window:getSongId）が入っていない。errorLoggingBootstrap のファイルも無い | EL:138「起動時に `window.addEventListener('error'…` を 1 回ずつ登録」／SN:133 の起動の順 (1)〜(5) | 【決め方：D3・4節（未）】 |
| T4 | 画面群 | main で出た FILE-005 を画面に届ける道（チャンネル名・どのウィンドウ）が無い | DM:475／EL:293 | L1 【決め方：K5・4節（未）】 |
| T5 | 画面群 | 起動のときのゴミ箱の片付け（claimStartupCleanup）を、どのレンダラーがいつ呼ぶかが SN に無い（SN で claimStartupCleanup は 0 件） | DM:562「レンダラーは起動のときの片付けを始める前に…`appconfig:claimStartupCleanup` を呼び」 | T6 【決め方：D3（未）】 |
| T6 | パート・チューニング | プリセットの消した印を片付ける `TuningPresetService.purgeExpired` を起動で誰が呼ぶかが無い | DM:452「アプリの起動のときに 1 回」／DM:562 は TrashService の分だけ | T5 【決め方：D3（未）】 |
| T7 | 画面群 | ゴミ箱の purgeExpired で消したときに onPermanentlyDeleted を渡す TrashService の組み立てが無い（渡すのはゴミ箱ダイアログのときだけ） | SN:901／DM:561 | T5 【決め方：D3（未）】 |
| T8 | 再生 | 設定を変えたときに再生の設定を読み直す呼び手が無い（load だけで変わったことを知らせる口が無い） | PI:510「設定ダイアログで値を変えたとき」／PI:522 `PlaybackPreferencesSource { load() }` | O14 【決め方：K1（未）】 |
| T9 | 再生 | 曲の MIDI を誰がいつ作るかが割れている（作り直しの呼び手・クリック入り MIDI・appendToSongMidi の呼び手） | PI:305「次の `play` の前に MIDI を作り直す」／PI:402／PI:320 `loadMidiForScore`／PI:43-56／PI:495 | 【決め方：D6（未）】 |
| T10 | 再生 | `PlaybackMixerBinder.syncAll()` を曲を開いたときと MIDI を読み直した後に呼ぶ所が無い | PI:553／PI:560（onCommandApplied のときだけ） | 【決め方：D3（未）】 |
| T11 | 再生 | 閉じるときの dispose の呼び手が無い（プロセスが終わるので要らないかは推測） | PI:611「編集ウィンドウを閉じるときに `dispose` で壊す」／REF:317／SN:128 | 【決め方：D5（未）】 |
| T12 | 画面群（結線は製品化） | 起動の順に `PreviewSynth.load()` が入っていない | PI:584「`PlaybackService.preWarm()`…と同じ時機に `PreviewSynth.load()` を 1 回呼ぶ」／SN:133 の (5) は preWarm だけ | 2 体が挙げた 【決め方：D3（未）】 |
| T13 | 表示モード・画面群 | `PartColorOverlay.update`・`clear` を誰が呼ぶか、`colorByTrackIndex` を誰が作るかが無い | VM:106「…`renderFinished`）に `update` を呼ぶ」（主語が無い） | 【決め方：D3（未）】 |
| T14 | 表示モード | `viewMode.onChange` がいつ出るかが無い（推測：範囲を動かすたびにズームも当て直し、描き直しが 2 回） | VM:144「`viewMode.onChange(() => zoom.reapplyForCurrentMode())`」／REF:277 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| T15 | 画面群 | 保存先の移行のロックが、別のプロセスの編集ウィンドウに届く道を持たない。ログの先を新しいフォルダに替える道も無い | DM:370「各編集ウィンドウの `AutoSaveScheduler.flush(songId)` の終わりを待ってから」／WC:581／SN:420 | O2・2 体が挙げた 【決め方：K1・4節（未）】 |
| T16 | 画面群 | 曲を読めず控えからも戻せなかったとき、開いた編集ウィンドウを誰がどう閉じるかが無い | SN:99「reject せず、開いた編集ウィンドウの側で…知らせる」／SN:70／SN:105（closeEditWindow は外した） | T18 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| T17 | 画面群 | mountWindow に渡すのはアダプタと NotificationCenter だけで、中で作るサービスが使う IPC（getPreMigrationRoot・mirror:syncAfterSave・deleteWindowBounds・閉じるときの flush）に届く道が無い | SN:132「入口が渡すのはアダプタと `NotificationCenter` だけ」／WC:97「グローバルな置き場…から取らない」 | 【決め方：D3（未）】 |
| T18 | 画面群 | 「閉じる」と Ctrl+W で窓を閉じる口が無い（WindowAdapter は開く 2 つだけ） | SN:498・655／SN:88-93／SN:105 | T16 【決め方：D3（未）】 |
| T19 | 画面群 | 曲一覧ウィンドウが閉じた後に送る先が無い（開き直す口も外した） | SN:109／SN:594・598・605 | 【決め方：D3（未）】 |
| T20 | 画面群 | 画面から main へ送る口（印の状態・並び）が MENU_CHANNELS に無い | SN:527・549／SN:560 `MENU_CHANNELS = { invoke, route }` | 【決め方：D3（未）】 |
| T21 | 画面群 | サムネイルを入れた後の保存を誰が起こすか、保存とサムネイルが回り続けない手当てが無い | DM:259「次の自動保存で曲のファイルへ書く」／SN:199 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| T22 | 画面群 | 写しが無いサムネイルを main が作り直すときの、頼む道と知らせる道のチャンネルが無い | DM:263「main が裏で…曲一覧に知らせて描き直す」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| T23 | タブ譜編集コア | 2 桁のフレットの覚えを、カーソルが動いたら捨てる道が無い（← とクリックは EditingService を通らない） | EC:550／SN:658「← は `CursorController.moveByBeat`」 | 【決め方：D6（未）】 |
| T24 | タブ譜編集コア | タイの候補を判定する関数と持つ部品が無い。setTie がどの拍に付くかがあいまい | EC:757-760・758・671 | 【決め方：D6（未）】 |
| T25 | タブ譜編集コア・画面群 | insertRest の後に suggestTechniques を誰が呼ぶかが無い。placeNote と insertRest は void で、置いた NoteRef を受け取れない | EC:786・794 | 【決め方：D6（未）】 |
| T26 | データモデル・画面群 | SONG-001 を出す時機が違う | EC:737「新しく曲を作るとき」／DM:248「曲を作った後と、曲一覧を読み込んだとき」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| T27 | データモデル | 自動保存の notifyDirty を誰が呼ぶかが違う（コマンドは AutoSaveScheduler を持たない） | EC:86、SN:307「bootstrap が…notifyDirty…もつないでいる」／DM:511「1. 編集のコマンドが `AutoSaveScheduler.notifyDirty(songId)` を呼ぶ。」 | 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| T28 | 製品化 | D2 で接続先を書くはずの「画面 × 状態 × 接続先の表」が今の P1 に無いのに、G29・G36 の判定条件がその表を指す | REF:437・444「旧詳細設計 `phase1-productization.md` §5（`2759936` 時点）」／P1:33 | 【決め方：D7（未）】 |
| T29 | 画面群か製品化 | Phase 1 で枠だけ作る書き出しのダイアログで、ボタン以外の欄（保存先・参照…・プレビュー）が動くかが無い。欄が呼ぶ IPC は Phase 2 の EP にしか無い | SN:887「書き出すボタンは Phase 2 まで押せない」／EP:378-380 | 【決め方：K6（当てた turn 200）】 |
| T30 | 画面群 | 閉じるときの flush の待ち方が 3 か所で違う（5 秒で打ち切る・打ち切らない・書き直しの待ちだけで 13 秒） | REF:318「`DEFAULT_FLUSH_TIMEOUT_MS(5000)`」／SN:110／DM:519「1 秒・3 秒・9 秒…3 回まで」 | 【決め方：K4（未）】 |
| T31 | 画面群 | 設定ダイアログのある曲一覧のレンダラーから、他の窓の SongRepository・main の Logger と MirrorSyncService の読み書き先を切り替える道が無い | SN:420 の `switchPrimaryStorage` | T15 【決め方：K1・4節（未）】 |

## 4. その他：名前・数・シグネチャの食い違い（25 件）

| # | 受け持ち | どこが違うか | 原文 |
|---|---|---|---|
| X1 | エラー・ログ | 読み込み直した後に開く曲の ID を受け取る手段が 2 つ | EL:77「`window:getSongId` IPC」／EL:128「URL のハッシュに曲の ID がある」、SN:131「`#edit/<songId>`」 【決め方：4節（未）】 |
| X2 | エラー・ログ | REF の CrashRecoveryController に reloadAfterRenderError が無い | REF:231／EL:62 【決め方：D1・4節（未）】 |
| X3 | エラー・ログ | 「コア 8 コード」と、REF 5 節の登録パッケージ 3 の行（9 行）、EL 4 節の表（11 行）の数が合わない。EL 4 節の表に SYS-005 が無い | EL:85／REF:228／EL:233-245、EL:139・REF:374 【決め方：D4・4節（未）】 |
| X4 | エラー・ログ | getRecentBuffer の使い道が 2 か所で違う | EL:26「3節で使用」／EL:207 は `LogRingBuffer.snapshot()` 【決め方：4節（未）】 |
| X5 | エラー・ログ | SYS-001 と SYS-002 を両方出すか一方だけかが読み取れない（今のコードは一方だけ） | EL:212-214／EL:89 【決め方：4節（未）】 |
| X6 | エラー・ログ | main が LogEntry を組み立てない決まりと、FILE-015 を main で書く今の形（DM 14.1 節側の文は未確認） | EL:141／REF:369 【決め方：K5・4節（未）】 |
| X7 | タブ譜編集コア | CommandHistory の公開メソッドが 2 か所で違う（setFullRedraw は REF だけ） | REF:249／EC:90-102・175 【決め方：D1（当てた turn 216）】 |
| X8 | タブ譜編集コア・再生 | ミキサーの 4 つのコマンドが 2.6 節の一覧と 12 章 6 節の表に無い | PI:537-540・542／EC:191・192 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| X9 | タブ譜編集コア | REF 3 節と EC の 4 つの違い（detectFromPitchClasses の引数・ClipboardSnapshot の形・BarDeleteDisposition の値・ValidationService） | REF:251-254／EC:933・1014-1016・1102 【決め方：D1（当てた turn 216）】 |
| X10 | タブ譜編集コア | 任意の連符の数の範囲が違う（1〜12 と 2〜12） | REF:390／EC:585 【決め方：D4（当てた turn 216）】 |
| X11 | タブ譜編集コア | 休符の拍を消す手段の数が同じ文書の中で違う（4 つと 3 つ） | EC:607／EC:612 【決め方：D4（当てた turn 216）】 |
| X12 | 再生 | AlphaSynth へ書く部品が 2 つ | PI:168「`PlaybackMixerBinder`（7 節）だけ」／PI:137「`PlaybackService` が…当て直す」 【決め方：D6（未）】 |
| X13 | 再生 | マーカーの追従を PlaybackService が受け取れない（history は execute だけ） | PI:249／REF:403／PI:60 【決め方：D6（未）】 |
| X14 | 再生 | 読み込みに失敗した後の再生が食い違う。preWarm に読み直す口が無い | PI:76／PI:574／PI:72 【決め方：D6（未）】 |
| X15 | 画面群 | ツールバーが readiness とパートの数を受け取れない | PI:152／SN:368-371・400-401 【決め方：D6（未）】 |
| X16 | 再生 | PLAY-002 を出す所が無い（PlaybackSynth は作らない） | REF:401・321／PI:30 【決め方：D6（未）】 |
| X17 | 再生 | PlaybackSyncController がカーソルの位置を受け取れない | PI:314／PI:287-288、REF:291 【決め方：D6（未）】 |
| X18 | 再生 | 音量の範囲と指し先が違う | REF:325「`[0,1]`」／PI:421「0 から 100 の整数」／REF:329「§4.4」（今は 6.6 節） 【決め方：D1（未）】 |
| X19 | 画面群 | KeyboardShortcutRouter のシグネチャが 2 か所で違う | REF:320／SN:622-635 【決め方：D1（未）】 |
| X20 | 画面群 | 「入力欄では当てない」キーを表のデータで持てない | SN:640／SN:622-628・988-995 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| X21 | 画面群 | キーの表にマウスの操作が 3 つ混ざる（Router は keydown だけ） | SN:693／SN:661・662・665／SN:613 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| X22 | 画面群 | WindowManager の形が 2 か所で違う | REF:317／SN:104 【決め方：D1（未）】 |
| X23 | 画面群 | 13.1 節の Error の振り分けに FILE-001 ほかが入っていない | SN:1021／REF:355-397 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |
| X24 | データモデル | TrashService のシグネチャにコンストラクタが無い | DM:545-555／DM:561「コンストラクタで受け」／REF:205 【決め方：D1（未）】 |
| X25 | 製品化・Webコア基盤 | PlaybackSynth を作るかが逆・PDF を作る部品の名前・配線の追う先・指し先のずれ（4 件を 1 行に） | P1:33／PI:30／WC:1331 `PrintPipelineService`（EP は 0 件）／P1:33 の追う先／P1:19「15.9 節」 【決め方：印なし（受け持ちのパッケージを始めるターンで選ぶ）】 |

## 5. 作業用の AI が「本体が決めること」として挙げたもの（決めていない）

- O1・L1・O16：main から通知・ログを出す道を EL に足すか、SYS-005 と同じく renderer へ送る道に寄せるか
- T11：閉じるときの dispose は「プロセスが終わるので要らない」と決めてよいか
- T9・X12：PlaybackService・PlaybackSyncController・PlaybackMixerBinder の分担を一度に決め直すか
- L15：右クリックのメニューを main で組むか画面で出すか（基本設計 01 章も関わるので、要件から直すかは本人）
- L16・X19：00_reference.md 3 節を「今のコードの記録」として残すか、詳細設計に合わせて書き直すか
- T29：Phase 1 の書き出しの画面の欄をどこまで動かすか
- T28：D2 の表を P1 に節として作り直すか、G29・G36 の判定条件を今の設計書の行へ向け直すか
- O5：開いている曲の名前の変更を、曲一覧から開いている窓へ知らせるか、止めるか
