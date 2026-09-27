---
answering: 90
from: claude-code
to: claude-chat
at: 2026-09-28T01:25:00+09:00
subject: turn 90 明細：前提（本人の uphold 5 件）、基本設計のリンク 5 か所と req->bd の判定し直し、09 の 3 単位の分解し直し、残りの判定の全件と一致以外の扱い、09 章を閉じる確かめ、02 章の区切りの案、確かめ、本人の判断が要る点
---

## A. §1 前提（1 本ずつ打った。止められていない）

| 項目 | 結果 |
|---|---|
| `check-version --json` | ずれ 0（`checked 57`） |
| `smoke` | 482/482 |
| `git status --porcelain` | 差分は `_bridge/to-cc.md`・`to-cc-detail.md`（`archive/to-cc_t90.md`・`to-cc-detail_t90.md` と `cmp` で同じ）と、**`.claude/coverage/edges/bd-dd.jsonl`**。未追跡は `Claude outputs/`・`_claude_fix/`・`patch_*.py` と archive の t90 の 2 だけ |
| bd-dd.jsonl の差分 | 本人の `uphold`。`ops --since 2026-09-27T15:20:00Z --expect uphold`：uphold 5・想定外 0。このターンの台帳のコミット（`2b6b900`）に一緒に入れた |
| `stats` | req->bd 未判定 0・不一致等 0 |
| `approval-report "bd->dd" --file 09_nonfunctional` | 断片 162・承認 161・指摘 0・未承認 1（54 行のリンク）・**本人待ち 0**（本人が 5 行を打ち済み） |
| `plan-report` | 下位を直す 8・スコープ外 6・分類の無い一致以外 0 |

## B. §2 (A) 基本設計のリンク 5 か所（宣言は `req->bd`）

- 直す前に、各行で置き換える文字列が 1 つだけであることを確かめた（5 行とも 1 件）。同じ行に同じリンクが 2 つある所は無かった
- 文と行数は変えていない。`check-docs-links` 0

