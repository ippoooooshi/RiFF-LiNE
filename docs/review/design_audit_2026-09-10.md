# 設計横断整合監査（2026-09-10）

- **位置づけ**：「Phase 1 完成・製品化」パッケージ D1（[`.claude/docs/phase1-productization.md`](../../.claude/docs/phase1-productization.md) G-D-1 / G-D-2）の設計監査記録。
- **対象**：`docs/tab_app_requirements.md`、`docs/basic_design/*.md`（16）、`docs/detailed_design/*.md`（9 パッケージ＋`00_reference.md`）、`docs/review/*.md`（既存3本）。
- **方法**：実装との対話履歴を持たない独立3観点を並行実施（[[../basic_design/15_development_process.md#6]] C6 運用）。
  - 観点A トレーサビリティ（要件 → 基本設計 → 詳細設計 → `00_reference` §3/§5 の連鎖、G1 の実態）
  - 観点B クロスリファレンス（全 Wikilink の実在、詳細設計間のクラス/メソッド引用の原典一致、図と本文）
  - 観点C 申し送りの履行と `00_reference.md` §8.1 G1〜G25 の現況、未決着 B/C 事項
- **性質**：検出のみ。是正は D1 本体（`sdlc-design`）が文書同時改訂で行う。

## 1. サマリと判定

| 観点 | Blocking | Major | Minor |
|---|---|---|---|
| A トレーサビリティ | **6**（BL-1〜BL-6。うち BL-3〜BL-6 は D1 着手時の逆方向検算で追加検出） | 7（MJ-A7 も D1 着手時に追加検出） | 15 |
| B クロスリファレンス | 0 | 11系統＋MJ-B6（本記録自身） | 6系統 |
| C 申し送りの履行 | 0 | 5 | 12 |

- **Blocking 6件はすべて「要件4.1 の記譜要素にコマンド実装経路が無い」**（G2＝`SetTempoCommand` 欠落 と同型の見落とし）。AD-2（全 Score 変更はコマンド経由）に反する。**「Phase 1 完成・製品化」を名乗る前に設計是正（コマンド追加）＋G追記が必須。**
  - 当初は BL-1（曲途中の拍子変更）・BL-2（繰り返し記号）の 2 件としていたが、D1 是正の着手時に**要件4.1 の全行を 1 行ずつコマンドへ突き合わせた**ところ、BL-3（アクセント）・BL-4（チョーキング／タッピング／スラップ／ポップ）・BL-5（付点）・BL-6（連符）が追加で判明した。いずれも `02_data_model.md` が要件をモデルのフィールドへマッピングした先で、**そのフィールドを変更するコマンドだけが欠けている**という同一の構造（§2 末尾）。`SetTempoCommand`（G2）から数えて同型が計 6 件
- Major の大宗は (1) Wikilink ハイジーン（実装済みクラスへの死んだアンカー、プロセス権威文書のリンク切れ11件）、(2) 未履行の申し送り、(3) 非機能前提と as-built の矛盾（B30 の lazy-loading 無効化）、(4) 要件↔テストのトレース成果物・UT/IT 採番簿の不在、(5) 撤回済み要件引用の残存。
- **未決着カテゴリ B/C 事項：0件**（G-D-5 は現時点で充足。B1〜B36・C1〜C14 すべて「確定」）。
- カテゴリ A（実機検証待ち）は A4/A5/A6/A8/A9/A10（Phase 1/2）、A7（Phase 6）、A11/A12（Phase 3）。いずれも設計上フォールバック構造化済みで本パッケージのブロッカーではない。

## 2. Blocking

### BL-1　曲途中の拍子変更コマンドが存在しない

- **対象**：[[../basic_design/04_editing_core.md#10]] / [[../detailed_design/editing-core.md#6.4]] / [[../detailed_design/00_reference.md#3.4]] / [[../basic_design/02_data_model.md#3.3]]
- **内容**：要件4.1「拍子・テンポ｜曲の途中での変更に対応」。`02_data_model.md` §3.3 が `Bar.timeSignature` をこの要件へ明示マッピングし、AD-2 が全 Score 変更のコマンド経由を必須化しているにもかかわらず、`SetTempoCommand`（テンポ用）はあるが `SetTimeSignatureCommand` 相当がどのコマンド一覧にも無い。§10 は「小節挿入時の拍子継承チェーン初期化（B5）」のみを扱い、既存小節の拍子を編集する経路が無い。**G2 と完全に同型の未検出漏れ。MVP 機能要件に実装経路ゼロ。**
- **是正方針**：`SetTimeSignatureCommand` を [[../detailed_design/editing-core.md#6.4]] に追加（`affectedTrackIndices` ＝当該 MasterBar 全パート、拍子継承チェーンの再計算を含む）。[[../detailed_design/00_reference.md#3.4]] as-built・[[../detailed_design/00_reference.md#8.1]] に G 追記。[[../basic_design/11_test_strategy.md#2]] の C2 対象へ。起動 UI（テンポ/拍子の数値直接入力）は MJ-3 と併せて画面設計へ。

### BL-2　繰り返し記号（リピート）の編集コマンドが存在しない

- **対象**：[[../basic_design/02_data_model.md#3.5]] / [[../detailed_design/editing-core.md#6.4]]
- **内容**：要件4.1「リピート記号／セクションマーカー」。`02_data_model.md` §3.5 は「繰り返し記号自体は alphaTab の MasterBar 属性をそのまま利用する」とだけ書き、AD-2 に反してコマンド化されていない。`AddSectionMarkerCommand` 等はセクション名のみで repeat 属性（開始/終了リピート・リピート回数）を touch しない。BL-1 と同じ G2 型の漏れ。
- **是正方針**：`SetRepeatCommand` 相当（開始/終了フラグ、`repeatCount`）を [[../detailed_design/editing-core.md#6.4]] に追加。`00_reference` as-built・§8.1 に G 追記。バリデーション（終了のみリピートの扱い等）も定義。

### BL-3　アーティキュレーション「アクセント」の編集経路が存在しない

- **対象**：[[../basic_design/02_data_model.md#3.4]]（`Note.accent` 行）／[[../basic_design/04_editing_core.md#6]]／[[../detailed_design/editing-core.md#6.4]]／[[../detailed_design/00_reference.md#3.4]]
- **内容**：要件4.1「アーティキュレーション記号｜アクセント・スタッカート等の基本記号にも対応」。`02_data_model.md` §3.4 は `Note.accent` を**この要件へ明示マッピングしている**にもかかわらず、as-built の `NoteTechniquePatch`（`packages/core/src/editing/commands/noteAttributeCommands.ts`）が持つキーは `slideOutType` / `slideInType` / `isHammerPullOrigin` / `harmonicType` / `harmonicValue` / `isStaccato` / `isPalmMute` / `isLetRing` / `isGhost` / `vibrato` の 10 件で、**アクセントに対応するキーが無い**。スタッカートのみ実装され、アクセントは経路ゼロ。alphaTab 1.8.4 は `Note.accentuated: AccentuationType`（`None`/`Normal`/`Heavy`/`Tenuto`）を持つため、モデル側の受け皿は存在する。既出の MN-12（「`Note.accent` 設定コマンド経路が一義的でない」）は実態としては「存在しない」であり、Minor ではなく Blocking に格上げする（[quality.rule.md](../../.claude/rules/quality.rule.md) Q8）
- **是正方針**：`NoteTechniquePatch` に `accentuated?: AccentuationType` を追加（04章 §6.2 が「いずれの場合も `SetTechniqueCommand` という単一コマンド形状に統一」と定めているため新規コマンドは作らない）。MN-12 は本項目に統合。

### BL-4　奏法記号のうちチョーキング・タッピング・スラップ・ポップの編集経路が存在しない

- **対象**：[[../basic_design/04_editing_core.md#6.2]]／[[../detailed_design/editing-core.md#6.4]]／[[../detailed_design/00_reference.md#3.4]]
- **内容**：要件4.1「奏法記号｜チョーキング／スライド／ハンマリング・プリング／パームミュート／ビブラート／ハーモニクス（自然・人工・ピンチ）／タッピング・スラップ・ポップ を含め**フル対応（MVPから）**」。`04_editing_core.md` §6.2 は「チョーキングの幅（1音／半音／1音半／カスタム）…タッピング／スラップ／ポップの種別は…`SetTechniqueCommand` という単一コマンド形状に統一する」と**名指しで書いている**が、as-built の `NoteTechniquePatch` に該当キーが無い。リポジトリ全体で `bend` / `slap` / `tap`（奏法としての）の識別子は 0 件（`Array.pop` と `TapTempoController` の無関係な一致を除く）。設計が定めた内容が実装されていない DoD 基準2 違反でもある
- **是正方針**：Note 単位（チョーキング）は `NoteTechniquePatch` に `bendType?: BendType` / `bendPoints?: readonly BendPointSpec[]` を追加。Beat 単位（`Beat.slap` / `Beat.pop` / `Beat.tap` はいずれも Beat のブール属性）は Note 単位の patch に混ぜられないため `SetBeatTechniqueCommand` を新設し、単一コマンド形状の原則は「Note 単位＝`SetTechniqueCommand`／Beat 単位＝`SetBeatTechniqueCommand`」の 2 形状に改める（B40 として登録）。

### BL-5　付点の編集経路が存在しない

- **対象**：[[../basic_design/02_data_model.md#3.4]]（`Beat.duration（分数＋付点フラグ＋連符情報）` 行）／[[../detailed_design/editing-core.md#6.4]]
- **内容**：要件4.1「記譜スタイル｜**正式なリズム記譜（付点・タイを含む）**」。`02_data_model.md` は `Beat.duration（分数＋付点フラグ＋連符情報）` を要件4.1 へマッピングしているが、as-built で `Beat.dots` に触れるコードは 0 件。`CursorController` が保持する入力音価は `model.Duration`（分数のみ）で、付点を表現できない
- **是正方針**：入力音価の型を `BeatDurationSpec = { duration: Duration; dots: 0|1|2; tuplet: TupletSpec|null }` へ拡張し、`CursorController.setDuration` / `PlaceNoteCommand` / `InsertRestCommand` / `ClipboardService` / `PasteCommand` を追随させる。既存 Beat の音価変更用に `SetBeatDurationCommand` を新設（BL-6 と同一コマンドで扱う）。

### BL-6　連符（3連符等）の編集経路が存在しない

- **対象**：[[../basic_design/02_data_model.md#3.4]]／[[../detailed_design/editing-core.md#6.4]]
- **内容**：要件4.1「音価｜**32分音符・3連符等の連符にも対応**」。`02_data_model.md` §3.4 が alphaTab 標準階層を採用する理由として「32分音符・連符（要件4.1）」を明示しているが、as-built で `tuplet` に触れるコードは 0 件（alphaTab の `Beat.tupletNumerator` / `tupletDenominator` は未使用）。32分音符自体は `model.Duration` に含まれるため充足しているが、連符は経路ゼロ
- **是正方針**：BL-5 と同じ `BeatDurationSpec` / `SetBeatDurationCommand` で扱う。連符の入力単位（1 Beat ごとに指定するか、選択範囲へまとめて適用するか）を B41 として確定する。

### BL-1〜BL-6 に共通する検出経緯（重要）

BL-1・BL-2 は本監査（順方向＋逆方向の混在）で検出したが、**BL-3〜BL-6 は D1 是正の着手時に「要件4.1 の全行 × 対応コマンド」を機械的に突き合わせて初めて検出した**。すなわち本監査自身も、要件の行を 1 つずつ潰す形では検算していなかった。共通する構造は次のとおり。

- `02_data_model.md` は**要件4.1 の各要素をモデルのフィールドへマッピングする表を持っている**（`Bar.timeSignature`／`Note.accent`／`Beat.duration（付点・連符）`）。つまり「要件 → モデル」までは繋がっていた
- 欠落しているのは常に「モデルのフィールド → それを変更するコマンド」の一段だけであり、AD-2（Score 変更はすべてコマンド経由）に照らせば**機械的に検出できた**
- したがって再発防止は「注意する」ではなく、**モデルの変更可能フィールドとコマンドの対応表を成果物として維持し、空欄を許さない**こと（[[../basic_design/12_traceability.md]]、[quality.rule.md](../../.claude/rules/quality.rule.md) Q6）

同型の見落としは `SetTempoCommand`（G2、2026-09-02）から数えて計 6 件になる。

## 3. Major（統合）

### 3.1 トレーサビリティ（観点A）

| # | 対象:節 | 内容 | 是正方針 |
|---|---|---|---|
| MJ-A1 | [[../basic_design/08_error_logging.md#1]] §1.2 | 例示「`FILE-003`＝チェックサム不一致」が誤り。実体は `FILE-002`＝`IntegrityCheckFailedError`（Critical）、`FILE-003`＝オンデマンドDLリトライ全滅（Error）。`00_reference` §5・`error-logging-foundation.md` §4 と矛盾し、同文書 Critical 行の例とも食い違う | §1.2 の例を `FILE-002` へ訂正 |
| MJ-A2 | [[../basic_design/09_nonfunctional.md#1]] §1/§2 / [[../detailed_design/web-core-foundation.md#6]] / [[../basic_design/13_design_decision_points.md#2]] A9 | 30fps 実現前提が as-built と矛盾。09章は「alphaTab のレンダリング仮想化（画面外小節を描画しない）に依存」と明記するが、B30（2026-09-07）で `core.enableLazyLoading: false` を全体確定しており画面外描画抑制が無効。09章も A9 も B30 を織り込んでいない | `09_nonfunctional.md` §1/§2 に B30 の影響と「大曲時 fps は A9 フォールバック前提」を明記、A9 の前提を更新 |
| MJ-A3 | [[../basic_design/03_screens_ui_pc.md#6]] §6/§7 / [[../detailed_design/screens-navigation.md#4.8]] / [[../detailed_design/editing-core.md#6.4]] | 要件4.1 の編集アフォーダンスが UI に不着地：(a) テンポ数値直接入力、(b) 拍子変更（BL-1）、(c) コードネーム手動修正。コマンドはあるが（または BL-1 で追加）、起動する UI が §4.8 に無い。editing-core.md §6.4 は「将来の数値直接入力UI（パッケージ8）」と前方参照するが WP8 未受領 | §4.8 に UI を追加（数値入力ポップオーバー等）。本パッケージのスコープに明示 |
| MJ-A4 | [[../basic_design/12_traceability.md]] 全体 | 要件→設計トレース成果物が 2026-09-03 で凍結。詳細設計層・as-built・テストを反映せず。§5 完了基準チェックリストは Phase 0 未チェックのまま。要件↔テストを閉じる単一成果物が不在 | D1 で要件↔詳細↔as-built↔テストの対応表を新設 or 12章を実装フェーズ対応版へ更新 |
| MJ-A5 | [`.claude/rules/tests.rule.md`](../../.claude/rules/tests.rule.md) / [[../basic_design/11_test_strategy.md#3]] | 中央的な UT-/IT- 採番簿が無い。§3 は ID を持たない対象表。実コードのテストID（`UT-VIEW` `IT-WIN-07` `UT-UI-PCO` 等）はパッケージ毎に衝突制御なく命名 | 11章§3 に ID 列を追加、またはテストID台帳を新設し採番規則（プレフィックス予約）を定義 |
| MJ-A6 | [[../basic_design/01_architecture.md#3]] AD-2 | 「要件書4.5節『セッション内無制限』を満たすため」を設計ドライバとして引用し続けているが、C11（要件変更履歴#12）で撤回済み（80MB 予算モデルへ移行）。`04_editing_core.md` §8 ヘッダは是正済みだが AD-2 は未同期 | AD-2 の要件引用を「メモリ予算に基づく実務上十分な深さ（C11）」へ更新 |
| MJ-A7（**D1 是正着手時に追加検出**、2026-09-10） | `packages/core/src/**/*.test.ts`／`apps/desktop/src/**/*.test.ts` 全体 | [tests.rule.md](../../.claude/rules/tests.rule.md)「各テストの先頭コメントに、対応するテスト ID（`// UT-XXX` / `// IT-XXX`）と、検証している詳細設計書の節番号を明記」に反し、**87 テストファイル中 33 ファイルがテスト ID を 1 つも持たない**。パッケージ単位で欠落しているものが多い：`packages/core/src/persistence`（WP2、9 ファイル全滅）、`packages/core/src/playback`（WP7、9 ファイル全滅）、`packages/core/src/domain`（5 ファイル）、`viewmodes` の `ViewModeController` / `ZoomController`、`apps/desktop/src/main` の一部。要件 → 設計 → API → **テスト ID** の鎖が最後の一段で切れており、MJ-A5（採番簿の不在）の実害がこれ | 中央のテスト ID プレフィックス台帳を[[../basic_design/11_test_strategy.md#3]]へ新設し（MJ-A5 と同時に是正）、`pnpm check:test-ids` で「全テストファイルが登録済みプレフィックスの ID を持つ」ことを機械的に強制する。既存 33 ファイルへの ID 付与は D1-b6 |

### 3.2 クロスリファレンス（観点B）

| # | 対象 | 内容 | 是正方針 |
|---|---|---|---|
| MJ-B1 | [[../basic_design/15_development_process.md#4.1.1]] §4.1.1・§4.1.2（L207/211/212/214/220/224–227） | `[[../detailed_design/export-print.md]]` `[[../detailed_design/00_reference.md#8.1]]`×4 `[[../detailed_design/screens-navigation.md#9.0]]`×2 `[[../detailed_design/playback-integration.md#10]]` 等 **11 リンクで `../detailed_design/` プレフィックス欠落**。§4.1.1（2026-09-02追加）と §4.1.2（2026-09-09追加、本監査直前に作成）の双方。プロセス権威文書のリンク切れ | 11 リンクに `../detailed_design/` を補完。**§4.1.2 は本パッケージ D1 で登録し直す際に併せて是正** |
| MJ-B2 | [[../detailed_design/00_reference.md#2]] §2/§3.7/§9.24（L39/L159/L501） | `ChordDetectionService（[[../detailed_design/editing-core.md#3.4]]）`×3。`editing-core.md` に §3.4 は無い（`ChordDetectionService` は §8）。G3 の再発型（他書クラスの節位置誤参照） | `[[../detailed_design/editing-core.md#8]]`（責務）または `[[../detailed_design/00_reference.md#3.4]]`（as-built）へ統一 |
| MJ-B3 | [[../basic_design/00_overview.md#0]] §0.9/§0.11、[[../basic_design/13_design_decision_points.md#3]] L85、[[../basic_design/08_error_logging.md#1]] L32、[[../basic_design/07_export_print.md#6]] L66 | いずれも `../detailed_design/` プレフィックス欠落（`data-model-persistence.md#11` `view-modes.md` `playback-integration.md#3.2` `00_reference.md#5` `screens-navigation.md#3.6`） | プレフィックス補完 |
| MJ-B4 | [[../detailed_design/export-print.md]] §0前提 L13・DoD L233、[[../detailed_design/playback-integration.md#4.4]] L113、[[../detailed_design/00_reference.md#9]] §9.13 L384・§9.16 L404 | `[[../detailed_design/screens-navigation.md]]` 等、詳細設計書を `../basic_design/` から参照する誤り（5件）。§9.16 は存在しない `basic_design/00_reference.md` を指す（正：本ファイル §5 の自己参照） | ディレクトリ／自己参照を修正。playback-integration.md L113 は同一行に正しいリンクが併記されており誤りの方を削除 |
| MJ-B5 | docs 全体 → `.claude/rules/` への Wikilink 12件（`[[../rules/ui.rule.md]]`×9、`[[../rules/layer-architecture.rule.md]]`×2、`[[layer-architecture.rule.md]]`×1） | `docs/rules/`（不在）に解決。docs→`.claude` は Wikilink 規約外（`docs.rule.md` 体裁節：`.claude` 内は Markdown 相対リンク） | `../../.claude/rules/...` の Markdown 相対リンクへ統一、または `docs.rule.md` に例外を明記して統一 |

| MJ-B6（**D1 是正着手時に自己検出**、2026-09-10） | 本監査記録 `design_audit_2026-09-10.md` 自身 | 本記録が Wikilink を `[[editing-core.md#6.4]]` のようなファイル名のみで書いており、`docs/review/` からは `docs/review/editing-core.md` に解決して**40 本すべてが壊れていた**。リンク切れを指摘する文書が同じ欠陥を持っていた（`pnpm check:docs` の 75 件のうち 40 件が本記録由来） | 参照元からの相対パスへ是正済み。根本原因は「ファイル名だけの省略形は参照元ディレクトリ次第で壊れたり壊れなかったりし、書いた本人には気づけない」こと。`docs.rule.md`「体裁」に参照元 × 参照先の記法表を追加し、機械検証（`check:docs`）を唯一の判定手段に統一した |

### 3.3 申し送りの履行（観点C）

| # | 申し送り元:節 | 申し送り先 | 履行 | 是正方針 |
|---|---|---|---|---|
| MJ-C1 | [[../detailed_design/error-logging-foundation.md#9]] §9.3（`FILE-003` の `report()` は `SongRepository.load` を配線する bootstrap＝WP8 へ） | WP8 bootstrap | **未** | `SongRepository.load` の renderer 結線（曲を開く経路）そのものが `00_reference` §9.25・§4.1.2「配線残」に無い。本パッケージ I1 のスコープに明記し、§9.3 の宛先を更新 |
| MJ-C2 | [[../detailed_design/error-logging-foundation.md#9]] §9.4（`CrashRecoveryController` の「同一操作3回」判定精緻化＝コマンド層コンテキスト配線／起動直後連続クラッシュ時の reload 打ち切り上限） | WP4 `editing-core.md` | **未**（WP4 未受領） | 本パッケージ or 追い込みの明示項目へ移送し、§9.4 の宛先を更新 |
| MJ-C3 | [[../detailed_design/editing-core.md#11]] §11/§13・`00_reference` §9.21/§9.22（`tools/` ワークスペース整備＋負荷テスト用スタンドアロン生成器＝全奏法記号網羅／2048小節フィクスチャ、WP実施順10「開発用サンプルデータ」） | 「Phase 1 後半」 | **部分**（`packages/core/src/testing/editingFixtures.ts` で暫定担保。`tools/` は `.gitkeep` のみ・`pnpm-workspace.yaml` 未登録） | F（E2E／負荷）着手前に `tools/` を整備 or `packages/core/src/testing` 恒久化を設計判断として記録。[[../basic_design/15_development_process.md#2]] のモノレポ構成記述と実体の乖離も是正 |
| MJ-C4 | [[../detailed_design/data-model-persistence.md#11]] §11（`index.json`／`trash-index.json` の索引更新をマルチウィンドウ本格対応時＝画面群パッケージで単一ワーカー直列化を検討） | WP8 | **未**（`.tabapp` 本体アトミック書き込み＋`rebuildFromSongsFolder()` で緩和はされている） | 複数編集ウィンドウ同時自動保存でのエントリ取りこぼしリスク。設計スコープに「索引更新の直列化 or リスク受容を明記」を追加 |
| MJ-C5 | [[../detailed_design/playback-integration.md#9]] §9（`PlaybackService.setSoloTracks`〈一時ソロ〉と `PlaybackMixerBinder.syncAll()`〈永続 `Part.solo`〉の調停をどちらが持つか） | WP8 → Phase 1 実機検証 | **未**（WP8 は playback 未配線） | I1（`AlphaSynth` 実体化）と同時に調停責務を確定し §4.3／§9 に明記 |

## 4. Minor（統合、doc 衛生中心）

観点A：MN-1 サムネイル申し送り本文未訂正（`data-model-persistence.md` §11）／MN-2 `editing-core.md` §14 が `SetTuningCommand` と誤記（実：`ApplyTuningPresetCommand`/`SetCustomTuningCommand`）／MN-3 `08_error_logging.md` §1 に `EDIT-007` 未反映／MN-4 `04_editing_core.md` §7 が造語 `Beat.chordNameOverride`（as-built は `Beat.text`）／MN-5 Critical フロー2件（小節削除に伴うメモ/マーカー消失確認・`FILE-002` 復元モーダルの Yes 動作＝`LocalBackupService.restore` 呼び出し主体）のハンドラ結線が未規定／MN-6 `10_extensibility_future.md` §1「Phase 1 で `AuthAdapter` の型だけ用意」claim に実体なし／MN-7 `part-tuning-management.md` §1 の誤 wikilink（`05_playback_audio.md#8`）／MN-8 `00_overview.md` §2 の 06章説明が要件変更前・§0 進捗ログ採番が非昇順／MN-9 詳細設計書の「実装時に確定した事項」節番号が不統一（§15／§10／inline／§8〜9）／MN-10 `screens-navigation.md` §9.0.1 に生の手動試験メモ残置／MN-11 `02_data_model.md` §2 ER図に孤立エンティティ `SONG_REVISION_META`／MN-12 `Note.accent` 設定コマンド経路が一義的でない／MN-13 メトロノーム音色プリセットの列挙・同梱アセット仕様がどこにも無い（C1／`05_playback_audio.md` §6 要求）／MN-14 `.tabapp` の OS ファイル関連付け登録・起動時パス処理がどの詳細設計にも無い（要件5.6）／MN-15 2026-09-03 運用ルール「新規クラスは3択スコープ明記」が WP8 新設クラスの大半に未適用。

観点B：MN-B1 `]][[#N]]` ショートハンド 36件（継承先の節は全て実在。記法の曖昧さのみ）／MN-B2 `13_design_decision_points.md` B32 が存在しない `error-logging-foundation.md §9.5` を引用（正：§2.4）／MN-B3 `00_overview.md` L108 の記法説明例が実在しない `01_architecture.md#2.2` を使用／MN-B4 `00_reference.md` §6 本文「パッケージ8は1〜7すべてに依存」に対しグラフに `P1→P8` 直接エッジ無し（推移的）／MN-B5 見出し番号の飛び（`editing-core.md` §14→§15、`part-tuning-management.md` §9→§15）。

観点C：`data-model-persistence.md` §11 サムネイル申し送り文の未同期（G6 解消済みだが originating 未訂正、MN-1 と同一）／`export-print.md` §1 の画面インベントリ番号混在（#10/#11 と #14/#15）／`part-tuning-management.md` 見出し欠番（§10〜14）／`08_error_logging.md` §1 Error 行の `TAG-001` コード註記漏れ（G20 系）／`screens-navigation.md` §9.0.1 P2-a 欄に B-3 是正注記が無い／`error-logging-foundation.md` §9.2「既知の粗さ」（`SchemaMigrator` が破損ファイルでも `FILE-004`「新しいバージョン」を発行）を §8.1 に follow-up として起こす／`13_design_decision_points.md` の C11 反映先 `#7` は `#6.2` を主参照にすべき・B18 反映先に実体化先（`domain/pitch.ts` 等）を追記。

## 5. G1 埋め戻し計画（WP4〜8 詳細設計書本体を署名レベルへ）

現状：詳細設計書本体は責務レベルの散文、シグネチャは `00_reference.md` §3.4〜3.8 の as-built にのみ存在。各書に、`00_reference` §3 の as-built を正として**メソッドシグネチャ（引数・返り値・例外時挙動）・型定義・状態遷移**を書き戻す。乖離（`TagStore.create` 等）は as-built に合わせる（DoD 基準2）。

| 書 | 埋め戻し対象（`00_reference` の参照節） |
|---|---|
| [[../detailed_design/editing-core.md]]（§3.4） | `Command` I/F の型定義／`CommandHistory` の `CommandOutcome`・`CommandAppliedEvent` 型と `onCommandApplied`／`CursorController`・`EditingService`・`ValidationService`・`ChordDetectionService`・`ClipboardService` の全メソッド／具象コマンド19種＋BL-1/BL-2 で追加する2種の引数・状態遷移／`SetTempoCommand` BPM 上下限（as-built 20/400）／`ChordDetectionService` の辞書カバー範囲・転回形優先順位／`NoteTechniquePatch` 構造と `Note.accent` の扱い（MN-4/MN-12） |
| [[../detailed_design/part-tuning-management.md]]（§3.5） | `PartManagementService`・`TuningPresetService`・`TuningPresetStore`・`PartColorAllocator`・`PartValidationService` の全メソッド／パート系コマンド11種／`PART_COLOR_PALETTE` の具体8色値／`BUILTIN_TUNING_PRESETS` 6種の内訳／見出し §10〜14 の採番是正（MN-9） |
| [[../detailed_design/view-modes.md]]（§3.6） | `ViewModeController`・`ZoomController` の全メソッド／`ScoreRenderHost.applyViewMode`・`applyZoom` の request 型／モード別既定ズーム％の確定値（as-built `{focus:180, scroll:100, score:100}`、暫定なら「暫定」と明記） |
| [[../detailed_design/playback-integration.md]]（§3.7・§10） | `PlaybackService` ほか7クラスの全メソッド／`PlaybackSynth`・`TickMap` I/F／`AudioSyncStrategy.sync()` シグネチャ／設定変更の即時反映 vs 次回再生の確定（§4.4 が未確定のまま）／メトロノーム音色プリセットの列挙・同梱アセット（MN-13）／`setSoloTracks` ↔ mixer 調停（MJ-C5） |
| [[../detailed_design/screens-navigation.md]]（§3.8） | 15画面/パネル/ダイアログの props・状態・イベント／`WindowManager`・`MenuBarController`・`KeyboardShortcutRouter`・`ToolbarViewModel`・`StatusBarViewModel`・`NotificationUIBinder`・`ScoreHighlightBinder`・`AppPreferencesService`・`TagStore`・`ThumbnailGenerator` の全シグネチャ／`ScoreRenderHost` ハイライト拡張の型／`AppPreferences` 型のフィールド一覧・型・レンジ／`TagStore.create` を as-built `Promise<Tag \| null>` に統一／新設クラスの3択スコープ注記（MN-15） |
| [[../basic_design/14_visual_design_system.md]] 対応 | 対応する詳細設計が無い。D2 で 03/14章を製品水準へ具体化する中で、トークン層の実装マッピング（CSS 変数 → コンポーネント）を確定（G25） |
| 基本設計が「実装時に確定」と委ね、詳細設計も未確定 | コードネーム検出アルゴリズム（04章§7／editing-core.md §8）／`.tabapp` の OS 関連付け登録・起動時パス処理（06章§11、MN-14） |

## 6. `00_reference.md` §8.1 G1〜G25 現況（観点C 精査）

- **G1〜G21**：台帳の「解消済み」表記は**すべて正しい**（観点C が設計・コード両面で確認）。ただし G5 行は `SONG-002`（C12 後日追加）を含まない記述古さ、G12 の `data-track-index` 方式は B34/G24 で撤回済み（追跡は G24 へ）。
- **G22（`presetId` provenance）**：未解消。`AppMetadata` にパート別 `tuningPresetId` の data-model 拡張が必要。表示モード／エクスポートで出自表示が要るまで持ち越し＝本パッケージ必須ではないが、G-D-5「未決着0件」の対象外（カテゴリ跨ぎの data-model 拡張）であることを明記。
- **G23（実 UI 手動シナリオ P1〜P7）**：未解消。P2-a は実機 FAIL 記録のまま（本人メモ「すべてを洗い出す必要がある」）。本パッケージ G-I-4 の中核。
- **G24（色オーバーレイ）**：コードは解消。実描画の目視は G23 P6 に内包（本人環境待ち）。
- **G25（14章ビジュアル未到達）**：未解消。本パッケージ G-D-4／G-I-3 の対象。
- **新規に §8.1 へ登録すべきギャップ**（D1 で採番）：BL-1（拍子変更コマンド）、BL-2（リピート編集コマンド）、MJ-A4（トレース成果物の凍結）、MJ-A5（UT/IT 採番簿不在）、MJ-C1（`SongRepository.load` renderer 結線）、MN-5（Critical 2フローのハンドラ結線）、MN-13（メトロノームプリセット仕様）、MN-14（`.tabapp` OS 関連付け）、`error-logging-foundation.md` §9.2（SchemaMigrator 破損／バージョン非対応分離）。

## 7. 未決着カテゴリ B/C 事項

- **カテゴリ B（B1〜B36）**：全件「確定」。⚠要検証・TBD の残置なし。
- **カテゴリ C（C1〜C14）**：全件「確定」。
- **結論**：G-D-5 の「未決着カテゴリ B/C 0件」は**現時点で充足**。ただし BL-1/BL-2 の是正で新たな設計判断（コマンド仕様、拍子継承の再計算方式、リピート回数上限）が生じるため、D1 でそれらを B 分岐点として登録し、決着させたうえで G-D-5 を再確認する。

## 8. D1 是正チェックリスト（`sdlc-design` 実施、文書同時改訂）

着手前に本パッケージを登録：
- [ ] [[../basic_design/15_development_process.md#4.1]] §4.1 に「9. 完成・製品化」行を追加、§4.1.2 を本パッケージへ集約し MJ-B1 の壊れリンクを是正
- [ ] [[../basic_design/00_overview.md]] 進捗ログに本パッケージ着手を記録、ステータス行・採番順を整備（MN-8）
- [ ] [[../detailed_design/00_reference.md#1]] §1 パッケージ一覧に追加、「Phase 1 完了の定義」の一本化（旧＝全8＋追い込み、新＝本パッケージ G-I-4 完了）

Blocking：
- [ ] BL-1 `SetTimeSignatureCommand` を editing-core.md §6.4・00_reference §3.4・§8.1・11章§2 へ／B 分岐点登録
- [ ] BL-2 `SetRepeatCommand` 相当を同様に

Major：
- [x] **MJ-B1〜B5**（クロスリファレンス）2026-09-10 是正。`pnpm check:docs` を 75 件 → **0 件**。あわせて記法の使い分け（`docs`→`docs` は Wikilink・`docs`→`.claude` は Markdown 相対リンク）を `.claude/rules/docs.rule.md`「体裁」に表として明記し、チェッカを Markdown 相対リンク検証・コードスパン除外に対応させた（Q5 再発防止）
- [ ] MJ-A1〜A6、MJ-C1〜C5 の各是正（表の是正方針どおり）

Minor：
- [x] **MN-B2**（B32 が存在しない `error-logging-foundation.md §9.5` を引用）→ §2.4・§3 への参照に訂正
- [x] **MN-B3**（`00_overview.md` の記法説明例が実在しない `01_architecture.md#2.2`）→ `#2` に訂正し記法の権威（`docs.rule.md`）への導線を追加
- [ ] §4 の残る Minor 群を一括是正（節番号統一、造語修正、孤立 ER 削除、スコープ注記追加、`08_error_logging.md` §1 の `EDIT-007`/`TAG-001` 追記 等）

G1・G25：
- [ ] §5 の表に沿って WP4〜8 の詳細設計書を署名レベルへ埋め戻し
- [ ] D2 で 03/14章を製品水準へ具体化（G25 の設計、二重メニュー等の構造矛盾の解決方針）

完了条件：
- [ ] `/audit-consistency` 再実行で新規 Blocking / Major が 0（G-D-1）
- [ ] `sdlc-design-review` が PASS（G-D 全項目）

## 9. 実装（G-I）へ確実に引き継ぐ既知未解決（再掲）

- G23：P1〜P7 実アプリ通し。`SongRepository.load`／`AutoSaveScheduler.flush` の renderer 結線、生 `AlphaSynth` の `PlaybackSynth` 実体化＋`preWarm` 起動配線、`KeyboardShortcutRouter` のキーイベント源、rename／trash／duplicate／保存先変更、エクスポート／印刷ダイアログ導線、BL-1/BL-2/MJ-A3 の編集 UI。
- G24：色オーバーレイの実描画目視。
- G25：15画面を 14章準拠へ（トークン層置換、共有部品、"rendered by alphaTab" 抑止、二重メニュー解消）。
- `() => undefined` ダミー配線ゼロ（`/audit-fidelity` の機械チェック）。
