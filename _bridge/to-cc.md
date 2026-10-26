---
turn: 194
from: claude-chat
to: claude-code
at: 2026-10-26T21:35:00+09:00
subject: 199〜201 番と 287 行・96 行の扱いを当て、作業パッケージ 2 の区切り 4（12〜13 節、360-454 行）を書いて照合する
expects: report
stop-after: true
---

## 0. 前置き

turn 193 の報告を受け取りました。正しい判断だった点：
- 探す仕組みの置き場所と渡し方が設計書に無いのを見て、作らずに照合し、本人へ回したこと
- 作業用の AI が見つけた listDirectory の食い違いを、そのターンのうちに直して照合し直したこと
- 同じことを書いたほかの行を Grep で探し、今も正しい行は直さなかったこと

本人の決定（199〜201 番）とチャット側の決定は detail に書いた。**detail の 3 節は、これからずっと使う決まり**（古くなった事実の文は聞かずに直してよい）。パッチは無い（v65 のまま）。196 番は本人が turn.mjs で打つ（打たれていれば、最初に `chore(ledger): 本人決定 196 番を書く` でコミットし、196 番を honnin-done.md へ移す。打たれていなければ触らない）。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：全部緑（自動テストは 719/719）。差分は `_bridge/` の to-cc 2 つ（archive の t194 と同じ）だけ（本人が turn.mjs を打っていれば進捗管理ファイルも）

## 2. 決定を当てる（detail の 1〜4）

- 199 番：一致しなかった 14 件を作業パッケージ 8 への先送りに替える（`--to` は turn 193 で作業パッケージ 8 へ回した 3 件と同じ形）。screens-navigation.md 12.10 節の保存先のタブの行の終わりに「同期フォルダの候補を探す本当の仕組み（[[data-model-persistence.md#11]] 11 節。main に置く部品と、レンダラーへ渡すチャンネル）と、起動したときに探すことは、このタブと一緒に作業パッケージ 8 で作る（2026-10-26 本人決定、honnin-queue 199 番）。」の形の 1 文を足す（宣言 "bd-dd"）
- 200 番：data-model-persistence.md:294 の注を「`DirEntry` は packages/shared-types に置き、ここから出し直す（web-core-foundation.md 109 行・依存の向き）」の形に直す。コードは今のまま
- 201 番：00_reference.md の 4 か所（detail の 4）
- 287 行：文を「…設定に残す種別（11 節の `StorageType`）と、候補の見つけ方（11 節）と、主とミラー先の組み合わせの確かめ（14.2 節）にだけ出る。」の形に直す
- 96 行：「論理の型は `Tag[]`」をスコープ外に、「進捗を表すタグは利用者が自分で作って付ける」を作業パッケージ 8 への先送りに替える（理由は detail の 2）
- 直した段落は全部、洗い出し直して照合する。199〜201 番を honnin-done.md へ

## 3. 区切り 4（data-model-persistence.md 12〜13 節、360-454 行、要求 211）

impl.md 2 節の流れで、要求の一覧の見直しは仕事 B、コードとテストは仕事 A として作業用の AI に任せる（`run_in_background: false`・報告は 40 行以内・既存のテストの番号は振り直さない）。

- 部品：`StorageMigrationService`（12 節）・主ストレージとローカル既定パスの木（13.1・13.2）・`preferences.json` の項目（13.3、turn 193 で足した保持期間を含む）・`tags.json` と `tuning-presets.json`（13.4）
- この区切りで受け取る先送り：detail の 5（dd-impl 8 件と、作業パッケージ 1 からの dd-it のうち区切り 4 の分）
- 移している間の覆い（screens-navigation.md 420 行）など画面の部分は作業パッケージ 8 へ先送りにしてよい（理由を書く）
- 書き直したファイルに C0・C1 100% のしきい値を足す（G75）

## 4. 照合と上限

- dd-impl：区切り 4 の照合する要求・受け取った先送り・§2 で洗い出し直した要求・引用切れの照合し直し → dd-it：`carry`（まず `--dry-run`）の後、この段で照合する要求と受け取った分
- bd-dd：§2 で直した段落（screens-navigation.md 12.10 節・00_reference.md を含む）
- Opus の照合は合わせて **300 件まで**

## 5. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "data-model-persistence:1-207" --scope "data-model-persistence:279-454" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`：全部緑にしてから、進捗管理ファイル → `_bridge/` の順にコミット
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 194 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
