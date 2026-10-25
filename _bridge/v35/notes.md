# v35 の材料（turn 107、本体のメモ）

このフォルダの台本は、scratchpad（と前のセッションの scratchpad）から中身を変えずに写したもの。`cmp` でバイトが同じことを確かめた。
`rules_args_turn97.json` だけは写しではなく、ワークフローの記録から `args` を取り出したもの。

## 0. 写したものと、写さなかったもの

| 項目 | ファイル | 元の場所 |
|---|---|---|
| 1 判定（bd->dd） | `judge106.js` | このセッションの scratchpad（turn 105 から 106 の「受け先ごとに 10 件まで」の最新） |
| 1 判定し直し（req->bd） | `rejudge106.js` | 同じ（rejudge99.js の系統の最新） |
| 2 承認 | `approve98.js` | 同じ |
| 2 settle | `settle100.js` | 同じ |
| 3 分解の決まり（写しの RULES） | `dec94s3.js` | **前のセッション（a41da8a7）の scratchpad**。このセッションの scratchpad には無い |
| 3 分解の決まり（args で渡した文） | `rules_args_turn97.json` | このセッションのワークフローの記録 `wf_434ee39c-211`（turn 97 に coverage.js をパスで回したとき） |
| 4 確かめをまとめて回す | `checks106.sh` | このセッションの scratchpad |
| 4 無効の原因を数える | `recheck_cmp.cjs` | 同じ |
| 4 前の分け方を写す案を作る | `redec99.cjs` | 同じ |
| 4 受け先ごとに 10 件までに分ける | `groups105.cjs` | 同じ |
| 4 印の付け替え | `retag105.cjs` | 同じ |
| 4 判定し直す要求を拾う | `find106.cjs` | 同じ |

写さなかったもの。

- **`items105.mjs`（受け先を引いて一覧にする）**：中に `ledger.mjs` を読み込むためのリポジトリのフルパスが書いてある。CLAUDE.md の禁止「機微情報（個人データ・認証情報・実ファイルのフルパス）を書く」に当たるので、写さずに中身を 2 節に書いた。同じ理由で `res105.mjs` と `newtags10x.mjs` も写していない
- turn 94 から 96 の写し：`dec94s3.js` のほかは見つからなかった（前のセッションの scratchpad で名前が `dec9` で始まる台本は `dec91.js`・`dec92s2.js`・`dec94s3.js` の 3 つ。turn 96 の明細は「照らした決まり」を `dec94s3.js` の `RULES` と書いている）
- このセッションで coverage.js を回したのは turn 97 の 1 回だけ（ワークフローの記録 35 件のうち、`RULES` を含むのはその 1 件）。turn 98 から後は coverage.js で分解していない。分解は全部、本体が `ledger.mjs decompose` を 1 単位ずつ打った（前の分け方を写して、変わった断片だけ替える）。いま args で渡している文は無い

## 1. 元の版との違い

### 1-1. `approve98.js`・`settle100.js`

元の `.claude/workflows/approve.js`・`settle.js` との差は 2 つだけ。数の値は変えていない（`perAgent` は args で 5 を渡す。元の上限は 10）。

- `name` を `approve98`・`settle100` にした
- 承認役への前置きに 2 行足した
  - 「`expect` には、断片の文に出てくる語（2 文字以上の漢字・カタカナの語か、3 文字以上の英字の語）を 1 つ以上そのまま入れる。項目名を英字だけに言い換えない（台帳は、断片と 1 語も共有しない expect を拒みます）」
  - 「リポジトリの中にファイルを作らない。コマンドを書くときは段の名前を引用符で囲む（"bd-dd"）」

### 1-2. `judge106.js`（元は `coverage.js` の Judge の役の文面）

- **1 体に 1 件ではなく、同じ受け先を見る要求を 10 件までまとめて 1 体に渡す。** args は `{ label, groups: [[id…], …] }`。返す形は `results` の配列
  - turn 102 から 104 は 5 件まで、turn 105 から 10 件まで
