---
turn: 186
from: claude-chat
to: claude-code
at: 2026-10-25T12:00:00+09:00
subject: v63 を確かめ、194・195 番を当て、起動の入口の分かれ道を作業用の AI に見させて、作業パッケージ 1 を閉じる
expects: report
stop-after: true
---

## 0. 前置き

turn 185 の報告を受け取りました。正しい判断だった点：
- 道具の側の赤 2 件を自分で逃がさず、そのまま報告したこと
- 1321 行の大曲を、分け直しの時に受け持ちが読み取れたので先送りに替えたこと
- 間の時刻を控えていないことを、推測と断って書いたこと

**このターンから、まとまった仕事は作業用の AI（`subagent_type: "worker"`）に任せる**（impl.md の「任せ方」、v63）。本人の決定とチャット側の決定は detail に書いた。

このターンの前に、本人が v63 を当てる。v63 が無い（`smoke --last` が 711/711）ときは、§2 だけ進めて、報告に「v63 が無い」と書いて止まる。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：全部緑（自動テストは **714/714**）。差分は `_bridge/` の to-cc 2 つ（archive の t186 と同じ）だけ

## 2. 直す文書（detail の 1）

- 詳細設計（宣言は "bd-dd"）：web-core-foundation.md 1193 行（194 番）・1121 行（195 番）
- 基本設計（宣言は "req-bd"）：15_development_process.md 211 行（195 番）
- **決定と同じことを書いたほかの行も Grep で探してそろえる**（impl.md の「本人の決定を当てるとき」）。そろえた行は報告に挙げる
- 書き足しは行の終わり、行の数を変えない。直した段落の要求は洗い出し直し、照合は §5 のまとめに入れる。194・195 番を honnin-done.md へ

## 3. 起動の入口の分かれ道（194 番の決定の続き、作業用の AI に任せる）

- 作業用の AI（worker）1 体に仕事 A として渡す：入口の 4 ファイル（`main.ts`・`preload.ts`・`main.tsx`・`copy-alphatab-assets.mjs`）に分かれ道（`if`・`?:`・`&&`・`||`・`??`・`try`/`catch`・`switch`）が残っているかを調べ、残っていれば判断を別のファイルの関数に出し、単体テストで C0・C1 100% にする（入口は呼び出しの 1 行にする。turn 184 の `runEntry` と同じ形）
- 新しく作ったファイルは vitest.config.ts のしきい値に入れる。テストの番号は採番簿の頭に合わせる
- 本体は報告と `git diff --stat` と verify で確かめ、対応タグを台本で置き、コミットする

## 4. チャット側の決定を当てる（detail の 2）

- dd-it の 1218 行（機能の網羅のテスト）：受け持ちはタブ譜編集コア（作業パッケージ 4）の結合テストのままでよい。ただし、詳細設計に「機能の網羅のテスト」を書いた所があるかを Grep で確かめ、あればそちらの受け持ちに直す。editing-core.md にその中身が書いていなければ、申し送りの 1 文を足す（impl.md 3 節の申し送りの決まり）

## 5. 照合（まとめて 1 回）と上限

- §2・§3・§4 で照合する要求と、引用が切れて照合し直す要求を、段ごとに 1 つの idsFile にして judge.js を 1 回ずつ。直したものだけをもう 1 回
- Opus の照合は合わせて **100 件まで**

## 6. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "web-core-foundation:1-1401" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`：**全部緑**（v63 で、dd-it のダブルチェック前と、テストの中の見本の文字列は赤にならない）にしてから `_bridge/` をコミット
- `node .claude/scripts/context-report.mjs` を打ち、from-cc-detail.md の終わりに写す。作業用の AI（worker）に任せた仕事ごとの、報告の行数とかかった時間も書く
- push・Pull Request・マージは本人がする。CC は打たない
