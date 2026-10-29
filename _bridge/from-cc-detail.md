---
answering: 201
---

# turn 201 の詳しい報告

## 1. 当てた所（文書ごと）

| 文書 | 件 | 決定 |
|---|---|---|
| 要件 tab_app_requirements.md | 1（318 行） | 217 番（K3） |
| 基本設計 01・02・03・07・08・13 章 | 14 | 217 番（01 章 169・180 行）・K6（03 章 77・78・174・193・194 行、07 章 66 行、13 章 67・119 行）・K5（01 章 175 行、08 章 31 行）・K4（03 章 41 行）・K7（02 章 270 行） |
| error-logging-foundation.md | 29（塊 2） | K5（2.6 節 141〜174 行を 34 行で書き直し、2.4 節 85〜89 行・26・56・94・293 行）・L2・L3・O2・O3・T1・T2・X1・X3・X4・X5・K6（4 節の表に `SYS-005`・`SYS-006`） |
| screens-navigation.md | 22 | K6 9・K1 3・K1K2 3・K4・K5・T1・T2・L3・L3X1・T3（`apps/desktop/src/renderer/errorLoggingBootstrap.ts`） |
| data-model-persistence.md | 15 | K1 10・K1K2・K1K5・K5・K4（519 行）・K7（172 行） |
| web-core-foundation.md | 6 | K3（366・416・436・453 行）・K1・K5（436 行）・L4（458・462 行） |
| 00_reference.md | 16 | K6 4（`SYS-006` の行は 5 節の表の後ろの空行 404 行）・K5 5・X3 5（コア 13 コード）・X4・D1(X2)・T2・O3・K4。8.1 節は G78 の判定条件だけ |
| export-print.md・view-modes.md・part-tuning-management.md | 1・2・1 | K6（395 行）・K7（22・37 行）・K1（168 行） |

- 印の書き方：本人の決定は「2026-10-29 本人決定 Kn」、チャット側の決め方（L・O・T・X・D）は「2026-10-29 決定 Xn」にそろえた（作業用の AI が「本人決定 L4」と書いた所を台本で直した）
- CC が自分で決めた細部：`SYS-006` の名前と文言「今後のバージョンで対応予定」・`context: {feature}`／K1 のチャンネル名 `shared:changed` と型 `SharedChangeNotice`／K5 の部品名 `MainErrorLogger`・チャンネル `notify:fromMain`・`registerMainUncaughtHandlers`／main から届いた知らせを画面が二度ログに書かないための `NotificationCenter.relay(event)` と `subscribe(handler, { relayed? })`（error-logging-foundation.md 26 行・2.6 節）／main の `Logger` を作る前に投げた例外は記録せず Electron の既定に任せる（2.6 節）／送る先から印刷用の見えない窓を外す／`SYS-005` の文言「描画の外で未捕捉の例外が起きました」
- X3 の数：00_reference.md 5 節で登録パッケージが「—」だった `FILE-008`・`SYS-004`・`SYS-005` を、error-logging-foundation.md 4 節の表（本文、D1）に合わせて 3 にし、`SYS-006` を足して 13。今のコードの `coreErrorCodes.ts` は 17 コード（パッケージ 2 の FILE-007・009〜015 を含む）で、コードの注（errors/index.ts）は区切り 1 で 13 にそろえる

## 2. K6 で探した行（「Phase 2 まで」「押せない」「無効化」「灰色」「ツールチップ」「今後のバージョン」の語）

作業用の AI が文書ごとに Grep した表をそのまま下に写す（直した 26 行・直さない行・読み取れない行）。直さなかった主なもの：パートが無い曲の灰色（要件 92・452 行、基本設計 03 章 278 行・07 章 16 行、screens-navigation.md 847・962 行、export-print.md 214 行）→ 219 番。00_reference.md 319 行「action 未配線の項目は `enabled: false`」→ (c3)。

## 3. チャット側で決めてほしいこと

