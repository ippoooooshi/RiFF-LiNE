---
turn: 217
from: claude-chat
to: claude-code
at: 2026-11-03T22:30:00+09:00
subject: 横の照らし合わせ 14 行と L11 の決め方（チャット側で決めた）、layerRules.test.ts の赤、区切り 1
---

## 1. 横の照らし合わせ 14 行（全部チャット側で決めた。本人には報告だけする）

turn 216 の from-cc-detail.md 1.2 節の案の記号で書く。直し方は to-cc の 2 節。

| 行 | 決定 | 理由・添えること |
|---|---|---|
| L12 | **A**（テストを `apps/desktop/src/dev/i18nGuard.test.ts` に置く）。あわせて EC:71 の「除くのは…ファイル 1 つだけ」を「各パッケージのエラーコードの定義のファイル（`*ErrorCodes.ts`）」に直す（D4。今は 4 つ） | 本人決定 178 番（WC:71）を動かさずに済む。docRefs・layerRules と同じ置き場所 |
| L13 | **A**（EC:750 の理由の文を「`PartManagementService.addPart` が呼ぶ」に） | PT:144 が確かめをパートの窓口に集めると決めている（D2） |
| L14 | **A**（`PartColorOverlay` と同じ形の部品を `packages/core/src/ui` に 2 つ。名前と置き場所を EC:976・1004 に書く。SN:823 の音符のハイライトは O8 で扱う） | 前例が同じ所にある |
| O5 | **B**（EC:452・453 を「ファイルと索引の書き方は [[data-model-persistence.md#9]] の 9.1 節が正」に） | 同じ流れを 3 か所目に写さない。K2 で答えは出ている |
| O6 | **A**（`EditingService` のコンストラクタに `chords: ChordDetectionService` を足す。推し量りの結果は `EditingService` が覚え、`onCommandApplied` で捨てる） | `ChordDetectionService` を純粋なままにできる。印刷用（EP:155）もそのまま |
| O7 | **A**（WC 12.1 節の `initialize` の決まった設定に、`EffectText` を切る設定と `includeNoteBounds` を足す） | 切り替える口が要らない。設定を渡す所を 1 か所のままにできる |
| O8 | **A**（`ScoreHighlightRequest` に省ける `beatIndex`・`stringNumber`（と `voiceIndex`）を足し、あれば音符を囲む） | 基本設計 04 章 59 行「該当弦をハイライト」を守ったまま、足す形で広げられる |
| O9 | **B**（`EDIT-010`・`EDIT-011` は入力欄、`EDIT-002`・`EDIT-003` は小節。SN:1021 の並びに `EDIT-010`・`EDIT-011` を足す。context の中身も 5 節の表に書く） | 010（拍子）と 011（反復回数）は値を入れる欄で弾かれる。SN:1021 の「小節を指せない Error は操作した入力欄」の決まりにそろう |
| T23 | **A**（`EditingService` が `cursor.onChange` と `onCommandApplied` に登録して、2 桁のフレットの覚えを捨てる） | 和音の途中の印（EC:649）も同じ知らせで扱える |
| T24 | **A**（タイの候補を求める純粋な関数を 6 節に書き、`EditingService` が覚える。`setTie` は「候補があれば候補の前の音符、無ければカーソルの拍」） | ボタン 1 つで両方をする SN:337 に合う |
| T25 | **B**（`EditingService` が置いた直後に候補を求めて覚え、画面は読む口で受ける） | T24 と同じ所に持てる。`placeNote`・`insertRest` の戻り値の形を変えずに済む |
| T26 | **A**（EC:737 を「作った後と、曲一覧を読み込んだとき」に） | DM:248・SN:29 にそろう |
| T27 | **A**（DM:511 を「組み立てが `CommandHistory` の `onChange` を `notifyDirty` につなぐ」に）。あわせて、DM:257 の K2 の「開いている窓が名前・タグを当てる」処理は履歴を通らないので、**当てた後に `notifyDirty` を呼ぶ**と DM:257 に書く | コマンドの形を変えずに全部のコマンドを拾える。K2 の当て込みも、ふだんの保存と同じ道（自動保存）で書く。`flush` にすると、ほかの窓の操作のたびに即時に書くことになり、保存の道が 2 つになる |
| X8 | **A**（EC 2.6 節にミキサーの 4 つのコマンドの 1 行、基本設計 12 章 6.2 節の表に要件 4.3 の行を足す。基本設計は宣言 "req-bd"） | EC:193 が同じ変更で表に足すことを求めていて、12 章 278〜279 行に前例がある |

- 14 行とも `_bridge/cross-check_p3-9.md` の印を【決め方：チャット側の決定 2026-11-03（当てた turn 217）】にする
- 「O5 の重なりの列の O11」は表の書き間違いなら直す（開いて確かめてから）

## 2. L11（`CompositeCommand` に 2.1 節の import の決まりを当てるか）

- **当てる**。EC:24 の行の終わりに「2.1 節の import の決まり（コマンド層が import しないもの）は、`CompositeCommand` にも当てる」の形で 1 句足す
- 理由：`CompositeCommand` もコマンドの 1 つで、置き場所が違うだけで決まりの外になると、コマンド層の決まりに穴ができる。layerRules.test.ts の区域に `editing/CompositeCommand.ts` を入れる（区切り 1 のコードで）

## 3. layerRules.test.ts の赤（turn 216 の 6 節）

- 原因を先に確かめる：全体で回すときに、そのテスト 1 本の打ち切りの時間だけを延ばして通るか（ESLint を読み込む時間が 5 秒を超えるという見立てが正しいか）
- 見立てどおりなら、そのテスト（または ESLint を使う describe）に打ち切りの時間を付け、なぜ延ばしたかを 1 行の注に書く。テストを飛ばす・消す・ESLint を使わない形に変える、はしない
- 見立てと違ったら、直さずに分かったことを報告する

## 4. ダブルチェック前の 96 件

- 区切り 1 の照合より前に、approve.js（`defer: 0`・`window: 60`）で通し、差し戻しを再チェックする。洗い出し直しの段落の分と合わせて、洗い出しとダブルチェックは 450 件まで
- 範囲を決めるときは、節ごとの見込みの合計を上限と先に比べる（turn 216 の誤りの繰り返しを防ぐ）
