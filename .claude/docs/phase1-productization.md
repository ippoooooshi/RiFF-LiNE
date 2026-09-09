# Phase 1 完成・製品化パッケージ（運用索引）

> 権威: `docs/detailed_design/phase1-productization.md`（D1 で新規作成）、`docs/basic_design/15_development_process.md` §4.1（実施順に「9. 完成・製品化」を追加）／§4.1.2、`docs/basic_design/00_overview.md` 進捗ログ。
> 本ファイルはセッション運用の索引であり、方針の出典は常に上記。矛盾を見つけたら上記を正とし、本ファイルを直す。

## 1. 背景（なぜこのパッケージを立てたか）

WP1〜8 は自動ゲート（typecheck / lint / test / build）＋パッケージ単位セルフレビューでマージしたが、**DoD 基準5（実 UI 手動シナリオ）を全パッケージ WP8 へ繰り越していた**（G23）。WP8 の実 UI で初めて通し確認したところ:

- 編集ウィンドウ白画面（bootstrap 初期化順バグ。`66e60a7` で是正済み）
- 曲一覧のカードアクション（名前変更／タグ編集／複製／ゴミ箱へ）・各パネル・再生ボタン・ショートカットが `() => undefined` のダミー配線で**無反応**
- 15 画面が `docs/basic_design/14_visual_design_system.md`（14章）未到達。二重メニューバー等の構造破綻（G25）
- WP4〜8 の detailed_design が責務レベルの散文止まり（G1）で、「設計どおりに実装できているか」を検証する土台が精密でない
- 設計の横断整合性は過去のセルフレビューで「是正済み」と自己申告しただけで、独立の全体監査を通していない

→ 「数件のバグ潰し」ではなく、**設計からやり直して製品水準に到達させる横断パッケージ**を立てる（本人決定 2026-09-09）。「このアプリの前提は製品」であり、現状の見た目・品質・結線状態は既製品として通用しない、という判断。

## 2. パッケージ定義

| 項目 | 値 |
|---|---|
| 名称 | Phase 1 完成・製品化 |
| スラッグ / ブランチ | `phase1-productization` / `feature/phase1-productization` |
| 詳細設計書 | `docs/detailed_design/phase1-productization.md`（D1 で作成。既存 screens-navigation / editing-core / view-modes / playback-integration / part-tuning-management の UI・配線部分を製品仕様へ引き上げる横断設計） |
| 種別 | 横断（XL 相当）。サブ機能分割: D1 / D2 / I1 / I2 / F |
| 実施順 | Phase 1 の「9. 完成・製品化」（全 8 パッケージのマージ後） |
| 前提 | PR #9（WP8）を squash マージ。`docs/detailed_design/screens-navigation.md` §9.0.1 の P2-a は本パッケージへ移送・注記。G23 / G24 / G25 ＋ 配線残（`15_development_process.md` §4.1.2）を本パッケージへ集約 |

## 3. ゴールと完了判定（正は詳細設計書）

**サブ機能ごとのゴール（G-D1／G-D2／G-I1／G-I2／G-F）と、パッケージの完了判定は [`docs/detailed_design/phase1-productization.md`](../../docs/detailed_design/phase1-productization.md) §3・§8 が正。** 本ファイルに転記しない（同じ事実を 2 箇所に書かない＝[quality.rule.md](../rules/quality.rule.md) Q2）。ゴールの立て方そのものの規約は [goal.md](../commands/goal.md)。

設計ゲート＝`sdlc-design-review` PASS（G-D1・G-D2）、実装ゲート＝`sdlc-impl-review` PASS ＋ 本人が実アプリで P1〜P7 全 PASS（G-I1・G-I2・G-F）。

## 4. 進め方（各サブ機能後に独立レビュー）

```
D1 設計監査＋是正＋G1解消
D2 画面・ビジュアル設計（03/14章）を製品水準へ
   └─▶ 設計ゲート（sdlc-design-review PASS = G-D 達成）
I1 機能の全結線＋フレット入力バー／音価パレット／AlphaSynth 実体化
I2 UI 実装 to 14章
   └─▶ 実装ゲート（sdlc-impl-review PASS ＋ 本人 P1〜P7 全 PASS = G-I 達成）
F  E2E（P1〜P7 実アプリ通し・記録）
```

