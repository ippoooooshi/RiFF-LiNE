# 他プロジェクトへの移植ガイド（PORTING.md）

> このファイルは移植作業をする別セッション向け。RiFF-LiNE で組んだ `.claude` を、
> Cisco Config Sim / 作番管理アプリなど別のプロジェクトへ持っていくときの手順。

## 前提：何が汎用で、何が固有か

**書き換えるのは 2 種類だけ**です。それ以外は素のままで動きます。

| 分類 | ファイル | 移植時 |
|---|---|---|
| **固有** | `.claude/project.json` | **必ず書き換える。** ここに固有部が全部集約されている |
| **固有** | `.claude/rules/typescript.md` / `electron.md` / `ui.md` / `layer.md` | 技術スタックが違うなら差し替え or 削除 |
| 汎用 | `CLAUDE.md` | プロジェクト名と一次情報源の表だけ直す。「絶対に守る3つ」はそのまま |
| 汎用 | `.claude/rules/core.md` / `docs.md` / `tests.md` | そのまま（`docs.md` の連動例だけプロジェクトの文書体系に合わせる） |
| 汎用 | `.claude/agents/` `.claude/commands/` `.claude/hooks/` `.claude/scripts/` `.claude/workflows/` | **そのまま** |
| 汎用 | `.claude/rationale.md` | そのまま持っていく。**ゲートを外す前に必ず読む**（何を防いでいるか／外すとどうなるか） |

## 手順

```bash
cd <移植先リポジトリ>
cp -r <RiFF-LiNE の>.claude .claude
cp <RiFF-LiNE の>CLAUDE.md ./CLAUDE.md
cp .claude/settings.local.json.example .claude/settings.local.json
printf '\n.claude/state/\n.claude/coverage/\n.claude/settings.local.json\n' >> .gitignore
rm -rf .claude/coverage .claude/state/*.json      # 元プロジェクトの台帳と状態は持ち込まない
```

続けて `project.json` を書き換えます。

## project.json で必ず直すところ

### 1. `commands` — 検証コマンド

```jsonc
"commands": {
  "typecheck": "npm run typecheck",   // そのプロジェクトの実際のコマンド
  "lint":      "npm run lint",
  "test":      "npm test"
}
```

存在しないコマンドは `verify.mjs` が「未定義」としてスキップします。**無いものを書かない。**

### 2. `tiers` — V字の段と、その中身がどこにあるか

段の数にも名前にも依存しない設計です。**設計書が 1 枚しかないプロジェクトなら 2 段で構いません。**

```jsonc
// 例: 設計書が1枚だけのプロジェクト
"tiers": [
  { "id": "spec", "name": "仕様",   "sources": ["docs/spec.md"],           "extractor": "markdown" },
  { "id": "impl", "name": "実装",   "sources": ["src/**/*.ts"],
    "exclude": ["**/*.test.ts"], "extractor": "ts-api" },
  { "id": "ut",   "name": "単体テスト", "sources": ["src/**/*.test.ts"],   "extractor": "ts-test" }
]
```

`extractor` は 3 つ。

| 値 | 対象 | 何をするか |
|---|---|---|
| `markdown` | 設計書・仕様書 | 見出し・表の行・リスト項目・文へ分割し、要求数の下限を推定 |
| `ts-api` | TypeScript の実装 | export / class / interface / method / function を抽出 |
| `ts-test` | TypeScript のテスト | `it` / `test` とその ID を抽出 |

**TypeScript 以外の言語には抽出器がありません。** Python や Go のプロジェクトへ持っていくなら、`.claude/scripts/lib/ts-api.mjs` と同じ形（`{ kind, name, line }` の配列を返す関数）で足して、`split.mjs` の `splitTs` から分岐させてください。設計書側（`markdown`）は言語に依存しないので、**上流の段だけ使う**という運用も成立します。

### 3. `edges` — 段のつながり

```jsonc
"edges": [
  { "kind": "down",   "from": "spec", "to": "impl" },
  { "kind": "across", "from": "impl", "to": "ut" }
]
```

`down` はブレイクダウン（上位が下位へ降りているか）、`across` は V字の横（左辺の項目を検証するテストが在るか）。`humanJudged: true` を付けると「人間の記入が必須」として扱われます。

### 4. `gapLedger` — 課題台帳の場所

```jsonc
"gapLedger": {
  "file": "docs/issues.md",      // 課題を記録している文書
  "section": "1",                 // その中の節番号
  "prefix": "ISSUE",              // 課題番号のプレフィックス
  "resolvedMarker": "解決済み"    // 解消済みを示す語
}
```

`status.mjs` がここから未解消件数を数えます。**該当する台帳が無いプロジェクトなら、`gapLedger` ごと削除してください**（無ければ現在地から省かれるだけです）。

### 5. `paths.testStrategy` — テスト ID 採番簿

