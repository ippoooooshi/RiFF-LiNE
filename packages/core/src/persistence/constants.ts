/**
 * 永続化レイヤーの定数（data-model-persistence.md §3・§5・§6・§9、06_file_io_persistence.md §3）。
 * マジックナンバーを散らさず、実機検証（A5 等）での調整点を 1 箇所に集約する。
 */

// ===== ディレクトリ構造（06_file_io_persistence.md §3。ルート = `{アクティブルート}/TabApp`） =====

export const SONGS_DIR = 'songs';
export const TRASH_DIR = 'trash';
/** 曲一覧のサムネイルの写し `{songId}.png` を置くフォルダ（data-model-persistence.md 13.1 節）。 */
// <!-- req datamodelpersistence:39a81d30.6250 -->
export const THUMBNAILS_DIR = 'thumbnails';
export const LOGS_DIR = 'logs';
// data-model-persistence.md 7 節：曲のファイルの拡張子は .tabapp <!-- req datamodelpersistence:503a525b.51e6 -->
export const SONG_FILE_EXT = '.tabapp';
/** アトミック書き込みの一時ファイル拡張子（05 §5）。 */
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

// ===== 自動保存（data-model-persistence.md §9.1、要件5.2） =====

/** デバウンス間隔。 */
export const AUTOSAVE_DEBOUNCE_MS = 3000;
/** 連続編集時の最大遅延（これを超えたら強制フラッシュ）。 */
export const AUTOSAVE_MAX_DELAY_MS = 10000;
/** 保存失敗時のリトライ間隔（最大 3 回）。 */
export const AUTOSAVE_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 9000];

// ===== ゴミ箱（06_file_io_persistence.md §7、B9） =====

// data-model-persistence.md 13.3 節：trashRetentionDays の既定は 30 <!-- req datamodelpersistence:51e9b06f.ef31 -->
export const DEFAULT_TRASH_RETENTION_DAYS = 30;

// ===== ミラー同期（data-model-persistence.md §9.6、B26） =====

/** 終了時にミラーコピー完了を待つタイムアウト。 */
export const MIRROR_AWAIT_PENDING_TIMEOUT_MS = 15000;
