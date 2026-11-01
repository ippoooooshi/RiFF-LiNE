/**
 * IPC 契約（要求と応答の型・チャンネルの名前の表）の共有型。アダプタのインターフェースは packages/core/src/platform。
 *
 * 対応詳細設計: 型だけを置く決まりは web-core-foundation.md 5.1 節、IPC の決まりは同 6.3 節。チャンネルの一覧と要求・応答の型は、
 * それを使う機能の詳細設計（ファイル I/O は data-model-persistence.md 10.1 節、ログとクラッシュは error-logging-foundation.md、
 * ウィンドウは screens-navigation.md）に書く。
 * この型群は apps/desktop（main / preload / renderer）と packages/core の三者から共有される。
 * packages/core は本パッケージにのみ依存してよく、electron には依存しない（レイヤー依存規則）。
 */
// <!-- req webcorefoundation:80691f16.bc97 --> <!-- req webcorefoundation:51f9abc1.dbd7 --> <!-- req webcorefoundation:51f9abc1.55da --> <!-- req webcorefoundation:da091b67.1eb9 --> <!-- req webcorefoundation:da091b67.f0f2 --> <!-- req webcorefoundation:da091b67.42ff --> <!-- req webcorefoundation:57e560c8.941c -->
// <!-- req webcorefoundation:9fb56b6a.83d4 --> <!-- req webcorefoundation:d6bb5408.6c07 --> <!-- req webcorefoundation:d6bb5408.1081 -->

// ===== エラー・ログ基盤の IPC 越え型（error-logging-foundation.md 2.4 節、B32） =====
//
// NotificationCenter は Webコア（レンダラー）側シングルトン、Logger は main プロセス側。
// 両者を `log:append` IPC で結ぶため、渡り合う値の形をここ（IPC 契約の単一の真実源）に置く。
// packages/core の errors/types.ts はこれらを re-export する（型の二重定義を避ける）。

/** 4 段階メッセージレベル（08_error_logging.md 1 節）。 */
export type NotificationLevel = 'info' | 'warning' | 'error' | 'critical';

/** 表示チャンネル。`NotificationLevel` から機械的に導出される（呼び出し側は指定しない）。 */
export type NotificationChannel = 'toast' | 'highlight' | 'modal';

/** Critical のモーダルのボタンの文言（error-logging-foundation.md 2.1 節。肯定・否定をはっきりさせ、「OK」だけにしない）。 <!-- req errorloggingfoundation:36b6ffa1.f33f --> */
export interface NotificationButtons {
  /** 肯定のボタン（「復元する」「閉じる」など、ボタンが 1 つのときはこれだけ）。 */
  confirm: string;
  /** 否定のボタン（「キャンセル」）。ボタンが 1 つのときは無い。 */
  cancel?: string;
}

/** `NotificationCenter.report()` が発行し、購読側／ログへ渡る 1 件のイベント（error-logging-foundation.md 2.1 節）。 */
// <!-- req errorloggingfoundation:d6cfbf9d.940d -->
// <!-- req errorloggingfoundation:920e31e8.f381 -->
export interface NotificationEvent {
  // <!-- req errorloggingfoundation:d6cfbf9d.6c30 -->
  level: NotificationLevel;
  // <!-- req errorloggingfoundation:d6cfbf9d.c37a -->
  channel: NotificationChannel;
  // <!-- req errorloggingfoundation:d6cfbf9d.1218 -->
  code: string;
  // <!-- req errorloggingfoundation:d6cfbf9d.160b -->
  message: string;
  // <!-- req errorloggingfoundation:d6cfbf9d.2ee0 -->
  context?: Record<string, unknown>;
  /** 発行時刻（ISO 8601）。 */
  // <!-- req errorloggingfoundation:d6cfbf9d.114e -->
  timestamp: string;
  /** 画面に出すか。そのコードの `ErrorCodeDefinition.showOnScreen`（省略時 `true`）。表示の受け手が見る。 */
  // <!-- req errorloggingfoundation:d6cfbf9d.eedb -->
  showOnScreen: boolean;
  /** Critical のモーダルの見出し（定義の `title`）。 */
  title?: string;
  /** Critical のモーダルのボタンの文言（定義の `buttons`）。 */
  buttons?: NotificationButtons;
  /** Error／Critical のときだけ `report()` が取るスタックトレース（error-logging-foundation.md 2.2 節）。 */
  // <!-- req errorloggingfoundation:d6cfbf9d.2bc2 -->
  stack?: string;
}

