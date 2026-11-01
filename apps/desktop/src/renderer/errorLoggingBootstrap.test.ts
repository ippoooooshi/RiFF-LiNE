// UT-ERR-BOOT: errorLoggingBootstrap（renderer のログ転送・クラッシュ復旧の知らせ・フリーズからの復帰の知らせ）
// 検証節: error-logging-foundation.md 2.3 節（freeze:recovered → SYS-003）・2.4 節（結線・クラッシュ復旧通知・購読の順番）
//         ・2.6 節（window の error・unhandledrejection → SYS-005、notify:fromMain → relay）

import {
  ErrorCodeRegistry,
  NotificationCenter,
  registerCoreErrorCodes,
  toLogEntry,
  type NotificationEvent,
} from '@riff-line/core/errors';
import type { CrashRecoveryState, LogEntry } from '@riff-line/shared-types';
import { describe, expect, it, vi } from 'vitest';

// 呼ぶ所の確かめ（UT-ERR-BOOT-13）は、入口の文を読み込むだけで走らせない（Vite の ?raw）
import appSource from './App.tsx?raw';
import { bootstrapErrorLogging, type ErrorLoggingBootstrapDeps } from './errorLoggingBootstrap';
import entrySource from './main.tsx?raw';

const LOG_FOLDER = '/fake/TabApp/logs';

function makeCenter(): NotificationCenter {
  const registry = new ErrorCodeRegistry();
  registerCoreErrorCodes(registry);
  return new NotificationCenter(registry);
}

/** preload の呼び口の fake。freeze:recovered を起こす `fireFreezeRecovered` を持つ。 */
function makeApi(
  state: Promise<CrashRecoveryState> = Promise.resolve({
    recovered: false,
    repeatedCrash: false,
    logFolder: LOG_FOLDER,
  }),
) {
  const freezeHandlers = new Set<() => void>();
  const fromMainHandlers = new Set<(event: NotificationEvent) => void>();
  const api = {
    log: { append: vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve()) },
    crash: {
      getRecoveryState: vi.fn(() => state),
      onFreezeRecovered: vi.fn((handler: () => void) => {
        freezeHandlers.add(handler);
        return () => freezeHandlers.delete(handler);
      }),
    },
    notify: {
      onFromMain: vi.fn((handler: (event: NotificationEvent) => void) => {
        fromMainHandlers.add(handler);
        return () => fromMainHandlers.delete(handler);
      }),
    },
  } satisfies ErrorLoggingBootstrapDeps['api'];
  const fireFreezeRecovered = (): void => {
    for (const handler of freezeHandlers) handler();
  };
  /** main が notify:fromMain で送った記録が preload に届いたときの代わり。 */
  const fireFromMain = (event: NotificationEvent): void => {
    for (const handler of fromMainHandlers) handler(event);
  };
  return { api, fireFreezeRecovered, freezeHandlers, fireFromMain, fromMainHandlers };
}

