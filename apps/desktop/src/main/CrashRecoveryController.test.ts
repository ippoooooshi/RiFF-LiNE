// UT-ERR-CRC: error-logging-foundation.md 2.3 節・3.2 節、08_error_logging.md 3 節 — CrashRecoveryController
// 検証観点: render-process-gone 購読、クラッシュ時のカウント増加＋起動時と同じ URL の loadURL、clean-exit 無視、
//           consumeRecoveryState の recovered 一回消費 / repeatedCrash しきい値 / logFolder、destroyed 窓は触らない、
//           窓ごとの数え・閉じた窓の分の消去、reloadAfterRenderError、フリーズ（タイマー・ダイアログ・中断）（C0/C1）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue, RenderProcessGoneDetails } from 'electron';

import {
  CrashRecoveryController,
  FREEZE_CONFIRM_DELAY_MS,
  REPEATED_CRASH_THRESHOLD,
  type CrashRecoveryControllerOptions,
} from './CrashRecoveryController';

const showMessageBox = vi.hoisted(() =>
  vi.fn<(window: unknown, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>(),
);
vi.mock('electron', () => ({ dialog: { showMessageBox } }));

const LOG_FOLDER = '/fake/TabApp/logs';
const START_URL = 'file:///app/index.html#edit/song-1';

type Listener = (...args: unknown[]) => void;

/** webContents のイベントを任意に起こせる最小の BrowserWindow の代わり。 */
function makeWindow(options: { id?: number; destroyed?: boolean; currentUrl?: string } = {}): {
  window: BrowserWindow;
  crash: (reason: string) => void;
  emit: (channel: string, ...args: unknown[]) => void;
  loadURL: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, Listener>();
  const loadURL = vi.fn(() => Promise.resolve());
  const send = vi.fn();
  const window = {
    id: options.id ?? 1,
    isDestroyed: () => options.destroyed ?? false,
    webContents: {
      on: (channel: string, cb: Listener) => {
        listeners.set(channel, cb);
      },
      loadURL,
      send,
      getURL: () => options.currentUrl ?? 'file:///app/index.html#current',
    },
  } as unknown as BrowserWindow;
  const emit = (channel: string, ...args: unknown[]): void => listeners.get(channel)?.(...args);
  return {
    window,
    emit,
    loadURL,
    send,
    crash: (reason: string) => emit('render-process-gone', {}, { reason, exitCode: 1 } as RenderProcessGoneDetails),
  };
}

function makeController(options: Partial<CrashRecoveryControllerOptions> = {}): CrashRecoveryController {
  return new CrashRecoveryController({ getLogFolder: () => LOG_FOLDER, ...options });
}

/** 戻りをテストから決められる showMessageBox。`abort` されたら cancelId（0）で解決する（Electron の型の説明どおり）。 */
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

beforeEach(() => {
  showMessageBox.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CrashRecoveryController', () => {
  it('REPEATED_CRASH_THRESHOLD_Is3', () => {
    expect(REPEATED_CRASH_THRESHOLD).toBe(3);
  });

  it('attach_RenderProcessGone_IncrementsCountLoadsUrlAndFiresOnCrash', () => {
    const onCrash = vi.fn();
    const controller = makeController({ onCrash });
    const { window, crash, emit, loadURL } = makeWindow();
    controller.attach(window);
    emit('did-navigate', {}, START_URL);

    crash('crashed');

    expect(controller.crashCountThisSessionValue(window)).toBe(1);
    expect(loadURL).toHaveBeenCalledWith(START_URL);
    expect(onCrash).toHaveBeenCalledWith({ reason: 'crashed', crashCountThisSession: 1 });
  });

  it('attach_CleanExit_IsIgnored', () => {
    const onCrash = vi.fn();
    const controller = makeController({ onCrash });
    const { window, crash, loadURL } = makeWindow();
    controller.attach(window);

    crash('clean-exit');

    expect(controller.crashCountThisSessionValue(window)).toBe(0);
    expect(loadURL).not.toHaveBeenCalled();
    expect(onCrash).not.toHaveBeenCalled();
  });

  it('attach_DestroyedWindow_DoesNotReload', () => {
    const controller = makeController();
    const { window, crash, loadURL } = makeWindow({ destroyed: true });
    controller.attach(window);

    crash('crashed');

    expect(controller.crashCountThisSessionValue(window)).toBe(1); // カウントはする
    expect(loadURL).not.toHaveBeenCalled(); // 破棄済みウィンドウは触らない
  });

  it('consumeRecoveryState_AfterCrash_RecoveredTrueThenClearedOnSecondCall', () => {
    const controller = makeController();
    const { window, crash } = makeWindow();
    controller.attach(window);

    expect(controller.consumeRecoveryState(window)).toEqual({
      recovered: false,
      repeatedCrash: false,
      logFolder: LOG_FOLDER,
    });

    crash('crashed');
    expect(controller.consumeRecoveryState(window)).toEqual({
      recovered: true,
      repeatedCrash: false,
      logFolder: LOG_FOLDER,
    });
    expect(controller.consumeRecoveryState(window)).toEqual({
      recovered: false,
      repeatedCrash: false,
      logFolder: LOG_FOLDER,
    });
  });

  it('consumeRecoveryState_AtThreshold_RepeatedCrashStaysTrue', () => {
    const controller = makeController({ threshold: 3 });
    const { window, crash } = makeWindow();
    controller.attach(window);

    crash('crashed');
    crash('crashed');
    expect(controller.consumeRecoveryState(window).repeatedCrash).toBe(false);

    crash('crashed');
    expect(controller.consumeRecoveryState(window)).toMatchObject({ recovered: true, repeatedCrash: true });
    // recovered は消費済みだが repeatedCrash はしきい値到達後ずっと true。
    expect(controller.consumeRecoveryState(window)).toMatchObject({ recovered: false, repeatedCrash: true });
  });

  it('constructor_CustomThreshold_Respected', () => {
    const controller = makeController({ threshold: 1 });
    const { window, crash } = makeWindow();
    controller.attach(window);
    crash('oom');
    expect(controller.consumeRecoveryState(window).repeatedCrash).toBe(true);
  });

  it('constructor_DefaultThreshold_IsRepeatedCrashThreshold', () => {
    // UT-ERR-CRC-01 2.3 節（既定のしきい値は packages/core の REPEATED_CRASH_THRESHOLD。2 回目は false・3 回目で true）
    const controller = makeController();
    const { window, crash } = makeWindow();
    controller.attach(window);
    crash('crashed');
    crash('crashed');
    expect(controller.consumeRecoveryState(window).repeatedCrash).toBe(false);
    crash('crashed');
    expect(controller.consumeRecoveryState(window).repeatedCrash).toBe(true);
  });
});

describe('CrashRecoveryController の窓ごとの状態（2026-10-29 決定 L2）', () => {
  it('attach_TwoWindows_CountsAndRecoveredArePerWindow', () => {
    // UT-ERR-CRC-02 2.3 節・6 節（数えるのは窓ごとで、別の窓のクラッシュを足さない）
    const controller = makeController({ threshold: 2 });
    const a = makeWindow({ id: 1 });
    const b = makeWindow({ id: 2 });
    controller.attach(a.window);
    controller.attach(b.window);

    a.crash('crashed');
    a.crash('crashed');

    expect(controller.crashCountThisSessionValue(a.window)).toBe(2);
    expect(controller.crashCountThisSessionValue(b.window)).toBe(0);
    expect(controller.consumeRecoveryState(b.window)).toEqual({
      recovered: false,
      repeatedCrash: false,
      logFolder: LOG_FOLDER,
    });
    expect(controller.consumeRecoveryState(a.window)).toMatchObject({ recovered: true, repeatedCrash: true });
    expect(a.loadURL).toHaveBeenCalledTimes(2);
    expect(b.loadURL).not.toHaveBeenCalled();
  });

  it('detach_ClosedWindow_ForgetsOnlyThatWindow', () => {
    // UT-ERR-CRC-03 2.3 節（窓が閉じたらその窓の分を消す）
    const controller = makeController();
    const a = makeWindow({ id: 1 });
    const b = makeWindow({ id: 2 });
    controller.attach(a.window);
    controller.attach(b.window);
    a.crash('crashed');
    b.crash('crashed');

    controller.detach(1);

    expect(controller.crashCountThisSessionValue(a.window)).toBe(0);
    expect(controller.consumeRecoveryState(a.window).recovered).toBe(false);
    expect(controller.crashCountThisSessionValue(b.window)).toBe(1);
  });

  it('detach_UnknownWindow_DoesNothing', () => {
    // UT-ERR-CRC-04 2.3 節（attach していない窓の id は無視）
    const controller = makeController();
    const a = makeWindow({ id: 1 });
    controller.attach(a.window);
    a.crash('crashed');

    controller.detach(99);

    expect(controller.crashCountThisSessionValue(a.window)).toBe(1);
  });

  it('consumeRecoveryState_NullOrUnattachedWindow_ReturnsNotRecoveredWithLogFolder', () => {
    // UT-ERR-CRC-05 2.3 節（送り手が窓でないときと attach していない窓は、未復旧・回数 0）
    const controller = makeController({ threshold: 0 });
    const stranger = makeWindow({ id: 7 });
    const expected = { recovered: false, repeatedCrash: true, logFolder: LOG_FOLDER };
    // threshold 0 なので回数 0 でも repeatedCrash は true になる＝回数 0 として数えている
    expect(controller.consumeRecoveryState(null)).toEqual(expected);
    expect(controller.consumeRecoveryState(stranger.window)).toEqual(expected);
  });

  it('consumeRecoveryState_LogFolder_ComesFromGetLogFolderEachCall', () => {
    // UT-ERR-CRC-06 2.3 節（logFolder は constructor の getLogFolder から取る、決定 O3）
    let folder = '/a/logs';
    const controller = makeController({ getLogFolder: () => folder });
    const { window } = makeWindow();
    controller.attach(window);
    expect(controller.consumeRecoveryState(window).logFolder).toBe('/a/logs');
    folder = '/b/logs';
    expect(controller.consumeRecoveryState(window).logFolder).toBe('/b/logs');
  });

  it('attach_CrashBeforeFirstNavigation_LoadsCurrentUrl', () => {
    // UT-ERR-CRC-07 2.3 節（起動時の URL をまだ覚えていないときは今の URL で読み込み直す）
    const controller = makeController();
    const { window, crash, loadURL } = makeWindow({ currentUrl: 'file:///app/index.html#songlist' });
    controller.attach(window);
    crash('crashed');
    expect(loadURL).toHaveBeenCalledWith('file:///app/index.html#songlist');
  });
});

describe('CrashRecoveryController.reloadAfterRenderError（2.3 節、2026-10-14 本人決定）', () => {
  it('reloadAfterRenderError_LoadsStartUrlWithoutCountingOrRecovered', () => {
    // UT-ERR-CRC-08 2.3 節（回数を足さず recovered も立てずに、起動時と同じ URL で loadURL）
    const controller = makeController();
    const { window, emit, loadURL } = makeWindow({ currentUrl: 'file:///app/index.html#changed' });
    controller.attach(window);
    emit('did-navigate', {}, START_URL);

    controller.reloadAfterRenderError(window);

    expect(loadURL).toHaveBeenCalledWith(START_URL);
    expect(controller.crashCountThisSessionValue(window)).toBe(0);
    expect(controller.consumeRecoveryState(window).recovered).toBe(false);
  });

  it('reloadAfterRenderError_UnattachedWindow_LoadsCurrentUrl', () => {
    // UT-ERR-CRC-09 2.3 節（attach していない窓は今の URL）
    const controller = makeController();
    const { window, loadURL } = makeWindow({ currentUrl: 'file:///app/index.html#songlist' });
    controller.reloadAfterRenderError(window);
    expect(loadURL).toHaveBeenCalledWith('file:///app/index.html#songlist');
  });
});

describe('CrashRecoveryController のフリーズ（2.3 節の案 A・5 秒）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('unresponsive_ResponsiveWithin5s_NoDialogAndSendsFreezeRecovered', async () => {
    // UT-ERR-CRC-10 2.3 節（5 秒以内に responsive ならダイアログを出さず freeze:recovered を送る）
    const controller = makeController();
    const { window, emit, send, loadURL } = makeWindow();
    controller.attach(window);

    emit('unresponsive');
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS - 1);
    emit('responsive');
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS * 2);

    expect(showMessageBox).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('freeze:recovered');
    expect(loadURL).not.toHaveBeenCalled(); // フリーズでは無確認で読み込み直さない
  });

  it('unresponsive_After5s_ShowsDialogWithDesignedOptions', async () => {
    // UT-ERR-CRC-11 2.3 節（満了で親の窓を渡して showMessageBox。options は 2.3 節のとおり）
    const controller = makeController();
    const { window, emit, loadURL } = makeWindow();
    controller.attach(window);
    deferDialog();

    emit('unresponsive');
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS - 1);
    expect(showMessageBox).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const [parent, options] = showMessageBox.mock.calls[0]!;
    expect(parent).toBe(window);
    expect(options).toEqual({
      message: '画面が応答していません',
      detail:
        '画面の処理が 5 秒以上止まっています。大きな曲の描画や保存など、重い処理の途中で一時的に止まっているだけのこともあります。このまま待つか、画面を再読み込みしてください。再読み込みすると最後に自動保存した内容で開き直すため、自動保存されていない直前の編集は失われます。',
      buttons: ['待つ', '再読み込み'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'RiFF-LiNE',
      signal: expect.any(AbortSignal),
    });
    expect(loadURL).not.toHaveBeenCalled();
  });

  it('freezeDialog_Wait_RestartsTimerAndShowsAgainAfter5s', async () => {
    // UT-ERR-CRC-12 2.3 節（「待つ」ならタイマーを始め直し、さらに 5 秒応答が無ければもう一度出す）
    const controller = makeController();
    const { window, emit, loadURL } = makeWindow();
    controller.attach(window);
    const first = deferDialog();
    deferDialog();

    emit('unresponsive');
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS);
    first.answer(0);
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS - 1);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(loadURL).not.toHaveBeenCalled();
  });

  it('freezeDialog_Reload_SetsRecoveredAndLoadsStartUrl', async () => {
    // UT-ERR-CRC-13 2.3 節（「再読み込み」なら recovered を立てて loadURL。回数は足さない）
    const controller = makeController();
    const { window, emit, loadURL } = makeWindow();
    controller.attach(window);
    emit('did-navigate', {}, START_URL);
    const dialog = deferDialog();

    emit('unresponsive');
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS);
    dialog.answer(1);
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS * 2);

    expect(loadURL).toHaveBeenCalledWith(START_URL);
    expect(showMessageBox).toHaveBeenCalledTimes(1); // 読み込み直した後はタイマーを始め直さない
    expect(controller.crashCountThisSessionValue(window)).toBe(0);
    expect(controller.consumeRecoveryState(window)).toMatchObject({ recovered: true, repeatedCrash: false });
  });

  it('responsive_WhileDialogShown_AbortsDialogAndDoesNothingElse', async () => {
    // UT-ERR-CRC-14 2.3 節（表示中に応答が戻ったら abort で閉じ、freeze:recovered を送る。戻りは「待つ」として扱わない）
    const controller = makeController();
    const { window, emit, send, loadURL } = makeWindow();
    controller.attach(window);
    deferDialog();

    emit('unresponsive');
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS);
    const signal = showMessageBox.mock.calls[0]![1].signal!;
    emit('responsive');
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS * 2);

    expect(signal.aborted).toBe(true);
    expect(send).toHaveBeenCalledWith('freeze:recovered');
    expect(showMessageBox).toHaveBeenCalledTimes(1); // タイマーを始め直さない
    expect(loadURL).not.toHaveBeenCalled(); // 再読み込みしない
    expect(controller.consumeRecoveryState(window).recovered).toBe(false);
  });

  it('crash_WhileFreezeTimerRunning_CancelsFreezeConfirmation', async () => {
    // UT-ERR-CRC-15 2.3 節（落ちたレンダラーにはフリーズの確認を出さない）
    const controller = makeController();
    const { window, emit, crash } = makeWindow();
    controller.attach(window);

    emit('unresponsive');
    crash('crashed');
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS * 2);

    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('detach_WhileDialogShown_AbortsDialogAndStopsTimer', async () => {
    // UT-ERR-CRC-16 2.3 節（窓が閉じたら出しているダイアログとタイマーも止める）
    const controller = makeController();
    const a = makeWindow({ id: 1 });
    const b = makeWindow({ id: 2 });
    controller.attach(a.window);
    controller.attach(b.window);
    deferDialog();

    a.emit('unresponsive');
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS);
    const signal = showMessageBox.mock.calls[0]![1].signal!;
    b.emit('unresponsive');
    controller.detach(1);
    controller.detach(2);
    await vi.advanceTimersByTimeAsync(FREEZE_CONFIRM_DELAY_MS * 2);

    expect(signal.aborted).toBe(true);
    expect(showMessageBox).toHaveBeenCalledTimes(1); // 窓 2 のタイマーは止まっている
    expect(a.loadURL).not.toHaveBeenCalled();
  });
});
