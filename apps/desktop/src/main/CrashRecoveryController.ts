/**
 * レンダラークラッシュの検知・再読み込み・繰り返し判定（error-logging-foundation.md §2.3・§3.2、
 * 08_error_logging.md §3、06_file_io_persistence.md §9）。
 *
 * `webContents.on('render-process-gone')` を監視し、クラッシュのたびに (1) セッション内カウントを増やし、
 * (2) ウィンドウを再読み込みし、(3) `onCrash` フック（main.ts が Logger.writeCrashLog へ結線）を呼ぶ。
 * レンダラーは起動時に `crash:getRecoveryState` を引き、`recovered` なら SYS-001、`repeatedCrash` なら
 * SYS-002 を `NotificationCenter` へ発行する（本コントローラは通知そのものは行わない）。
 *
 * 暫定仕様（B32 / §2.3）：「同一操作で 3 回」の判定にはコマンド層の直前操作コンテキストが要るため、
 * 本パッケージでは「同一アプリセッション内で 3 回」に簡略化する。精緻化はタブ譜編集コアへ申し送り（§9.4）。
 */

import type { BrowserWindow, RenderProcessGoneDetails } from 'electron';

import type { CrashRecoveryState } from '@riff-line/shared-types';

/** 繰り返しクラッシュと判定するセッション内累積回数（§2.3）。 */
export const REPEATED_CRASH_THRESHOLD = 3;

/** `render-process-gone` のうちクラッシュとして扱わない理由（正常終了）。 */
const NON_CRASH_REASONS: ReadonlySet<string> = new Set(['clean-exit']);

export interface CrashRecoveryControllerOptions {
  /** 繰り返し判定のしきい値（既定 `REPEATED_CRASH_THRESHOLD`）。テスト用に差し替え可能。 */
  threshold?: number;
  /** クラッシュ 1 回ごとに呼ばれる。main.ts が `Logger.writeCrashLog` へ結線する。 */
  onCrash?: (info: { reason: string; crashCountThisSession: number }) => void;
}

export class CrashRecoveryController {
  private crashCountThisSession = 0;
  /** 直近のクラッシュ復旧が未消費か（レンダラーが `getRecoveryState` で 1 回だけ受け取る）。 */
  private recoveryPending = false;
  private readonly threshold: number;
  private readonly onCrash: CrashRecoveryControllerOptions['onCrash'];

  constructor(options: CrashRecoveryControllerOptions = {}) {
    this.threshold = options.threshold ?? REPEATED_CRASH_THRESHOLD;
    this.onCrash = options.onCrash;
  }

  /**
   * 対象ウィンドウの `render-process-gone` を購読する。クラッシュ時はカウントを増やして再読み込みする。
   * 正常終了（`reason === 'clean-exit'`）はクラッシュとして扱わない。
   */
  attach(window: BrowserWindow): void {
    window.webContents.on('render-process-gone', (_event, details: RenderProcessGoneDetails) => {
      if (NON_CRASH_REASONS.has(details.reason)) return;

      this.crashCountThisSession += 1;
      this.recoveryPending = true;
      this.onCrash?.({ reason: details.reason, crashCountThisSession: this.crashCountThisSession });

      // 破棄済みウィンドウを触らない（アプリ終了と同時のクラッシュ等）。
      if (!window.isDestroyed()) {
        window.webContents.reload();
      }
    });
  }

  /**
   * レンダラー起動時に IPC 経由で 1 回呼ばれる。未消費の復旧状態を返し、`recovered` フラグを消費する。
   * `repeatedCrash` はしきい値到達後は毎回 true を返す（案内を出し続ける）。
   */
  consumeRecoveryState(): CrashRecoveryState {
    const state: CrashRecoveryState = {
      recovered: this.recoveryPending,
      repeatedCrash: this.crashCountThisSession >= this.threshold,
    };
    this.recoveryPending = false;
    return state;
  }

  /** セッション内の累積クラッシュ回数（テスト・診断用）。 */
  get crashCountThisSessionValue(): number {
    return this.crashCountThisSession;
  }
}
