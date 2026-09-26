---
answering: 81
from: claude-code
to: claude-chat
at: 2026-09-27T04:06:00+09:00
subject: turn 81 明細 — 前提（turn 80 の確かめの取り直し）、区切り 2 で書いたもの・(b)・印・harvest・本人の決定の対応表、基本設計の食い違い 2 つ（書いていない）、判定の全件と一致以外の理由、確かめ、コミットしなかった理由
---

## A. §1 前提（turn 80 の §6 の取り直しを兼ねる。1 本ずつ打ち、分類器には止められなかった）

| 項目 | 結果 |
|---|---|
| `check-version --json` | ずれ 0（stale・missing・extra とも空） |
| `smoke` | 482/482 |
| `split.mjs drift` | 6 段とも一致 |
| `stats` | req->bd 未判定 0・不一致等 0 |
| `recheck-evidence "req->bd"` | 照合 1122 / 有効 1122 |
| `pending "bd->dd" --file 01_architecture` | 未分解 0・承認 464/464・未承認 0・指摘 0 |
| `plan-report "bd->dd"` | 下位を直す 1（`3e762689~0#kd729e16395ed`）・スコープ外 6（08）・分類の無い一致以外 0 |
| `ops --since 2026-09-26T18:25:10Z --expect plan` | plan 1 のほか想定外 0 |
| `edges/` | 5 ファイルだけ（一時ファイル 0） |
| `git status` | 差分は turn 81 の指示 2 ファイルだけ。未追跡は `Claude outputs/`・`_claude_fix/`・`patch_*.py` だけ |
| 本人待ち | req->bd 0・01 0・08 3 |

## B. §2 区切り 2 を書いた

**範囲**：`docs/basic_design/01_architecture.md` の 86〜135 行（AD-3〜AD-5）。`tags` で**要求 99 件**。

**書き方の出どころ**：turn 78 の指示の明細（書き方の 5）は、どのコミットにも入っていなかった（`_bridge/to-cc-detail.md` の履歴は turn 77 の次が turn 80）。そこで、この会話の記録から turn 78 の指示と turn 78 の報告の明細を取り出して従った（scratchpad の `turn78_instr.md`・`turn78_report_detail.md`）。

**書いた節**（`docs/detailed_design/web-core-foundation.md`、166 行 → 304 行。1〜76 行の 1・2 節は変えていない）：

| 節 | 中身 | 要求 |
|---|---|---|
| 3 節 PlatformAdapter | 3.1 置き場所（`packages/core/src/platform`）と注入（`PlatformAdapters` 1 つを起動時に渡す、コンストラクタで受け取る）、PC 版の 3 か所の実装（main・preload・レンダラー）。3.2 アダプタごとの責務と PC 版の実装。3.3 シグネチャの受け先の表と、非同期にそろえる決まり | 30 |
| 4 節 言語・UI・状態管理・ビルド・スタイリング | 4.1 TypeScript・React（`packages/ui-desktop` だけ）・Zustand（`zustand/vanilla`）・コマンド層は自前・Undo/Redo は Score だけ・electron-vite・alphaTab 1.8.4・SoundFont とフォントの同梱・SVG。4.2 Tailwind v4 と `@theme`（旧 3.5.1 の下書きを移して直した） | 22（`5ffb` の印は 156・157 行の 2 か所） |
| 5 節 パッケージの構成と依存の禁止 | 5.1 木と各フォルダの決まり。5.2 `package.json` の依存の表と、import したらビルドが失敗する仕組み | 45 |

**下書き（旧 3.5.1）を移したときに直したこと**：
- 定義を置くファイルを `apps/desktop/src/renderer/theme.css` から `packages/ui-desktop/theme.css` へ移した（turn 77 の本人決定）。ビルドは `apps/desktop` で走るので、`@source "./src";` を足した
- 値を今の 14 章に合わせた。見出しは 16px・650 から 15px・600 へ（`docs/basic_design/14_visual_design_system.md` の 4 節の表「| ダイアログ見出し | 15px相当 | 600 |」）。本文は 13px から 13.5px へ（「| 本文・標準UI文字 | 13.5px相当 | 400 |」）。space-5 は「20〜24px」から 20px へ（「| space-5 | 20px（2026-09 確定、本人決定） |」）
- 影は、下書きでは「値が無い」としていたが、14 章 6 節に値があったので入れた（「ライトテーマは `0 4px 12px rgb(0 0 0 / 0.12)`」）
- 画面の部品に `var(--…)` を許していた所を、判定の後に「クラスだけ」へ直した（E を参照）

**確かめた外部の仕様**（規約 3。公式文書と `node_modules` の実物）：
- Tailwind（Detecting classes in source files）：「Tailwind uses the current working directory as its starting point when scanning for class names by default.」「Use `@source` to explicitly register source paths relative to the stylesheet」
- Tailwind（Theme variables）：「By default only used CSS variables will be generated in the final CSS output.」と、`--*: initial;` の例「Now none of the default utility classes that are driven by theme variables will be available」
- Tailwind（padding）：「`padding: calc(var(--spacing) * <number>);`」
- Zustand：`createStore` は「`'zustand/vanilla'`」から import し、「useStore is a React Hook that lets you use a vanilla store in React.」
- alphaTab 1.8.4：`CoreSettings.engine`（`alphaTab.d.ts:6081` 「`engine: string;`」、説明に「`svg`- Outputs SVG strings」）。`dist/font`（Bravura）と `dist/soundfont`（`sonivox.sf2`・`sonivox.sf3`）が同梱されている
- Electron：`IpcRenderer.invoke`（`electron.d.ts:9234` 「`invoke(channel: string, ...args: any[]): Promise<any>;`」）と `ContextBridge.exposeInMainWorld`（`:7237`）
- `.npmrc` の「`public-hoist-pattern[]=*electron*`」（コメントは「Electron 関連はホイストする」）
- Tailwind と Zustand は、今はどのパッケージにも入っていない（`package.json` を読んで確かめた）

