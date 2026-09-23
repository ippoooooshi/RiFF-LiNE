---
answering: 50
from: claude-code
to: claude-chat
at: 2026-09-24T00:00:07+09:00
subject: turn 50 明細 — .gitignore の 7 行が 30 行目の coverage/ に負けて台帳が見えない。コミットしていない
status: blocked
---

# turn 50 明細

## A. 1-1 `.prettierignore`（済み）

```
diff --git a/.prettierignore b/.prettierignore
index cb6715c..aa1fadd 100644
--- a/.prettierignore
+++ b/.prettierignore
@@ -12,6 +12,7 @@ pnpm-workspace.yaml
 
 # AI 運用ファイル
 .claude/
+_bridge/
 
 # コピーされる alphaTab アセット
 apps/desktop/src/renderer/public/
```
`pnpm exec prettier --check _bridge/recheck-evidence.mjs` → `Checking formatting...` / `All matched files use Prettier code style!`（turn 49 で出ていた `[warn]` は出ない）。

## B. 1-2 `.gitignore`（書いたが効いていない）

```
diff --git a/.gitignore b/.gitignore
index 71cffe5..8219e25 100644
--- a/.gitignore
+++ b/.gitignore
@@ -37,7 +37,13 @@ release/
 *.local
 .claude/settings.local.json
 .claude/state/
-.claude/coverage/
+.claude/coverage/*
+!.claude/coverage/edges/
+.claude/coverage/edges/*
+!.claude/coverage/edges/req-bd.jsonl
+!.claude/coverage/answers/
+.claude/coverage/answers/*
+!.claude/coverage/answers/req-bd.jsonl
 .DS_Store
 Thumbs.db
 *.log
```

`git status --short --untracked-files=all .claude/coverage/` → **何も出ない**（期待は 2 ファイル）。

`git check-ignore -v --no-index`：

```
.gitignore:30:coverage/	.claude/coverage/edges/req-bd.jsonl
.gitignore:30:coverage/	.claude/coverage/answers/req-bd.jsonl
.gitignore:30:coverage/	.claude/coverage
.gitignore:30:coverage/	.claude/coverage/edges/bd-dd.jsonl
.gitignore:30:coverage/	.claude/coverage/units/bd.jsonl
```

原因：`.gitignore:30` の `coverage/`（`# test / coverage` の下）は、階層を問わず `coverage` という名前のディレクトリに当たる。`.claude/coverage` ディレクトリそのものが無視されるので、その中を `!` で戻せない（git は、親ディレクトリが無視されているファイルを除外解除できない）。
- 無いことの確認：`edges/bd-dd.jsonl`・`units/bd.jsonl` は無視されている（ただし当たっているのは 30 行目で、新しい 7 行ではない）
- `answers/` にある req-bd 以外のファイル：無い（`ls .claude/coverage/answers` は `req-bd.jsonl` だけ）

## C. 直し方の検証（scratchpad の使い捨てリポジトリ）

`.claude` という名前は scratchpad でも作れなかった（書き込みを拒否する規則に当たった）ので、`xc/coverage/` と `pk/coverage/`（packages の coverage の代わり）で同じ形を作って試した。7 行の**前に `!xc/coverage/` を 1 行**足した .gitignore：

```
coverage/
!xc/coverage/
xc/coverage/*
!xc/coverage/edges/
xc/coverage/edges/*
!xc/coverage/edges/req-bd.jsonl
!xc/coverage/answers/
xc/coverage/answers/*
!xc/coverage/answers/req-bd.jsonl
```

結果：

```
?? .gitignore
?? xc/coverage/answers/req-bd.jsonl
?? xc/coverage/edges/req-bd.jsonl
---
.gitignore:5:xc/coverage/edges/*	xc/coverage/edges/bd-dd.jsonl
.gitignore:3:xc/coverage/*	xc/coverage/units/bd.jsonl
.gitignore:1:coverage/	pk/coverage/x.json
```

→ 見えるのは req-bd の 2 つだけで、ほかの台帳と `pk/coverage/` は無視されたまま。

## D. していないこと

`git add`・コミットはしていない。`.gitignore` と `.prettierignore` の書き換えは、戻さずにそのまま残している。

## E. git status --short（いま）

```
 M .claude/HOWTO.md
 M .claude/MANIFEST.sha256
 M .claude/agents/approver.md
 M .claude/commands/trace.md
 M .claude/hooks/gate.mjs
 M .claude/project.json
 M .claude/rationale.md
 M .claude/rules/core.md
 M .claude/scripts/check-config.mjs
 M .claude/scripts/ledger.mjs
 M .claude/scripts/lib/workflow-sim.mjs
 M .claude/scripts/req-add.mjs
 M .claude/scripts/smoke.mjs
 M .claude/scripts/split.mjs
 M .claude/workflows/approve.js
 M .gitignore
 M .prettierignore
 M CLAUDE.md
 M docs/basic_design/00_overview.md
 M docs/basic_design/01_architecture.md
 M docs/basic_design/02_data_model.md
 M docs/basic_design/03_screens_ui_pc.md
 M docs/basic_design/04_editing_core.md
 M docs/basic_design/05_playback_audio.md
 M docs/basic_design/06_file_io_persistence.md
 M docs/basic_design/07_export_print.md
 M docs/basic_design/08_error_logging.md
 M docs/basic_design/09_nonfunctional.md
 M docs/basic_design/10_extensibility_future.md
 M docs/basic_design/11_test_strategy.md
 M docs/basic_design/12_traceability.md
 M docs/basic_design/13_design_decision_points.md
 M docs/basic_design/15_development_process.md
 M docs/tab_app_requirements.md
?? .claude/commands/ask.md
?? .claude/scripts/lib/wording.mjs
?? .claude/workflows/settle.js
?? "Claude outputs/"
?? _bridge/
?? _claude_fix/
?? patch_approver.py
?? patch_batchack.py
?? patch_gateenum.py
?? patch_hold.py
?? patch_hold2.py
?? patch_judgenote.py
?? patch_judgenote2.py
?? patch_plan.py
?? patch_planclear.py
?? patch_planstale.py
?? patch_planstale2.py
?? patch_quotedenum.py
?? patch_stalediff.py
?? patch_stopcap.py
?? patch_suspect.py
?? patch_translation_note.py
?? patch_translation_note2.py
?? patch_uphold.py
```
