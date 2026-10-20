---
answering: 170
from: claude-code
to: claude-chat
at: 2026-10-20T13:47:13+09:00
---

## 0. 00 章（本人が 172 番をまだ打っていない）

- 00 章の本人の判断待ちは 3 のまま（`approval-report "bd-dd" --file "00_overview"`：抜き出した文 501・ダブルチェック済み 498・本人の判断待ち 3）。to-cc の 2 つは archive の t170 と `cmp` で同じ、`bd-dd.jsonl` に変更なし（`git status` に出ない）、このターンの進捗管理ファイルへの書き込み 0 件（`ops --since 2026-10-20T04:35:18Z`）
- 00 章で残っているのは 172 番の 3 件だけ。照合していない 1 件は 83 行の「システムを構成するモジュール／レイヤー」（本人の判断待ちのため照合していない）。同じ行の「その責務分担」は照合済みで一致（web-core-foundation.md 34 行を引用）。172 番を打った後に、これを数えない側へ分け直してそろえる
- 基本設計→詳細設計の全章：照合 5236/5237・ダブルチェック 9723/9727（残りは 00 章の 172 番の 3 件と、前からある「反論で維持」1 件。この 1 件の中身は確かめていない）・差し戻し 0・判断保留 0・ダブルチェック前 0・対応タグなし 0・行き先の無いタグ 0・引用切れ 0・照合で一致しなかったもの 69 件はどれも扱いの分類あり（下位を直す 68・スコープ外 1）
- bd->dd はまだ「進行中」（理由は未照合 1）。172 番を打って 83 行をそろえれば「完了」になる見込み（未確認（推測）。完了の条件は `ledger.mjs` 1186〜1194 行の順で、未照合 0 の後に「前後確認待ち」「人間判定待ち」を見る。どちらも今は 0）

## 1. 進捗管理ファイルの dd->impl の段

**分かったこと**
- 詳細設計の分け方：`.claude/coverage/units/dd.jsonl` は 7,061 の段落・表の行。このうち照合の対象が 4,467、照合の対象外（`judge: false`。対象外の節 project.json 58 行の `"既知のギャップ"` を含む）が 2,594。ファイルごとの対象（scratchpad の台本で数えた）：

  | 詳細設計 | 対象 | 対象外 |
  |---|---|---|
  | web-core-foundation.md | 945 | 503 |
  | screens-navigation.md | 822 | 445 |
  | editing-core.md | 756 | 409 |
  | data-model-persistence.md | 427 | 245 |
  | playback-integration.md | 419 | 305 |
  | 00_reference.md | 369 | 160 |
  | export-print.md（Phase 2） | 259 | 154 |
  | error-logging-foundation.md | 212 | 161 |
  | part-tuning-management.md | 137 | 111 |
  | view-modes.md | 89 | 79 |
  | phase1-productization.md | 32 | 22 |

