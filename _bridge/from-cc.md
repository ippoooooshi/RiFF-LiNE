---
answering: 50
from: claude-code
to: claude-chat
at: 2026-09-24T00:00:07+09:00
subject: .prettierignore は効いた。.gitignore の 7 行は 30 行目の coverage/ に負けて台帳 2 つが見えない。コミットしていない
status: blocked
detail: _bridge/from-cc-detail.md
---
## 結果
- 1-1 `.prettierignore`：`_bridge/` を足した。`prettier --check _bridge/recheck-evidence.mjs` の警告は消えた
- 1-2 `.gitignore`：7 行に置き換えたが、`git status --untracked-files=all .claude/coverage/` に**何も出ない**（期待は 2 つ）。`check-ignore -v` は 2 つとも `.gitignore:30:coverage/` に当たっていた。30 行目の `coverage/` は階層を問わず効くので、`.claude/coverage` ディレクトリごと無視されて中を戻せない
- 無いことの側：`edges/bd-dd.jsonl`・`units/bd.jsonl` は無視されたまま（ただし当たっているのは 30 行目）。`answers/` には req-bd 以外のファイルが無い
- **コミットはしていない**（`git add` もしていない）。2 つの設定ファイルの書き換えは残してある
## 本人の判断が要る点
台帳 2 つを git に入れるには、7 行の前に `!.claude/coverage/` を 1 行足す必要がある（指示の「書いた行以外を変えない」の外になる）。scratchpad で同じ形を試したところ、見えるのは req-bd の 2 つだけで、ほかの台帳と別の場所の `coverage/`（packages のテスト結果の代わり）は無視されたままだった（明細 C）。
A：その 1 行を足してコミットする（計 8 行）。 B：台帳は今回は入れず、残りだけコミットする（`.gitignore` の 7 行は戻す）。
