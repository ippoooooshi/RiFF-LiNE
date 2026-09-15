# v22 → v23 の移行

## 何が変わったか（1 段落）

判定材料を 2 つに分けた。**観測できる事実**（何を編集したか・検証が緑か）はゲートが毎回 `git` と
実行結果から自分で取り、`.claude/state/` を読まない。**観測できない意思**（ゴール・担当段・phase・adhoc）だけを
state に置き、`scripts/state.mjs` 経由でしか書けなくした。v22 は前者も state から読んでいたので、
`turn.json` を空にすればコードを編集したターンが素通りし、`verify.json` に `ok: true` を書けば
typecheck も test も走らなかった（どちらも実測）。

---

## 手順

**上書きコピーで入れ替えないこと。** 新版に無いファイル（`selftest.mjs`・`failures.md`）は
そのまま残り、「v22 の検査が今も効いている」という誤解の材料になる。実機で実際に残っていて、
その `selftest.mjs` は v23 の judge 仕様に追従しておらず 26 件失敗したままだった。
残骸は `check-legacy.mjs` が検出する（v23 で消したファイルも検出対象に入れてある）。

```bash
# 1. 旧構成を退避（丸ごと動かす。上書きしない。failures.md は捨てずに repo 外へ）
mv .claude .claude.v22.bak

# 2. v23 を展開して .claude を置く

# 2-b. 持ち越すもの（判定の実体。これだけ戻す）
cp -r .claude.v22.bak/coverage .claude/ 2>/dev/null
cp .claude.v22.bak/state/baseline.json .claude/state/ 2>/dev/null

# 3. 検査スクリプト自身が動くか（約 4 秒）
node .claude/scripts/smoke.mjs

# 4. 旧構成の残骸
node .claude/scripts/check-legacy.mjs   # 旧構成の残骸（v22 のファイルが残っていないか）

# 5. 現在地
node .claude/scripts/status.mjs --no-verify
```

`project.json` は v22 のものをそのまま使える（キーは増えていない）。
`.claude/coverage/` と `.claude/state/baseline.json` は**そのまま持ち越せる**。

---

## 移行時に必ず確認すること

`smoke.mjs` は hook が **Claude Code に解釈されているか**までは見られない。以下は実機で 1 ターン回して確認する。

| 確認 | なぜ | 確認できないと |
|---|---|---|
| `/remote-control` が通る | `env` にテレメトリ無効化があると初期化に失敗する（v23 で実際に踏んだ） | スマホ・ブラウザからセッションを引き継げない |
| Stop hook が実際にブロックする | `echo {} \| node gate.mjs stop` が通っても、Claude Code 経由で発火するとは限らない | 全部が助言になる |
| `settings.json` の exec 形式（`command` + `args`）が解釈される | 未対応版だと `node` が引数なしで起動する | **全 hook が黙って無効** |
| `permissions.deny` の `Edit(.claude/state/**)` が効く | ここが効かないと致命 1 が開いたまま | ゲートの条件を検査される側が書ける |
| Stop 1 回の所要時間 | typecheck / lint / test を毎ターン走らせる | 1800 秒を超えると無検査で通る |
| `Workflow({ name: 'coverage' })` が使える | `.claude/workflows/` からの読み込みは公式文書で確認できていない（未確認） | HOWTO の台帳運用が成立しない |

確認の仕方:

```bash
# exec 形式が未対応だった場合は、settings.json の hooks を文字列 1 本に書き換える
#   "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/gate.mjs\" stop"   （args は消す）
```

---

## 手順が変わったところ

