// IT-BOOT: renderer bootstrap（App.tsx の DI 配線）の結合テスト（独立レビュー B-4、B-3 回帰固定）
// 検証節: screens-navigation.md §4.8・§9.0 P1/P2-a（編集ウィンドウが白飛びせず chrome が描画される）
//
// alphaTab は `AlphaTabApi` だけ fake に差し替える（`model`/`Settings`/`LayoutMode`/`importer` は実物のまま、
// 既存 ScoreRenderHost.test.ts と同方針）。`window.riffLineApi` も fake。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationCenter } from '@riff-line/core/errors';

// ---- alphaTab の AlphaTabApi のみ fake ------------------------------------
const alphaTabMock = vi.hoisted(() => {
  const state = {
    constructed: [] as unknown[],
    failNextConstruct: false,
    // 本物の alphaTab の Settings を作る関数（vi.mock のファクトリが入れる）。描く前の作り直し（Score.finish）が
    // 本物の Settings の notation を読むため、偽物の api にも本物の Settings を持たせる（web-core-foundation.md 12.1 節）
    makeSettings: null as null | (() => Record<string, unknown>),
  };
  class FakeAlphaTabApi {
    element: unknown;
    settings: { display: { scale: number; layoutMode: number; startBar: number; barCount: number } } & Record<
      string,
      unknown
    >;
    score: { tracks: unknown[] } | null = null;
    renderStarted = { on: vi.fn() };
    renderFinished = { on: vi.fn() };
    error = { on: vi.fn() };
    // 実 alphaTab と同じく、renderScore は描く曲を score に入れる
    renderScore = vi.fn((score: { tracks: unknown[] }) => {
      this.score = score;
    });
    render = vi.fn();
    destroy = vi.fn();
    updateSettings = vi.fn();
    renderTracks = vi.fn();
    constructor(element: unknown) {
      if (state.failNextConstruct) {
        state.failNextConstruct = false;
        throw new Error('boom during AlphaTabApi construction');
      }
      this.element = element;
      const s = (state.makeSettings?.() ?? {}) as FakeAlphaTabApi['settings'];
      s.display = s.display ?? { scale: 1, layoutMode: 0, startBar: 1, barCount: -1 };
      this.settings = s;
      state.constructed.push(this);
    }
  }
  return { FakeAlphaTabApi, state };
});

vi.mock('@coderline/alphatab', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coderline/alphatab')>();
  alphaTabMock.state.makeSettings = () => new actual.Settings() as unknown as Record<string, unknown>;
  return { ...actual, AlphaTabApi: alphaTabMock.FakeAlphaTabApi };
});

// ---- window.riffLineApi の fake -----------------------------------------
function fileNotFound(): Error {
  return Object.assign(new Error('FileNotFoundError'), { code: 'FILE_NOT_FOUND' });
}

function installRiffLineApi(): void {
  const fsAt = {
    readFile: vi.fn(() => Promise.reject(fileNotFound())),
    writeFile: vi.fn(() => Promise.resolve()),
    listDirectory: vi.fn(() => Promise.resolve([])),
    ensureDirectory: vi.fn(() => Promise.resolve()),
    renameFile: vi.fn(() => Promise.resolve()),
    deleteFile: vi.fn(() => Promise.resolve()),
    copyFile: vi.fn(() => Promise.resolve()),
    exists: vi.fn(() => Promise.resolve(false)),
  };
  const flushHandlers = new Set<(request: { songId: string; token: number }) => void>();
  (window as unknown as { riffLineApi: unknown }).riffLineApi = {
    fs: {
      readFile: vi.fn(() => Promise.reject(fileNotFound())),
      writeFile: vi.fn(() => Promise.resolve()),
      listDirectory: vi.fn(() => Promise.resolve([])),
      ensureDirectory: vi.fn(() => Promise.resolve()),
      getRootPath: vi.fn(() => Promise.resolve('/fake/TabApp')),
    },
    fsAt,
    appConfig: {
      readPointer: vi.fn(() => Promise.resolve(null)),
      writePointer: vi.fn(() => Promise.resolve()),
      getActiveRoot: vi.fn(() => Promise.resolve('/fake/TabApp')),
      getLocalBackupRoot: vi.fn(() => Promise.resolve('/fake/LocalBackup')),
    },
    log: { append: vi.fn(() => Promise.resolve()) },
    crash: { getRecoveryState: vi.fn(() => Promise.resolve({ recovered: false, repeatedCrash: false })) },
    windows: {
      openSong: vi.fn(() => Promise.resolve()),
      openSongList: vi.fn(() => Promise.resolve()),
      onFlushAutoSaveRequest: vi.fn((handler: (request: { songId: string; token: number }) => void) => {
        flushHandlers.add(handler);
        return () => flushHandlers.delete(handler);
      }),
      ackFlushAutoSave: vi.fn(),
    },
  };
}

// ---- テストハーネス -----------------------------------------------------
let container: HTMLDivElement;
let root: Root;

