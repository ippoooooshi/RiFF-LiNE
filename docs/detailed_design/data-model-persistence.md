# 詳細設計書：データモデル・永続化

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 2「データモデル・永続化」
- **ブランチ名**：`feature/data-model-persistence`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

1 節（スコープ）は基本設計 02 章・06 章の回に書く。

## 2. Score モデルとサイドカーメタデータ

[[../basic_design/01_architecture.md#3]] AD-1 を受ける。

- 1 曲は `SongDocument`（`packages/core/src/domain`）で表す。中身の中核は alphaTab の `Score`（`alphaTab.model.Score`）をそのまま持つ `score` で、アプリ独自の曲のモデルを別に作らない。書き出しと再生は、この `score` をそのまま alphaTab に渡す。 <!-- req 01:5542e325.c7c1 -->
- サイドカーに入れるのは、alphaTab の `Score` が持たない情報か、アプリ固有の情報だけとする。新しい情報を足すときは、先に `Score` に同じ意味の項目が無いかを確かめ、あれば `Score` のほうを使う。 <!-- req 01:9f185d99.6b28 -->
- `Score` とその下のオブジェクト（`Track`・`Staff`・`Bar`・`Voice`・`Beat`・`Note`）には、アプリ独自のプロパティを足さない。 <!-- req 01:9f185d99.8f9c -->
- サイドカーは `Score` の外に持つ。曲のファイルに入れるものは `SongDocument.appMeta`（型 `AppMetadata`）に、曲のファイルに入れないものはアプリの側のファイルに持つ。曲のファイル（`.tabapp`）では、`Score` を `song` に、サイドカーを `appMeta` に分けて置き、同じ JSON の中で混ぜない。`song` は alphaTab の `JsonConverter.scoreToJson(score)` の結果を `JSON.parse` して入れ、読むときは `JsonConverter.jsonToScore(JSON.stringify(song))` で戻す（alphaTab 1.8.4 の型定義にある 2 つ）。`appMeta` はアプリの型 `AppMetadata` で読み書きする。(b) alphaTab の変換を使うのは、`Score` の形が版上げで変わっても、変換は alphaTab の側で追いつくため。 <!-- req 01:9f185d99.af65 -->

**サイドカーの一覧は本節に並べない**：何をどこに置くかの一覧は、基本設計の 1 か所が正で、詳細設計でもその受け先の節 1 か所にだけ書く。本節は一覧の置き場所を決めるだけにする。

| 置き場所 | 一覧の正（基本設計） | 詳細設計で書く所 |
|---|---|---|
| 曲のファイルに入れるもの | [[../basic_design/02_data_model.md#4.1]] の `appMeta` の一覧 | 本書のうち基本設計 02 章 4.1 節を受ける節（02 章の回に書く）。`AppMetadata` の項目は `appMeta` の一覧と 1 対 1 にする |
| アプリの側に置くもの（曲のファイルに入れないもの） | [[../basic_design/06_file_io_persistence.md#3]] のファイル構成（2 つの木） | 本書のうち基本設計 06 章 3 節を受ける節（06 章の回に書く） <!-- req 01:f8b143e1.d823 --> |

サイドカーの情報を足すときは、まず上の表の基本設計の一覧に足し、次に詳細設計の受け先の節に足す。本節は直さない。

```ts
// packages/core/src/domain/SongDocument.ts
export class SongDocument {
  readonly id: string;
  readonly score: alphaTab.model.Score;   // 中核。アプリ独自のプロパティを足さない
  readonly appMeta: AppMetadata;          // サイドカーのうち曲のファイルに入れるもの
  readonly schemaVersion: string;
  readonly createdAt: string;
  toFileJson(savedAtMonotonic?: number): SongFileJson;   // 省くと今の時刻
  static fromFileJson(json: SongFileJson): SongDocument;
}
```

`AppMetadata` の項目と `SongFileJson` の形は、基本設計 02 章の回に本書で書く。

曲のファイルの形（スキーマ）を変えるときは、[[../basic_design/02_data_model.md#4.2]] のスキーマのバージョンと移行の方針に従う。`schemaVersion` の上げ方と移行の仕組みは、基本設計 02 章の回に本書で書く。 <!-- req 09:630b9903.2c1e -->
