// UT: data-model-persistence.md §3.2・§4.3・§9.1、FILE-001 — AutoSaveScheduler
// 検証観点: デバウンス 3 秒、最大遅延 10 秒、リトライ（1s/3s/9s）→ 成功／全滅、flush、dispose（C0/C1）。

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { SongDocument } from '../domain/SongDocument';
import type { NotificationEvent } from '../errors';
import { notificationCenter } from '../errors';

import { AutoSaveScheduler } from './AutoSaveScheduler';
import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_DELAY_MS } from './constants';
import type { SongRepository } from './SongRepository';

const doc = { id: 's1' } as SongDocument;

let save: Mock<(document: SongDocument) => Promise<void>>;
let repo: SongRepository;
let onSaved: Mock<(songId: string) => void>;
let onError: Mock<(songId: string, error: unknown) => void>;
let scheduler: AutoSaveScheduler;
let reported: NotificationEvent[];
let unsubscribe: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  save = vi.fn<(document: SongDocument) => Promise<void>>().mockResolvedValue(undefined);
  repo = { save } as unknown as SongRepository;
  onSaved = vi.fn<(songId: string) => void>();
  onError = vi.fn<(songId: string, error: unknown) => void>();
  scheduler = new AutoSaveScheduler(repo, (id) => (id === 's1' ? doc : undefined), { onSaved, onError });
  reported = [];
  unsubscribe = notificationCenter.subscribe((event) => reported.push(event));
});

afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
});

describe('AutoSaveScheduler debounce', () => {
  it('notifyDirty_SavesAfterDebounceInterval', async () => {
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith('s1');
  });

  it('notifyDirty_RepeatedWithinDebounce_CoalescesToOneSave', async () => {
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('notifyDirty_ContinuousEdits_ForceFlushAtMaxDelay', async () => {
    scheduler.notifyDirty('s1');
    // 最大遅延を超えないよう 2 秒ごとに叩き続ける。
    for (let elapsed = 0; elapsed < AUTOSAVE_MAX_DELAY_MS; elapsed += 2000) {
      await vi.advanceTimersByTimeAsync(2000);
      scheduler.notifyDirty('s1');
    }
    // 最初の dirty から 10 秒の時点で 1 回は保存されている。
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('notifyDirty_UnknownSong_SkipsSaveAndClears', async () => {
    scheduler.notifyDirty('ghost');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('AutoSaveScheduler retry', () => {
  it('runSave_TransientFailures_RetriesThenSucceeds', async () => {
    save.mockRejectedValueOnce(new Error('e1')).mockRejectedValueOnce(new Error('e2')).mockResolvedValueOnce(undefined);

    const flushed = scheduler.flush('s1');
    // 1s + 3s のバックオフを消化する。
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);
    await flushed;

    expect(save).toHaveBeenCalledTimes(3);
    expect(onSaved).toHaveBeenCalledWith('s1');
    expect(onError).not.toHaveBeenCalled();
  });

  it('runSave_AllRetriesFail_ReportsFile001AndCallsOnErrorWithoutThrowing', async () => {
    save.mockRejectedValue(new Error('always'));

    const flushed = scheduler.flush('s1');
    await vi.advanceTimersByTimeAsync(1000 + 3000 + 9000);
    await expect(flushed).resolves.toBeUndefined();

    expect(save).toHaveBeenCalledTimes(4); // 初回 + 3 リトライ
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    // error-logging-foundation.md §9.2: リトライ全滅は FILE-001（Error）で通知する。
    const file001 = reported.filter((event) => event.code === 'FILE-001');
    expect(file001).toHaveLength(1);
    expect(file001[0]?.level).toBe('error');
    expect(file001[0]?.context).toMatchObject({ songId: 's1' });
  });
});

describe('AutoSaveScheduler flush / dispose', () => {
  it('flush_SavesImmediatelyWithoutWaitingDebounce', async () => {
    scheduler.notifyDirty('s1');
    await scheduler.flush('s1');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush_WhileSaveInFlight_ResolvesOnlyAfterInFlightAndRerunSettle', async () => {
    // 進行中の保存 I/O を手動ゲートで止める（fake timer ではなく明示 Promise）。
    let releaseFirst!: () => void;
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );

    // 1) デバウンス発火 → 1回目の保存が進行中（ゲートで停止）。
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);

    // 2) 保存中にさらに編集（rerun 要求）→ すぐ flush。
    scheduler.notifyDirty('s1');
    let flushResolved = false;
    const flushing = scheduler.flush('s1').then(() => {
      flushResolved = true;
    });

    // 3) in-flight 保存が終わる前は flush は解決しない。
    await Promise.resolve();
    expect(flushResolved).toBe(false);

    // 4) 1回目を解放 → rerun 分（2回目）が走る。
    releaseFirst();
    await flushing;

    expect(flushResolved).toBe(true);
    expect(save).toHaveBeenCalledTimes(2); // in-flight + rerun。flush はどちらも待った
  });

  it('dispose_CancelsPendingSave', async () => {
    scheduler.notifyDirty('s1');
    scheduler.dispose('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });
});
