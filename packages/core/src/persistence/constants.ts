/**
 * 永続化レイヤーの定数（data-model-persistence.md 7 節・13 節・14 節・15 節、基本設計 06 章 3 節）。
 * マジックナンバーを散らさず、実機検証（A5 等）での調整点を 1 箇所に集約する。
 */

// ===== ディレクトリ構造（基本設計 06 章 3 節。ルート = `{アクティブルート}/TabApp`） =====

export const SONGS_DIR = 'songs';
export const TRASH_DIR = 'trash';
/** 曲一覧のサムネイルの写し `{songId}.png` を置くフォルダ（data-model-persistence.md 13.1 節）。 */
// <!-- req datamodelpersistence:39a81d30.6250 -->
export const THUMBNAILS_DIR = 'thumbnails';
export const LOGS_DIR = 'logs';
// data-model-persistence.md 7 節：曲のファイルの拡張子は .tabapp <!-- req datamodelpersistence:503a525b.51e6 -->
export const SONG_FILE_EXT = '.tabapp';
/** アトミック書き込みの一時ファイル拡張子（data-model-persistence.md 15 節）。 */
export const TMP_SUFFIX = '.tmp';

// data-model-persistence.md 2 節：曲のファイルに入れないサイドカーは、アプリの側のファイル（index.json・trash-index.json・tuning-presets.json・tags.json）に持つ <!-- req datamodelpersistence:638dde2a.400f -->
// <!-- req datamodelpersistence:83d7e7d3.c8fc --> <!-- req datamodelpersistence:83d7e7d3.bb87 --> <!-- req datamodelpersistence:83d7e7d3.8c33 --> <!-- req datamodelpersistence:760462d1.d632 -->
export const INDEX_FILE = 'index.json';
// data-model-persistence.md 13.1 節：trash-index.json は index.json と同じく TabApp/ の直下に置き、trash/ の下に入れない <!-- req datamodelpersistence:15d25b97.ba84 --> <!-- req datamodelpersistence:15d25b97.18a7 -->
export const TRASH_INDEX_FILE = 'trash-index.json';
// data-model-persistence.md 4 節：TUNING_PRESET はアプリの側の tuning-presets.json に保存する <!-- req datamodelpersistence:1a32a560.c195 -->
export const TUNING_PRESETS_FILE = 'tuning-presets.json';
// data-model-persistence.md 4 節・6.3 節：タグの一覧そのものはアプリの側の tags.json に持つ <!-- req datamodelpersistence:3116ade7.d030 --> <!-- req datamodelpersistence:e51f2d2c.9d86 -->
export const TAGS_FILE = 'tags.json';
export const STORAGE_SETTINGS_FILE = 'settings.json';
/** AppPreferencesService（画面群パッケージ）管轄。移行対象に含む（G16）。 */
export const PREFERENCES_FILE = 'preferences.json';

// ===== 自動保存（data-model-persistence.md 15 節、要件 5.2） =====

/** 編集が止まってから保存するまで（2 秒、data-model-persistence.md 15 節）。 */
// <!-- req datamodelpersistence:028b92d3.c11c -->
// <!-- req datamodelpersistence:028b92d3.6db1 -->
export const AUTOSAVE_DEBOUNCE_MS = 2000;
/** 編集が続いていても、最後の保存（まだ一度も保存していない曲では最初の未保存の編集）からこの時間で保存する（10 秒、15 節）。 */
// <!-- req datamodelpersistence:028b92d3.c002 -->
export const AUTOSAVE_MAX_DELAY_MS = 10000;
/** 保存が失敗したときの書き直しの間隔（3 回まで、15 節）。 */
// <!-- req datamodelpersistence:06583ea4.d7bf -->
export const AUTOSAVE_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 9000];

// ===== ゴミ箱（基本設計 06 章 7 節、B9） =====

// data-model-persistence.md 13.3 節：trashRetentionDays の既定は 30 <!-- req datamodelpersistence:51e9b06f.ef31 -->
// <!-- req datamodelpersistence:81154086.639e -->
export const DEFAULT_TRASH_RETENTION_DAYS = 30;
/** 完全に消すまでの残りがこの日数（× 24 時間）以下の曲があれば、起動のときに Warning の `FILE-007` で知らせる（data-model-persistence.md 17 節）。 */
// <!-- req datamodelpersistence:c5a5fe49.a5e0 -->
export const TRASH_EXPIRY_WARNING_DAYS = 3;

// ===== ミラー同期（data-model-persistence.md 14.1 節、B26） =====

/** 最後のウィンドウが閉じた後に、進んでいるミラーの写しを待つ上限（15 秒）。`awaitPending` の引数を省いたときに使う。 */
// <!-- req datamodelpersistence:439586de.ec83 -->
// <!-- req datamodelpersistence:9eee465a.0e14 -->
// <!-- req datamodelpersistence:9eee465a.14ff -->
export const MIRROR_AWAIT_PENDING_TIMEOUT_MS = 15000;
