/**
 * 永続化レイヤーの定数（data-model-persistence.md §3・§5・§6・§9、06_file_io_persistence.md §3）。
 * マジックナンバーを散らさず、実機検証（A5 等）での調整点を 1 箇所に集約する。
 */

// ===== ディレクトリ構造（06_file_io_persistence.md §3。ルート = `{アクティブルート}/TabApp`） =====

export const SONGS_DIR = 'songs';
export const TRASH_DIR = 'trash';
export const LOGS_DIR = 'logs';
export const SONG_FILE_EXT = '.tabapp';
/** アトミック書き込みの一時ファイル拡張子（05 §5）。 */
export const TMP_SUFFIX = '.tmp';

export const INDEX_FILE = 'index.json';
export const TRASH_INDEX_FILE = 'trash-index.json';
export const TUNING_PRESETS_FILE = 'tuning-presets.json';
export const TAGS_FILE = 'tags.json';
export const STORAGE_SETTINGS_FILE = 'settings.json';
/** AppPreferencesService（画面群パッケージ）管轄。移行対象に含む（G16）。 */
export const PREFERENCES_FILE = 'preferences.json';

/**
 * ストレージ移行のコピー対象（data-model-persistence.md §5）。
 * `logs/` は C14 により含めない。`songs/`・`trash/` はフォルダごと走査してコピーする。
 */
export const MIGRATION_TARGET_FILES: readonly string[] = [
  INDEX_FILE,
  TRASH_INDEX_FILE,
  TUNING_PRESETS_FILE,
  TAGS_FILE,
  STORAGE_SETTINGS_FILE,
  PREFERENCES_FILE,
];

// ===== 自動保存（data-model-persistence.md §9.1、要件5.2） =====

/** デバウンス間隔。 */
export const AUTOSAVE_DEBOUNCE_MS = 3000;
/** 連続編集時の最大遅延（これを超えたら強制フラッシュ）。 */
export const AUTOSAVE_MAX_DELAY_MS = 10000;
/** 保存失敗時のリトライ間隔（最大 3 回）。 */
export const AUTOSAVE_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 9000];

// ===== ゴミ箱（06_file_io_persistence.md §7、B9） =====

export const DEFAULT_TRASH_RETENTION_DAYS = 30;

// ===== ミラー同期（data-model-persistence.md §9.6、B26） =====

/** 終了時にミラーコピー完了を待つタイムアウト。 */
export const MIRROR_AWAIT_PENDING_TIMEOUT_MS = 15000;