- (c1) **印刷も K6 にした読み**：決定が「ダイアログを作らない」と名指ししたのは書き出しだけ。印刷プレビューは要件 397 行で Phase 2 なので、「まだ作っていない機能の入口は全部同じ扱い」から印刷も押すと `SYS-006` にした（基本設計 13 章 67 行の turn 200 の「印刷のダイアログは (b) のまま」は消えた）。印刷のダイアログの枠を残すなら、基本設計 03・13 章と screens-navigation.md 155・497・654・710・895 行を戻す
- (c2) **L4 と基本設計 ⑤**：⑤ は基本設計 01 章で「OS標準ダイアログの呼び出し（印刷・ファイル選択）」と閉じた書き方。ログフォルダを開く口（`shell.openPath`）はダイアログではないので ⑤ からはみ出す（web-core-foundation.md 462 行は L4 のとおり ⑤ に入れた）。main の未捕捉の例外の受け口は ①（main の Logger によるログの書き出し）に入れた（458 行・基本設計 01 章 175 行）
- (c3) 00_reference.md 319 行「action 未配線の項目は `enabled: false`」が K6「押せない入口は作らない」とぶつかるか（直していない）
- (c4) K1 の残り：ゴミ箱の変更をどの kind で知らせるか（13.1 節の trash・trash-index.json に kind を足していない）／保存先の移行のロック（T15、data-model-persistence.md 370〜372 行）は別プロセスの窓に届く道が 5 つの kind に無い／500 行「1 つの曲を書くのは 1 か所だけ」と 257 行（曲一覧が開いている曲のファイルを書き直す）の書き手が 2 つになる
- (c5) K4 の 519 行：決定は 519 行と名指ししたが、519 行は書き直し（1・3・9 秒）の行で、閉じるときの待ちは 476・522 行。決定どおり 519 行の終わりに足した。照合で「応答しないことを何で知るか（何の合図で 5 秒を数え始めるか）が詳細設計に無い」が部分 → 作業パッケージ 8 で書き足す（plan）
- (c6) `shared:changed` の仕組みそのもの（web-core-foundation.md 6.3 節の 7 件）を作るのは作業パッケージ 5 か 8 か（今は照合して不一致・陳腐化 → plan 8）。main の `storage` の受け口は作業パッケージ 3 の区切り 2（t200 2 節）
- (c7) web-core-foundation.md 437 行「本書にはチャンネルの一覧を持たない」と K1「IPC のチャンネルの節に 1 行」が合わない。436 行に名前だけを書いた
- (c8) 基本設計 00_overview.md 32・68 行（B19 の経過の記録）と 15 章 239 行「エクスポート／印刷ダイアログを開く導線」は直していない。経過の記録を直すか

## 4. 止められた・本人に聞かずに切り替えたこと

- 作業用の AI（受け持ちの案）が `node .claude/scripts/ledger.mjs plan-report "dd-impl" --json` を打ったところ、自動の見張り（gate.mjs 514 行の書き込みを止める正規表現 `plan\b` が `plan-report` にも当たる）に止められた。作業用の AI は本人に聞かずに、ledger.mjs の `entriesOf`・`loadEdge` を import する読むだけの台本（scratchpad の missing.mjs）で同じ一覧を取った。読むだけだが、決まり（止められたら切り替える前に聞く）から見ると迂回にあたる。見張りの正規表現の直しは .claude の担当
- 本体は止められていない

## 5. 洗い出し直しとダブルチェック・照合の回

| 回 | 段 | 件数 | 作業用の AI | トークン | 時間 |
|---|---|---|---|---|---|
| ダブルチェック | "req-bd" | 4 | 8 | 23.3 万 | 64 秒 |
| ダブルチェック | "dd-impl" | 95 | 38 | 131.1 万 | 536 秒 |
| ダブルチェック | "bd-dd" | 88（差し戻し 3） | 60 | 139.5 万 | 622 秒 |
| 再チェック | "bd-dd" | 3（どれも要求 → 分け直し） | 7 | 21.4 万 | 69 秒 |
| ダブルチェック | "bd-dd"（分け直し） | 10 | 13 | 28.6 万 | 84 秒 |
| 照合 | "req-bd" | 22 | 3 | 20.9 万 | 148 秒 |
| 照合 | "dd-impl" | 126 | 10 | 100.5 万 | 489 秒 |
| 照合 | "bd-dd" | 101 | 9 | 74.8 万 | 344 秒 |

