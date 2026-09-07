/**
 * IPC 契約とプラットフォーム抽象の共有型。
 *
 * 対応詳細設計: web-core-foundation.md §4（IPC契約）・§3.2（FileSystemAdapter 最小版）。
 * この型群は apps/desktop（main / preload / renderer）と packages/core の三者から共有される。
 * packages/core は本パッケージにのみ依存してよく、electron には依存しない（レイヤー依存規則）。
 */

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

// ===== FileSystemAdapter 最小契約（web-core-foundation.md §3.2） =====

/**
 * 設定されたストレージルート配下での最小限のファイル I/O。
 * アトミック書き込み・自動保存デバウンス・ゴミ箱操作・保存先切替は
 * 次パッケージ「データモデル・永続化」が本インターフェースを非破壊拡張する。
 */
export interface FileSystemAdapter {
  /** ルート相対パスのファイルを読む。存在しなければ FileNotFoundError。 */
  readFile(relativePath: string): Promise<Uint8Array>;
  /** ルート相対パスへ書き込む。失敗（権限等）は FileWriteError。本パッケージはリトライしない。 */
  writeFile(relativePath: string, data: Uint8Array): Promise<void>;
  /** ルート相対パスのディレクトリ内容を一覧する。 */
  listDirectory(relativePath: string): Promise<DirEntry[]>;
  /** ルート相対パスのディレクトリを（親ごと）用意する。既存でもエラーにしない。 */
  ensureDirectory(relativePath: string): Promise<void>;
  /** 現在のストレージルートの絶対パスを返す。設定から差し替え可能な拡張点。 */
  getRootPath(): string;
}

// ===== IPC チャンネル（web-core-foundation.md §4.1） =====

/**
 * renderer → main（invoke）の fs チャンネル名。すべて ipcRenderer.invoke / ipcMain.handle。
 * 文字列リテラルを散らさないための単一の真実源。
 */
export const FS_CHANNELS = {
  readFile: 'fs:readFile',
  writeFile: 'fs:writeFile',
  listDirectory: 'fs:listDirectory',
  ensureDirectory: 'fs:ensureDirectory',
  getRootPath: 'fs:getRootPath',
} as const;

export type FsChannel = (typeof FS_CHANNELS)[keyof typeof FS_CHANNELS];

// --- リクエストペイロード（web-core-foundation.md §4.1 の「ペイロード概要」列） ---

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

// --- レスポンス ---

export type FsReadFileResponse = Uint8Array;
export type FsWriteFileResponse = void;
export type FsListDirectoryResponse = DirEntry[];
export type FsEnsureDirectoryResponse = void;
export type FsGetRootPathResponse = string;

// ===== preload が renderer に公開する API（web-core-foundation.md §3.4） =====

/**
 * window.riffLineApi の型。preload の contextBridge.exposeInMainWorld で公開される
 * 型安全ラッパーのみ。Node.js API や Electron モジュールそのものは公開しない。
 *
 * getRootPath は IPC 往復のため Promise を返す（FileSystemAdapter の同期版とは別物。
 * renderer 側はブートストラップ時に一度だけ取得してキャッシュする想定）。
 */
export interface RiffLineApi {
  fs: {
    readFile(relativePath: string): Promise<Uint8Array>;
    writeFile(relativePath: string, data: Uint8Array): Promise<void>;
    listDirectory(relativePath: string): Promise<DirEntry[]>;
    ensureDirectory(relativePath: string): Promise<void>;
    getRootPath(): Promise<string>;
  };
}
