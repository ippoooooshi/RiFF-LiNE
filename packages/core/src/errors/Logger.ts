/**
 * `NotificationCenter` が発行する全イベントを永続ログとして記録する（error-logging-foundation.md 2.2 節、 <!-- req errorloggingfoundation:982e378a.6b64 -->
 * 08_error_logging.md 2 節）。`NotificationCenter` の一機能ではなく独立したクラスで、`LogSink` を実装する。 <!-- req errorloggingfoundation:97a6de7b.74d4 -->
 * ログの組み立て（レベル・書式）は行わず、受け取った `LogEntry` を書き出すだけ（組み立ては `toLogEntry`、2.4 節）。 <!-- req errorloggingfoundation:982e378a.f345 --> <!-- req 00:04f6cd00.f345 -->
 *
 * - 通常ログ：`logs/app-YYYYMMDD.log`（日次ローテーション、1 行 1 JSON の追記）。
 * - クラッシュログ：`logs/crash-YYYYMMDD-HHMMSS.log`（1 行目に理由と検知時刻、2 行目から直近の記録）。
 * - 容量の枠：通常ログとクラッシュログを分けず 1 つの枠で、`logs/` の合計が上限を超えたら <!-- req errorloggingfoundation:de33091f.e158 --> <!-- req errorloggingfoundation:de33091f.d6fb -->
 *   最終更新の古いファイルから、種類を区別せずに消す（2.2 節の「容量の枠」、B8）。
 *
 * プロセス配置（2.4 節、B32）：本クラスは main プロセス側で、ルート解決済みの `FileSystemAdapter` を注入して使う。
 * `FileSystemAdapter` に追記 API は無いため read → concat → write で 1 行足し、内部の直列化キューで 1 件ずつ処理する。
 */

import type { DirEntry } from '@riff-line/shared-types';

import type { LogEntry, LogSink } from './types';

/**
 * Logger が使うファイル I/O のメソッドだけを並べた形。渡すのは `FileSystemAdapter`（packages/core/src/platform）で、 <!-- req errorloggingfoundation:982e378a.9dbf -->
 * `FileSystemAdapter` はこの形をそのまま満たす。errors からは platform を import しない決まり <!-- req errorloggingfoundation:982e378a.f046 -->
 * （web-core-foundation.md 2.1 節・2.2 節の errors の行）なので、型の名前ではなく形で受け取る。 <!-- req errorloggingfoundation:982e378a.9f54 -->
 */
// <!-- req errorloggingfoundation:982e378a.e104 --> <!-- req errorloggingfoundation:982e378a.3684 -->
export interface LogFileStore {
  // <!-- req errorloggingfoundation:982e378a.7bec -->
  readFile(relativePath: string): Promise<Uint8Array>;
  // <!-- req errorloggingfoundation:982e378a.94df -->
  writeFile(relativePath: string, data: Uint8Array): Promise<void>;
  // <!-- req errorloggingfoundation:982e378a.93ff -->
  listDirectory(relativePath: string): Promise<DirEntry[]>;
  // <!-- req errorloggingfoundation:982e378a.c8b0 -->
  ensureDirectory(relativePath: string): Promise<void>;
  // <!-- req errorloggingfoundation:982e378a.81e2 -->
  deleteFile(relativePath: string): Promise<void>;
  // <!-- req errorloggingfoundation:982e378a.793e -->
  getRootPath(): string;
}

/**
 * `logs/` フォルダ名（権威は 06_file_io_persistence.md 3 節）。`persistence/constants.ts` の `LOGS_DIR` と
 * 同値だが、依存方向を persistence → errors の一方向に保つ（errors は基盤側で persistence を import しない）
 * ため、この 1 語だけは意図的に両モジュールに持つ。値を変える場合は両方＋設計書を同時に直す。
 */
// <!-- req datamodelpersistence:182df8f4.073c -->
const DEFAULT_LOGS_DIR = 'logs';

/** 通常ログ＋クラッシュログ合算のフォルダ容量上限（08_error_logging.md 2 節、error-logging-foundation.md 2.4 節、B8）。10MB。 */
// <!-- req errorloggingfoundation:e8eddb7c.e6ef --> <!-- req 00:04f6cd00.6772 -->
export const DEFAULT_LOG_QUOTA_BYTES = 10 * 1024 * 1024;

const encoder = new TextEncoder();

export interface LoggerOptions {
  /** 現在時刻。テストで固定するために注入可能（既定 `() => new Date()`）。 */
  now?: () => Date;
  /** ログフォルダ名（既定 `'logs'`）。 */
  logsDir?: string;
}