/** 永続ログ 1 行（`app-YYYYMMDD.log`）。 */
// <!-- req errorloggingfoundation:920e31e8.91ae -->
export interface LogEntry {
  // <!-- req errorloggingfoundation:b3b0064a.9464 -->
  timestamp: string;
  // <!-- req errorloggingfoundation:b3b0064a.4255 -->
  level: NotificationLevel;
  // <!-- req errorloggingfoundation:b3b0064a.95c1 -->
  code: string;
  // <!-- req errorloggingfoundation:b3b0064a.9df8 -->
  message: string;
  /** 文脈情報。省略できない（error-logging-foundation.md 2.2 節の表で `?` が付くのは `stack` だけ）。`report()` に文脈が無ければ `{}`。 */
  // <!-- req errorloggingfoundation:b3b0064a.9d2a -->
  context: Record<string, unknown>;
  /** Error / Critical のときのみ付くスタックトレース。 */
  // <!-- req errorloggingfoundation:b3b0064a.0c41 -->
  stack?: string;
}

/** `crash:getRecoveryState` の応答（error-logging-foundation.md 2.3 節・3.2 節）。 */
// <!-- req errorloggingfoundation:920e31e8.847f -->
export interface CrashRecoveryState {
  /** 直前にレンダラークラッシュからの復旧が行われた（未消費）。→ レンダラーが SYS-001 を発行する。 */
  recovered: boolean;
  /** その窓の、同一セッションでの累積クラッシュが閾値（3）に達している。→ レンダラーが SYS-002 を発行する。 */
  repeatedCrash: boolean;
  /** ログフォルダの場所（`Logger.getLogFolderAbsolutePath()` の値）。レンダラーは SYS-002 の `context.logFolder` に入れる（error-logging-foundation.md 2.3 節・2.4 節）。 */
  // <!-- req errorloggingfoundation:c7d54f51.833b -->
  logFolder: string;
}

// ===== ディレクトリ一覧の要素（fs:listDirectory の応答。data-model-persistence.md 10.1 節） =====

/** listDirectory が返す 1 エントリ。 */
// data-model-persistence.md 10.1 節：DirEntry の欄は name・isDirectory・sizeBytes・modifiedAt <!-- req datamodelpersistence:14be17e9.6cef --> <!-- req datamodelpersistence:14be17e9.68b3 --> <!-- req datamodelpersistence:14be17e9.af37 --> <!-- req datamodelpersistence:14be17e9.3d05 -->
export interface DirEntry {
  /** エントリ名（パスではなくバスネーム）。 */
  name: string;
  /** ディレクトリなら true、通常ファイルなら false。 */
  isDirectory: boolean;
  /** ファイルサイズ（バイト）。ディレクトリは 0。 */
  sizeBytes: number;
  /** 最終更新時刻（ISO 8601 文字列）。 */
  modifiedAt: string;
}

// アダプタのインターフェース（FileSystemAdapter・FileSystemAdapterFactory・WindowAdapter ほか）は
// packages/core/src/platform に置く（web-core-foundation.md 3.1 節）。本パッケージには IPC の要求と応答の型と
// チャンネルの名前の表だけを置く（5.1 節）。

// ===== ローカル既定パスの settings.json のポインタの値（appconfig:* の要求と応答、data-model-persistence.md 10.1 節・13.2 節） =====

/**
 * 主ストレージが未確定な初回起動時も参照できる、OS 標準アプリ設定フォルダ上のポインタ情報。
 * ストレージ抽象（FileSystemAdapter）の外側に置く小さな契約。
 */
// data-model-persistence.md 13.2 節：StorageRootPointer は rootAbsolutePath と storageType を持つ <!-- req datamodelpersistence:5a55a4ad.770d --> <!-- req datamodelpersistence:5a55a4ad.5f97 -->
export interface StorageRootPointer {
  /** 現在のアクティブストレージルートの絶対パス（`{...}/TabApp` の親、すなわち選択されたフォルダ）。 */
  rootAbsolutePath: string;
  /** ルートの種別。UI 表示・候補検出のヒントに使う。 */
  storageType: 'local' | 'icloud' | 'gdrive' | 'custom';
}