`check-tests.mjs` がここから予約済みプレフィックスを読みます。採番簿を持たないプロジェクトなら、`paths.testStrategy` を存在しないパスにしておけば ID 検査はスキップされます（`testRegistrySection` で節番号も変えられます）。

### 6. `guards` / `goalRequired`

```jsonc
"goalRequired": "phase",   // always / phase / off
"guards": {
  "implPhaseReadonly":   ["**/*.test.ts", "docs/**"],   // 実装中に書き換えさせないもの
  "designPhaseReadonly": ["src/**"]
}
```

小さいプロジェクトなら `goalRequired: "off"` から始めて、必要になったら上げるのが現実的です。

## 移植したら必ず最初にやること

```bash
node .claude/scripts/smoke.mjs          # 1件でも落ちたら以降を信用しない
node .claude/scripts/check-config.mjs   # project.json と実ファイルのズレ
node .claude/scripts/check-legacy.mjs    # 残骸・.gitignore
node .claude/scripts/status.mjs --no-verify
node .claude/scripts/split.mjs --all     # 切り出しが妥当か（件数と抽出方式を見る）
node .claude/scripts/diff-units.mjs split   # レビューの分母が取れるか（git のある場所で）
```

`diff-units.mjs` は `main` / `master` を既定の base にします。別名なら `project.json` に `"reviewBase": "<ブランチ名>"` を書くか、`split <base>` で明示してください。**hunk 0 件は「差分が無い」ではなく「base が外れている」可能性がある**ので、0 件のまま進めないでください。

カバレッジ検査は**既定で無効**です。有効にするなら `paths.coverageSummary` に測定結果の場所を書き、`node .claude/scripts/baseline.mjs record` で現在値を基準線にしてください。**基準線を取らずに宣言だけすると、既存の負債で全ターンが赤になります**（F23 / F59）。

`split.mjs` の出力で見るところ。

- **抽出方式**が `[typescript-ast]` か `[regexp-fallback]` か。フォールバックなら `typescript` が解決できていないので、`pnpm install` / `npm install` 済みかを確認
- **推定要求数 ÷ 判定対象**が 1 に近いなら、切り出しが粗すぎる可能性
- **列挙が未閉鎖**（「等」「など」）の件数 — 要件が未確定である箇所の候補

## 移植で壊れやすいところ（既知）

| 症状 | 原因 | 対処 |
|---|---|---|
| `project.json が見つかりません` | `CLAUDE_PROJECT_DIR` が別の場所を指している、または `.claude/project.json` が無い | hook から呼ばれる場合はリポジトリ直下が `cwd` になる。手で叩くときはリポジトリ直下で実行する |
| 全 tier が `単位 0` | `tiers.sources` の glob が実ファイルに当たっていない | `sources` のパスを実際のディレクトリ構成に合わせる。`**` は 0 階層にも一致する |
| 採番簿が 0 種 | `paths.testStrategy` の節が見つからない | `testRegistrySection` を実際の節番号に。採番簿が無いなら存在しないパスにしてスキップさせる |
| `check-stubs` が大量に出る／0 件 | `paths.stubTargets`（無ければ `paths.code`）がディレクトリ構成と合っていない | `project.json` の `paths.code` / `paths.stubTargets` を直す |
| Stop hook が常に赤 | `commands` に存在しないコマンドが書かれている | `verify.mjs` を単体で叩いて、どれが落ちているか見る |
| `coverage` が常に赤 | `paths.coverageSummary` を書いたのにテストが coverage を出していない／基準線が未記録 | テストを coverage 付きで走らせる。負債を認めるなら `baseline.mjs record`。使わないなら `coverageSummary` を空に戻す |
| レビュー中にターンが終われない | `phase` が `review` のまま分母が未固定 | `diff-units.mjs split`。レビューが終わったら `phase` を戻す |
| 「直しました」と言うと水平展開を要求される | v18 から、修正系の言明＋コード編集で `spread.mjs` の全件判定が要る | 直した**型**で `spread.mjs scan`。繰越は G 番号つきで正規の判定なので必ず終わる。パターンが 1 箇所にしか当たらないなら、それは型になっていない |
| Windows で smoke が落ちる | v20 以前は模擬実行がホストのシェル（cmd.exe）を経由しており、POSIX の単一引用符が壊れて coverage 系 4 件が落ちた | v21 で解消。**検査は必ず実際に使う OS でも一度走らせること**——開発が Linux だけだと、この種の環境依存は最後まで見えない |
| 報告に現在地の 1 行目を引用すると止まる | v20 以前は版スタンプが `ファイル名:数字` の形で、引用検査と区別がつかなかった | v21 で区切りを `@` に変更。古い版のまま使う場合は、スタンプの行を引用せずに言い換える |
| 作業パッケージを使いたい | 既定では `wpLedger.file` が空で無効 | `project.json` の `wpLedger.file` に docs のパスを書き、`node .claude/scripts/wp.mjs init` で表を作る（列: ID / 名前 / 前提 / 範囲 / 完了条件 / 状態）。以後、前提が未完のパッケージに着手できなくなり、実在しない担当へギャップを繰り越せなくなる |
| `wp check` が「1 件も読めていません」 | 表の列が足りない／プレフィックスが違う | **「パッケージが無い」と「表の書式が違う」は別**。列を 6 つ揃え、`wpLedger.prefix` と行頭の ID を合わせる |
| `drift` が赤で docs が書けない | 上位文書を編集したのに `split` を再実行していない | `node .claude/scripts/split.mjs <tier>` → `ledger.mjs sync "<edge>"`。一度も split していない段（未切り出し）は止めないので、これが出るのは以前 split 済みの段だけ |
| 小さな修正のたびにゴールと台帳を要求される | v17 から**触ったファイルから作業の種類を導出する**ようになった（宣言しないと検査が掛からない穴を塞ぐため） | `current.json` に `{ "phase": "adhoc", "why": "<理由>" }`。記録は残るが通る。恒久的に外すなら `goalRequired` / `ledgerRequired` を `off`——ただし**選んだ記録が残らなくなる** |
| hunk 数が判定のたびに増える | `.claude/state/` が `.gitignore` に無く、state が未追跡ファイルとして分母に入る（F57 で除外済みだが、他の生成物でも起きる） | `check-legacy.mjs` の指示どおり `.gitignore` を直す |

