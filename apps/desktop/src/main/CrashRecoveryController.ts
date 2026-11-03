/**
 * レンダラーのクラッシュとフリーズの検知・再読み込み・繰り返しクラッシュの判定（error-logging-foundation.md 2.3 節・3.2 節、
 * 08_error_logging.md 3 節、06_file_io_persistence.md 9 節）。
 *
 * main に 1 つ置き、`recovered` と `crashCountThisSession` は窓の id（`BrowserWindow.id`）ごとに分けて持つ（2026-10-29 決定 L2）。
 * 窓を作るたびに main の `WindowManager` が `attach(window)` を呼び、窓が閉じたら `detach(windowId)` でその窓の分を消す。
 * 値は main のプロセスのメモリにだけ持ち、ファイルにも設定にも書かない（アプリを終えると消える）。
 *
 * - クラッシュ（`render-process-gone`、`clean-exit` を除く）：回数を +1 し、`recovered` を立て、`onCrash` を呼び、
 *   破棄済みでなければ起動時と同じ URL を `webContents.loadURL()` で読み込み直す。
 * - フリーズ（`unresponsive`）：再読み込みせず `FREEZE_CONFIRM_DELAY_MS` のタイマーを始める。`responsive` が来たらタイマーと
 *   出しているダイアログを止めて `freeze:recovered` を送る。満了したらネイティブのダイアログで「待つ」「再読み込み」を選ばせる。
 *   無確認では再読み込みしない（基本設計 08 章 3 節、B43）。
 *
 * 通知（SYS-001・SYS-002・SYS-003）そのものは出さない。renderer の `errorLoggingBootstrap` が状態と知らせを受けて `report()` する。
 *
 * 暫定（error-logging-foundation.md 2.3 節）：「同一操作で 3 回」の判定にはコマンド層の直前の操作が要るため、
 * 「同一ウィンドウ・同一アプリセッション内で 3 回」に簡略化している（9.4 節、G32）。
 */
// <!-- req webcorefoundation:7cb842f8.aaf2 -->

// <!-- req errorloggingfoundation:c065ba9a.458e -->
import { REPEATED_CRASH_THRESHOLD } from '@riff-line/core/errors';
import { FREEZE_CHANNELS, type CrashRecoveryState } from '@riff-line/shared-types';
// <!-- req errorloggingfoundation:042fae6c.3ac8 -->
import { APP_DISPLAY_NAME, FREEZE_DIALOG_TEXT } from '@riff-line/ui-desktop/nativeText';
import { dialog, type BrowserWindow, type MessageBoxOptions, type RenderProcessGoneDetails } from 'electron';

/** 繰り返しクラッシュと判定するセッション内累積回数。定義は packages/core（error-logging-foundation.md 4 節の SYS-002）。 */
export { REPEATED_CRASH_THRESHOLD };

/** `unresponsive` から確認のダイアログを出すまでに待つ時間（error-logging-foundation.md 2.3 節、本人決定：案 A・5 秒）。 */
export const FREEZE_CONFIRM_DELAY_MS = 5000;

/** フリーズの確認ダイアログのボタンの番号。0 番の「待つ」が既定と Esc の側（error-logging-foundation.md 2.3 節）。 */
export const FREEZE_DIALOG_WAIT_BUTTON = 0;
export const FREEZE_DIALOG_RELOAD_BUTTON = 1;

/** `render-process-gone` のうちクラッシュとして扱わない理由（正常終了）。 */
const NON_CRASH_REASONS: ReadonlySet<string> = new Set(['clean-exit']);

export interface CrashRecoveryControllerOptions {
  /** 繰り返し判定のしきい値（既定 `REPEATED_CRASH_THRESHOLD`）。テスト用に差し替え可能。 */
  threshold?: number;
  /** クラッシュ 1 回ごとに呼ばれる。main.ts が `Logger.writeCrashLog` へ結線する（2.4 節）。 */
  onCrash?: (info: { reason: string; crashCountThisSession: number }) => void;
  /** `CrashRecoveryState.logFolder` の出どころ。main.ts は `() => logger.getLogFolderAbsolutePath()` を渡す（決定 O3）。 */
  getLogFolder: () => string;
}