async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  alphaTabMock.state.constructed.length = 0;
  alphaTabMock.state.failNextConstruct = false;
  installRiffLineApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  window.location.hash = '';
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('App bootstrap — 編集ウィンドウ（#edit/<songId>）', () => {
  it('IT-BOOT-01: マウントで例外を投げずメニュー/ツールバー/ステータスバーが描画される', async () => {
    // screens-navigation.md §4.8 #3。白画面＝ツリー unmount と断定できるため chrome の存在で確認する。
    window.location.hash = '#edit/song-1';
    const { App } = await import('./App');
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    expect(container.querySelector('nav[aria-label="メニュー"]')).not.toBeNull();
    expect(container.querySelector('footer')).not.toBeNull();
    expect(container.textContent).toContain('再生');
    expect(container.querySelector('[data-testid="edit-bootstrap-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="error-boundary-fallback"]')).toBeNull();
  });

  it('IT-BOOT-02: B-3 回帰固定 — host.initialize が ViewModeController 構築より前に呼ばれる（NOT_INITIALIZED を出さない）', async () => {
    window.location.hash = '#edit/song-2';
    const reportSpy = vi.spyOn(notificationCenter, 'report');
    const { App } = await import('./App');
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    // initialize が走って fake AlphaTabApi が construct され、その後 applyViewMode（updateSettings/renderTracks）まで到達している。
    // 最初の描画は loadScore が render の中で呼ぶ renderScore（web-core-foundation.md 12.1 節）
    expect(alphaTabMock.state.constructed).toHaveLength(1);
    const api = alphaTabMock.state.constructed[0] as {
      updateSettings: ReturnType<typeof vi.fn>;
      renderScore: ReturnType<typeof vi.fn>;
    };
    expect(api.updateSettings).toHaveBeenCalled();
    expect(api.renderScore).toHaveBeenCalled();

    // 初期化順バグなら RENDER-001 に NOT_INITIALIZED の detail が乗る。乗っていないことを確認。
    const notInitReports = reportSpy.mock.calls.filter(
      ([code, context]) =>
        code === 'RENDER-001' &&
        typeof (context as { detail?: unknown } | undefined)?.detail === 'string' &&
        String((context as { detail: string }).detail).includes('must be called before'),
    );
    expect(notInitReports).toEqual([]);
  });

  it('IT-BOOT-03: bootstrap が例外を出しても白画面にせず原因を表示する（try/catch フォールバック）', async () => {
    // initialize（fake AlphaTabApi の construct）を 1 度だけ強制失敗させる。
    alphaTabMock.state.failNextConstruct = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    window.location.hash = '#edit/song-3';
    const { App } = await import('./App');
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    expect(container.querySelector('[data-testid="edit-bootstrap-error"]')).not.toBeNull();
    expect(container.textContent).toContain('編集ウィンドウの初期化に失敗しました');
  });
});

describe('App bootstrap — 曲一覧ウィンドウ（#songlist）', () => {
  it('IT-BOOT-04: マウントで例外を投げず曲一覧の chrome が描画される', async () => {
    window.location.hash = '#songlist';
    const { App } = await import('./App');
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    expect(container.textContent).toContain('曲一覧');
    expect(container.querySelector('[data-testid="song-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="error-boundary-fallback"]')).toBeNull();
  });
});

describe('App bootstrap — 更新の確認（web-core-foundation.md 13.3 節）', () => {
  it('IT-BOOT-05: 曲一覧ウィンドウの起動の後に更新の確認を 1 回だけ呼び、画面に何も出さない', async () => {
    // 13.3 節「check を呼ぶのは、曲一覧ウィンドウのレンダラーが起動した後の 1 回」「画面には何も出さない」
    vi.resetModules();
    const updateCheck = await import('./updateCheck');
    const check = vi.spyOn(updateCheck.noUpdateCheckAdapter, 'check');
    window.location.hash = '#songlist';
    const { App } = await import('./App');
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();
    const before = container.innerHTML;
    // 同じレンダラーで 2 回目の起動（開発の StrictMode の 2 回目の効果に当たる）があっても呼ばない
    updateCheck.runUpdateCheckOnce();
    await flushAsync();

    expect(check).toHaveBeenCalledTimes(1);
    expect(await check.mock.results[0]!.value).toEqual({ kind: 'none' });
    expect(container.innerHTML).toBe(before);
  });

  it('IT-BOOT-06: 編集ウィンドウでは更新の確認を呼ばない', async () => {
    // 13.3 節：呼ぶのは曲一覧ウィンドウのレンダラーだけ
    vi.resetModules();
    const updateCheck = await import('./updateCheck');
    const check = vi.spyOn(updateCheck.noUpdateCheckAdapter, 'check');
    window.location.hash = '#edit/song-5';
    const { App } = await import('./App');
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    expect(check).not.toHaveBeenCalled();
  });

  it('IT-BOOT-07: 更新の確認のダミーは通信せず、いつも「更新なし」を返す', async () => {
    // 13.3 節「v1 では通信しないダミーの実装」、6.2 節「更新の確認は v1 では通信しない」
    const { noUpdateCheckAdapter } = await import('./updateCheck');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(noUpdateCheckAdapter.check()).resolves.toEqual({ kind: 'none' });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('IT-BOOT-08: 差し替えた更新の確認が reject しても、呼ぶ側は投げず、受けられない reject も残さない', async () => {
    // 13.3 節の (b)「失敗で reject しないのは、更新の確認の失敗で起動を止めないため」。
    // 呼ぶ側の runUpdateCheckOnce も、差し替えた実装の reject を受けて捨てる。
    // jsdom の環境では受けられない reject が実行を失敗にしないので、reject する Promise の catch が呼ばれたかで見る
    vi.resetModules();
    const { runUpdateCheckOnce } = await import('./updateCheck');
    const rejected = Promise.reject(new Error('offline'));
    const caught = vi.spyOn(rejected, 'catch');
    const failing = { check: vi.fn(() => rejected) };
    expect(() => runUpdateCheckOnce(failing)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failing.check).toHaveBeenCalledTimes(1);
    expect(caught).toHaveBeenCalledTimes(1);
  });
});
