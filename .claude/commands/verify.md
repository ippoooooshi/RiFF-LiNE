---
description: 検証コマンドをまとめて実行し、失敗を分析する（実装は変更しない）
argument-hint: [docs | typecheck | lint | test | stubs | tests | ledger]
---

# 検証

```bash
node .claude/scripts/verify.mjs $ARGUMENTS
```

引数なしで、コード変更時の一式（`typecheck` / `lint` / `test` / `stubs` / `tests` / `coverage` / `docs` / `wp`）を実行する。

**検査スクリプト自身の検査（`smoke`）はここに含まれない。** 毎ターン走らせると Stop hook が
タイムアウトし、**タイムアウトは non-blocking 扱いでターンを通す**——重すぎる検査は、検査が無いのと同じになる。
`node .claude/scripts/verify.mjs smoke` か `/migrate`、CI で走らせること。

Stop hook も同じものを実行するので、**ここで緑にならない限りターンを終えられない**。「実行したと報告する」ではなく「実行して緑である」が条件。

## 失敗したとき

1. 失敗ケースを次の表で報告する

   | ケース | 種別 | エラー要旨 | 推定原因 | 修正候補 |
   |---|---|---|---|---|

2. 関連するテスト ID と、検証対象の設計書の節番号を併記する
3. **推定原因は「推定」と書く。** 確かめたなら根拠（読んだファイル:行）を書く
4. このコマンドの中では実装を変更しない。修正候補を出すところまで

## 個別に走らせる

```bash
node .claude/scripts/verify.mjs docs        # 相互参照の実在検証のみ
node .claude/scripts/check-stubs.mjs        # ダミー配線・未結線
node .claude/scripts/check-tests.mjs        # テスト ID・空振り
node .claude/scripts/ledger.mjs stats       # 網羅台帳の未判定件数
node .claude/scripts/smoke.mjs              # 検査スクリプト自身が壊れていないか（約 4 秒）
```

カバレッジ計測は `pnpm test -- --coverage`（別途）。パッケージ完了時の mutation testing は `/wp done` の判定に含まれる。

## 注意

- テスト実行中の標準出力に機微情報が混入していないか確認する
- ネットワークを要するテストは存在してはならない
