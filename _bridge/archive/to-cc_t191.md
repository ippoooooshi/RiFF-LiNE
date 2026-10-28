---
turn: 191
from: claude-chat
to: claude-code
at: 2026-10-26T09:30:00+09:00
subject: 作業パッケージ 2 の区切り 1（前置き・1〜5 節、1-102 行）：要求の一覧の見直し・コードとテスト・照合。turn 190 の進捗管理ファイルを最初にコミットする
expects: report
stop-after: true
---

## 0. 前置き

turn 190 の報告を受け取りました。正しい判断だった点：
- 再チェックで答えを取り違えたとき、1 件ずつに分けて回し直したこと
- 13 節を 8〜9 節より先にした理由（置き場所に依る）を区切りの計画に書いたこと
- 進捗管理ファイルをコミットしなかったことを、指示の範囲のためと書いて聞いたこと

**本人は外出中で、turn.mjs を打たずに貼っている見込み**。パッチは無い（v65 のまま）。196 番は本人が「数えない」と決めたが、書き込み（`uphold`）は本人のコマンドなので、本人が PC に戻ってから turn.mjs で打つ。**CC は 196 番に触らない**（hold のまま。区切り 4 の範囲なので、このターンには関わらない）。チャット側の決定は detail に書いた。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：自動テストは 719/719。差分は `_bridge/` の to-cc 2 つ（archive の t191 と同じ）と、**turn 190 の進捗管理ファイル 2 つ（`.claude/coverage/edges/dd-impl.jsonl`・`dd-it.jsonl`）**
- 最初に、進捗管理ファイルの 2 つだけを `chore(ledger): 作業パッケージ 2 の洗い出しと対象外のダブルチェックを書く（turn 190）` の形でコミットする。**これからは、進捗管理ファイルの変更は毎ターン、`_bridge/` のコミットの前にコミットする**（to-cc がコミットを `_bridge/` だけと書いていても）

## 2. 区切り 1（data-model-persistence.md 前置き・1〜5 節、1-102 行、要求 198）

impl.md 2 節の流れで。**要求の一覧の見直しは仕事 B、コードとテストは仕事 A として作業用の AI に任せる**（`run_in_background: false`・報告は 40 行以内）。

- 部品：`domain/types.ts` の Score とサイドカー・`SongDocument`（readonly・版 1.1.0）・`newSong`。今のコードの下調べ（turn 190 の detail の 3 節）を、写すか書くかの材料にする
- SongDocument の readonly（detail の 1 の (2)）：**詳細設計 2 節のとおり readonly にする**。今の load の `doc.id = songId` は、新しい SongDocument を作り直す形に書き直す。編集のコマンドが score・appMeta を直接替える件は、editing-core.md（作業パッケージ 4）の詳細設計がコマンドと SongDocument の替え方をどう決めているかを Grep で確かめる。editing-core.md も readonly と合う形なら、作業パッケージ 4 で書き直すので今は触らない（古いコマンドが型で通らなくなるなら、そのファイルだけ今の形のまま型を合わせる最小の直しにして、報告に書く）。editing-core.md が直接の書き換えを前提にしているなら、設計書どうしの食い違いとして honnin-queue に積み、ここでは data-model-persistence.md のとおりに作る
- 作業パッケージ 1 から受け取る先送り：dd-it の 2 件（1053 SONGDOC・1051 PITCH）を、テストを書いた後に dd-it で照合する（`defer-report "dd-it" --to "データモデル・永続化"` で ID を取る）
- カバレッジのしきい値（C0・C1 100%）を、この区切りで書き直したファイルに足す（vitest.config.ts、G75）

## 3. 照合（ターンの終わりに段ごとに 1 回）と上限

- dd-impl：区切り 1 の照合する要求（先送り・スコープ外にしなかったもの）
- dd-it：dd-impl の照合の後に `carry "dd-it" --from "dd-impl" --file "data-model-persistence" --lines "1-102"` を打ち（まず `--dry-run`）、この段で照合する要求と、上の先送りの 2 件
- Opus の照合は合わせて **300 件まで**。超えそうなら残りを次のターンに回し、`--later` に書く

## 4. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "data-model-persistence:1-102" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`：全部緑にしてから、進捗管理ファイル → `_bridge/` の順にコミット
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 191 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
