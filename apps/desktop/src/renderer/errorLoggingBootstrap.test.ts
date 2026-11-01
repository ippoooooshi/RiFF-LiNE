// UT-ERR-BOOT: errorLoggingBootstrap（renderer のログ転送・クラッシュ復旧の知らせ・フリーズからの復帰の知らせ）
// 検証節: error-logging-foundation.md 2.3 節（freeze:recovered → SYS-003）・2.4 節（結線・クラッシュ復旧通知・購読の順番）

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
  const api = {
    log: { append: vi.fn<(entry: LogEntry) => Promise<void>>(() => Promise.resolve()) },
    crash: {
      getRecoveryState: vi.fn(() => state),
      onFreezeRecovered: vi.fn((handler: () => void) => {
        freezeHandlers.add(handler);
        return () => freezeHandlers.delete(handler);
      }),
    },
  } satisfies ErrorLoggingBootstrapDeps['api'];
  const fireFreezeRecovered = (): void => {
    for (const handler of freezeHandlers) handler();
  };
  return { api, fireFreezeRecovered, freezeHandlers };
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
    bootstrapErrorLogging({ center, api });
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
    bootstrapErrorLogging({ center, api });

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
    bootstrapErrorLogging({ center, api });
    center.subscribe(() => order.push('screen'));

    center.report('SYS-001');

    expect(order).toEqual(['log', 'screen']);
  });

  it('bootstrapErrorLogging_mainから届いたrelayの記録_ログへ送らず画面の受け手には届く', () => {
    // UT-ERR-BOOT-04 2.6 節「errorLoggingBootstrap のログ転送はこの形（{ relayed: false }）で登録する。main が書いたログを renderer がもう一度書かないため」
    const center = makeCenter();
    const { api } = makeApi();
    bootstrapErrorLogging({ center, api });
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
    bootstrapErrorLogging({ center, api });

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
    bootstrapErrorLogging({ center, api });
    await settle();
    expect(api.crash.getRecoveryState).toHaveBeenCalledTimes(1);
  });

  it('bootstrapErrorLogging_repeatedCrashとrecoveredが真_SYS-002だけをlogFolder付きで出す', async () => {
    // UT-ERR-BOOT-07 2.4 節「repeatedCrash が真のときは SYS-002 だけを出し、SYS-001 は出さない」「SYS-002 の context.logFolder に入れる」
    const center = makeCenter();
    const { api } = makeApi(Promise.resolve({ recovered: true, repeatedCrash: true, logFolder: LOG_FOLDER }));
    const events: NotificationEvent[] = [];
    center.subscribe((event) => events.push(event));
    bootstrapErrorLogging({ center, api });
    await settle();

    expect(events.map((e) => e.code)).toEqual(['SYS-002']);
    expect(events[0]!.context).toEqual({ logFolder: LOG_FOLDER });
  });

  it('bootstrapErrorLogging_recoveredだけが真_SYS-001を出す', async () => {
    // UT-ERR-BOOT-08 2.4 節「recovered→SYS-001」
    const center = makeCenter();
    const { api } = makeApi(Promise.resolve({ recovered: true, repeatedCrash: false, logFolder: LOG_FOLDER }));
    const codes = collectCodes(center);
    bootstrapErrorLogging({ center, api });
    await settle();
    expect(codes).toEqual(['SYS-001']);
  });

  it('bootstrapErrorLogging_どちらも偽_何も出さない', async () => {
    // UT-ERR-BOOT-09
    const center = makeCenter();
    const { api } = makeApi();
    const codes = collectCodes(center);
    bootstrapErrorLogging({ center, api });
    await settle();
    expect(codes).toEqual([]);
  });

  it('bootstrapErrorLogging_getRecoveryStateがreject_投げず何も出さない', async () => {
    // UT-ERR-BOOT-10
    const center = makeCenter();
    const { api } = makeApi(Promise.reject(new Error('no handler')));
    const codes = collectCodes(center);
    expect(() => bootstrapErrorLogging({ center, api })).not.toThrow();
    await settle();
    expect(codes).toEqual([]);
  });
});

describe('bootstrapErrorLogging のフリーズからの復帰（error-logging-foundation.md 2.3 節）', () => {
  it('bootstrapErrorLogging_freeze:recoveredを受ける_SYS-003を出しログにも送る', () => {
    // UT-ERR-BOOT-11 2.3 節「renderer の errorLoggingBootstrap がこれを受けて notificationCenter.report('SYS-003') を出す」
    const center = makeCenter();
    const { api, fireFreezeRecovered } = makeApi();
    bootstrapErrorLogging({ center, api });
    const codes = collectCodes(center);

    fireFreezeRecovered();

    expect(codes).toEqual(['SYS-003']);
    expect(api.log.append.mock.calls.map(([entry]) => entry.code)).toEqual(['SYS-003']);
  });

  it('bootstrapErrorLogging_戻り値を呼ぶ_ログ転送とフリーズの購読を外す', () => {
    // UT-ERR-BOOT-12
    const center = makeCenter();
    const { api, fireFreezeRecovered, freezeHandlers } = makeApi();
    const stop = bootstrapErrorLogging({ center, api });

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
