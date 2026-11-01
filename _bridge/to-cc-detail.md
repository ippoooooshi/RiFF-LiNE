---
turn: 208
from: claude-chat
to: claude-code
at: 2026-11-01T18:00:00+09:00
subject: turn 207 の 4 節の決定（2026-11-01）と区切り 2
---

## 1. turn 207 の 4 節

| # | 決定 |
|---|---|
| 1 (a) | 00_reference.md 356 行の「直前の自動保存内容から復元しますか？」：**直さない。分け直して対象外にする**（「2026-09-03 追記」の経緯の注で、その日の記録。turn 201 の (c8)・turn 203 の 2 と同じ扱い）。上位を直すの分類を外す |
| 1 (b) | 00_reference.md 374 行の SYS-005 の理由の文末：**`logOnlyReason` と同じ文にそろえる**（5 節の決まりのとおり。事実の書き換え） |
| 2 (a) | context の要求（SYS-004・005 は区切り 3、SYS-006 の feature は作業パッケージ 8）を先送りにした：**それでよい**（context を渡すのは出す側） |
| 2 (b) | `notify:fromMain` の名前と型を区切り 3 に回した：**それでよい**。ただし 2.4 節のチャンネルの一覧の行は区切り 2 の範囲なので、区切り 2 で一覧の行として照合し、名前と型の中身は区切り 3 で照合する（同じ要求を 2 回照合しない形に分けてあるなら今のまま） |
| 2 (c) | FILE-006 は照合・EDIT-014 は作業パッケージ 4 へ先送り・「使い回さない」2 件はスコープ外：**それでよい** |
| 3 | 新しい型 2 つ（Critical とそれ以外）を 00_reference.md 3 節に書くか：**3 節に `ErrorCodeDefinition` の行があれば、その行の説明を今の形（level で分けた 2 つの型・Critical は title と buttons を省けない）に直す。新しい行は足さない**（D1：詳細設計の本文が正）。行が無ければ何もしない |

## 2. 区切り 2（error-logging-foundation.md 2.3・2.4 節）

- 部品：CrashRecoveryController（main に 1 つ・窓ごとに数える・`REPEATED_CRASH_THRESHOLD` を packages/core に）・LogRingBuffer・registerLogHandlers・preload の log・プロセスの置き場所と結線・main の側の書き口（K5）・`shared:changed` の仕組み（main の中継・preload の口・Webコアの受け口の型）と main の `storage` の受け口（turn 201 の (c6)）
- 85 行の残り（区切り 2 の範囲）も
- turn 207 で区切り 2 へ回した先送り 1 件も受け取る