/** 窓 1 つ分の状態。 */
interface WindowRecoveryState {
  /** 直前にクラッシュかフリーズから読み込み直したか（renderer が `consumeRecoveryState` で 1 回だけ受け取る）。 */
  recovered: boolean;
  /** その窓の、このアプリセッションでのクラッシュの回数。 */
  crashCountThisSession: number;
  /** 起動時に読み込んだ URL（main frame の `did-navigate` で覚える。ハッシュだけの移り変わりでは変わらない）。 */
  startUrl: string | undefined;
  /** `unresponsive` から確認を出すまでのタイマー。 */
  freezeTimer: ReturnType<typeof setTimeout> | undefined;
  /** 出している確認ダイアログを閉じるための `AbortController`。 */
  freezeDialog: AbortController | undefined;
}

// 10.2 節：1 つの曲のレンダラーが落ちても、読み込み直すのはそのウィンドウのレンダラーだけ（7.2 節の⑦） <!-- req webcorefoundation:a36f574b.9419 --> <!-- req webcorefoundation:a36f574b.c8b9 -->
// <!-- req errorloggingfoundation:efe204dd.f3a7 --> <!-- req errorloggingfoundation:efe204dd.e9c5 --> <!-- req errorloggingfoundation:c7d54f51.4168 --> <!-- req errorloggingfoundation:7654a5b1.8328 -->
// 00_reference.md 3 節：main に置くクラッシュ検知・復旧。通知は出さない <!-- req 00:b0f21041.d69b --> <!-- req 00:b0f21041.5d43 -->
export class CrashRecoveryController {
  private readonly threshold: number;
  private readonly onCrash: CrashRecoveryControllerOptions['onCrash'];
  private readonly getLogFolder: () => string;
  /** 窓の id → その窓の状態。 */
  // <!-- req errorloggingfoundation:efe204dd.400e --> <!-- req errorloggingfoundation:efe204dd.3511 --> <!-- req errorloggingfoundation:efe204dd.ea46 --> <!-- req errorloggingfoundation:bd769cb2.343d --> <!-- req errorloggingfoundation:adb7f025.5df3 -->
  private readonly windows = new Map<number, WindowRecoveryState>();

  // <!-- req errorloggingfoundation:efe204dd.00cc --> <!-- req 00:b0f21041.b08a -->
  constructor(options: CrashRecoveryControllerOptions) {
    this.threshold = options.threshold ?? REPEATED_CRASH_THRESHOLD;
    this.onCrash = options.onCrash;
    // <!-- req errorloggingfoundation:efe204dd.578b -->
    this.getLogFolder = options.getLogFolder;
  }

