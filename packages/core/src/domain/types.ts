/**
 * データモデルの型（data-model-persistence.md 2 節・5 節・6 節・7 節、基本設計 02 章 3 節・4 節）。
 *
 * 曲名・アーティスト名は Score（`Score.title`・`Score.artist`）に持ち、ここの型には持たない（data-model-persistence.md 5 節）。
 * 曲の進捗は利用者が作るタグで表し、`status` という専用の項目は持たない（data-model-persistence.md 5 節）。
 *
 * 実行しているときの曲のモデルは alphaTab の Score 系を土台にし（基本設計 01 章 AD-1）、
 * Score が持たないサイドカーのうち曲のファイルに入れるものを AppMetadata が持つ（data-model-persistence.md 6 節）。
 * 曲のファイルの形は自前の構造化 JSON（`.tabapp`、data-model-persistence.md 7 節）。
 */

// data-model-persistence.md 6.4 節：defaultViewMode の値は focus・scroll・score の 3 つに限る <!-- req datamodelpersistence:7067dc0a.d8ac --> <!-- req datamodelpersistence:7067dc0a.106c --> <!-- req datamodelpersistence:7067dc0a.3a23 --> <!-- req datamodelpersistence:7067dc0a.1d87 -->
/** 表示モード（data-model-persistence.md 6.4 節の `defaultViewMode` の 3 つの値）。 */
export type ViewMode = 'focus' | 'scroll' | 'score';

// data-model-persistence.md 4 節：TAG・TAG_REF は alphaTab の側に無く、アプリの型で持つ <!-- req datamodelpersistence:3116ade7.a593 -->
// data-model-persistence.md 6.3 節：TagRef は { tagId: string } の形 <!-- req datamodelpersistence:e51f2d2c.ef17 -->
/**
 * 曲に付けたタグ 1 つ（data-model-persistence.md 6.3 節）。`appMeta.tags` は `TagRef[]`（`{ tagId: string }` の並び）。
 * タグの一覧そのものはアプリの側の `tags.json` に置く（data-model-persistence.md 13.4 節）。
 */
export interface TagRef {
  tagId: string;
}

// data-model-persistence.md 6.2 節：Memo を export した interface にし、テキストだけで音声を持たない <!-- req datamodelpersistence:10254d44.2cc7 --> <!-- req datamodelpersistence:12cf4412.dd57 --> <!-- req datamodelpersistence:12cf4412.79ff -->
/**
 * 小節メモ（data-model-persistence.md 6.2 節）。1 つの小節に何件でも置け、同じ小節のメモは上書きせずに足す（基本設計 13 章 B1）。
 * テキストだけを持ち、音声は持たない。
 */
export interface Memo {
  // data-model-persistence.md 6.2 節：Memo に string 型の id を持つ <!-- req datamodelpersistence:f49caabf~1.4005 -->
  id: string;
  // data-model-persistence.md 6.2 節：Memo の barId は曲共通の小節の番号の文字列 <!-- req datamodelpersistence:1f0409a5~1.655b --> <!-- req datamodelpersistence:cc2aabeb.7122 --> <!-- req datamodelpersistence:cc2aabeb.e2be --> <!-- req datamodelpersistence:cc2aabeb.6ce3 -->
  /** メモを付けた曲共通の小節（MasterBar）の番号を、文字列にしたもの。 */
  barId: string;
  // data-model-persistence.md 6.2 節：Memo に string 型の本文 text を持つ <!-- req datamodelpersistence:4ef2416b.1d4f -->
  /** 本文（テキストだけ）。 */
  text: string;
  // data-model-persistence.md 6.2 節：Memo に作った日時 createdAt を string 型で持つ <!-- req datamodelpersistence:95651f1d.4c95 --> <!-- req datamodelpersistence:66ffca1f.1d00 -->
  /** 作った日時（ISO 8601）。 */
  createdAt: string;
}

