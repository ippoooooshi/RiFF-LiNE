// IT-ERR-LOG: error-logging-foundation.md 3.1 節・3.3 節・7 節・2.4 節 — Logger + NotificationCenter を実 I/O で結線
// 検証観点:
//  - NotificationCenter.report → LogSink(Logger) → 実ファイル（logs/app-YYYYMMDD.log）へ 1 行 1 JSON
//  - Logger.writeCrashLog が実ファイルを作る
//  - Logger.enforceQuota が実フォルダの合計サイズ超過時に古いファイルを消す
//  - registerLogHandlers 経由（renderer → main の往復）で Logger へ流れる
//  - Logger.append で上限を超えるまで書き、enforceQuota で古いファイルから消える（7 節の 1 つ目）
//  - 実物の SongRepository・SchemaMigrator が report() を呼び、4 節の表のコードとレベルでログに残り、モーダルへ届く（7 節の 2・3 つ目）
//  - render-process-gone 3 回 → crash:getRecoveryState が repeatedCrash を返す、フリーズの確認ダイアログ・「再読み込み」・
//    5 秒以内の復帰で freeze:recovered を送る、を main の CrashRecoveryController と実物の registerLogHandlers を偽の IPC でつないで見る
//  - 上の 2 つを renderer の errorLoggingBootstrap（実物）まで通し、SYS-002・SYS-003 が実際のログのファイルに残り、
//    SYS-002 がモーダルの口（NotificationUIBinder の modal）へ届く（7 節の 3・4 つ目）。main と renderer をまたぐので、
//    このファイルの型は DOM と node の両方を持つ tsconfig.integration.json で検査する（web-core-foundation.md 14.2 節）
//  - rename の前で止めた保存の後、次に開くと改名の前の版を読み .tmp を使わない（7 節の 5 つ目）

import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_LOG_QUOTA_BYTES,
  ErrorCodeRegistry,
  Logger,
  NotificationCenter,
  notificationCenter as sharedNotificationCenter,
  registerCoreErrorCodes,
  toLogEntry,
} from '@riff-line/core/errors';
import {
  ChecksumUtil,
  CorruptSongFileError,
  IntegrityCheckFailedError,
  LocalBackupService,
  PreMigrationService,
  SchemaMigrator,
  SongIndexService,
  SongRepository,
  UnsupportedSchemaVersionError,
  preMigrationFileName,
  songFilePath,
  songTmpFilePath,
} from '@riff-line/core/persistence';
import { NotificationUIBinder } from '@riff-line/core/ui';
import {
  CRASH_CHANNELS,
  FREEZE_CHANNELS,
  LOG_CHANNELS,
  NOTIFY_CHANNELS,
  type CrashRecoveryState,
  type LogEntry,
  type NotificationEvent,
  type RiffLineApi,
} from '@riff-line/shared-types';
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue, RenderProcessGoneDetails } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapErrorLogging, type UncaughtErrorTarget } from '../renderer/errorLoggingBootstrap';
import {
  CrashRecoveryController,
  FREEZE_CONFIRM_DELAY_MS,
  FREEZE_DIALOG_RELOAD_BUTTON,
} from './CrashRecoveryController';
import { ElectronFileSystemAdapter } from './ElectronFileSystemAdapter';
import { registerLogHandlers, type IpcMainLike } from './ipc';
import { LogRingBuffer } from './LogRingBuffer';

// 偽にするのは Electron の dialog（OS のネイティブダイアログ）だけ。CrashRecoveryController はこれ以外の Electron を使わない。
const showMessageBox = vi.hoisted(() =>
  vi.fn<(window: unknown, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>(),
);
vi.mock('electron', () => ({ dialog: { showMessageBox } }));

class FakeIpcMain implements IpcMainLike {
  private readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return Promise.resolve(handler({}, payload));
  }
}

let root: string;
let adapter: ElectronFileSystemAdapter;
let logger: Logger;
let notificationCenter: NotificationCenter;
const fixedNow = new Date(2026, 8, 8, 12, 0, 0);
const TODAY_LOG = 'app-20260908.log';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tabapp-errlog-'));
  adapter = new ElectronFileSystemAdapter(root, { retryOnDemandDownload: false });
  logger = new Logger(adapter, { now: () => fixedNow });

  const registry = new ErrorCodeRegistry();
  registerCoreErrorCodes(registry);
  notificationCenter = new NotificationCenter(registry, { logSink: logger });
});

/** 当日のログファイルの行を JSON として読む（無ければ空）。 */
async function readTodayLogEntries(): Promise<LogEntry[]> {
  let text: string;
  try {
    text = await readFile(join(root, 'logs', TODAY_LOG), 'utf8');
  } catch {
    return [];
  }
  return text
    .trimEnd()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LogEntry);
}