- `edges/dd-impl.jsonl` は 4,467 件で、全部が要求の洗い出し前（stats の「陳腐化 1236」は前の詳細設計のときの記録）
- **dd->impl と dd->it は洗い出しとダブルチェックを分け合う**：`ledger.mjs` 582 行「なので分解したら兄弟エッジにも同じものを書く。承認も一緒に運ぶ——」、584 行「**判定は運ばない。** 判定だけは下位ごとに違う。」。実装の段で洗い出した要求は、そのまま結合テストの段の分母にもなる
- 実装の段の抽出（ts-api）：`lib/ts-api.mjs` 54〜97 行。取るのはトップレベルと namespace の中の class・interface・function・type・enum・const と、クラス／インターフェースのメンバー（method・property・accessor）。関数の中には降りない。`.test.ts(x)` は project.json 71〜74 行の `exclude` で外す。今のコードからは 1,922 個、うち外へ出していないもの（`internal`。export していない・private）379 個を除いた 1,543 個が impl->ut の分母。例：`WindowManager.focusExistingWindow`（`(songId: string): boolean`）・`MAX_CAPO_FRET`・`AddMemoCommand.estimateSizeBytes`。フォルダごと：editing 391・shared-types 127・parts 192・renderer 191・ui 183・playback 161・testing 149・persistence 135・main 105・domain 84・rendering 84・errors 61・viewmodes 49・platform 9・preload 1（外へ出していないものを含む数）
- **dd->impl の分母は詳細設計の段落・表の行（4,467）で、コードの API（1,543）ではない**。コードの API は impl->ut の分母
- 照合の道具がコードを受け先にできるか：
  - 対応タグの拾い方は `ledger.mjs` 678 行 `export const TAG_RE = /<!--\s*req\s+([^>]*?)\s*-->/g` で、行の文字列をそのまま見る（708〜723 行の `scanTags`）。コードの `// <!-- req ... -->` のコメントでも拾える見込み（未確認（推測）。コードのファイルで試していない）。拾う対象のファイルは `tierFiles(e.to)` で、実装の段の `sources` から `exclude` を引いたもの
  - 対応タグの形は `TAG_TOKEN_RE`（679 行）で、頭の章の名前は詳細設計のファイル名の英数字だけ（`tagOfEntryId` 690 行。例：`webcorefoundation:…`）。00_reference.md だけ `00:…`
  - judge-groups は受け先を対応タグが最初に当たったファイルと見出し（`^#{2,4}`、2705 行）でまとめる。コードには見出しが無いので、実質ファイルごとになる（`groupBy: "file"` と同じ）
  - judge-pack は対応タグの前後 3 行を渡す（2758 行 `BEFORE = 3, AFTER = 3`）。コードでも同じに動く見込み
  - **照合の引用に使えるファイルにテストが入る**：`ledger.mjs` 612〜615 行の `allowFilesFor` は `sources` だけを返し、`exclude` を見ない。実装の段の `sources`（`packages/*/src/**/*.ts` など）はテストにも当たるので、テストの文を引用して「一致」にできてしまう（未確認（推測）。実際に打っていない）

**分からないこと（未確認）**
- 詳細設計の 4,467 の段落・表の行から、要求がいくつ出るか（洗い出していない）。基本設計→詳細設計の比で見込むなら「要求の数 ≒ 対象の数 × 2.31」（5237 ÷ 2264。要求ゼロの段落・表の行も含めた比）
- tsx の JSX の中に `<!-- req -->` を書けるか（JSX の中では書けない見込み。`{/* */}` の中に書けば拾えるかは試していない）

**チャット側に決めてほしいこと**
- コードの対応タグの書き方（`// <!-- req webcorefoundation:… -->` の形でよいか、別の形にするなら道具の直しが要る）
- `allowFilesFor` がテストを引用元に入れる点を直すか（実装の照合でテストを引用させないなら、`exclude` を見るようにする）
- 00_reference.md（照合の対象 369）を、どの作業パッケージで照合するか（3 節の登録簿はパッケージごとに分かれているが、1 節・5 節・8.1 節は横断）

## 2. 対象外だけのダブルチェック

**分かったこと**
- approve-next（`ledger.mjs` 2809〜2873 行）は、範囲の中の「ダブルチェック前」を要求も対象外も区別せずに並べる（2845 行 `if (entryApproval(en).state !== '未承認') continue` の後に種類の絞りが無い）。対象外だけを並べる設定は無い
- ID で絞る手段はある：`--only-file`（2823 行）と approve.js の `idsFile`。対象外の文の ID は `.claude/coverage/edges/dd-impl.jsonl` を読む台本で並べられる（読むだけ）
- **ただし、要求をダブルチェックしないまま残すと止まる**：project.json 120 行で dd->impl は `"requireApproval": true`。`approvalCounts`（518〜535 行）は 533 行 `c.unresolved = c.unseen + c.challenged + c.deferred` で、ダブルチェック前の要求も数える。gate.mjs 862 行 `if (pend && pend.requireApproval && pend.approvalUnresolved > 0)` で、宣言した範囲にダブルチェック前が 1 件でも残ると、コードを書いたターンは終われない。stats の完了の条件（`ledger.mjs` 1190 行）も同じ数を見る
- dd->it と分け合うので、dd->impl でダブルチェックした結果は結合テストの段にも運ばれる（1 節）

