---
answering: 199
from: claude-code
at: 2026-10-28T21:40:00+09:00
---

## 1. (a)(b) の直し（作業パッケージ 2 のコード、このブランチでコミット）

| 件 | 直したもの | テスト |
|---|---|---|
| (a) | `SongRepository` の `preMigration` を省けない引数に。`App.tsx` は `getPreMigrationRoot()` から `new PreMigrationService(new IpcFileSystemAdapter(…))` を渡す | 既存の呼び出し 3 か所に仮の `PreMigrationService` を渡した（番号は変えない）。UT-PERSIST-REPO-43（省くと型の検査で落ち、型を外して省いても黙って変換せず FILE-001） |
| (a) の同型 | `spread.mjs scan` で同じ形（省ける引数で必須の処理が黙って抜ける）を数え、`LocalBackupService` の `index` が当たった（渡し忘れるとサブフォルダの曲を黙って退かさない）。同じ理由で省けない引数にした | UT-PERSIST-BACKUP-15（省くと型の検査で落ち、型を外しても黙って済ませず警告）。既存の呼び出し 3 か所に索引を渡した |
| (b) | data-model-persistence.md:367（12 節の 3）の行の終わりに 1 文（宣言 "bd-dd"、行の数は変えない）。コードは今の動きが文に合っていたので注だけ直した | UT-PERSIST-STORAGEMIG-26（印の無い曲はバイトが同じなら写る）・27（印の無い曲で読み戻しのバイトが違えば失敗） |

- 効くことの確かめ：REPO-43・BACKUP-15 は直したコードを一度外すと落ちた（本体が確かめた）。STORAGEMIG-26・27 は作業用の AI が bytesEqual・印の確かめを一度外して落ちることを確かめた
- 12 節の 3 の段落は洗い出し直した（要求 3 → 5、対象外 2）。対応タグは段落の ID が変わったので台本で付け替えた（`6ac44f86` → `71625c4b`、3 か所）と、新しい 2 件を足した
- 作業用の AI が挙げた迷い：前からある UT-PERSIST-STORAGEMIG-11（JSON として読めない曲のファイルは移行の失敗にする）は、足した文の「`integrity.checksum` の無い曲」に当たるかが文から読み取れない。コードとテストは変えていない（チャット側で決めてほしいこと）

## 2. 作業パッケージ 3 の区切りの計画

error-logging-foundation.md（308 行）：212 の段落と表の行・要求 828・要求ゼロ 33 段落。

| 区切り | 節 | 行 | 要求 | 依存の向き | 作る部品 | 受け取る先送り |
|---|---|---|---|---|---|---|
| 1 | 1・2.1・2.2・4・5 節 と 00_reference.md 5 節 | 1-57・229-250・00_reference 345-404 | 178 ＋ 4・5 節の分 ＋ 5 節の表（63 段落、まだ洗い出していない） | いちばん下 | ErrorCodeRegistry・NotificationCenter（受け手を分ける・stack・showOnScreen）・ErrorCodeDefinition・NotificationEvent・Logger・coreErrorCodes とエラーコードの表 | dd-impl 12（作業パッケージ 1 の web-core-foundation.md 11・作業パッケージ 2 の data-model-persistence.md 1） |
| 2 | 2.3・2.4 節 | 58-101 | 179 | 1 の上 | CrashRecoveryController（main）・LogRingBuffer・registerLogHandlers・preload の log・プロセス配置と結線 | なし |
| 3 | 2.5・2.6 節 | 102-175 | 173 | 1・2 の上 | ErrorBoundary（packages/ui-desktop へ作り直す）・mainUncaughtForwarder・未捕捉の例外の口・errorLoggingBootstrap | なし |
| 4 | 3・6・7・8・9 節 | 176-228・251-308 | 80 のうち 3 節の分 ＋ 218 | 1〜3 の上 | 主要シーケンスの結線・申し送り（9 節） | dd-it 33 は結合テストの段で（作業パッケージ 1 から 32・2 から 1） |

- 要求の数は `pending --lines` の節のまとまりごとの数。176-250 行（3・4・5 節）の 80 件は区切り 1 と 4 に分かれる（節ごとの数は数えていない）
- 00_reference.md 5 節（63 の段落と表の行）は、impl.md 1 節の決まりでこのパッケージで照合する。まだ洗い出していないので、区切り 1 のターンで洗い出す
- 今のコードの下調べ（作業用の AI、読むだけ）の見込み：写せそうなのは LEVEL_TO_CHANNEL・messageTemplate・UnknownErrorCodeError・Logger の append・flush・enforceQuota・getLogFolderAbsolutePath・CrashRecoveryController の数を数える処理と consumeRecoveryState・shared-types の CrashRecoveryState・LOG_CHANNELS・CRASH_CHANNELS。書き直すのは NotificationCenter・toLogEntry・ErrorCodeRegistry・型の定義・LogRingBuffer・registerLogHandlers・preload・bootstrap・ErrorBoundary（ui-desktop へ）・CrashRecoveryController（loadURL・フリーズ・reloadAfterRenderError）・coreErrorCodes の文言と SYS-003〜005（どれも見込み、照合していない）
- 下調べで数えたもの：エラーコードの表は 49 行（欠番 FILE-006 を除いて 48 コード）、コードの登録は 4 ファイルで 30（レベルは 30 件とも表と一致）。表にあってコードに無いもの 18（SYS-003〜005・EDIT-010〜013・015〜018・EXPORT-001〜003・PLAY-001〜004）。表の FILE-007・FILE-015 の「未実装」は古い（コードに登録がある）
- 下調べで見つけた設計書の中の食い違い（直していない。区切りのターンで honnin-queue か plan）：4 節の表（233〜245 行）に SYS-005 が無い（2.6 節の 139 行と 00_reference の 374 行には在る）・2.4 節 85 行の「コア8コード」と 4 節の表の 11 行・SYS-001 と SYS-002 を両方出すか（3.2 節 212〜214 行と 2.4 節 89 行）