/** 後から登録した受け手（表示側の代わり）で、届いた記録のコードを集める。 */
function collectCodes(center: NotificationCenter): string[] {
  const codes: string[] = [];
  center.subscribe((event) => codes.push(event.code));
  return codes;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('bootstrapErrorLogging のログ転送（error-logging-foundation.md 2.4 節の結線）', () => {
  it('bootstrapErrorLogging_reportの記録_toLogEntryで組み立ててlog.appendへ送る', () => {
    // UT-ERR-BOOT-01 2.4 節「toLogEntry(event) で LogEntry に組み立ててから window.riffLineApi.log.append(entry) へ送る」
    const center = makeCenter();
    const { api } = makeApi();
    const seen: NotificationEvent[] = [];
    bootstrapErrorLogging({ center, api, target: new EventTarget() });
    center.subscribe((event) => seen.push(event));

    center.report('FILE-001', { songId: 's1', error: new Error('disk full') });

    expect(api.log.append).toHaveBeenCalledTimes(1);
    const sent = api.log.append.mock.calls[0]![0];
    expect(sent).toEqual(toLogEntry(seen[0]!));
    // 組み立て済みの LogEntry（画面向けの欄を持たず、context.error は { name, message }）
    expect(sent).not.toHaveProperty('channel');
    expect(sent).not.toHaveProperty('showOnScreen');
    expect(sent.context).toEqual({ songId: 's1', error: { name: 'Error', message: 'disk full' } });
  });

  it('bootstrapErrorLogging_画面に出さないコード_showOnScreenを見ずにログへ送る', () => {
    // UT-ERR-BOOT-02 2.4 節「showOnScreen を見ずにすべての記録を送る（画面に出さないコードの記録もログには残る）」
    const center = makeCenter();
    const { api } = makeApi();
    bootstrapErrorLogging({ center, api, target: new EventTarget() });

    center.report('SYS-004', { windowKind: 'edit', error: new Error('render') });

    expect(api.log.append).toHaveBeenCalledTimes(1);
    expect(api.log.append.mock.calls[0]![0]).toMatchObject({ code: 'SYS-004' });
  });

  it('bootstrapErrorLogging_表示側を後から登録_ログ転送が先に呼ばれる', () => {
    // UT-ERR-BOOT-03 2.4 節「購読の順番」：ログ転送の購読を、表示側（NotificationUIBinder）の購読より先に登録する
    const center = makeCenter();
    const { api } = makeApi();
    const order: string[] = [];
    api.log.append.mockImplementation(() => {
      order.push('log');
      return Promise.resolve();
    });
    bootstrapErrorLogging({ center, api, target: new EventTarget() });
    center.subscribe(() => order.push('screen'));

    center.report('SYS-001');

    expect(order).toEqual(['log', 'screen']);
  });

  it('bootstrapErrorLogging_mainから届いたrelayの記録_ログへ送らず画面の受け手には届く', () => {
    // UT-ERR-BOOT-04 2.6 節「errorLoggingBootstrap のログ転送はこの形（{ relayed: false }）で登録する。main が書いたログを renderer がもう一度書かないため」
    const center = makeCenter();
    const { api } = makeApi();
    bootstrapErrorLogging({ center, api, target: new EventTarget() });
    const screen = collectCodes(center);

    center.relay({
      level: 'warning',
      channel: 'toast',
      code: 'FILE-005',
      message: 'm',
      timestamp: '2026-11-01T00:00:00.000Z',
      showOnScreen: true,
    });

    expect(api.log.append).not.toHaveBeenCalled();
    expect(screen).toEqual(['FILE-005']);
  });

  it('bootstrapErrorLogging_log.appendがreject_投げず次の記録も送る', async () => {
    // UT-ERR-BOOT-05 ログを送れなくても画面の動きに響かせない
    const center = makeCenter();
    const { api } = makeApi();
    api.log.append.mockRejectedValueOnce(new Error('ipc closed'));
    bootstrapErrorLogging({ center, api, target: new EventTarget() });

    expect(() => center.report('SYS-001')).not.toThrow();
    center.report('SYS-003');
    await settle();

    expect(api.log.append).toHaveBeenCalledTimes(2);
  });
});

describe('bootstrapErrorLogging のクラッシュ復旧通知（error-logging-foundation.md 2.4 節、決定 X5・O3）', () => {
  it('bootstrapErrorLogging_起動時_crash:getRecoveryStateを1回引く', async () => {
    // UT-ERR-BOOT-06 2.4 節「renderer の errorLoggingBootstrap が起動時に1回引き」
    const center = makeCenter();
    const { api } = makeApi();
    bootstrapErrorLogging({ center, api, target: new EventTarget() });
    await settle();
    expect(api.crash.getRecoveryState).toHaveBeenCalledTimes(1);
  });

  it('bootstrapErrorLogging_repeatedCrashとrecoveredが真_SYS-002だけをlogFolder付きで出す', async () => {
    // UT-ERR-BOOT-07 2.4 節「repeatedCrash が真のときは SYS-002 だけを出し、SYS-001 は出さない」「SYS-002 の context.logFolder に入れる」
    const center = makeCenter();
    const { api } = makeApi(Promise.resolve({ recovered: true, repeatedCrash: true, logFolder: LOG_FOLDER }));
    const events: NotificationEvent[] = [];
    center.subscribe((event) => events.push(event));
    bootstrapErrorLogging({ center, api, target: new EventTarget() });
    await settle();

    expect(events.map((e) => e.code)).toEqual(['SYS-002']);
    expect(events[0]!.context).toEqual({ logFolder: LOG_FOLDER });
  });

  it('bootstrapErrorLogging_recoveredだけが真_SYS-001を出す', async () => {
    // UT-ERR-BOOT-08 2.4 節「recovered→SYS-001」
    const center = makeCenter();
    const { api } = makeApi(Promise.resolve({ recovered: true, repeatedCrash: false, logFolder: LOG_FOLDER }));
    const codes = collectCodes(center);
    bootstrapErrorLogging({ center, api, target: new EventTarget() });
    await settle();
    expect(codes).toEqual(['SYS-001']);
  });

  it('bootstrapErrorLogging_どちらも偽_何も出さない', async () => {
    // UT-ERR-BOOT-09
    const center = makeCenter();
    const { api } = makeApi();
    const codes = collectCodes(center);
    bootstrapErrorLogging({ center, api, target: new EventTarget() });
    await settle();
    expect(codes).toEqual([]);
  });

  it('bootstrapErrorLogging_getRecoveryStateがreject_投げず何も出さない', async () => {
    // UT-ERR-BOOT-10
    const center = makeCenter();
    const { api } = makeApi(Promise.reject(new Error('no handler')));
    const codes = collectCodes(center);
    expect(() => bootstrapErrorLogging({ center, api, target: new EventTarget() })).not.toThrow();
    await settle();
    expect(codes).toEqual([]);
  });
});

describe('bootstrapErrorLogging のフリーズからの復帰（error-logging-foundation.md 2.3 節）', () => {
  it('bootstrapErrorLogging_freeze:recoveredを受ける_SYS-003を出しログにも送る', () => {
    // UT-ERR-BOOT-11 2.3 節「renderer の errorLoggingBootstrap がこれを受けて notificationCenter.report('SYS-003') を出す」
    const center = makeCenter();
    const { api, fireFreezeRecovered } = makeApi();
    bootstrapErrorLogging({ center, api, target: new EventTarget() });
    const codes = collectCodes(center);

    fireFreezeRecovered();

    expect(codes).toEqual(['SYS-003']);
    expect(api.log.append.mock.calls.map(([entry]) => entry.code)).toEqual(['SYS-003']);
  });

  it('bootstrapErrorLogging_戻り値を呼ぶ_ログ転送とフリーズの購読を外す', () => {
    // UT-ERR-BOOT-12
    const center = makeCenter();
    const { api, fireFreezeRecovered, freezeHandlers } = makeApi();
    const stop = bootstrapErrorLogging({ center, api, target: new EventTarget() });

    stop();
    fireFreezeRecovered();
    center.report('SYS-001');

    expect(freezeHandlers.size).toBe(0);
    expect(api.log.append).not.toHaveBeenCalled();
  });
});

describe('呼ぶ所（error-logging-foundation.md 2.4 節「購読の順番」）', () => {
  it('errorLoggingBootstrap_画面を描く前のmain.tsxで1回呼び_App.tsxのuseEffectでは呼ばない', () => {
    // UT-ERR-BOOT-13 React は子の useEffect を親より先に走らせるので、App の useEffect で呼ぶと編集ウィンドウの
    // NotificationUIBinder の購読がログ転送より先になる。画面を描く前（createRoot より前）に呼ぶことを止めておく
    const callAt = entrySource.indexOf('bootstrapErrorLogging(');
    expect(callAt).toBeGreaterThan(-1);
    expect(callAt).toBeLessThan(entrySource.indexOf('createRoot('));
    expect(appSource).not.toContain('bootstrapErrorLogging');
  });
});

/** window の error（ErrorEvent）の代わり。Node の環境には ErrorEvent が無いので Event に error を載せる。 */
function errorEvent(error: unknown): Event {
  return Object.assign(new Event('error'), { error });
}

/** window の unhandledrejection（PromiseRejectionEvent）の代わり。 */
function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason });
}