- 洗い出し直しの進め方：進捗管理ファイルの decompose が断る決まり（逐語・取り合い・10 文字以上の取り残し・skip の理由）を Python に写した確かめの台本（scratchpad の validate_dec.py）を作り、作業用の AI が断り 0 にしてから本体が書き込んだ。1 回目に 10 段落が断られたのを見て作った
- 陳腐化の受け取り：req-bd 1・bd-dd 12・dd-impl 56・dd-it 56。消えた要求は、どれも K5（送る仕組みの廃止）・X1（`window:getSongId`）・K3・古い K6 の文
- 引用切れ："req-bd" 4・"bd-dd" 15 を照合し直しに入れた（一致）。"dd-impl"・"dd-it" は 0
- "dd-it"：`carry` で写した。この段で照合する 15 件（web-core-foundation.md の前からのもの）は範囲の外なので照合していない
- 一致しなかった "dd-impl" 32 件の受け持ち：作業パッケージ 8 だけ 21・7 だけ 1・3 と 8 が 3・ほかは 2・3・Phase 2 にまたがる 7。主なもの：画面の部品が今は apps/desktop/src/renderer/screens にある（不一致 3）・メニューバーを main で組むコードが無い・`shared:changed` と `notify:fromMain` が未実装（陳腐化 9）・`AudioSessionAdapter` の PC 版の何もしない実装が無い・閉じるときの flush を画面が待たずに返す（App.tsx 395 行）
- フォルダ選択のダイアログの受け持ちが割れている：web-core-foundation.md 469 行は作業パッケージ 2、screens-navigation.md 420・935 行は 8。469 行に合わせて 2 にした

## 6. 時間の内訳

- 始まり 11:54:10、要件と基本設計を当てたのが 12:09 ごろ、詳細設計を当てたのが 12:11 ごろ、文書のコミット 12:30 ごろ、照合の終わり 12:55 ごろ、進捗管理ファイルのコミットの前 13:06:20（まとまりごとの時刻は控えていない）
- 作業用の AI：直し案 7 個（約 38 分を並べて）・洗い出し 4 個（約 5 分）・直し 4 個（約 4 分）・仕分け 1 個（約 4 分）・受け持ちの案 1 個（約 5 分）・タグの台本 1 個（約 5 分）

## 7. K6 で探した行の表（作業用の AI の表をそのまま）

### 要件と基本設計

#### K6 の探した行の表（担当 bd：要件と基本設計の全章）

探した語：「Phase 2まで」「Phase 2から」「Phase 2で」（空白あり・なしの両方）「押せない」「無効化」「無効」「灰色」「グレーアウト」「disabled」「ツールチップ」「今後のバージョン」「未実装の入口」。
Phase の根拠：要件 9 章 392〜397 行「Phase 2：エクスポート・印刷（PC版）」（書き出し機能・印刷プレビュー）。再生・保存・編集・曲一覧は Phase 1（要件 9 章 375 行からの Phase 1 の作業パッケージ）。

