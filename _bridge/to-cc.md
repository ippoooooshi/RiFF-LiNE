---
turn: 210
from: claude-chat
to: claude-code
at: 2026-11-02T08:00:00+09:00
subject: 66 行と G57 の古い事実の文を直し、作業パッケージ 3 の区切り 3（画面の例外の受け口・起動の結線）を書いて照合する
expects: report
stop-after: true
---

## 0. 前置き

turn 209 の報告を受け取りました。正しい判断だった点：
- web-core-foundation.md に kind の一覧が無いことを Grep で確かめ、在る所だけを直したこと
- 同じことを書いた screens-navigation.md 420 行を見つけてそろえたこと
- 決まりから外れた `node -e` を、自分で報告に書いたこと（**次からは使わない**。JSON の書き換えは scratchpad の python の台本で）

チャット側の決定は下の 2 節だけ。パッチは無い（v67 のまま）。本人の turn.mjs の書き込みは無い。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：全部緑（自動テストは 727/727）。差分は `_bridge/` の to-cc 1 つ（archive の t210 と同じ）だけ。**このターンは to-cc-detail.md を置いていない**（前のターンのものは読まなくてよい）

## 2. 66 行と G57（turn 209 の (1)）

- **直す**（201 番の決まり：コードが追いついて古くなった事実の文は聞かずに直す）。error-logging-foundation.md 66 行の「**未実装**（I1、G57）」を、今のコードの事実（フリーズを扱う所・まだ無い所があればその受け持ち）に直す。00_reference.md 8.1 節の G57 の行も、判定条件を満たした分だけ「解消済み（日付・コミット）」に、残る分があれば残る分と受け持ちを書く。同じことを書いたほかの行も Grep でそろえる（宣言 "bd-dd"、行の数を変えない）
- 直した段落は洗い出し直して照合する

## 3. 区切り 3（error-logging-foundation.md 2.5・2.6 節、102-175 行）

- 部品：ErrorBoundary（packages/ui-desktop へ作り直す・props で report と開き直しを受ける）・main の未捕捉の例外の受け口（K5 の形：main が自分でログに書き、知らせは窓へ）・errorLoggingBootstrap（画面の起動の順）・`mirrorSync.ts` が FILE-015 の LogEntry を自分で組み立てている所を Webコアの `toLogEntry` を呼ぶ形に（turn 209 で区切り 3 の下位を直すにした分）・turn 207〜209 で区切り 3 へ回した先送り（context の要求・`notify:fromMain` の名前と型など）
- §2 の後で会話が 25 万を超えていたら、ここに入らずに止まる
- impl.md 2 節の流れで、要求の一覧の見直しは仕事 B、コードとテストは仕事 A として作業用の AI に任せる（`run_in_background: false`・報告は 40 行以内・既存のテストの番号は振り直さない・**対応タグは照合より前**）
- 書き直したファイルに C0・C1 100% のしきい値を足す（G75）
- 引用の付け直し（`reanchor`）は、コードをコミットした後に打つ
- 新しい食い違いが見つかったら、本人の決定どおりその場で直す（00_reference.md 3 節の行の食い違いは D1 のとおり聞かずに直してよい）

## 4. 照合と上限

- bd-dd・dd-impl：§2 で直した段落 → 区切り 3 の照合する要求・受け取った先送り・引用切れの照合し直し → dd-it：`carry` の後（sibling-align の後に打つ）
- Opus の照合は合わせて **300 件まで**。照合しきれない分は次のターンへ

## 5. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "data-model-persistence:1-631" --scope "error-logging-foundation:<照合し終えた行>" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`：全部緑にしてから、進捗管理ファイル → `_bridge/` の順にコミット（照合しきれなかった分は `--scope` から外す）
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 210 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
