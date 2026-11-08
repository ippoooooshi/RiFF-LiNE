/**
 * クローズ確定前の自動保存 flush ハンドシェイク（screens-navigation.md §4.1・§9.0 P2-a、electron.rule.md IPC 規約）。
 *
 * `WindowManager` の `flushAutoSave(songId)` は、対象編集ウィンドウの renderer へ flush を要求し、その完了
 * （書き直しの 1・3・9 秒を含む）を待ってからウィンドウを破棄する。main はどの `BrowserWindow` が
 * どの曲かを知っているため、ここでトークン付きの `flushAutoSaveRequest`（main→renderer の send）→ `flushAutoSaveAck`
 * （renderer→main の invoke。web-core-foundation.md 6.3 節）を突き合わせる。チャンネル名は `@riff-line/shared-types` の
 * `WINDOW_CHANNELS` 定数（文字列直書き禁止）。ack の要求は形を確かめてから使い（6.2 節）、形が違えば invoke を reject する。
 *
 * renderer 側で実際に `AutoSaveScheduler.flush()` を行う配線は編集ウィンドウ単位の Webコア bootstrap に依存する。
 * 現状の `App.tsx` は受け口（`window.riffLineApi.windows.onFlushAutoSaveRequest`）を登録して即 ack する
 * ＝「ハンドシェイクの往復は実体化済み・実 flush の中身は Phase 1 追い込みで差し込む」状態（§9.0 P2-a）。
 *
 * 待ちの打ち切り（error-logging-foundation.md 2.3 節、data-model-persistence.md 15 節、2026-10-29 本人決定 K4）：
 * flush を頼んだ時点から一律に時間を数えて打ち切ることはしない（保存が続いている間は打ち切らない）。
 * 画面のプロセスが落ちた・固まったときだけ、main の `CrashRecoveryController` が `abandonFlush(window)` を呼び、
 * その窓の待ちをすぐ終わらせる。
 */

import { WINDOW_CHANNELS, type WindowFlushAutoSaveRequest } from '@riff-line/shared-types';

import { parseFlushAck } from './ipcPayload';

/** `BrowserWindow` のうち本ブリッジが使う部分だけ（テストで fake 化するため）。`abandonFlush` の鍵にもなる。 */
export interface FlushTargetWindow {
  // <!-- req screensnavigation:4022df52.846e -->
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
}

/** `ipcMain` のうち ack の受け口（invoke を受ける handle）に使う部分だけ。 */
export interface AckRegistrar {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
}

export class AutoSaveFlushBridge {
  // <!-- req errorloggingfoundation:8ad1f1c7.3942 --> <!-- req 00:3405ea3c.c513 --> <!-- req 00:3405ea3c.04e6 -->
  private nextToken = 0;
  /** token → 待っている窓と解決関数（ack か `abandonFlush` のどちらか早い方で 1 回だけ呼ぶ）。 */
  private readonly pending = new Map<number, { window: FlushTargetWindow; settle: () => void }>();

  constructor(ackRegistrar: AckRegistrar) {
    // <!-- req 00:3405ea3c.972e --> <!-- req 00:3405ea3c.a7f7 -->
    ackRegistrar.handle(WINDOW_CHANNELS.flushAutoSaveAck, async (_event, payload): Promise<void> => {
      const { token } = parseFlushAck(WINDOW_CHANNELS.flushAutoSaveAck, payload);
      // 待っていない token（打ち切った後に届いた ack など）は何もしない。
      this.pending.get(token)?.settle(); // <!-- req 00:3405ea3c.115d -->
    });
  }

  /**
   * 対象ウィンドウの renderer へ flush を要求し、ack が来るまで待つ（時間では打ち切らない）。
   * 画面が落ちた・固まったときは `abandonFlush(window)` で待ちを終わらせる（error-logging-foundation.md 2.3 節）。
   * ウィンドウが無い / 破棄済みなら即 resolve（待つべき編集状態が無い）。
   */
  requestFlush(songId: string, window: FlushTargetWindow | null): Promise<void> {
    // <!-- req 00:3405ea3c.047f -->
    // <!-- req errorloggingfoundation:8ad1f1c7.4a8c --> <!-- req errorloggingfoundation:8ad1f1c7.ead6 --> <!-- req datamodelpersistence:ef5424f8.6084 --> <!-- req datamodelpersistence:ef5424f8.3108 --> <!-- req datamodelpersistence:ef5424f8.8fc4 --> <!-- req screensnavigation:4022df52.f29c --> <!-- req screensnavigation:4022df52.8489 --> <!-- req screensnavigation:4022df52.c2da --> <!-- req screensnavigation:4022df52.7ee3 --> <!-- req screensnavigation:4022df52.0300 --> <!-- req 00:3405ea3c.e947 --> <!-- req 00:3405ea3c.109a --> <!-- req 00:3405ea3c.f575 --> <!-- req 00:3405ea3c.ad01 -->
    if (window === null || window.isDestroyed()) return Promise.resolve(); // <!-- req 00:3405ea3c.228a --> <!-- req 00:3405ea3c.7b53 -->
    const token = this.nextToken;
    this.nextToken += 1;

    return new Promise<void>((resolve) => {
      const settle = (): void => {
        this.pending.delete(token); // <!-- req 00:3405ea3c.b19b -->
        resolve();
      };
      this.pending.set(token, { window, settle }); // <!-- req errorloggingfoundation:8ad1f1c7.17e0 --> <!-- req screensnavigation:4022df52.17e0 -->
      window.webContents.send(WINDOW_CHANNELS.flushAutoSaveRequest, {
        // <!-- req 00:3405ea3c.2c07 -->
        // 6.3 節：main からレンダラーへの知らせは webContents.send <!-- req webcorefoundation:f09ef65e.35cc -->
        songId,
        token,
      } satisfies WindowFlushAutoSaveRequest);
    });
  }

  /**
   * その窓の flush の待ちを（複数あれば全部）すぐ終わらせる。鍵は `requestFlush(songId, window)` が受けた窓。
   * main の `CrashRecoveryController` が、その窓の `render-process-gone`（`clean-exit` を除く）と、
   * `unresponsive` が `FREEZE_CONFIRM_DELAY_MS` 続いたときに呼ぶ（error-logging-foundation.md 2.3 節）。
   * 待っていない窓なら何もしない。
   */
  abandonFlush(window: FlushTargetWindow): void {
    // <!-- req errorloggingfoundation:8ad1f1c7.3060 --> <!-- req errorloggingfoundation:8ad1f1c7.7253 --> <!-- req screensnavigation:4022df52.3060 --> <!-- req 00:3405ea3c.9e1c --> <!-- req 00:3405ea3c.2beb -->
    for (const entry of [...this.pending.values()]) {
      if (entry.window === window) entry.settle();
    }
  }
}