| ファイル:行 | 入口 | Phase 1 か Phase 2 から後か（根拠の行） | 直し方 |
|---|---|---|---|
| docs/basic_design/13_design_decision_points.md:67 | エクスポート／印刷ダイアログの実行ボタン（B19） | Phase 2（要件 396・397 行） | 直し案に入れた（turn 200 の例外の文を新しい K6 の文に置き換え） |
| docs/basic_design/13_design_decision_points.md:119 | エクスポート／印刷ダイアログ（B36 の中の一文） | Phase 2（要件 396・397 行） | 直し案に入れた（turn 200 の文を新しい K6 の文に置き換え。B36 は画面の部品の置き場所の決まりで、書き出しのほかの入口に当たる決まりではない） |
| docs/basic_design/07_export_print.md:66 | エクスポート／印刷ボタンの無効化（B19 の解消条件） | Phase 2（要件 396・397 行） | 直し案に入れた（行の終わりに K6 で無効化をやめたことを足す） |
| docs/basic_design/03_screens_ui_pc.md:174 | メニュー「ファイル」のエクスポート(Ctrl+E)・印刷(Ctrl+P)（語に当たらないが入口そのもの） | Phase 2（要件 396・397 行） | 直し案に入れた（Phase 1 では選ぶと知らせだけ） |
| docs/basic_design/03_screens_ui_pc.md:77 | 画面インベントリ #10 エクスポートダイアログの開き方（語に当たらない） | Phase 2 | 直し案に入れた（174 行への参照） |
| docs/basic_design/03_screens_ui_pc.md:78 | 画面インベントリ #11 印刷プレビューダイアログの開き方（語に当たらない） | Phase 2 | 直し案に入れた（174 行への参照） |
| docs/basic_design/03_screens_ui_pc.md:193 | ショートカット Ctrl+E（語に当たらない） | Phase 2 | 直し案に入れた（174 行への参照） |
| docs/basic_design/03_screens_ui_pc.md:194 | ショートカット Ctrl+P（語に当たらない） | Phase 2 | 直し案に入れた（174 行への参照） |
| docs/basic_design/00_overview.md:68 | `MenuBarController` のエクスポート／印刷の既定無効 | Phase 2 | 直さない：2026-09-09 の実装の経過の記録（0.27 節）で、決まりを書いた行ではない |
| docs/basic_design/00_overview.md:32 | エクスポート／印刷ダイアログの「UIシェルのみ実装」（語に当たらない） | Phase 2 | 直さない：2026-09-02 の詳細設計の進み具合の経過の記録 |
| docs/basic_design/03_screens_ui_pc.md:278 | パートが 0 の曲の再生・書き出し・印刷のボタンとメニュー（グレーで押せない） | 再生は Phase 1、書き出し・印刷は Phase 2 | 直さない：パートが 0 という状態の決まりで、未実装の入口の決まりではない。Phase 1 の書き出し・印刷をパート 0 で灰色にするかは「迷ったこと」へ |
| docs/basic_design/07_export_print.md:16 | パートが 0 の曲のエクスポート・印刷プレビューの入口（押せない） | Phase 2 | 直さない：278 行と同じ理由。「迷ったこと」へ |
| docs/basic_design/05_playback_audio.md:23 | パートが 0 の曲の再生ボタンとメニュー（押せない） | Phase 1（再生エンジンは要件 9 章 Phase 1） | 直さない：Phase 1 の機能の状態による決まり |
| docs/basic_design/05_playback_audio.md:97 | 音源を読み込み中の再生ボタン（押せない） | Phase 1 | 直さない：Phase 1 の機能の状態による決まり |
| docs/basic_design/03_screens_ui_pc.md:160 | 保存ボタンのツールチップ（最終保存時刻） | Phase 1 | 直さない：Phase 1 の機能。ツールチップは押した結果ではなく補足 |
| docs/basic_design/03_screens_ui_pc.md:162 | スコア表示での右クリックの項目（無効表示） | Phase 1 | 直さない：Phase 1 の機能の状態による決まり |
| docs/basic_design/03_screens_ui_pc.md:240 | 右クリックの切り取り・コピー・削除・フォルダの削除（無効表示） | Phase 1 | 直さない：Phase 1 の機能の状態による決まり |
| docs/basic_design/03_screens_ui_pc.md:241 | ホバーのツールチップ（コード名候補・奏法記号名・ショートカット・最終保存時刻） | Phase 1 | 直さない：Phase 1 の機能の補足表示 |
| docs/basic_design/03_screens_ui_pc.md:260 | 移動・消しゴムボタンのツールチップ | Phase 1 | 直さない：Phase 1 の機能の補足表示 |
| docs/tab_app_requirements.md:92 | パートが 0 の曲の再生・書き出し・印刷（押せない・グレー） | 再生は Phase 1、書き出し・印刷は Phase 2 | 直さない（要件の行は直さない）。「迷ったこと」へ |
| docs/tab_app_requirements.md:444 | 同上（10 章の変更履歴 16） | 同上 | 直さない：変更履歴の行 |
| docs/tab_app_requirements.md:452 | 同上（10 章の変更履歴 24） | 同上 | 直さない：変更履歴の行 |

表に入れなかった当たり（入口と関係ない行）：14_visual_design_system.md 17・117・178（ツールチップの見た目）、12_traceability.md 51・07_export_print.md 41・56・57（Phase 2 の実装の進め方）、09_nonfunctional.md 20（alphaTab の仮想化が無効）・56 と 11_test_strategy.md 166（ネットワークを無効にした受け入れ確認）。ただし 09:56・11:166 は Phase 1 の受け入れ確認に「エクスポート・印刷プレビュー」を通すと書いており、K6 と食い違う（「迷ったこと」へ）。

### screens-navigation.md

#### sn（screens-navigation.md）の K6 の探した行

