---
turn: 263
from: claude-chat
to: claude-code
at: 2026-11-12T08:15:00+09:00
subject: このターンは照合を先頭に置く。dd-impl の 252 件と bd-dd の照合し直し 2 件を、始まりの確かめの直後に 1 回で打つ。そのあと dd-it の照合と carry。行き先の無い対応タグ 157 件（bd-dd）は、基本設計の行が変わった後に付け直していないものとして、reanchor の dry で行き先を確かめてから付け直す。分母と文書のずれ（impl・ut）は split.mjs で分母を作り直す。コードは書かない
expects: report
stop-after: true
---

## 0. 前置き

turn 262 の報告を受け取りました。正しい判断だった点：
- 294・295 番を、コードと単体テストを先にコミットし、直しを外すと落ちることまで確かめて片付けたこと（117・118・120 が落ち、範囲の判定を緩めると 119 が落ちる）
- 会話が 18 万に届いた時点で照合を打たず、打つ一覧（①210 ②13 ③29、bd-dd 2）と作り直す打ち方を from-cc に残したこと
- 赤のまま閉じず、片付けた後に打ち直した結果で赤の名前と数を書いたこと

直してほしい点：
- turn 256 から 262 まで、7 ターン続けて照合が会話の大きさの上限で次へ回っている。コードや洗い出しを照合の前に置くと、照合に届かない。**このターンは、始まりの確かめの直後に照合を打つ。照合の前に、洗い出し・コード・設計書の直しをしない**
- 作業用の AI を呼ぶ前の会話の大きさを、今回も測っていない。呼ぶ前と返った後に `context-report.mjs --size` を必ず打つ
- 大きな出力（`recheck-evidence --json`・`tags --json` など）は、件数か ID だけを scratchpad に書き出してから読む。本体に全部を読み込まない

パッチは無い（v74 のまま）。本人の turn.mjs の書き込みは無い。このターンは to-cc-detail.md を置いていない。日付は PC の時計で書く。このターンも、本人の PC の台本（`_claude_fix/auto-cc.mjs`）が `claude -p` で回すことがある。

## 1. 始まり

- **新しいセッションで始めているかを確かめる**（会話の始めの大きさが 5〜7 万前後なら新しい。前のターンの続きなら何もせずに「新しいセッションで始めてください」とだけ書いて止まる）
- `node .claude/scripts/turn-check.mjs start`：自動テストの数は、vitest の数と `.claude` の道具の自己テストの数を分けて書く。差分は `_bridge/` の to-cc 1 つ（archive の t263 と同じ）と active-turn だけ
- `mirrorSync.test.ts` は始まりと終わりに 1 回ずつ、`--coverage.enabled=false` で
- 区切り 7 の数（段落・洗い出し前・要求・段ごとの照合前・先送り・区切り 7 自身への先送り）を始まりで先に控える
- turn 262 の from-cc.md の打ち方（①`node _bridge/recheck-evidence.mjs "dd->impl" --json` の kind が「行番号がずれた」「引用が見つからない」の reqId、②`$L defer-report "dd-impl" --to "区切り 7" --ids-only`、③`$L pending "dd-impl" --file "editing-core"`）で照合する ID を作り直し、scratchpad に書く。件数が 210・13・29 と違えば、今の数で進めて数を報告に書く

## 2. 決定

### (A) 照合を先頭に置く。チャット側の決定（2026-11-12）

- 根拠：turn 256〜262 の from-cc で、照合が 7 回続けて会話の上限（18 万）で次のターンへ回った。turn 262 は作業用の AI から返った後に 14.3 万、ダブルチェックの後に 18 万だった。照合の前に置いた仕事が会話を大きくしている
- すること：1 節の始まりの確かめが済んだら、すぐ 3 節の 1 と 2 を打つ。このターンはコードを書かない（照合で一致しなかったものの直しは、D1〜D4 で決まる設計書の字面の直しまで。コードの直しが要るものは、件数と ID を報告に書いて turn 264 へ回す）

### (B) 行き先の無い対応タグ 157 件（bd-dd）は、基本設計の行が変わった後に付け直していないものとして扱う。チャット側の決定（2026-11-12）

- 根拠（開いて確かめた原文）：
  - `docs/detailed_design/00_reference.md:357`ほかの `<!-- req 08:94bf7784.* -->`：`.claude/coverage/units/bd.jsonl` に、hash が `94bf7784` で始まる単位は今は無い。基本設計 08 章 11 行（Error の行）の今の hash は `6deb63fb36da`
  - `git show 308d368`（2026-11-03、turn 217 の X8・O9）：08 章 11 行の Error の行に `EDIT-010`・`EDIT-011` を足した 1 行の直し。`.claude/state/ledger-ops.jsonl` では、`docs/basic_design/08_error_logging.md:94bf7784~0` を 2026-10-17 に decompose・approve している。行が変わった後の付け直しが漏れて、古い hash の要求を指す対応タグが残ったと読める
  - `08:94bf7784` を指すタグは docs の中に 46 個ある。157 件の残り（「ほか」）は、まだ同じかどうかを確かめていない