/** window チャンネル（screens-navigation.md 4.1 節、electron.rule.md IPC 規約。文字列直書き禁止）。 */
// <!-- req errorloggingfoundation:95edc1b7.9497 -->
export const WINDOW_CHANNELS = {
  // 6.3 節：チャンネルの名前と要求と応答の型はここ。チャンネルの一覧は使う機能の詳細設計に書く <!-- req webcorefoundation:9f49b930.692a --> <!-- req webcorefoundation:9f49b930.976c --> <!-- req webcorefoundation:9f49b930.1b19 --> <!-- req webcorefoundation:9f49b930.9c00 -->
  /** renderer→main（invoke）：曲一覧ウィンドウから編集ウィンドウを開く（重複時は前面化）。 */
  openSong: 'window:openSong',
  /** renderer→main（invoke）：曲一覧ウィンドウを開く / 前面化する。 */
  openSongList: 'window:openSongList',
  /**
   * main→renderer（send）：編集ウィンドウのクローズ確定前に自動保存の flush を要求する。
   * renderer は flush 完了後 `flushAutoSaveAck` を返す。応答が来ない場合 main はタイムアウトで先へ進む。
   */
  flushAutoSaveRequest: 'window:flushAutoSaveRequest',
  /** renderer→main（invoke）：`flushAutoSaveRequest` に対する flush 完了通知（token で対応付け。6.3 節の invoke の決まり）。 */
  flushAutoSaveAck: 'window:flushAutoSaveAck',
  /**
   * renderer→main（invoke）：描画の例外の代わりの画面の「画面を開き直す」（error-logging-foundation.md 2.4 節・2.5 節、2026-10-14 本人決定）。
   * 要求も応答も無し。main は送り手の窓を `CrashRecoveryController.reloadAfterRenderError` で読み込み直す。
   */
  // <!-- req errorloggingfoundation:1e60ecd7.7178 -->
  reloadAfterRenderError: 'window:reloadAfterRenderError',
} as const;

export type WindowChannel = (typeof WINDOW_CHANNELS)[keyof typeof WINDOW_CHANNELS];

export interface WindowOpenSongRequest {
  songId: string;
}

/** `flushAutoSaveRequest` のペイロード（main→renderer）。 */
export interface WindowFlushAutoSaveRequest {
  /** 対象の曲 ID。 */
  songId: string;
  /** 応答対応付け用の一意トークン。 */
  token: number;
}

/** `flushAutoSaveAck` のペイロード（renderer→main）。 */
export interface WindowFlushAutoSaveAck {
  token: number;
}

// ===== IPC チャンネル =====

/**
 * renderer → main（invoke）の fs チャンネル名。すべて ipcRenderer.invoke / ipcMain.handle。
 * 文字列リテラルを散らさないための単一の真実源。
 *
 * `readFile`〜`getRootPath` の 5 本は data-model-persistence.md 10.1 節の (b) で、名前と要求と応答の型を変えずに残す（**変更しない**）。
 * チャンネルの一覧は使う機能の詳細設計に書き、web-core-foundation.md には持たない（6.3 節）。
 * `*At` の 9 本は data-model-persistence.md 10.1 節の (b)（B31 の (c)）でルート指定付きとして別に足した
 * （`fs:readFileAt` から `fs:existsAt` までと `fs:removeEmptyDirectoryAt`）。
 */
