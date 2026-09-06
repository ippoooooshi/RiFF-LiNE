# 設計レビュー所見（2026-09-03実施）

## 本ドキュメントについて

- **対象**：要件定義書（`tab_app_requirements.md`）1件、基本設計書（`basic_design/`）16件、詳細設計書（`detailed_design/`、横断リファレンス含む）10件の全27文書。
- **実施方法**：全文書を通読し、（1）文書間・章間の記述の整合性、（2）要件との対応関係、（3）未解決事項・技術検証待ち事項の現在の状態、を確認した。
- **方針**：本ドキュメントは「所見」（文書を読んで客観的に確認できる事実）の記録に徹する。修正案の提示・対応方針の提案は行っていない。指摘した内容について対応が必要かどうか、対応する場合どうするかの判断は、本ドキュメントを読む側に委ねる。
- 各所見に「対応要否」「対応内容」の記入欄を設けている。**2026-09-03追記**：本人との協議・確定を経て、全14件について記入済み（詳細な変更内容は各所見が指す設計書本体、および`basic_design/13_design_decision_points.md`C11〜C14・B28、`detailed_design/00_reference.md`§8.1のG16〜G18、§9.14を参照）。**2026-09-04追記**：本人依頼による監査（[[design_review_2026-09-03_audit.md]]）で、下表B-4・B-5の是正内容自体に反映漏れ・誤りが2件発見され、追加で是正した（各行の対応内容末尾参照）。
- なお、本プロジェクトの文書群は既に非常に高い頻度・粒度でセルフレビュー（`basic_design/13_design_decision_points.md`のB20、`detailed_design/00_reference.md`のG1〜G15等）を実施しており、多くの不整合が既に発見・是正されている。本レビューはそれらとは独立した通読によるものであり、既存のセルフレビューで捕捉されていなかった点を中心に記載している。

## 凡例

| 列 | 内容 |
|---|---|
| 対応要否 | 未記入／要対応／対応不要／検討中　等、自由記述 |
| 対応内容 | 対応した場合の内容、または対応不要と判断した場合の理由等を自由記述 |

---

## A. 文書間の記述不一致として確認できたもの

