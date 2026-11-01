---
answering: 208
---

# turn 208 の詳細

## 1. 部品ごとの扱い（区切り 2、error-logging-foundation.md 2.3・2.4 節）

| 部品 | 扱い | テスト |
|---|---|---|
| CrashRecoveryController | 書き直し（窓の id ごと・loadURL・logFolder・reloadAfterRenderError・フリーズの 5 秒とダイアログ・detach） | UT-ERR-CRC-01〜16 を足した（番号の無い 7 件は残した） |
| WindowManager | 直し（窓を作るたびに attach、閉じたら detach、`ManagedWindow` に `native`） | UT-WIN-14〜16 |
| packages/ui-desktop/src/nativeText.ts | 新規（フリーズのダイアログの見出し・本文・ボタン、アプリ名） | 自前のテストのファイルは無い（ui-desktop に vitest のプロジェクトが無い）。文言は UT-ERR-CRC-11 で設計書の文と照らす |
| LogRingBuffer | 書き直し（LogEntry・200 件） | UT-ERR-RING-01〜06 |
| ipc.ts・ipcPayload.ts | registerLogHandlers を依存をまとめて渡す形に、registerSharedChangeHandlers を足した。parseLogEntry・parseSharedChangeNotice | IT-FS-IPC-28〜37 を足した、14〜17 を書き換えた |
| preload.ts | log・crash.onFreezeRecovered・app.openLogFolder・windows.reloadAfterRenderError・shared.notifyChanged/onChanged | 入口のファイル（しきい値の外） |
| errorLoggingBootstrap.ts・renderer/main.tsx | 依存を引数で受ける形に。呼ぶ所を createRoot より前へ（React の子の useEffect が先に走り、購読の順が逆になっていたため） | UT-ERR-BOOT-01〜13 |
| mainErrorLogger.ts・mainLogging.ts | 新規（main の書き口。process の購読と notify:fromMain の送りは区切り 3） | UT-ERR-MEL-01〜05・UT-ERR-MAINLOG-01〜10 |
| Logger.ts | setStore を足した（storage の知らせで書き先を替える） | UT-ERR-LOG-01〜03 |
| shared-types | CrashRecoveryState.logFolder・FREEZE_CHANNELS・APP_CHANNELS・NOTIFY_CHANNELS・SHARED_CHANNELS・SharedChangeNotice・WINDOW_CHANNELS.reloadAfterRenderError | — |

CC が自分で決めた細部：窓の分を消す口は `detach(windowId: number)`（閉じた後の窓には触らない）／起動時の URL は main frame の `did-navigate` で覚え、まだなら `getURL()`（did-navigate の url に最初のハッシュが入るかは未確認（推測）。確かめるには実アプリで要る）／クラッシュしたらフリーズのタイマーとダイアログを止める（UT-ERR-CRC-15）／ダイアログの title は ui-desktop の `APP_DISPLAY_NAME`（開発時の `app.getName()` が "@riff-line/desktop" になるため）／`app:openLogFolder` で `shell.openPath` が失敗したら場所を入れない文で reject／SharedChangeNotice の kind は data-model-persistence.md 12・13.1 節と screens-navigation.md 12.10 節から 7 つを集めた。

## 2. 先送りの一覧（このターンで足した分）

| 受け持ち | 数 | 例 |
|---|---|---|
| 作業パッケージ 3 区切り 3（2.5・2.6 節） | 16＋7＋6 | SYS-005 の行の 16 件（戻した分）、notify:fromMain の送り・型・送り先、reloadAfterRenderError を代わりの画面から呼ぶ、MainErrorLogger を main.ts で作る・mirrorSync の記録を通す |
| 作業パッケージ 9（Phase 1 完成・製品化 I1） | 7 | 77 行の復元手順 6 件（#edit/<songId>・SongRepository.load・songs/…tabapp・index.json の folder）、recovered のときの開き直し |
| 作業パッケージ 8（画面とナビゲーション） | 1 | 設定ダイアログの「アプリ情報」から app:openLogFolder を呼ぶ |
| Phase 2 の書き出し・印刷 | 1 | 印刷用の見えないウィンドウには attach を呼ばない |