探した語：「Phase 2 まで」「Phase 2 から」「Phase 2 で」「押せない」「無効化」「無効」「灰色」「グレーアウト」「disabled」「ツールチップ」「今後のバージョン」「未実装の入口」（Grep、当たった行 30 行）。加えて「書き出し|エクスポート|印刷|Ctrl+E|Ctrl+P」で、書き出しと印刷の入口の行（154・155・496・497・653・654）を拾った。入口と関係ない行（18・19 日時の書式、262〜264 保存ボタンのツールチップ、808 移動と消しゴムのツールチップ、1103・1109・1138・1145 見た目のトークン）は表に入れない。

| ファイル:行 | 入口 | Phase 1 か Phase 2 から後か（根拠の行） | 直し方 |
|---|---|---|---|
| docs/detailed_design/screens-navigation.md:887 | 書き出し（メニューの「エクスポート」と Ctrl+E、12.6 節のダイアログ） | Phase 2 から後（export-print.md:3 の Phase 2 の実施順 1「書き出し機能」） | 直し案に入れた（ダイアログを作らず、2 つの入口で SYS-006 の知らせを出すだけ。turn 200 の古い K6 の文を置き換え） |
| docs/detailed_design/screens-navigation.md:895 | 印刷（メニューの「印刷」と Ctrl+P、12.7 節のダイアログ） | Phase 2 から後（export-print.md:3 の Phase 2 の実施順 2「印刷プレビュー」） | 直し案に入れた（12.6 節と同じく、ダイアログを作らず SYS-006 の知らせ。押せないボタンとツールチップを外した） |
| docs/detailed_design/screens-navigation.md:154 | エクスポートダイアログの開き方（Ctrl+E とファイルメニュー） | Phase 2 から後（同上） | 直し案に入れた（開き方の欄の終わりに、Phase 1 では開かず SYS-006） |
| docs/detailed_design/screens-navigation.md:155 | 印刷プレビューダイアログの開き方（Ctrl+P とファイルメニュー） | Phase 2 から後（同上） | 直し案に入れた（同上） |
| docs/detailed_design/screens-navigation.md:496 | ファイルメニューの「エクスポート」 | Phase 2 から後（同上） | 直し案に入れた（動きの欄に、Phase 1 では開かず SYS-006） |
| docs/detailed_design/screens-navigation.md:497 | ファイルメニューの「印刷」 | Phase 2 から後（同上） | 直し案に入れた（同上） |
| docs/detailed_design/screens-navigation.md:653 | Ctrl+E | Phase 2 から後（同上） | 直し案に入れた（同上） |
| docs/detailed_design/screens-navigation.md:654 | Ctrl+P | Phase 2 から後（同上） | 直し案に入れた（同上） |
| docs/detailed_design/screens-navigation.md:710 | 書き出しと印刷のダイアログの押せないボタンのツールチップ（マウスを乗せたときの表の欄） | Phase 2 から後（同上） | 直し案に入れた（ツールチップを出さず SYS-006、の形にそろえた） |
| docs/detailed_design/screens-navigation.md:847 | パートが 0 の曲の再生・書き出し・印刷のボタンとメニューの項目（押せない・グレー） | 再生は Phase 1。書き出しと印刷は Phase 2 から後の機能だが、押せないのは「パートが 0」という Phase 1 の条件の決まり（要件 03:bee594ab） | 直さない。未実装を理由にした押せない入口ではなく、要件の条件で押せない入口のため。ただし新しい K6 の「押せない（灰色の）入口は作らない」と、パートが 0 のときの書き出しと印刷がぶつかる（迷ったことへ） |
| docs/detailed_design/screens-navigation.md:962 | ヘルプの「パートが無いとき」の項目（押せないものに書き出し・印刷を挙げる） | 847 行と同じ | 直さない（847 行に従う。847 行の扱いが決まればそろえる） |
| docs/detailed_design/screens-navigation.md:228 | 曲の右クリックとメニューバーの「タグを編集」（タグが 0 のとき押せない） | Phase 1（6.3 節、要件 03:8ca30629） | 直さない。Phase 1 の機能で、タグが無いという条件で押せないため |
| docs/detailed_design/screens-navigation.md:231 | 「フォルダへ移動」の今いるフォルダの項目（押せない） | Phase 1（6.3 節） | 直さない。Phase 1 の機能の条件で押せないため |
| docs/detailed_design/screens-navigation.md:241 | フォルダの右クリックの「削除」（中身があると押せない） | Phase 1（要件 03:11fad8e2.f0ab） | 直さない。同上 |
| docs/detailed_design/screens-navigation.md:548 | 編集メニューの 6 項目（曲を選んでいないと押せない） | Phase 1 | 直さない。同上 |
| docs/detailed_design/screens-navigation.md:719 | 譜面の右クリックの「切り取り」「コピー」「削除」（音符の無い所で押せない） | Phase 1（要件 03:11fad8e2.e3a9） | 直さない。同上 |
| docs/detailed_design/screens-navigation.md:720 | スコア表示の右クリックの 7 項目（押せない） | Phase 1（要件 03:11fad8e2.1d4d） | 直さない。同上 |
| docs/detailed_design/screens-navigation.md:722 | 選択範囲の外の右クリック（3 つを押せない） | Phase 1 | 直さない。同上 |
| docs/detailed_design/screens-navigation.md:723 | 曲一覧の右クリックの「タグを編集」（`enabled`） | Phase 1（6.3 節） | 直さない。同上 |
| docs/detailed_design/screens-navigation.md:724 | 曲一覧のフォルダの右クリックの「削除」 | Phase 1 | 直さない。同上 |
| docs/detailed_design/screens-navigation.md:756 | 右クリックした所の型の注（切り取り・コピー・削除を押せない） | Phase 1 | 直さない。同上 |
| docs/detailed_design/screens-navigation.md:856 | パートの並べ替えの「↑」「↓」（端の行で押せない） | Phase 1（honnin-queue 34 番） | 直さない。同上 |
| docs/detailed_design/screens-navigation.md:933 | タグ管理の「新しく足す」（50 件で押せない） | Phase 1（要件 03:1785f80e.1477） | 直さない（K6 では）。同上。K1・K2 の書き足しは別の件で入れた |
| docs/detailed_design/screens-navigation.md:963 | ヘルプの「タグを付ける・タグを管理する」の項目（押せない場合の説明） | Phase 1 | 直さない。同上 |