export const FS_CHANNELS = {
  // --- 単一（アクティブ）ルート用（data-model-persistence.md 10.1 節、不変） ---
  // data-model-persistence.md 10.1 節：単一のルートを前提にした既存の 5 つ（fs:readFile・fs:writeFile・fs:listDirectory・fs:ensureDirectory・fs:getRootPath）は名前と要求と応答の型を変えずに残す <!-- req datamodelpersistence:cd9bc9db.ad32 --> <!-- req datamodelpersistence:cd9bc9db.548e --> <!-- req datamodelpersistence:cd9bc9db.c910 --> <!-- req datamodelpersistence:cd9bc9db.ed6b --> <!-- req datamodelpersistence:cd9bc9db.29b2 --> <!-- req datamodelpersistence:cd9bc9db.44fc -->
  readFile: 'fs:readFile',
  writeFile: 'fs:writeFile',
  listDirectory: 'fs:listDirectory',
  ensureDirectory: 'fs:ensureDirectory',
  getRootPath: 'fs:getRootPath',
  // --- ルート指定付き（data-model-persistence.md 10.1 節の (b)、B31） ---
  // <!-- req datamodelpersistence:cd9bc9db.6d8f -->
  // <!-- req datamodelpersistence:cd9bc9db.f160 -->
  readFileAt: 'fs:readFileAt',
  writeFileAt: 'fs:writeFileAt',
  listDirectoryAt: 'fs:listDirectoryAt',
  ensureDirectoryAt: 'fs:ensureDirectoryAt',
  renameFileAt: 'fs:renameFileAt',
  deleteFileAt: 'fs:deleteFileAt',
  copyFileAt: 'fs:copyFileAt',
  existsAt: 'fs:existsAt',
  /** 空のフォルダを消す（data-model-persistence.md 10.1 節の removeEmptyDirectory、2026-10-27 本人決定）。 */
  // <!-- req datamodelpersistence:cd9bc9db.d933 -->
  removeEmptyDirectoryAt: 'fs:removeEmptyDirectoryAt',
} as const;

export type FsChannel = (typeof FS_CHANNELS)[keyof typeof FS_CHANNELS];

/** AppLocalConfigService 用チャンネル（data-model-persistence.md 10.1 節の (b)）。 */
// data-model-persistence.md 10.1 節：appconfig:* の群の名前と要求と応答の型は、fs:* と同じく packages/shared-types に置き、既存の 5 つを変えずに足す <!-- req datamodelpersistence:31a0c1dc.a458 --> <!-- req datamodelpersistence:31a0c1dc.f153 --> <!-- req datamodelpersistence:31a0c1dc.ff5d --> <!-- req datamodelpersistence:31a0c1dc.00b7 -->
export const APP_CONFIG_CHANNELS = {
  readPointer: 'appconfig:readPointer',
  writePointer: 'appconfig:writePointer',
  /** 初回起動時の既定アクティブルート解決（ポインタ先、なければ `{userData}/TabApp`）。 */
  getActiveRoot: 'appconfig:getActiveRoot',
  /**
   * LocalBackupService 用の端末ローカル専用ルート（`{userData}/LocalBackup`）の絶対パス。
   * 主ストレージ・ミラー先とは切り離す（B25、data-model-persistence.md 20 節）。
   */
  getLocalBackupRoot: 'appconfig:getLocalBackupRoot',
  /**
   * 曲のファイルを新しい版へ変換する前の版を置く `PreMigration/`（`{userData}/PreMigration`、`LocalBackup/` と並ぶ）の絶対パス
   * （data-model-persistence.md 8 節・10.1 節・13.2 節、2026-10-27 本人決定、honnin-queue 206 番）。
   */
  // <!-- req datamodelpersistence:31a0c1dc.e03e -->
  getPreMigrationRoot: 'appconfig:getPreMigrationRoot',
  /**
   * ゴミ箱で完全に消した曲の `window-bounds.json` の 1 件を消させる（data-model-persistence.md 10.1 節・13.2 節・17 節の (b)、
   * 2026-10-28 本人決定、honnin-queue 216 番）。要求は曲の `id`、応答は無し。main が一時ファイルからの改名で書く（15 節）。
   */
  // <!-- req datamodelpersistence:31a0c1dc.865e -->
  deleteWindowBounds: 'appconfig:deleteWindowBounds',
  /**
   * 起動のときの片付けを始めてよいかを引く（data-model-persistence.md 10.1 節・17 節の (b)、2026-10-28）。要求は無し、応答は真偽。
   * アプリを起動してから初めて呼ばれたときだけ `true`、2 回目からは `false`（印は main のプロセスの中に持つ）。
   */
  // <!-- req datamodelpersistence:31a0c1dc.7b48 -->
  claimStartupCleanup: 'appconfig:claimStartupCleanup',
} as const;

export type AppConfigChannel = (typeof APP_CONFIG_CHANNELS)[keyof typeof APP_CONFIG_CHANNELS];

