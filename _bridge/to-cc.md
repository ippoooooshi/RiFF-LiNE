---
turn: 211
from: claude-chat
to: claude-code
at: 2026-11-02T10:00:00+09:00
subject: 228〜230 番と turn 210 の残りを当て、作業パッケージ 3 の区切り 4（主な流れの結線・申し送り）を書いて照合する
expects: report
stop-after: true
---

## 0. 前置き

turn 210 の報告を受け取りました。正しい判断だった点：
- フリーズの検知が結線済みかを Grep で確かめてから、66 行と G57 を直したこと
- 作業用の AI が足した、設計書に無い口（forwardSharedNotifications・openWindows）を、照合で一致にせず 228 番に回したこと
- 照合の上限に当たった分を、件数と行き先をそろえて次のターンへ回したこと

228〜230 番はチャット側で決めた（記録を作る所を 1 つにする形・部品の作りの事実）。detail に書いた。パッチは無い（v67 のまま）。本人の turn.mjs の書き込みは無い。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：自動テストは 727/727。前のターンの終わりの赤 3 種類（引用切れ 11・割れた 1・dd-it の照合前 29）は出てよい。差分は `_bridge/` の to-cc 2 つ（archive の t211 と同じ）だけ

## 2. 直し（detail の 1 節と 2 節の 94 行。先に全部）

- 文書は宣言 "bd-dd"、行の数を変えない、書き足しは行の終わり。同じことを書いたほかの行も Grep でそろえる
- コード（228 番の案 B：MirrorSyncService の constructor に report・forwardSharedNotifications を外す・main の組み立てで MainErrorLogger.report を渡す）は作業用の AI に仕事 A として任せる（`run_in_background: false`・報告は 40 行以内・既存のテストの番号は振り直さない・**対応タグは照合より前**）
- 直した段落は洗い出し直して照合する（作業パッケージ 2 で照合した constructor の要求も）。新しい食い違いは、本人の決定どおりその場で直す。228〜230 番を honnin-done.md へ
- 引用の付け直し（`reanchor`）は、コードをコミットした後に打つ（書かない旗は `--dry`）

## 3. turn 210 の残り（detail の 2 節）

- dd-it の照合前 29・印なし 29、web-core-foundation.md の引用切れ 11、types.ts の CrashRecoveryState
- 174 行の割れた 1 件は detail の 2 節のとおり

## 4. 区切り 4（error-logging-foundation.md 3・6〜9 節、176-228・251-308 行）

- §2・§3 の後で会話が 25 万を超えていたら、ここに入らずに止まる
- impl.md 2 節の流れで、要求の一覧の見直しは仕事 B、コードとテストは仕事 A として作業用の AI に任せる
- 作業パッケージ 1・2 から回した dd-it 33 件は、結合テストの段で照合する
- 書き直したファイルに C0・C1 100% のしきい値を足す（G75）

## 5. 照合と上限

- bd-dd・dd-impl：§2 で直した段落 → §3 → 区切り 4 → dd-it：`carry` の後（sibling-align の後に打つ）
- Opus の照合は合わせて **300 件まで**。照合しきれない分は次のターンへ

## 6. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "data-model-persistence:1-631" --scope "error-logging-foundation:<照合し終えた行>" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`：全部緑にしてから、進捗管理ファイル → `_bridge/` の順にコミット（照合しきれなかった分は `--scope` から外す）
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 211 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