/** setImmediate を 1 回待ち、それまでに積まれた Promise の続きを流す（setTimeout は偽にすることがあるので使わない）。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 実 I/O のアダプタで組んだ SongRepository（data-model-persistence.md 15 節の部品を全部実物で）。 */
function makeRepository(): {
  repo: SongRepository;
  songs: ElectronFileSystemAdapter;
  preMigrationFolder: ElectronFileSystemAdapter;
} {
  const songs = new ElectronFileSystemAdapter(root, { retryOnDemandDownload: false });
  const migrator = new SchemaMigrator();
  const index = new SongIndexService(songs);
  const backup = new ElectronFileSystemAdapter(join(root, 'LocalBackup'), { retryOnDemandDownload: false });
  const localBackup = new LocalBackupService(songs, backup, migrator, index);
  const preMigrationFolder = new ElectronFileSystemAdapter(join(root, 'PreMigration'), {
    retryOnDemandDownload: false,
  });
  const preMigration = new PreMigrationService(preMigrationFolder);
  return { repo: new SongRepository(songs, migrator, index, localBackup, preMigration), songs, preMigrationFolder };
}

const START_URL = 'file:///app/index.html#edit/song-1';

/**
 * main の CrashRecoveryController を、実物の registerLogHandlers と偽の IPC でつなぐ。
 * 偽にするのは BrowserWindow（webContents のイベントと send・loadURL）と IPC の通り道だけ。
 * renderer に当たる側は、IPC で crash:getRecoveryState を引くことと、main から送られたチャンネルを受けることだけをする。
 */