/**
 * エラー・ログ基盤用チャンネル（error-logging-foundation.md 2.4 節、B32、非破壊追加）。
 * renderer の `NotificationCenter` → main の `Logger` へ記録を渡す `log:append` と、
 * 起動時にクラッシュ復旧状態を引く `crash:getRecoveryState`。
 */
// <!-- req errorloggingfoundation:9bdae783.3ebc -->
export const LOG_CHANNELS = {
  /**
   * renderer→main（invoke）：renderer が `toLogEntry` で組み立てた `LogEntry` 1 件を渡す。main は組み立てず、
   * そのまま `Logger.append` と `LogRingBuffer.push` に渡す（error-logging-foundation.md 2.4 節）。応答なし。
   */
  // <!-- req errorloggingfoundation:9bdae783.f9bb -->
  append: 'log:append',
} as const;

export type LogChannel = (typeof LOG_CHANNELS)[keyof typeof LOG_CHANNELS];

export const CRASH_CHANNELS = {
  /** レンダラー起動時にクラッシュ復旧状態（未消費フラグ）を取得し、消費する。 */
  // <!-- req errorloggingfoundation:9bdae783.794a -->
  getRecoveryState: 'crash:getRecoveryState',
} as const;

export type CrashChannel = (typeof CRASH_CHANNELS)[keyof typeof CRASH_CHANNELS];

/**
 * フリーズ（応答なし）からの復帰の知らせ（error-logging-foundation.md 2.3 節・2.4 節）。
 * main→renderer（`webContents.send`）で、中身は無し。renderer の `errorLoggingBootstrap` が受けて `SYS-003` を出す。
 */
export const FREEZE_CHANNELS = {
  /** `responsive` を受けた main が、その窓の renderer へ送る。 */
  // <!-- req errorloggingfoundation:1e60ecd7.c741 --> <!-- req errorloggingfoundation:1e60ecd7.5f64 -->
  recovered: 'freeze:recovered',
} as const;

export type FreezeChannel = (typeof FREEZE_CHANNELS)[keyof typeof FREEZE_CHANNELS];

/** アプリ全体の頼み（error-logging-foundation.md 2.4 節）。 */
export const APP_CHANNELS = {
  /**
   * renderer→main（invoke）：`Logger.getLogFolderAbsolutePath()` のフォルダを `shell.openPath` で開く。要求も応答も無し。
   * 設定ダイアログの「アプリ情報」からだけ呼ぶ（`SYS-002` のダイアログからは呼ばない、2026-10-10 是正）。
   */
  // <!-- req errorloggingfoundation:8521749a.1a84 -->
  openLogFolder: 'app:openLogFolder',
} as const;

export type AppChannel = (typeof APP_CHANNELS)[keyof typeof APP_CHANNELS];

/**
 * main で出たエラーの知らせ（error-logging-foundation.md 2.4 節・2.6 節、2026-10-29 本人決定 K5）。
 * main→renderer（`webContents.send`）で、中身は `NotificationEvent`。送る処理と受け口は後の区切りで作る。
 */
// <!-- req errorloggingfoundation:8521749a.bb01 -->
export const NOTIFY_CHANNELS = {
  /** main の `MainErrorLogger` が、画面に出す記録を開いている窓の全部へ送る。 */
  // <!-- req errorloggingfoundation:a955fbc5.e3e2 --> <!-- req errorloggingfoundation:a955fbc5.1d0c -->
  fromMain: 'notify:fromMain',
} as const;

export type NotifyChannel = (typeof NOTIFY_CHANNELS)[keyof typeof NOTIFY_CHANNELS];

/**
 * 窓が共有のファイルを変えたときの知らせ（web-core-foundation.md 6.3 節、2026-10-29 本人決定 K1）。
 * 変えた窓が renderer→main（invoke）で送り、main は送った窓を除く全部の窓へ main→renderer（`webContents.send`）で同じ名前で配る。
 * 何が変わったかだけを送り、ファイルの中身は送らない。送った窓は、受けた窓の読み直しを待たない。
 */
export const SHARED_CHANNELS = {
  changed: 'shared:changed',
} as const;

export type SharedChannel = (typeof SHARED_CHANNELS)[keyof typeof SHARED_CHANNELS];

