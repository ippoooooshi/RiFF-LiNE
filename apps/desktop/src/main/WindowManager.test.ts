// UT-WIN: WindowManager（screens-navigation.md §4.1・§5.1・§6）
// 検証節: screens-navigation.md §4.1（複数ウィンドウ管理・重複防止・クローズ時 flush）、§6（focusExistingWindow の複合条件 C2）
import { describe, expect, it, vi } from 'vitest';

import { WindowManager, type EditWindowInstances, type ManagedWindow, type WindowManagerDeps } from './WindowManager';

/** クローズ割り込みを手動発火できる fake ウィンドウ。 */
function makeWindow(
  id: number,
  opts: { minimized?: boolean } = {},
): ManagedWindow & {
  fireClose: () => void;
  fireClosed: () => void;
  focus: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  const closeHandlers: Array<(e: { preventDefault: () => void }) => void> = [];
  const closedHandlers: Array<() => void> = [];
  const focus = vi.fn();
  const restore = vi.fn();
  const destroy = vi.fn();
  return {
    id,
    focus,
    isMinimized: () => opts.minimized ?? false,
    restore,
    onClose: (h) => closeHandlers.push(h),
    onClosed: (h) => closedHandlers.push(h),
    destroy,
    fireClose: () => closeHandlers.forEach((h) => h({ preventDefault: () => undefined })),
    fireClosed: () => closedHandlers.forEach((h) => h()),
  };
}

function makeDeps(over: Partial<WindowManagerDeps> = {}): WindowManagerDeps & {
  instances: EditWindowInstances & { dispose: ReturnType<typeof vi.fn> };
  flush: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn();
  const instances = { dispose };
  const flush = vi.fn(() => Promise.resolve());
  return {
    createSongListWindow: over.createSongListWindow ?? (() => makeWindow(1)),
    createEditWindow: over.createEditWindow ?? ((_songId) => makeWindow(100)),
    createEditWindowInstances: over.createEditWindowInstances ?? (() => instances),
    flushAutoSave: over.flushAutoSave ?? flush,
    instances,
    flush,
  };
}