function connectMain(): {
  window: BrowserWindow;
  emit: (channel: string, ...args: unknown[]) => void;
  loadURL: ReturnType<typeof vi.fn>;
  getRecoveryState: () => Promise<CrashRecoveryState>;
  sentToRenderer: string[];
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  onRenderer: (channel: string, listener: (...args: unknown[]) => void) => () => void;
} {
  const mainListeners = new Map<string, (...args: unknown[]) => void>();
  const sentToRenderer: string[] = [];
  // renderer 側の受け口（preload の ipcRenderer.on の代わり）。main が send したら、そのチャンネルの受け口へ渡す。
  const rendererListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const loadURL = vi.fn(() => Promise.resolve());
  const window = {
    id: 1,
    isDestroyed: () => false,
    webContents: {
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        mainListeners.set(channel, listener);
      },
      // main → renderer の通り道：送られたチャンネルを renderer が受けた順に残し、renderer の受け口へ渡す。
      send: (channel: string, ...args: unknown[]) => {
        sentToRenderer.push(channel);
        for (const listener of rendererListeners.get(channel) ?? []) listener(...args);
      },
      loadURL,
      getURL: () => START_URL,
    },
  } as unknown as BrowserWindow;

  const controller = new CrashRecoveryController({ getLogFolder: () => logger.getLogFolderAbsolutePath() });
  controller.attach(window);

  const ipc = new FakeIpcMain();
  registerLogHandlers<BrowserWindow>(ipc, {
    logger,
    ring: new LogRingBuffer(),
    senderWindow: () => window,
    crashRecovery: controller,
    openPath: () => Promise.resolve(''),
  });

  return {
    window,
    emit: (channel, ...args) => mainListeners.get(channel)?.(...args),
    loadURL,
    // renderer → main の通り道（preload の ipcRenderer.invoke の代わり）。
    getRecoveryState: async () => (await ipc.invoke(CRASH_CHANNELS.getRecoveryState)) as CrashRecoveryState,
    sentToRenderer,
    invoke: (channel, payload) => ipc.invoke(channel, payload),
    onRenderer: (channel, listener) => {
      const listeners = rendererListeners.get(channel) ?? new Set();
      listeners.add(listener);
      rendererListeners.set(channel, listeners);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * renderer の preload の呼び口（window.riffLineApi のうち errorLoggingBootstrap が使う所）を、偽の IPC の上に作る。
 * 中身は preload.ts と同じ：log.append と crash.getRecoveryState は invoke、freeze:recovered と notify:fromMain は受け口の登録。
 */
function preloadApi(link: ReturnType<typeof connectMain>): Pick<RiffLineApi, 'log' | 'crash' | 'notify'> {
  return {
    log: {
      append: async (entry) => {
        await link.invoke(LOG_CHANNELS.append, entry);
      },
    },
    crash: {
      getRecoveryState: async () => (await link.invoke(CRASH_CHANNELS.getRecoveryState)) as CrashRecoveryState,
      onFreezeRecovered: (handler) => link.onRenderer(FREEZE_CHANNELS.recovered, () => handler()),
    },
    notify: {
      onFromMain: (handler) =>
        link.onRenderer(NOTIFY_CHANNELS.fromMain, (event) => handler(event as NotificationEvent)),
    },
  };
}

/**
 * 読み込み直した renderer の起動（main.tsx と App.tsx の順）：実物の bootstrapErrorLogging を先に張り、続けて
 * 画面の受け手の NotificationUIBinder を同じ NotificationCenter につなぐ。renderer の NotificationCenter はログの受け手を持たず、
 * ログは bootstrapErrorLogging の転送（log:append）だけで main の Logger へ届く。
 */
function startRenderer(link: ReturnType<typeof connectMain>): {
  sinks: { toast: ReturnType<typeof vi.fn>; highlight: ReturnType<typeof vi.fn>; modal: ReturnType<typeof vi.fn> };
  stop: () => void;
} {
  const registry = new ErrorCodeRegistry();
  registerCoreErrorCodes(registry);
  const center = new NotificationCenter(registry);
  // window の代わり（未捕捉の例外の登録先）。このテストでは例外を投げない。
  const target: UncaughtErrorTarget = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const stopBootstrap = bootstrapErrorLogging({ center, api: preloadApi(link), target });
  const sinks = { toast: vi.fn(), highlight: vi.fn(), modal: vi.fn() };
  const stopBinder = new NotificationUIBinder(sinks).attach(center);
  return {
    sinks,
    stop: () => {
      stopBinder();
      stopBootstrap();
    },
  };
}

/** 戻りをテストから決められる showMessageBox。`abort` されたら cancelId（0）で解決する。 */
function deferDialog(): { answer: (response: number) => void } {
  let resolve: (value: MessageBoxReturnValue) => void = () => undefined;
  showMessageBox.mockImplementationOnce(
    (_window, options) =>
      new Promise<MessageBoxReturnValue>((r) => {
        resolve = r;
        options.signal?.addEventListener('abort', () => r({ response: 0, checkboxChecked: false }));
      }),
  );
  return { answer: (response) => resolve({ response, checkboxChecked: false }) };
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// <!-- req errorloggingfoundation:66afa770.1ee5 -->
// <!-- req errorloggingfoundation:59b936ac.8688 -->
describe('NotificationCenter + Logger (実 I/O)', () => {
  // <!-- req errorloggingfoundation:66afa770.59f5 -->
  // <!-- req errorloggingfoundation:c7e9e456.6b7b -->
  it('report_WritesJsonLineToTodayLogFile', async () => {
    notificationCenter.report('FILE-001', { songId: 's1' });
    notificationCenter.report('RENDER-001', { detail: 'x' });
    await logger.flush();

    const text = await readFile(join(root, 'logs', 'app-20260908.log'), 'utf8');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ code: 'FILE-001', level: 'error', context: { songId: 's1' } });
    expect(JSON.parse(lines[1]!)).toMatchObject({ code: 'RENDER-001' });
    // Error レベルは stack 付き（2.2 節）。
    expect(typeof JSON.parse(lines[0]!).stack).toBe('string');
  });

  it('writeCrashLog_CreatesCrashFileWithBuffer', async () => {
    notificationCenter.report('FILE-005', { songId: 's1' });
    const buffer: NotificationEvent[] = notificationCenter.getRecentBuffer(50);

    await logger.writeCrashLog('crashed', buffer.map(toLogEntry));

    const files = (await readdir(join(root, 'logs'))).filter((f) => f.startsWith('crash-'));
    expect(files).toEqual(['crash-20260908-120000.log']);
    const text = await readFile(join(root, 'logs', files[0]!), 'utf8');
    expect(JSON.parse(text.trimEnd().split('\n')[0]!)).toMatchObject({ kind: 'crash', reason: 'crashed' });
  });

  it('enforceQuota_OverBudget_DeletesOldestFilesFirst', async () => {
    await adapter.ensureDirectory('logs');
    // 古い順に app-20260906(6MB) / app-20260907(3MB) / app-20260908(3MB) = 12MB > 10MB。
    const big = (mb: number): Uint8Array => new Uint8Array(mb * 1024 * 1024);
    await writeFile(join(root, 'logs', 'app-20260906.log'), big(6));
    await new Promise((r) => setTimeout(r, 5));
    await writeFile(join(root, 'logs', 'app-20260907.log'), big(3));
    await new Promise((r) => setTimeout(r, 5));
    await writeFile(join(root, 'logs', 'app-20260908.log'), big(3));

    await logger.enforceQuota(DEFAULT_LOG_QUOTA_BYTES);

    const remaining = (await readdir(join(root, 'logs'))).sort();
    expect(remaining).toEqual(['app-20260907.log', 'app-20260908.log']);
  });

  it('registerLogHandlers_RoundTrip_FeedsLoggerAndRingBufferConsumer', async () => {
    // 2.4 節：renderer が toLogEntry で組み立てた LogEntry を log:append で送り、main はそのまま Logger と LogRingBuffer に渡す
    const ipc = new FakeIpcMain();
    const ring = new LogRingBuffer();
    registerLogHandlers(ipc, {
      logger,
      ring,
      senderWindow: () => null,
      crashRecovery: {
        consumeRecoveryState: () => ({ recovered: false, repeatedCrash: false, logFolder: join(root, 'logs') }),
        reloadAfterRenderError: () => undefined,
      },
      openPath: () => Promise.resolve(''),
    });

    notificationCenter.setLogSink(undefined);
    const events: NotificationEvent[] = [];
    notificationCenter.subscribe((event) => events.push(event));
    notificationCenter.report('FILE-005', { songId: 's1' });
    const entry = toLogEntry(events[0]!);
    await ipc.invoke('log:append', entry);
    await logger.flush();

    expect(ring.snapshot()).toEqual([entry]);
    const text = await readFile(join(root, 'logs', 'app-20260908.log'), 'utf8');
    expect(JSON.parse(text.trimEnd())).toEqual(entry);
  });

  // <!-- req errorloggingfoundation:66afa770.2451 -->
  // <!-- req errorloggingfoundation:66afa770.7f2c -->
  it('Logger_appendで上限を超えるまで書いた後_enforceQuotaが古い日のファイルから消す', async () => {
    // IT-ERR-LOG-05 error-logging-foundation.md 7 節：Logger.append() → ファイル生成 → enforceQuota() での削除までを 1 本で通す
    let now = new Date(2026, 8, 6, 12, 0, 0);
    const dayLogger = new Logger(adapter, { now: () => now });
    const pad = 'x'.repeat(2 * 1024 * 1024);
    const entry = (): LogEntry => ({
      timestamp: now.toISOString(),
      level: 'warning',
      code: 'FILE-005',
      message: 'ミラー先への保存に失敗しました（主保存は正常です）',
      context: { pad },
    });
    // 1 日 2 行（約 4MB）を 3 日分 = 約 12MB。日ごとに最終更新の時刻をずらす。
    for (const day of [6, 7, 8]) {
      now = new Date(2026, 8, day, 12, 0, 0);
      await dayLogger.append(entry());
      await dayLogger.append(entry());
      await new Promise((r) => setTimeout(r, 20));
    }
    const written = (await readdir(join(root, 'logs'))).sort();
    expect(written).toEqual(['app-20260906.log', 'app-20260907.log', 'app-20260908.log']);
    const sizeOf = async (name: string): Promise<number> => (await stat(join(root, 'logs', name))).size;
    const totalBefore = (await Promise.all(written.map(sizeOf))).reduce((a, b) => a + b, 0);
    expect(totalBefore).toBeGreaterThan(DEFAULT_LOG_QUOTA_BYTES);

    await dayLogger.enforceQuota(DEFAULT_LOG_QUOTA_BYTES);

    const remaining = (await readdir(join(root, 'logs'))).sort();
    expect(remaining).toEqual(['app-20260907.log', 'app-20260908.log']);
    const totalAfter = (await Promise.all(remaining.map(sizeOf))).reduce((a, b) => a + b, 0);
    expect(totalAfter).toBeLessThanOrEqual(DEFAULT_LOG_QUOTA_BYTES);
    // 残ったファイルは append で書いた行のまま（1 行 1 JSON・2 行）。
    const kept = (await readFile(join(root, 'logs', 'app-20260908.log'), 'utf8')).trimEnd().split('\n');
    expect(kept).toHaveLength(2);
    expect(JSON.parse(kept[0]!)).toMatchObject({ code: 'FILE-005', level: 'warning' });
  });
});

// <!-- req errorloggingfoundation:06b7a523.e3b7 -->
// <!-- req errorloggingfoundation:06b7a523.2366 -->
// <!-- req errorloggingfoundation:16da0ab7.7d5b -->
// <!-- req errorloggingfoundation:16da0ab7.18bb -->
// <!-- req errorloggingfoundation:16da0ab7.9c0f -->
describe('Critical の発生条件の再現（実物の SongRepository・SchemaMigrator → NotificationCenter → Logger）', () => {
  // error-logging-foundation.md 7 節：SongRepository・SchemaMigrator が共有の notificationCenter の report() を呼び、
  // 4 節の表のコードとレベルでログに 1 行残り、Critical なのでモーダル（channel 'modal'）へ届くこと。
  let shown: NotificationEvent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    sharedNotificationCenter.setLogSink(logger);
    shown = [];
    unsubscribe = sharedNotificationCenter.subscribe((event) => shown.push(event));
  });

  afterEach(() => {
    unsubscribe();
    sharedNotificationCenter.setLogSink(undefined);
  });

  /** 保存済みの曲を 1 つ作り、その本ファイルの場所を返す。 */
  async function createSong(title: string): Promise<{ repo: SongRepository; songId: string; filePath: string }> {
    const { repo } = makeRepository();
    const created = await repo.create({ title });
    return { repo, songId: created.id, filePath: join(root, songFilePath(created.id)) };
  }

  /** ログの行と、画面の受け手に届いた知らせを、コード・レベル・チャンネルだけにして返す。 */
  async function reported(): Promise<{
    logged: { code: string; level: string }[];
    modal: { code: string; channel: string }[];
  }> {
    await logger.flush();
    const logged = (await readTodayLogEntries()).map((e) => ({ code: e.code, level: e.level }));
    const modal = shown.map((e) => ({ code: e.code, channel: e.channel }));
    return { logged, modal };
  }

  // <!-- req errorloggingfoundation:06b7a523.e745 -->
  // <!-- req errorloggingfoundation:16da0ab7.da81 -->
  it('SongRepository_load_バイトを書き換えてチェックサムを壊した曲_FILE002がログとモーダルに届く', async () => {
    // IT-ERR-LOG-06 error-logging-foundation.md 7 節：.tabapp のバイトを書き換えてチェックサムを壊す → FILE-002
    const { repo, songId, filePath } = await createSong('Original');
    const text = await readFile(filePath, 'utf8');
    const tampered = text.replace('Original', 'Tampered');
    expect(tampered).not.toBe(text);
    await writeFile(filePath, tampered, 'utf8');

    await expect(repo.load(songId)).rejects.toBeInstanceOf(IntegrityCheckFailedError);

    const { logged, modal } = await reported();
    expect(logged).toEqual([{ code: 'FILE-002', level: 'critical' }]);
    expect((await readTodayLogEntries())[0]!.context).toEqual({ songId });
    expect(modal).toEqual([{ code: 'FILE-002', channel: 'modal' }]);
  });

  // <!-- req errorloggingfoundation:06b7a523.4c98 -->
  // <!-- req errorloggingfoundation:16da0ab7.ff8c -->
  it('SchemaMigrator_migrate_未来のschemaVersionの曲_FILE004がログとモーダルに届く', async () => {
    // IT-ERR-LOG-07 error-logging-foundation.md 7 節：未来の schemaVersion を持つファイルを置く → FILE-004
    const { repo, songId, filePath } = await createSong('Future');
    const json = JSON.parse(await readFile(filePath, 'utf8')) as {
      schemaVersion: string;
      song: unknown;
      appMeta: Parameters<typeof ChecksumUtil.compute>[2];
      integrity: { checksum: string };
    };
    // チェックサムは合わせ、版だけを今のアプリより先にする（FILE-002 ではなく FILE-004 の経路に入れる）。
    json.schemaVersion = '2.0.0';
    json.integrity.checksum = ChecksumUtil.compute('2.0.0', json.song, json.appMeta);
    await writeFile(filePath, JSON.stringify(json), 'utf8');

    await expect(repo.load(songId)).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);

    const { logged, modal } = await reported();
    expect(logged).toEqual([{ code: 'FILE-004', level: 'critical' }]);
    expect((await readTodayLogEntries())[0]!.context).toMatchObject({ fromVersion: '2.0.0' });
    expect(modal).toEqual([{ code: 'FILE-004', channel: 'modal' }]);
  });

  // <!-- req errorloggingfoundation:16da0ab7.3e82 -->
  describe('壊れた .tabapp（3 種）→ FILE-008 で、FILE-004 は出ない', () => {
    // <!-- req errorloggingfoundation:16da0ab7.cb6f -->
    it('SongRepository_load_JSONとして読めない曲_FILE008だけがログとモーダルに届く', async () => {
      // IT-ERR-LOG-08 error-logging-foundation.md 7 節：JSON として読めない → FILE-008（FILE-004 は出ない）
      const { repo, songId, filePath } = await createSong('Broken');
      await writeFile(filePath, '{ "schemaVersion": "1.1.0", ', 'utf8');

      await expect(repo.load(songId)).rejects.toBeInstanceOf(CorruptSongFileError);

      const { logged, modal } = await reported();
      expect(logged).toEqual([{ code: 'FILE-008', level: 'critical' }]);
      expect(modal).toEqual([{ code: 'FILE-008', channel: 'modal' }]);
    });

    // <!-- req errorloggingfoundation:16da0ab7.449c -->
    it('SchemaMigrator_checkShape_最上位がオブジェクトでない曲_FILE008だけがログとモーダルに届く', async () => {
      // IT-ERR-LOG-09 error-logging-foundation.md 7 節：最上位がオブジェクトでない → FILE-008（FILE-004 は出ない）
      const { repo, songId, filePath } = await createSong('Broken');
      await writeFile(filePath, '["1.1.0"]', 'utf8');

      await expect(repo.load(songId)).rejects.toBeInstanceOf(CorruptSongFileError);

      const { logged, modal } = await reported();
      expect(logged).toEqual([{ code: 'FILE-008', level: 'critical' }]);
      expect(modal).toEqual([{ code: 'FILE-008', channel: 'modal' }]);
    });

    // <!-- req errorloggingfoundation:16da0ab7.c63a -->
    it('SchemaMigrator_checkShape_schemaVersionが無いか空の曲_FILE008だけがログとモーダルに届く', async () => {
      // IT-ERR-LOG-10 error-logging-foundation.md 7 節：schemaVersion が無いか空 → FILE-008（FILE-004 は出ない）
      const { repo, songId, filePath } = await createSong('Broken');
      const original = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
      const withoutVersion = Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'schemaVersion'));
      for (const variant of [withoutVersion, { ...original, schemaVersion: '' }]) {
        await writeFile(filePath, JSON.stringify(variant), 'utf8');
        await expect(repo.load(songId)).rejects.toBeInstanceOf(CorruptSongFileError);
      }

      const { logged, modal } = await reported();
      expect(logged).toEqual([
        { code: 'FILE-008', level: 'critical' },
        { code: 'FILE-008', level: 'critical' },
      ]);
      expect(modal).toEqual([
        { code: 'FILE-008', channel: 'modal' },
        { code: 'FILE-008', channel: 'modal' },
      ]);
    });
  });

  it('SongRepository_load_変換前の版をPreMigrationへ写せない古い版の曲_FILE001がログに残り曲を開かない', async () => {
    // IT-ERR-LOG-15 error-logging-foundation.md 4 節の FILE-001 の行・7 節：変換前の版を PreMigration/ へ写せず開かなかったとき → FILE-001
    const { repo, preMigrationFolder } = makeRepository();
    const created = await repo.create({ title: 'Old version' });
    const songId = created.id;
    const filePath = join(root, songFilePath(songId));
    const json = JSON.parse(await readFile(filePath, 'utf8')) as {
      schemaVersion: string;
      song: unknown;
      appMeta: Parameters<typeof ChecksumUtil.compute>[2];
      integrity: { checksum: string };
    };
    // チェックサムは合わせ、版の 1 つ目の数だけを今のアプリより小さくする（変換の前に PreMigration/ へ写す経路に入れる）。
    const oldVersion = '0.9.0';
    json.schemaVersion = oldVersion;
    json.integrity.checksum = ChecksumUtil.compute(oldVersion, json.song, json.appMeta);
    await writeFile(filePath, JSON.stringify(json), 'utf8');
    const bytesBefore = await readFile(filePath);

    // 実物の PreMigration/ のアダプタの writeFile を、変換前の版を写すパスのときだけ投げるように仕込む（ほかは実物のまま）。
    const preservedName = preMigrationFileName(songId, oldVersion);
    const realWrite = preMigrationFolder.writeFile.bind(preMigrationFolder);
    vi.spyOn(preMigrationFolder, 'writeFile').mockImplementation(async (path, data) => {
      if (path === preservedName) throw new Error('injected: cannot copy to PreMigration');
      await realWrite(path, data);
    });

    // 曲を開かない（写せなかった例外がそのまま上がる）。
    await expect(repo.load(songId)).rejects.toThrow('injected: cannot copy to PreMigration');

    const { logged, modal } = await reported();
    expect(logged).toEqual([{ code: 'FILE-001', level: 'error' }]);
    expect((await readTodayLogEntries())[0]!.context).toMatchObject({ songId, reason: 'pre-migration-copy-failed' });
    expect(modal.map((e) => e.code)).toEqual(['FILE-001']);
    // 変換していない：本ファイルは古い版のバイトのまま。
    expect(await readFile(filePath)).toEqual(bytesBefore);
  });
});

