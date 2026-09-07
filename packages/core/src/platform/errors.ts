/**
 * ファイル I/O の軽量エラークラス（web-core-foundation.md §3.2）。
 *
 * FileSystemAdapter の実装（apps/desktop の ElectronFileSystemAdapter）が、Node 固有のエラー
 * （ENOENT / EACCES 等）をこれらに変換してから Webコアへ渡す。Webコアに Node のエラーオブジェクトを漏らさない。
 * これらはアプリのエラーコード体系（RENDER-001 等、00_reference.md §5）とは別物の、実装内部の型。
 */

/** 存在しないパスへの readFile / listDirectory で送出される。 */
export class FileNotFoundError extends Error {
  /** 判別用の安定した識別子。 */
  readonly code = 'FILE_NOT_FOUND' as const;
  /** 対象のルート相対パス。 */
  readonly path: string;

  constructor(path: string, options?: ErrorOptions) {
    super(`File not found: ${path}`, options);
    this.name = 'FileNotFoundError';
    this.path = path;
    // トランスパイル後も instanceof が機能するようにする。
    Object.setPrototypeOf(this, FileNotFoundError.prototype);
  }
}

/**
 * 読み取り失敗（権限不足 EACCES・対象がディレクトリ EISDIR・パスの一部が非ディレクトリ ENOTDIR 等、
 * 「存在しない」以外の理由）で送出される。`FileWriteError` と対称。
 * 生の Node エラーを Webコアへ漏らさないための正規化先（electron.rule.md「エラー変換」）。
 */
export class FileReadError extends Error {
  readonly code = 'FILE_READ_FAILED' as const;
  readonly path: string;

  constructor(path: string, options?: ErrorOptions) {
    super(`Failed to read: ${path}`, options);
    this.name = 'FileReadError';
    this.path = path;
    Object.setPrototypeOf(this, FileReadError.prototype);
  }
}

/** 書き込み失敗（権限不足・ディスク等）で送出される。呼び出し元がリトライ判断を行う。 */
export class FileWriteError extends Error {
  readonly code = 'FILE_WRITE_FAILED' as const;
  readonly path: string;

  constructor(path: string, options?: ErrorOptions) {
    super(`Failed to write file: ${path}`, options);
    this.name = 'FileWriteError';
    this.path = path;
    Object.setPrototypeOf(this, FileWriteError.prototype);
  }
}