/**
 * `SharedChangeNotice` のうち、`id` を持たない `kind`（data-model-persistence.md 12 節・13.1 節、screens-navigation.md 12.10 節）。
 * `trash`＝`trash-index.json`、`tuningPresets`＝`tuning-presets.json`、`tags`＝`tags.json`、`storage`＝`settings.json`
 * （主ストレージの切り替え。main では `Logger` の書き先も替える）、`storageLockStart`＝保存先の移行のロックの始め、
 * `storageLockEnd`＝ロックの終わり、`preferences`＝`preferences.json`。
 * ロックの始めと終わりは `kind` で分け、知らせに欄は足さない（data-model-persistence.md 12 節）。
 */
// <!-- req datamodelpersistence:05f516bc.db46 -->
export const SHARED_CHANGE_KINDS_WITHOUT_ID = [
  'trash',
  'tuningPresets',
  'tags',
  'storage',
  'storageLockStart',
  'storageLockEnd',
  'preferences',
] as const;

/**
 * `shared:changed` の中身（web-core-foundation.md 6.3 節）。`song` は曲一覧の索引 `index.json` のその曲の行を変えたときで、
 * `id` はその曲の id（data-model-persistence.md 13.1 節）。
 */
export type SharedChangeNotice =
  { kind: 'song'; id: string } | { kind: (typeof SHARED_CHANGE_KINDS_WITHOUT_ID)[number] };

/**
 * ミラーの写しのチャンネル（data-model-persistence.md 14.1 節、2026-10-27 本人決定、honnin-queue 214 番）。
 * `MirrorSyncService` は main に置き、画面の `onSaved`（と曲一覧の「複製」、18 節）が保存した曲の id を知らせる。
 * main はミラー先を `StorageConfigService.load()` から引いて `syncAfterSave` で写す。写しは待たない（応答なし）。
 */
export const MIRROR_CHANNELS = {
  /** renderer→main（invoke）：保存した曲の写しを始めさせる。要求は `{ songId }`、応答なし。 */
  // <!-- req datamodelpersistence:ef984f9d.3e98 -->
  syncAfterSave: 'mirror:syncAfterSave',
} as const;

export type MirrorChannel = (typeof MIRROR_CHANNELS)[keyof typeof MIRROR_CHANNELS];

/** mirror:syncAfterSave のペイロード。 */
// <!-- req datamodelpersistence:ef984f9d.b023 -->
export interface MirrorSyncAfterSaveRequest {
  songId: string;
}
/** mirror:syncAfterSave は応答なし。 */
export type MirrorSyncAfterSaveResponse = void;

// --- リクエストペイロード（単一ルート、data-model-persistence.md 10.1 節） ---

export interface FsReadFileRequest {
  relativePath: string;
}
export interface FsWriteFileRequest {
  relativePath: string;
  data: Uint8Array;
}
export interface FsListDirectoryRequest {
  relativePath: string;
}
export interface FsEnsureDirectoryRequest {
  relativePath: string;
}
/** fs:getRootPath はペイロードなし。 */
export type FsGetRootPathRequest = undefined;

// --- リクエストペイロード（ルート指定付き、data-model-persistence.md 10.1 節の (b)） ---
// data-model-persistence.md 10.1 節：既存の 5 つの要求に rootPath を足す形にせず、fs:*At の要求を別の型として足す <!-- req datamodelpersistence:cd9bc9db.440a -->

export interface FsReadFileAtRequest {
  rootPath: string;
  relativePath: string;
}
export interface FsWriteFileAtRequest {
  rootPath: string;
  relativePath: string;
  data: Uint8Array;
}
export interface FsListDirectoryAtRequest {
  rootPath: string;
  relativePath: string;
}
export interface FsEnsureDirectoryAtRequest {
  rootPath: string;
  relativePath: string;
}
export interface FsRenameFileAtRequest {
  rootPath: string;
  fromRelativePath: string;
  toRelativePath: string;
}
export interface FsDeleteFileAtRequest {
  rootPath: string;
  relativePath: string;
}
export interface FsCopyFileAtRequest {
  rootPath: string;
  fromRelativePath: string;
  toRelativePath: string;
}
export interface FsExistsAtRequest {
  rootPath: string;
  relativePath: string;
}
export interface FsRemoveEmptyDirectoryAtRequest {
  rootPath: string;
  relativePath: string;
}