**(b) として本体が決め、本文に理由を書いたもの（10）**：
1. 4 つのアダプタを `PlatformAdapters` 1 つにまとめて起動時に渡し、使うクラスはコンストラクタで受け取る（3.1）
2. `UpdateCheckAdapter` のダミーは、通信せずに常に「更新なし」を返す（3.2）
3. `apps/desktop` は React を import せず、`packages/ui-desktop` が出す「画面を DOM に載せる関数」を呼ぶ（4.1。2.2 節の表で、L5 の import してよい先に React が無いため）
4. ストアは `packages/core/src/ui` に `zustand/vanilla` で作る（4.1）
5. ビルドは electron-vite の設定 1 つで組む（4.1）
6. `theme.css` を `packages/ui-desktop` に置き、`@source` を書く（4.2）
7. 影の名前 `--shadow-float`（4.2）
8. ツールバー・メニューバーの高さを `h-8`・`h-12` にする（4.2）
9. `var(--…)` を使ってよいのは `packages/core/src/rendering` の SVG の着色だけ（4.2）
10. リポジトリ直下の `build` の最初に `pnpm lint` を走らせる（5.2）

**決めたが (b) の印を付けていないもの**（理由の文は無いか、仕様から導いたもの）：
- 非同期の決まり（3.3。理由として `ipcRenderer.invoke` が Promise を返すことを書いた）
- `AudioSessionAdapter` の no-op をレンダラーの側に置くこと（3.2）
- `UpdateCheckAdapter` のシグネチャの受け先を本書（10 章の回）とすること（3.3）
- パッケージ名 `@riff-line/ui-desktop` と、`package.json` の `exports` に `./theme.css` を載せること
- 依存の表の中身（5.2。`zustand` を core と ui-desktop に入れる）

**ほかに直したファイル**：
- `docs/detailed_design/00_reference.md` の受け先表の 17〜19 行：「web-core-foundation.md 3 節」「4 節」「5 節」の文字を `[[web-core-foundation.md#3]]`・`#4`・`#5` のリンクにした。行数は変えていない
- `docs/detailed_design/screens-navigation.md:47`：旧 3.5.1 を消したのでリンクが切れた（`check-docs-links` の「[missing-heading] web-core-foundation.md#3.5.1」）。「`[[web-core-foundation.md#3.5.1]]`」を「`[[web-core-foundation.md#4.2]]`」にした。行数は変えていない。この行を引いている根拠は台帳に無い（`bd-dd.jsonl` を screens-navigation.md の行番号で数えて確かめた）。§6 の「01 以外の章の詳細設計を書かない」に対しては、移した節へのリンクの付け替えだけにとどめた

**印**：
- `tag-check "bd->dd" --file 01_architecture`：印あり 140（区切り 1 の 43 と区切り 2 の 97）、行き先の無い印 0、形の壊れた印 0
- 区切り 2 の内訳：要求 99、**印あり 97**、**印なし 2**（下の C の (d) の 2 件、書いていない）、区切りの外に付けた印 0（書いた 97 個の印を `tags` の区切り 2 の ID と突き合わせ、過不足 0）
- 区切り 1 の印は壊していない（1〜76 行は変えておらず、区切り 1 の 43 件の判定は一致 42・部分 1 のまま）

**harvest set（4 行）**：

| ID | 行き先 | 理由の要点 |
|---|---|---|
| `web-core-foundation.md:984778ae`（旧 :73、シグネチャは各パッケージで） | new（3.3） | 受け先の表として引き継いだ。インターフェースの置き場所は AD-5 に合わせて platform にそろえた |
| `web-core-foundation.md:94e0b0c4`（旧 :250、アセットのコピー） | new（4.1） | SoundFont のローカル同梱の受け先 |
| `web-core-foundation.md:ae3fb4ae`（旧 :103、スタイリング） | new（4.2） | ファイルは ui-desktop へ移し、値は今の 14 章に合わせた |
| `00_reference.md:6ff71510`（B36 の旧運用判断、画面を `apps/desktop/src/renderer/screens`） | drop | turn 77 の本人決定と 01:126・01:129 に食い違う |

区切り 2 に近いが、書いた中身の外なので後の回に回したもの（`harvest set` していない）：
- `00_reference.md` の 52001481（画面の一覧）・7da142c9 と a7c9ad35（`WindowAdapter`・`WindowManager`、03 章の回）・e43c29f6（IPC チャンネル、06 章の回）
- `web-core-foundation.md` の a8768e5a（`RenderHostOptions`、描画の回）
- `editing-core.md` の 2e0a9066（`tools/` を作らない旧決定、下の C の (d-1) と関係）

**本人の決定の要素のうち、区切り 2 に降りる分（detail の 4）**：

| 決定（turn） | 要素 | 書いた所 |
|---|---|---|
| PC 版の画面は `packages/ui-desktop`（77） | AD-5 の木と依存の向き | 5.1 の木、5.2 の表と依存の向き |
| 〃 | `apps/desktop` は main・preload・レンダラーの起動と DI の組み立てだけ | 5.1 の `apps/desktop` の行（起動と DI の組み立て、画面の部品を置かない）。**「だけ」は (d-2) のため書いていない** |
| 〃 | `packages/ui-desktop` は `electron`・Node の組み込み・`apps/**` を import しない | 5.2 の表（`electron`・`expo-*`・`apps/*`）。Node の組み込みは 2.2 節の ESLint の段落（区切り 1） |
| 〃 | ESLint に足すのはパッケージを作るとき | 2.2 節（区切り 1）。5.2 から参照 |
| 曲アクションは `packages/core/src/ui`（78） | AD-5 の木の置き場所 | 5.1 の `ui` の行（「曲アクションの新規作成と上限警告」、11 章の `UT-SONGACT-*`） |
| 見た目に関係しない処理は `packages/core/src/ui`（76） | 〃 | 5.1 の `ui` の行・木 |
| 描き直しは `CommandHistory` が頼む（72） | — | 区切り 2 には降りない（AD-3〜AD-5 に描き直しの文が無い）。区切り 1 の editing-core 2.4 にある |

書いていない要素：1（「だけ」、(d-2)）。

## C. 基本設計どうしの食い違い（(d)、書いていない）— 本人に回す材料

### (d-1) 開発用サンプルデータを `tools/` のスクリプトで作るか、`packages/core/src/testing` に置くか