// data-model-persistence.md 6.1 節：SectionMarker を export した interface にする <!-- req datamodelpersistence:de8441fc.9d81 -->
/**
 * セクションマーカー（data-model-persistence.md 6.1 節）。正は `appMeta.sectionMarkers` で、
 * alphaTab の `MasterBar.section` は譜面に名前を描かせるための写し（曲を開くときに作り直す。SongDocument.ts）。
 */
export interface SectionMarker {
  // data-model-persistence.md 6.1 節：SectionMarker に string 型の id を持つ <!-- req datamodelpersistence:f49caabf.b469 -->
  id: string;
  // data-model-persistence.md 6.1 節：マーカーの位置は MasterBar の番号の文字列の barId <!-- req datamodelpersistence:1f0409a5.a07b --> <!-- req datamodelpersistence:3ed82490.7783 --> <!-- req datamodelpersistence:3ed82490.9e24 --> <!-- req datamodelpersistence:3ed82490.43e9 --> <!-- req datamodelpersistence:3ed82490.d55d --> <!-- req datamodelpersistence:3ed82490.342e -->
  /** マーカーを置いた曲共通の小節（MasterBar）の番号を、文字列にしたもの。 */
  barId: string;
  // data-model-persistence.md 6.1 節：セクション名 label は選択肢に限らない自由な文字列 <!-- req datamodelpersistence:eaec9185.28c0 --> <!-- req datamodelpersistence:0785f404.8966 --> <!-- req datamodelpersistence:0785f404.5903 --> <!-- req datamodelpersistence:0785f404.09df --> <!-- req datamodelpersistence:0785f404.bf9e -->
  /** セクション名。 */
  label: string;
}

// data-model-persistence.md 6.4 節：SongSettings を export し、6.4 節の 2 項目を持ちミキサーの値を持たない <!-- req datamodelpersistence:de02e079.49b2 --> <!-- req datamodelpersistence:cf0166b7.63e3 --> <!-- req datamodelpersistence:8370e5bb.ce1b --> <!-- req datamodelpersistence:c9c864e2.31bc --> <!-- req datamodelpersistence:c9c864e2.9efd -->
/**
 * 曲ごとの設定（data-model-persistence.md 6.4 節）。ミキサーの値は持たない
 * （パートごとの音量・パン・ソロ・ミュートはパートの `Track.playbackInfo` が持つ）。
 */
// data-model-persistence.md 7 節：settings が 6.4 節の 2 つの項目を持つかどうか <!-- req datamodelpersistence:8370e5bb.ce1b -->
export interface SongSettings {
  // data-model-persistence.md 6.4 節：defaultViewMode は曲を開いたときの表示モードで 3 値の型 <!-- req datamodelpersistence:83cebb0a.6711 --> <!-- req datamodelpersistence:7067dc0a.161f --> <!-- req datamodelpersistence:7067dc0a.449b -->
  /** 曲を開いたときの表示モード。 */
  defaultViewMode: ViewMode;
  // data-model-persistence.md 6.4 節：explicitTimeSignatureBars は拍子をはっきり入れた小節の番号の number[] <!-- req datamodelpersistence:7ae05638.48b5 --> <!-- req datamodelpersistence:7ae05638.d03d --> <!-- req datamodelpersistence:7ae05638.e9d0 --> <!-- req datamodelpersistence:7ae05638.0b72 --> <!-- req datamodelpersistence:c9c864e2.ce9b --> <!-- req datamodelpersistence:c9c864e2.ed50 -->
  /** 拍子をはっきり入れた小節の番号（MasterBar.index、0 から、小さい順）。 */
  explicitTimeSignatureBars: number[];
  // data-model-persistence.md 6.4 節：partPresetIds はパートの presetId の (string | null)[] <!-- req datamodelpersistence:191499c2.f5f6 --> <!-- req datamodelpersistence:c9c864e2.ccac --> <!-- req datamodelpersistence:c9c864e2.8a4c -->
  /** パートごとの presetId（Track.index の順）。プリセットから作っていないパートは null。 */
  partPresetIds: (string | null)[];
}

