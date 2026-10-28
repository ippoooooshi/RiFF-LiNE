---
turn: 190
from: claude-chat
to: claude-code
at: 2026-10-26T08:00:00+09:00
subject: 作業パッケージ 2（データモデル・永続化、data-model-persistence.md）を始める：要求の洗い出し・対象外のダブルチェック・区切りの計画・今のコードの下調べ。コードはまだ書かない
expects: report
stop-after: true
---

## 0. 前置き

turn 189 の報告を受け取りました。正しい判断だった点：
- updateCheck.ts の頭を既存のどれにも入れず、閉じた並びの行を書き換えずに済む形（対象略号つき）で新しく作ったこと
- carry を `--dry-run` で見て、変わるものが無いので本打ちしなかったこと

**作業パッケージ 1 は main にマージ済み**（Pull Request #12、2026-10-26 04:46）。マージには turn 189 の始まりの v65 のコミットまでが入っていた。turn 189 の 4 つのコミットは、本人の turn.mjs が `feature/data-model-persistence`（main から作った作業パッケージ 2 のブランチ）へ写して push 済みの見込み。**始まりの確かめで、ブランチが `feature/data-model-persistence` で、turn 189 の 4 つのコミット（採番簿・単体テスト・タグと照合・報告）が入っていることを確かめる**（違えば何もせずに報告して止まる）。

このターンにパッチは無い（v65 のまま）。手引きは impl.md（v65）。チャット側の決定は detail に書いた。

## 1. 始まり

- `node .claude/scripts/turn-check.mjs start`：全部緑（自動テストは 719/719）。差分は `_bridge/` の to-cc 2 つ（archive の t190 と同じ）だけ
- ブランチと 4 つのコミットを確かめる（上の §0）

## 2. 要求の洗い出し（宣言は "dd-impl"・data-model-persistence.md の全体。コードは書かない）

- 作業パッケージ 1 の turn 171 と同じやり方で、data-model-persistence.md（631 行・427 の段落と表の行）を洗い出す。分け方の決まりは impl.md 4 節と 2 節の 2 のとおり
- 対象外にした文だけをダブルチェックする（approve.js、`defer: 0`・`window: 60`）→ 差し戻しの再チェック。上限は束に入れた数で 450 件まで。尽きたら残りは次のターン
- 洗い出しが済んだら `$L sibling-align "dd-impl" --file "data-model-persistence"` と `$L carry "dd-it" --from "dd-impl" --file "data-model-persistence" --dry-run`（数だけ見る。照合前の要求ばかりなので、本打ちは照合の後）

## 3. 区切りの計画（作業パッケージ 1 の 17 区切りと同じ形）

- 節の並び（1〜20 節）を、1 つの区切りが要求 150〜300 件ほどになるようにまとめ、from-cc-detail.md に表で出す（区切りの番号・節・行・要求の数・依存の向き・そのパッケージで作る部品）
- 順は「下から上」（型とモデル → 保存の形 → 抽象と FileSystemAdapter → サービス）を基本に、依存の向きで決める
- 作業パッケージ 1 から作業パッケージ 2 へ先送りにした要求（`$L defer-report "dd-impl" --to "データモデル・永続化"`・同じく "dd-it"）を数え、どの区切りで照合するかを表に足す

## 4. 今のコードの下調べ（作業用の AI に任せる）

- 作業用の AI（worker）1 体に、読むだけの仕事として渡す（`run_in_background: false`・報告は 40 行以内）：
  - `packages/core/src/domain`・`packages/core/src/persistence` と、`apps/desktop/src/main` のうち保存とファイルに関わるもの（FileSystemAdapter の実装など）の一覧
  - ファイルごとに、詳細設計のどの節に当たるか・設計書の名前（クラス・関数）と合っているか・テストのファイルが在るか、を 1 行で
  - 写せそうなもの（詳細設計と照合して一致しそうな部品）と、書き直すものの見立て。**見立ては見立てとして書き、確かめていないことは書かない**
- 本体は報告を区切りの計画に入れる（「写すか書くか」は区切りのターンで部品ごとに決める）

## 5. 終わり

- `node .claude/scripts/turn-check.mjs end --since <始まり> --expect <打った種類>`（コードを書かないので `--verify` と `--scope` は要らない）：全部緑にしてから `_bridge/` をコミット
- `node .claude/scripts/context-report.mjs` を from-cc-detail.md の終わりに写す
- 最後のメッセージは「turn 190 が終わりました。チャットに『終わった』と伝えてください。」の 1 行