describe('WindowManager.openSongListWindow', () => {
  it('WindowManager_曲一覧は1枚だけ生成し2回目は前面化する', () => {
    // UT-WIN-01 §5.1
    const create = vi.fn(() => makeWindow(1));
    const wm = new WindowManager(makeDeps({ createSongListWindow: create }));
    wm.openSongListWindow();
    wm.openSongListWindow();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('WindowManager_曲一覧が最小化中なら復帰してから前面化', () => {
    // UT-WIN-02 §5.1
    const win = makeWindow(1, { minimized: true });
    const wm = new WindowManager(makeDeps({ createSongListWindow: () => win }));
    wm.openSongListWindow();
    wm.openSongListWindow();
    expect(win.restore).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
  });
});

describe('WindowManager.focusExistingWindow（複合条件 C2、screens-navigation.md §6）', () => {
  it('WindowManager_未オープン_新規生成しインスタンス一式を紐付けてfalseを返す', () => {
    // UT-WIN-03 §4.1（既存なし分岐）
    const createEditWindow = vi.fn((_songId: string) => makeWindow(100));
    const createEditWindowInstances = vi.fn(() => ({ dispose: vi.fn() }));
    const wm = new WindowManager(makeDeps({ createEditWindow, createEditWindowInstances }));
    const wasExisting = wm.focusExistingWindow('song-a');
    expect(wasExisting).toBe(false);
    expect(createEditWindow).toHaveBeenCalledWith('song-a');
    expect(createEditWindowInstances).toHaveBeenCalledWith('song-a');
    expect(wm.listOpenEditWindowSongIds()).toEqual(['song-a']);
  });

  it('WindowManager_既存あり非最小化_focusのみでtrueを返す', () => {
    // UT-WIN-04 §4.1（既存あり・非最小化分岐）
    const win = makeWindow(100, { minimized: false });
    const wm = new WindowManager(makeDeps({ createEditWindow: () => win }));
    wm.focusExistingWindow('song-a');
    const wasExisting = wm.focusExistingWindow('song-a');
    expect(wasExisting).toBe(true);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.restore).not.toHaveBeenCalled();
  });

  it('WindowManager_既存あり最小化_restore後にfocusしてtrueを返す', () => {
    // UT-WIN-05 §4.1（既存あり・最小化分岐）
    const win = makeWindow(100, { minimized: true });
    const wm = new WindowManager(makeDeps({ createEditWindow: () => win }));
    wm.focusExistingWindow('song-a');
    const wasExisting = wm.focusExistingWindow('song-a');
    expect(wasExisting).toBe(true);
    expect(win.restore).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  it('WindowManager_別songIdは別ウィンドウとして管理される', () => {
    // UT-WIN-06 §4.1（複数編集ウィンドウの独立管理、§5.1）
    let nextId = 100;
    const wm = new WindowManager(makeDeps({ createEditWindow: () => makeWindow(nextId++) }));
    wm.focusExistingWindow('song-a');
    wm.focusExistingWindow('song-b');
    expect(wm.listOpenEditWindowSongIds().sort()).toEqual(['song-a', 'song-b']);
  });
});

describe('WindowManager クローズ時の後始末（screens-navigation.md §4.1）', () => {
  it('WindowManager_close割り込みでflush完了を待ってからdestroy+dispose', async () => {
    // UT-WIN-07 §4.1（AutoSaveScheduler.flush(songId) を待つ）
    const win = makeWindow(100);
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push('flush');
    });
    const dispose = vi.fn(() => order.push('dispose'));
    win.destroy.mockImplementation(() => order.push('destroy'));
    const wm = new WindowManager(
      makeDeps({ createEditWindow: () => win, createEditWindowInstances: () => ({ dispose }), flushAutoSave: flush }),
    );
    wm.focusExistingWindow('song-a');

    win.fireClose();
    await vi.waitFor(() => expect(wm.listOpenEditWindowSongIds()).toEqual([]));

    expect(flush).toHaveBeenCalledWith('song-a');
    expect(order).toEqual(['flush', 'destroy', 'dispose']);
  });

  it('WindowManager_closeEditWindow_プログラムからも同じ後始末を行う', async () => {
    // UT-WIN-08 §4.1
    const win = makeWindow(100);
    const flush = vi.fn(() => Promise.resolve());
    const dispose = vi.fn();
    const wm = new WindowManager(
      makeDeps({ createEditWindow: () => win, createEditWindowInstances: () => ({ dispose }), flushAutoSave: flush }),
    );
    wm.focusExistingWindow('song-a');
    await wm.closeEditWindow('song-a');
    expect(flush).toHaveBeenCalledWith('song-a');
    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(wm.listOpenEditWindowSongIds()).toEqual([]);
  });

  it('WindowManager_開いていないsongIdのcloseEditWindowは無操作', async () => {
    // UT-WIN-09 §4.1
    const flush = vi.fn(() => Promise.resolve());
    const wm = new WindowManager(makeDeps({ flushAutoSave: flush }));
    await wm.closeEditWindow('missing');
    expect(flush).not.toHaveBeenCalled();
  });

  it('WindowManager_flush失敗でもウィンドウは閉じる', async () => {
    // UT-WIN-10 §4.1（flush 失敗時のフォールバック）
    const win = makeWindow(100);
    const dispose = vi.fn();
    const wm = new WindowManager(
      makeDeps({
        createEditWindow: () => win,
        createEditWindowInstances: () => ({ dispose }),
        flushAutoSave: () => Promise.reject(new Error('disk full')),
      }),
    );
    wm.focusExistingWindow('song-a');
    await wm.closeEditWindow('song-a');
    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('WindowManager_close割り込みは二重発火しても1回だけ処理する', async () => {
    // UT-WIN-11 §4.1（多重クローズ防止）
    const win = makeWindow(100);
    const flush = vi.fn(() => Promise.resolve());
    const wm = new WindowManager(makeDeps({ createEditWindow: () => win, flushAutoSave: flush }));
    wm.focusExistingWindow('song-a');
    win.fireClose();
    win.fireClose();
    await vi.waitFor(() => expect(wm.listOpenEditWindowSongIds()).toEqual([]));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('WindowManager_割り込みを経ずclosedだけ来てもインスタンスを破棄する', () => {
    // UT-WIN-12 §4.1（破棄漏れ防止）
    const win = makeWindow(100);
    const dispose = vi.fn();
    const wm = new WindowManager(
      makeDeps({ createEditWindow: () => win, createEditWindowInstances: () => ({ dispose }) }),
    );
    wm.focusExistingWindow('song-a');
    win.fireClosed();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(wm.listOpenEditWindowSongIds()).toEqual([]);
  });

  it('WindowManager_destroy()が同期的にclosedを発火してもdisposeは1回だけ（非ブロッキング#5）', async () => {
    // UT-WIN-13 §4.1（finalizeClose が map から先に除去 → onClosed の二重 dispose を防ぐ）
    const win = makeWindow(100);
    const dispose = vi.fn();
    win.destroy.mockImplementation(() => win.fireClosed());
    const wm = new WindowManager(
      makeDeps({
        createEditWindow: () => win,
        createEditWindowInstances: () => ({ dispose }),
        flushAutoSave: () => Promise.resolve(),
      }),
    );
    wm.focusExistingWindow('song-a');
    await wm.closeEditWindow('song-a');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(wm.listOpenEditWindowSongIds()).toEqual([]);
  });
});
