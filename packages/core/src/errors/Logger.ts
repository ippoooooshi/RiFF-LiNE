/**
 * `NotificationCenter` が発行する全イベントを永続ログとして記録する（error-logging-foundation.md §2.2、
 * 08_error_logging.md §2）。`LogSink` を実装する。
 *
 * - 通常ログ：`logs/app-YYYYMMDD.log`（日次ローテーション、1 行 1 JSON の追記）。
 * - クラッシュログ：`logs/crash-YYYYMMDD-HHMMSS.log`（直前バッファ＋理由）。
 * - クォータ：`logs/` フォルダ合計サイズが上限を超えたら最終更新の古いファイルから削除
 *   （通常ログ・クラッシュログの種別を問わない。B8）。
 *
 * プロセス配置（B32）：本クラスは main プロセス側で、`FileSystemAdapterFactory` がアクティブルート用に
 * 解決した `FileSystemAdapter` を注入して使う。`FileSystemAdapter` に追記 API は無いため read → concat →
 * write で 1 行足す（個人利用規模・ログ行の頻度からして許容。将来のボトルネックなら追記 IPC を足す）。
 */

import type { FileSystemAdapter } from '@riff-line/shared-types';

import type { LogEntry, LogSink, NotificationEvent } from './types';

/**
 * `logs/` フォルダ名（権威は [[06_file_io_persistence.md#3]]）。`persistence/constants.ts` の `LOGS_DIR` と
 * 同値だが、依存方向を persistence → errors の一方向に保つ（errors は基盤側で persistence を import しない）
 * ため、この 1 語だけは意図的に両モジュールに持つ。値を変える場合は両方＋設計書を同時に直す。
 */
const DEFAULT_LOGS_DIR = 'logs';

/** 通常ログ＋クラッシュログ合算のフォルダ容量上限（08_error_logging.md §2、B8）。10MB。 */
export const DEFAULT_LOG_QUOTA_BYTES = 10 * 1024 * 1024;

const encoder = new TextEncoder();

export interface LoggerOptions {
  /** 現在時刻。テストで固定するために注入可能（既定 `() => new Date()`）。 */
  now?: () => Date;
  /** ログフォルダ名（既定 `'logs'`）。 */
  logsDir?: string;
}

export class Logger implements LogSink {
  private readonly adapter: FileSystemAdapter;
  private readonly now: () => Date;
  private readonly logsDir: string;
  /**
   * 直列化キュー。`FileSystemAdapter` に追記 API が無く append は read→concat→write のため、
   * 並行呼び出しが互いの読みを踏むと行が失われる／順序が乱れる。前の append の完了に連結して
   * 1 件ずつ処理する（`report()` が連続で呼ばれても行が欠けない）。
   */
  private appendChain: Promise<void> = Promise.resolve();

  constructor(adapter: FileSystemAdapter, options: LoggerOptions = {}) {
    this.adapter = adapter;
    this.now = options.now ?? ((): Date => new Date());
    this.logsDir = options.logsDir ?? DEFAULT_LOGS_DIR;
  }

  /**
   * 1 件のログ行を当日のログファイルへ追記する（`LogSink.append`）。呼び出し順に直列化される。
   * 失敗しても例外を投げない（ログ記録が本処理を巻き込まない、§2.2）。
   */
  append(entry: LogEntry): Promise<void> {
    const run = this.appendChain.then(() => this.doAppend(entry));
    // チェーン自身は常に解決で継続させる（1 件の失敗が後続を巻き込まない）。
    this.appendChain = run.catch(() => undefined);
    return run;
  }

  /** 直列化キューが空になるまで待つ（アプリ終了処理・テストでのログ書き切り用）。 */
  async flush(): Promise<void> {
    await this.appendChain;
  }

  /** append 1 件分の実処理（read→concat→write）。直列化は append() が担う。 */
  private async doAppend(entry: LogEntry): Promise<void> {
    const path = `${this.logsDir}/app-${dateStamp(this.now())}.log`;
    try {
      await this.adapter.ensureDirectory(this.logsDir);
      const existing = await this.readIfExists(path);
      const next = concatLine(existing, JSON.stringify(entry));
      await this.adapter.writeFile(path, next);
    } catch (error) {
      console.error('[Logger] append failed:', error);
    }
  }

  /**
   * クラッシュログを 1 ファイルとして書き出す（`logs/crash-YYYYMMDD-HHMMSS.log`、§2.2）。
   * 1 行目に理由、以降に直近バッファのイベントを 1 行 1 JSON で並べる。失敗しても投げない。
   */
  async writeCrashLog(reason: string, recentBuffer: NotificationEvent[]): Promise<void> {
    const at = this.now();
    const path = `${this.logsDir}/crash-${dateTimeStamp(at)}.log`;
    const lines = [
      JSON.stringify({ kind: 'crash', reason, at: at.toISOString(), bufferedEvents: recentBuffer.length }),
      ...recentBuffer.map((event) => JSON.stringify(event)),
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
   * 上限以下になるまで削除する（起動時に 1 回呼ぶ、§3.3）。失敗しても投げない。
   */
  async enforceQuota(maxTotalBytes: number): Promise<void> {
    try {
      const entries = await this.readLogDirEntries();
      const files = entries
        .filter((entry) => !entry.isDirectory)
        .sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt)); // 古い順

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
   * ログフォルダの絶対パス（設定ダイアログ「アプリ情報」からエクスプローラーで開く用、§2.2）。
   */
  getLogFolderAbsolutePath(): string {
    const root = this.adapter.getRootPath().replace(/[\\/]+$/, '');
    return `${root}/${this.logsDir}`;
  }

  // ===== 内部ヘルパー =====

  /** ファイルがあれば内容を、無ければ空配列を返す。FileNotFound 以外は再送出。 */
  private async readIfExists(path: string): Promise<Uint8Array> {
    try {
      return await this.adapter.readFile(path);
    } catch (error) {
      if (isFileNotFound(error)) return new Uint8Array(0);
      throw error;
    }
  }

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
