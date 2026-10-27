/**
 * IPC 契約（要求と応答の型・チャンネルの名前の表）の共有型。アダプタのインターフェースは packages/core/src/platform。
 *
 * 対応詳細設計: 型だけを置く決まりは web-core-foundation.md 5.1 節、IPC の決まりは同 6.3 節。チャンネルの一覧と要求・応答の型は、
 * それを使う機能の詳細設計（ファイル I/O は data-model-persistence.md 10.1 節、ログとクラッシュは error-logging-foundation.md、
 * ウィンドウは screens-navigation.md）に書く。
 * この型群は apps/desktop（main / preload / renderer）と packages/core の三者から共有される。
 * packages/core は本パッケージにのみ依存してよく、electron には依存しない（レイヤー依存規則）。
 */
// <!-- req webcorefoundation:80691f16.bc97 --> <!-- req webcorefoundation:51f9abc1.dbd7 --> <!-- req webcorefoundation:51f9abc1.55da --> <!-- req webcorefoundation:da091b67.1eb9 --> <!-- req webcorefoundation:da091b67.f0f2 --> <!-- req webcorefoundation:da091b67.42ff --> <!-- req webcorefoundation:47306a52.941c -->
// <!-- req webcorefoundation:9fb56b6a.83d4 --> <!-- req webcorefoundation:d6bb5408.6c07 --> <!-- req webcorefoundation:d6bb5408.1081 -->

// ===== エラー・ログ基盤の IPC 越え型（error-logging-foundation.md §2、B32） =====
//
// NotificationCenter は Webコア（レンダラー）側シングルトン、Logger は main プロセス側。
// 両者を `log:append` IPC で結ぶため、渡り合う値の形をここ（IPC 契約の単一の真実源）に置く。
// packages/core の errors/types.ts はこれらを re-export する（型の二重定義を避ける）。

/** 4 段階メッセージレベル（08_error_logging.md §1）。 */
export type NotificationLevel = 'info' | 'warning' | 'error' | 'critical';

/** 表示チャンネル。`NotificationLevel` から機械的に導出される（呼び出し側は指定しない）。 */
export type NotificationChannel = 'toast' | 'highlight' | 'modal';

/** `NotificationCenter.report()` が発行し、購読側／ログへ渡る 1 件のイベント。 */
export interface NotificationEvent {
  level: NotificationLevel;
  channel: NotificationChannel;
  code: string;
  message: string;
  context?: Record<string, unknown>;
  /** 発行時刻（ISO 8601）。 */
  timestamp: string;
}

/** 永続ログ 1 行（`app-YYYYMMDD.log`）。 */
export interface LogEntry {
  timestamp: string;
  level: NotificationLevel;
  code: string;
  message: string;
  context?: Record<string, unknown>;
  /** Error / Critical のときのみ付くスタックトレース。 */
  stack?: string;
}

/** `crash:getRecoveryState` の応答（error-logging-foundation.md §2.3・§3.2）。 */
export interface CrashRecoveryState {
  /** 直前にレンダラークラッシュからの復旧が行われた（未消費）。→ レンダラーが SYS-001 を発行する。 */
  recovered: boolean;
  /** 同一セッションでの累積クラッシュが閾値（3）に達している。→ レンダラーが SYS-002 を発行する。 */
  repeatedCrash: boolean;
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

/** window チャンネル（screens-navigation.md §4.1、electron.rule.md IPC 規約。文字列直書き禁止）。 */
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
// data-model-persistence.md 10.1 節：appconfig:* の群の名前と要求と応答の型は、fs:* と同じく packages/shared-types に置き、既存の 5 つを変えずに足す <!-- req datamodelpersistence:546d1515.a458 --> <!-- req datamodelpersistence:546d1515.f153 --> <!-- req datamodelpersistence:546d1515.ff5d --> <!-- req datamodelpersistence:546d1515.00b7 -->
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
} as const;

export type AppConfigChannel = (typeof APP_CONFIG_CHANNELS)[keyof typeof APP_CONFIG_CHANNELS];

/**
 * エラー・ログ基盤用チャンネル（error-logging-foundation.md §2、B32、非破壊追加）。
 * renderer の `NotificationCenter` → main の `Logger` へイベントを渡す `log:append` と、
 * 起動時にクラッシュ復旧状態を引く `crash:getRecoveryState`。
 */
export const LOG_CHANNELS = {
  /** NotificationEvent 1 件を main の Logger.append へ転送する（fire-and-forget 的、応答 void）。 */
  append: 'log:append',
} as const;

export type LogChannel = (typeof LOG_CHANNELS)[keyof typeof LOG_CHANNELS];

export const CRASH_CHANNELS = {
  /** レンダラー起動時にクラッシュ復旧状態（未消費フラグ）を取得し、消費する。 */
  getRecoveryState: 'crash:getRecoveryState',
} as const;

export type CrashChannel = (typeof CRASH_CHANNELS)[keyof typeof CRASH_CHANNELS];

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
  };
  /** エラー・ログ基盤（B32）。`log` は Webコアの NotificationCenter が結線する（renderer bootstrap）。 */
  log: {
    /** NotificationEvent を main の Logger へ転送する。ログ失敗を UI へ伝播させないため reject は握り潰す。 */
    append(event: NotificationEvent): Promise<void>;
  };
  crash: {
    /** 起動時に一度呼び、クラッシュ復旧状態を取得する（main 側で未消費フラグをクリアする）。 */
    getRecoveryState(): Promise<CrashRecoveryState>;
  };
  /** 複数ウィンドウ管理（screens-navigation.md §4.1）。renderer は songId を渡すだけで、生成・重複防止は main 側。 */
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
  };
}
// <!-- req webcorefoundation:3319b335.ae7b --> <!-- req webcorefoundation:3319b335.df52 --> <!-- req webcorefoundation:ae026fc8.4677 -->
