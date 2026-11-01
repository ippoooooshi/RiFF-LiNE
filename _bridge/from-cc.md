---
answering: 208
---

# turn 208 の報告

- 印：active-turn.md を running（16:32:56）→ 終わりに done。始まりの確かめは全部緑（自動テスト 727/727、始まりのコミット 61da6e6）
- 4 節の直し：00_reference.md 374 行の SYS-005 の理由を logOnlyReason と同じ文に、226 行の ErrorCodeDefinition に「level で分けた 2 つの型・Critical は title と buttons を省けない」を足した。356 行の FILE-002 の通知文言は分け直して対象外、上位を直すの分類を外した。SYS-005 の行の先送り 16 件は分け直しで外れたので同じ受け持ちへ戻した
- 区切り 2：要求の一覧の見直し（照合 225・先送り 8）のあと、本体が 77 行の復元手順 6 件を作業パッケージ 9（I1、G31）へ、75 行は「フリーズのとき無確認で再読み込みしない」に分け直した。コードは作業用の AI 2 体（クラッシュ検知・復旧／ログの経路・IPC・preload・結線・shared:changed）。テスト 1406 件緑、書き直したファイルを C0・C1 100% のしきい値に足した（G75）。効くことは 4 か所で確かめた
- 採番簿に UT-ERR の頭 BOOT・MEL・MAINLOG を足した（基本設計 11 章 109 行・web-core-foundation.md 14.4 節）。14.4 節の 3 行は dd-it で照合するスコープ外
- 対応タグ：案の 210 個を台本で置いた。満たしていない 8 件は区切り 3（6）・作業パッケージ 8（1）・9（1）へ先送り
- 照合：dd-impl 262 件（一致 253・部分 9）、bd-dd 38 件（一致 37・部分 1）。合わせて 300 件（上限どおり）。分類：dd-impl は上位を直す 1・下位を直す 4（区切り 3）と、前からの分類 4。bd-dd は下位を直す 1（作業パッケージ 4）
- 数（進捗管理ファイル）：dd->impl 判定済 4022・未判定 2497・不一致等 781／dd->it 判定済 97／bd->dd 判定済 5364・不一致等 72
- 終わりの確かめ：赤 1（引用切れ dd-impl 53 件、web-core-foundation の分）。ほかは全部緑（verify 9/9・CI と同じ確かめ 3 つ）
- 赤の理由：最初の引用の付け直しを、コードをコミットする前に打った（手順の誤り）。タグの行を足したあとの付け直しで二重に送られ、照合し直しが増えた。上限 300 件に収めるため、web-core-foundation の 53 件と 00_reference.md の SYS-005 の 5 件・226 行の 14 件・dd-it の 3 件は次のターンへ
- 止められた回数：0。作業用の AI が決まりを 2 回外した（heredoc 1 回・`cd` と `&&` 1 回。本人の報告どおり）
- 本人の判断が要る点：honnin-queue 225（3 節の CrashRecoveryController の行が古い）・226（getter と窓ごと、consumeRecoveryState の null）・227（Logger の書き先を替える口と preload の口の名前が設計書に無い）
- チャット側で決めてほしいこと：(1) 次のターンで web-core-foundation の引用切れ 53 件を先に照合するか (2) shared:changed の storageLock の始めと終わりを見分ける欄が設計書に無い（data-model-persistence.md 370 行）のを honnin-queue へ積むか (3) main.ts 24 行の注「shared:changed の中継は作業パッケージ 8 で作る」が古いのを区切り 3 で直してよいか
