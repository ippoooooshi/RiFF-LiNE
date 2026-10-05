---
turn: 120
from: claude-chat
to: claude-code
at: 2026-10-05T10:40:00+09:00
subject: 基本設計 03 章 201 行（Esc と Critical）を直して req->bd を閉じ直し、03 章を分け直す。35・36 番を決定にする（詳細設計への書き込みは v38 の後）。詳細設計は書き換えず、判定し直しと 03 章の残りの判定（合わせて 300 件まで）、一致以外を plan に分ける。終わりに _bridge/ をコミット
expects: report
stop-after: true
---

## 0. 前置き

turn 119 の報告は受け取りました。次の 3 つは、どれも正しい判断です。
- 一致になった要求に plan を付けず、取り消しの申し送りを本文の注と受け先表に残したこと
- 利用者に見える (b) を 3 件、自分から挙げたこと
- 行のずれで判定し直した数と費用を出し、道具の直しを提案したこと

本人に 35・36 番と道具の直しを聞きました。**決定は `_bridge/to-cc-detail.md`（turn 120）にあります。これを正としてください。** 35 番の (1) は見立てと違います。道具の直し（v38）はチャット側が作り、本人が当てます。**それまで詳細設計に行を足すと判定し直しが増えるので、このターンは詳細設計を書き換えません**（detail の 3）。本人がこのターンの前に打つコマンドはありません。

**`.claude/commands/chapter.md` と `_bridge/to-cc*.md` も、最初から Read ツールで読んでください（detail の 2-4）。** 読んだら `_bridge/active-turn.md` の印の手順（turn は 120）。確かめのコマンドは 1 本ずつ打つ。`.claude/` のファイルは書き換えない。

## 1. 前提の確認（1 本ずつ）

- `check-version --json` でずれ 0
- `git status --porcelain`：差分は `_bridge/to-cc.md`・`to-cc-detail.md`（archive の t120 と `cmp` で同じ）と `_bridge/active-turn.md` だけ。未追跡は `Claude outputs/`・`_claude_fix/`・`patch_*.py` と archive の t120 の 2 ファイルだけ（`_claude_fix/v38/` が増えていても、それは本人が当てる前のチャット側のもの）
- `approval-report "bd->dd" --file 03_screens_ui_pc`：未承認 0・指摘 0・本人待ち 0
- `stale-diff "bd-dd"` と `stale-diff "req-bd"`：ack の積み残し 0

## 2. 基本設計を直して req->bd を閉じ直す（宣言は `req->bd`）

- 基本設計 03 章 201 行（detail の 2-1）。先に要件を grep する（あれば要件から直す）。**行数と見出しは変えない**
- `split.mjs req`（要件を直したときだけ）・`split.mjs bd` → `sync` → `recheck-evidence "req->bd"` → 無効になった判定と直した行に当たる要求を judge.js（`ids`）で判定し直す → `req->bd` の未判定 0・一致以外は分類済みだけ → コミット

## 3. 03 章の変わった単位を分け直して承認する（宣言は `bd->dd`）

- turn 119 と同じ形（`prevEntries` を見て変わっていない断片は 1 文字も変えずに写す → `stale-diff` を読んで `--ack` → approve.js → settle.js → 割れたら hold、37 番から積む）
- 引き継げた承認の数と承認し直した数 → コミット

## 4. honnin-queue

- 35・36 番を「決定 2026-10-05（…）」にする（detail の 1）。詳細設計には書かない

## 5. 段 ③：判定と分類（詳細設計は書き換えない）

- detail の 4 のとおり。判定し直しを先に、残りで 03 章の未判定を節の境まで。**合わせて 300 件まで**。judge.js は既定（opus）
- 一致以外は全部 plan に分ける。受け先の書き漏れは「下位を直す」（理由に「03 章の回の続き」）
- コミット

## 6. 確かめる

- drift 6 段一致／`check-docs-links` 0／【要確認】0／今日より後の日付 0
- **詳細設計の差分 0**（`git diff <このターンの始まり> -- docs/detailed_design/` が空）／基本設計の行数が変わっていない（直したのは 03 章 201 行の中だけ）／要件の行番号の引用 0
- 足した文の「等」の類と、数字に挟まれない「〜」が 0
- `req->bd` 根拠の無効 0・未判定 0・一致以外は分類済みだけ
- `recheck-evidence "bd->dd"`：01・02・03・09 の無効 0（08 は 82 のまま）
- `tag-check "bd->dd"`：01・02・03・09 で印なし 0・行き先の無い印 0
- `approval-report "bd->dd" --file 03_screens_ui_pc`：未承認 0・指摘 0（本人待ちが出たらその数）
- 03 章の判定済みのうち、一致以外で plan の無いもの 0
- `ops --since <このターンの始まり> --expect judge,sync,decompose,stale-diff,approve,settle,plan,hold`（打った種類だけ）：想定外 0。ほかのセッションの書き込みが無い
- `edges/` の一時ファイル 0・直下の新しい未追跡 0

## 7. コミット

- §2 → §3 → §4 → §5 → **終わりに `active-turn.md` を `status: done` にし、`_bridge/`（この報告・archive の t120 の 2 ファイル・honnin-queue・active-turn.md）をコミット**。from-cc.md は 25 行以下を確かめてから

## 8. やらないこと

- **詳細設計を書き換えない**（このターンだけの決まり。detail の 3）
- 基本設計を 03 章 201 行のほかは直さない（直すことが要るものは止めて報告）。見出しは直さない
- judge.js に `model`・`review`・`dryRun` を付けない
- `uphold`・`concede`・`release-hold` を打たない
- 分類器や権限で止められた読み取りを、別のコマンドで迂回しない（Read・Grep・Glob が止められたら止めて報告）
- `_claude_fix/v38/` を当てない・読まない（本人が当てる）
- 手順書の 8 のとおり

## 9. 報告

`_bridge/from-cc.md`（**25 行以内**、`answering: 120`）：
- 印の手順の結果・§1 の結果・最初の読みを Read で行ったか
- §2：直した文（要件を直したか）・req->bd の判定し直しの数と結果
- §3：引き継げた承認の数と承認し直した数・本人待ち
- §5：判定し直しの数と結果・新しく判定した範囲と数と内訳・plan の内訳（回した先の章ごと、「03 章の回の続き」の数）
- 確かめの結果
- 費用・止められた回数と理由
- 03 章の残り（判定の件数）
- 本人の判断が要る点

`_bridge/from-cc-detail.md` には要るものだけ（直した基本設計の行の前後の文・「03 章の回の続き」と「上位を直す」と「判断できない」にしたものの全件・37 番からの要約・道具の気づき）。

チャットは 5 行以内。
