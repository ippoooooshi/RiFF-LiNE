---
turn: 214
from: claude-chat
to: claude-code
at: 2026-11-02T14:00:00+09:00
subject: 結合テストの段（dd-it）の残り 109 件を最初に照合し、作業パッケージ 3 を締める支度をする
expects: report
stop-after: true
---

## 0. 前置き

turn 213 の報告を受け取りました。正しい判断だった点：
- ダブルチェックで今も生きている決まりと答えた 2 件（295・300 行）を、決めた形に無理に合わせず要求として残して照合したこと
- 決まりを確かめていた IT-FS-MIRROR-14 を、番号を振り直さずに欠番にしたこと
- 会話が 26 万を超えたところで、dd-it に入らずに止めたこと

2 つの問いはチャット側で決めた（下の 2 節・3 節）。パッチは無い（v67 のまま）。本人の turn.mjs の書き込みは無い。このターンは to-cc-detail.md を置いていない。

**このターンは dd-it を最初にやる**（turn 212・213 と続けて、ほかの作業の後で会話が大きくなり、dd-it に届かなかったため）。

## 1. 始まり

- **新しいセッションで始めているかを確かめる**（会話の始めの大きさが 5 万前後なら新しい。前のターンの続きなら何もせずに「新しいセッションで始めてください」とだけ書いて止まる）
- `node .claude/scripts/turn-check.mjs start`：自動テストは 727/727。差分は `_bridge/` の to-cc 1 つ（archive の t214 と同じ）だけ

## 2. 結合テストの段（dd-it）の残り（最初にやる）

- 対象：error-logging-foundation.md の照合前 101 件・00_reference.md 5 節（345-404 行）の 5 件・web-core-foundation.md の引用切れ 3 件（ErrorBoundary は turn 210 で ui-desktop へ移したので、今のテストのファイルを引き直して照合し直す）
- **テストのファイルへの対応タグ 112 件は、作業用の AI に置き場所の案を出させる**（turn 212 の「タグの置き場所」と同じ形。ファイルで分けて 2〜3 個を並べる・`run_in_background: false`・報告は 40 行以内）。案は台本で書き込み、`tag-check` で確かめてから照合する（**対応タグは照合より前**）
- 照合も作業用の AI（Opus）に任せる。本体は指揮だけにして、要求の一覧やテストのファイルを本体の会話で読まない
- テストが無い・足りない要求が出たら、仕事 A としてテストを足す（既存のテストの番号は振り直さない）

## 3. 306 行の今の状態の文 3 件

- **「今の状態の注」として要求にしない**（理由「今のコードの状態の記録。再読み込みの要求は 2.3 節 62 行で数える」）。turn 211 で本人が決めた 174 行と同じ扱い。同じ行の上限の検討の分は、作業パッケージ 9 への先送りのまま
- 洗い出しを直したらダブルチェックを通す

## 4. 照合と上限

- dd-it：§2（`carry` と `sibling-align` は turn 213 で打ってある。§2 でタグを置いた後にもう一度 `carry` を打つ）→ bd-dd・dd-impl：§3
- Opus の照合は合わせて **300 件まで**。会話が 25 万を超えたら、区切りのよい所で止める

## 5. 作業パッケージ 3 の締めの支度

- 締められる状態か確かめる：error-logging-foundation.md（1-309 行）・data-model-persistence.md（1-631 行）・00_reference.md 5 節が、dd-impl と dd-it の両方で照合前 0・印なし 0・引用切れ 0、honnin-queue に作業パッケージ 3 の「未」が無い、終わりの確かめが全部緑
- 締められれば `_bridge/pr_error-logging-foundation.md` を書く（形は `_bridge/pr_data-model-persistence.md` と同じ：何を作り直したか・確かめたこと〈CI の順・テストの数・dd-impl と dd-it の数・引用切れ 0〉・後に回したもの〈先送りの受け持ち先ごとの数・一致しなかったものの受け持ち〉、最後に Generated の 1 行）。マージはしない（次のターンで本人が turn.mjs で打つ）
- 締められなければ、残りを件数で報告に書く

## 6. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "data-model-persistence:1-631" --scope "error-logging-foundation:1-309" --scope "00_reference:345-404" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`：全部緑にしてから、進捗管理ファイル → `_bridge/` の順にコミット（照合しきれなかった分は `--scope` から外す）
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 214 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
