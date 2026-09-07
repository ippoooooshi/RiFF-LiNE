/**
 * IPC 契約とプラットフォーム抽象の共有型。
 *
 * 対応詳細設計: web-core-foundation.md §4（IPC契約・最小版）、data-model-persistence.md §3.3〜§3.4・§3.3.1（拡張）。
 * この型群は apps/desktop（main / preload / renderer）と packages/core の三者から共有される。
 * packages/core は本パッケージにのみ依存してよく、electron には依存しない（レイヤー依存規則）。
 */

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

// ===== ディレクトリ一覧の要素（web-core-foundation.md §3.2） =====

/** listDirectory が返す 1 エントリ。 */
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

// ===== FileSystemAdapter 契約（web-core-foundation.md §3.2 + data-model-persistence.md §3.3） =====

/**
 * 設定された 1 つのストレージルート配下でのファイル I/O。
 *
 * 最小版（`readFile`〜`getRootPath`）は「Webコア基盤構築」で確定。
 * 「データモデル・永続化」が `renameFile`／`deleteFile`／`copyFile`／`exists` を
 * **非破壊追加**する（既存メソッドのシグネチャは変更しない）。
 * アトミック書き込み・自動保存デバウンス・ゴミ箱・保存先切替のロジック自体は
 * 呼び出し元（persistence 層のサービス）が本インターフェースの組み合わせで実現する。
 */
export interface FileSystemAdapter {
  /** ルート相対パスのファイルを読む。存在しなければ FileNotFoundError。読み取り失敗は FileReadError。 */
  readFile(relativePath: string): Promise<Uint8Array>;
  /** ルート相対パスへ書き込む。失敗（権限等）は FileWriteError。本メソッド自体はリトライしない。 */
  writeFile(relativePath: string, data: Uint8Array): Promise<void>;
  /** ルート相対パスのディレクトリ内容を一覧する。 */
  listDirectory(relativePath: string): Promise<DirEntry[]>;
  /** ルート相対パスのディレクトリを（親ごと）用意する。既存でもエラーにしない。 */
  ensureDirectory(relativePath: string): Promise<void>;
  /** 現在のストレージルートの絶対パスを返す。 */
  getRootPath(): string;

  // --- data-model-persistence.md §3.3 で非破壊追加 ---

  /**
   * ルート相対パスのファイル/ディレクトリを別のルート相対パスへ改名（移動）する。
   * アトミック書き込み（tmp→本ファイル）とゴミ箱への移動に使う。同一ルート内のみ。
   * 失敗は FileWriteError、移動元が存在しなければ FileNotFoundError。
   */
  renameFile(fromRelativePath: string, toRelativePath: string): Promise<void>;
  /** ルート相対パスのファイルを削除する。ゴミ箱の保持期間経過後の物理削除に使う。存在しなければ黙って成功。 */
  deleteFile(relativePath: string): Promise<void>;
  /** 同一ルート内でファイルを複製する。ミラー同期・ストレージ移行のコピーに使う。失敗は FileWriteError。 */
  copyFile(fromRelativePath: string, toRelativePath: string): Promise<void>;
  /** ルート相対パスにファイル/ディレクトリが存在するか。マイグレーション・初回起動時の確認に使う。 */
  exists(relativePath: string): Promise<boolean>;
}

/**
 * 任意の絶対パスをルートとする FileSystemAdapter を生成するファクトリ（data-model-persistence.md §3.3）。
 * ミラー同期（複数ミラー先）・ストレージ移行（移行元/移行先）が複数ルートへ同時アクセスするために必要。
 * 同一ルートに対しては同じインスタンスを返してよい（実装側でキャッシュする）。
 */
export interface FileSystemAdapterFactory {
  createForRoot(absoluteRootPath: string): FileSystemAdapter;
}

// ===== AppLocalConfigService 契約（data-model-persistence.md §3.4） =====

/**
 * 主ストレージが未確定な初回起動時も参照できる、OS 標準アプリ設定フォルダ上のポインタ情報。
 * ストレージ抽象（FileSystemAdapter）の外側に置く小さな契約。
 */