// data-model-persistence.md 2 節：サイドカーは Score が持たない情報とアプリ固有の情報に限り、Score に同じ意味の項目があれば Score を使う（4 節の対応表でアプリ側の保存先が「なし」のチューニング・小節・ボイス・拍・音符はここに持たない） <!-- req datamodelpersistence:ff4a71bf.8b83 --> <!-- req datamodelpersistence:ff4a71bf.f343 --> <!-- req datamodelpersistence:ff4a71bf.b355 --> <!-- req datamodelpersistence:43bc654e.c06e --> <!-- req datamodelpersistence:806faf90.3430 --> <!-- req datamodelpersistence:6b0cf6a1.2f09 --> <!-- req datamodelpersistence:235d262a.9225 --> <!-- req datamodelpersistence:cf9b39de.3ed4 -->
// data-model-persistence.md 6 節：appMeta は Score の外に置き、基本設計 02 章 4.1 節の 5 項目に限る <!-- req datamodelpersistence:7b675aa8.7134 --> <!-- req datamodelpersistence:8188d376.39aa --> <!-- req datamodelpersistence:e345c21e.3cfc --> <!-- req datamodelpersistence:e345c21e.6938 --> <!-- req datamodelpersistence:e345c21e.8364 --> <!-- req datamodelpersistence:e345c21e.856f --> <!-- req datamodelpersistence:5e2c6eea.2580 --> <!-- req datamodelpersistence:dcca6c3c.bf43 --> <!-- req datamodelpersistence:8459760f.6eed -->
/**
 * 曲のファイルの `appMeta`（data-model-persistence.md 6 節）。Score の外に置く情報で、
 * 項目は基本設計 02 章 4.1 節の appMeta の一覧の 5 つと 1 対 1 にし、これ以外の項目を足さない。
 * 繰り返し記号（リピート）はここに持たず、alphaTab の `MasterBar.isRepeatStart`・`MasterBar.repeatCount` で持つ（data-model-persistence.md 6.1 節）。
 */
export interface AppMetadata {
  // data-model-persistence.md 5 節：曲とタグは多対多で、曲の進捗の区別もタグで表す <!-- req datamodelpersistence:92339060.cc45 --> <!-- req datamodelpersistence:92339060.691f -->
  // data-model-persistence.md 6.3 節：曲に付けたタグは appMeta.tags に TagRef[] で持つ <!-- req datamodelpersistence:3116ade7.2f2c --> <!-- req datamodelpersistence:e51f2d2c.fcf8 --> <!-- req datamodelpersistence:e51f2d2c.bb8e -->
  /** 曲に付けたタグ（data-model-persistence.md 6.3 節）。 */
  // data-model-persistence.md 5 節：tags は曲に付けたタグで、appMeta.tags に持つ <!-- req datamodelpersistence:92339060.9df0 --> <!-- req datamodelpersistence:92339060.c4a3 -->
  // data-model-persistence.md 13.4 節：曲に付けたタグは曲のファイルの appMeta.tags に持つ <!-- req datamodelpersistence:51608f2a.9499 -->
  tags: TagRef[];
  // data-model-persistence.md 4 節：MEMO は alphaTab の側に無く、appMeta.memos に持つ <!-- req datamodelpersistence:ace2ff74.d39a -->
  // data-model-persistence.md 6.2 節：小節メモは appMeta.memos に Memo[] で何件でも持つ <!-- req datamodelpersistence:ace2ff74.5315 --> <!-- req datamodelpersistence:264f4dcb.5fab --> <!-- req datamodelpersistence:264f4dcb.294b --> <!-- req datamodelpersistence:937fbd25.3ea3 --> <!-- req datamodelpersistence:937fbd25.bb65 --> <!-- req datamodelpersistence:c37c960a.b5ce -->
  /** 小節メモ（data-model-persistence.md 6.2 節）。1 つの小節に 1 件だけ持つ形にはしない。 */
  memos: Memo[];
  // data-model-persistence.md 6.1 節：マーカーの正は appMeta.sectionMarkers <!-- req datamodelpersistence:975d1015.f782 --> <!-- req datamodelpersistence:90a6b1c2.29ac --> <!-- req datamodelpersistence:1c1e09fb.1c8e --> <!-- req datamodelpersistence:1c1e09fb.4a5d -->
  /** セクションマーカー（data-model-persistence.md 6.1 節）。 */
  sectionMarkers: SectionMarker[];
  // data-model-persistence.md 4 節：SONG_SETTINGS は alphaTab の側に無く、appMeta.settings に持つ <!-- req datamodelpersistence:08aec20c.a326 -->
  // data-model-persistence.md 6.4 節：SONG_SETTINGS は appMeta.settings に曲ごとの設定として持つ <!-- req datamodelpersistence:08aec20c.9011 --> <!-- req datamodelpersistence:7067dc0a.4967 -->
  /** 曲ごとの設定（data-model-persistence.md 6.4 節）。 */
  settings: SongSettings;
  // data-model-persistence.md 6.5 節：thumbnail は base64-png の PNG の data か null で、画像の正 <!-- req datamodelpersistence:232e3ec5.789b --> <!-- req datamodelpersistence:1e5eb702.ab35 --> <!-- req datamodelpersistence:1e5eb702.aca1 --> <!-- req datamodelpersistence:1e5eb702.c991 --> <!-- req datamodelpersistence:1e5eb702.729a --> <!-- req datamodelpersistence:b20ccd11.e1bb --> <!-- req datamodelpersistence:b20ccd11.a76d --> <!-- req datamodelpersistence:b20ccd11.6d12 -->
  /**
   * 曲一覧のサムネイル（data-model-persistence.md 6.5 節）。`data` は PNG の画像を base64 の文字列にしたもの。
   * まだ作っていないときは null。
   */
  thumbnail: { encoding: 'base64-png'; data: string } | null;
}

