## 作業パッケージ 1（Webコア基盤構築）の作り直し

詳細設計 `docs/detailed_design/web-core-foundation.md` に合わせて、土台のコードと単体テストを書き直しました（2026-10-20 の決定）。
- レイヤーの依存の向き（ESLint の規則）・パッケージの構成・PlatformAdapter の口
- Electron の main・preload・renderer の分け方、IPC の受け口とセキュリティの既定値、データのフォルダの名前（`userDataDir.ts`）
- 起動の口 `run-app.cmd`（ふだん・デバッグ・本番に近い形・ログ・配布と同じ形の 5 つ）と、入口のファイルに分かれ道を置かず判断を関数に出す形
- 見た目のトークンの CSS（Tailwind v4）、配布に要るライセンスのファイルの確かめ、注が指す設計書の節の確かめ
- テストの番号の採番簿とカバレッジのしきい値（入口から出した関数は 100%）

### 確かめたこと
- CI（`.github/workflows/ci.yml`）：check:quality → lint → typecheck → format → test:coverage → build、Pull Request ではコミットの件名の検査（commitlint）
- 手元でも同じ順の確かめを通してから出しています
- 詳細設計と実装の照合（dd-impl）：要求 3612 件のうち、照合 2189 件（一致 1527・一致しなかった 662）、先送り 538 件、照合しない対象外 885 件
- 結合テストの段（dd-it）：要求 3612 件のうち、実装の段で照合済み 2780 件、テストのファイルで照合 37 件（一致しなかった 3）、先送り 795 件

### 後に回したもの
- 先送り 538 件の受け持ち（多い順）：作業パッケージ 9 のシステムテストと運用テスト 91・14.8 節の負荷テスト（実機）81・Phase 3（iPhone 版）62・作業パッケージ 4 の単体テスト 49・Phase 6（MIDI の連携）44
- 「下位を直す」（後の作業パッケージで実装側を直す）610 件
- 何もしない関数のままのハンドラ 9 件（古い画面 `App.tsx` の 8 件と `main.ts` の `createEditWindowInstances`）は、`quality-allow-stub` の注と `00_reference.md` 8.1 節の G80・G65 で作業パッケージ 8 へ繰り越し（`pnpm check:stubs` は 0 件）

### GitHub で設定すること（本人）
1. Settings → Branches：`main` にブランチの保護を付け、CI の `quality-gate` と `commitlint` が通らないとマージできないようにする
2. Settings → General → Pull Requests：「Allow squash merging」だけを残し、ほかのマージの形を外す
3. 同じ画面の「Automatically delete head branches」を入れる（マージ後にブランチを消す）
4. Settings → Code security：Dependabot alerts（依存の警告）を入れる

🤖 Generated with [Claude Code](https://claude.com/claude-code)
