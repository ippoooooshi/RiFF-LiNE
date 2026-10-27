// UT-PERSIST-AUTOSAVE: `AutoSaveScheduler`（自動保存の時機・書き直し・flush・pause と resume）
// 検証節: data-model-persistence.md 15 節
// 検証観点: 編集が止まってから 2 秒、最後の保存（まだ保存していない曲では最初の未保存の編集）から 10 秒、
// 書き直し（1 秒・3 秒・9 秒）→ 成功／尽きて FILE-001、flush、pause と resume、onSaved を待たない、dispose（C0/C1）。

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { SongDocument } from '../domain/SongDocument';
import type { NotificationEvent } from '../errors';
import { notificationCenter } from '../errors';

import { AutoSaveScheduler, autoSaveWaitMs } from './AutoSaveScheduler';
import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_DELAY_MS, AUTOSAVE_RETRY_DELAYS_MS } from './constants';
import type { SongRepository } from './SongRepository';

const doc = { id: 's1' } as SongDocument;

let save: Mock<(document: SongDocument) => Promise<void>>;
let repo: SongRepository;
let onSaved: Mock<(songId: string) => void | Promise<void>>;
let onError: Mock<(songId: string, error: unknown) => void>;
let scheduler: AutoSaveScheduler;
let reported: NotificationEvent[];
let unsubscribe: () => void;

/** 1 回目の save を止めておき、release で進める。 */
function gateFirstSave(): () => void {
  let release!: () => void;
  save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return () => release();
}

beforeEach(() => {
  vi.useFakeTimers();
  save = vi.fn<(document: SongDocument) => Promise<void>>().mockResolvedValue(undefined);
  repo = { save } as unknown as SongRepository;
  onSaved = vi.fn<(songId: string) => void | Promise<void>>();
  onError = vi.fn<(songId: string, error: unknown) => void>();
  scheduler = new AutoSaveScheduler(repo, (id) => (id === 's1' ? doc : undefined), { onSaved, onError });
  reported = [];
  unsubscribe = notificationCenter.subscribe((event) => reported.push(event));
});

afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AutoSaveScheduler debounce', () => {
  it('notifyDirty_SavesAfterDebounceInterval', async () => {
    // UT-PERSIST-AUTOSAVE-01 15 節：編集が止まってから 2 秒（AUTOSAVE_DEBOUNCE_MS）で SongRepository.save を呼ぶ
    expect(AUTOSAVE_DEBOUNCE_MS).toBe(2000);
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(doc);
    expect(onSaved).toHaveBeenCalledWith('s1');
  });

  it('notifyDirty_RepeatedWithinDebounce_CoalescesToOneSave', async () => {
    // UT-PERSIST-AUTOSAVE-02 編集が続く間は 2 秒を数え直す
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(1500);
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(1500);
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('notifyDirty_ContinuousEditsNeverSaved_SavesTenSecondsAfterFirstUnsavedEdit', async () => {
    // UT-PERSIST-AUTOSAVE-03 15 節：まだ一度も保存していない曲では、10 秒は最初の未保存の編集から数え、止まるのを待たずに保存する
    expect(AUTOSAVE_MAX_DELAY_MS).toBe(10000);
    scheduler.notifyDirty('s1');
    for (let elapsed = 1500; elapsed < AUTOSAVE_MAX_DELAY_MS; elapsed += 1500) {
      await vi.advanceTimersByTimeAsync(1500);
      scheduler.notifyDirty('s1');
    }
    // ここで 9000ms。最初の編集から 10 秒の手前では保存しない。
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_DELAY_MS - 9000 - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('notifyDirty_UnknownSong_SkipsSaveAndClears', async () => {
    // UT-PERSIST-AUTOSAVE-04
    scheduler.notifyDirty('ghost');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).not.toHaveBeenCalled();
    await scheduler.flush('ghost'); // 片付けた後は何もしない
    expect(save).not.toHaveBeenCalled();
  });

  it('notifyDirty_ContinuousEditsAfterSave_SavesTenSecondsAfterLastSave', async () => {
    // UT-PERSIST-AUTOSAVE-10 15 節：編集が続いていても、最後の保存から 10 秒たったら保存する
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS); // t=2000 に 1 回目（最後の保存）
    expect(save).toHaveBeenCalledTimes(1);
    for (let t = 2000 + 500; t <= 11500; t += 1500) {
      await vi.advanceTimersByTimeAsync(t === 2500 ? 500 : 1500);
      scheduler.notifyDirty('s1');
    }
    // t=11500。最後の保存（t=2000）から 10 秒は t=12000。
    await vi.advanceTimersByTimeAsync(499);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('notifyDirty_LongAfterLastSave_SavesWithoutWaitingDebounce', async () => {
    // UT-PERSIST-AUTOSAVE-11 15 節：最後の保存から 10 秒たっていれば、止まるのを待たずに保存する
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(60_000);
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('notifyDirty_EditDuringSave_SavesAgainAfterDebounceNotImmediately', async () => {
    // UT-PERSIST-AUTOSAVE-12 保存の途中の編集は、その保存が終わった後にふつうの秒数で保存する
    const release = gateFirstSave();
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    scheduler.notifyDirty('s1');
    release();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('autoSaveWaitMs', () => {
  it('autoSaveWaitMs_PicksShorterOfDebounceAndRemainingToDeadline', () => {
    // UT-PERSIST-AUTOSAVE-13 15 節：2 秒と 10 秒の期限までの残りの短いほう。起点は最後の保存、無ければ最初の未保存の編集
    expect(autoSaveWaitMs(1000, undefined, 0)).toBe(AUTOSAVE_DEBOUNCE_MS);
    expect(autoSaveWaitMs(9000, undefined, 0)).toBe(1000);
    expect(autoSaveWaitMs(9000, 5000, 0)).toBe(AUTOSAVE_DEBOUNCE_MS);
    expect(autoSaveWaitMs(14500, 5000, 0)).toBe(500);
    expect(autoSaveWaitMs(99_000, 5000, 0)).toBe(0);
  });
});

describe('AutoSaveScheduler retry', () => {
  it('runSave_TransientFailures_RetriesThenSucceeds', async () => {
    // UT-PERSIST-AUTOSAVE-05 15 節：保存が失敗したら 1 秒・3 秒の間を空けて書き直す
    expect(AUTOSAVE_RETRY_DELAYS_MS).toEqual([1000, 3000, 9000]);
    save.mockRejectedValueOnce(new Error('e1')).mockRejectedValueOnce(new Error('e2')).mockResolvedValueOnce(undefined);

    scheduler.notifyDirty('s1');
    const flushed = scheduler.flush('s1');
    await vi.advanceTimersByTimeAsync(999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    await flushed;

    expect(save).toHaveBeenCalledTimes(3);
    expect(onSaved).toHaveBeenCalledWith('s1');
    expect(onError).not.toHaveBeenCalled();
  });

  it('runSave_AllRetriesFail_ReportsFile001AndCallsOnErrorWithoutThrowing', async () => {
    // UT-PERSIST-AUTOSAVE-06 15 節：3 回まで書き直し、それでも失敗したら Error の FILE-001。保存の成功は知らせない
    save.mockRejectedValue(new Error('always'));

    scheduler.notifyDirty('s1');
    const flushed = scheduler.flush('s1');
    await vi.advanceTimersByTimeAsync(1000 + 3000 + 9000);
    await expect(flushed).resolves.toBeUndefined();

    expect(save).toHaveBeenCalledTimes(4); // 1 回目 + 書き直し 3 回
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    const file001 = reported.filter((event) => event.code === 'FILE-001');
    expect(file001).toHaveLength(1);
    expect(file001[0]?.level).toBe('error');
    expect(file001[0]?.context).toMatchObject({ songId: 's1' });
  });

  it('runSave_AllRetriesFail_KeepsEditsUnsavedForNextFlushAndEdit', async () => {
    // UT-PERSIST-AUTOSAVE-14 書き直しが尽きた編集は未保存のまま残す（次の flush と次の編集で保存し直す）。尽きた直後には予約しない
    save.mockRejectedValueOnce(new Error('1')).mockRejectedValueOnce(new Error('2'));
    save.mockRejectedValueOnce(new Error('3')).mockRejectedValueOnce(new Error('4'));
    scheduler.notifyDirty('s1');
    const failing = scheduler.flush('s1');
    await vi.advanceTimersByTimeAsync(13_000);
    await failing;
    expect(save).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(4);

    await scheduler.flush('s1');
    expect(save).toHaveBeenCalledTimes(5);
    expect(onSaved).toHaveBeenCalledTimes(1);

    // 失敗の後の編集は、ふつうに予約される。
    save.mockRejectedValueOnce(new Error('5')).mockRejectedValueOnce(new Error('6'));
    save.mockRejectedValueOnce(new Error('7')).mockRejectedValueOnce(new Error('8'));
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 13_000);
    expect(save).toHaveBeenCalledTimes(9);
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(0); // 未保存の編集が最後の保存から 10 秒を越えているので待たない
    expect(save).toHaveBeenCalledTimes(10);
  });
});

describe('AutoSaveScheduler flush / dispose', () => {
  it('flush_SavesImmediatelyWithoutWaitingDebounce', async () => {
    // UT-PERSIST-AUTOSAVE-07 15 節：flush は未保存の編集があれば待たずに保存する
    scheduler.notifyDirty('s1');
    await scheduler.flush('s1');
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(save).toHaveBeenCalledTimes(1); // 予約していた保存は取り消した
  });

  it('flush_WhileSaveInFlight_ResolvesOnlyAfterInFlightAndRerunSettle', async () => {
    // UT-PERSIST-AUTOSAVE-08 15 節：保存の途中で呼ばれたら、その保存が終わった後に、まだ未保存の編集があればもう 1 回保存してから終える
    const release = gateFirstSave();
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);

    scheduler.notifyDirty('s1');
    let flushResolved = false;
    const flushing = scheduler.flush('s1').then(() => {
      flushResolved = true;
    });
    await Promise.resolve();
    expect(flushResolved).toBe(false);

    release();
    await flushing;
    expect(flushResolved).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('dispose_CancelsPendingSave', async () => {
    // UT-PERSIST-AUTOSAVE-09
    scheduler.notifyDirty('s1');
    scheduler.dispose('s1');
    scheduler.dispose('never-seen');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it('flush_NoUnsavedEdits_DoesNotSave', async () => {
    // UT-PERSIST-AUTOSAVE-15 15 節：flush が保存するのは未保存の編集があるときだけ
    await scheduler.flush('s1'); // 一度も編集の知らせが無い
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    await scheduler.flush('s1'); // 保存した後に編集が無い
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush_WhileSaveInFlightWithoutNewEdits_DoesNotSaveAgain', async () => {
    // UT-PERSIST-AUTOSAVE-16 15 節：保存の途中で呼ばれても、その後に未保存の編集が無ければもう 1 回は保存しない
    const release = gateFirstSave();
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    const flushing = scheduler.flush('s1');
    release();
    await flushing;
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('dispose_DuringSaveWithNewEdits_DoesNotSaveAgain', async () => {
    // UT-PERSIST-AUTOSAVE-17 dispose の後は、進んでいる保存が終わっても次の保存を予約しない（flush を頼まれていても）
    const release = gateFirstSave();
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    scheduler.notifyDirty('s1');
    const flushing = scheduler.flush('s1');
    scheduler.dispose('s1');
    release();
    await flushing;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('AutoSaveScheduler pause / resume', () => {
  it('pause_CancelsPendingSaveAndHoldsEditsUntilResume', async () => {
    // UT-PERSIST-AUTOSAVE-18 15 節：pause() は待っている保存を取り消し、resume() まで保存しない。止めている間の notifyDirty は未保存として覚える
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(500);
    scheduler.pause();
    scheduler.notifyDirty('s1');
    await scheduler.flush('s1'); // 止めている間は flush でも保存しない
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();

    // t=1000 で再開。上の秒数（2 秒、最初の未保存の編集 t=0 から 10 秒の期限より前）で保存する。
    scheduler.resume();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('resume_AfterLongPause_SavesByTenSecondRuleWithoutWaiting', async () => {
    // UT-PERSIST-AUTOSAVE-19 15 節：resume() の後は上の秒数で保存する（最初の未保存の編集から 10 秒を越えていれば待たない）
    scheduler.notifyDirty('s1');
    scheduler.pause();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(save).not.toHaveBeenCalled();
    scheduler.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('pause_DuringSaveWithFlushRequested_StopsAndSavesAfterResume', async () => {
    // UT-PERSIST-AUTOSAVE-20 保存の途中で止めたら、進んでいる保存の後のもう 1 回は resume() の後へ回す
    const release = gateFirstSave();
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    scheduler.notifyDirty('s1');
    const flushing = scheduler.flush('s1');
    scheduler.pause();
    release();
    await flushing;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);

    scheduler.resume();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('resume_NoUnsavedEdits_DoesNotSave', async () => {
    // UT-PERSIST-AUTOSAVE-21 未保存の編集が無ければ resume() で保存しない
    scheduler.notifyDirty('s1');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    scheduler.pause();
    scheduler.resume();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('AutoSaveScheduler onSaved', () => {
  it('onSaved_ReturnsPendingPromise_SaveFlowDoesNotWaitForIt', async () => {
    // UT-PERSIST-AUTOSAVE-22 15 節の 6：onSaved が始めるミラーの写しとサムネイルの作り直しを待たない
    onSaved.mockImplementation(() => new Promise<void>(() => {}));
    scheduler.notifyDirty('s1');
    await scheduler.flush('s1'); // onSaved の Promise が終わらなくても flush は終わる
    expect(onSaved).toHaveBeenCalledWith('s1');
  });

  it('onSaved_RejectsOrThrows_DoesNotBreakSaving', async () => {
    // UT-PERSIST-AUTOSAVE-23 onSaved の失敗は中で受け、保存の処理を止めない
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onSaved.mockImplementationOnce(() => Promise.reject(new Error('mirror down')));
    onSaved.mockImplementationOnce(() => {
      throw new Error('thumbnail down');
    });
    scheduler.notifyDirty('s1');
    await scheduler.flush('s1');
    await vi.advanceTimersByTimeAsync(0);
    scheduler.notifyDirty('s1');
    await expect(scheduler.flush('s1')).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(reported).toEqual([]);
  });

  it('constructor_WithoutHooks_SavesNormally', async () => {
    // UT-PERSIST-AUTOSAVE-24 フックを渡さなくても保存する
    const plain = new AutoSaveScheduler(repo, () => doc);
    plain.notifyDirty('s1');
    await plain.flush('s1');
    expect(save).toHaveBeenCalledTimes(1);
  });
});
