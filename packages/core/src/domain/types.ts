/**
 * データモデルの型定義（data-model-persistence.md §3.1、02_data_model.md §3〜§4）。
 *
 * 実行時のドメインオブジェクトは alphaTab の Score 系モデルを基盤とし（AD-1）、
 * Score が持たない付随情報（タグ・メモ・セクション・表示設定・サムネイル）を AppMetadata が持つ。
 * 永続化フォーマットは自前定義の構造化 JSON（`.tabapp`、02_data_model.md §4.1）。
 */

/** 表示モード（view-modes.md、02_data_model.md SONG_SETTINGS.defaultViewMode）。 */
export type ViewMode = 'focus' | 'scroll' | 'score';

/** ストレージ種別（06_file_io_persistence.md §2.1）。 */
export type StorageType = 'local' | 'icloud' | 'gdrive' | 'custom';

/** 曲に付与されたタグへの参照（マスタは TagStore／`tags.json`。02_data_model.md TAG_REF）。 */
export interface TagRef {
  tagId: string;
}

/** 小節メモ（02_data_model.md §3.6、要件4.1「小節メモ／注釈」）。1 小節に複数可（B1）。 */
export interface Memo {
  id: string;
  /** 対象小節（alphaTab Bar の識別子）。 */
  barId: string;
  /** 本文。保存時に MEMO_MAX_LENGTH で切り詰める（C13、validation.ts）。 */
  text: string;
  /** 同一小節内の複数メモの表示順に使う（ISO 8601）。 */
  createdAt: string;
}

/** セクションマーカー（02_data_model.md §3.5、イントロ/Aメロ/サビ等）。 */
export interface SectionMarker {
  id: string;
  barId: string;
  label: string;
}

/** Score 本体が持たない曲固有の付随情報（data-model-persistence.md §3.1）。 */
export interface AppMetadata {
  tags: TagRef[];
  memos: Memo[];
  sectionMarkers: SectionMarker[];
  settings: {
    defaultViewMode: ViewMode;
    /** ミキサー状態のスナップショット。構造はパート・チューニング管理／再生パッケージが確定する。 */
    mixerSnapshot: unknown;
  };
  /** 曲一覧サムネイル（B7、生成は表示モード／画面群パッケージ）。未生成は null。 */
  thumbnail: { encoding: 'base64-png'; data: string } | null;
}

/**
 * 永続化される AppMetadata。現状は AppMetadata と構造的に同一（すべてプレーン値）。
 * 将来 in-memory 側にクラス／派生値が入った場合の分離点として名前を分けておく。
 */
export type AppMetadataJson = AppMetadata;

/**
 * `.tabapp` ファイルの JSON 構造（02_data_model.md §4.1）。
 *
 * `id`／`createdAt` は 02_data_model.md §4.1 のスケッチには明記されていなかったが、
 * SONG エンティティ（§2 ER 図）の `id PK`・`createdAt` に対応する。ファイル名（`songs/{id}.tabapp`）が
 * id の一次情報源であり、`SongRepository.load` はファイル名の id を最終的な真実とする（data-model-persistence.md §3.1）。
 * `updatedAt`／`isTrashed` はそれぞれ `integrity.savedAtMonotonic`・格納フォルダから導出するためファイルには持たない。
 */
export interface SongFileJson {
  /** セマンティックバージョニング文字列（02_data_model.md §4.2、int ではない）。 */
  schemaVersion: string;
  /** 曲の識別子（UUID）。ファイル名と一致する。 */
  id: string;
  /** 作成時刻（ISO 8601）。 */
  createdAt: string;
  /** alphaTab がパース可能な Score の JSON 表現（JsonConverter 経由）。 */
  song: unknown;
  appMeta: AppMetadataJson;
  integrity: {
    /** 保存時刻（ms）。どの保存が新しいかの判定用の目安。 */
    savedAtMonotonic: number;
    /** `sha256:<hex>` 形式。ハッシュ対象は `{schemaVersion, song, appMeta}`（integrity 自身は除く、§9.2）。 */
    checksum: string;
  };
}

/** 曲一覧表示用の軽量情報（`index.json`、02_data_model.md §5）。 */
export interface SongSummary {
  id: string;
  title: string;
  /** ISO 8601。 */
  updatedAt: string;
  /** タグ名の配列（TagRef を解決済み）。 */
  tags: string[];
  thumbnailRef: string | null;
  isTrashed: boolean;
}

/** チューニングプリセット（Song 非依存のグローバルデータ、02_data_model.md §3.7）。 */
export interface TuningPreset {
  id: string;
  name: string;
  /** 標準搭載プリセットなら true。ユーザー定義は false。 */
  builtin: boolean;
  /** 弦ごとの開放弦 MIDI ピッチ（alphaTab の並び：高音弦→低音弦）。 */
  stringPitches: number[];
}

/** タグマスタ（`tags.json`）。 */
export interface Tag {
  id: string;
  name: string;
}

/** 新規パートの初期設定（SongRepository.create から使用。詳細な CRUD はパート・チューニング管理パッケージ）。 */
export interface NewPartSetup {
  name: string;
  /** MVP は 'electric_guitar' / 'bass'（02_data_model.md §3.2、enum は将来 drum 等へ拡張）。 */
  instrumentType: 'electric_guitar' | 'bass';
  /** 開放弦 MIDI ピッチ（高音弦→低音弦）。 */
  tuning: number[];
}

/** 新規曲作成の初期設定（data-model-persistence.md §3.2 `SongRepository.create`）。 */
export interface NewSongSetup {
  title: string;
  /** 省略時は標準チューニングのエレキギター 1 パート。 */
  parts?: NewPartSetup[];
}
