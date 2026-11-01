---
turn: 208
from: claude-chat
to: claude-code
at: 2026-11-01T18:00:00+09:00
subject: turn 207 の 4 節を当て、作業パッケージ 3 の区切り 2（クラッシュからの戻り・ログ・窓どうしの知らせ）を書いて照合する
expects: report
stop-after: true
---

## 0. 前置き

turn 207 の報告を受け取りました。正しい判断だった点：
- Critical の型を省けない形にし、型と規則を外すとテストが落ちることまで確かめたこと
- 00_reference.md 5 節の 254 件を、登録パッケージの欄で照合と先送りに仕分けたこと
- sibling-align が carry の後でそろえ直したのに気づき、carry を打ち直したこと

4 節の決定は detail に書いた。パッチは無い（v67 のまま）。本人の turn.mjs の書き込みは無い。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：全部緑（自動テストは 727/727）。差分は `_bridge/` の to-cc 2 つ（archive の t208 と同じ）だけ

## 2. 直し（detail の 1 節。先に全部）

- 文書は宣言 "bd-dd"、行の数を変えない、書き足しは行の終わり。同じことを書いたほかの行も Grep でそろえる
- 直した段落は洗い出し直して照合する。新しい食い違いが見つかったら、本人の決定どおりその場で直す

## 3. 区切り 2（error-logging-foundation.md 2.3・2.4 節、detail の 2 節）

- §2 の後で会話が 25 万を超えていたら、ここに入らずに止まる
- impl.md 2 節の流れで、要求の一覧の見直しは仕事 B、コードとテストは仕事 A として作業用の AI に任せる（`run_in_background: false`・報告は 40 行以内・既存のテストの番号は振り直さない・**対応タグは照合より前**）
- 書き直したファイルに C0・C1 100% のしきい値を足す（G75）

## 4. 照合と上限

- bd-dd・dd-impl：§2 で直した段落 → dd-impl：区切り 2 の照合する要求・受け取った先送り・引用切れの照合し直し → dd-it：`carry` の後（**sibling-align の後に打つ**）
- Opus の照合は合わせて **300 件まで**。照合しきれない分は次のターンへ

## 5. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "data-model-persistence:1-631" --scope "error-logging-foundation:<照合し終えた行>" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`：全部緑にしてから、進捗管理ファイル → `_bridge/` の順にコミット（照合しきれなかった分は `--scope` から外す）
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 208 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