- モデルは `opus` に決め打ち（coverage.js は args の `model`、既定は sonnet）
- 段は `"bd-dd"` に決め打ち。一覧を取る役・承認の関所・最後の stats の役は無い（本体が台帳で数える）
- 足した文
  - 「1 件ずつ独立に判定する。隣の要求の答えを次に引きずらない。」
  - `SEGMENT`（この回の範囲）：この回の対象・受け先表の行・別の章の回に回しているものは一致にしない・「本書では決めない」の注は書かれていないものとして扱う・引用符・リポジトリにファイルを作らない
  - grep してから読む：「受け先のファイルは、まず `grep -n` で要求の語を探し、当たった行の前後だけを読む。」（turn 103 から）
- **毎回変えているのは 2・3 行目（name・description）と 34 から 36 行目（SEGMENT の最初の 3 行）の 5 行だけ。** 前の回の写しを `judgeNNN_seg.cjs` で書き換えている（行の頭を確かめてから替える）

### 1-3. `rejudge106.js`

`judge106.js` との差は、段が `"req-bd"` なことと、SEGMENT の中身だけ。SEGMENT には、直した基本設計の行（ファイルと行番号と前後の文）と、「前の根拠の引用が消えていても、要求の中身が今の本文に在るかで判定する」「本文が『詳細設計で決める』と先へ回しているものは、基本設計としてはそれで足りるかで判断する」を書く。

### 1-4. 分解の決まり（`dec94s3.js` と `rules_args_turn97.json`）

- 2 つとも前の 4 つの決まり（前置きの句は with・出典と経緯は要求にしない・列挙に係る述部・「／」は項目ごと）は同じ文
- 違い
  - 5 つ目（引用符）：dec94s3.js は `"bd->dd"` の形で `>` がシェルの向け先になると書く。args は `"bd-dd"` の形
  - args には 6 つ目「一時ファイルを含め、リポジトリの中にファイルを作らない」がある
  - dec94s3.js は見出しが「01 章で決めた分け方」。coverage.js は args の文を「この段の分け方（起動した人が渡した決まり…）」の見出しの下に並べる
- `dec94s3.js` と元の coverage.js の分解役の違い：一覧の役が無く `args.items` の単位 ID を 1 体 1 単位で回す、段は `"bd->dd"` の形、モデルは sonnet 決め打ち。v34 で coverage.js が `units` と `rules` を受けるようになったので、turn 97 は coverage.js をパスで回した

## 2. 判定の台本の「受け先」の決め方

台本そのものは受け先を決めない。本体が判定の前に 2 段で決めて、`groups` で渡す。

1. **要求ごとに受け先を引く**（`items105.mjs`、写していない）
   - 台帳の要求から印 `<!-- req <章>:<単位のハッシュ 8 桁>.<要求のキーの頭 4 桁> -->` を組み立てる（キーは `ledger.mjs` の `entriesOf` の `id` の `#k` の後ろ）
   - `docs/detailed_design/*.md` を全部その印で探し、当たった行から上へ向かって最初の `##`・`###`・`####` の見出しを、その印の節とする
2. **受け先ごとにまとめる**（`groups105.cjs`）
   - まとめる鍵は「最初に当たった印のファイル名 ＋ 見出しの最初の語（節番号）」。印が 2 か所にあるものは、例外として手で選ぶ節を決め打ちした（1 件）
   - 1 つの鍵の要求が 10 件を超えたら、等分に割る（`n = ceil(件数 / 10)`、1 体あたり `ceil(件数 / n)`）
   - 判定し直しの数件は、本体が手でまとめることもある（turn 106 は `judge106_seg.cjs` の中で 8・7・6・1 に分けた）
3. 判定の役には「どれも同じ受け先のファイルを見る」と書いて渡し、その受け先は SEGMENT の受け先表の行で示す

実測（ワークフローの記録の totalTokens を件数で割ったもの）

