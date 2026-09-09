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

## 3. 設計フェーズのゴール G-D

**品質ゲート: `sdlc-design-review` が下記 1〜5 の充足で PASS を出すこと。**

| # | ゴール | 検証 |
|---|---|---|
| G-D-1 | 横断整合監査: basic_design 16 ＋ detailed_design 10 ＋ 00_reference を**独立 3 観点**で監査し、矛盾・未履行の申し送りをゼロにする | `/audit-consistency` の指摘がすべて是正済み。監査記録が `docs/review/design_audit_<日付>.md` にある |
| G-D-2 | G1 解消: WP4〜8 の detailed_design を全クラス**署名レベル**へ。as-built と一致、乖離は明示是正 | `00_reference.md` §8.1 の G1 が「解消済み（日付）」。各 detailed_design にメソッドシグネチャ（引数・返り値・例外）記載 |
| G-D-3 | 画面設計（03章）: 全 15 画面 ＋ フレット入力バー ＋ 音価パレット ＋ 各パネル ＋ 再生 UI ＋ ショートカットの、要素・状態・遷移・**接続先（サービス/メソッド名）**を表で確定。「責務レベル」記述の撤廃 | `docs/detailed_design/phase1-productization.md` に画面 × 状態 × 接続先の表。`03_screens_ui_pc.md` と齟齬なし |
| G-D-4 | ビジュアル設計（14章）: トークン／タイポ／コンポーネント仕様を製品水準に具体化。構造矛盾（二重メニュー等）を設計で解消 | `14_visual_design_system.md` に確定値。二重メニュー問題の解決方針が設計に明記 |
| G-D-5 | 設計判断は全て `13_design_decision_points.md` に分岐点登録。未決着カテゴリ B/C 0 件、要件トレーサビリティ 100% | `11_test_strategy.md` §0 の KPI 表で確認 |

## 4. 実装フェーズのゴール G-I

**品質ゲート: `sdlc-impl-review` が PASS ＋ 本人が実アプリで P1〜P7 全 PASS。**

| # | ゴール | 検証 |
|---|---|---|
| G-I-1 | 設計が定めた全画面・全接続が実配線。ダミーハンドラゼロ | `grep -rn "() => undefined\|=> {}\|TODO\|FIXME" apps/desktop/src` が UI ハンドラで 0 ヒット。`/audit-fidelity` の未結線リストが空 |
| G-I-2 | フレット入力バー・音価パレット・全パネル・再生（生 `AlphaSynth` 実体化込み）が動作 | 各機能の結合テスト＋実機目視 |
| G-I-3 | 14章準拠の見た目（トークン適用、"rendered by alphaTab" 抑止、ヘッダ破綻なし） | 実機スクショで 14章 と突き合わせ |
| G-I-4 | P1〜P7 を実アプリ（`run-app.cmd`）で通し全 PASS | `screens-navigation.md` §9.0.1 に結果記録、`00_reference.md` §8.1 G23 を「解消済み」へ |
| G-I-5 | 全自動ゲート緑、カバレッジ KPI 維持、renderer `.tsx` も結合テスト対象 | `pnpm typecheck` / `lint` / `test`（`desktop-renderer` プロジェクト含む）/ `build` / `format` 緑 |

## 5. 進め方（各サブ機能後に独立レビュー）

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

## 6. 実行コマンド

| コマンド | 用途 | 使うフェーズ |
|---|---|---|
| `/audit-consistency` | 設計ドキュメント全体の横断整合監査（独立 3 観点）。検出のみ、是正は sdlc-design | D1 |
| `/audit-fidelity` | 実装 vs 設計の全体照合 ＋ ダミー配線の機械チェック。検出のみ、是正は sdlc-impl | I1 前後、実装ゲート前 |
| `/new-wp` | 「Phase 1 完成・製品化」を対象パッケージとして 6 ステップ開始（実施順 9） | 着手時 |
| `/run-tests` | 型 → Lint → 単体 → 結合の順次実行 | 各サブ機能後 |
| phase-gate スキル | サブ機能／パッケージ境界の同期更新・ゲート確認 | 各境界 |

## 7. ステータス（着手可否の速見。進捗の正は `docs/basic_design/00_overview.md`）

- [ ] PR #9（WP8 シェル）を squash マージ ← **次アクション**
- [ ] `docs/` へパッケージ登録（`15_development_process.md` §4.1 に「9. 完成・製品化」行、§4.1.2 を本パッケージへ集約、`00_overview.md` 進捗ログ）= D1 の最初のタスク（sdlc-design、文書同時改訂で一括）
- [ ] `feature/phase1-productization` 作成
- [ ] D1 → D2 → 設計ゲート → I1 → I2 → 実装ゲート → F
