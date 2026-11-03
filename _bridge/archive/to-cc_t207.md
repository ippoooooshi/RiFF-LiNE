---
turn: 207
from: claude-chat
to: claude-code
at: 2026-11-01T10:00:00+09:00
subject: 224 番と turn 206 の 5 節を当て、区切り 1 の残り（00_reference.md 5 節ほか）を照合し、余裕があれば区切り 2 に入る
expects: report
stop-after: true
---

## 0. 前置き

turn 206 の報告を受け取りました。正しい判断だった点：
- v67 で 137 か所を直し、落ちた 16 段落だけを写し直して照合し直したこと
- 照合で見つけた部分 2 件（electron の net・LogEntry の context）を、そのターンで直して一致にしたこと
- 自分の台本の誤り（`/** … */` の後ろのタグ）に、コミットの前に気づいて直したこと

224 番（本人の決定：文言を足して決まりどおりにする）と 5 節の決定は detail に書いた。パッチは無い（v67 のまま）。本人の turn.mjs の書き込みは無い。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：自動テストは 727/727。前のターンの終わりの赤（dd-impl の引用切れ 9）は出てよい。差分は `_bridge/` の to-cc 2 つ（archive の t207 と同じ）だけ

## 2. 直し（detail の 1・2 節。先に全部）

- 文書は宣言 "bd-dd"、行の数を変えない、書き足しは行の終わり。同じことを書いたほかの行も Grep でそろえる
- コード（Critical の見出しとボタンを省けない型・FILE-012・FILE-013 の文言・動的な import を止める規則）は作業用の AI に仕事 A として任せる（`run_in_background: false`・報告は 40 行以内・既存のテストの番号は振り直さない・**対応タグは照合より前**）
- 直した段落は洗い出し直して照合する。新しい食い違いが見つかったら、本人の決定どおりその場で直す。224 番を honnin-done.md へ

## 3. 区切り 1 の残り（detail の 3 節の 2）

- 引用切れ 9・dd-it の照合待ち 7・ファイルの頭 1〜13 行の照合前 2・00_reference.md 5 節・作業パッケージ 3 宛ての先送り
- 00_reference.md 5 節の要求は、コードで満たすもの（登録の中身）を照合し、受け持ちが別のパッケージのコードは先送り（登録パッケージの欄のとおり）

## 4. 区切り 2（error-logging-foundation.md 2.3・2.4 節）

- §2・§3 の後で会話が 25 万を超えていたら、ここに入らずに止まる
- 部品：CrashRecoveryController（main に 1 つ・窓ごとに数える・`REPEATED_CRASH_THRESHOLD` を packages/core に）・LogRingBuffer・registerLogHandlers・preload の log・プロセスの置き場所と結線・main の側の書き口（K5）・`shared:changed` の仕組み（main の中継・preload の口・Webコアの受け口の型）と main の `storage` の受け口（turn 201 の (c6)）
- 書き直したファイルに C0・C1 100% のしきい値を足す（G75）

## 5. 照合と上限

- req-bd・bd-dd・dd-impl：§2 で直した段落 → dd-impl：§3 → 区切り 2 → dd-it：`carry` の後
- Opus の照合は合わせて **300 件まで**。照合しきれない分は次のターンへ

## 6. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "data-model-persistence:1-631" --scope "error-logging-foundation:<照合し終えた行>" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`：全部緑にしてから、進捗管理ファイル → `_bridge/` の順にコミット（照合しきれなかった分は `--scope` から外す）
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 207 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
