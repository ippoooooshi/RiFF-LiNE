/**
 * クローズ確定前の自動保存 flush ハンドシェイク（screens-navigation.md §4.1・§9.0 P2-a、electron.rule.md IPC 規約）。
 *
 * `WindowManager` の `flushAutoSave(songId)` は、対象編集ウィンドウの renderer へ flush を要求し、その完了
 * （または一定時間のタイムアウト）を待ってからウィンドウを破棄する。main はどの `BrowserWindow` が
 * どの曲かを知っているため、ここでトークン付きの `flushAutoSaveRequest`（main→renderer の send）→ `flushAutoSaveAck`
 * （renderer→main の invoke。web-core-foundation.md 6.3 節）を突き合わせる。チャンネル名は `@riff-line/shared-types` の
 * `WINDOW_CHANNELS` 定数（文字列直書き禁止）。ack の要求は形を確かめてから使い（6.2 節）、形が違えば invoke を reject する。
 *
 * renderer 側で実際に `AutoSaveScheduler.flush()` を行う配線は編集ウィンドウ単位の Webコア bootstrap に依存する。
 * 現状の `App.tsx` は受け口（`window.riffLineApi.windows.onFlushAutoSaveRequest`）を登録して即 ack する
 * ＝「ハンドシェイクの往復は実体化済み・実 flush の中身は Phase 1 追い込みで差し込む」状態（§9.0 P2-a）。
 */

import { WINDOW_CHANNELS, type WindowFlushAutoSaveRequest } from '@riff-line/shared-types';

import { parseFlushAck } from './ipcPayload';

/** flush 応答が来ないときにクローズを先へ進めるまでの既定待ち時間（ms）。 */
export const DEFAULT_FLUSH_TIMEOUT_MS = 5000;

/** `BrowserWindow` のうち本ブリッジが使う部分だけ（テストで fake 化するため）。 */
export interface FlushTargetWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
}

/** `ipcMain` のうち ack の受け口（invoke を受ける handle）に使う部分だけ。 */
export interface AckRegistrar {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
}

export class AutoSaveFlushBridge {
  private nextToken = 0;
  /** token → 解決関数（ack もしくはタイムアウトのどちらか早い方で 1 回だけ呼ぶ）。 */
  private readonly pending = new Map<number, () => void>();
  private readonly timeoutMs: number;

  constructor(ackRegistrar: AckRegistrar, timeoutMs: number = DEFAULT_FLUSH_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
    ackRegistrar.handle(WINDOW_CHANNELS.flushAutoSaveAck, async (_event, payload): Promise<void> => {
      const { token } = parseFlushAck(WINDOW_CHANNELS.flushAutoSaveAck, payload);
      // 待っていない token（タイムアウトの後に届いた ack など）は何もしない。
      this.pending.get(token)?.();
    });
  }

  /**
   * 対象ウィンドウの renderer へ flush を要求し、ack かタイムアウトのどちらか早い方まで待つ。
   * ウィンドウが無い / 破棄済みなら即 resolve（待つべき編集状態が無い）。
   */
  requestFlush(songId: string, window: FlushTargetWindow | null): Promise<void> {
    if (window === null || window.isDestroyed()) return Promise.resolve();
    const token = this.nextToken;
    this.nextToken += 1;

    return new Promise<void>((resolve) => {
      const settle = (): void => {
        clearTimeout(timer);
        this.pending.delete(token);
        resolve();
      };
      const timer = setTimeout(settle, this.timeoutMs);
      this.pending.set(token, settle);
      window.webContents.send(WINDOW_CHANNELS.flushAutoSaveRequest, {
        // 6.3 節：main からレンダラーへの知らせは webContents.send <!-- req webcorefoundation:51f64d21.35cc -->
        songId,
        token,
      } satisfies WindowFlushAutoSaveRequest);
    });
  }
}
