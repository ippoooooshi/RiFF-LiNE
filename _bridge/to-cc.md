---
turn: 188
from: claude-chat
to: claude-code
at: 2026-10-26T10:00:00+09:00
subject: スタブ 9 件を決まりの形で繰り越し、14.2 節に src/dev の例外を書き、runApp.test.ts の src/main の分を分けて、CI と同じ確かめを全部緑にする（作業パッケージ 1 を Pull Request に出す前の最後）
expects: report
stop-after: true
---

## 0. 前置き

turn 187 の報告を受け取りました。正しい判断だった点：
- 照合の「部分」から 1023 行の食い違いを見つけてそろえ、最初の Grep の語が狭かったと書いたこと
- CI と同じ確かめの赤を、増えたものではなく前からの負債と確かめたうえで、Pull Request の CI も赤になる見込みと先に書いたこと

チャット側の決定は detail に書いた。道具の直しはこのターンには無い（v64 のまま）。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：全部緑（自動テストは **717/717**）。差分は `_bridge/` の to-cc 2 つ（archive の t188 と同じ）だけ

## 2. スタブ 9 件（detail の 1 の ①）

- `.claude/rules/ui.md` 31 行の決まりのとおり、9 か所に `// quality-allow-stub: <理由と、いつどの作業単位で解消するか>` を書き、**同時に** 00_reference.md 8.1 節の G の行を起こす（片方だけでは通らない）
  - App.tsx の 8 件：古い画面で、作業パッケージ 8（画面群）で packages/ui-desktop へ移すときに置き換える。G76（レンダラーが React を自分で読み込む件）と同じ繰り越しなら G76 に書き足し、別なら新しい G の行
  - main.ts:182 `createEditWindowInstances`：編集ウィンドウごとの一式を持つのはどの作業パッケージかを詳細設計から Grep で確かめて、そのパッケージで解消すると書く
- 宣言は "dd-impl"（App.tsx と main.ts）と "bd-dd"（00_reference.md）。コードは注を足すだけで、動きを変えない

## 3. テストの置き場所（detail の 1 の ②）

- 詳細設計 14.2 節（941 行）の行の終わりに、「対象が src の外にある開発の道具（apps/desktop/scripts の台本・packages/ui-desktop の theme.css・リポジトリ直下の eslint.config.js）の単体テストは、5.1 節の木のとおり apps/desktop/src/dev に置く」の形で足す（宣言 "bd-dd"、行の数を変えない）。基本設計に同じ決まりの行があれば同じ形にそろえる（impl.md の「本人の決定を当てるとき」と同じやり方）
- `runApp.test.ts` の中で `src/main` の関数（`devTools.ts`・`userDataDir.ts`）を確かめているテストは、対象と同じ `src/main` のテストのファイルへ分ける。作業用の AI（worker）に仕事 A として渡す（前で呼ぶ・報告は 40 行以内）。テストの番号は採番簿の決まり（同じファイルの中で 01 から）に合わせ、要れば採番簿に行を足す（置き場所は 14.2 節に合わせる）
- 分けた後も、確かめる中身（テストの数と中身）が減っていないことを報告に書く

## 4. 照合と上限

- §2・§3 で直した段落・足した採番簿の行・引用が切れた要求を、段ごとに 1 回ずつ照合する。Opus の照合は合わせて **60 件まで**

## 5. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "web-core-foundation:1-<今の最後の行>" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`：**CI と同じ確かめ（check:quality・format・test:coverage）を含めて全部緑**にしてから `_bridge/` をコミット
- `_bridge/pr_web-core-foundation.md` の数を、このターンの後の数に直す
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- push・Pull Request・マージは本人がする。CC は打たない