/** report された記録を全部集める（画面の受け手の代わり。ログ転送より後に登録する）。 */
function collectEvents(center: NotificationCenter): NotificationEvent[] {
  const events: NotificationEvent[] = [];
  center.subscribe((event) => events.push(event));
  return events;
}

describe('bootstrapErrorLogging の描画の外の未捕捉の例外（error-logging-foundation.md 2.6 節）', () => {
  // <!-- req errorloggingfoundation:4626a8a5.e9c7 -->
  it('bootstrapErrorLogging_windowにerrorを投げる_SYS-005をkind_errorで1回reportする', () => {
    // UT-ERR-BOOT-14 2.6 節「window に error を投げると report() が SYS-005・kind: 'error' で 1 回呼ばれること」
    const center = makeCenter();
    const { api } = makeApi();
    const target = new EventTarget();
    const report = vi.spyOn(center, 'report');
    bootstrapErrorLogging({ center, api, target });
    const thrown = new Error('click exploded');

    target.dispatchEvent(errorEvent(thrown));

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('SYS-005', { kind: 'error', error: thrown });
  });

  // <!-- req errorloggingfoundation:4626a8a5.4571 -->
  it('bootstrapErrorLogging_受けずに置いたreject_SYS-005をkind_unhandledrejectionで1回reportする', () => {
    // UT-ERR-BOOT-15 2.6 節「reject した Promise を受けずに置くと kind: 'unhandledrejection' で 1 回呼ばれること」
    const center = makeCenter();
    const { api } = makeApi();
    const target = new EventTarget();
    const report = vi.spyOn(center, 'report');
    bootstrapErrorLogging({ center, api, target });
    const reason = new RangeError('marker out of range');

    target.dispatchEvent(rejectionEvent(reason));

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('SYS-005', { kind: 'unhandledrejection', error: reason });
  });

  // <!-- req errorloggingfoundation:4626a8a5.25b2 -->
  it('bootstrapErrorLogging_Errorでない値でreject_context.errorをErrorに包む', () => {
    // UT-ERR-BOOT-16 2.6 節「Error でない値で reject したときも context.error が Error になること」（new Error(String(reason))）
    // ErrorEvent.error が Error でないとき（文字列を throw したとき）も同じく包む
    const center = makeCenter();
    const { api } = makeApi();
    const target = new EventTarget();
    const events = collectEvents(center);
    bootstrapErrorLogging({ center, api, target });

    target.dispatchEvent(rejectionEvent('plain reason'));
    target.dispatchEvent(errorEvent(42));

    expect(events.map((e) => e.context?.['kind'])).toEqual(['unhandledrejection', 'error']);
    const [rejected, thrown] = events.map((e) => e.context?.['error']);
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe('plain reason');
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('42');
  });

  // <!-- req errorloggingfoundation:4626a8a5.fbaa -->
  it('bootstrapErrorLogging_SYS-005の記録_画面に出さない印でログの受け手には届く', () => {
    // UT-ERR-BOOT-17 2.6 節「SYS-005 の記録が画面の受け手（NotificationUIBinder）で飛ばされ、ログの受け手には届くこと」
    // ここで確かめるのは、記録が showOnScreen: false（画面の受け手が飛ばす印）を持ち、ログ転送（log:append）には届き stack を持つこと
    const center = makeCenter();
    const { api } = makeApi();
    const target = new EventTarget();
    bootstrapErrorLogging({ center, api, target });
    const screen = collectEvents(center);
    const thrown = new Error('handler exploded');

    target.dispatchEvent(errorEvent(thrown));

    expect(screen).toHaveLength(1);
    expect(screen[0]).toMatchObject({ code: 'SYS-005', level: 'error', showOnScreen: false });
    expect(api.log.append).toHaveBeenCalledTimes(1);
    const sent = api.log.append.mock.calls[0]![0];
    expect(sent).toMatchObject({ code: 'SYS-005', level: 'error' });
    expect(sent.stack).toBe(thrown.stack);
  });

  it('bootstrapErrorLogging_起動時_errorとunhandledrejectionを1回ずつ登録する', () => {
    // UT-ERR-BOOT-18 2.6 節「起動時に window.addEventListener('error', …) と window.addEventListener('unhandledrejection', …) を 1 回ずつ登録する」
    const center = makeCenter();
    const { api } = makeApi();
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    bootstrapErrorLogging({ center, api, target });

    expect(add.mock.calls.map(([type]) => type).sort()).toEqual(['error', 'unhandledrejection']);
  });
});

