// UT-ERR-CRC: error-logging-foundation.md §2.3・§3.2、08_error_logging.md §3 — CrashRecoveryController
// 検証観点: render-process-gone 購読、クラッシュ時のカウント増加＋reload、clean-exit 無視、
//           consumeRecoveryState の recovered 一回消費 / repeatedCrash しきい値、destroyed 窓は触らない（C0/C1）。

import { describe, expect, it, vi } from 'vitest';

import type { BrowserWindow, RenderProcessGoneDetails } from 'electron';

import { CrashRecoveryController, REPEATED_CRASH_THRESHOLD } from './CrashRecoveryController';

type GoneListener = (event: unknown, details: RenderProcessGoneDetails) => void;

/** render-process-gone を任意に発火できる最小の BrowserWindow スタブ。 */
function makeWindow(options: { destroyed?: boolean } = {}): {
  window: BrowserWindow;
  fire: (reason: string) => void;
  reload: ReturnType<typeof vi.fn>;
} {
  const reload = vi.fn();
  let listener: GoneListener | undefined;
  const window = {
    isDestroyed: () => options.destroyed ?? false,
    webContents: {
      on: (channel: string, cb: GoneListener) => {
        if (channel === 'render-process-gone') listener = cb;
      },
      reload,
    },
  } as unknown as BrowserWindow;
  return {
    window,
    reload,
    fire: (reason: string) => listener?.({}, { reason, exitCode: 1 } as RenderProcessGoneDetails),
  };
}

describe('CrashRecoveryController', () => {
  it('REPEATED_CRASH_THRESHOLD_Is3', () => {
    expect(REPEATED_CRASH_THRESHOLD).toBe(3);
  });

  it('attach_RenderProcessGone_IncrementsCountReloadsAndFiresOnCrash', () => {
    const onCrash = vi.fn();
    const controller = new CrashRecoveryController({ onCrash });
    const { window, fire, reload } = makeWindow();
    controller.attach(window);

    fire('crashed');

    expect(controller.crashCountThisSessionValue).toBe(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onCrash).toHaveBeenCalledWith({ reason: 'crashed', crashCountThisSession: 1 });
  });

  it('attach_CleanExit_IsIgnored', () => {
    const onCrash = vi.fn();
    const controller = new CrashRecoveryController({ onCrash });
    const { window, fire, reload } = makeWindow();
    controller.attach(window);

    fire('clean-exit');

    expect(controller.crashCountThisSessionValue).toBe(0);
    expect(reload).not.toHaveBeenCalled();
    expect(onCrash).not.toHaveBeenCalled();
  });

  it('attach_DestroyedWindow_DoesNotReload', () => {
    const controller = new CrashRecoveryController();
    const { window, fire, reload } = makeWindow({ destroyed: true });
    controller.attach(window);

    fire('crashed');

    expect(controller.crashCountThisSessionValue).toBe(1); // カウントはする
    expect(reload).not.toHaveBeenCalled(); // 破棄済みウィンドウは触らない
  });

  it('consumeRecoveryState_AfterCrash_RecoveredTrueThenClearedOnSecondCall', () => {
    const controller = new CrashRecoveryController();
    const { window, fire } = makeWindow();
    controller.attach(window);

    expect(controller.consumeRecoveryState()).toEqual({ recovered: false, repeatedCrash: false });

    fire('crashed');
    expect(controller.consumeRecoveryState()).toEqual({ recovered: true, repeatedCrash: false });
    expect(controller.consumeRecoveryState()).toEqual({ recovered: false, repeatedCrash: false });
  });

  it('consumeRecoveryState_AtThreshold_RepeatedCrashStaysTrue', () => {
    const controller = new CrashRecoveryController({ threshold: 3 });
    const { window, fire } = makeWindow();
    controller.attach(window);

    fire('crashed');
    fire('crashed');
    expect(controller.consumeRecoveryState().repeatedCrash).toBe(false);

    fire('crashed');
    expect(controller.consumeRecoveryState()).toEqual({ recovered: true, repeatedCrash: true });
    // recovered は消費済みだが repeatedCrash はしきい値到達後ずっと true。
    expect(controller.consumeRecoveryState()).toEqual({ recovered: false, repeatedCrash: true });
  });

  it('constructor_CustomThreshold_Respected', () => {
    const controller = new CrashRecoveryController({ threshold: 1 });
    const { window, fire } = makeWindow();
    controller.attach(window);
    fire('oom');
    expect(controller.consumeRecoveryState().repeatedCrash).toBe(true);
  });
});