**分からないこと（未確認）**
- 本人の決定「ダブルチェックは対象外にした文だけ全部」を、要求の側をどう扱って満たすか（要求を自動でダブルチェック済みにする・dd->impl の `requireApproval` を外す・対象外だけを数える設定を足す、のどれか）。どれも道具の直しか設定の変更が要る

**チャット側に決めてほしいこと**
- 要求の側のダブルチェックの扱い（上の 3 つのどれか）。`requireApproval` を外すと、対象外のダブルチェックも止める仕組みから外れる
- 「要求の一覧を 1 回まとめて見直す」役の置き場所。要求の一覧を並べて読み、古い決定の記録や重なりを見つける役は、見つからなかった（"見直|一覧を並べ|重なり" を `.claude/workflows/` で探し、当たった 2 件は approve.js 283 行と settle.js 281 行のコメントで、役ではなかった）

## 3. 自動の見張り（gate.mjs）と作り直しの相性

**分かったこと**
- 作業の種類は触ったファイルで決まる：gate.mjs 769 行 `const derivedPhase = touchedCode ? 'impl' : touchedDocs ? 'design' : null`。宣言は state.mjs の `phase design|impl|test|review`（767 行の文面）
- **前から在るテストは書き換えられない**：gate.mjs 600 行 `if (matchesAny(path, TESTS) && existedBefore && phase !== 'test')`。そのターンに新しく作ったテストは編集できる。前からのテストを直すには `state.mjs phase test --why "<仕様がどう変わったか>"`（606 行の文面）
- 実装の宣言中は `docs/**` を書けない（612 行）。設計の宣言中はコードを書けない（621 行）
- コードを触ったターンに課されるもの：
  - 宣言した範囲の要求の洗い出し前が 0（845 行）、ダブルチェック前が 0（862 行）
  - 同じ型の走査（spread.mjs、1025〜1061 行）。走査はそのターンの変更より新しく、触ったファイルに当たること
  - verify.mjs（1067〜1085 行）：typecheck・lint・test に加え stubs・tests・coverage・docs・config・wp（verify.mjs 64 行 `CODE_SET`）。stubs は基準線（9 件）より増えたら赤
- dd->impl の宣言で、書いたコードと宣言した詳細設計の範囲の対応は見ない：gate.mjs 891〜893 行「上位段が文書のエッジ（dd->impl など）は、編集したコードと設計書の対応がパスでは決まらないので、ここでは判定しない」。見るのは「実装の段のファイルを 1 つは書いたか」だけ（905 行・928 行）
- **作り直しで古いテストが壊れる**：コードの公開の形（関数の名前・引数）を詳細設計に合わせて変えると、前からのテストが typecheck か test で赤になる。テストは書き換えられないので、そのターンは緑にならない。逃げ道は `phase test` の宣言（記録が残る）か、テストを消すこと
- テストを消すこと自体は見張りが止めない見込み：gate.mjs 213〜242 行の `destructiveVerdict` は、消す先がプロジェクトの外か最上位のときだけ確認・拒否する（未確認（推測）。消して確かめてはいない）。ただし、テストを消して緑にするのは迂回に当たるので、チャット側と本人の決定が要る
- 新しい置き場所に作る道：project.json 65〜69 行の実装の段の `sources` は `packages/*/src/**/*.ts` などなので、新しく `packages/ui-desktop` を作れば自動で実装の段に入る。古い場所のコードを残したままでも見張りは止めない（見張りはコードとファイルの対応を見ないため）