describe('bootstrapErrorLogging の main で出たエラーの知らせ（error-logging-foundation.md 2.6 節、notify:fromMain）', () => {
  const fromMain: NotificationEvent = {
    level: 'warning',
    channel: 'toast',
    code: 'FILE-005',
    message: 'ミラーへの書き込みに失敗しました',
    timestamp: '2026-11-01T00:00:00.000Z',
    showOnScreen: true,
  };

  // <!-- req errorloggingfoundation:4626a8a5.b915 -->
  // <!-- req errorloggingfoundation:4626a8a5.7928 -->
  // <!-- req errorloggingfoundation:4626a8a5.dfa5 -->
  it('bootstrapErrorLogging_notify:fromMainを受ける_reportせずrelayで画面の受け手に1回届けログには送らない', () => {
    // UT-ERR-BOOT-19 2.6 節「notify:fromMain を受けると、report() は呼ばれず、relay で画面の受け手に 1 回届き、
    // { relayed: false } で登録したログ転送の受け手には届かないこと」
    const center = makeCenter();
    const { api, fireFromMain } = makeApi();
    const report = vi.spyOn(center, 'report');
    const relay = vi.spyOn(center, 'relay');
    bootstrapErrorLogging({ center, api, target: new EventTarget() });
    const screen = collectEvents(center);

    fireFromMain(fromMain);

    expect(api.notify.onFromMain).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    expect(relay).toHaveBeenCalledTimes(1);
    expect(relay).toHaveBeenCalledWith(fromMain);
    expect(screen).toEqual([fromMain]);
    expect(api.log.append).not.toHaveBeenCalled();
  });

  it('bootstrapErrorLogging_戻り値を呼ぶ_未捕捉の例外とnotify:fromMainの受け口も外す', () => {
    // UT-ERR-BOOT-20 戻り値の解除で、2.6 節の登録（error・unhandledrejection・notify:fromMain）も外す
    const center = makeCenter();
    const { api, fireFromMain, fromMainHandlers } = makeApi();
    const target = new EventTarget();
    const stop = bootstrapErrorLogging({ center, api, target });
    const screen = collectEvents(center);

    stop();
    target.dispatchEvent(errorEvent(new Error('after stop')));
    target.dispatchEvent(rejectionEvent(new Error('after stop')));
    fireFromMain(fromMain);

    expect(fromMainHandlers.size).toBe(0);
    expect(screen).toEqual([]);
  });
});
