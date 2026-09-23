---
turn: 51
from: claude-chat
to: claude-code
at: 2026-09-24T00:01:00+09:00
subject: .gitignore に !.claude/coverage/ を 1 行足して（A）、turn 50 の §2・§3 どおりコミットする
expects: report
stop-after: true
---

## 0. 前置き

turn 50 の報告は受け取りました。**7 行が 30 行目の `coverage/` に負けたのは、指示を書いたチャット側の誤りです。** `.gitignore` を読んでいたのに、30 行目が `.claude/coverage` にも当たることを確かめずに 7 行を書きました。
止めて、試した結果（明細 C）を添えて出したのは正しい判断でした。

**A で進めます。** 本人は前のターンで「台帳は `req->bd` の分だけ git に入れる」と決めていて、A はその決定を実現するための直しです。
チャット側でも、今の `.gitignore` に 1 行足したものを空のリポジトリで試しました。見えたのは `edges/req-bd.jsonl` と `answers/req-bd.jsonl` の 2 つだけで、`edges/bd-dd.jsonl`・`units/bd.jsonl`・`answers/` のほかのファイル・別の場所の `coverage/` は、無視されたままでした。

報告の `at:` は PC の時計から取ること。

## 1. `.gitignore` に 1 行足す

今の 40 行目 `.claude/coverage/*` の**直前**に `!.claude/coverage/` を 1 行足す。ほかは変えない（計 8 行になる）。
足したら turn 50 の §1-2 と同じく、**在ることと無いことの両方**を見る。
- `git status --short --untracked-files=all .claude/coverage/` に出るのが、`edges/req-bd.jsonl` と `answers/req-bd.jsonl` の **2 つだけ**
- `git check-ignore -v` で `edges/bd-dd.jsonl`・`units/bd.jsonl` が**まだ無視されている**。当たっている行も明細に書く

## 2. コミットする

**turn 50 の §2・§3 をそのまま行う**（入れるもの・入れないもの、`git diff --cached --name-only` を見てからコミット、フックに止められたら止める、`--no-verify` は使わない、コミットの前後で `recheck-evidence`・`stats`・`smoke` が変わらないこと）。

## 3. やらないこと

- 文書（`docs/`）・`packages/`・`.claude/` の中身を変えない
- push しない
- `.gitignore` は足す 1 行のほかを変えない

## 4. 報告

`_bridge/from-cc.md`（**20 行以内**、`answering: 51`）：コミットのハッシュ、入れたファイルの数、§1 の在る／無いの結果、コミット後の数字（無効 0・照合 1077／要求 1005・不一致等 0／smoke 393/393）。
明細：`git diff --cached --name-only`、`git log -1 --stat`、`git status --short`、`git check-ignore -v` の出力。

チャットは 10 行以内。