申し送り：作業パッケージ 9 は phase1-productization.md 45 行「実装が詳細設計の全部の結線を持つ」に含まれると読み、1 文は足していない。作業パッケージ 8 は screens-navigation.md に app:openLogFolder の記述がある。

## 3. 照合で一致しなかったもの

| ID（末尾） | 判定 | 分類と受け持ち |
|---|---|---|
| elf 087863f3#k67f03 consumeRecoveryState の引数 | 部分 | 上位を直す（honnin-queue 226） |
| elf 8157cf58#k778e 実体の配置 | 部分 | 下位を直す：区切り 3 で main.ts に MainErrorLogger |
| elf e6bd7249#ke3c16 main のエラーは renderer を通さない | 部分 | 下位を直す：区切り 3 |
| elf a955fbc5#k1d0c notify:fromMain の向き | 部分 | 下位を直す：区切り 3 |
| elf 920e31e8#k9186 types.ts は re-export | 部分 | 下位を直す：区切り 3 で CrashRecoveryState を re-export に足す |
| dmp acec37bd・e95fc8c9×2・3ba7c17a | 部分 | 前からの分類のまま（移行の後の経路・.tabapp のダブルクリックの結線） |
| bd 12_traceability 9c5597a7#k7be0 | 部分（前は一致） | 下位を直す：作業パッケージ 4 で techniqueSuggestion.test.ts の行を 14.4 節へ |

## 4. 照合の回

| 回 | 段 | 件数 | AI の数 | トークン | 時間 |
|---|---|---|---|---|---|
| ダブルチェック 1 | dd-impl（00_reference 220-380） | 4 | 6 | 17.3 万 | 57 秒 |
| ダブルチェック 2 | bd-dd（11 章 109 行） | 5 | 8 | 20.9 万 | 59 秒 |
| 照合 1 | dd-impl | 262 | 20 | 184.8 万 | 15 分 23 秒 |
| 照合 2 | bd-dd | 38 | 5 | 38.7 万 | 3 分 11 秒 |

## 5. 次のターンへ回したもの

- dd-impl の引用切れ 53 件（web-core-foundation.md。ID は scratchpad の t208_carry_next_wcf.txt と、`recheck-evidence` で取り直せる）
- 00_reference.md 374 行の SYS-005 の照合 5 件、226 行の ErrorCodeDefinition の 14 件（タグもまだ）
- dd-it：web-core-foundation.md 14.4 節に足した 3 行（carry の toJudge 3）
- 食い違いとして報告だけしたもの：main.ts 24 行の注が古い／data-model-persistence.md 370 行の storageLock の始めと終わりを見分ける欄が無い／`fs:*` の受け口は storage を替えた後も起動時のアダプタのまま（範囲の外）

## 6. 時間の内訳

- ターンの始まり 16:32:56、報告を書く前の時刻 17:54:29（どちらも PC の時計）
- まとまりごとの始めと終わりの時刻は控えていない（未確認）。作業用の AI が動いた時間は道具が返した値：要求の一覧の見直し 5 分 4 秒・コード 1 13 分 34 秒・コード 2 17 分 12 秒・タグの案 6 分 7 秒・照合（dd-impl）15 分 23 秒・照合（bd-dd、並べて）3 分 11 秒・ダブルチェック 57 秒と 59 秒

## 7. 使った量（context-report.mjs）

- 呼び出し 177 回・最後の会話の大きさ 33.5 万（ピーク 33.5 万）・読み直した量の合計 3521.7 万
- 作業用の AI：記録 47・呼び出し 712 回・読み直し 7356.4 万
- 会話に足された量の上位 5：Read 5 万（23 回）・Bash の引数 2.5 万（130 回）・ledger reanchor 2 万（7 回）・ledger next 2 万（4 回）・Grep 1.9 万（35 回）
- 区切りの切れ目（§2 の後）で 20.8 万。25 万の手前だったので区切り 2 に入った。終わりには 33.5 万