| v22 | v23 |
|---|---|
| `current.json` を Write で直接編集 | `node .claude/scripts/state.mjs goal / phase / adhoc / clear` |
| `{ "phase": "adhoc", "why": "..." }` を書く | `node .claude/scripts/state.mjs adhoc "<理由>"` |
| `node .claude/scripts/selftest.mjs` | `node .claude/scripts/smoke.mjs`（120KB・302 プロセス・23 秒 → 約 4 秒） |
| `.claude/failures.md`（65KB） | `.claude/rationale.md`（1 ゲート 1 行）。元の記録は repo 外へ |
| `horizontal.mjs "<パターン>"` | `spread.mjs scan "<パターン>"`（`horizontal.mjs` は内部の検索本体。直接叩いても記録が残らない） |
| `judge 一致 '{"method":"..."}'` | `一致` / `部分` は**逐語引用が必須**。12 文字以上・下位の成果物・行番号 ±3 行 |
| `ledger.mjs judge ... --human` を AI が打つ | **PreToolUse が拒否する。** 本人がターミナルから直接打つ |
| `wpLedger.file` が空だと `start` が no-op | **エラーで止まる**（何も起きないのに「start しました」と報告されるのを防ぐ） |
| 単位の id が `file:line:hash6` | `file:hash8~n`。**行番号を含めない。** 位置は `anchor` という別の鍵で持つ |
| hunk の id が `@@` ヘッダ込み | 変更行（`+`/`-`）だけから取る。行がずれただけの hunk は判定を引き継ぐ |
| `settings.json` に破壊的コマンドを列挙 | 撤去。`gate.mjs` が**削除先のパスを解決して**判定する（`rm -fr /` も同じ扱いになる） |
| `ts-api` が関数内のローカル変数まで単位にする | トップレベルとクラスメンバーだけを見る。`private` は internal として分母から外れる |
| 言語指定の無いフェンス内の要求が分母から消える | 罫線だけの行を除き、本文として分母に入る |
| 変更履歴・リスク表が要求として数えられる | 段に `skipSections` を書いて外せる |
| `humanJudged: "partial"` が無視される | 実装した。人の判定が 1 件も無い段は完了にならない |

---

## 単位の id を作り替えた（既存の判定は自動で移行される）

v22 の unit id は `${file}:${line}:${hash6}` だった。**上位文書の先頭に空行を 1 つ足すだけで
以降の全単位の id が変わり、`sync` が引き継げず判定が丸ごと消えた**（実測 25 件）。
設計フェーズは文書に行を挿入し続ける作業なので、これは日常的に起きていた。
同じ理由で `ledger stale` は構造的に何も返せず（本文が変わると id も変わるので変化を見る分岐に
到達できない）、`split drift` の「変化」列も常に 0 だった。

v23 は 2 つの鍵を持つ。

| 鍵 | 中身 | 何に効くか |
|---|---|---|
| `id` | `${file}:${本文hash8}~${同一本文の出現順}` | **行が動いても変わらない**。報告や G 番号に書いた id が後から引ける |
| `anchor` | `${file}::${見出しパス}::${種別}~${出現順}` | **本文が変わっても残る**。同じ場所の本文が変わったことを検出できる |

`sync` の引き継ぎは 3 段階になる。本文が同じなら**そのまま引き継ぎ**、位置が同じで本文が
変わったなら**その単位だけ**を再判定に落とし（`staleFrom` と変更前の本文・以前の分解を保持）、
どちらでもなければ新規。**変更が波及するのは変わった単位だけ**で、文書全体ではない。

**移行は `sync` が自動で行う。** 旧 id を `${file}:${hash6}` で寄せて拾い直すので、
`.claude/coverage/` をそのまま持ち込んで `split.mjs --all` → `ledger.mjs sync "<edge>"` を
走らせれば過去の判定は残る（`smoke.mjs` がこの経路を検査している）。

```bash
node .claude/scripts/split.mjs --all
for e in "req->bd" "bd->dd" "dd->impl"; do node .claude/scripts/ledger.mjs sync "$e"; done
node .claude/scripts/ledger.mjs stale "bd->dd"   # 本文が変わっていた単位の確認
```

## 引き継がれないもの

- `.claude/state/current.json` — 形式は同じだが、`state.mjs` から置き直すこと（未知の phase が入っていると v23 は止まる）
- `.claude/state/verify.json` — 内容ハッシュを持つ形式に変わった。古いものは単に無視される
- `.claude/state/review.json` — hunk の id 形式が変わったので、レビュー中なら `diff-units.mjs split` をやり直す
