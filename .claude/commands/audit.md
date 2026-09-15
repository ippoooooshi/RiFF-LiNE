---
description: 横断監査。設計体系全体、または実装 vs 設計を独立観点で照合する（検出のみ、是正はしない）
argument-hint: design | impl
---

# 横断監査

引数: `$ARGUMENTS`（`design` または `impl`）

対象は特定パッケージではなく**全体**。このコマンドは**検出だけ**を行う。是正は `design` / `impl` エージェントの仕事。

---

## `design` — 設計体系の横断整合

### 先に機械で取れるものを取る

```bash
node .claude/scripts/check-docs-links.mjs        # 相互参照の実在
node .claude/scripts/ledger.mjs stats            # 未判定・不一致の件数
node .claude/scripts/ledger.mjs stale req->bd    # 上位変更で無効になった判定
```

**この結果を後続の観点に添付する。** 機械で分かることを AI に探させない。

### 独立3観点を並列で走らせる

`review` エージェントを3体、それぞれ別の観点で起動する（`Workflow({ name: 'audit', args: 'design' })`）。各観点の出力は `critic` を通し、`verify-evidence.mjs` で引用を照合する。

- **観点A トレーサビリティ** — 要件 → 基本設計 → 詳細設計 → `00_reference.md` §3 §5 の連鎖に、欠落・二重定義・未反映が無いか。ID の対応漏れ
- **観点B 引用の一致** — ある詳細設計が別の詳細設計のクラス／メソッド名を引用している箇所が、原典の現行シグネチャと一致するか
- **観点C 申し送りの履行** — 「別パッケージへ」「Phase 2 へ」「実装フェーズへ」と書いた申し送りが、受け側で実際に設計／実装されたか。§8.1 の未解消ギャップそれぞれの現況

### 統合

重複排除し、重大度（Blocking / Major / Minor）と是正方針を付ける。**重大度は「製品として出せるか」だけで決める。** 完成度を理由に下げない。

記録は `docs/review/design_audit_<YYYY-MM-DD>.md` に残す。

> この監査記録自身も相互参照の検査対象。過去に、リンク切れを指摘する監査記録が 40 本のリンク切れを持っていた。書き終えたら `check-docs-links.mjs` を通すこと。

---

## `impl` — 実装 vs 設計

### 先に機械で取れるものを取る

```bash
node .claude/scripts/check-stubs.mjs             # ダミー配線・未結線・放棄マーカー
node .claude/scripts/check-tests.mjs             # テスト ID・空振り
node .claude/scripts/verify.mjs                  # typecheck / lint / test
node .claude/scripts/ledger.mjs stats            # dd->impl / impl->ut / dd->it の未判定
```

### bootstrap 配線の確認

設計が「UI から呼ぶ」と定めたサービス・メソッドを1件ずつ取り、実コードに呼び出し箇所があるかを確認する。**設計側の接続先表が列挙の源であり、コードを眺めて探さない。** 無いものを「未結線」として記録する。

### `review` を全体スコープで起動する

観点は `.claude/agents/review.md` の「実装をレビューするとき」に準じる。加えて：

- 設計の各クラス／メソッドの as-built 一致（`00_reference.md` §3 と実シグネチャ）
- E2E 経路が実コード上つながっているか
- レイヤー依存規則・Electron 既定値・オフライン制約

### 出力

「画面／機能 × 接続先 × 状態（未結線 / 乖離 / OK）× 是正先」の表。

**機械で確認できない項目**（見た目・音・操作感）は「本人環境必須」と明記し、`node .claude/scripts/state.mjs show` で見える `pendingHuman` に積む。AI が「たぶん大丈夫」と埋めない。

---

## 禁止

- 是正（ドキュメント・コードの変更）
- `git` 操作