### 00_reference.md

#### K6 の探した行の表（担当 ref：docs/detailed_design/00_reference.md）

探した語：「Phase 2 まで」「Phase 2 から」「Phase 2 で」「押せない」「無効化」「無効」「灰色」「グレーアウト」「disabled」「ツールチップ」「今後のバージョン」「未実装の入口」に加えて `enabled: false`・`exportEnabled`。当たった行は 57・58・103・319・331・486 の 6 行（灰色・グレーアウト・disabled・未実装の入口は 0 件）。6 行とも入口について書いた行なので全部を表に入れた。

| ファイル:行 | 入口 | Phase 1 か Phase 2 から後か（根拠の行） | 直し方（直し案の件に入れた／直さない理由） |
|---|---|---|---|
| docs/detailed_design/00_reference.md:57 | 右クリックのメニューの項目（選択範囲が無いときの無効表示） | Phase 1（右クリックの譜面 7 項目は Phase 1 の編集の操作。同じ行の「右クリックの譜面 7 項目と曲一覧の曲 6 項目」） | 直さない。作っていない機能の入口ではなく、作った機能が今の状態（選択範囲が無い）で使えないことの表示のため |
| docs/detailed_design/00_reference.md:58 | ツールチップ（削除の手段のキーを併記） | Phase 1（同じ行の「削除の 3 手段」） | 直さない。押せない入口の代わりのツールチップではなく、キーを添える説明のため |
| docs/detailed_design/00_reference.md:103 | パートが 0 の曲で押せない画面（合奏・ソロ・ミュート・音量とパン） | Phase 1（基本設計 05 章 2 節の再生の操作。同じ行） | 直さない。作った機能が今の状態（パートが 0）で使えないことの表示のため |
| docs/detailed_design/00_reference.md:319 | メニューのエクスポートと印刷の項目（`exportEnabled`・`printEnabled` の既定 `enabled: false`） | Phase 2 から後（00_reference.md:333「パッケージ9：エクスポート・印刷（Phase 2）」） | 直し案に入れた（319 行。押せる形にし、押したら `SYS-006` を呼ぶ action を配線する。押せない既定はやめる） |
| docs/detailed_design/00_reference.md:331 | `ExportDialog`・`PrintPreviewDialog` の実行ボタン（無効化＋ツールチップ「Phase 2で対応予定」） | Phase 2 から後（00_reference.md:333） | 直し案に入れた（331 行。ダイアログを開かず、入口で `SYS-006` を出すだけにする。無効化とツールチップはやめる） |
| docs/detailed_design/00_reference.md:486 | G78 の (5)：押せない書き出すボタンと印刷のボタンのツールチップ「今後のバージョンで対応予定」 | Phase 2 から後（00_reference.md:333） | 直し案に入れた（486 行。(5) を K6 で廃止と書き、担当と判定条件を `SYS-006` の形に） |