export interface StorageRootPointer {
  /** 現在のアクティブストレージルートの絶対パス（`{...}/TabApp` の親、すなわち選択されたフォルダ）。 */
  rootAbsolutePath: string;
  /** ルートの種別。UI 表示・候補検出のヒントに使う。 */
  storageType: 'local' | 'icloud' | 'gdrive' | 'custom';
}

/**
 * OS 標準アプリ設定フォルダ上の storage-pointer.json を読み書きする。
 * 初回起動時（ポインタ未作成）は readPointer() が null を返し、呼び出し元はローカル既定へフォールバックする。
 */
export interface AppLocalConfigService {
  readPointer(): Promise<StorageRootPointer | null>;
  writePointer(pointer: StorageRootPointer): Promise<void>;
}

// ===== IPC チャンネル =====

/**
 * renderer → main（invoke）の fs チャンネル名。すべて ipcRenderer.invoke / ipcMain.handle。
 * 文字列リテラルを散らさないための単一の真実源。
 *
 * `readFile`〜`getRootPath` の 5 本は web-core-foundation.md §4.1 で確定（**変更しない**）。
 * `*At` の 8 本は data-model-persistence.md §3.3.1（B31）でルート指定付きとして非破壊追加。
 */
export const FS_CHANNELS = {
  // --- 単一（アクティブ）ルート用（web-core-foundation.md §4.1、不変） ---
  readFile: 'fs:readFile',
  writeFile: 'fs:writeFile',
  listDirectory: 'fs:listDirectory',
  ensureDirectory: 'fs:ensureDirectory',
  getRootPath: 'fs:getRootPath',
  // --- ルート指定付き（data-model-persistence.md §3.3.1、B31） ---
  readFileAt: 'fs:readFileAt',
  writeFileAt: 'fs:writeFileAt',
  listDirectoryAt: 'fs:listDirectoryAt',
  ensureDirectoryAt: 'fs:ensureDirectoryAt',
  renameFileAt: 'fs:renameFileAt',
  deleteFileAt: 'fs:deleteFileAt',
  copyFileAt: 'fs:copyFileAt',
  existsAt: 'fs:existsAt',
} as const;

export type FsChannel = (typeof FS_CHANNELS)[keyof typeof FS_CHANNELS];

/** AppLocalConfigService 用チャンネル（data-model-persistence.md §3.3.1）。 */
export const APP_CONFIG_CHANNELS = {
  readPointer: 'appconfig:readPointer',
  writePointer: 'appconfig:writePointer',
  /** 初回起動時の既定アクティブルート解決（ポインタ先、なければ `{userData}/TabApp`）。 */
  getActiveRoot: 'appconfig:getActiveRoot',
  /**
   * LocalBackupService 用の端末ローカル専用ルート（`{userData}/LocalBackup`）の絶対パス。
   * 主ストレージ・ミラー先とは切り離す（B25、data-model-persistence.md §3.2）。
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

// --- リクエストペイロード（単一ルート、web-core-foundation.md §4.1 の「ペイロード概要」列） ---

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

// --- リクエストペイロード（ルート指定付き、data-model-persistence.md §3.3.1） ---

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

/** appconfig:writePointer のペイロード。read/getActiveRoot はペイロードなし。 */
export interface AppConfigWritePointerRequest {
  pointer: StorageRootPointer;
}

// --- レスポンス ---

export type FsReadFileResponse = Uint8Array;
export type FsWriteFileResponse = void;
export type FsListDirectoryResponse = DirEntry[];
export type FsEnsureDirectoryResponse = void;
export type FsGetRootPathResponse = string;
export type FsExistsResponse = boolean;
export type AppConfigReadPointerResponse = StorageRootPointer | null;
export type AppConfigGetActiveRootResponse = string;

// ===== preload が renderer に公開する API（web-core-foundation.md §3.4 + data-model-persistence.md §3.3.1） =====

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
}

/**
 * window.riffLineApi の型。preload の contextBridge.exposeInMainWorld で公開される
 * 型安全ラッパーのみ。Node.js API や Electron モジュールそのものは公開しない。
 *
 * - `fs`: 単一（アクティブ）ルート用。web-core-foundation.md の最小シェル互換のため維持。
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
}
