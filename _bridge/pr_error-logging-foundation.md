## 作業パッケージ 3（エラー・ログ基盤）の作り直し

詳細設計 `docs/detailed_design/error-logging-foundation.md` と `00_reference.md` 5 節（エラーコード統合表）に合わせて、エラーの知らせとログのコードと単体テスト・結合テストを書き直しました（2026-10-20 の決定）。
- 知らせの窓口 `NotificationCenter`（4 つのレベルの振り分け、画面に出さないコード、受け手を分ける作り）・コードの登録 `ErrorCodeRegistry`・ログの書き込みと容量の上限 `Logger`
- クラッシュからの戻り `CrashRecoveryController`（3 回目で `SYS-002`）とフリーズの確かめ（5 秒で OS のダイアログ、戻れば `SYS-003`）
- 画面の例外の受け口 `ErrorBoundary`（`SYS-004`）と、描画の外・main の未捕捉の例外（`SYS-005`、main は `MainErrorLogger`）
- main と renderer の間のログと知らせの経路（`log:*`・`notify:fromMain`）、ミラーの失敗の `FILE-005`・読み直しが尽きたときの `FILE-003`
- エラーのコードごとの見本のテストの名前の頭にコードを書く（`EDIT-001: 同じ弦への重ねての配置`、2026-11-03 本人決定）
- main と renderer をまたぐ結合テストは、DOM と node の両方の型を持つ結合テストだけの tsconfig（`apps/desktop/tsconfig.integration.json`）で型を検査する

### 確かめたこと
- CI（`.github/workflows/ci.yml`）：check:quality → lint → typecheck → format → test:coverage → build、Pull Request ではコミットの件名の検査（commitlint）
- 手元でも同じ順の確かめを通してから出しています（テスト 105 ファイル・1459 件、ほかに前からの skip 1 件）
- 詳細設計と実装の照合（dd-impl）：`error-logging-foundation.md` の要求 918 件のうち、照合 702 件（一致しなかった 14 件は全部受け持ちを分類済み）、先送り 64 件、照合しない対象外 152 件。`00_reference.md` 5 節の要求 364 件のうち、照合 166 件（一致しなかった 4 件は分類済み）、先送り 191 件、対象外 7 件
- 結合テストの段（dd-it）：`error-logging-foundation.md` の要求 918 件のうち、実装の段で照合済み 722 件、この段で照合 126 件（一致しなかった 5 件は分類済み）、先送り 70 件。`00_reference.md` 5 節は実装の段で照合済み 172 件・先送り 191 件・この段で照合 1 件
- 結合テストは、足したテストのコードの側を一度外すと落ちることを確かめています
- 引用切れ 0・対応タグの無い要求 0・陳腐化の積み残し 0・作業パッケージ 3 の中で直す分類 0

### 後に回したもの
- `error-logging-foundation.md` の先送り 64 件の受け持ち（多い順）：作業パッケージ 8（画面）37・作業パッケージ 9（Phase 1 完成・製品化 I1）16・`report` を呼ぶ各作業パッケージ（4・5・7・8）5・作業パッケージ 4（タブ譜編集コア）3・作業パッケージ 7（再生）1・Phase 2 の書き出し 1・実機の実測 1
- `00_reference.md` 5 節の先送り 191 件：作業パッケージ 4 が 69・7 が 36・5 が 36・8 が 30・Phase 2 の書き出しが 20（各パッケージが自分のコードを登録する）
- 一致しなかったものは、後の作業パッケージで実装側を直す：表示の部品（トースト・ハイライト・モーダル）の単体テストと、`NotificationUIBinder` が `SYS-005` を画面に出さない単体テスト（作業パッケージ 8、`screens-navigation.md` 13 節に申し送り済み）、`PLAY-003` の登録（作業パッケージ 7）、曲を開く経路の `FILE-003` と checksum の確かめ（作業パッケージ 9 の I1、G31）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
