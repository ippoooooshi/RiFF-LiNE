---
answering: 240
at: 2026-11-10T06:49:58+09:00
---
# turn 240 の明細

## 時間の内訳

| まとまり | 始め | 終わり | 作業用の AI が動いた時間 | 会話の大きさ（前 → 後） |
|---|---|---|---|---|
| 始まりの確かめと 27 件の ID の確かめ | 06:19 | 06:21 | ― | 6.8 万 → 10 万 |
| 照合 27 件（judge.js） | 06:21 | 06:26 | 4.6 分（作業用の AI 3 個・24.8 万トークン・道具 58 回） | 10 万 → 14 万 |
| テスト ID の付け替え・verify・コミット | 06:21 | 06:24 | ― | （照合と並べて進めた） |
| 区切り 5 のコード（worker 1 個） | 06:27 | 06:40 | 13.3 分（21.1 万トークン・道具 100 回） | 14 万 → 14.8 万 |
| 確かめ・コミット・対応タグ 258・付け直し・dd-it の引き継ぎ・終わりの確かめ | 06:40 | 06:50 | ― | 14.8 万 → 20.7 万 |

## 照合で一致しなかったもの（4 件、分類つき）

| 要求 | 照合 | 分類 | 受け持ち・理由 |
|---|---|---|---|
| editing-core.md:1a0ee3c5 #kb59ba5d290f7「外すときは isStaccato を偽にする指定を送る」 | 部分 | 下位を直す | 区切り 5（7.3 節 902 行）で送る側を作る。受ける側（patch のキー）はできている |
| editing-core.md:1a0ee3c5 #k272949c10709「外すときは isGhost を偽にする指定を送る」 | 部分 | 下位を直す | 同上 |
| editing-core.md:b07f0d0e #k773dbe6811a6「SetTechniqueCommand は NoteTechniquePatch で指定したキーだけを変える」 | 部分 | 上位を直す | harmonicType を変える patch で harmonicValue が書き換わる（7.2・7.3 節の決まりどおり）、bendPoints を変えると maxBendPoint も書く。447 行の文に例外が書いてない |
| web-core-foundation.md:b626e8d0 #kb97aa98536c7「MidiExportService クラスを持つ」 | 申し送り先が不在 | 下位を直す | export-print.md 114・123 行にクラスの設計はある。コードは Phase 2 の書き出しで作る |

## 区切り 5 で作っていない 71 件（作業用の AI の報告から）

| 所 | 件数 | 作っていない理由 |
|---|---|---|
| 7.3 節 884・888〜897 行（チョーキングの幅と形から bendType・bendPoints を作る） | 33 | 作る関数・口が書いてない |
| 7.3 節 899 行（ビブラートの Slight と None） | 3 | 同上 |
| 7.3 節 902 行（外すときの patch） | 5 | 送る側が関数としても EditingService の口としても決まっていない |
| 8 節 975 行（ChordNameVisibility） | ― | テストの UT-UI の対象略号が 11 章 3.1 節で予約されておらず check-tests が弾く |
| 8 節 976 行（ChordNameOverlay・EffectText を切る設定） | ― | update の引数と拍の位置を取る口が書いてない。EffectText を先に切ると手で入れたコード名が譜面から消える |

8 節の表示まわりは合わせて 30 件（作業用の AI の数え方）。一覧は scratchpad の not-made.json。

## 先送りの候補（44 件、まだ書いていない）

- 作業パッケージ 8（画面群・ナビゲーション）43 件：チョーキングの「カスタム」の欄と幅の 12 の呼び方（d9af1664 の 4・1490c2e1 の 20・a61be7ad の 8）32 件・フレットボード図 1 件・表示メニューの view.chordNames 2 件・フレットボード図の見出しのコード名 8 件
- Phase 2 の書き出し・印刷 1 件：印刷用の写しで ChordDetectionService を使う
- 書かなかった理由：先送りには申し送りの決まり（回す先の詳細設計に中身が書いてあるか確かめる）が要り、会話が 18 万を超えていたため。案は scratchpad の defer.json

## 作業用の AI が挙げた食い違い（直していない）

- 4.8 節 662 行のコンストラクタは `(…, clipboard, barDeleteConfirmer, chords, now)`。今のコードに barDeleteConfirmer と now が無いので、chords を clipboard の次（7 つ目）に置いた
- 4.8 節 677 行は `chordNameAt(position: CursorPosition)`。今は `(barIndex, beatIndex)` のまま（4.8 節は範囲の外）
- 8 節 961 行の (2)「構成音の少ない型」は、照らし合わせが集まりの一致で見るので差がつく場面が無い（順は書いたとおりに持っている）
- 898 行（記譜の形を変えない）の 2 件は ScoreRenderHost の settings の行に対応タグを置いた

## 同型の走査

パターン `onCommandApplied\(\(\)|onCommandApplied\(this\.|forget[A-Z]\w*\(`（6 か所）：EditingService.ts 110・114・350 行は是正済み、CommandHistory.test.ts 384・433 行と PlaybackMixerBinder.ts 31 行は覚えた値を持たないので別物。

## 使った量（context-report.mjs）

- 呼び出し 114 回・会話の大きさ 始め 5.3 万 → 最後 20.7 万
- 読み直した量の合計 1507.8 万（キャッシュから 1490.1 万）・CC が書いた量 4.5 万
- 作業用の AI：記録 5・呼び出し 128 回・読み直し 1542.5 万・書いた量 10.1 万
- 会話に足された量の上位 5：Read 3.7 万（33 回）・Grep 2.4 万（49 回）・本人と注入された文 1.9 万（18 回）・Bash の引数 1.1 万（116 回）・recheck-evidence dd-impl 8613（4 回）