// data-model-persistence.md 7 節：AppMetadataJson を SongFileJson と同じ types.ts に置き、ファイルとメモリで同じ形 <!-- req datamodelpersistence:222daa4c.3744 --> <!-- req datamodelpersistence:222daa4c.c25e --> <!-- req datamodelpersistence:222daa4c.645d --> <!-- req datamodelpersistence:222daa4c.ba38 --> <!-- req datamodelpersistence:222daa4c.f7dd --> <!-- req datamodelpersistence:222daa4c.cf44 -->
/**
 * 曲のファイルの `appMeta` の型（data-model-persistence.md 7 節）。曲のファイルの上とメモリの上で同じ形を使う。
 */
export type AppMetadataJson = AppMetadata;

// data-model-persistence.md 5 節：曲のファイルは自分の場所・status・thumbnailRef・isTrashed・trashedAt・updatedAt を持たない <!-- req datamodelpersistence:fbd2e0bc.bf09 --> <!-- req datamodelpersistence:92339060.a347 --> <!-- req datamodelpersistence:232e3ec5.3973 --> <!-- req datamodelpersistence:8188d376.4eb7 --> <!-- req datamodelpersistence:1cf63af6.01c0 -->
// data-model-persistence.md 7 節：曲のファイルの形は SongFileJson で、いちばん上は 6 項目に限る <!-- req datamodelpersistence:8145c582.2585 --> <!-- req datamodelpersistence:f9ec7ba4.2503 --> <!-- req datamodelpersistence:7562f3bd.2af6 --> <!-- req datamodelpersistence:307d97df.4593 --> <!-- req datamodelpersistence:307d97df.a465 --> <!-- req datamodelpersistence:307d97df.91ea -->
/**
 * 曲のファイル（`{id}.tabapp`）の形（data-model-persistence.md 7 節）。いちばん上の階層はこの 6 つの項目に限り、これ以外を置かない。
 *
 * `updatedAt` は `integrity.savedAtMonotonic` から、`isTrashed`・`trashedAt` は置き場所（`songs/` か `trash/`）と
 * `trash-index.json` から作るのでファイルには持たない。`thumbnailRef` も持たない（SongSummary だけが持つ。data-model-persistence.md 5 節）。
 */
