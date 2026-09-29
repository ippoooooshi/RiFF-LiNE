# パート・チューニング管理 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 5「パート・チューニング管理」
- **ブランチ名**：`feature/part-tuning-management`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 2. パートの項目

[[../basic_design/02_data_model.md#3.2]] を受ける節で、中身は基本設計 02 章 3.2 節の回に書く。いまは [[../basic_design/02_data_model.md#2]] の ER 図から降りる `instrumentType` だけを書く。

- パートは、楽器の種類を `instrumentType` で持つ。型は列挙 <!-- req 02:f1b76108.e058 -->で、値は `electric_guitar`（エレキギター） <!-- req 02:f1b76108.45b3 -->と `bass`（ベース） <!-- req 02:f1b76108.c716 -->。v2 で足す値は基本設計 10 章の回に書く。曲のファイルでの持ち方は 02 章 3.2 節の回に書く（今のコードは、MIDI のプログラム番号 `Track.playbackInfo.program` に写している。`packages/core/src/domain/newSong.ts`）。