**分からないこと（未確認）**
- 古いコードと新しいコードを並べたとき、typecheck・lint が通るか（名前の重なり・ESLint の import の禁止）。試していない
- 前からのテスト 86 本（check-tests の数）のうち、作り直しで壊れるものの数

**チャット側に決めてほしいこと**
- 古いテストの扱い：(a) 作業パッケージごとに `phase test` を宣言して、詳細設計に合わせて直す、(b) 古いテストを消し、単体テストは全パッケージの後でまとめて書く（本人の決定「実装→単体テストの確かめは全パッケージを作り終えた後」と合う）、(c) 新しい置き場所に作り、切り替えるターンで古いコードとテストを一緒に外す。どれも記録の残し方と、迂回にならないことを本人が決める必要がある
- 1 ターンで作る量：宣言した範囲（詳細設計のファイルか行）の要求の洗い出しとダブルチェックが、コードを書く前に全部済んでいる必要がある（845・862 行）。1 パッケージを 1 回の宣言にするなら、詳細設計の 1 ファイルの洗い出しを先に済ませる順になる

## 4. 作業パッケージと詳細設計の対応

**分かったこと**
- 実施順は基本設計 15 章 4.1 節（15_development_process.md 194〜204 行）。詳細設計のファイルとの対応（パッケージの名前とファイルの名前で対応を取った。00_reference.md 3 節の見出し 178〜310 行もパッケージ 1〜8 の順）と、照合の対象の数：

  | 順 | 作業パッケージ | 詳細設計 | 対象 | 要求の見込み（× 2.31） | 今のコードのフォルダ |
  |---|---|---|---|---|---|
  | 1 | Webコア基盤構築 | web-core-foundation.md | 945 | 約 2,180 | `packages/core/src/platform`・`rendering`・`packages/shared-types`・`apps/desktop/src/main`・`preload`。新しく `packages/ui-desktop`・`packages/ui-shared` |
  | 2 | データモデル・永続化 | data-model-persistence.md | 427 | 約 990 | `packages/core/src/domain`・`persistence` |
  | 3 | エラー・ログ基盤 | error-logging-foundation.md | 212 | 約 490 | `packages/core/src/errors` |
  | 4 | タブ譜編集コア | editing-core.md | 756 | 約 1,750 | `packages/core/src/editing` |
  | 5 | パート・チューニング管理 | part-tuning-management.md | 137 | 約 320 | `packages/core/src/parts` |
  | 6 | 表示モード | view-modes.md | 89 | 約 210 | `packages/core/src/viewmodes` |
  | 7 | 再生エンジン統合 | playback-integration.md | 419 | 約 970 | `packages/core/src/playback` |
  | 8 | 画面群・ナビゲーション | screens-navigation.md | 822 | 約 1,900 | `packages/core/src/ui`・`apps/desktop/src/renderer` |
  | 9 | Phase 1 完成・製品化 | phase1-productization.md | 32 | 約 75 | 横断 |
  | 横断 | — | 00_reference.md | 369 | 約 850 | — |

  Phase 1 の合計（export-print.md を除く）：対象 4,208・要求の見込み 4,208 × 2.31 ≒ 9,700
- 層とフォルダの対応の正は web-core-foundation.md 2.1 節（40〜48 行）。40 行は L1 に `packages/ui-desktop`、44 行は L2 に `packages/core/src/editing`・`packages/core/src/playback`・`packages/core/src/export`、48 行は層の外に `packages/core/src/errors` を置く
- **画面の置き場所が今と違う**：今のコードで `from 'react'` を import しているのは `apps/desktop/src/renderer` の 12 ファイルだけ（Grep で数えた）。詳細設計は web-core-foundation.md 143 行「React を import してよいのは `packages/ui-desktop` と `packages/ui-shared` だけ」で、今は `packages/ui-desktop`・`packages/ui-shared` が無い（`packages/*/package.json` は core と shared-types の 2 つ）