export interface SongFileJson {
  // data-model-persistence.md 7 節：SongFileJson に string 型の schemaVersion を持つ <!-- req datamodelpersistence:f5b835f9.928b -->
  /** 曲のファイルの形の版（セマンティックバージョニングの文字列。data-model-persistence.md 8 節）。 */
  schemaVersion: string;
  // data-model-persistence.md 7 節：SongFileJson に 5 節の id を string 型で持つ <!-- req datamodelpersistence:d485e2f4.585c -->
  /** 曲の識別子（data-model-persistence.md 5 節の id）。ファイルの名前と同じ。 */
  id: string;
  // data-model-persistence.md 7 節：SongFileJson に 5 節の createdAt を string 型で持つ <!-- req datamodelpersistence:f174905b.3bd1 -->
  /** 作った時刻（ISO 8601。data-model-persistence.md 5 節の createdAt）。 */
  createdAt: string;
  // data-model-persistence.md 7 節：SongFileJson に unknown 型の song を持つ <!-- req datamodelpersistence:080cacc3.c123 -->
  /** Score を alphaTab の JsonConverter で JSON にしたもの（data-model-persistence.md 2 節）。 */
  song: unknown;
  // data-model-persistence.md 2 節：曲のファイルの appMeta はアプリの型 AppMetadata で読み書きする <!-- req datamodelpersistence:638dde2a.38be -->
  // data-model-persistence.md 7 節：曲のファイルに AppMetadataJson 型の appMeta を持つ <!-- req datamodelpersistence:e345c21e.fb36 --> <!-- req datamodelpersistence:ead427b9.588f -->
  /** サイドカーのうち曲のファイルに入れるもの（data-model-persistence.md 6 節）。 */
  appMeta: AppMetadataJson;
  // data-model-persistence.md 7 節：曲のファイルに integrity をオブジェクト型で持つ <!-- req datamodelpersistence:b460df43.2585 -->
  integrity: {
    // data-model-persistence.md 7 節：savedAtMonotonic は number 型の壁時計のミリ秒で名前は変えない <!-- req datamodelpersistence:1cf63af6.17ad --> <!-- req datamodelpersistence:c69f435f.a2db --> <!-- req datamodelpersistence:b40ba64d.a8a3 -->
    /** 保存したときの時刻（壁時計のミリ秒）。名前に Monotonic とあるが、古いファイルと合わせるため名前は変えない（data-model-persistence.md 7 節）。 */
    savedAtMonotonic: number;
    // data-model-persistence.md 7 節：integrity に sha256: で始まる string 型の checksum を持つ <!-- req datamodelpersistence:724f4fef.d3cd -->
    /** `sha256:` で始まる。ハッシュをかける対象は integrity を除いた `{schemaVersion, song, appMeta}`（data-model-persistence.md 7 節、checksum.ts）。 */
    checksum: string;
  };
}

/** 曲一覧に出す軽い情報（`index.json`、data-model-persistence.md 9 節）。 */
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

// data-model-persistence.md 4 節：TUNING_PRESET は alphaTab の側に無く、アプリの型で tuning-presets.json に持つ <!-- req datamodelpersistence:1a32a560.25b2 -->
/** チューニングプリセット（曲によらないアプリの側のデータ、基本設計 02 章 3.7 節、`tuning-presets.json`）。 */
export interface TuningPreset {
  id: string;
  name: string;
  /** 標準搭載プリセットなら true。ユーザー定義は false。 */
  builtin: boolean;
  /** 弦ごとの開放弦 MIDI ピッチ（alphaTab の並び：高音弦→低音弦）。 */
  stringPitches: number[];
}

/**
 * `tuning-presets.json` の 1 件（data-model-persistence.md 13.4 節）。利用者が作ったプリセットに、消した印の 2 つの項目（省いてよい）を足した形。
 * 組み込みのプリセットはこのファイルに入れない（part-tuning-management.md 3.3 節）。
 */