/** appconfig:writePointer のペイロード。 */
export interface AppConfigWritePointerRequest {
  pointer: StorageRootPointer;
}
/** appconfig:readPointer はペイロードなし。 */
export type AppConfigReadPointerRequest = undefined;
/** appconfig:getActiveRoot はペイロードなし。 */
export type AppConfigGetActiveRootRequest = undefined;
/** appconfig:getLocalBackupRoot はペイロードなし。 */
export type AppConfigGetLocalBackupRootRequest = undefined;
/** appconfig:getPreMigrationRoot はペイロードなし。 */
export type AppConfigGetPreMigrationRootRequest = undefined;
/** appconfig:deleteWindowBounds のペイロード（消す 1 件の曲の id）。 */
// <!-- req datamodelpersistence:31a0c1dc.301e -->
export interface AppConfigDeleteWindowBoundsRequest {
  songId: string;
}
/** appconfig:claimStartupCleanup はペイロードなし。 */
// <!-- req datamodelpersistence:31a0c1dc.5d6d -->
export type AppConfigClaimStartupCleanupRequest = undefined;

// --- レスポンス（fs:* と fs:*At は、同じメソッドなら同じ応答の型） ---

export type FsReadFileResponse = Uint8Array;
export type FsWriteFileResponse = void;
export type FsListDirectoryResponse = DirEntry[];
export type FsEnsureDirectoryResponse = void;
export type FsGetRootPathResponse = string;
export type FsRenameFileResponse = void;
export type FsDeleteFileResponse = void;
export type FsCopyFileResponse = void;
export type FsExistsResponse = boolean;
export type FsRemoveEmptyDirectoryResponse = void;
export type AppConfigReadPointerResponse = StorageRootPointer | null;
export type AppConfigWritePointerResponse = void;
export type AppConfigGetActiveRootResponse = string;
export type AppConfigGetLocalBackupRootResponse = string;
export type AppConfigGetPreMigrationRootResponse = string;
// <!-- req datamodelpersistence:31a0c1dc.1ccb -->
export type AppConfigDeleteWindowBoundsResponse = void;
// <!-- req datamodelpersistence:31a0c1dc.210e -->
export type AppConfigClaimStartupCleanupResponse = boolean;

// ===== preload が renderer に公開する API（web-core-foundation.md 3.1 節・6.3 節。チャンネルごとの中身は使う機能の詳細設計） =====

/** 1 つのルートに対する fs 操作（ルートは呼び出し側が rootPath で指定する）。 */
export interface RiffLineFsAtApi {
  readFile(rootPath: string, relativePath: string): Promise<Uint8Array>;
  writeFile(rootPath: string, relativePath: string, data: Uint8Array): Promise<void>;
  listDirectory(rootPath: string, relativePath: string): Promise<DirEntry[]>;
  ensureDirectory(rootPath: string, relativePath: string): Promise<void>;
  renameFile(rootPath: string, fromRelativePath: string, toRelativePath: string): Promise<void>;
  deleteFile(rootPath: string, relativePath: string): Promise<void>;
  copyFile(rootPath: string, fromRelativePath: string, toRelativePath: string): Promise<void>;
  exists(rootPath: string, relativePath: string): Promise<boolean>;
  removeEmptyDirectory(rootPath: string, relativePath: string): Promise<void>;
}

/**
 * window.riffLineApi の型。preload の contextBridge.exposeInMainWorld で公開される
 * 型安全ラッパーのみ。Node.js API や Electron モジュールそのものは公開しない。
 *
 * - `fs`: 単一（アクティブ）ルート用。data-model-persistence.md 10.1 節の (b) のとおり、名前と型を変えずに残す。
 * - `fsAt`: ルート指定付き。IpcFileSystemAdapter / IpcFileSystemAdapterFactory の土台（B31）。
 * - `appConfig`: AppLocalConfigService の IPC 経路 + 初回アクティブルート解決。
 */
