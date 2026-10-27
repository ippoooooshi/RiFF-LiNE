---
turn: 195
from: claude-chat
to: claude-code
at: 2026-10-27T08:00:00+09:00
subject: 202〜205 番を当て、作業パッケージ 2 の区切り 5（8〜9 節、208-278 行）を書いて照合する
expects: report
stop-after: true
---

## 0. 前置き

turn 194 の報告を受け取りました。正しい判断だった点：
- 台帳が先送りを断った 13 件を、無理に通さずに plan で受け持ちを書き、そのことを報告したこと
- 申し送り先が設計書に無い 7 件を見つけ、screens-navigation.md 7.6 節に申し送りを足したこと
- 会話が 25 万を超えた時点で、残りを作業用の AI に回したこと

本人の決定（202〜205 番、4 件とも本人がおすすめ案を選んだ）とチャット側の決定は detail に書いた。パッチは無い（v65 のまま）。196 番は書き込み済みなので、本人の turn.mjs の書き込みは今回無い。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：全部緑。差分は `_bridge/` の to-cc 2 つ（archive の t195 と同じ）だけ

## 2. 決定を当てる（detail の 1）

- 202・203・204・205 番：detail の 1 の表の「直す所」のとおり（宣言 "bd-dd"、行の数を変えない、書き足しは行の終わり）。直した段落は洗い出し直して、照合するか前と同じ受け持ちへ先送りを付け直す
- 4 件を honnin-done.md へ

## 3. 区切り 5（data-model-persistence.md 8〜9 節、208-278 行、要求 237）

impl.md 2 節の流れで、要求の一覧の見直しは仕事 B、コードとテストは仕事 A として作業用の AI に任せる（`run_in_background: false`・報告は 40 行以内・既存のテストの番号は振り直さない）。

- 部品：スキーマの版と移行（8 節、`SchemaMigrator`・PreMigration・古い版の補い方）・曲一覧のインデックス（9 節、索引を直す時機と作り直し 9.1・フォルダの実体 9.2）
- この区切りで受け取るものと必ず見る所：detail の 3（先送り 31 件・SchemaMigrator の仮の値・G73）
- 書き直したファイルに C0・C1 100% のしきい値を足す（G75）
- 会話が 25 万を超えそうなら、照合の前の準備（要求の読み込み・台帳の出力の読み取り）も作業用の AI に回す

## 4. 照合と上限

- dd-impl：区切り 5 の照合する要求・受け取った先送り・§2 で洗い出し直した要求・引用切れの照合し直し → dd-it：`carry`（まず `--dry-run`）の後、この段で照合する要求と受け取った分
- bd-dd：§2 で直した段落
- Opus の照合は合わせて **300 件まで**

## 5. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類> --scope "data-model-persistence:1-454" --scope-edge "dd-impl" --scope-edge "dd-it" --verify`（区切り 1〜5 で 1-454 行が全部つながる）：全部緑にしてから、進捗管理ファイル → `_bridge/` の順にコミット
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 195 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