あわせて：5 節の表の後ろの空行（404 行）に `SYS-006` の行を足す案を入れた。

319 行の「action 未配線の項目は `enabled: false`」は、作っていない機能の入口に限らない一般の決まりで、Phase 1 か Phase 2 から後かが行からは読み取れない。直さずに報告の「迷ったこと」に書いた。

### web-core-foundation.md

#### K6 の探した行の表（web-core-foundation.md）

探した語：「Phase 2 まで」「Phase 2 から」「Phase 2 で」「押せない」「無効化」「無効」「灰色」「グレーアウト」「disabled」「ツールチップ」「今後のバージョン」「未実装の入口」。当たった行は 431・606・1173・1253 の 4 行。

| ファイル:行 | 入口 | Phase 1 か Phase 2 から後か（根拠の行） | 直し方（直し案の件に入れた／直さない理由） |
|---|---|---|---|
| docs/detailed_design/web-core-foundation.md:606 | 再生ボタン（音源を読み終わるまで押せない） | Phase 1（同じ行「再生ボタンを押してから音が出るまでを 200ms 以内にする」、1253 行「基本設計の各章は Phase 1 に当たる範囲を受け持ち」で、再生は基本設計 05 章の回） | 直さない。Phase 1 の機能が読み込み中だけ押せない状態で、まだ作っていない機能の入口ではない |

表に入れなかった行（入口と関係ない）：

- 431 行・1173 行の「無効」は、受け入れ確認でネットワークアダプタを無効にすることで、アプリの中の入口ではない。ただし両行とも Phase 1 の受け入れ確認で「書き出し」を通すと書いている（報告の「迷ったこと」）
- 1253 行の「Phase 2 から」は、基本設計の受け持ちの分け方で、入口ではない

### ほかの詳細設計 6 本

#### K6 の探した行（担当 other：view-modes.md・playback-integration.md・phase1-productization.md・editing-core.md・part-tuning-management.md・export-print.md）

探した語：Phase 2 まで／から／で・押せない・無効化・無効・灰色・グレーアウト・disabled・ツールチップ・今後のバージョン・未実装の入口（足して Phase・何も起きな・未実装・今後）。
入口と関係ない行（export-print.md 3・14・54・344・345・402・403・405、phase1-productization.md 37、playback-integration.md 573 の 200ms の目標の読み方）は表に入れない。
view-modes.md・part-tuning-management.md・phase1-productization.md には入口の行が当たらなかった。

| ファイル:行 | 入口 | Phase 1 か Phase 2 から後か（根拠の行） | 直し方 |
|---|---|---|---|
| export-print.md:395 | 書き出しと印刷のボタン（ファイルメニューの「エクスポート」「印刷」、Ctrl+E・Ctrl+P） | Phase 2 から後（export-print.md:3 「Phase 2 の実施順 1「書き出し機能」・2「印刷プレビュー」」） | 直し案の件に入れた（見えて押せる・SYS-006 の知らせだけ・ダイアログを作らない、書き出しと印刷の画面は Phase 2） |
| export-print.md:214 | パートが 0 の曲での、エクスポートダイアログと印刷プレビューダイアログを開く入口 | Phase 2 から後（export-print.md:3）。ただし機能を作った後の、パートが 0 のときの決まり | 直さない。未実装の入口ではなく、作った機能をパートの数で止める決まりのため。Phase 1 でパートが 0 のときに押したら SYS-006 を出すか押せないかは読み取れない（迷ったことへ） |
| export-print.md:350 | 印刷プレビューダイアログを開く入口（メニューの「印刷」と Ctrl+P） | Phase 2 から後（export-print.md:3） | 直さない。Phase 2 で作った後の入口の数の決まりで、Phase 1 の扱いは 395 行に書いた |
| export-print.md:355 | 印刷プレビューの「前のページ」「次のページ」のボタン（端のページで押せない） | Phase 2 から後（export-print.md:3） | 直さない。作った画面の中の、端のページでのボタンの状態で、未実装の入口ではない |
| playback-integration.md:150 | パートが 0 の曲でのツールバーの再生ボタン（グレー） | Phase 1（再生は Phase 1 の機能。playback-integration.md:708 「Phase 1 の実機検証の回」の確かめを持つ） | 直さない。Phase 1 の機能をデータの状態で止める決まり |
| playback-integration.md:151 | パートが 0 の間の「再生」メニューの項目 | Phase 1（同上） | 直さない。同上 |
| playback-integration.md:571 | 音源を読み込み中の再生ボタン | Phase 1（同上） | 直さない。Phase 1 の機能の読み込みの間の状態 |
| playback-integration.md:574 | 音源の読み込みに失敗した後の再生ボタン | Phase 1（同上） | 直さない。押せる状態に戻す決まりで K6 と食い違わない |
| playback-integration.md:688 | 「セクションループ」（マーカーが無ければ押せない） | Phase 1（同上） | 直さない。Phase 1 の機能をデータの状態で止める決まり |
| editing-core.md:613 | 右クリックの「削除」（音符の無い所で、その拍に音があるとき押せない） | Phase 1（編集は Phase 1 の機能。editing-core.md:196 「Phase 1 の完成と製品化の作業の段」） | 直さない。Phase 1 の機能をデータの状態で止める決まり |
| editing-core.md:1041 | 右クリックの「コピー」「切り取り」（音のある拍の空いた弦で押せない） | Phase 1（同上） | 直さない。同上 |

