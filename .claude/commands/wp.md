---
description: 作業パッケージを1フェーズずつ進める。list / add / start / design / impl / review / done
argument-hint: list | add <ID> | start <ID> | design | impl | review | done
---

# 作業パッケージ

フェーズは**1コマンド1フェーズ**で進める。フェーズ間の橋渡しは会話ではなく**ファイル**（設計書と網羅台帳）で行う。まとめて自動で走らせない——設計→実装はコンテキストを共有し反復を要する区間で、そこを分離すると品質が落ちる。

引数: `$ARGUMENTS`

---

## `list`

いま何が在って、どれに着手できるかを見る。

```bash
node .claude/scripts/wp.mjs list
```

前提が未完のものは `·` で出て、**着手できるもの**が末尾に並ぶ。1 件も読めていないなら「パッケージが無い」のではなく**表の書式が違う**可能性を先に疑う。

---

## `add <ID>`

**新しい作業パッケージを起こす。** 既存のどれにも属さない仕事が出たとき——機能追加で要件が増えた、パッケージが大きすぎて割りたい、ギャップの繰り越し先が要る——はここから。

```bash
node .claude/scripts/wp.mjs add WP10 --name "ループ再生" \
  --done "小節範囲を指定して再生し、終了小節の後に開始小節へ戻ることを実機で確認" \
  --after "WP7" --scope "packages/core/src/playback/**"
```

機械が拒否するのは 3 つ。

| 拒否 | なぜ |
|---|---|
| 完了条件が空 | 誰が見ても同じ判定にならないパッケージは、一番早く終わる基準に収束する |
| 前提に実在しない ID | 実在しない前提は「順序を決めた」ことにならない |
| 範囲が実ファイルに当たらない | 空振りする範囲は、あとで「単位 0」を「漏れなし」と読む事故になる |

**完了条件が書けないなら、それは切り方が悪い。** 分割するか、検証可能な代理指標を決めてから追加する。

追加したら参照の健全性を見る。

```bash
node .claude/scripts/wp.mjs check    # 前提の実在・循環・ギャップの繰り越し先の実在
```

---

## `start <ID>`

1. `node .claude/scripts/wp.mjs start <ID>` — **前提が未完なら機械が拒否する**。台帳に無い ID も拒否する
   （順序そのものが誤っているなら、台帳の前提列を直してから着手する。**黙って飛ばさない**）

   `project.json` の `wpLedger.file` が空のままだと `start` / `add` は**エラーで止まる**。
   台帳が無い状態で「start しました」と報告されると、何も記録されていないのに
   着手したことになる。使うなら先に `wpLedger.file` を書いて `wp.mjs init`。
2. `node .claude/scripts/status.mjs` で現在地を確認する
3. 対象の読み合わせ — 該当する `docs/basic_design/*`、`docs/detailed_design/<スラッグ>.md`（あれば）、`00_reference.md` §3 §8.1（**関連する未解消ギャップを必ず確認**）、`13_design_decision_points.md` の未決着分岐点
4. **ゴールを置く。** 5要素が揃って初めてゴール。揃わないまま着手しない。

   | 要素 | 悪い例 | 良い例 |
   |---|---|---|
   | 識別子 | （無し） | `G-D1-b8` |
   | 達成状態（何が「在る」か。作業の列挙ではない） | 「リンクを直す」 | 「docs 配下の相互参照が実在ファイル・実在節のみを指している」 |
   | 検証手段（誰が見ても同じ判定。できればコマンド） | 「レビューで問題なければ」 | `node .claude/scripts/check-docs-links.mjs` が 0 件 |
   | 範囲外（＋その追跡先） | （書かない） | 「記法の統一は範囲外 → G38、次バッチで対応」 |
   | 再発防止（達成後、同じ崩れ方をどう機械的に止めるか） | 「今後気をつける」 | 「リンク検査に Markdown 相対リンクを追加し CI へ」 |

   **検証手段にコマンドを1つも書けないゴールは、切り方が悪い。** 分割するか、検証可能な代理指標を定義してから着手する。

5. **着手前に検証手段を空振りさせ、現在値を記録する。** 着手前の値が無いと「直った」を検証できない。
6. ゴールを書き込む。**`current.json` は直接編集できない**（ゲートが読む場所なので、
   検査される側が書けると「検査に通った」と「検査を消した」が区別できなくなる）。

```bash
node .claude/scripts/state.mjs goal \
  --unit "<パッケージ名 / サブ機能>" \
  --goal "<何が「在る」状態になれば完了か。作業の列挙ではない>" \
  --verify-by "<誰が見ても同じ判定になる手段。できればコマンド>" \
  --edge "bd->dd" --file "<対象ファイル名の一部>" \
  --out-of-scope "<範囲外とその追跡先>" --prevent "<再発防止>"

node .claude/scripts/state.mjs baseline "<検証コマンド>" "<着手前の値>"
node .claude/scripts/state.mjs phase design
node .claude/scripts/state.mjs show
```

薄いゴール（達成状態が 10 文字未満、検証手段が 6 文字未満）は機械が拒否する。

`ledger` は **この作業がどの段のブレイクダウンか**。設計フェーズなら `bd->dd`、実装フェーズなら `dd->impl`。
範囲（`file` / `section`）は担当パッケージに絞る——全件回すとトークンが重い（1 要求あたり約 12 万）。

置いたら分母を固定する。

```bash
node .claude/scripts/split.mjs --all
node .claude/scripts/ledger.mjs sync "<edge>"
node .claude/scripts/ledger.mjs pending "<edge>" --file "<範囲>"
```

**`pending` が「単位 0」と出たら、範囲指定が実ファイルに当たっていない。** 0 件を「漏れなし」と読まない。

