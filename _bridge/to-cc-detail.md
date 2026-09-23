---
turn: 48
from: claude-chat
to: claude-code
at: 2026-09-23T23:09:00+09:00
subject: stale-diff の 25 単位に付ける確認の印（逐語）。1 文字も変えずにそのまま打つこと
---

**本人は「25 単位すべてに、理由を添えて 1 件ずつ印を付ける」と決めています。**
理由の文はチャット側が 25 単位の前後を読んで書き、`ledger.mjs` の条件（10 文字以上・原文の語を含む）を満たすことを機械で確かめてあります。
下の 25 行を**上から順にそのまま**打ってください。1 件でも拒否されたら、そこで止めて全文を報告してください（理由を書き換えて打ち直さないこと）。

```
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:0327a62d~0" --why "上位を「カポ位置そのものを常時表示することをもって反映とする」に直した（turn 29 の L80）。前の「表示に反映」は、今の「記譜を書き換えない」「カポ位置を常時表示する」の 2 件に分かれて残っている。前の「指定できる」「再生ピッチに反映」も今の要求に残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:9cd66371~0" --why "上位からタッチ操作の例示（下部ツールバー・スワイプダウン・ボトムシート・ピンチズーム）を削ったため、例示ごとの 4 件が消えた。PC版のUI要件は要件定義書に持たせないと決めている。「タッチ操作前提のまま」「そのまま適用できません」は承認で枠組みとして対象外、PC版の先行は今の要求 1 件と L11・L22 に残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:aa8746c3~0" --why "アプリロックの行を「5.4節（非機能要件）を参照。本節では扱わない」に直した。提供しないことと認証層の分離は L253 の要求 2 件（一致）に、将来の追加を妨げない設計は L157 の設計原則の要求（一致）に残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:7b5aa69a~0" --why "上位で「個別列挙はしない」と決め、「不要」判定 12 機能の例示を削った。「不要と判定した機能はすべて将来の追加を妨げない設計にする」は L157 の設計原則の単位の要求 7 件（一致）に残り、各機能を提供しないことは本文書の各表の「不要」の行が持つ"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:d383a1d3~0" --why "塊 A の案 i で、パート管理画面の行に「iPhone版の提示形式。PC版の種別は基本設計 03 の翻訳表と画面インベントリ」を明記した。前の「モーダルとして表示」は、今の「編集画面から開くモーダルとして提示」と「PC版での種別を 03 で定める」に置き換わった"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:7c837e8e~0" --why "塊 A の案 i で、チューニング設定画面の行に「iPhone版の提示形式。PC版の種別は基本設計 03 の翻訳表と画面インベントリ」を明記した。前の 3 件は、今の「設ける」「編集画面から開くモーダルとして提示」「PC版での種別を 03 で定める」に置き換わった"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:99f4c078~0" --why "塊 A の案 i で、小節メモ一覧画面の行に「iPhone版の提示形式。PC版の種別は基本設計 03 の翻訳表と画面インベントリ」を明記した。前の「独立した画面」「編集画面から遷移」「タップで該当小節へジャンプ」は今の 4 件に残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:2d110359~0" --why "塊 A の案 i で、設定画面の行に「iPhone版の提示形式。PC版の種別は基本設計 03 の翻訳表と画面インベントリ」を明記した。前の「独立した画面として構成」は、今の「曲一覧から遷移する画面として提示」と「PC版での種別を 03 で定める」に置き換わった"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:62b16e8b~0" --why "塊 A の案 i で、タグ管理画面の行に「iPhone版の提示形式。PC版の種別は基本設計 03 の翻訳表と画面インベントリ」を明記した。前の「独立した画面」は、今の「設定画面から遷移する画面として提示」と「PC版での種別を 03 で定める」に置き換わった"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:fb0f5261~0" --why "塊 A の案 i で、ゴミ箱画面の行に「iPhone版の提示形式。PC版の種別は基本設計 03 の翻訳表と画面インベントリ」を明記した。前の「独立した画面」は、今の「曲一覧から遷移する画面として提示」と「PC版での種別を 03 で定める」に置き換わった"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:bcff78da~0" --why "上位の「操作系ツールバー」を「入力系ツールバー」に言い換え、3種に限った（turn 29 の L187 1-A）。前の 6 件は、語が入力系に変わっただけで今の 6 件に残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:6c462113~0" --why "この単位の文は turn 29 の L187 1-A で新しく入った「保存・取り消し・再生・パネル開閉は入力系とは別のツールバー」。前のカテゴリとタブ切替の 5 件は同じ行の別の単位（入力・奏法・再生のカテゴリ、iPhone版ではタブ切替で 3 カテゴリのみ）に残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:36ba2bd6~0" --why "上位に「iPhone版では」と限定を足した（塊 A）。前の「モーダルパネルのサイズを内容の重さで使い分ける」は、iPhone版に限った形で今の 1 件に残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:595e2b11~0" --why "上位に「iPhone版では」と限定を足した（塊 A）。ボトムシートの 3 件と振り分け基準は今の要求に残り、エクスポートと印刷プレビューの全画面モーダルは今の「エクスポートおよび印刷プレビューのように、プレビュー表示または複数ステップを含む画面」に含まれる"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:41a68031~0" --why "上位でクラッシュとフリーズを分け（turn 44）、フリーズは確認のうえで再読み込みすると書いた。前の 7 件は今の 10 件に残り、前の「自動的に再読み込み」はクラッシュの側に移った"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:5e38c358~0" --why "アプリロックの行を「提供しない。ただし認証層を分離しておき、将来追加を容易にしておく」に直した。パスコードと生体認証の 2 件は今の「提供しない」1 件にまとまった。「将来追加を容易に」は承認で目的として外れたが、L157 の設計原則の「将来の追加を妨げない設計」「認証層の分離」（一致）が担う"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:fffad122~0" --why "上位でファイル関連付けの対象を本アプリの保存ファイル（.tabapp）に直した（turn 44）。前の「エクスポートしたファイルを関連付ける」は上位の変更で逆になった（エクスポートしたファイルは関連付けない）ので、消えてよい"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:b0793bd0~0" --why "上位を「編集操作は自前のコマンド層がScoreモデルを操作し、alphaTabへは再描画を依頼する」に直した（turn 29 の L298）。前の「編集操作のUIをalphaTabが担う」（陳腐化）は上位の変更で逆になった。ほかの 4 件は今も残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:578250e5~0" --why "上位を「画面の全一覧は4.6節」に直し、前の「6画面で構成する」（不一致・上位を直す）の限定が上位から外れた（turn 29 の L300）。ほかの 7 件は今も残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:af2ed60e~0" --why "上位にカスタムフォルダを足して 4 種にした（turn 29 の L308）。前の「3種に限定」は「4種に限定」に置き換わり、ほかの 5 件は今も残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:a21d3416~0" --why "上位のシェル側責務を 7 つに書き直した（turn 29 の L315）。前の「3点に限定」「3点以外はWebコア」は「7点」に置き換わり、ほかは今の 17 件に残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:db2c8b31~0" --why "上位でPC版ラッパーの責務にウィンドウ管理・自動更新チェックなどを足した（turn 29 の L316）。前の「ファイルI/Oのみ」は上位の変更で逆になった。ほかの 3 件は今も残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:c6bfcb5b~0" --why "前の「iPhone版の追加はWebコアを磨き上げた後に着手する」は L22 の「iPhone版の開発着手条件は、Webコアが磨かれた段階」（一致）に残る。前の「UIロジックを二重実装しない」は、上位で画面のコンテナとレイアウトを別実装と限った（turn 29 の L319）ので今の 2 件に置き換わった"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:e1bb52c4~0" --why "行を「5.5節のPC版メモリ使用量の目標値を代償として受け入れる」に直した。アイドル時メモリ使用量 150MB 以内の目標は L262 の要求（一致）に残る"
node .claude/scripts/ledger.mjs stale-diff "req->bd" --ack "docs/tab_app_requirements.md:1db6996b~0" --why "上位からカポを外した（turn 44）。多弦チューニング・奏法記号・テンポ変更・合奏再生は承認と決着で、拍子は本人の concede で、自作範囲を絞る根拠の列挙として対象外に移った。残りの 4 件は今の要求に残る"
```