| 台本 | まとめ方 | 件数 | 体 | トークン | 1 件あたり |
|---|---|---|---|---|---|
| judge101 | 1 体 1 件 | 51 | 51 | 2,415,271 | 約 4.7 万 |
| judge102 | 5 件まで | 80 | 16 | 1,065,183 | 約 1.3 万 |
| judge103 | 5 件まで・grep してから読む | 77 | 16 | 937,287 | 約 1.2 万 |
| judge104 | 同じ | 79 | 16 | 923,205 | 約 1.2 万 |
| judge105 | 10 件まで | 79 | 14 | 828,780 | 約 1.0 万 |
| judge106 | 10 件まで | 22 | 4 | 220,480 | 約 1.0 万 |

## 3. 区切り 1 つを回す手順（bd->dd の場合）

`L=node .claude/scripts/ledger.mjs`。cwd はリポジトリ。段の名前は必ず引用符で囲む。

| # | すること | コマンドの形 |
|---|---|---|
| 0 | 始まりの時刻（UTC）を控え、ずれを見る | `node .claude/scripts/split.mjs drift`・`$L stats`・`git status --porcelain` |
| 1 | 宣言 | `node .claude/scripts/state.mjs goal --unit "本番 turn N (X)：…" --goal "…" --verify-by "tag-check \"bd->dd\" --file 02_data_model の印なし 0・行き先の無い印 0" --edge "bd->dd" --file "02_data_model" --lines "1-298" --later "…"` |
| 2 | 上位を直したら切り直す | `node .claude/scripts/split.mjs bd` → `$L sync` → `$L pending "bd-dd" --file "02_data_model"` |
| 3 | 分解（新しい単位） | Workflow を**パスで**：`scriptPath: .claude/workflows/coverage.js`、`args: { edge: "bd-dd", units: [...] か file・lines, rules: [...] }` |
| 3' | 分解（分け直す単位） | `redec99.cjs` の系統で前の分け方を写した案 → 変わった断片だけ手で替える → `$L decompose "bd-dd" "<単位 ID>" '<JSON>'`（`redecNNN.cjs` で 1 単位ずつ） |
| 3'' | 消えた中身を確かめる | `$L stale-diff "bd-dd"` → 読んで `$L stale-diff "bd-dd" --ack "<単位 ID>" --why "…"` |
| 4 | 承認 | Workflow：`scriptPath: <scratchpad>/approve98.js`、`args: { edge: "bd->dd", file: "02_data_model", perAgent: 5 }` → `$L approval-report "bd->dd" --file 02_data_model` |
| 5 | settle（指摘・保留があるとき） | Workflow：`settle100.js`、`args: { edge: "bd-dd", file, lines }` → `$L settle-report` |
| 6 | hold | settle で割れた断片を本人待ちへ：`$L hold "bd-dd" "<entryId>" --why "…"`。本体は concede・uphold・rebut・release-hold を打たない |
| 7 | 材料 | `$L show "bd-dd" "<単位 ID>"`、印の一覧（`newtagsNNN.mjs`）、前の詳細設計 `git show 2759936:docs/detailed_design/<f>.md`、harvest の未の行 |
| 8 | 書く | `docs/detailed_design/` を Edit。基本設計の行数は変えない。足す文に「等・など・ほか・その他」と数の間でない「〜」を入れない。要件の行番号を引かない |
| 9 | 印 | 受け先の文の横に `<!-- req 02:<単位>.<4 桁> -->`。単位のハッシュが変わったら付け替え（`retag105.cjs`）→ `$L tag-check "bd->dd" --file 02_data_model` |
| 10 | harvest | `$L harvest set "<前のキー>" new --why "…" --in "<ファイル>" --quote "<逐語>"` |
| 11 | 判定 | 受け先を引いて `groups` を作る（2 節）→ `judgeNNN.js` を前の回から写し `judgeNNN_seg.cjs` で 5 行替える → Workflow を `scriptPath` で、`args: { label, groups }`。上限は 1 ターン judge 100 |
| 11' | 一致以外 | `$L plan "bd-dd" "<entryId>" 下位を直す --why "…"`（理由は要求か原文と語を共有する 10 文字以上）→ `$L plan-report "bd->dd"` |
| 11'' | 根拠の確かめ | `node _bridge/recheck-evidence.mjs "bd->dd" --json > <scratchpad>/recheckNNN.json` → `node recheck_cmp.cjs <後> <前>` |
| 12 | 確かめ | `checks106.sh "<始まりの UTC>"`（drift・リンク・要確認・先の日付・行番号の形・行数・tag-check・approval-report・plan-report・ops） |
| 13 | コミット | 件名と本文を Write で scratchpad の `msgNNNx.txt` に書く → `git add <ファイル> && git commit -q -F "<scratchpad>/msgNNNx.txt"`。節ごとに 1 つ、最後に `_bridge/` |