export interface RiffLineApi {
  fs: {
    readFile(relativePath: string): Promise<Uint8Array>;
    writeFile(relativePath: string, data: Uint8Array): Promise<void>;
    listDirectory(relativePath: string): Promise<DirEntry[]>;
    ensureDirectory(relativePath: string): Promise<void>;
    getRootPath(): Promise<string>;
  };
  fsAt: RiffLineFsAtApi;
  appConfig: {
    readPointer(): Promise<StorageRootPointer | null>;
    writePointer(pointer: StorageRootPointer): Promise<void>;
    getActiveRoot(): Promise<string>;
    getLocalBackupRoot(): Promise<string>;
    /** `PreMigration/` の絶対パス（data-model-persistence.md 10.1 節、`appconfig:getPreMigrationRoot`）。 */
    getPreMigrationRoot(): Promise<string>;
    /** ゴミ箱で完全に消した曲の `window-bounds.json` の 1 件を消させる（10.1 節、`appconfig:deleteWindowBounds`）。 */
    deleteWindowBounds(songId: string): Promise<void>;
    /** アプリを起動してから初めての呼び出しだけ true（10.1 節・17 節の (b)、`appconfig:claimStartupCleanup`）。 */
    claimStartupCleanup(): Promise<boolean>;
  };
  /** エラー・ログ基盤（error-logging-foundation.md 2.4 節、B32）。renderer の `errorLoggingBootstrap` が結線する。 */
  log: {
    /** renderer が `toLogEntry` で組み立てた `LogEntry` を main の `Logger` へ渡す（`log:append`）。 */
    append(entry: LogEntry): Promise<void>;
  };
  crash: {
    /** 起動時に一度呼び、送り手の窓のクラッシュ復旧状態を取得する（main 側で未消費フラグをクリアする。`crash:getRecoveryState`）。 */
    getRecoveryState(): Promise<CrashRecoveryState>;
    /** フリーズからの復帰の知らせ（`freeze:recovered`、main→renderer）を購読する。戻り値で購読解除。 */
    onFreezeRecovered(handler: () => void): () => void;
  };
  /** アプリ全体の頼み（error-logging-foundation.md 2.4 節）。 */
  app: {
    /** ログのフォルダを OS のファイルの画面で開く（`app:openLogFolder`）。設定ダイアログの「アプリ情報」からだけ呼ぶ。 */
    openLogFolder(): Promise<void>;
  };
  /** 窓が共有のファイルを変えたときの知らせ（web-core-foundation.md 6.3 節、`shared:changed`）。 */
  shared: {
    /** 変えたことを main へ送る。main は送った窓を除く全部の窓へ配る。受けた窓の読み直しは待たない。 */
    notifyChanged(notice: SharedChangeNotice): Promise<void>;
    /** ほかの窓が送った知らせを購読する。戻り値で購読解除。 */
    onChanged(handler: (notice: SharedChangeNotice) => void): () => void;
  };
  /** ミラーの写し（data-model-persistence.md 14.1 節）。main の `MirrorSyncService` に保存した曲の写しを始めさせる。 */
  mirror: {
    /** 保存した曲の id を main に知らせる（`mirror:syncAfterSave`）。写しの終わりは待たない。 */
    syncAfterSave(songId: string): Promise<void>;
  };
  /** 複数ウィンドウ管理（screens-navigation.md 4.1 節）。renderer は songId を渡すだけで、生成・重複防止は main 側。 */
  windows: {
    /** 編集ウィンドウを開く（既に開いていれば前面化）。 */
    openSong(songId: string): Promise<void>;
    /** 曲一覧ウィンドウを開く / 前面化する。 */
    openSongList(): Promise<void>;
    /**
     * クローズ確定前の自動保存 flush 要求を購読する（main→renderer）。
     * ハンドラは flush 完了後に `ackFlushAutoSave(token)` を呼ぶ。戻り値で購読解除。
     */
    onFlushAutoSaveRequest(handler: (request: WindowFlushAutoSaveRequest) => void): () => void;
    /** `onFlushAutoSaveRequest` の要求に対する flush 完了を main へ通知する（invoke。web-core-foundation.md 6.3 節）。 */
    ackFlushAutoSave(token: number): Promise<void>;
    /** 描画の例外の代わりの画面の「画面を開き直す」で、この窓を読み込み直させる（`window:reloadAfterRenderError`、error-logging-foundation.md 2.5 節）。 */
    reloadAfterRenderError(): Promise<void>;
  };
}
// <!-- req webcorefoundation:3319b335.ae7b --> <!-- req webcorefoundation:3319b335.df52 --> <!-- req webcorefoundation:ae026fc8.4677 -->
