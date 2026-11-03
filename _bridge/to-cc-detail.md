---
turn: 213
from: claude-chat
to: claude-code
at: 2026-11-02T13:00:00+09:00
subject: 231・232 番と 2 つの細部（チャット側で決めた）、結合テストの段の残り、締めの支度
---

## 1. チャット側で決めたこと（本人には報告だけする）

| 件 | 決定 | 理由 |
|---|---|---|
| 231 番（9 節に残る取り下げた旧い文） | **案 B（文は消さない。要求の洗い出しで「経緯・旧方針」として要求にしない）**。そのうえで、古くなった事実だけを直す：(a) 297 行の終わりの「**未実装**（I1）」を今のコードの事実に直す（`CorruptSongFileError` は `packages/core/src/persistence/errors.ts`、`FILE-008` は `SchemaMigrator.ts`・`songFileCheck.ts` で出している。00_reference.md 8.1 節の G39 の行など、同じことを書いた所も Grep でそろえる）(b) 295 行の終わりに「**2026-11-02 改訂**：`index.json` の作り直しは、コードの無い警告ではなく Warning の `SONG-003` を出す（[[data-model-persistence.md#9]] の 9.1 節）。」の形で 1 文 (c) 289 行の終わりに「（9.3 の申し送りは 2026-11-02 に取り下げた。300 行）」の形で 1 文。9 節の 289・295・297・300・302 行の段落を洗い出し直す。今の形の文（改訂の注の中の決まり）は要求として残し、前半の旧い方針と日付つきの実施の記録は skip（理由「経緯・旧方針」）にする | 分け方の決まり 2（「経緯・旧方針は要求にしない」）がもう答えを出している。照合で合わなかった 8 件は、旧い方針を要求として数えた洗い出しの誤り。日付つきの経緯の文は直さない決まりで、前にも同じ扱いをした（turn 208 で 00_reference.md 356 行の経緯の注を直さずに分け直した）。9 節は「何をどう置き換えたか」の記録なので、消すと前の考えが設計書から消える。295・289 行は、300・302 行と同じく行の終わりに改訂の注を足す形にそろえる |
| 232 番（306 行の reload） | **案 A（306 行の `webContents.reload()` を `webContents.loadURL()`（起動時と同じ URL）に直す。同じ行の「reload を止めて」も「読み込み直しを止めて」に）**。309 行は日付つきの経緯の文なので直さない | 306 行は「現状〜する」と今のコードの状態を書いた文で、201 番の決まり（古くなった事実の文は聞かずに直す）に当たる。作りを決めるのは 2.3 節 62 行で、`CrashRecoveryController.ts:202` も `loadURL` |
| 細部 (1)：storage の知らせで新しい根を引けなかったときの MainMirrorSync | **前の根の `MirrorSyncService` を使い続けない**。`onSharedChange` で引けなければ `active` を空にし、次の `syncAfterSave` で引き直す（初めて写すときと同じ）。そこでも引けなければ、写さずに Warning の `FILE-005` を `MainErrorLogger` の `report` で出す（`context` に `songId` と理由）。投げない。data-model-persistence.md 14.1 節の main の `syncAfterSave` の (b) の行の終わりに 1 文 | 保存先を替えた後、画面は新しい根に保存する。前の根のサービスのまま写すと、前の根に残った古い曲をミラーへ写すことになる（ミラーが古くなる）。ミラーに写せないのは 14.1 節の「ミラーへの書き込みの失敗は Warning の FILE-005」に当たり、K5（main のエラーは main が書く）にもそろう。ログの `MainLogging` が前の書き先に書き続けるのは、ログを失わないためでそのままでよい |
| 細部 (2)：registerFsHandlers が起動時の activeAdapter のまま | **単一のルートの `fs:*` の 5 つは、呼ばれるたびに今の主ストレージのルートを引いて（`appLocalConfig.getActiveRoot()` → `adapterFactory.createForRoot`。同じルートには 1 つだけ）使う**。data-model-persistence.md 10.1 節 327 行の終わりに 1 文 | チャット側で確かめた：画面の側は `fs:*At` だけを使い（`apps/desktop/src/renderer/ipcFileSystem.ts`）、単一のルートの 5 つを呼ぶ所は今は無い。main.ts 248 行は起動時のアダプタを渡しているので、保存先を替えた後に誰かが呼ぶと前の根を読み書きする。チャンネルの名前と preload の注が「アクティブルート用」なので、今の主ストレージに合わせるのが筋。12 節の「main で替えるのは Logger と MirrorSyncService」は、呼ぶたびに引く形なので書き換えない |

- 4 件とも honnin-done.md へ（「チャット側の決定、2026-11-02」）。231・232 番は honnin-queue の表の行を決定に替える
- コードの 2 件は、テストを足す（引けなかった後に引き直すこと・引き直しも失敗したら FILE-005 を 1 回出すこと／保存先を替えた後の `fs:readFile` が新しい根を読むこと）

## 2. 結合テストの段（dd-it）の残り

| 件 | 扱い |
|---|---|
| error-logging-foundation.md の照合前 102 件 | テストのファイルに対応タグを置いてから照合（`carry` は turn 212 で済み。§2 の後にもう一度打つ） |
| 00_reference.md 5 節（345-404 行）の照合前 5 件 | 同じく照合 |
| 00_reference.md 5 節の洗い出し | **済んでいる**（チャット側で数えた：段落 64・洗い出し前 0・要求 364・dd-impl の照合前 0）。turn 212 の「洗い出し前 305」は 1 節（受け先表）163 と 3 節（登録簿）142 で、作業パッケージ 3 の受け持ちではない。作業パッケージ 1・2 のときと同じく触らない |

## 3. 締めの支度

- 締められる状態：error-logging-foundation.md（1-309 行）・data-model-persistence.md（1-631 行）・00_reference.md 5 節が、dd-impl と dd-it の両方で照合前 0・印なし 0、honnin-queue に作業パッケージ 3 の「未」が無い、終わりの確かめが全部緑
- そうなったら `_bridge/pr_error-logging-foundation.md` を書く（形は `_bridge/pr_data-model-persistence.md` と同じ：何を作り直したか・確かめたこと〈CI の順・テストの数・dd-impl と dd-it の数・引用切れ 0〉・後に回したもの〈先送りの受け持ち先ごとの数・一致しなかったものの受け持ち〉、最後に Generated の 1 行）
- マージはしない（次のターンで本人が turn.mjs で打つ）