// <!-- req errorloggingfoundation:e8eddb7c.6be2 -->
// <!-- req errorloggingfoundation:3dbcd071.9e5f -->
// <!-- req errorloggingfoundation:eff8188b.a922 -->
// 00_reference.md 3 節：LogSink を実装する <!-- req 00:04f6cd00.36d8 -->
export class Logger implements LogSink {
  /** 書き先。保存先を動いている途中で変えたときは `setStore` で替える（2.4 節の `Logger` の行、K1）。 */
  private adapter: LogFileStore;
  private readonly now: () => Date;
  private readonly logsDir: string;
  /**
   * 直列化キュー。`FileSystemAdapter` に追記 API が無く append は read→concat→write のため、
   * 並行呼び出しが互いの読みを踏むと行が失われる／順序が乱れる。前の append の完了に連結して
   * 1 件ずつ処理する（`report()` が連続で呼ばれても行が欠けない）。
   */
  // <!-- req 00:04f6cd00.1206 -->
  private appendChain: Promise<void> = Promise.resolve();

  // <!-- req errorloggingfoundation:8157cf58.53fc -->
  constructor(adapter: LogFileStore, options: LoggerOptions = {}) {
    this.adapter = adapter;
    this.now = options.now ?? ((): Date => new Date());
    this.logsDir = options.logsDir ?? DEFAULT_LOGS_DIR;
  }

  /**
   * 1 件のログ行を当日のログファイルへ追記する（`LogSink.append`）。呼び出し順に直列化される。
   * 失敗しても例外を投げない（ログ記録が本処理を巻き込まない、2.2 節）。
   */
  // <!-- req errorloggingfoundation:982e378a.039e --> <!-- req 00:04f6cd00.039e -->
  // <!-- req errorloggingfoundation:05b392ec.8aca --> <!-- req errorloggingfoundation:29b6f717.8b42 --> <!-- req errorloggingfoundation:29b6f717.f76e --> <!-- req errorloggingfoundation:29b6f717.14a4 -->
  append(entry: LogEntry): Promise<void> {
    // 書き先は呼んだ時点のものを使う。setStore の前に積んだ行は、前の書き先に書く。
    // <!-- req errorloggingfoundation:982e378a.141b --> <!-- req 00:04f6cd00.141b -->
    const store = this.adapter;
    // doAppend は失敗を中で受けて常に解決するので、1 件の失敗が後続を巻き込まない。
    // <!-- req errorloggingfoundation:a7ca21c6.273f -->
    const run = this.appendChain.then(() => this.doAppend(store, entry));
    this.appendChain = run;
    return run;
  }

  /** 直列化キューが空になるまで待つ（アプリ終了処理・テストでのログ書き切り用）。 */
  // <!-- req errorloggingfoundation:f15bb8e9.137d --> <!-- req errorloggingfoundation:f15bb8e9.15ae --> <!-- req 00:04f6cd00.752f -->
  async flush(): Promise<void> {
    // <!-- req errorloggingfoundation:f15bb8e9.6dac --> <!-- req 00:04f6cd00.da3d -->
    await this.appendChain;
  }

  /**
   * 書き先を替える（error-logging-foundation.md 2.2 節・2.4 節の `Logger` の行、2026-10-29 本人決定 K1）。保存先を動いている途中で変えたとき、
   * main が `shared:changed` の `storage` の知らせを受けて、新しい主ストレージのアダプタ（その `logs/`）を渡す。
   * これより後の `append`・`writeCrashLog`・`enforceQuota`・`getLogFolderAbsolutePath` は新しい書き先を使う。
   * 直列化のキューはそのまま続くので、替える前と後の行の順は崩れない。
   */
  // <!-- req errorloggingfoundation:982e378a.27a3 --> <!-- req 00:04f6cd00.27a3 -->
  setStore(store: LogFileStore): void {
    // <!-- req errorloggingfoundation:982e378a.3cad --> <!-- req 00:04f6cd00.3cad -->
    this.adapter = store;
  }

  /** append 1 件分の実処理（read→concat→write）。直列化は append() が担う。失敗は中で受けて投げない。 */
  private async doAppend(store: LogFileStore, entry: LogEntry): Promise<void> {
    try {
      // <!-- req errorloggingfoundation:e8eddb7c.68d3 --> <!-- req errorloggingfoundation:cb83deb6.a60d -->
      // <!-- req errorloggingfoundation:c7e9e456.a6ab -->
      const path = `${this.logsDir}/app-${dateStamp(this.now())}.log`;
      await store.ensureDirectory(this.logsDir);
      // <!-- req errorloggingfoundation:cb83deb6.598b -->
      const existing = await readIfExists(store, path);
      // <!-- req errorloggingfoundation:982e378a.355a --> <!-- req errorloggingfoundation:cb83deb6.308d --> <!-- req 00:04f6cd00.355a -->
      // <!-- req errorloggingfoundation:a7ca21c6.a998 -->
      const next = concatLine(existing, JSON.stringify(entry));
      await store.writeFile(path, next);
    } catch (error) {
      console.error('[Logger] append failed:', error);
    }
  }

