// UT-FLUSH: AutoSaveFlushBridge（screens-navigation.md 4.1 節、P2-a、electron.rule.md IPC 規約）
// 検証節: クローズ確定前の自動保存 flush ハンドシェイク（token 付き request/ack）と、時間では打ち切らず
//         abandonFlush(window) でだけ待ちを終わらせること（error-logging-foundation.md 2.3 節、data-model-persistence.md 15 節）
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
    const bridge = new AutoSaveFlushBridge(registrar);
    const win = makeWindow();

    const pending = bridge.requestFlush('song-a', win);
    expect(win.sent).toHaveLength(1);
    expect(win.sent[0]?.channel).toBe(WINDOW_CHANNELS.flushAutoSaveRequest);
    const token = (win.sent[0]?.payload as { token: number }).token;

    await ack({ token });
    await expect(pending).resolves.toBeUndefined();
    // タイマーを使わない（頼んだ時点から時間を数えない）。
    expect(vi.getTimerCount()).toBe(0);
  });

  it('AutoSaveFlushBridge_ackが来なくても時間では打ち切らない', async () => {
    // UT-FLUSH-02 error-logging-foundation.md 2.3 節・data-model-persistence.md 15 節（頼んだ時点から一律に 5 秒で打ち切る形はやめる。
    // 書き直しの 1・3・9 秒を含めて保存が終わるまで待つ）
    const { registrar } = makeAckRegistrar();
    const bridge = new AutoSaveFlushBridge(registrar);
    const pending = bridge.requestFlush('song-a', makeWindow());
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    expect(vi.getTimerCount()).toBe(0);
    // 書き直しの 1・3・9 秒を足した 13 秒より長く待っても終わらない
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
  });

  it('AutoSaveFlushBridge_別tokenのackは無視し形の違うackはrejectする', async () => {
    // UT-FLUSH-03 §4.1（token マッチング）・web-core-foundation.md §6.2（受け取った引数を確かめてから使う）
    const { registrar, ack } = makeAckRegistrar();
    const bridge = new AutoSaveFlushBridge(registrar);
    const win = makeWindow();
    const pending = bridge.requestFlush('song-a', win);

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

    bridge.abandonFlush(win);
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
    const bridge = new AutoSaveFlushBridge(registrar);
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

  it('AutoSaveFlushBridge_abandonFlush_その窓の待ちを全部すぐ終わらせ別の窓の待ちは残す', async () => {
    // UT-FLUSH-07 error-logging-foundation.md 2.3 節（鍵は requestFlush(songId, window) が受ける窓。呼ぶとその窓の flush の待ちをすぐ終わらせる）
    const { registrar, ack } = makeAckRegistrar();
    const bridge = new AutoSaveFlushBridge(registrar);
    const winA = makeWindow();
    const winB = makeWindow();
    const pendingA1 = bridge.requestFlush('song-a', winA);
    const pendingA2 = bridge.requestFlush('song-a', winA);
    const pendingB = bridge.requestFlush('song-b', winB);
    let bSettled = false;
    void pendingB.then(() => {
      bSettled = true;
    });

    bridge.abandonFlush(winA);

    await expect(pendingA1).resolves.toBeUndefined();
    await expect(pendingA2).resolves.toBeUndefined();
    expect(bSettled).toBe(false);
    // 打ち切った後に届いた ack は何もしない
    const tokenA = (winA.sent[0]?.payload as { token: number }).token;
    await expect(ack({ token: tokenA })).resolves.toBeUndefined();
    expect(bSettled).toBe(false);
    const tokenB = (winB.sent[0]?.payload as { token: number }).token;
    await ack({ token: tokenB });
    await expect(pendingB).resolves.toBeUndefined();
  });

  it('AutoSaveFlushBridge_abandonFlush_待っていない窓とack済みの窓では何もしない', async () => {
    // UT-FLUSH-08 error-logging-foundation.md 2.3 節（待ちの無い窓へ呼ばれても他の待ちに触らない）
    const { registrar, ack } = makeAckRegistrar();
    const bridge = new AutoSaveFlushBridge(registrar);
    const stranger = makeWindow();
    expect(() => bridge.abandonFlush(stranger)).not.toThrow();

    const win = makeWindow();
    const pending = bridge.requestFlush('song-a', win);
    const token = (win.sent[0]?.payload as { token: number }).token;
    await ack({ token });
    await expect(pending).resolves.toBeUndefined();
    expect(() => bridge.abandonFlush(win)).not.toThrow();

    const other = makeWindow();
    const otherPending = bridge.requestFlush('song-b', other);
    let settled = false;
    void otherPending.then(() => {
      settled = true;
    });
    bridge.abandonFlush(stranger);
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});