1. **何を決めるか**：テスト用の譜面データ（全奏法記号を含む短い曲、2048 小節の大曲、複数パートの曲）を、どこで作って置くか。1 つは、リポジトリ直下の `tools/` にスクリプトを置き、テストのたびに作ってコミットしない形。もう 1 つは、`packages/core` の中にテスト用のデータのファイルとして置く形。
2. **なぜ決まっていないか**：基本設計の中に両方の書き方が残っている。01 章と 11 章は `tools/` の形、15 章は `packages/core` の形。01 章 AD-5 の要求「`tools/` を設ける」を詳細設計に書くと、15 章と食い違う。そのため、印を付けずに残した。
3. **原文**：
   - `docs/basic_design/01_architecture.md:131` 「└─ tools/                 … 開発用サンプルデータ生成スクリプト等（要件9章「開発用サンプルデータ」）」
   - `docs/basic_design/11_test_strategy.md:191` 「これらは`tools/`パッケージ（[[01_architecture.md#3]]AD-5）のスクリプトとして生成し、リポジトリにコミットせず都度生成する運用とする（データサイズ・更新の手間を避けるため）。」
   - `docs/basic_design/15_development_process.md:211` 「実体は`packages/core/src/testing/editingFixtures.ts`（旧詳細設計 `00_reference.md` §9（`2759936` 時点）9.21節）。」
   - 旧詳細設計（harvest `editing-core.md:2e0a9066`）「単体テストの範囲はこれで足りているため `tools/` ワークスペースは**作らない**ことを確定し、[[../basic_design/15_development_process.md#4.1]]「順序を持たない継続的作業」の記述もこれに合わせた。」
4. **見立て**：15 章に合わせ、01:131 と 11:191 を `packages/core/src/testing` の形に直す。根拠は 2 つ。旧詳細設計が 2026-09-10 の監査で「作らない」と決め、15 章だけを直して 01・11 章を直し忘れた形に見えること（上の逐語）。要件 9 章の「開発用サンプルデータ」は置き場所を決めていないこと（`docs/tab_app_requirements.md:388`「開発用サンプルデータ | 全奏法記号・複数パート・大曲等を含む開発/テスト用フィクスチャデータの用意」）。**反対する理由**：11:191 の「コミットせず都度生成する（データサイズ・更新の手間を避けるため）」は、2048 小節のデータには今も当てはまる。`packages/core/src/testing` に置く場合も、大曲は生成する関数にしないと同じ問題が出る。
5. **決めた後**：
   - 15 章に合わせる場合：基本設計 01:131・11:191 を直す → 01 の 131 行の単位を分解し直して承認（11 章は未分解）→ 5.1 に書いて判定 1 件
   - `tools/` に合わせる場合：15:211 を直す（15 章は未分解）→ 5.1 の木に `tools/` を足して判定 1 件
   - どちらも要件定義書は変わらない見込み（上の 388 行が置き場所を決めていないため）

### (d-2) `apps/desktop` に置くのは「アダプタの実装・起動・DI の組み立てだけ」か、シェル側の 7 点か

1. **何を決めるか**：PC 版のシェル（`apps/desktop`）に置く仕事の範囲。AD-5 は「アダプタの実装と、レンダラーの起動・DI の組み立てだけ」と書く。4.1 節は、アダプタを通さない仕事もシェル側に置いている（OS 標準ダイアログ・メニュー・クラッシュ検知）。
2. **なぜ決まっていないか**：分解では、AD-5 の「だけ」が要求「ほかの仕事を持たない」として承認されている。これをそのまま書くと、4.1 節の ⑤〜⑦ を置く場所が無くなる。そのため、印を付けずに残した。
3. **原文**：
   - `docs/basic_design/01_architecture.md:129` 「main/preload/rendererでAdapter実装と、レンダラーの起動・DIの組み立て（packages/ui-desktopの画面をここで組み立てる）だけを持ち、画面の部品は置かない（要件6章、13章B36）」
   - `docs/basic_design/01_architecture.md:168` 「本書もこの7点をシェル側責務の全体とする。」
   - `docs/basic_design/01_architecture.md:176` 「| ⑤ | OS標準ダイアログの呼び出し（印刷・ファイル選択） | OSへ直接触れる。抽象インターフェース経由にしない |」（:177 ⑥ ネイティブメニューバー・右クリックメニューの構築、:178 ⑦ クラッシュ検知 も「同上」）
4. **見立て**：01:129 を「4.1 節の 7 点（①〜④はアダプタの実装）と、レンダラーの起動・DI の組み立てだけ」の形に直す。根拠：01:129 自身が出典に「要件6章」を挙げていて、要件 6 章のシェル側責務は 4.1 節の 7 点そのものであること（01:168）。**反対する理由**：01:129 は 2026-09-26 の本人決定の文で、狙いは「画面の部品を置かない」ことにある。「だけ」を「画面は置かない」の強調として読み、直さずに済ませる道もある。ただしその読み方では、分解の承認済みの断片「ほかの仕事を持たない」と合わない。
5. **決めた後**：
   - 01:129 を直す場合：01 の 129 行の単位を分解し直して承認（今の断片は 9 件）→ 5.1 の `apps/desktop` の行に書いて判定（変わった断片の数）。要件定義書は変わらない（要件 6 章の 7 点のとおり）
   - 直さない場合：`603cbc42.258a` を対象外へ移すかを決める（本体は concede を打てないので、本人の操作になる）


## D. §3 判定（Opus、turn 79 と同じ役・文面、前置きを区切り 2 に読み替え）

- 起動の時刻は 2026-09-26T18:54:27Z（UTC）。**最初の起動で、引数に 97 件ではなく仮の値（`__FILL__`）を渡してしまい、すぐ止めた**。止めた後の `ops --since 2026-09-26T18:54:27Z` は「台帳への書き込み 0 件」で、台帳には何も書いていない。97 件を渡して起動し直した
- 1 回目：書き戻し 97/97。**一致 91・申し送り先が不在 3・部分 2・不一致 1**
- 不一致の 1 件（`4be59a2d.5ffb`）は 157 行で直した。同じ行を根拠にしていた `4be59a2d.4bfe`（一致）と合わせて 2 件を判定し直し、**2 件とも一致**
- 判定の数：97＋2＝**99**（上限 100）。承認と settle は 0
- `ops --since 2026-09-26T18:54:27Z --expect judge,plan,sync,harvest`：judge 99・plan 5・sync 3、想定外 0。本体は judge を打っていない（harvest の 4 件はこの時刻より前）
- `git diff --stat docs/` で変わっているのは、私が直した 3 ファイル（web-core-foundation・00_reference・screens-navigation）だけ。判定の間に私が直したのは 157 行の 1 か所だけ（E）。判定役が文書を書いた形跡は無い

**区切り 2 の結果**：一致 92・下位を直す 5（plan 済み）・未判定 2（(d)、印なし）

| 行 | 印 | 判定 | 要求（先頭） |
|---|---|---|---|
| 88 | `384bef0d.068f` | 一致 | ファイルI/Oについて、抽象化されたインターフェース（PlatformAdapter相当）が定義 |
| 88 | `384bef0d.c5c3` | 一致 | オーディオセッション制御について、抽象化されたインターフェースが定義されていなければならない |
| 88 | `384bef0d.9198` | 一致 | ウィンドウ管理について、抽象化されたインターフェースが定義されていなければならない |
| 88 | `384bef0d.d97e` | 一致 | 自動更新チェックについて、抽象化されたインターフェースが定義されていなければならない |
| 88 | `384bef0d.34b6` | 一致 | Webコア側のコードは、上記4系統について具象クラスを直接参照せず、抽象インターフェースのみを参 |
| 88 | `384bef0d.7e73` | 一致 | 具象実装はElectronアダプタまたはExpoアダプタとして提供され、アプリ起動時にWebコア |
| 88 | `caf80338.5bff` | 申し送り先が不在・下位を直す | 各アダプタの具体的なメソッドシグネチャのうち引数は、対応する作業パッケージの詳細設計書で確定する |
| 88 | `caf80338.943b` | 申し送り先が不在・下位を直す | 各アダプタの具体的なメソッドシグネチャのうち戻り値の型は、対応する作業パッケージの詳細設計書で確 |
| 88 | `caf80338.7615` | 部分・下位を直す | 各アダプタの具体的なメソッドシグネチャについて、非同期の場合の扱いを対応する作業パッケージの詳細 |
| 88 | `caf80338.90ef` | 部分・下位を直す | 各アダプタの具体的なメソッドシグネチャについて、同期の場合の扱いを対応する作業パッケージの詳細設 |
| 88 | `caf80338.c8f3` | 申し送り先が不在・下位を直す | 各アダプタの具体的なメソッドシグネチャのうちエラー時の扱いは、対応する作業パッケージの詳細設計書 |
| 92 | `d09e28be.d7ef` | 一致 | FileSystemAdapterは曲データの読み込みを担うこと |
| 92 | `d09e28be.1a2b` | 一致 | FileSystemAdapterはアトミックな書き込み（06章の一時ファイル→リネーム方式に従 |
| 92 | `d09e28be.9d24` | 一致 | FileSystemAdapterは曲データの一覧取得を担うこと |
| 92 | `d09e28be.e4c4` | 一致 | FileSystemAdapterはゴミ箱への移動を担うこと |
| 92 | `d09e28be.305f` | 一致 | FileSystemAdapterは現在の保存先ルートの取得を担うこと |
| 92 | `d09e28be.0158` | 一致 | FileSystemAdapterは保存先の移行を担うこと |
| 92 | `d09e28be.2fc6` | 一致 | 保存先はローカル/iCloud Drive/Google Drive等の中から設定可能な「フォル |
| 92 | `d09e28be.e80e` | 一致 | Adapter自体はどの実体（特定のクラウドサービス等）にも依存しないこと |
| 93 | `c9422351.89ca` | 一致 | AudioSessionAdapterがバックグラウンド音楽アプリとの音声共存設定を担うこと |
| 93 | `c9422351.013c` | 一致 | PC版はno-op実装であること |
| 93 | `c9422351.9376` | 一致 | iPhone版のみ実処理を持つこと |
| 94 | `21f81568.05f0` | 一致 | WindowAdapterは曲ウィンドウのオープンを担う |
| 94 | `21f81568.db72` | 一致 | WindowAdapterは既存ウィンドウの前面化を担い、同一曲の二重起動を防止する（要件5.6 |
| 95 | `23a18f23.a76a` | 一致 | UpdateCheckAdapterは更新確認を担う |
| 95 | `23a18f23.fffe` | 一致 | UpdateCheckAdapterの現時点の実装はダミー実装とする（要件5.6） |
| 95 | `23a18f23.838c` | 一致 | PlatformAdapter の 1 つとして UpdateCheckAdapter を設ける |
| 104 | `da104e4f.da60` | 一致 | 実装言語にはTypeScriptを採用する |
| 105 | `15b5ef7e.c567` | 一致 | UIフレームワークとして React を採用すること |
| 106 | `47958bb6.ef05` | 一致 | 状態管理には軽量なストア（Zustand相当）を用いる |
| 106 | `47958bb6.023d` | 一致 | コマンド層は既存の状態管理ライブラリに頼らず独自実装とする |
| 106 | `47958bb6.3b76` | 一致 | Undo/Redoの対象はScoreモデルとする |
| 106 | `47958bb6.4f3b` | 一致 | UI状態（選択範囲・表示モードなど）はUndo/Redo対象（Scoreモデル）と明確に分離して |
| 107 | `612cc1fc.58f5` | 一致 | ビルドツールとして Vite（Electron向けテンプレート）を採用すること |
| 108 | `4be59a2d.8748` | 一致 | スタイリングには Tailwind CSS v4 系を採用する |
| 108 | `4be59a2d.638c` | 一致 | Tailwind CSS は Vite 用のプラグインとして導入する |
| 108 | `4be59a2d.ca34` | 一致 | Tailwind CSS の具体的なバージョンは実装時に固定する（設計時点では未確定のままでよい |
| 108 | `4be59a2d.2332` | 一致 | 14_visual_design_system.md で定義するデザイントークンを対象にする |
| 108 | `4be59a2d.3b48` | 一致 | 色のデザイントークンを CSS の @theme に定義して CSS 変数にする |
| 108 | `4be59a2d.49c5` | 一致 | 文字（タイポグラフィ）のデザイントークンを CSS の @theme に定義して CSS 変数に |
| 108 | `4be59a2d.e9ec` | 一致 | 余白のデザイントークンを CSS の @theme に定義して CSS 変数にする |
| 108 | `4be59a2d.7e81` | 一致 | 角丸のデザイントークンを CSS の @theme に定義して CSS 変数にする |
| 108 | `4be59a2d.028c` | 一致 | 影のデザイントークンを CSS の @theme に定義して CSS 変数にする |
| 108 | `4be59a2d.32ca` | 一致 | @theme に定義したトークンは CSS 変数として実体化される |
| 108 | `4be59a2d.5ffb` | 一致 | 画面（コンポーネント）はトークンから生成されたユーティリティクラスだけを使用する |
| 108 | `4be59a2d.4bfe` | 一致 | 画面のスタイリングでは直値（ハードコードされた色・数値など）を書かない |
| 109 | `48ac7e6b.6f77` | 一致 | alphaTabパッケージとして `@coderline/alphatab`（npm）を採用する |
| 109 | `48ac7e6b.76f9` | 一致 | SoundFontはローカル同梱とし、外部CDNへの依存を禁止する（要件5.1） |
| 111 | `3230a605.a839` | 一致 | レンダリングエンジンにSVGを採用する |
| 117 | `634f2a2f.7d3b` | 一致 | packages/ というディレクトリを設ける |
| 118 | `62f312e4.d63f` | 一致 | core パッケージは Web コア本体（L1〜L3）を格納する |
| 118 | `62f312e4.8679` | 一致 | core パッケージはプラットフォーム固有 API への直接参照を禁止する |
| 119 | `c5710176.c336` | 一致 | ui/ ディレクトリには画面の見た目に関係しない処理を置く |
| 119 | `c5710176.a109` | 一致 | ui/ に React の部品を置かない |
| 119 | `c5710176.7892` | 一致 | React の部品は packages/ui-desktop に置く |
| 120 | `a1b976a5.86d0` | 一致 | packages/core 配下に editing/ という名前のパッケージ（ディレクトリ）を設 |
| 120 | `a1b976a5.efb6` | 一致 | editing/ パッケージにコマンド層（Undo/Redo 等を扱う層）を実装すること |
| 121 | `d52f6760.46c0` | 一致 | packages/core 配下に playback という名前のディレクトリ（パッケージ）を配 |
| 121 | `d52f6760.49ef` | 一致 | playback パッケージは再生制御を担当し、基本設計05章の内容に対応する実装とする |
| 122 | `2746c543.6112` | 一致 | packages/core 配下に domain/ ディレクトリを置き、Score ラッパーを実 |
| 122 | `2746c543.f908` | 一致 | packages/core/domain/ にメタデータモデルを実装する（02章対応） |
| 123 | `0cccc02e.b2ae` | 一致 | packages/core 配下に export/ パッケージを置く |
| 123 | `0cccc02e.9d8d` | 一致 | export/ パッケージは PDF 出力を担う（07章） |
| 123 | `0cccc02e.1458` | 一致 | export/ パッケージは alphaTex 出力を担う（07章） |
| 123 | `0cccc02e.38e2` | 一致 | export/ パッケージは MIDI 出力を担う（07章） |
| 124 | `0e391442.b41a` | 一致 | packages/core 配下に errors/ ディレクトリを置き、エラー/ログ基盤を実装す |
| 125 | `ae8384d2.9a86` | 一致 | platform/ パッケージに PlatformAdapter のインターフェース定義を置く |
| 125 | `ae8384d2.1d91` | 一致 | platform/ パッケージには実装を含めない |
| 126 | `499869ac.fef8` | 一致 | packages 配下に ui-desktop パッケージを設ける |
| 126 | `499869ac.76b5` | 一致 | ui-desktop パッケージには PC版の画面の部品（Reactのコンポーネント）を置く |
| 126 | `499869ac.883b` | 一致 | ui-desktop パッケージはWebコア（L1）に属するものとして扱う |
| 127 | `262248db.2f87` | 一致 | shared-typesパッケージを設ける |
| 127 | `262248db.dea3` | 一致 | shared-typesにはcoreと各ラッパーが共有する型定義のみを含める |
| 128 | `5ec46ad4.7804` | 一致 | モノレポのルート（tab-app/）直下に apps/ ディレクトリを置く |
| 129 | `603cbc42.6755` | 一致 | apps/desktop パッケージは Electron ラッパー（Phase 1 向け）として |
| 129 | `603cbc42.1a83` | 一致 | apps/desktop の main プロセスで Adapter を実装する |
| 129 | `603cbc42.d9c3` | 一致 | apps/desktop の preload スクリプトで Adapter を実装する |
| 129 | `603cbc42.a3de` | 一致 | apps/desktop の renderer プロセスで Adapter を実装する |
| 129 | `603cbc42.3f52` | 一致 | apps/desktop はレンダラーの起動を持つ |
| 129 | `603cbc42.1e0f` | 一致 | apps/desktop はDIの組み立てを持つ |
| 129 | `603cbc42.c93d` | 一致 | packages/ui-desktop の画面は apps/desktop のDIの組み立てで組 |
| 129 | `603cbc42.258a` | 未判定（(d)、印なし） | apps/desktop はAdapter実装・レンダラーの起動・DIの組み立てだけを持ち、ほか |
| 129 | `603cbc42.9ef2` | 一致 | apps/desktop には画面の部品を置かない |
| 130 | `e9baa75f.068b` | 一致 | mobile パッケージを設ける |
| 130 | `e9baa75f.d8ae` | 一致 | mobile パッケージは Expo+WebView ラッパーとして実装する |
| 130 | `e9baa75f.5eb1` | 一致 | mobile パッケージは Phase 3 に位置づける |
| 131 | `83814e6b.ae31` | 未判定（(d)、印なし） | モノレポのパッケージ構成に tools/ ディレクトリを設け、要件9章「開発用サンプルデータ」に |
| 134 | `abd3cf77.6a75` | 一致 | `packages/core` から `electron` や `expo-*` を直接impo |
| 134 | `abd3cf77.2d2e` | 一致 | 上記のビルド失敗の仕組みをパッケージの依存関係定義で実現する |
| 134 | `abd3cf77.6c94` | 一致 | 上記のビルド失敗の仕組みをlintルールでも実現する |
| 134 | `02a0c5e8.d137` | 一致 | packages/ui-desktop は packages/core に依存してよい |
| 134 | `02a0c5e8.cb41` | 一致 | packages/ui-desktop は packages/shared-types に依存し |
| 134 | `02a0c5e8.8572` | 一致 | packages/ui-desktop は React に依存してよい |
| 134 | `02a0c5e8.7799` | 一致 | packages/ui-desktop は electron に依存しない |
| 134 | `02a0c5e8.6cdc` | 一致 | packages/ui-desktop は expo-* に依存しない |
| 134 | `02a0c5e8.1261` | 一致 | packages/ui-desktop は apps/** に依存しない |
| 134 | `02a0c5e8.a84a` | 一致 | packages/ui-desktop の禁止した依存も、packages/core と同じ仕組 |
| 134 | `22be1a8f.86eb` | 一致 | パッケージの依存の向きは apps/desktop → packages/ui-desktop  |
| 134 | `22be1a8f.d0fe` | 一致 | パッケージの依存の向きを逆流させない |

## E. 一致以外の扱い（detail の 3）

**1 行目（区切り 2 の受け先の中で直した）**：`4be59a2d.5ffb`（不一致 → 直して一致）。hook には止められていない。
- 157 行の前：「画面の部品は、色・文字・余白・角丸・影を Tailwind のクラス（`bg-surface`・`text-danger`・`p-3`・`rounded-md` の形）か `var(--…)` で書く。」
- 後：「画面の部品（`packages/ui-desktop`）は、色・文字・余白・角丸・影を、トークンから作られた Tailwind のクラス（`bg-surface`・`text-danger`・`p-3`・`rounded-md` の形）だけで書く。」。続けて「`style` 属性に `var(--…)` を書くことも含む」「`var(--…)` で参照してよいのは、クラスを付けられない `packages/core/src/rendering` の SVG の着色だけ」を足した

**2 行目（plan 下位を直す、5 件）**：`caf80338` の 5 件。
- 要求の文そのものが、渡し先を別の作業パッケージの詳細設計書と指している（01:88「具体的なメソッドシグネチャ（引数・戻り値の型、非同期／同期の別、エラー時の扱い）は各アダプタが対応する作業パッケージの詳細設計書で確定する」）
- 足りない中身（メソッドごとのシグネチャ）は、03・05・06・10 章の要求を受けて書くもの。そのため turn 80 と同じ形と判断した
- 理由（5 件とも同じ文）：「01章の文は各アダプタの具体的なメソッドシグネチャの確定先を対応する作業パッケージの詳細設計書と指しているので、基本設計03・05・06・10章の回にweb-core-foundationの3.3節の表の受け先（screens-navigation・playback-integration・data-model-persistence・web-core-foundation）へ書き足して判定し直す（turn 80 の本人決定と同じ形）」
- 5 件とも `OK … → 下位を直す`。`plan-report`：下位を直す 6（01 章 6）・スコープ外 6（08）・一致以外なのに分類が無い 0

**3 行目（直さず plan も打たずに報告）**：判定したものの中には無い。(d) の 2 件（C）は判定していない。

### 一致以外の判定役の理由（逐語、1 回目）

#### `caf80338~0#k5bffa3a6dc7c`（申し送り先が不在）

上位（01_architecture.md:88 AD-3）は「具体的なメソッドシグネチャ（引数・戻り値の型、非同期／同期の別、エラー時の扱い）は各アダプタが対応する作業パッケージの詳細設計書で確定する」と求めている。この判定の対象は、そのうち「引数」の部分。受け先表（00_reference.md:17）どおりに web-core-foundation.md 3 節を開いた。3.3 節（L114）は「4 つのアダプタのメソッドのシグネチャ（引数、戻り値の型、非同期か同期か、エラーのときの扱い）は、次の受け先で、1 節の「詳細設計書で決めること」の表の書き方で書く。本節には書かない。」としている。受け先は L118〜121 の表で、FileSystemAdapter→data-model-persistence.md（基本設計 06 章の回）、AudioSessionAdapter→playback-integration.md（05 章の回）、WindowAdapter→screens-navigation.md（03 章の回）、UpdateCheckAdapter→本書（10 章の回）と決めている。どこへ回すかは決まっているが、申し送った先に引数の記述が無い。data-model-persistence.md・playback-integration.md・screens-navigation.md の 3 ファイルで "Adapter" を grep したところ、ヒットは 0 件だった（それぞれ 43 行・6 行・140 行）。web-core-foundation.md の中にある 4 アダプタへの言及（L83、92〜95、105〜108、110、118〜121、123）は、責務・注入・受け先の表・同期／非同期の決まりだけで、UpdateCheckAdapter も含めて、メソッドの引数を書いた行は無い。今は、どのアダプタのどのメソッドにどの引数を渡すかが、詳細設計のどこにも確定していない。注：受け先の中身は基本設計 03・05・06・10 章の回で書く予定になっている（01 章の区切り 3・4 とは別の回）。指示の「区切り 3・4 を理由にしない」には当たらないと判断して、この判定にした。

#### `caf80338~0#k76156d493991`（部分）

判定は「部分」です。

【上位】`docs/basic_design/01_architecture.md:88` には「具体的なメソッドシグネチャ（引数・戻り値の型、非同期／同期の別、エラー時の扱い）は各アダプタが対応する作業パッケージの詳細設計書で確定する」とあります。承認時の期待値は「各メソッドが非同期（Promise を返す）か同期かを明記する」です。

【下位に在るもの】`docs/detailed_design/web-core-foundation.md:123` の 3.3 節が、非同期か同期かの決まりを置いています。
- 「PC 版で IPC を通るメソッド（`FileSystemAdapter`・`WindowAdapter`）は `Promise<…>` を返す非同期にする」
- AudioSessionAdapter は「iPhone 版で非同期になりうるものは `Promise<…>` を返す形にそろえ」る
- L116〜121 の表で、アダプタごとにシグネチャを書く受け先を割り振っています。

【下位に無いもの】
1. UpdateCheckAdapter が非同期か同期かは決まっていません。L123 の決まりは UpdateCheckAdapter に触れていません。同じファイルを grep "UpdateCheckAdapter" で検索すると 4 件（L83・L95・L108・L121）で、どれにも非同期／同期の記述はありません。
2. AudioSessionAdapter は「非同期になりうるもの」という条件付きで、どのメソッドが非同期かはまだ決まっていません。
3. メソッド単位のシグネチャはまだどこにもありません。受け先の data-model-persistence.md・screens-navigation.md・playback-integration.md を grep "Adapter" で検索して、ヒット 0 件でした。これは他の章の回に回した分なので、区切り 3・4 の不足とは別に、ここでは記録にとどめます。

【直さずに記録する食い違い】`docs/detailed_design/00_reference.md:159` の as-built の WindowAdapter は、`openSongListWindow(): void`／`focusExistingWindow(songId: string): boolean`／`listOpenEditWindowSongIds(): string[]` を同期として登録しています。これは web-core-foundation.md:123 の「WindowAdapter は Promise を返す非同期にする」と合いません。screens-navigation.md（基本設計 03 章の回）で書くとき、どちらに合わせるかを決める必要があります。

#### `caf80338~0#k943b133d1842`（申し送り先が不在）

上位の要求（01_architecture.md 88 行、AD-3）は「各アダプタのメソッドの戻り値の型は、対応する作業パッケージの詳細設計書で確定する」。承認時の期待は「PlatformAdapter の各メソッドについて、戻り値の型を明記する」。

受け先表（00_reference.md 17 行）の AD-3 の受け先は web-core-foundation.md の 3 節。その 3.3 節（114 行、tag 01:caf80338.943b の印あり）には次のとおりあり、戻り値の型を自分では書かずに別の文書へ回している。
「4 つのアダプタのメソッドのシグネチャ（引数、戻り値の型、非同期か同期か、エラーのときの扱い）は、次の受け先で、1 節の「詳細設計書で決めること」の表の書き方で書く。本節には書かない。」
回し先は 116〜121 行の表のとおり。
- FileSystemAdapter → data-model-persistence.md
- AudioSessionAdapter → playback-integration.md
- WindowAdapter → screens-navigation.md
- UpdateCheckAdapter → 本書（web-core-foundation.md）

回し先を開いて確かめた結果は次のとおり。
- 回し先の 3 ファイルで grep "Adapter" はそれぞれ 0 件。
- grep -E "interface (FileSystem|AudioSession|Window|UpdateCheck)Adapter" は、web-core-foundation.md を含む 4 ファイルすべてで 0 件。
- web-core-foundation.md 3 節にあるのは、4 つを束ねる PlatformAdapters の型（88〜96 行）と、非同期にそろえる規則（123 行、Promise<…> を返す）だけ。4 つのアダプタそれぞれのメソッドと戻り値の型の宣言は、どこにも無い。

補足:
(1) 回し先の各回（基本設計 03・05・06・10 章の回）はまだ来ていない。書く予定の回は 3.3 節の表に書かれているが、今の時点で戻り値の型を決めている下位は無い。
(2) 00_reference.md 3.1 節に「FileSystemAdapter（最小版）」の Promise の戻り値が載っている。ただしこの節は「下書き（作り直す前の本書の 3 節を写したもの。章ごとに確かめ直す）」とされており、受け先表が指す受け先でもないので、根拠にしなかった。
文書は直していない。

#### `caf80338~0#k90efcb919995`（部分）

上位（01_architecture.md:88 AD-3）は、各アダプタのメソッドシグネチャの「非同期／同期の別」を、対応する作業パッケージの詳細設計書で確定することを求めている。受け先の docs/detailed_design/web-core-foundation.md 3.3 節（112〜123 行）は、シグネチャの受け先を表で割り当てている（FileSystem は data-model-persistence.md、AudioSession は playback-integration.md、Window は screens-navigation.md、UpdateCheck は本書）。さらに 123 行で次の決まりを置いている。「PC 版で IPC を通るメソッド（`FileSystemAdapter`・`WindowAdapter`）は `Promise<…>` を返す非同期にする」「IPC を通らないメソッド（PC 版の `AudioSessionAdapter`）も、iPhone 版で非同期になりうるものは `Promise<…>` を返す形にそろえ、プラットフォームで同期と非同期を変えない」。
下位に無いもの：
(1) UpdateCheckAdapter の同期／非同期は、この決まりに含まれていない（123 行が挙げるのは他の 3 アダプタだけ）。
(2) AudioSessionAdapter は「非同期になりうるもの」という条件付きの書き方で、どのメソッドを同期にするかは決まっていない。
(3) メソッドごとの確定はまだどの受け先にも無い。screens-navigation.md・data-model-persistence.md・playback-integration.md を語「Promise」と「同期」で grep して 0 件。
食い違いも 1 件見つけた（直していない）。docs/detailed_design/00_reference.md:159 と packages/shared-types/src/index.ts:144-152 は、WindowAdapter を `openSongListWindow(): void`／`focusExistingWindow(songId: string): boolean`／`listOpenEditWindowSongIds(): string[]` と同期で定義している。これは web-core-foundation.md:123 の「WindowAdapter は Promise を返す非同期」と合わない。
1 回目の judge は、method 欄に書いた \| が JSON のエスケープとして不正で、JSON.parse の SyntaxError になり書き込まれなかった。ゲートに止められたのではない。書き方を直して同じ判定で打ち直し、OK が返った。

#### `caf80338~0#kc8f395dd501f`（申し送り先が不在）

上位（01_architecture.md L88、AD-3）の要求は「各アダプタの具体的なメソッドシグネチャ（…エラー時の扱い）は各アダプタが対応する作業パッケージの詳細設計書で確定する」。区切り 2 の受け先 web-core-foundation.md 3.3 節（L114）は `docs/detailed_design/web-core-foundation.md:114`「4 つのアダプタのメソッドのシグネチャ（引数、戻り値の型、非同期か同期か、エラーのときの扱い）は、次の受け先で、1 節の「詳細設計書で決めること」の表の書き方で書く。本節には書かない。」と書き、L116-121 で申し送り先を決めている。FileSystemAdapter は data-model-persistence.md、AudioSessionAdapter は playback-integration.md、WindowAdapter は screens-navigation.md、UpdateCheckAdapter は本書で、書式は 1 節の「例外仕様」の行（メソッドごとの表。決められないものは「未確定」と書いて G 番号で登録）。L124 では同期／非同期の決まりまで書いてあるが、エラー時の扱いについて共通の決まりは書いていない。申し送り先を開いて確かめた結果、どこにもエラー時の扱いが無かった。data-model-persistence.md・screens-navigation.md・playback-integration.md では、アダプタ名 4 つの grep も「エラー|例外」の grep も 0 件だった。web-core-foundation.md で UpdateCheckAdapter に当たるのは L83・L95・L108・L121 で、メソッドの宣言も例外の表も無い。1 節の決まりが求める「未確定」と G 番号の登録も、00_reference.md 8.1 には見当たらなかった（「シグネチャの受け先|書く回」を grep して 0 件）。ただし 3.3 節の表には、書く時期が別の章の回（06・05・03・10 章）とはっきり書いてあるので、今後その回で埋める予定の申し送りである。なお 00_reference.md の §3.1（L40・L42、旧 FileSystemAdapter 最小版と FileNotFoundError などの軽量エラークラス）と §3.8（L159、旧 WindowAdapter の宣言）には作り直す前の中身が残っているが、作り直した受け先の文書には移っていない。文書は直していない。

#### `4be59a2d~0#k5ffbf2bc51a1`（不一致）

上位の docs/basic_design/01_architecture.md:108（AD-4 スタイリング）は「画面はそのトークンから作られるクラスだけを使う（直値を書かない、[[08_error_logging.md#4]]）」と決めている。受け先表の docs/detailed_design/00_reference.md:18 から docs/detailed_design/web-core-foundation.md の 4.2 節（144〜234 行）を開いて全文読んだ。

156 行（req 01:4be59a2d.5ffb の印がある唯一の箇所）は上位と合っている。原文は「**画面が使えるのは 14 章のトークンから作られたクラスだけ**になる」で、`--*: initial;` によって既定のテーマを外す仕組みも書かれている。

一方、157 行は画面の部品に、クラスのほかに `var(--…)` で書くことも認めている。原文は「画面の部品は、色・文字・余白・角丸・影を Tailwind のクラス（`bg-surface`・`text-danger`・`p-3`・`rounded-md` の形）か `var(--…)` で書く」。直値を禁じる点（`#c62a3f`、任意値のクラス、`style` 属性の直値）は上位と合っている。ただし、上位が決めた「クラスだけ」という制限を下位が広げており、`style` 属性に `var(--…)` を書く道が残る。上位は理由の欄で「画面側はトークンから作られたクラスしか使わないので直値が混ざりにくい」と書き、CSS Modules を選ばなかった理由も「直値を防ぐには別の見張りが要る」としている。157 行はこの前提と食い違う。詳細設計の中でも 156 行と 157 行が合っていない。

直すのは、157 行から `var(--…)` を外して上位に合わせるか、上位の側で var() の使用を認めるかのどちらかで、判断は本人に回すべき点。文書は直していない。


### 判定役が「参考」として書いた食い違い（直していない）

- `docs/detailed_design/00_reference.md:159` は `WindowAdapter` を「（インターフェース、`@riff-line/shared-types`）」と書いているが、3.1 節では `packages/core/src/platform` に置くと書いた。159 行は 3 節の登録簿で、下書き（作り直す前の版を写したもの）の中にある。03 章の回に直す
- `UpdateCheckAdapter` が非同期か同期かは、3.3 節の決まりに入れていない（`caf80338.7615`・`.90ef` が部分になった理由）。10 章の回に本書へ書く（plan 済み）
- 直値が混ざるのを機械で見張る手段（lint）は、4.2 節に書いていない（`5ffb`・`4bfe` を判定し直したときの付記）

## F. §5 確かめ

| 項目 | 結果 |
|---|---|
| drift | 6 段とも一致（`split dd` と `sync` 3 本の後） |
| `check-docs-links` | 終了コード 0（旧 3.5.1 へのリンク 1 件を 4.2 へ付け替えた後） |
| 【要確認】 | `docs/` 全体で 0 |
| 先の日付 | 0。足した行の日付は 2026-09-24 と 2026-09-27 で、PC の時計は 2026-09-27。2026-09-24 は screens-navigation.md:47 に元からある「（2026-09-24 追記）」が、リンクを直したので差分に出たもの |
| 足した文の「等・など・その他・といった・のような」 | ファイル全体の数（HEAD → 今）：web-core-foundation 0→0・00_reference 17→17・screens-navigation 3→3 |
| req->bd | 根拠 1122/1122 有効・不一致等 0・未判定 0 |
| bd->dd の根拠の無効 | 直した直後は 84。判定し直した後は、前からと同じ 82 に戻った |
| 本人待ち | req->bd 0・01 0・08 3（増減なし） |
| `edges/` の一時ファイル | 0（5 ファイルだけ） |
| 分類器 | このターンの確かめは止められていない |

bd->dd の根拠の無効 82 のうち 2 件は、消した下書きの行を引いていた 08 章の判定（web-core-foundation.md:115）。HEAD の版でも引用は 95 行にあり、記録の 115 行とは合わず、前から行ずれで無効だった。私が太字を外したので、無効の理由が「引用が見つからない」に変わっただけ。

**このターンの私の誤り 2 つ**（どちらも台帳・文書には残っていない）：
1. 判定のワークフローを、仮の値の引数のまま起動した（D）。すぐ止め、書き込み 0 件を確かめた
2. 明細を組み立てるとき、引用符で囲まない heredoc に本文を渡し、本文のバッククォートの中身がシェルのコマンドとして実行された。
   - 実際に動いたのは `git diff --stat docs/`・`sync`・`split dd`。`split dd` は、入力のファイル「dd」が無くて何も作らずに終わった
   - ほかは「command not found」か「Is a directory」だった
   - その後に `git status` を見て余計なファイルは 0、`ops --since 2026-09-26T19:02:00Z` を見て台帳への書き込みは 0 件だった
   - 明細は、スクリプトを Write でファイルに書いてから実行し直して作った

## G. 本人の判断が要る点

1. **(d-1)** 開発用サンプルデータを `tools/` のスクリプトで作るか、`packages/core/src/testing` に置くか（C の (d-1)）。見立ては、15 章に合わせて 01:131・11:191 を直すこと
2. **(d-2)** `apps/desktop` に置くのは「アダプタの実装・起動・DI の組み立てだけ」か、4.1 節の 7 点か（C の (d-2)）。見立ては、01:129 を 7 点の形に直すこと
3. 上の 2 つが決まるまで、区切り 2 の要求 2 件は印なし・未判定のまま残る。**コミットの条件をどう読むか**を決めてほしい（H）

## H. コミットしなかった

§4 の条件「区切り 2 の一致以外が 0（detail の 3 で分類した分を除く）」を、次のように読んだ。
- 判定した 97 件は、一致 92 と下位を直す 5（分類済み）なので、条件を満たす
- ただし (d) の 2 件は、detail の 3 の 3 行目「基本設計を直さないと直らない」に当たり、印も判定も無い
- そのため区切り 2 は閉じていないと読み、turn 79 と同じく**何もコミットしていない**

未コミットのもの：
- 詳細設計 3 ファイル（web-core-foundation・00_reference・screens-navigation）
- `harvest.jsonl`
- `bd-dd.jsonl`（判定 99・plan 5）
- `_bridge/`（turn 81 の指示と、この報告）

(d) の 2 件を「区切り 2 の外」と読んでコミットしてよいなら、次のターンで種類ごとに 3 本（詳細設計と harvest／台帳／`_bridge`）に分けてコミットする。