  /**
   * クラッシュログを 1 ファイルとして書き出す（`logs/crash-YYYYMMDD-HHMMSS.log`、2.2 節の「クラッシュログの書式」）。
   * 1 行目にクラッシュ理由（`render-process-gone` の `details.reason`）と検知時刻、2 行目以降に `recentBuffer` の
   * `LogEntry` を渡された順（古い順）に 1 行 1 JSON で並べる。失敗しても投げない。
   */
  // <!-- req errorloggingfoundation:982e378a.55df --> <!-- req 00:04f6cd00.55df -->
  // <!-- req errorloggingfoundation:ec50c85a.0a15 -->
  async writeCrashLog(reason: string, recentBuffer: LogEntry[]): Promise<void> {
    const at = this.now();
    // <!-- req errorloggingfoundation:cb83deb6.3e7e -->
    // <!-- req errorloggingfoundation:c7e9e456.fcca -->
    const path = `${this.logsDir}/crash-${dateTimeStamp(at)}.log`;
    const lines = [
      // <!-- req errorloggingfoundation:1b09eb9e.e213 --> <!-- req errorloggingfoundation:1b09eb9e.97df -->
      JSON.stringify({ kind: 'crash', reason, at: at.toISOString(), bufferedEvents: recentBuffer.length }),
      // <!-- req errorloggingfoundation:1b09eb9e.656c --> <!-- req errorloggingfoundation:1b09eb9e.2ba3 -->
      ...recentBuffer.map((entry) => JSON.stringify(entry)),
    ];
    try {
      await this.adapter.ensureDirectory(this.logsDir);
      await this.adapter.writeFile(path, encoder.encode(`${lines.join('\n')}\n`));
    } catch (error) {
      console.error('[Logger] writeCrashLog failed:', error);
    }
  }

  /**
   * `logs/` フォルダの合計サイズが `maxTotalBytes` を超えていたら、最終更新が古いファイルから
   * 上限以下になるまで削除する（起動時に 1 回呼ぶ、3.3 節）。通常ログとクラッシュログを区別しない。失敗しても投げない。
   */
  // <!-- req errorloggingfoundation:982e378a.d462 --> <!-- req 00:04f6cd00.d462 -->
  async enforceQuota(maxTotalBytes: number): Promise<void> {
    try {
      const entries = await this.readLogDirEntries();
      const files = entries
        // app・crash の種別を問わず全部のファイルを数える <!-- req 00:04f6cd00.ea30 -->
        .filter((entry) => !entry.isDirectory)
        // <!-- req errorloggingfoundation:982e378a.9155 --> <!-- req errorloggingfoundation:de33091f.d1d9 --> <!-- req 00:04f6cd00.39c0 -->
        .sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt)); // 古い順

      // <!-- req errorloggingfoundation:de33091f.2232 -->
      let total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
      for (const file of files) {
        if (total <= maxTotalBytes) break;
        await this.adapter.deleteFile(`${this.logsDir}/${file.name}`);
        total -= file.sizeBytes;
      }
    } catch (error) {
      console.error('[Logger] enforceQuota failed:', error);
    }
  }

  /**
   * ログフォルダの絶対パス（設定ダイアログ「アプリ情報」からエクスプローラーで開く用、2.2 節）。
   */
  // <!-- req errorloggingfoundation:982e378a.4d2f --> <!-- req 00:04f6cd00.4d2f -->
  getLogFolderAbsolutePath(): string {
    const root = this.adapter.getRootPath().replace(/[\\/]+$/, '');
    return `${root}/${this.logsDir}`;
  }

  // ===== 内部ヘルパー =====

  /** `logs/` の一覧。フォルダ未作成なら空。 */
  private async readLogDirEntries(): Promise<
    { name: string; isDirectory: boolean; sizeBytes: number; modifiedAt: string }[]
  > {
    try {
      return await this.adapter.listDirectory(this.logsDir);
    } catch (error) {
      if (isFileNotFound(error)) return [];
      throw error;
    }
  }
}

/** `Date` → ローカル日付 `YYYYMMDD`。 */
export function dateStamp(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

/** `Date` → ローカル日時 `YYYYMMDD-HHMMSS`。 */
export function dateTimeStamp(date: Date): string {
  return `${dateStamp(date)}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ファイルがあれば内容を、無ければ空配列を返す。FileNotFound 以外は再送出。 */
async function readIfExists(store: LogFileStore, path: string): Promise<Uint8Array> {
  try {
    return await store.readFile(path);
  } catch (error) {
    if (isFileNotFound(error)) return new Uint8Array(0);
    throw error;
  }
}

/** 既存バイト列に 1 行（+ 改行）を足したバイト列を返す。 */
function concatLine(existing: Uint8Array, line: string): Uint8Array {
  const addition = encoder.encode(`${line}\n`);
  if (existing.length === 0) return addition;
  const merged = new Uint8Array(existing.length + addition.length);
  merged.set(existing, 0);
  merged.set(addition, existing.length);
  return merged;
}

/** platform/errors.ts の FileNotFoundError（code:'FILE_NOT_FOUND'）か。モジュール循環を避け code で判定。 */
function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'FILE_NOT_FOUND';
}