**分からないこと（未確認）**
- `parts`・`viewmodes`・`persistence`・`testing` の層の対応は 2.1 節の行を読んでいない（上の表はフォルダの名前からの推測）
- 要求の見込みは基本設計→詳細設計の比で見込んだもので、詳細設計の文の密度（表の行が多い）で変わる

**チャット側に決めてほしいこと**
- パッケージ 1 は 2,000 を超える見込みで、1 ターンで照合しきれる量（本人の決定）を超える。パッケージの中で詳細設計の節ごとに区切るか
- 00_reference.md の横断の分（1 節の対応先一覧・5 節のエラーコード表）を、どのパッケージに入れるか（1 節と同じ）

## 5. 今のコードで写して使えそうな所

**分かったこと**
- **今のコードは詳細設計の作り直しの前から変わっていない**：`git diff --stat 2759936 HEAD -- packages apps` が空。一方で詳細設計は 11 ファイル全部が大きく変わった（`git diff --stat 2759936 HEAD -- docs/detailed_design/`：5,677 行の足し・3,872 行の消し）。「詳細設計の作り直しで変わっていない所」は、ファイルごとに見ると 1 つも無い
- 8.1 節の未解消のギャップは 27 件（status.mjs）。行に書かれたフォルダ・詳細設計（scratchpad の台本で行から抜いた）：
  - フォルダが書かれたもの：`packages/core/src/parts`（G67・G73・G77・G78）、`domain`（G68・G71・G72・G73）、`persistence`（G66・G74）、`editing`（G69・G78・G79）、`rendering`（G76・G78）、`viewmodes`（G78）、`ui`（G65・G74）、`testing`（G33）、`apps/desktop/src/renderer`（G25・G65・G76）、`apps/desktop/src/main`（G65・G74）
  - 詳細設計だけが書かれたもの：error-logging-foundation.md（G31・G32・G39）、playback-integration.md（G35・G37）、data-model-persistence.md（G34・G39）、screens-navigation.md（G29・G37・G38）、web-core-foundation.md（G75）、part-tuning-management.md（G22）、テストの採番（G30）、14 章の見た目（G25）、08 章の重大な通知のダイアログ（G36）
- フォルダごとの見込み（深くは調べていない）：
  - ギャップの行にフォルダの名前が出てこないもの（Webコア基盤の G75 は CI の話）：`packages/core/src/platform`（9 個）・`packages/shared-types`（127 個）・`apps/desktop/src/preload`（1 個）。写せる見込みが一番高い
  - ギャップはあるが部品が多いもの：`errors`（61）・`playback`（161）は詳細設計の 3 件・2 件のギャップの所以外
  - 写せる見込みが低いもの：`parts`・`domain`・`persistence`・`editing`（設計とコードの違いが G 番号で 3〜4 件ずつ）、`apps/desktop/src/renderer`（置き場所が `packages/ui-desktop` に変わる・G25 の見た目が未到達）
  - G78 の行は「公開シグネチャが、詳細設計と今のコードで違う」で、parts・viewmodes・rendering・editing に当たる

**分からないこと（未確認）**
- 部品ごとに写せるかは、詳細設計とコードを突き合わせないと分からない（本人の決定どおり、写した部品も全件照合する）

**チャット側に決めてほしいこと**
- 写すかどうかを決める時期：作業パッケージの始めに、そのフォルダを詳細設計と照合してから決めるか、書く途中で部品ごとに決めるか

## 6. 時間の内訳

| まとまり | 始め | 終わり | 作業用の AI | 残り（CC 本体） |
|---|---|---|---|---|
| 前提の確認・00 章の残りの確かめ | 13:35 | 13:37 | 0 | 約 2 分 |
| 次の工程の下調べ（読むだけ） | 13:37 | 13:43 | 0 | 約 6 分 |
| 確かめ・報告・コミット | 13:43 | 13:47 | 0 | 約 4 分 |

- ワークフローは回していない（ダブルチェックの回も無い。172 番が打たれていないため）。止められた回数 0
