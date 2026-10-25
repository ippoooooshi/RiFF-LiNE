---
turn: 187
from: claude-chat
to: claude-code
at: 2026-10-25T13:00:00+09:00
subject: v64 を確かめ、入口のテストを対象と同じフォルダへ移し、CI と同じ確かめを緑にして、Pull Request の説明の下書きを書く（作業パッケージ 1 の最後のターン）
expects: report
stop-after: true
---

## 0. 前置き

turn 186 の報告を受け取りました。正しい判断だった点：
- 決定と同じことを書いた G33・G75 を Grep で見つけてそろえ、監査の記録（経緯）は直さなかったこと
- 作業用の AI の続け番号を、tests.md の決まりに合わせて ROOT に替えたこと
- 作業用の AI の決まり外れ（`cd … &&`）を本人の申告のまま書いたこと

本人の決定はこのターンには無い。チャット側の決定は detail に書いた。v63 の手引き（impl.md）は v64 で少し足した。

このターンの前に、本人が v64 を当てる。v64 が無い（`smoke --last` が 714/714）ときは、§2 だけ進めて、報告に「v64 が無い」と書いて止まる。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：全部緑（自動テストは **717/717**）。差分は `_bridge/` の to-cc 2 つ（archive の t187 と同じ）だけ

## 2. 入口のテストの置き場所（detail の 1 の ①）

- `entry.test.ts`（UT-DEV-ENTRY）を、確かめる対象（`apps/desktop/src/main` の `entryDecisions.ts` ほか）と同じフォルダへ移す（14.2 節「対象と同じフォルダ」）。13 番（入口に分かれ道が無いことを読む検査）も一緒に移す
- 採番簿（基本設計 11 章 120 行・詳細設計 14.4 節の表の UT-DEV-ENTRY の行）の置き場所を移した先に直す（宣言は "req-bd" と "bd-dd"。行の数を変えない）
- vitest の対象（include）に移した先が入っていること、しきい値と対応タグがそのままであることを確かめる
- 同じ型の走査：作業パッケージ 1 で作ったテストのうち、対象と違うフォルダにあるものを数えて報告に挙げる（`runApp.test.ts` など。このターンには移さない）

## 3. CI と同じ確かめ（detail の 1 の ②）

- v64 で `turn-check.mjs end --verify` が `ciParity`（check:quality・format・test:coverage）も打つ。赤があれば直す（直す先が作業パッケージ 2〜8 の部品ならしきい値の外なので、赤にはならない見込み）

## 4. Pull Request の説明の下書き

- `_bridge/pr_web-core-foundation.md` に、本人が GitHub の Pull Request に貼る説明を **30 行以内**で書く
  - 何を作り直したか（作業パッケージ 1 の範囲を 5 行ほど）
  - 確かめたこと：CI の手順・段ごとの照合の数（dd-impl・dd-it）
  - 後に回したもの：先送りの数（受け持ちごとに上位 5 つ）・下位を直すの数
  - 本人が GitHub で設定すること（ブランチの保護・Squash merge だけ・マージ後にブランチを消す・依存の警告）
- `_bridge/` のコミットに入れる

## 5. 照合と上限

- §2 で直した段落と、引用が切れた要求を、段ごとに 1 回ずつ照合する。Opus の照合は合わせて **50 件まで**

## 6. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "web-core-foundation:1-1403" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`（行の終わりの数は今の行数に合わせる）：全部緑にしてから `_bridge/` をコミット
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- push・Pull Request・マージは本人がする。CC は打たない