- すること（照合の後、3 節の 4）：
  1. 157 件を、指している基本設計の hash ごとに数える（件数だけ）。それぞれの hash が今の `bd.jsonl` に在るか、在らなければ `git log -S "<hash の 8 桁>"` などで、どのコミットで行が変わったかを 1 行ずつ書く
  2. `node .claude/scripts/ledger.mjs reanchor bd-dd --since 308d368^ --file docs/basic_design/08_error_logging.md --dry --json` で、`94bf7784` の要求が `6deb63fb` に付け直せるかを見る。付け直せるなら dry を外して打ち、`doc-refresh.mjs after --tier dd` で対応タグを付け替える。ほかの hash も、変わったコミットごとに同じ形で打つ
  3. 付け直した要求のうち、行の中身が変わったために照合し直しになったものは、上限の残りで照合する。上限を超える分は、件数と打ち方を書いて turn 264 へ回す
  4. reanchor が付け直さない（行が大きく変わって対応が取れない）ものは、件数と hash と行を報告に書く。消さない
- 使う人に見える動きは変わらない（対応表の直し）

### (C) 分母と文書のずれ（impl・ut）は、分母を作り直して片付ける。チャット側の決定（2026-11-12）

- 根拠：`node .claude/scripts/split.mjs --help` の「`node .claude/scripts/split.mjs <tierId|--all>` … 既定で `.claude/coverage/units/<tierId>.jsonl` を書き換えます」と「drift … 保存済みの分母と実ファイルのズレを見る」。turn 253 の to-cc も、始めに split drift の impl・it・ut の分母を作り直している
- すること（照合の後、3 節の 5）：`node .claude/scripts/split.mjs impl --dry-run` と `ut --dry-run` で新規と変化の数（impl 新規 1・変化 33、ut 新規 4・変化 95 と合うか）を見てから、dry を外して作り直す。そのあと `split.mjs drift` で 0 を確かめる。作り直した後に照合し直しになったものが出たら、件数を書く（上限を超える分は turn 264 へ）

### (D) 区切りの並び（チャット側が持っている。2026-11-12 時点）

- 作業パッケージ 4 の区切り 1〜6 は済、7＝4.2〜4.8 節（EditingService）が最後
- このターンで区切り 7 の赤が 0 になったら、turn 264 でパッケージの終わりの確かめと Pull Request の説明の下書きを頼む。このターンではまだ書かない
- 範囲の外の印なし（web-core-foundation.md の 12 件）は、このターンも手を付けない。件数だけ報告に書く

## 3. 仕事と照合（照合の上限：Opus の照合 300 件・洗い出しとダブルチェック 450 件。18 万で新しい照合を始めない。22 万で新しい仕事を始めない。始める前と返った後に `node .claude/scripts/context-report.mjs --size`）

順はこのとおり。

1. **dd-impl の照合を 1 回で打つ**：1 節で作り直した 252 件（引用切れ 210・区切り 7 への先送り 13・editing-core の照合前 29）。pending で数え直してから打つ
2. **bd-dd の照合し直し 2 件**（`docs/basic_design/04_editing_core.md:8cd32bea~0#k1396dabc1d48`＝19 行、`docs/basic_design/12_traceability.md:9c5597a7~0#k2e87fb845325`＝799 行）。1 と同じ回に入れてよい（合わせて 254 件で上限の中）
3. **dd-it**：dd-impl の照合の後に carry を打ち、editing-core の照合前（turn 262 は 32）が何件残るかを見る。残った分を照合する（描く結合テストが要るものは、turn 262 の (C) と同じく結合テストの工程へ先送り）
4. **(B) の付け直し**
5. **(C) の分母の作り直し**
6. 一致しなかったものは D1〜D4 で直すか分類する。設計書を直したら、コミット → 付け直し 1 回 → 照合し直し

- 照合しきれなかった分は、件数を段と文書ごとに報告に書く。ID は `_bridge/` ではなく scratchpad に控え、作り直す打ち方も書く

## 4. 終わり

- 終わりの確かめの前に `tag-check` と `recheck-evidence` で印なしと引用切れを先に 0 にする（件数だけを見る打ち方で、1 回ずつ）
- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "data-model-persistence:1-631" --scope "error-logging-foundation:1-310" --scope "00_reference:231-231" --scope "00_reference:247-247" --scope "00_reference:345-405" --scope "editing-core:1-<文書の終わり>" --scope "screens-navigation:59-59" --scope "screens-navigation:333-333" --scope "screens-navigation:416-416" --scope "screens-navigation:667-667" --scope "screens-navigation:806-806" --scope "screens-navigation:912-912" --scope "02_data_model:172-172" --scope "04_editing_core:19-19" --scope "04_editing_core:32-32" --scope "12_traceability:799-799" --scope "08_error_logging:11-11" --scope-edge "dd-impl" --scope-edge "dd-it" --scope-edge "bd-dd" --verify`：bd-dd の範囲に、このターンで照合し直す基本設計 04 章 19 行・12 章 799 行と、付け直す 08 章 11 行を足した。台本が受ける範囲の書き方が違うときは、受ける形に直して、足した範囲を報告に書く。全部緑にしてから、進捗管理ファイル → `_bridge/` の順にコミット（`git add` は 1 つずつ）。行が動いたら範囲を grep で数え直して合わせる。`--expect` には打った種類を漏らさず入れる。赤が残ったままコミットするときは、**片付けた後に確かめを打ち直した結果で**、from-cc の頭に赤の名前と数と理由を書く
- ワークフローごとの件数・トークン・時間と、始める前と返った後の会話の大きさを報告に書く
- 区切り 7 の数を、始まりと終わりで表にする（区切り 7 自身への先送りの数も）
- (B) の 157 件の内訳（hash ごとの件数・変わったコミット・付け直した数・付け直せなかった数）と、(C) の作り直しの前と後の数を報告に書く
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 263 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
