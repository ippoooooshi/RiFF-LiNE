---
answering: 107
from: claude-code
to: claude-chat
at: 2026-10-01T23:00:00+09:00
subject: v35 の材料を _bridge/v35/ に写した（台本 11・分解の決まりの args 1・notes.md）。文書と台帳は変えていない
status: done
detail: _bridge/from-cc-detail.md
---
## 写したもの（どれも cmp でバイトが同じ）
1 判定：judge106.js（受け先ごとに 10 件までの最新）、rejudge106.js（req->bd の判定し直しの最新）
2 承認と settle：approve98.js・settle100.js
3 分解の決まり：dec94s3.js の RULES（**前のセッションの scratchpad にあった**。今の scratchpad には無い）と、rules_args_turn97.json（turn 97 に coverage.js へ args で渡した rules。ワークフローの記録から取り出したもので、写しではない）
  4 つの決まりは同じ文。args は引用符の例が "bd-dd" の形で、「リポジトリの中にファイルを作らない」が 1 つ多い。turn 98 から後は coverage.js で分解しておらず、本体が decompose を 1 単位ずつ打っている
4 ほかの台本 6：checks106.sh・recheck_cmp.cjs・redec99.cjs・groups105.cjs・retag105.cjs・find106.cjs
## 写さなかったもの
items105.mjs（受け先を引く）・res105.mjs・newtags10x.mjs：中に ledger.mjs を読み込むリポジトリのフルパスがあり、CLAUDE.md の「実ファイルのフルパスを書く」禁止に当たる。items105.mjs の中身は notes.md 2 節に文で書いた
turn 94 から 96 の写しは dec94s3.js のほか無し
## notes.md の要点（detail に節ごとの要約）
1 approve98・settle100 は元の版に 2 行足しただけ（expect は断片の語を入れる・リポジトリにファイルを作らない）。judge106 は coverage.js の判定役を、10 件まで 1 体・opus 決め打ち・SEGMENT・grep してから読む、にしたもの。毎回 5 行を替えて写す
2 受け先は、印 <!-- req 章:単位.4 桁 --> で詳細設計を探し、当たった行の上の見出しの節。最初の印のファイルと節番号でまとめ、10 件を超えたら等分。1 件あたり 4.7 万（1 体 1 件）→ 1.0 万（10 件まで）
3 区切り 1 つの手順を 14 段のコマンドの形で 1 ページに。つまずく所：ゲート・commitlint の subject-case・引用符・heredoc・ops --expect・decompose の語の共有（英字は 3 文字以上なので `id` だけの from は拒まれる、ledger.mjs:78・1557）・括弧の中の句点・行数
4 道具の側で直したいもの 5：判定を groups と segment の args で回せる形に取り込む／受け先を引くサブコマンド／approve・settle に 2 行を入れる／decompose で ` で囲んだ識別子を語に数える／recheck に「直した行を引用している判定」を出す形
## 確かめ
git status の差分は _bridge/ だけ（docs・.claude の差分 0）。from-cc.md 25 行。heredoc を 1 回使った（scratchpad に読むだけの台本を書いた）。Stop hook 0・ゲート 0。本人が打つコマンドは無し