  /**
   * 窓の `render-process-gone`・`unresponsive`・`responsive`・`did-navigate` を購読し、その窓の状態を 0 から持つ。
   * 正常終了（`reason === 'clean-exit'`）はクラッシュとして扱わない。
   */
  // <!-- req errorloggingfoundation:efe204dd.64be --> <!-- req 00:b0f21041.55f7 -->
  attach(window: BrowserWindow): void {
    const state: WindowRecoveryState = {
      recovered: false,
      crashCountThisSession: 0,
      startUrl: undefined,
      freezeTimer: undefined,
      freezeDialog: undefined,
    };
    // <!-- req errorloggingfoundation:efe204dd.801c --> <!-- req errorloggingfoundation:bd769cb2.20f7 --> <!-- req 00:b0f21041.6f44 -->
    this.windows.set(window.id, state);
    const contents = window.webContents;

    contents.on('did-navigate', (_event, url: string) => {
      state.startUrl = url;
    });

    // <!-- req errorloggingfoundation:efe204dd.5ba1 --> <!-- req errorloggingfoundation:efe204dd.d7ac --> <!-- req errorloggingfoundation:efe204dd.3a65 --> <!-- req errorloggingfoundation:7966a28b.aefc --> <!-- req 00:b0f21041.eae1 -->
    // <!-- req errorloggingfoundation:71ee025b.9472 -->
    // <!-- req errorloggingfoundation:c7e9e456.795f -->
    contents.on('render-process-gone', (_event, details: RenderProcessGoneDetails) => {
      // 7.2 節の⑦：アダプタを通さず main が各ウィンドウの render-process-gone を見張り、そのウィンドウを読み込み直す <!-- req webcorefoundation:8c1e199d.6590 --> <!-- req webcorefoundation:8c1e199d.2f17 --> <!-- req webcorefoundation:8c1e199d.524f --> <!-- req webcorefoundation:8c1e199d.b8e0 --> <!-- req webcorefoundation:8c1e199d.3b8c -->
      // <!-- req errorloggingfoundation:efe204dd.c3b6 --> <!-- req 00:b0f21041.6f34 -->
      if (NON_CRASH_REASONS.has(details.reason)) return;

      // 落ちたレンダラーへのフリーズの確認は意味を失うので止める。
      this.stopFreeze(state);
      // <!-- req errorloggingfoundation:efe204dd.6c67 --> <!-- req 00:b0f21041.2c99 -->
      state.crashCountThisSession += 1;
      state.recovered = true;
      // <!-- req errorloggingfoundation:efe204dd.5a89 --> <!-- req 00:b0f21041.813c -->
      this.onCrash?.({ reason: details.reason, crashCountThisSession: state.crashCountThisSession });

      // 破棄済みウィンドウを触らない（アプリ終了と同時のクラッシュ等）。
      // <!-- req errorloggingfoundation:efe204dd.9052 --> <!-- req errorloggingfoundation:efe204dd.223d --> <!-- req 00:b0f21041.9ee6 -->
      // <!-- req errorloggingfoundation:c7e9e456.708c -->
      if (!window.isDestroyed()) this.loadStartUrl(window, state);
    });

    // フリーズ中は renderer に何も出さず、確認までの時間を数えるだけ（2.3 節の案 A）。
    // <!-- req errorloggingfoundation:7966a28b.cd9d --> <!-- req errorloggingfoundation:7966a28b.cc9a --> <!-- req errorloggingfoundation:007f77db.479f --> <!-- req errorloggingfoundation:2ff74cfb.bfc6 --> <!-- req errorloggingfoundation:2ff74cfb.7180 --> <!-- req 00:a32f7f3d.663c --> <!-- req errorloggingfoundation:cc39d5a9.9515 --> <!-- req 00:b0f21041.7893 -->
    contents.on('unresponsive', () => this.startFreezeTimer(window, state));

    // <!-- req errorloggingfoundation:7966a28b.d56c --> <!-- req errorloggingfoundation:981ed938.fba7 --> <!-- req errorloggingfoundation:930b0462.bc67 --> <!-- req 00:a32f7f3d.f9e5 --> <!-- req 00:b0f21041.8493 -->
    contents.on('responsive', () => {
      this.stopFreeze(state);
      // <!-- req errorloggingfoundation:981ed938.d786 --> <!-- req errorloggingfoundation:930b0462.4285 --> <!-- req 00:b0f21041.04fd -->
      contents.send(FREEZE_CHANNELS.recovered);
    });
  }

  /** 窓が閉じたら、その窓の状態を消す。待っているタイマーと出しているダイアログも止める（決定 L2）。 */
  detach(windowId: number): void {
    const state = this.windows.get(windowId);
    if (state === undefined) return;
    this.stopFreeze(state);
    // <!-- req errorloggingfoundation:efe204dd.03b0 --> <!-- req 00:b0f21041.03b0 -->
    this.windows.delete(windowId);
  }