## 移植先ごとのメモ

### Cisco Config Sim（完全オフラインの Windows ローカルツール）

- 設計書体系が RiFF-LiNE と違うなら `tiers` を実際の構成に合わせる
- `rules/electron.md` の「オフライン制約」節は流用価値がある（同じ制約を持つため）
- `rules/layer.md` は「なぜプラットフォーム非依存を保つか」の部分がプロジェクト固有なので書き直す

### 作番管理アプリ

- 設計書が少ないなら `tiers` は 2〜3 段で十分
- `gapLedger` を持たないなら削除
- `goalRequired: "off"` から始めるのが現実的

## smoke と project.json

smoke のフィクスチャは**自前の `project.json`** を使う（移植先の設定はコピーしない）。移植先の tier 構成が何であれ、スクリプトが壊れていなければ全件通る。移植先の `project.json` 自体の健全性（JSON として読めるか・edges が実在 tier を指すか・extractor が既知か）は末尾の「host 設定」節で別に見る。

## 汎用化の余地（未対応）

- ~~`check-stubs.mjs` の `TARGETS` が固有~~ → `project.json` の `paths.code` / `paths.stubTargets` / `paths.goalScope` に移した（hook・horizontal・recurrence も同じ設定を読む）
- `rules/*.md` の `paths:` frontmatter も固有パスを含む
- TypeScript 以外の抽出器が無い

移植を実際にやる際、これらが邪魔になるようなら `project.json` 側へ寄せてください。

---

## 移植先で「判断」が要るもの

コピーすれば動くが、**そのプロジェクトで意味を持つかは別**という設定がある。
移植先の AI に丸投げせず、人が一度決めること。決めたら `.claude/rationale.md` に 1 行書く。

| 設定 | 何を決めるか | 判断の材料 |
|---|---|---|
| `tiers[].skipSections` | 要求ではない節（変更履歴・リスク表・作業パッケージ表）を外す | 外さないと、要求でない行に「最低 N 件へ分解せよ」が出る |
| `permissions.ask` の git 系 | どこまで承認制にするか | 承認が多すぎると形骸化する。`commit` / `push` は残す価値が高い |
| `tiers` と `edges` | そのプロジェクトに実在する段だけにする | **存在しない段を残すと「未判定 0」が嘘になる。** `check-config.mjs` が警告する |
| `tiers[].idPrefix` | テストの段をパスで分けられるか | 同じフォルダに単体と結合が同居するなら、ID で分ける |
| `goalRequired` / `ledgerRequired` | `always` / `phase` / `off` | 既存の負債が多いなら `phase` から始める |
| `wpLedger.file` | 作業パッケージ台帳を使うか | 空のままだと `wp.mjs start` / `add` はエラーで止まる（無言で成功しない） |
| `verifyOnCodeChange` | 毎ターン何を走らせるか | 重すぎると hook がタイムアウトし、**タイムアウトは無検査で通る** |

### 文書で代替してはいけないもの

移植先の AI に引き継ぎ書を渡せば済む、と考えたくなる設定がある。**済まない。**
この `.claude` 一式は「規約は守られない」という前提の上に立っている。
`rules/core.md` §5 が「『気をつける』は手段ではない」と書いているのはそのためで、
`permissions` と hook を文書に置き換えるのは、この仕組みの前提そのものを外すことになる。

**文書の役割は、強制の代わりではなく、強制の理由を残すこと。**
`rationale.md` が「どのゲートが何を防ぐか／外すとどうなるか」を 1 行ずつ持っているのは、
**外す判断をするときに読むため**であって、ゲートの代わりに読むためではない。