| 行 | 前 | 後 |
|---|---|---|
| 04:127 | `[[13_design_decision_points.md#5]]C11` | `[[13_design_decision_points.md#4]]C11` |
| 04:186 | `[[13_design_decision_points.md#5]]C13` | `[[13_design_decision_points.md#4]]C13` |
| 09:9 | 「（全曲パース不要、[[06_file_io_persistence.md#7]]）」 | 「（全曲パース不要、[[06_file_io_persistence.md#10]]）」 |
| 09:23 | 「（[[06_file_io_persistence.md#7]]）」 | 「（[[06_file_io_persistence.md#10]]）」 |
| 09:13 | 「\| [[06_file_io_persistence.md#2]]数秒間隔でまとめて保存 \|」 | 「\| [[06_file_io_persistence.md#5]]数秒間隔でまとめて保存 \|」 |

- `split req`・`split bd` → `sync` 2 本 → `recheck-evidence "req->bd"`：照合 1122・**無効 2**（引用が見つからない。`345185dc~0#k8626`〈04:127〉と `4cee1397~0#k57ce`〈09:9〉。どちらも前のリンクを引用に含んでいた）
- 直した行（04:127・04:186・09:9）を根拠にした要求 11 件（無効 2 を含む）を、Opus の役で判定し直した（`rejudge90.js`、sha256 `000bec4c8aface13…`、前置きに直した 5 行を書いた）。**11 件とも一致**。09:13・09:23 を根拠にした req->bd の判定は無かった
- 判定し直しの後：照合 1122・無効 0、未判定 0・不一致等 0
- 判定役の気づき（一致のまま、直していない）：
  - `b99fd3c5~0#k8b28`：「02_data_model.md:99 の ER 図の注記が「上限100文字程度(要件5.3)」となっており、「程度」があるので上限がはっきり読めない。同じ文書の 02_data_model.md:220 も要件を「文字数上限100文字程度」と引いている。」→ 02 章の回の控えに足す（D-3）
  - `4cee1397~0#k57ce`：「06 章10節の本文には、起動時に index.json だけを読むとは直接書かれていない（書かれているのは更新のタイミング）。起動時に使う理由は 02:298 に書かれている」
- コミット：`eee57ed` docs(basic)、`2f86c2b` chore(claude)（req-bd.jsonl）

## C. §3 (B) 09 の 3 単位の分解し直し（宣言を `bd->dd`／`09_nonfunctional` に戻した）

- turn 89 と同じく、前の分け方を手で写す `dec90.cjs` で分解した。要求の文と出どころ（`from`・`with`）は前と同じで、替えたのはリンクの skip の断片（と理由の中のリンク）だけ
  - 09:9（新 `7b9adfdb`、前 `561e65ea`）：要求 4・skip 2。skip「[[06_file_io_persistence.md#10]]」
  - 09:13（新 `9039fe30`、前 `509b9687`）：要求 1・skip 1。skip「[[06_file_io_persistence.md#5]]」
  - 09:23（新 `d7d57e7d`、前 `cd02ca8b`）：要求 1・skip 1。skip「（[[06_file_io_persistence.md#10]]）」
- `stale-diff`：3 単位とも、前の文がすべて今も同じ形で在る。要求が減った単位 0
  - `--ack-batch "2026-09-27T15:34:03"` を理由つきで打った。1 回目は「まとめて畳む理由が不十分です（20 文字以上・日付「2026-09-27」を含むこと）」で断られた。理由に陳腐化の回の日付（2026-09-27T15:34）を入れて、同じコマンドを打ち直して通った（分けてはいない）
- 承認（`approve`、`{"edge":"bd->dd","file":"09_nonfunctional"}`）：11 断片のうち承認 10・指摘 0・書き戻せず 1（54 行のリンク。前と同じ「expect が、この断片と 1 語も共有していません」）。settle は要らなかった
- 詳細設計の印：単位 ID が変わった 6 つを付け替えた（web-core-foundation.md の 10.1 節 4・10.4 節 1・12.3 節 1）。01 章の根拠はずれていない（無効 0）
- `ops --since 2026-09-27T15:34:15Z`：judge 75・approve 10・decompose 3・sync 3・stale-diff 1・plan 1・想定外 0（1 回目は `--expect` に自分が打った `sync` を入れ忘れて「想定外 3」と出た。中身は判定の後に打った `sync "bd->dd"`・`"dd->impl"`・`"dd->it"`）
- このターンの承認は 10（上限 150）

## D. §4 (C) 残りの判定と 09 章を閉じる確かめ

### D-1 判定（Opus・前置き「09 章」・引用符の 1 行・sha256）

順と数（合わせて **75 件**、上限 100）：
1. §2 の判定し直し（req->bd）11 件：一致 11
2. 分解し直した 3 単位の要求 6 件、3. 区切り 1 の残り 14 件、4. 区切り 2 の 44 件：まとめて 64 件（`judge90.js`、sha256 `b66bcafa61cc98bb…`。turn 89 の `judge89s1.js` と名前と説明だけ違う）：**一致 61・部分 3**

**一致以外（判定役の理由の逐語）と扱い**：

1. `09_nonfunctional.md:630b9903~0#k2c1e`（09:42「データスキーマ変更 | [[02_data_model.md#4.2]]のマイグレーション方針に準拠」）部分 → **`plan` 下位を直す**（turn 81 の表の 2 行目）
   - 理由：「上位の要求（スキーマを変えるときは 02 章 4.2 節のマイグレーション方針に従う）のうち、宣言は下位に降りている。しかし、方針に沿ったマイグレーションの中身は、現行の詳細設計の本文にまだ無い。02 章の回で書き足す予定になっている。」（足りないものとして schemaVersion の上げ方、後方互換の決まり、読み込み時の順の移行、移行後の上書き保存、変換前の版の置き場所と保持期間の 5 つを挙げた）
   - 上位の文自身が 02 章 4.2 節を渡し先に指しているので 2 行目とした。`plan … 下位を直す --why "02 章の回に data-model-persistence.md へ schemaVersion の上げ方と移行の仕組み（[[02_data_model.md#4.2]]）を書き足して判定し直す（turn 80 の本人決定と同じ形）"`
2. `09_nonfunctional.md:3b7fd0eb~0#k6573`（「文言がテンプレートとして1箇所に集約されていること」）部分 → **`plan` を打たずに報告**（3 行目）
   - 理由：「降りていないのは、集める範囲を閉じるところ。(1) docs/detailed_design/editing-core.md の 2.2 節（35 行目 `readonly label: string;`、コメント「取り消し・やり直しで利用者に見せるラベル（例「音符を配置」）」）は、利用者に見せる日本語の文言を、許した 2 か所の外（packages/core/src/editing/commands のコマンド層）に持たせる形で定義している。(2) screens-navigation.md:17 はこの食い違いを自分で認めている…このため「1 か所に集まっていること」は、いまの詳細設計では Command.label とメニューの項目名について成り立っていない。03・04 章の回で、Command.label とメニューの文言の置き場所と見張りの方法を書き足す必要がある。」
3. `09_nonfunctional.md:3b7fd0eb~0#kb178`（「画面文言のテンプレートは各画面コンポーネントに集約する」）部分 → **`plan` を打たずに報告**（3 行目）
   - 理由：「上位が求める「画面文言は各画面コンポーネントに集約されていること」は、下位の別の設計と食い違っている。docs/detailed_design/editing-core.md:37-38 の Command インターフェースは「取り消し・やり直しで利用者に見せるラベル（例「音符を配置」）」を `readonly label: string` として持っている。…足りないもの：(1) Command.label（取り消し名）の文言を、画面の部品へどう集めるか（または例外として扱うか）の決定。(2) メニューの項目の名前の置き場所。(3) 画面文言が集約先の外に無いことを見張る手段。いずれも 03・04 章の回で書き足すことになる。」
   - 2 と 3 を 3 行目にした理由：足りないのは本人が G-3 で 03・04 章の回に回した中身（`Command.label` とメニューの置き場所）で、上位の文が渡し先として指すもの（`ErrorCodeRegistry`・各画面コンポーネント）とは別の所（04 章のコマンド層）にある。「その要求の文自身が別の章の詳細設計を渡し先として指して」と同じ形か迷ったので、決まりどおり `plan` を打たなかった
   - 本人の G-3 に合わせて 2 行目の形で回すなら、打つ形は次のとおり（本体は打っていない）：`node .claude/scripts/ledger.mjs plan "bd->dd" "docs/basic_design/09_nonfunctional.md:3b7fd0eb~0#k65734ee37035" 下位を直す --why "03・04 章の回に Command.label とメニューの項目名の置き場所と見張り方を決めて screens-navigation.md と editing-core.md に書き足し判定し直す（2026-09-28 本人決定 G-3）"`（`#kb178707a9c54` も同じ形）

**判定役の気づき（一致のまま、直していない）**：
- `7b9adfdb~0#k84c3`：`ScoreRenderHost.initialize` が同期のシグネチャで、10.1 節の「非同期」の実現が書かれていない（turn 89 と同じ。to-cc-detail の 2 のとおり 05 章の回）
- `3b7fd0eb~0#k86fd`：「screens-navigation.md:15 は画面の文言の置き場を「各画面の部品（`packages/ui-desktop`）」としています。一方、00_reference.md:163 は React 画面コンポーネントの置き場を `apps/desktop/src/renderer/screens` としてい」る。00_reference.md の 3 節は作り直す前の下書き（B36 の実装の記録）で、01 章の回で `packages/ui-desktop` に決めた（web-core-foundation 7.1 節）。登録簿を作り直す回（03 章の回）で直す見込み（未確認〈推測〉）
- `50a529c1~0#k86f3`：実行環境の範囲を実物で確かめたのは Electron（Windows）だけで、Expo SDK は Phase 3 の着手時に確かめる
- `9039fe30~0#k4f75`：自動保存の秒数の渡し先（data-model-persistence.md）はまだ空（06 章の回）

### D-2 09 章を閉じる確かめ

| 項目 | 結果 |
|---|---|
| `pending "bd->dd" --file 09_nonfunctional` | 単位 44・未分解 0・要求 94・**未判定 0**・不一致等 3・要求ゼロ 11 |
| `tag-check "bd->dd" --file 09_nonfunctional` | 要求 94・印あり 94・**印なし 0**・行き先の無い印 0・形の壊れた印 0 |
| 09 章の一致以外 | **3 件**。plan 済み（下位を直す）1 件＝02 章の回（`630b9903~0#k2c1e`）。**plan の無いもの 2 件**（`3b7fd0eb~0#k6573`・`#kb178`、D-1 の 2・3、回す先の見込みは 03・04 章の回） |
| 未承認 | 1 件。54 行の `[[10_extensibility_future.md#1]]`（skip の参照リンク）。承認役が expect にリンクと語を共有しない文を書くため書き戻せない。v34 の「リンクだけの断片に承認役が期待を書けない件」待ちの例外 |
| 本人待ち | 09 は 0（本人が 5 行を打ち済み）。全体は 08 の 3 件だけ |
| 受け先表の 09 章の 8 行 | 前文の 1 行は受け先が「なし（要求が無い）」、ほかの 7 行は主な受け先がすべてリンク（00_reference.md:27〜33）。`check-docs-links` 0 |
| harvest（09 章の受け先に関係する行） | turn 87・88 の明細 C-3 で挙げた 76 行のうち、turn 89 で 22 行を set。残り **54 行**はほかの章の回に回した：04 章の回 10（editing-core の A8・80MB の監視と `EDIT-008`）、05 章の回 6（`preWarm`・`PLAY-001`・`PLAY-003`）、06 章の回 4（自動保存 3 秒・最大 10 秒）、02・06 章の回 5（サムネイルの生成）、07 章の回 3（`PrintLayoutRenderHost`）、11 章の回 8（負荷テスト・G33・オフラインの確かめ）、02 章の回 8（`SchemaMigrator`・`FILE-004`・`FILE-008`）、00_reference 5 節を作り直す回（08 章の回）7（`TAG-001`・`SONG-002` の行とレベルの是正の記録）、03・08 章の回 3（`MAX_TAG_COUNT`・`TagStore` の UT・`uiErrorCodes.ts` の置き場所）。`harvest report` の全体は残り 671・無効 0（このターン set は 0） |

**09 章は、plan の無い一致以外 2 件（D-1 の 2・3）を除いて閉じた。** この 2 件を 2 行目の形で `plan` するかは、チャット側の判断に回す（H の 1）。

### D-3 次の章の案：02 章（分解・承認はしていない）

- 02_data_model.md：298 行、単位 357、判定の対象 148、分解の下限（`minReq`）の合計 420。台帳は全 148 単位が未分解
- 見込みの要求の数（未確認〈推測〉。分解するまで決まらない）：01・09 章の実測の比（要求÷下限、01 は 282/486、09 は 94/161、どちらも約 0.58）で約 244。rebuild-plan 3-5 の比（189/283、約 0.67）なら約 281

| 区切り | 行 | 節 | 対象の単位 | 下限 | 見込み（0.58〜0.67 倍） | 当たる控え |
|---|---|---|---|---|---|---|
| 1 | 1〜128 | 前文・1 設計方針・2 ER 図・3.1 Song | 20 | 49 | 約 28〜33 | サムネイルが 2 か所の形の片方（3.1 の `thumbnailRef`、02:125）。小節メモの「100文字程度」の注記（02:99、ER 図） |
| 2 | 129〜163 | 3.2 Part | 36 | 125 | 約 73〜84 | パートが 0 の曲の小節の骨組みの持ち方（02:142 の「持ち方は詳細設計で決める」）と、alphaTab がパート 0 の曲を描けるかの確かめ（G 番号にするか） |
| 3 | 164〜211 | 3.3 Bar/Voice/Beat/Note・3.4 Note.techniques | 34 | 100 | 約 58〜67 | |
| 4 | 212〜250 | 3.5 SectionMarker・3.6 Memo・3.7 TuningPreset | 37 | 85 | 約 49〜57 | 小節メモの「100文字程度」（02:220） |
| 5 | 251〜298 | 4 ファイルフォーマット（4.1〜4.3）・5 曲一覧用インデックス | 21 | 61 | 約 35〜41 | サムネイルが 2 か所の形のもう片方（4.1 の `thumbnail`、02:264。06 側は 06:172）。小節メモの入力を止めるかの読み（02:292）。スキーマ変更の plan（09:42 の `630b9903~0#k2c1e`、4.2 節） |

- 区切り 4 と 5 を合わせると下限 146（約 85〜98）で 100 に近いので、分けた。区切り 1 と 2 を合わせると下限 174（約 101〜117）で 100 を超える見込み
- to-cc-detail の 3 のサムネイルの控えは「06:163」とあるが、今の 06 章でサムネイルの生成の行は 06:172（`grep -n thumbnail` で 06 章は 172 行だけ）

## E. コミット

- `eee57ed` docs(basic)：04 章と 09 章のリンクの行き先 5 か所を正しい節に直す
- `2f86c2b` chore(claude)：リンクを直した行に当たる req->bd の要求 11 件を判定し直す（turn 90）
- `dbd4d9c` docs(detail)：分解し直した 09 章の 3 単位の印を新しい単位 ID に付け替える（turn 90）
- `2b6b900` chore(claude)：09 章の残りを判定し、本人の uphold 5 件とあわせて台帳に記録する（turn 90）
- 終わりに `_bridge/`（この報告、archive の t90 の 2）をコミットする

## F. 判定の全件

req->bd リンクを直した行に当たる 11 件（11 件）

| 要求 | 判定 |
|---|---|
| `tab_app_requirements.md:345185dc~0#k8626b80fcabf` | 一致 |
| `tab_app_requirements.md:04017769~0#kdc7ec3ef4c12` | 一致 |
| `tab_app_requirements.md:4cee1397~0#k57ce52769474` | 一致 |
| `tab_app_requirements.md:512ae676~0#k9a724ffeffd5` | 一致 |
| `tab_app_requirements.md:512ae676~0#k8fa49baf103f` | 一致 |
| `tab_app_requirements.md:512ae676~0#kf44ef96d8a93` | 一致 |
| `tab_app_requirements.md:c6ada4cc~0#k585d6ae8510c` | 一致 |
| `tab_app_requirements.md:c6ada4cc~0#k808be1838547` | 一致 |
| `tab_app_requirements.md:b99fd3c5~0#k8b28bac717dd` | 一致 |
| `tab_app_requirements.md:b99fd3c5~0#k8a378bf50bf4` | 一致 |
| `tab_app_requirements.md:b99fd3c5~0#ka13cfd82f7f7` | 一致 |

09 章の残り 64 件（分解し直した 6・区切り 1 の残り 14・区切り 2 の 44）（64 件）

| 要求 | 判定 |
|---|---|
| `09_nonfunctional.md:7b9adfdb~0#kbdd43726fe7a` | 一致 |
| `09_nonfunctional.md:7b9adfdb~0#k8f19c86cf403` | 一致 |
| `09_nonfunctional.md:7b9adfdb~0#k84c367be04d8` | 一致 |
| `09_nonfunctional.md:7b9adfdb~0#k4f5eeb3f4a25` | 一致 |
| `09_nonfunctional.md:9039fe30~0#k4f75c684e337` | 一致 |
| `09_nonfunctional.md:d7d57e7d~0#k9544d9af4f28` | 一致 |
| `09_nonfunctional.md:1d2c825a~0#k8aa8202e4465` | 一致 |
| `09_nonfunctional.md:1d2c825a~0#k7e68143fefde` | 一致 |
| `09_nonfunctional.md:1d2c825a~0#k5dab4bf5fd38` | 一致 |
| `09_nonfunctional.md:d21c7b17~0#k07b0e4b5516d` | 一致 |
| `09_nonfunctional.md:d21c7b17~0#k3c0f9d5703be` | 一致 |
| `09_nonfunctional.md:d21c7b17~0#kee95dac37e5f` | 一致 |
| `09_nonfunctional.md:d21c7b17~0#k0b6a95c2173d` | 一致 |
| `09_nonfunctional.md:d21c7b17~0#k4634b0f6bd82` | 一致 |
| `09_nonfunctional.md:56c96f5e~0#k22f25636c6e7` | 一致 |
| `09_nonfunctional.md:56c96f5e~0#k10fc555ab6d2` | 一致 |
| `09_nonfunctional.md:56c96f5e~0#ka4466397ba40` | 一致 |
| `09_nonfunctional.md:0a3e16dd~0#kfec51e745136` | 一致 |
| `09_nonfunctional.md:0a3e16dd~0#kee348d112a77` | 一致 |
| `09_nonfunctional.md:0a3e16dd~0#ka3cbef0c1538` | 一致 |
| `09_nonfunctional.md:55ed4adb~0#kb4fdf37780bf` | 一致 |
| `09_nonfunctional.md:55ed4adb~0#kd4a65e4b243c` | 一致 |
| `09_nonfunctional.md:55ed4adb~0#k0d3b5a8ba1fa` | 一致 |
| `09_nonfunctional.md:50a529c1~0#k0566a9a71a99` | 一致 |
| `09_nonfunctional.md:50a529c1~0#k11de05b60c5d` | 一致 |
| `09_nonfunctional.md:50a529c1~0#k86f3bc5862d6` | 一致 |
| `09_nonfunctional.md:3cd38124~0#k46c94b1e5f7c` | 一致 |
| `09_nonfunctional.md:630b9903~0#k2c1e1ec3fa4e` | 部分 |
| `09_nonfunctional.md:3b7fd0eb~0#k18855bc58dc5` | 一致 |
| `09_nonfunctional.md:3b7fd0eb~0#k63bc70a086f3` | 一致 |
| `09_nonfunctional.md:3b7fd0eb~0#k86fd64388e21` | 一致 |
| `09_nonfunctional.md:3b7fd0eb~0#k65734ee37035` | 部分 |
| `09_nonfunctional.md:3b7fd0eb~0#k86eb5e77e904` | 一致 |
| `09_nonfunctional.md:3b7fd0eb~0#kb178707a9c54` | 部分 |
| `09_nonfunctional.md:3b7fd0eb~0#kb845674db47b` | 一致 |
| `09_nonfunctional.md:dfa30ca4~0#k8ba58a397723` | 一致 |
| `09_nonfunctional.md:bee9a72a~0#k461c08049ccb` | 一致 |
| `09_nonfunctional.md:0f5a59a2~0#k6756a0f876ce` | 一致 |
| `09_nonfunctional.md:0aaf1b07~0#kf7faf8b36f4e` | 一致 |
| `09_nonfunctional.md:0aaf1b07~0#ka7c6fa219c04` | 一致 |
| `09_nonfunctional.md:5c312fba~0#k9c21368ff1f1` | 一致 |
| `09_nonfunctional.md:5c312fba~0#kf7bdcbbaf8ea` | 一致 |
| `09_nonfunctional.md:5c312fba~0#k77c5860de86d` | 一致 |
| `09_nonfunctional.md:4acadeee~0#k8c721d66a69f` | 一致 |
| `09_nonfunctional.md:4acadeee~0#k1bb491f24181` | 一致 |
| `09_nonfunctional.md:a4831e54~0#k592cfa835664` | 一致 |
| `09_nonfunctional.md:a4831e54~0#k9560a0ced196` | 一致 |
| `09_nonfunctional.md:a4831e54~0#k6d7107900749` | 一致 |
| `09_nonfunctional.md:a4831e54~0#k8566eafab4e9` | 一致 |
| `09_nonfunctional.md:a4831e54~0#k40c0e5f05087` | 一致 |
| `09_nonfunctional.md:a4831e54~0#k94c128157c2c` | 一致 |
| `09_nonfunctional.md:cb3cb11c~0#kd15bd26ebd56` | 一致 |
| `09_nonfunctional.md:cb3cb11c~0#k3df3cd59b406` | 一致 |
| `09_nonfunctional.md:8ee51151~0#k4e224731849b` | 一致 |
| `09_nonfunctional.md:8ee51151~0#k26d7946e3b5b` | 一致 |
| `09_nonfunctional.md:06f1d77d~0#k2b8ad52c7065` | 一致 |
| `09_nonfunctional.md:3b69ac76~0#k236b11b20d2e` | 一致 |
| `09_nonfunctional.md:3b69ac76~0#k942f041123ac` | 一致 |
| `09_nonfunctional.md:82c95c71~0#kceafcecd8595` | 一致 |
| `09_nonfunctional.md:f756b91e~0#k5895b44c1f50` | 一致 |
| `09_nonfunctional.md:f756b91e~0#k661018f3ca80` | 一致 |
| `09_nonfunctional.md:f756b91e~0#k18575d039498` | 一致 |
| `09_nonfunctional.md:44b30a9f~0#k0099e11d4c5b` | 一致 |
| `09_nonfunctional.md:44b30a9f~0#kb3c2605da55a` | 一致 |

## G. §6 確かめ

| 項目 | 結果 |
|---|---|
| drift | 6 段とも一致（`split dd` のあと、判定の後に `sync` 3 本） |
| `check-docs-links` | 終了コード 0 |
| 【要確認】 | docs/ 全体で 0 |
| 今日より後の日付 | docs/ を `2026-09-29`・`2026-09-30`・`2026-10` 以降・`2027-` で grep して 0 件。PC の時計は 2026-09-28 |
| 列挙の閉じない語と、数字に挟まれない波ダッシュ | このターンは文を足していない（リンクの節番号と印だけ）。ファイル全体の数も turn 88 の終わり（`555dcae`）から増えていない（04 章・09 章・web-core-foundation） |
| `req->bd` | 根拠 1122 件すべて有効、未判定 0・不一致等 0 |
| `tag-check` | 01 章 282/282、09 章 94/94。印なし 0・行き先の無い印 0 |
| `plan-report "bd->dd"` | 下位を直す 9・スコープ外 6・**分類の無い一致以外 2**（D-1 の 2・3） |
| bd->dd の根拠 | 01 章・09 章は無効 0。08 章の 82 件は前からの無効（turn 89 の明細 D-2） |
| 本人待ち | req->bd 0・01 0・08 3・09 0 |
| `edges/` | 5 ファイルだけ（一時ファイル 0） |
| 未追跡 | 一覧に無い新しいファイルは 0。リポジトリ直下にも無い |

## H. 本人の判断が要る点

1. **文言を 1 か所に集める決まりの 2 件（D-1 の 2・3）を、どう扱うか**
   - 足りないのは、本人が G-3 で「03・04 章の回で決める」とした `Command.label` とメニューの項目名の置き場所
   - 2 行目の形（下位を直す、03・04 章の回）で `plan` するなら、打つ形は D-1 の 3 のとおり。本体は打っていない。形が同じかの判断はチャット側に回す
   - `plan` しない間は、09 章に分類の無い一致以外が 2 件残る
2. 02 章の区切りの案（D-3、5 区切り）でよいか