  /**
   * renderer の起動時に `crash:getRecoveryState` から 1 回呼ばれる。送り手の窓の状態を返し、`recovered` を消費する。
   * `repeatedCrash` はその窓の回数がしきい値に届いた後は毎回 true を返す（案内を出し続ける）。
   * 窓が渡されないとき（送り手が窓でない）と、`attach` していない窓は、未復旧・回数 0 として返す。
   */
  // <!-- req errorloggingfoundation:efe204dd.d513 --> <!-- req errorloggingfoundation:efe204dd.5cce --> <!-- req 00:b0f21041.8dfa -->
  consumeRecoveryState(window: BrowserWindow | null): CrashRecoveryState {
    // 窓が見つからない（null）ときと見張っていない窓は、未復旧・回数 0 として返す（error-logging-foundation.md 2.3 節）
    // <!-- req errorloggingfoundation:efe204dd.3052 --> <!-- req 00:b0f21041.c924 -->
    const state = window === null ? undefined : this.windows.get(window.id);
    // <!-- req errorloggingfoundation:efe204dd.2f62 --> <!-- req 00:b0f21041.4e81 -->
    const result: CrashRecoveryState = {
      recovered: state?.recovered ?? false,
      // <!-- req errorloggingfoundation:efe204dd.968f --> <!-- req errorloggingfoundation:efe204dd.df99 --> <!-- req errorloggingfoundation:efe204dd.22a7 --> <!-- req 00:b0f21041.95d4 -->
      repeatedCrash: (state?.crashCountThisSession ?? 0) >= this.threshold,
      // <!-- req errorloggingfoundation:efe204dd.6a4e --> <!-- req 00:b0f21041.4fb9 -->
      logFolder: this.getLogFolder(),
    };
    // <!-- req errorloggingfoundation:efe204dd.da56 --> <!-- req 00:b0f21041.11e7 -->
    if (state !== undefined) state.recovered = false;
    return result;
  }

  /**
   * 2.5 節の代わりの画面の「画面を開き直す」から呼ばれる。回数を足さず `recovered` も立てずに、
   * 起動時と同じ URL で読み込み直す（2026-10-14 本人決定）。
   */
  // <!-- req errorloggingfoundation:efe204dd.e946 --> <!-- req 00:b0f21041.abd9 -->
  // <!-- req errorloggingfoundation:6947599d.0834 -->
  reloadAfterRenderError(window: BrowserWindow): void {
    // <!-- req errorloggingfoundation:efe204dd.6383 --> <!-- req errorloggingfoundation:efe204dd.e825 --> <!-- req errorloggingfoundation:efe204dd.87b6 -->
    // <!-- req 00:b0f21041.6383 --> <!-- req 00:b0f21041.7b20 --> <!-- req 00:b0f21041.87b6 -->
    // <!-- req errorloggingfoundation:6947599d.ddc8 -->
    // <!-- req errorloggingfoundation:2aeda6ea.f28f -->
    // <!-- req errorloggingfoundation:2aeda6ea.00ab -->
    // <!-- req errorloggingfoundation:2aeda6ea.bbe1 -->
    this.loadStartUrl(window, this.windows.get(window.id));
  }

  /** その窓の、このアプリセッションでのクラッシュの回数（テスト・診断用）。`attach` していない窓は 0。 */
  // <!-- req errorloggingfoundation:efe204dd.6f0e --> <!-- req 00:b0f21041.37d5 -->
  crashCountThisSessionValue(window: BrowserWindow): number {
    // <!-- req errorloggingfoundation:efe204dd.c620 -->
    return this.windows.get(window.id)?.crashCountThisSession ?? 0;
  }

  // ===== 内部 =====

  /** 起動時と同じ URL を読み込む。まだ覚えていない（初めの読み込みが終わる前）ときは今の URL を使う。 */
  private loadStartUrl(window: BrowserWindow, state: WindowRecoveryState | undefined): void {
    // <!-- req errorloggingfoundation:7654a5b1.048d -->
    // <!-- req errorloggingfoundation:6947599d.8f1e -->
    // <!-- req errorloggingfoundation:6947599d.a74d -->
    void window.webContents.loadURL(state?.startUrl ?? window.webContents.getURL());
  }

