// UT-FLUSH: AutoSaveFlushBridge（screens-navigation.md §4.1・§9.0 P2-a、electron.rule.md IPC 規約）
// 検証節: クローズ確定前の自動保存 flush ハンドシェイク（token 付き request/ack・タイムアウト）
import { WINDOW_CHANNELS } from '@riff-line/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoSaveFlushBridge, type AckRegistrar, type FlushTargetWindow } from './autoSaveFlushBridge';
import { InvalidIpcPayloadError } from './ipcPayload';

/** ipcMain の handle を捕捉し、ack（renderer の invoke）を手動で呼べる fake。 */
function makeAckRegistrar(): {
  registrar: AckRegistrar;
  channel: () => string | null;
  ack: (payload: unknown) => Promise<unknown>;
} {
  let listener: ((event: unknown, payload: unknown) => unknown) | null = null;
  let registered: string | null = null;
  return {
    registrar: {
      handle: (channel, l) => {
        registered = channel;
        listener = l;
      },
    },
    channel: () => registered,
    ack: (payload) => Promise.resolve(listener?.({}, payload)),
  };
}

function makeWindow(destroyed = false): FlushTargetWindow & { sent: Array<{ channel: string; payload: unknown }> } {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    sent,
    isDestroyed: () => destroyed,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
  };
}

describe('AutoSaveFlushBridge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('AutoSaveFlushBridge_ack受信でresolveしタイマーを止める', async () => {
    // UT-FLUSH-01 §4.1（正常ハンドシェイク）
    const { registrar, ack } = makeAckRegistrar();
    const bridge = new AutoSaveFlushBridge(registrar, 5000);
    const win = makeWindow();

    const pending = bridge.requestFlush('song-a', win);
    expect(win.sent).toHaveLength(1);
    expect(win.sent[0]?.channel).toBe(WINDOW_CHANNELS.flushAutoSaveRequest);
    const token = (win.sent[0]?.payload as { token: number }).token;

    await ack({ token });
    await expect(pending).resolves.toBeUndefined();
    // タイマーが残っていないこと（残っていると afterEach で警告にはならないが未解決の副作用になる）。
    expect(vi.getTimerCount()).toBe(0);
  });

  it('AutoSaveFlushBridge_ackが来なければタイムアウトでresolve', async () => {
    // UT-FLUSH-02 §4.1（応答なしでもクローズを進める）
    const { registrar } = makeAckRegistrar();
    const bridge = new AutoSaveFlushBridge(registrar, 3000);
    const pending = bridge.requestFlush('song-a', makeWindow());

    vi.advanceTimersByTime(3000);
    await expect(pending).resolves.toBeUndefined();
  });

  it('AutoSaveFlushBridge_別tokenのackは無視し形の違うackはrejectする', async () => {
    // UT-FLUSH-03 §4.1（token マッチング）・web-core-foundation.md §6.2（受け取った引数を確かめてから使う）
    const { registrar, ack } = makeAckRegistrar();
    const bridge = new AutoSaveFlushBridge(registrar, 3000);
    const pending = bridge.requestFlush('song-a', makeWindow());

    await expect(ack({ token: 999 })).resolves.toBeUndefined();
    await expect(ack({})).rejects.toBeInstanceOf(InvalidIpcPayloadError);
    await expect(ack(undefined)).rejects.toBeInstanceOf(InvalidIpcPayloadError);
    await expect(ack({ token: '0' })).rejects.toBeInstanceOf(InvalidIpcPayloadError);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    vi.advanceTimersByTime(3000);
    await expect(pending).resolves.toBeUndefined();
  });

  it('AutoSaveFlushBridge_ウィンドウがnull/破棄済みなら即resolveしsendしない', async () => {
    // UT-FLUSH-04 §4.1（待つべき編集状態が無い）
    const { registrar } = makeAckRegistrar();
    const bridge = new AutoSaveFlushBridge(registrar);
    await expect(bridge.requestFlush('song-a', null)).resolves.toBeUndefined();
    const destroyed = makeWindow(true);
    await expect(bridge.requestFlush('song-a', destroyed)).resolves.toBeUndefined();
    expect(destroyed.sent).toHaveLength(0);
  });

  it('AutoSaveFlushBridge_複数リクエストはtokenで独立に解決する', async () => {
    // UT-FLUSH-05 §4.1（並行クローズ）
    const { registrar, ack } = makeAckRegistrar();
    const bridge = new AutoSaveFlushBridge(registrar, 5000);
    const winA = makeWindow();
    const winB = makeWindow();
    const pendingA = bridge.requestFlush('song-a', winA);
    const pendingB = bridge.requestFlush('song-b', winB);
    const tokenA = (winA.sent[0]?.payload as { token: number }).token;
    const tokenB = (winB.sent[0]?.payload as { token: number }).token;
    expect(tokenA).not.toBe(tokenB);

    await ack({ token: tokenB });
    await expect(pendingB).resolves.toBeUndefined();
    let aSettled = false;
    void pendingA.then(() => {
      aSettled = true;
    });
    await Promise.resolve();
    expect(aSettled).toBe(false);
    await ack({ token: tokenA });
    await expect(pendingA).resolves.toBeUndefined();
  });

  it('AutoSaveFlushBridge_ackはinvokeの受け口（handle）で受ける', () => {
    // UT-FLUSH-06 web-core-foundation.md §6.3（レンダラーから main への頼みは invoke／handle）・§3.1（preload は invoke を包んだ呼び口）
    const { registrar, channel } = makeAckRegistrar();
    new AutoSaveFlushBridge(registrar);
    expect(channel()).toBe(WINDOW_CHANNELS.flushAutoSaveAck);
  });
});
