---
answering: 226
at: 2026-11-08T21:41:51+09:00
---

## 直した段落と扱い

| 段落 | 直したこと | 要求 | 対象外 | 照合 | 先送り |
|---|---|---|---|---|---|
| web-core-foundation.md:839（1ca76a68） | 審査対応の文を行の終わりに足した | 9 | 3 | 0 | 9（Phase 3（iPhone 版）） |
| data-model-persistence.md:519（ef5424f8） | DEFAULT_FLUSH_TIMEOUT_MS → FREEZE_CONFIRM_DELAY_MS | 15 | 4 | 14 | 1（作業パッケージ 8：保存ボタン） |
| screens-navigation.md:110（4022df52） | 同上 | 18 | 5 | 18 | 0 |
| 00_reference.md:318（3405ea3c） | constructor・resolve の条件・古い事実・決定の注 | 24 | 8 | 24 | 0 |
| error-logging-foundation.md:69（8ad1f1c7） | 古い事実の文を「今のコードもこの形」に | 17 | 5 | 17 | 0 |

- 318 行の「2026-10-29 本人決定 K4：`timeoutMs` は…」の注は日付の付いた記録なので書き替えていない（to-cc のとおり）。同じセルの終わりの注が「`timeoutMs` は無くした」と書くので、読む人には新旧が並んで見える
- bd-dd：13 章 K4（7cb5d52d.d792）の引用が 318 行の古い constructor を引いていたので照合し直し、一致

## 照合で一致しなかったもの（9 件、分類つき）

- 部分 7・下位を直す（作業パッケージ 8）：00_reference 3405ea3c の f89b・e947・109a、data-model ef5424f8 の 6084、screens-navigation 4022df52 の 483d・f29c・8489。どれも App.tsx の flush の受け口がすぐ ack を返し、`AutoSaveScheduler.flush` を呼んでいないため
- 不一致 2・上位を直す（245 番）：00_reference 3405ea3c の 972e（`ackRegistrar: { on(…) }`）と 115d（renderer→main send）。web-core-foundation.md:435 とコードは invoke・handle

## 対応タグ

- 頭だけの付け替え 30（3b8070a7→ef5424f8 が 13、49109fb1→8ad1f1c7 が 17）・新しく置いた 43（autoSaveFlushBridge.ts・CrashRecoveryController.ts・main.ts・WindowManager.ts・App.tsx・AutoSaveScheduler.ts・constants.ts）
- bd-dd：839 行に 10:224b4bce の 4 件と 10:666e2863.d098、870 行の 10:7b314e4a の 3 件を 666e2863 の同じ鍵に付け替え（.25be は文が「（4節）」→「（4.3節）」に替わった d098 に当てた）
- 印のコミットで prettier が `{` の後ろの注を次の行へ下ろした（autoSaveFlushBridge.ts +2 行・App.tsx +1 行）。引用の付け直しで 6 件を送った
- web-core-foundation.md に印だけを足した段落の hash が替わり、electron-builder.yml:78 の印を 53213bb1→68feba4b に付け替えた（tag-moves）
- 同じ型の数え直し：古い頭（datamodelpersistence:3b8070a7・errorloggingfoundation:49109fb1・10:7b314e4a）の印の残りは 0 件（spread.mjs scan）

## ワークフローと作業用の AI

| 回 | 件数 | AI の数 | トークン | 時間 |
|---|---|---|---|---|
| approve WCF 839 | 3 | 4 | 13.7 万 | 37 秒 |
| approve DM 519 | 4 | 4 | 13.8 万 | 42 秒 |
| approve SN 110 | 5 | 8 | 23.5 万 | 67 秒 |
| approve REF 318 | 8 | 11 | 29.2 万 | 92 秒 |
| approve EL 69 | 5 | 4 | 13.7 万 | 41 秒 |
| judge dd-impl | 73 | 7 | 56.9 万 | 232 秒 |
| judge bd-dd | 8 | 2 | 11.1 万 | 116 秒 |
| 作業用の AI 1（洗い出しの案 5 段落） | ― | 1 | 5.2 万 | 182 秒 |
| 作業用の AI 2（見直し・印の案） | ― | 1 | 14.7 万 | 327 秒 |

- 作業用の AI ごとの始めと終わりの時刻は控えていない（時間の長さだけ。道具の返り値から）
- ターン全体：21:07 始め → 21:41 終わり

## 使った量（context-report）

- 呼び出し 138 回・最後の会話の大きさ 26.2 万（始め 5 万）
- 読み直した量の合計 2230.8 万（キャッシュから 2207.1 万）
- 会話に足された量の上位 5：Read 4.2 万（16 回）・Bash の引数 2 万（128 回）・ledger next 1.8 万（6 回）・Write の引数 1.5 万（15 回）・ledger tag-check 1.3 万（5 回）
- 大きかったのは `next "dd-impl" all --phase decompose --ids-only --file "00_reference"`（1.4 万）。変わった段落の ID を引くのに範囲を絞らずに打った