7. ここで**止まる**。設計に入ってよいかを本人に確認する。

---

## `design`

`phase` を `design` にして `design` エージェントを起動する。完了したら止まって報告する。自動で `impl` へ進まない。

エージェントは**書く前に分母を固定し、書いたあと分母の全件を判定する**（`agents/design.md` §0 と末尾）。
未分解が残ったまま `docs/` を編集したターンは Stop hook が終わらせない。

報告には `node .claude/scripts/ledger.mjs pending "<edge>" --file "<範囲>"` の出力をそのまま貼らせる。
**「漏れはありません」という文は根拠にしない。** 台帳の未判定件数だけを見る。

---

## `impl`

`impl` エージェントを起動する。担当段を `dd->impl` に切り替えてから:

```bash
node .claude/scripts/state.mjs goal --unit "<作業名>" --goal "<達成状態>" --verify-by "<手段>" --edge "dd->impl" --file "<範囲>"
node .claude/scripts/state.mjs phase impl
```

この間、`docs/**` と既存テストへの書き込みは PreToolUse が拒否する。

実装は**未判定の要求を 1 件ずつ取り、その 1 件を実装してから次へ行く**（`agents/impl.md` の手順）。
詳細設計の項目と関数がほぼ 1 対 1 なので、まとめて書くと漏れる。

件数が多い作業パッケージは、判定をワークフローに任せてもよい。

```
Workflow({ name: 'coverage', args: { edge: 'dd->impl', file: '<範囲>', limit: 30 } })
```

---

## `review`

**まず分母を機械に固定させる。** レビューを「全部見た」と言えるかは、読む前に何 hunk あるかが決まっているかで決まる。

`phase` を `review` にしてから（`node .claude/scripts/state.mjs phase review`）:

```bash
node .claude/scripts/diff-units.mjs split          # git diff を hunk に切る（未追跡の新規ファイルも含む）
node .claude/scripts/diff-units.mjs pending
```

`current.json` の `phase` が `review` の間、**分母が固定されていないターンは Stop hook が終わらせない**。hunk 0 件は「差分が無い」ではなく「base の指定が外れている」可能性がある——split の出力がそう警告する。

次に `review` エージェントを起動する。**渡すのは hunk の id と受け入れ基準だけ**——設計／実装エージェントが書いた報告文は渡さない。エージェントは 1 hunk ずつ処理する。

```bash
node .claude/scripts/diff-units.mjs next 1         # 次に見る hunk
node .claude/scripts/diff-units.mjs show <id>      # その hunk の差分
node .claude/scripts/diff-units.mjs verdict <id> 問題なし '{"reason":"型定義の追加のみで、呼び出し側の挙動を変えない"}'
node .claude/scripts/diff-units.mjs verdict <id> 指摘あり '{"severity":"Blocking","file":"src/a.ts","line":42,"quote":"<逐語>"}'
```

判定は3つだけ。**「問題なし」にも理由が要る**（8 文字以上）——これがまとめて OK を流すことを防ぐ唯一の手段。「指摘あり」は evidence が実ファイルと照合され、一致しなければ書き込めない。Blocking 以外にしたときは `whyNotBlocking` が必須（`rules/core.md` §4）。

差分だけで判断できない hunk は、周辺の実ファイルを開いて読む。**差分の中だけを見て「問題なし」と書かない。**

指摘が出たら `critic` を起動し、1件ずつ `AGREE` / `DISAGREE_EVIDENCE` / `DISAGREE_CONCERN` を返させる。両者の出力を `node .claude/scripts/verify-evidence.mjs` に通し、**引用が実ファイルと一致しない指摘は無効化する**。

生き残った Blocking を `impl` / `design` へ差し戻す。差し戻し後に再度 `split` すると、**中身が変わっていない hunk の判定は引き継がれ、変わった hunk だけが未判定に戻る**。

---

## `done`

完了判定。以下がすべて揃うまで完了と呼ばない。

- [ ] `node .claude/scripts/verify.mjs` が緑（typecheck / lint / test / stubs / tests / docs）
- [ ] `node .claude/scripts/ledger.mjs pending "<edge>" --file "<範囲>"` で **未分解 0 かつ未判定 0**（`stats` の全体ではなく担当範囲で見る）
- [ ] 同じ出力の「不一致等」が 0、または残りが G 番号で起票済み
- [ ] `node .claude/scripts/diff-units.mjs pending` で **未判定 0**（分母が固定されていない状態の「指摘 0 件」は完了ではない）
- [ ] `review` の Blocking 0（`critic` を通過し、evidence が照合済みのもの）
- [ ] `node .claude/scripts/check-coverage.mjs` が緑（カバレッジを宣言しているなら、基準線より下がっていない）
- [ ] 着手前に記録した baseline と現在値を並べて記載した
- [ ] 再発防止を1つ足した（足せないなら `.claude/rationale.md` に理由を書いた）
- [ ] 繰り越しがあれば `00_reference.md` §8.1 に G 番号・担当作業単位・判定条件を書いた
- [ ] **本人による実アプリ確認**（見た目・音・操作感）が記録されている

最後の項目は AI が埋められない。`current.json` の `pendingHuman` に残っている間は完了と報告しない（これは手順上の約束で、Stop hook は判定しない）。台帳側の人間判定（`ledger.mjs judge --human`）は **AI が打てない**——PreToolUse が拒否するので、本人にターミナルから直接実行してもらうこと。**未達を事後にゴールの範囲外へ移して「達成」と呼ばない。**

すべて満たしたら `node .claude/scripts/state.mjs clear` で作業状態をクリアし、PR の作成は**本人の承認を得てから**行う。
