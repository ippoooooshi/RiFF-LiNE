// UT-UI-NUB: NotificationUIBinder（screens-navigation.md §4.5・§5.3・§6）
// 検証節: screens-navigation.md §4.5（チャンネル振り分け）、§6（C1: toast/highlight/modal の 3 分岐）
import { describe, expect, it, vi } from 'vitest';

import type { NotificationEvent } from '../errors';

import { NotificationUIBinder, type NotificationSource } from './NotificationUIBinder';

function event(channel: NotificationEvent['channel']): NotificationEvent {
  return { level: 'info', channel, code: 'X-001', message: 'm', timestamp: '2026-09-09T00:00:00.000Z' };
}

/** 購読ハンドラを捕まえて手動発火できる fake。 */
function makeSource(): {
  source: NotificationSource;
  emit: (e: NotificationEvent) => void;
  unsubscribed: () => boolean;
} {
  let handler: ((e: NotificationEvent) => void) | null = null;
  let unsubscribed = false;
  return {
    source: {
      subscribe: (h) => {
        handler = h;
        return () => {
          unsubscribed = true;
          handler = null;
        };
      },
    },
    emit: (e) => handler?.(e),
    unsubscribed: () => unsubscribed,
  };
}

describe('NotificationUIBinder', () => {
  it('NotificationUIBinder_channelごとに対応シンクへ振り分ける（C1: 3分岐）', () => {
    // UT-UI-NUB-01 §4.5・§5.3
    const sinks = { toast: vi.fn(), highlight: vi.fn(), modal: vi.fn() };
    const binder = new NotificationUIBinder(sinks);
    const { source, emit } = makeSource();
    binder.attach(source);

    emit(event('toast'));
    emit(event('highlight'));
    emit(event('modal'));

    expect(sinks.toast).toHaveBeenCalledTimes(1);
    expect(sinks.highlight).toHaveBeenCalledTimes(1);
    expect(sinks.modal).toHaveBeenCalledTimes(1);
  });

  it('NotificationUIBinder_attachは多重呼び出しでも購読を1回に保つ', () => {
    // UT-UI-NUB-02 §4.5（冪等）
    const sinks = { toast: vi.fn(), highlight: vi.fn(), modal: vi.fn() };
    const binder = new NotificationUIBinder(sinks);
    let subscribeCount = 0;
    const source: NotificationSource = {
      subscribe: () => {
        subscribeCount += 1;
        return () => undefined;
      },
    };
    binder.attach(source);
    binder.attach(source);
    expect(subscribeCount).toBe(1);
  });

  it('NotificationUIBinder_detachで購読解除しイベントが届かなくなる', () => {
    // UT-UI-NUB-03 §4.5
    const sinks = { toast: vi.fn(), highlight: vi.fn(), modal: vi.fn() };
    const binder = new NotificationUIBinder(sinks);
    const { source, emit, unsubscribed } = makeSource();
    const off = binder.attach(source);
    off();
    expect(unsubscribed()).toBe(true);
    emit(event('toast'));
    expect(sinks.toast).not.toHaveBeenCalled();
    binder.detach(); // 二重 detach でも安全
  });
});