  /** 確認までのタイマーを（始め直しを含めて）始める。 */
  private startFreezeTimer(window: BrowserWindow, state: WindowRecoveryState): void {
    clearTimeout(state.freezeTimer);
    // <!-- req errorloggingfoundation:7654a5b1.c9dd --> <!-- req 00:b0f21041.6209 -->
    state.freezeTimer = setTimeout(() => {
      state.freezeTimer = undefined;
      // <!-- req errorloggingfoundation:cee708b3.d317 -->
      void this.confirmFreeze(window, state);
      // <!-- req errorloggingfoundation:2ff74cfb.7292 -->
    }, FREEZE_CONFIRM_DELAY_MS);
  }

  /** タイマーと出しているダイアログを止める。 */
  private stopFreeze(state: WindowRecoveryState): void {
    clearTimeout(state.freezeTimer);
    state.freezeTimer = undefined;
    // <!-- req errorloggingfoundation:930b0462.c1c9 -->
    state.freezeDialog?.abort();
    state.freezeDialog = undefined;
  }

  /**
   * 親の窓を渡して確認のダイアログを出す（error-logging-foundation.md 2.3 節の options）。
   * 「待つ」ならタイマーを始め直し、「再読み込み」なら `recovered` を立てて読み込み直す。
   * 応答が戻って閉じられた（`signal.aborted`）ときは、戻りを「待つ」として扱わずに何もしない。
   */
  private async confirmFreeze(window: BrowserWindow, state: WindowRecoveryState): Promise<void> {
    // <!-- req errorloggingfoundation:930b0462.f25f -->
    const controller = new AbortController();
    state.freezeDialog = controller;
    const options: MessageBoxOptions = {
      message: FREEZE_DIALOG_TEXT.message,
      detail: FREEZE_DIALOG_TEXT.detail(FREEZE_CONFIRM_DELAY_MS / 1000),
      // <!-- req errorloggingfoundation:cee708b3.3921 --> <!-- req errorloggingfoundation:cee708b3.4b0b --> <!-- req errorloggingfoundation:042fae6c.9ac7 -->
      buttons: [FREEZE_DIALOG_TEXT.waitButton, FREEZE_DIALOG_TEXT.reloadButton],
      // <!-- req errorloggingfoundation:cee708b3.98ca --> <!-- req errorloggingfoundation:042fae6c.dcf8 -->
      defaultId: FREEZE_DIALOG_WAIT_BUTTON,
      // <!-- req errorloggingfoundation:042fae6c.e49d --> <!-- req errorloggingfoundation:042fae6c.b4a7 -->
      cancelId: FREEZE_DIALOG_WAIT_BUTTON,
      // <!-- req errorloggingfoundation:042fae6c.8f8f -->
      noLink: true,
      // <!-- req errorloggingfoundation:042fae6c.4cf4 -->
      title: APP_DISPLAY_NAME,
      // <!-- req errorloggingfoundation:930b0462.0f73 -->
      signal: controller.signal,
    };
    // <!-- req errorloggingfoundation:cee708b3.01b6 --> <!-- req errorloggingfoundation:042fae6c.b43e --> <!-- req errorloggingfoundation:7654a5b1.107c -->
    const { response } = await dialog.showMessageBox(window, options);
    // <!-- req errorloggingfoundation:930b0462.ae38 --> <!-- req errorloggingfoundation:930b0462.475a --> <!-- req errorloggingfoundation:930b0462.0b68 --> <!-- req errorloggingfoundation:930b0462.64a1 --> <!-- req errorloggingfoundation:930b0462.8aaf -->
    if (controller.signal.aborted) return;
    state.freezeDialog = undefined;

    // <!-- req errorloggingfoundation:cee708b3.ff9c --> <!-- req errorloggingfoundation:cee708b3.79a6 --> <!-- req errorloggingfoundation:e81b2ba9.6f3b -->
    if (response === FREEZE_DIALOG_RELOAD_BUTTON) {
      state.recovered = true;
      this.loadStartUrl(window, state);
      return;
    }
    // <!-- req errorloggingfoundation:cee708b3.94e9 -->
    this.startFreezeTimer(window, state);
  }
}