| # | 該当箇所 | 所見 | 対応要否 | 対応内容 |
|---|---|---|---|---|
| A-1 | `detailed_design/data-model-persistence.md` §5（`StorageMigrationService`の移行対象ファイル列挙：`songs/`・`trash/`・`index.json`・`tuning-presets.json`・`tags.json`・`settings.json`）／`detailed_design/screens-navigation.md` §3.1（`AppPreferencesService`の保存先を`{アクティブなストレージルート}/TabApp/preferences.json`と規定） | `AppPreferencesService`の`preferences.json`は`settings.json`と同様にアクティブなストレージルート配下に置かれる設計だが、`StorageMigrationService`の移行対象ファイル列挙には`preferences.json`が含まれていない。同じくストレージルート配下にある`tags.json`は移行対象リストに含まれている。`AppPreferencesService`は移行対象リストが定義された`data-model-persistence.md`（パッケージ2）より後のパッケージ8で新設されたサービスである。 | 対応済み | `data-model-persistence.md` §5の移行対象ファイル一覧に`preferences.json`を追加した。単純な記載漏れとして、既知ギャップ台帳G16（`detailed_design/00_reference.md` §8.1）に記録した。 |
| A-2 | `basic_design/15_development_process.md` §0.1・§6（2026-09-02付で、セルフレビュー対象を「L/XLサイズのみ」から「サイズによらず全ての作業パッケージ」へ改定した旨を記載）／`detailed_design/web-core-foundation.md` §8項目4、`detailed_design/data-model-persistence.md` §10項目4、`detailed_design/error-logging-foundation.md` §8項目4、`detailed_design/export-print.md` §6末尾 | 上記4件の詳細設計書は、それぞれ「Mサイズ（またはSサイズ）のため対象外（[[../basic_design/15_development_process.md#6]]はL/XLのみ対象）」という記述のままになっている。これは`15_development_process.md`が2026-09-02付で「L/XL限定」の方針を撤回した後の版の記載と一致しない。 | 対応済み | 該当4文書の該当箇所を、2026-09-02改訂後の「サイズによらず全作業パッケージが対象」という現行方針に沿った記述へ修正した。単純な記載残存として、既知ギャップ台帳G17（`detailed_design/00_reference.md` §8.1）に記録した。 |
| A-3 | `tab_app_requirements.md` 5.3節（「保存できる曲数｜明確な上限を設ける（1000曲程度を想定）」）／`basic_design/09_nonfunctional.md` §5・`detailed_design/00_reference.md` §5（`SONG-001`はWarning、900件到達時点の予告のみで、1000件到達時点の挙動を定めるエラーコードは登録されていない） | 小節数（2048）・パート数（8）・タグ数（50）の3つの上限は、超過時に操作を拒否するErrorコード（`EDIT-003`／`EDIT-005`／`TAG-001`）が登録されているのに対し、曲数の上限（1000）については90%到達時のWarning（`SONG-001`）のみが定義されており、1000件到達時に新規作成をどう扱うか（拒否する仕組みの有無）を示す記述は確認できなかった。 | 対応済み | 本人が「ハードキャップにする」を選択。他の上限（小節数・パート数・タグ数）と同様、1000件到達時は新規曲作成を拒否するErrorとして`SONG-002`を新規登録した（決定点C12）。900件到達時の`SONG-001`（Warning、予告）はそのまま維持。反映先：`basic_design/13_design_decision_points.md` C12、`basic_design/04_editing_core.md` §11、`detailed_design/00_reference.md` §5、`detailed_design/screens-navigation.md` §3.5、`tab_app_requirements.md` 10章#13。 |
| A-4 | `basic_design/04_editing_core.md` §11（「メモ文字数上限(約100文字)｜メモ入力時｜Warning（入力継続は可、上限で打ち切り）」）／`basic_design/13_design_decision_points.md` B20（小節数・パート数・タグ数の3件について「上限に達したら操作自体を拒否するハードキャップであり、Warning本来の定義（操作継続可）と矛盾していた」としてErrorへ再分類した経緯） | 「入力継続は可」と「上限で打ち切り」が同一セルに併記されており、101文字目以降の入力が実際にどう扱われるか（保存されず切り捨てられるのか、入力自体は継続できるのか）が一義的に読み取れない。B20で他の3件をError化した際の判断基準（操作自体を拒否する挙動かどうか）を、メモ文字数上限にも同様に適用したかどうかは文書上明記されていない。 | 対応済み | 本人が「入力は継続可、保存は100文字で切詰め」を選択。ユーザーの入力操作自体はブロックしないが、実際に永続化される内容は先頭100文字に切り詰めるという一義的な挙動に確定した（決定点C13）。`EDIT-004`のエラーレベルはWarningのまま維持し、B20の3件（ハードキャップ＝Error）とは性質が異なることを明記した。反映先：`basic_design/13_design_decision_points.md` C13、`basic_design/04_editing_core.md` §11、`detailed_design/editing-core.md` §7、`tab_app_requirements.md` 10章#14。 |
| A-5 | `basic_design/09_nonfunctional.md` §3（「Electronのレンダラープロセスを曲ごとに分離する（複数ウィンドウ＝複数レンダラープロセス）ため、同時に開く曲数に比例してメモリは増える点をユーザー（本人）に注記する」）／`basic_design/11_test_strategy.md` §0.1品質KPI一覧（「メモリ使用量｜通常編集時｜400MB以内」「大曲（2048小節）編集時｜600MB以内」という単一の数値目標として記載） | `09_nonfunctional.md`は複数ウィンドウ（複数の曲）を同時に開いた場合メモリ使用量が比例して増える旨を明記しているが、品質KPI一覧の数値目標は単一の値として記載されており、1編集ウィンドウあたりの値かアプリ全体としての上限かが読み取れない。要件定義書5.6節・`basic_design/03_screens_ui_pc.md` §2は複数編集ウィンドウの同時オープンを明示的にサポート対象としている。 | 対応済み | 400MB／600MBはいずれも「1編集ウィンドウ（＝1曲）あたり」の目標値であることを明記した。単純な粒度未記載として、既知ギャップ台帳G18（`detailed_design/00_reference.md` §8.1）に記録した。反映先：`basic_design/09_nonfunctional.md` §3、`basic_design/11_test_strategy.md` §0.1、`tab_app_requirements.md` 5.5節。 |

## B. 未規定・曖昧と考えられる箇所

| # | 該当箇所 | 所見 | 対応要否 | 対応内容 |
|---|---|---|---|---|
| B-1 | `detailed_design/part-tuning-management.md` §3.3（`capoFret`の範囲を0〜12に確定）／`basic_design/04_editing_core.md` §4・§11（フレット番号の範囲を0〜24と規定）／`detailed_design/playback-integration.md` §3.2（実音＝開放弦ピッチ＋`capoFret`＋記譜フレット番号という計算式） | `capoFret`とフレット番号はそれぞれ独立した範囲検証（0〜12、0〜24）のみが定義されており、両者を組み合わせた場合（例：`capoFret`=12かつフレット番号=24）の妥当性についての検証・言及は確認できなかった。 | 対応不要 | 最悪値の組み合わせ（`capoFret`=12・フレット番号=24、計36半音＝3オクターブ）でも、ギター／ベースの開放弦ピッチにこれを加算した結果は通常の演奏可能音域を超えるだけであり、システム上不正な値（MIDIノート番号のオーバーフロー等）には該当しないため、組み合わせに起因する追加のバリデーションは不要と判断した。根拠を`detailed_design/part-tuning-management.md` §3.3に追記した。 |
| B-2 | `basic_design/04_editing_core.md` §8.2（「各コマンドは差分（パッチ）のみを保持し、スナップショット全体を保持しない設計とする（09章のメモリ目標に対応）」）／`detailed_design/part-tuning-management.md` §5（`RemovePartCommand`｜「Undo時は削除前の全内容を復元できるよう、削除直前のパート全体を差分として保持する」） | `RemovePartCommand`は、Undoのために削除対象パート全体（配下の全Bar/Voice/Beat/Note）を保持する設計になっている。「差分（パッチ）」という語彙上は矛盾しないが、実質的には対象パート全体のスナップショットに相当するデータ量になる。2048小節規模のパートを削除した場合の保持データ量についての言及は確認できなかった。 | 対応済み | 本人より「無制限の要件はまずい、余裕を持った現実的な上限を設けたい」との明確な方針転換の依頼を受け、要件4.1の「セッション内無制限」を撤回。**メモリ予算80MB**（`CommandHistory`インスタンス＝編集ウィンドウ単位）、**直近200件の下限保証**、予算超過時は**最古のundoStackエントリから破棄**、単一コマンドが予算全体を超える場合でも実行自体は拒否せず他エントリを破棄して領域確保、実際に破棄が発生した最初の1回のみInfo通知（`EDIT-008`）という有限アルゴリズムに確定した（決定点C11）。反映先：`basic_design/13_design_decision_points.md` C11、`basic_design/04_editing_core.md` §8.2、`detailed_design/00_reference.md` §3.4・§5、`detailed_design/editing-core.md` §6.2・§7・§13、`basic_design/09_nonfunctional.md` §2、`basic_design/11_test_strategy.md` §0.1・§2、`tab_app_requirements.md` 10章#12。 |
| B-3 | `tab_app_requirements.md` 4.2節（「想定最大3〜4パート（バンド編成）」）／同5.3節（「パート数｜8パート程度を想定」） | 同一の要件定義書内で、パート数について「想定最大3〜4」と「上限8」という異なる数値が、それぞれ別の観点（典型的な利用シーン／システム上のキャパシティ上限）として記載されている。 | 対応不要 | 3〜4パートは典型的な利用シーン（バンド編成）を指し、8パートは想定利用シーンを超えた場合に備えたシステム上のキャパシティ上限であり、両者は矛盾する数値ではなく別の観点の記載であることを`tab_app_requirements.md` 4.2節に注記した。 |
| B-4 | `detailed_design/export-print.md` §4.2（PDF保存プレビュー用に`layoutForPrint()`を1回呼び出した後、ユーザーが「印刷」を選んだ場合は`PrintWindowController.showPrintDialog()`が同一内容に対し`layoutForPrint()`を再度呼び出す旨が明記） | プレビュー表示用と印刷実行用とで、同一の曲データに対するA4レイアウト計算（`layoutForPrint`）が2回独立して実行される構成になっている。他の設計判断（B6、B21〜B23等）には採用理由の記載があるが、この二重実行についての採用理由・許容根拠の記載は確認できなかった。 | 対応済み | プレビュー→印刷は典型的な連続操作であり、同一`layoutOptions`のまま2重にレンダリングコストを払う理由がないと判断。`PrintWindowController`に直前のレイアウト結果（対象songId・layoutOptionsのハッシュとともに）を1件だけキャッシュし、`showPrintDialog()`の直後に`renderAndGeneratePdf()`が同一条件で呼ばれた場合はキャッシュを再利用して`layoutForPrint()`の再計算を省略するよう変更した（決定点B28）。曲やレイアウトオプションが変更されていた場合、またはプレビューを経由しない直接印刷の場合は通常どおり新規にレイアウトする。反映先：`basic_design/13_design_decision_points.md` B28、`detailed_design/export-print.md` §3.3・§4.2・§6・§7・§8。 **2026-09-04追記（監査是正）**：`renderAndGeneratePdf()`側が新規キャッシュ格納時に旧エントリを破棄していなかったため、印刷を経ないプレビュー連続実行でリソースリークになりうる欠落が監査（[[design_review_2026-09-03_audit.md]]）で発見された。格納前に旧エントリを必ず破棄する順序へ修正し解消した。 |
| B-5 | `detailed_design/data-model-persistence.md` §5（移行対象：`songs/`・`trash/`・`index.json`・`tuning-presets.json`・`tags.json`・`settings.json`）／`basic_design/06_file_io_persistence.md` §3（`logs/`も`TabApp/`配下のディレクトリ構造に含まれる） | ログフォルダ（`logs/`）はアクティブなストレージルート配下に置かれる設計だが、`StorageMigrationService`の移行対象ファイルリストには含まれていない。移行後、旧ストレージ側のログには通常のUI操作（設定画面の「ログフォルダを開く」）からアクセスできなくなると考えられるが、この点についての言及は確認できなかった。 | 対応不要（現状維持を確定） | 本人に確認の上、ログの閲覧手段は現状どおり設定ダイアログの「アプリ情報」からOSのエクスプローラーでログフォルダを開く方式のみとし、アプリ内ログビューアは新設しないことを確定した。あわせて、`logs/`は個人開発規模でのログの重要度・移行処理自体の複雑化リスクを踏まえ、今後も移行対象に含めないことを確定した（決定点C14）。旧保存先のログは移行後そのまま残置され、UIからは追跡されない点は許容する。反映先：`basic_design/13_design_decision_points.md` C14。 **2026-09-04追記（監査是正）**：反映先として挙げていた`basic_design/06_file_io_persistence.md#5`は実際にはC14に関する記述が存在しない誤ったクロスリファレンスであることが監査（[[design_review_2026-09-03_audit.md]]）で判明した。`logs/`が実際に記載されている§3（ディレクトリ構造）への参照に訂正し、同節へC14の決定内容を明記する注記を追記した。 |

## C. 全体状況に関する所見（参考情報）

| # | 該当箇所 | 所見 | 対応要否 | 対応内容 |
|---|---|---|---|---|
| C-1 | `basic_design/00_overview.md` §6（「本セッション（PC非接続環境）では着手できない」旨の記載）／`basic_design/13_design_decision_points.md` §2（カテゴリA一覧） | 本レビュー時点で、実装コード（ソースコード）は作成されていない。カテゴリA（技術検証待ち）に分類された項目のうち、A1〜A3は文書調査により解決済みだが、実機（PC・Mac・iPhone）を用いた検証が前提となるA4〜A10・A11・A12（9項目）はいずれも未実施である。基本設計・詳細設計の作成自体がPC非接続環境で行われたことが明記されている。 | 対応不要（事実確認のみ） | 実機検証が前提のカテゴリA項目は、当初からPC接続後のPhase 0/1で実施する計画であり、本レビュー時点で未実施であること自体は想定通りの状態。計画・優先順位に変更はない。 |
| C-2 | `basic_design/15_development_process.md` §0（0.14節・0.15節・0.16節の改定履歴） | 開発プロセス（Lint強制・CI・セルフレビュー対象範囲・コミット規約等）の方針は2026-09-02中に複数回改定されており、いずれも「一人開発・隙間時間開発」を理由とした運用の簡略化を撤回し、より厳格な運用へ変更する方向で行われている。要件定義書5.6節が前提としていた「一人開発・隙間時間開発」という制約は、最終的にはコード品質・プロセス面の運用強度にはほぼ影響しない位置づけとなっている（本人が直接時間を割く工程のみに制約が残る整理）。 | 対応不要（事実確認のみ） | 開発プロセスの厳格化は本人が意図した方向への改定であり、要件定義書5.6節の制約（一人開発・隙間時間開発）は本人が直接手を動かす工程にのみ影響し、Lint・CI等の自動化されたプロセス強度とは独立という整理で矛盾はない。現状の記載のまま変更不要と判断。 |
| C-3 | `detailed_design/00_reference.md` §8.1（G1） | パッケージ1〜3（`web-core-foundation`／`data-model-persistence`／`error-logging-foundation`）は具体的なメソッドシグネチャレベルで記述されているのに対し、パッケージ4〜8（`editing-core`／`part-tuning-management`／`view-modes`／`playback-integration`／`screens-navigation`）は責務レベルの記述に留まっているという粒度の不統一が「未解消」として記録されている。 | 対応不要（既に記録済みの既知事項） | 本件は本レビュー以前から`detailed_design/00_reference.md` §8.1のG1として既知ギャップ台帳に記録済みであり、実装着手時に解消する方針に変更はない。重複登録はせず、既存のG1をもって対応記録とする。 |
| C-4 | `basic_design/13_design_decision_points.md` A11・A12 | A11（WebView内音声のAVAudioSessionカテゴリ継承）・A12（iOSのファイルアクセスモデルと`FileSystemAdapter`契約の整合性）は、いずれも文書内で「他のカテゴリA項目と異なり、検証結果次第でPhase 3のアーキテクチャ方針自体の見直しに発展しうる」性質のものとして区別されており、Phase 3の詳細設計着手前に優先的な検証を行うべきとされている。いずれも実機検証は未実施（公開情報調査のみ実施済み）。 | 対応不要（計画通り） | A11・A12は既に他のカテゴリA項目と異なる重み付けで区別されており、「Phase 3の詳細設計着手前に優先検証する」という運用は本レビュー以前からの既定方針のまま変更不要。 |

---

**所見件数**：A（文書間不一致）5件、B（未規定・曖昧箇所）5件、C（全体状況）4件（計14件、対象文書は全27文書）。

**2026-09-03追記（本人依頼による是正完了）**：上記14件のうち、要件所有者本人の判断を要した4件（A-3・A-4・B-2・B-5）は`basic_design/13_design_decision_points.md`のC12・C13・C11・C14として、工学判断のみで完結する1件（B-4）はB28として、決定点台帳に新規登録した。単純な記載整合性の欠落3件（A-1・A-2・A-5）は既知ギャップ台帳のG16〜G18（`detailed_design/00_reference.md` §8.1）として記録した。B-1・B-3は調査の結果いずれも対応不要と判断し、その根拠を該当設計書に追記した。C-1〜C-4は事実確認のみで対応不要。是正作業の全体像は`detailed_design/00_reference.md` §9.14に記録している。

**2026-09-04追記（本人依頼による監査の結果）**：上記の是正内容自体が実際に反映されているかを本人依頼で監査した（[[design_review_2026-09-03_audit.md]]）。14件中12件は主張どおりの反映が確認されたが、B-4・B-5の2件に反映漏れ・誤りが見つかり、追加で是正した（各行の対応内容末尾、および`detailed_design/00_reference.md` §9.15参照）。