describe('クラッシュとフリーズ（main の CrashRecoveryController ↔ 実物の registerLogHandlers ↔ 偽の IPC）', () => {
  beforeEach(() => {
    showMessageBox.mockReset();
  });

  // <!-- req errorloggingfoundation:16da0ab7.c2a6 -->
  it('CrashRecoveryController_renderProcessGoneを3回_getRecoveryStateがrepeatedCrashを返す', async () => {
    // IT-ERR-LOG-11 error-logging-foundation.md 7 節：CrashRecoveryController に render-process-gone を 3 回送る（SYS-002 の main 側）。
    // renderer は crash:getRecoveryState の repeatedCrash を見て SYS-002 を出す（errorLoggingBootstrap、UT-ERR-BOOT で確認）
    const link = connectMain();
    link.emit('did-navigate', {}, START_URL);
    for (let i = 0; i < 3; i++) {
      link.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 } as RenderProcessGoneDetails);
    }
    expect(link.loadURL).toHaveBeenCalledTimes(3);
    expect(link.loadURL).toHaveBeenLastCalledWith(START_URL);

    // 読み込み直した renderer が起動時に crash:getRecoveryState を引く。
    await expect(link.getRecoveryState()).resolves.toEqual({
      recovered: true,
      repeatedCrash: true,
      logFolder: logger.getLogFolderAbsolutePath(),
    });
  });

  // <!-- req errorloggingfoundation:16da0ab7.c2a6 -->
  // <!-- req errorloggingfoundation:16da0ab7.18bb -->
  // <!-- req errorloggingfoundation:16da0ab7.9c0f -->
  it('errorLoggingBootstrap_renderProcessGoneを3回の後に読み込み直したrenderer_SYS002がログのファイルとモーダルの口に届く', async () => {
    // IT-ERR-LOG-16 error-logging-foundation.md 7 節：CrashRecoveryController に render-process-gone を 3 回送る → SYS-002 がログに記録され、
    // モーダルへ届く。main の CrashRecoveryController → crash:getRecoveryState → renderer の bootstrapErrorLogging（実物）→ log:append →
    // 実物の registerLogHandlers → Logger → 実際のログのファイル、と、renderer の NotificationCenter → NotificationUIBinder の modal、を通す
    const link = connectMain();
    link.emit('did-navigate', {}, START_URL);
    for (let i = 0; i < 3; i++) {
      link.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 } as RenderProcessGoneDetails);
    }
    expect(link.loadURL).toHaveBeenCalledTimes(3);

    // 読み込み直した renderer が起動する（起動時に crash:getRecoveryState を 1 回引く）。
    const renderer = startRenderer(link);
    await settle();
    await logger.flush();

    const logged = await readTodayLogEntries();
    // repeatedCrash のときは SYS-002 だけ（SYS-001 は出ない、2.4 節）。
    expect(logged.map((e) => ({ code: e.code, level: e.level }))).toEqual([{ code: 'SYS-002', level: 'critical' }]);
    expect(logged[0]!.context).toEqual({ logFolder: logger.getLogFolderAbsolutePath() });
    expect(renderer.sinks.modal).toHaveBeenCalledTimes(1);
    expect(renderer.sinks.modal.mock.calls[0]![0]).toMatchObject({ code: 'SYS-002', channel: 'modal' });
    expect(renderer.sinks.toast).not.toHaveBeenCalled();
    expect(renderer.sinks.highlight).not.toHaveBeenCalled();
    renderer.stop();
  });

  // <!-- req errorloggingfoundation:39191c07.bdd2 -->
  describe('フリーズの確認（OS のネイティブダイアログ）', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // <!-- req errorloggingfoundation:39191c07.c3a6 -->
    // <!-- req errorloggingfoundation:39191c07.b275 -->
    // <!-- req errorloggingfoundation:39191c07.90c0 -->
    it('CrashRecoveryController_応答が止まって5秒_mainがネイティブダイアログを出し再読み込みでloadURLする', async () => {
      // IT-ERR-LOG-12 error-logging-foundation.md 7 節：renderer の応答を止めて 5 秒たつとダイアログが出て、「再読み込み」で loadURL される
      const link = connectMain();
      await link.getRecoveryState();
      link.emit('did-navigate', {}, START_URL);
      const dialog = deferDialog();

      link.emit('unresponsive');
      vi.advanceTimersByTime(FREEZE_CONFIRM_DELAY_MS - 1);
      expect(showMessageBox).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      // main が Electron の dialog で、その窓を親にしたネイティブのダイアログを出す。
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(showMessageBox.mock.calls[0]![0]).toBe(link.window);
      expect(showMessageBox.mock.calls[0]![1].buttons).toHaveLength(2);
      expect(link.loadURL).not.toHaveBeenCalled();

      dialog.answer(FREEZE_DIALOG_RELOAD_BUTTON);
      await settle();

      expect(link.loadURL).toHaveBeenCalledTimes(1);
      expect(link.loadURL).toHaveBeenCalledWith(START_URL);
      // 読み込み直した renderer は、フリーズから読み込み直したことを crash:getRecoveryState で受け取る。
      await expect(link.getRecoveryState()).resolves.toMatchObject({ recovered: true, repeatedCrash: false });
      expect(link.sentToRenderer).toEqual([]);
    });

    // <!-- req errorloggingfoundation:39191c07.3fed -->
    it('CrashRecoveryController_5秒以内に応答が戻る_ダイアログを出さずfreezeRecoveredをrendererへ送る', async () => {
      // IT-ERR-LOG-13 error-logging-foundation.md 7 節：5 秒以内に応答が戻る（SYS-003 の main 側）。
      // renderer は freeze:recovered を受けて SYS-003 を出す（errorLoggingBootstrap、UT-ERR-BOOT で確認）
      const link = connectMain();

      link.emit('unresponsive');
      vi.advanceTimersByTime(FREEZE_CONFIRM_DELAY_MS - 1);
      link.emit('responsive');
      vi.advanceTimersByTime(FREEZE_CONFIRM_DELAY_MS);
      await settle();

      expect(showMessageBox).not.toHaveBeenCalled();
      expect(link.loadURL).not.toHaveBeenCalled();
      expect(link.sentToRenderer).toEqual([FREEZE_CHANNELS.recovered]);
      await expect(link.getRecoveryState()).resolves.toMatchObject({ recovered: false, repeatedCrash: false });
    });

    // <!-- req errorloggingfoundation:39191c07.3fed -->
    it('errorLoggingBootstrap_5秒以内に応答が戻る_freezeRecoveredを受けたrendererのSYS003がログのファイルに残る', async () => {
      // IT-ERR-LOG-17 error-logging-foundation.md 7 節：5 秒以内に応答が戻れば SYS-003 がログに記録される。main の CrashRecoveryController →
      // freeze:recovered → renderer の bootstrapErrorLogging（実物）→ log:append → 実物の registerLogHandlers → Logger → 実際のログのファイル
      const link = connectMain();
      const renderer = startRenderer(link);
      // 起動時の crash:getRecoveryState（クラッシュしていないので何も出さない）を済ませる。
      await settle();

      link.emit('unresponsive');
      vi.advanceTimersByTime(FREEZE_CONFIRM_DELAY_MS - 1);
      link.emit('responsive');
      vi.advanceTimersByTime(FREEZE_CONFIRM_DELAY_MS);
      await settle();
      await logger.flush();

      expect(showMessageBox).not.toHaveBeenCalled();
      const logged = await readTodayLogEntries();
      expect(logged.map((e) => ({ code: e.code, level: e.level }))).toEqual([{ code: 'SYS-003', level: 'warning' }]);
      // SYS-003 は Warning なので、画面の受け手ではトーストの口へ渡る（モーダルへは出さない）。
      expect(renderer.sinks.toast).toHaveBeenCalledTimes(1);
      expect(renderer.sinks.toast.mock.calls[0]![0]).toMatchObject({ code: 'SYS-003', channel: 'toast' });
      expect(renderer.sinks.modal).not.toHaveBeenCalled();
      renderer.stop();
    });
  });
});