## 3. 設計書の横の照らし合わせ

`_bridge/cross-check_p3-9.md` に書いた（94 行。置き場所 21・持ち主 17・呼ぶ時機 31・その他 25）。作業用の AI 9 体、文書ごと（大きい文書は節のまとまりごと）。**本体は引用を開き直していない**（ファイルの頭に書いた）。

- 本体の間違い：作業用の AI に渡した文で、作業パッケージ 4 と 5 の名前を取り違えた（4 パート・5 編集コアと書いた。正しくは基本設計 15 章 4.1 節の 4 タブ譜編集コア・5 パート・チューニング管理）。一覧では名前で書き直した

## 4. ダブルチェックと照合の回

| 回 | 段 | 件数 | 結果 | 作業用の AI・トークン・時間 |
|---|---|---|---|---|
| 洗い出し | "dd-impl" error-logging-foundation | 212 段落 | 要求 828・対象外 269 | 26 個・149 万・16 分 |
| ダブルチェック | 同 | 185 | 承認 183・差し戻し 2（組の大きさの上限で切った 19・取り違え 2） | 52 個・168 万・19 分 |
| 再チェック | 同 | 2 | 2 件とも「要求」→ 2 段落を分け直して片付けた | 5 個・18 万・1 分 |
| ダブルチェック | "dd-impl" data-model-persistence 367 行 | 1 | 承認 1 | 4 個・14 万・1 分 |
| 照合 1 | "dd-impl"（(a)(b) の 11 件） | 11 | 一致 10・部分 1 | 2 個・15 万・4 分 |
| 照合 2 | "dd-impl"（引用切れ 2） | 2 | 一致 1・部分 1 | 2 個・11 万・1 分 |
| 照合 3 | "dd-it"（引用切れ 1、turn 198 の終わりで既にずれていたもの） | 1 | 一致 1 | 2 個・9 万・1 分 |

照合で一致しなかったもの（分類つき）：
- data-model-persistence.md:330（10.1 節）「Webコアのサービスは、レンダラーの側に置いたまま」→ **上位を直す**。14.1 節の決定（MirrorSyncService と StorageConfigService を main に置く、honnin-queue 214 番）と合わない。10.1 節の文を 214 番にそろえる文書の直しが要る（このターンは直す文書を限られていたので直していない）
- web-core-foundation.md の「apps/desktop が持つのは DI の組み立てだけ」→ **下位を直す（作業パッケージ 8）**。今の App.tsx に画面の部品がある

plan の分類を外したもの 2（作業パッケージ 8 へ回していた「PreMigrationService を渡す」と App.tsx の組み立てが、(a) で一致になった）。

## 5. 時間の内訳

| まとまり | 始め | 終わり | 作業用の AI |
|---|---|---|---|
| 始まりの確かめ・(b) の設計書・宣言 | 21:12 | 21:16 | なし |
| 作業パッケージ 3 の洗い出し（ワークフロー、裏で） | 21:17 | 21:33 | 26 個・16 分 |
| (a)(b) のコード・下調べ・横の照らし合わせ（作業用の AI 11 個を並べて） | 21:17 | 21:26 | 11 個（いちばん長い 9 分） |
| 同型の直し・効くことの確かめ・verify・コミット | 21:26 | 21:33 | なし |
| ダブルチェック・再チェック・照合（裏で）・横の照らし合わせのまとめ・区切りの計画 | 21:33 | 21:55 | 上の表のとおり |
| 終わりの確かめ（1 回目赤 8：carry を sibling-align の前に打った順の誤り・引用切れ・陳腐化の確認・ut の分母。直して 2 回目は未追跡の 1 件だけ） | 21:55 | 22:00 | 照合 2・3 |

## 6. 使った量

- 呼び出し 139 回・最後の会話の大きさ 28.7 万（始め 5 万）・読み直した量の合計 2567 万
- 作業用の AI：記録 111・呼び出し 735 回・読み直し 4793.8 万
- 会話に足された量の上位 5：Read 5.8 万（27 回）・Grep 2.5 万（33 回）・Write の引数 2.1 万（11 回）・Bash の引数 1.6 万（89 回）・Agent の引数 1.6 万（11 回）
- 25 万を超えたのは終わりの確かめのあたりで、残りの仕事は報告とコミットだけだったので作業用の AI へは回していない