req->bd の判定し直し：基本設計を直したら `find106.cjs <recheck の json>` で「引用が直した行にある判定」と「無効の判定」を拾い → `rejudge106.js`。

### 毎回つまずく所

- **ゲート（Stop hook）**：未分解が残ったまま `docs/` を書いたターンは終われない。宣言の `--edge`・`--file`・`--lines` を、その回に書く範囲に合わせる。`.claude/state/` と `.claude/coverage/` は直接書けない
- **commitlint**：件名は型から始め、型の後ろを小文字か日本語で始める。「G22」のような大文字の ID で始めると subject-case で拒まれた（実測 1 回）。100 文字以内
- **引用符**：`"bd->dd"` を裸で書くと `>` がシェルの向け先になり、空のファイルができる。子の役には `"bd-dd"` の形で渡す
- **heredoc**：使わない。台本もコミットの文も Write で scratchpad に書く。このターンも 1 回、heredoc で scratchpad に台本を書いてしまった（読むだけの台本）
- **`ops --expect` に入れ忘れるもの**：その回に打った書き込みを全部入れる（`judge,plan,sync,decompose,stale-diff,approve,harvest`。settle・hold を打った回はそれも）。入れ忘れると「想定外」に出る
- **decompose が拒むもの**
  - 要求の文と from が 1 語も共有しない。語は英字なら 3 文字以上（`ledger.mjs:78`）なので、`・\`id\`` だけの from は語が 0 で、要求の文に逐語で入っていないと拒まれる（`ledger.mjs:1557`）。turn 106 は `id` と `createdAt` を 1 つの要求にして通した
  - 件数の下限は「割り当てた区間の数」で数える。足りないときは skip を区間ごとに分ける
  - 括弧の中に句点があると、split.mjs が括弧の途中で単位を分ける。後ろの単位が注だけなら「要求ゼロ」（原文全体を 1 つの skip）にする
- **承認の expect**：断片の語を 1 つ以上そのまま入れる（1-1 の足した文）
- **recheck**：引用は ±3 行まで有効。基本設計の行数を変えると、下の行を引用している判定が大量に無効になるので、行数は変えない
- **Bash の cwd**：作業の途中で cwd が別のフォルダに移ることがある。パスは絶対パスで書く

## 4. 道具の側で直したほうがよいと思うもの

1. **判定を受け先ごとにまとめる形を coverage.js（か別の judge.js）に取り込む。** args で `groups` と `segment`（この回の範囲の文）を受ける形。今は毎回、前の写しの 5 行を行番号で書き換えていて、行がずれると止まる
2. **受け先を引く処理を `ledger.mjs` のサブコマンドにする**（要求 ID → 印 → ファイルと節）。今は `items105.mjs` が `ledger.mjs` をフルパスで読み込んでいて、リポジトリに置けない
3. **approve.js・settle.js に 1-1 の 2 行を入れる。** 写しの差分はこの 2 行だけなので、入れれば写しが要らなくなる
4. **decompose の語の共有で、`` ` `` で囲んだ識別子を語に数える**（英字 2 文字の `id` も）。または拒んだときに「要求の文に from を逐語で入れる」道を表示する
5. **recheck-evidence に「直した行を引用している判定」を出す形を足す**（`find106.cjs` の中身）。今の recheck は引用が残っていれば有効にするので、直した行の別の部分を引用していた判定は無効に出ず、本体が毎回 HEAD と比べて拾っている