// <!-- req errorloggingfoundation:57854626.4aaa -->
// <!-- req errorloggingfoundation:57854626.9131 -->
// <!-- req errorloggingfoundation:57854626.a298 -->
describe('書き込みの途中で止まったとき（ファイル I/O のフォールトインジェクション）', () => {
  // <!-- req errorloggingfoundation:57854626.82b0 -->
  // <!-- req errorloggingfoundation:57854626.8c6a -->
  // <!-- req errorloggingfoundation:57854626.1162 -->
  // <!-- req errorloggingfoundation:57854626.bc98 -->
  // <!-- req errorloggingfoundation:57854626.802f -->
  it('SongRepository_save_renameの前で止まった_次に開くと改名の前の版を読みtmpを使わない', async () => {
    // IT-ERR-LOG-14 error-logging-foundation.md 7 節・data-model-persistence.md 15 節：
    // {id}.tabapp.tmp に書いた後、rename の前で止め、次に開いたとき本ファイルが改名の前の版のまま読め、.tmp を使わない
    const first = makeRepository();
    const doc = await first.repo.create({ title: 'Before rename' });
    const finalPath = join(root, songFilePath(doc.id));
    const tmpRelative = songTmpFilePath(doc.id);
    const bytesBefore = await readFile(finalPath);

    // 実物のアダプタの renameFile を、一時ファイルからの改名のときだけ投げるように仕込む（ほかの改名は実物のまま）。
    const realRename = first.songs.renameFile.bind(first.songs);
    vi.spyOn(first.songs, 'renameFile').mockImplementation(async (from, to) => {
      if (from === tmpRelative) throw new Error('injected: stopped before rename');
      await realRename(from, to);
    });
    doc.score.title = 'After rename';
    await expect(first.repo.save(doc)).rejects.toThrow('injected: stopped before rename');

    // 一時ファイルまでは書けている（新しい版）。本ファイルは改名の前のバイトのまま。
    expect(await readFile(join(root, tmpRelative), 'utf8')).toContain('After rename');
    expect(await readFile(finalPath)).toEqual(bytesBefore);

    // 次に開く（作り直した部品で読む）。
    const next = makeRepository();
    const reads = vi.spyOn(next.songs, 'readFile');
    const loaded = await next.repo.load(doc.id);

    expect(loaded.score.title).toBe('Before rename');
    expect(reads.mock.calls.map(([path]) => path)).not.toContain(tmpRelative);
  });
});