// data-model-persistence.md 13.4 節：tuning-presets.json の 1 件は TuningPreset を extends した StoredTuningPreset で、消した印の isDeleted と deletedAt（省いてよい）をここに持ち、TuningPreset そのものには持たせない <!-- req datamodelpersistence:fbc8ce54.c967 --> <!-- req datamodelpersistence:fbc8ce54.248c --> <!-- req datamodelpersistence:fbc8ce54.0c43 --> <!-- req datamodelpersistence:fbc8ce54.befa --> <!-- req datamodelpersistence:ff1c3e77.6d05 --> <!-- req datamodelpersistence:2ad5c82e.a8e2 --> <!-- req datamodelpersistence:4650f300.a27b -->
export interface StoredTuningPreset extends TuningPreset {
  /** 消した（論理削除した）なら true。 */
  isDeleted?: boolean;
  /** 消した日時（ISO 8601）。isDeleted のときだけ持つ。 */
  deletedAt?: string;
}

/** タグの一覧の 1 件（`tags.json`、data-model-persistence.md 13.4 節）。 */
// data-model-persistence.md 13.4 節：Tag は id: string と name: string を持つ <!-- req datamodelpersistence:51608f2a.cf0a --> <!-- req datamodelpersistence:51608f2a.aba3 -->
export interface Tag {
  id: string;
  name: string;
}

/** 新規パートの初期設定（SongRepository.create から使用。詳細な CRUD はパート・チューニング管理パッケージ）。 */
export interface NewPartSetup {
  name: string;
  /** MVP は 'electric_guitar' / 'bass'（基本設計 02 章 3.2 節、enum は将来 drum 等へ拡張）。 */
  instrumentType: 'electric_guitar' | 'bass';
  /** 開放弦 MIDI ピッチ（高音弦→低音弦）。 */
  tuning: number[];
}

/** 新規曲作成の初期設定（`SongRepository.create`）。 */
export interface NewSongSetup {
  title: string;
  /** 省略時は標準チューニングのエレキギター 1 パート。 */
  parts?: NewPartSetup[];
}
// 13.1 節の①・13.4 節：パート種別は Part.instrumentType の列挙で持ち、打楽器は alphaTab の Staff.isPercussion と Note.percussionArticulation で受ける。v1 では打楽器の種別の属性を自前で足さず、データモデルの中心は alphaTab の Score の階層をそのまま使う。v2 のドラムと 3 つの音色は instrumentType に値を足して受け、Part の構造・データモデル・画面の処理の構造を変えない（作業パッケージ 5 の part-tuning-management.md で受ける）。13.2 節：曲にステータス専用の項目を持たず、進捗の区別は利用者が作るタグで代わりにし、既定のステータスのタグを用意しない <!-- req webcorefoundation:09d68730.0c8c --> <!-- req webcorefoundation:09d68730.b382 --> <!-- req webcorefoundation:09d68730.db1c --> <!-- req webcorefoundation:81c00f0a.e054 --> <!-- req webcorefoundation:81c00f0a.753c --> <!-- req webcorefoundation:81c00f0a.b930 --> <!-- req webcorefoundation:81c00f0a.8bfe --> <!-- req webcorefoundation:81c00f0a.f876 --> <!-- req webcorefoundation:e3dcaf5a.63fb --> <!-- req webcorefoundation:e3dcaf5a.b55d --> <!-- req webcorefoundation:145ade6d.9c29 --> <!-- req webcorefoundation:145ade6d.b472 --> <!-- req webcorefoundation:145ade6d.6203 --> <!-- req webcorefoundation:ef68a833.1c8e --> <!-- req webcorefoundation:ef68a833.56d4 --> <!-- req webcorefoundation:ef68a833.38e5 --> <!-- req webcorefoundation:1ea98512.a5fc --> <!-- req webcorefoundation:1ea98512.c472 --> <!-- req webcorefoundation:59a4f074.c853 --> <!-- req webcorefoundation:59a4f074.ea7f --> <!-- req webcorefoundation:59a4f074.5a83 --> <!-- req webcorefoundation:59a4f074.165b --> <!-- req webcorefoundation:6aff31f0.0926 --> <!-- req webcorefoundation:6aff31f0.014a --> <!-- req webcorefoundation:6aff31f0.e2f2 -->