実装は機能（I1）→ UI（I2）の順。設計（D1・D2）は UI/UX まで含む。

## 4.1 D1 のバッチ分割（セッション運用）

ゴール本体は詳細設計書 §3.1（G-D1）。ここは D1 を 1 セッションで扱える単位に割った作業計画で、各バッチ完了時に検証コマンドを**実測**して記録する（着手前 `pnpm check:docs` = 75）。

| # | 対象 | 検証 | 実測 |
|---|---|---|---|
| D1-b1 | リンク衛生（MJ-B1〜B6、MN-B2／B3）＋チェッカ強化 | `pnpm check:docs` = 0 | **0 件（達成）** |
| D1-b2 | パッケージ登録（15章 §4.1／§4.1.2、00_overview、00_reference §1、詳細設計書の新規作成、B37） | 実施順表に「9」行が在る／`docs/detailed_design/phase1-productization.md` が在る | — |
| D1-b3 | Blocking（BL-1〜BL-6）＋ B38〜B41 登録 ＋ 要件↔コマンド↔テストの双方向対応表 ＋ テスト ID 採番簿 | 要件4.1 の各記譜要素にコマンド行が対応し、空欄が無い | **達成**（12_traceability §6。逆方向検算で BL-3〜BL-6・MJ-A7 を追加検出） |
| D1-b4 | Major（MJ-A1〜A7／MJ-C1〜C5）＋ Minor 一括 | 監査記録 §8 の各項目にチェックが入る | — |
| D1-b5 | G1 埋め戻し（パッケージ4〜8 を署名レベルへ） | 各詳細設計書に引数・返り値・例外の記載が在る | — |
| D1-b6 | テスト ID の付与（33 ファイル） | `pnpm check:test-ids` = 0 | 未着手（着手前 **33 ファイル未付与**） |

範囲外として D1 から外したもの: `]][[#N]]` ショートハンド記法の統一（MN-B1、37 件。参照先の節はすべて実在するため機能的な壊れではない。D1-b4 で扱う）。

## 5. 実行コマンド

| コマンド | 用途 | 使うフェーズ |
|---|---|---|
| `/audit-consistency` | 設計ドキュメント全体の横断整合監査（独立 3 観点）。検出のみ、是正は sdlc-design | D1 |
| `/audit-fidelity` | 実装 vs 設計の全体照合 ＋ ダミー配線の機械チェック。検出のみ、是正は sdlc-impl | I1 前後、実装ゲート前 |
| `/new-wp` | 「Phase 1 完成・製品化」を対象パッケージとして 6 ステップ開始（実施順 9） | 着手時 |
| `/run-tests` | 型 → Lint → 単体 → 結合の順次実行 | 各サブ機能後 |
| phase-gate スキル | サブ機能／パッケージ境界の同期更新・ゲート確認 | 各境界 |

## 6. ステータス（着手可否の速見。進捗の正は `docs/basic_design/00_overview.md`）

- [x] PR #9（WP8 シェル）を squash マージ（`45569cd`）
- [x] `feature/phase1-productization` 作成
- [x] 品質規約・機械的ゲートの資産化（`quality.rule.md` / `quality.md` / `goal.md`、`check:docs` / `check:stubs` を CI へ）
- [x] **D1-b1** リンク衛生（`check:docs` 75 → 0）
- [x] **D1-b2** `docs/` へパッケージ登録（15章 §4.1 実施順9・§4.1.2 の集約、`00_overview.md` 0.28節・索引・ステータス、`00_reference.md` §1、`13_design_decision_points.md` B37、詳細設計書 `phase1-productization.md` 新規）
- [x] **D1-b3** Blocking（BL-1〜BL-6。逆方向検算で 4 件追加検出）＋ B38〜B41 ＋ 双方向トレース表（12_traceability §6）＋ テスト ID 採番簿（11章 §3.1）＋ `check:test-ids` 新設 ＋ G26〜G30 起票
- [ ] **D1-b4** Major（MJ-A1〜A7／MJ-C1〜C5）＋ Minor ← **次アクション**
- [ ] **D1-b5** G1 埋め戻し（パッケージ4〜8 を署名レベルへ）
- [ ] **D1-b6** テスト ID の付与（33 ファイル）
- [ ] D2 → 設計ゲート → I1 → I2 → 実装ゲート → F