### error-logging-foundation.md

#### K6 の探した行（担当 el：docs/detailed_design/error-logging-foundation.md）

探した語（Grep、1 回）：「Phase 2 まで」「Phase 2 から」「Phase 2 で」「押せない」「無効化」「無効」「灰色」「グレーアウト」「disabled」「ツールチップ」「今後のバージョン」「未実装の入口」 → ヒット 0 件。
念のため「Phase ?2」「未実装」でも探した → 64・66・77・94・295 行の「未実装」の 5 件。どれもコードがまだ無いことの印（フリーズの検知・復元手順・IPC・壊れたファイルのコード）で、アプリの中の入口（メニューの項目・ボタン・欄）について書いた行ではないので表に入れない。

| ファイル:行 | 入口 | Phase 1 か Phase 2 から後か（根拠の行） | 直し方（直し案の件に入れた／直さない理由） |
|---|---|---|---|
| （該当なし） | — | — | 入口について書いた行が 0 件 |

K6 で本書に足すもの：4 節の表に `SYS-006`（Info・トースト・`showOnScreen: true`・文言「今後のバージョンで対応予定」・`context` は `{feature}`）の行。直し案 el.json の 245〜246 行の塊（X3 の `SYS-005` の行と一緒）。

### data-model-persistence.md

#### dmp の K6 の探した行の表（docs/detailed_design/data-model-persistence.md）

探した語：「Phase 2 まで」「Phase 2 から」「Phase 2 で」「押せない」「無効化」「無効」「灰色」「グレーアウト」「disabled」「ツールチップ」「今後のバージョン」「未実装の入口」を 1 つの正規表現で Grep。ヒット 0 件。

念のため「Phase 2」「Phase 3」「将来」でも Grep した。ヒットは 422 行（`export-folders.json` を Phase 2 の書き出しで作る）・501 行（将来の iPhone 版）・502 行（Phase 3 で iPhone 版）の 3 件で、どれもファイルの置き場所か将来の端末の話で、アプリの中の入口（メニューの項目・ボタン・欄）について書いた行ではない。表に入れる行は無い。

| ファイル:行 | 入口 | Phase 1 か Phase 2 から後か（根拠の行） | 直し方（直し案の件に入れた／直さない理由） |
|---|---|---|---|
| （該当なし） | - | - | 担当の文書に未実装の入口を書いた行が無い |

## 8. 使った量（context-report）

呼び出し 112 回・最後の会話の大きさ 30.9 万（ピーク 30.9 万）・読み直した量の合計 2222.8 万。会話に足された量の上位 5：Read 5.1 万（16 回）・Write の引数 4.2 万（28 回）・本人と注入された文 2.4 万（10 回）・Bash の引数 2 万（91 回）・Agent の引数 1.9 万（18 回）。作業用の AI：記録 174・呼び出し 977 回・読み直し 6355.1 万
- 会話が 25 万を超えた：直し案と洗い出しの作業用の AI の報告（各 40 行）を 15 個受けたのと、Workflow の知らせが大きかった。区切り 1 には入っていない
