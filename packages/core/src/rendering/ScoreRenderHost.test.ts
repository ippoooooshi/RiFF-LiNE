// UT: web-core-foundation.md §3.1 — ScoreRenderHost（alphaTab の唯一の窓口）
//
// alphaTab（@coderline/alphatab）は完全にモックする。検証観点:
//  - オプション検証（engine !== 'svg' の拒否、未マウント container の拒否、二重初期化の拒否）
//  - 未初期化状態での loadScore / render の拒否
//  - alphaTab のイベント → 本クラスのイベント橋渡し
//  - loadScore の失敗（例外・false 返却・alphaTab の error イベント）が renderError で通知され、外部に例外を投げない
//  - dispose の冪等性、dispose 後のリスナークリア

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScoreRenderHost } from './ScoreRenderHost';
import type { RenderHostOptions } from './types';

// ---- alphaTab モック ------------------------------------------------------

interface FakeEmitter {
  handlers: Array<(...args: unknown[]) => void>;
  on: (h: (...args: unknown[]) => void) => void;
  fire: (...args: unknown[]) => void;
}

interface FakeDisplaySettings {
  display: { scale: number; layoutMode: number; startBar: number; barCount: number };
}

interface FakeApi {
  element: unknown;
  settings: FakeDisplaySettings & Record<string, unknown>;
  score: { tracks: unknown[] } | null;
  load: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
  renderTracks: ReturnType<typeof vi.fn>;
  renderStarted: FakeEmitter;
  renderFinished: FakeEmitter;
  error: FakeEmitter;
}

// vi.mock のファクトリはホイストされるため、共有状態は vi.hoisted 経由で用意する。
const mocks = vi.hoisted(() => {
  const createdApis: FakeApi[] = [];
  const state: { nextLoadResult: boolean | (() => boolean) } = { nextLoadResult: true };

  const makeEmitter = (): FakeEmitter => {
    const handlers: Array<(...args: unknown[]) => void> = [];
    return {
      handlers,
      on: (h) => handlers.push(h),
      fire: (...args) => handlers.forEach((h) => h(...args)),
    };
  };

  // new で使うため通常の function 式にする（アロー関数はコンストラクタになれない）。
  const AlphaTabApi = vi.fn(function (element: unknown, settings: unknown): FakeApi {
    // 実 alphaTab は settings-JSON を Settings インスタンスへ正規化する。テストでは display だけ整える。
    const s = (settings ?? {}) as FakeApi['settings'];
    s.display = s.display ?? { scale: 1, layoutMode: 0, startBar: 1, barCount: -1 };
    const api: FakeApi = {
      element,
      settings: s,
      score: null,
      load: vi.fn((scoreData: unknown) => {
        api.score = (scoreData ?? { tracks: [] }) as { tracks: unknown[] };
        return typeof state.nextLoadResult === 'function' ? state.nextLoadResult() : state.nextLoadResult;
      }),
      render: vi.fn(),
      destroy: vi.fn(),
      updateSettings: vi.fn(),
      renderTracks: vi.fn(),
      renderStarted: makeEmitter(),
      renderFinished: makeEmitter(),
      error: makeEmitter(),
    };
    createdApis.push(api);
    return api;
  });

  const initFromString = vi.fn();
  const readScore = vi.fn(() => ({ __fake: 'score' }));
  const AlphaTexImporter = vi.fn(function () {
    return { initFromString, readScore };
  });
  const Settings = vi.fn(function () {
    return {};
  });

  return { createdApis, state, AlphaTabApi, initFromString, readScore, AlphaTexImporter, Settings };
});

vi.mock('@coderline/alphatab', () => ({
  AlphaTabApi: mocks.AlphaTabApi,
  Settings: mocks.Settings,
  importer: { AlphaTexImporter: mocks.AlphaTexImporter },
  // ScoreRenderHost.applyViewMode が使う LayoutMode（実 alphaTab の enum 値と一致させる）。
  LayoutMode: { Page: 0, Horizontal: 1 },
}));

const { createdApis, state } = mocks;
const AlphaTabApiMock = mocks.AlphaTabApi;

// ---- ヘルパー ------------------------------------------------------------

const OPTIONS: RenderHostOptions = {
  engine: 'svg',
  fontAssetsBasePath: '/assets/alphatab/font/',
  soundFontAssetsBasePath: '/assets/alphatab/soundfont/',
};

function mountedContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function lastApi(): FakeApi {
  const api = createdApis.at(-1);
  if (!api) throw new Error('no AlphaTabApi was constructed');
  return api;
}

beforeEach(() => {
  createdApis.length = 0;
  state.nextLoadResult = true;
  AlphaTabApiMock.mockClear();
  mocks.initFromString.mockClear();
  mocks.readScore.mockClear();
  mocks.AlphaTexImporter.mockClear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- initialize --------------------------------------------------------

describe('ScoreRenderHost.initialize', () => {
  it('initialize_MountedContainerSvgEngine_ConstructsAlphaTabWithSettings', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);

    expect(AlphaTabApiMock).toHaveBeenCalledTimes(1);
    expect(host.isInitialized).toBe(true);
    const settings = lastApi().settings as unknown as {
      core: { engine: string; fontDirectory: string; useWorkers: boolean; enableLazyLoading: boolean };
      player: { enablePlayer: boolean };
    };
    expect(settings.core.engine).toBe('svg');
    expect(settings.core.fontDirectory).toBe(OPTIONS.fontAssetsBasePath);
    // 厳格 CSP（script-src 'self'）下では alphaTab の worker / blob ワーカー生成が拒否され描画が停止するため、
    // メインスレッド同期描画に固定する（web-core-foundation.md §3.1・要件5.1）。
    expect(settings.core.useWorkers).toBe(false);
    expect(settings.core.enableLazyLoading).toBe(false);
    expect(settings.player.enablePlayer).toBe(false);
  });

  it('initialize_UnmountedContainer_Throws', () => {
    const host = new ScoreRenderHost();
    const detached = document.createElement('div'); // not appended → isConnected === false
    expect(() => host.initialize(detached, OPTIONS)).toThrow(/mounted/i);
    expect(AlphaTabApiMock).not.toHaveBeenCalled();
    expect(host.isInitialized).toBe(false);
  });

  it('initialize_NullContainer_Throws', () => {
    const host = new ScoreRenderHost();
    // JS からの呼び出しで container が渡らないケース（`!container` ガード）。
    expect(() => host.initialize(null as unknown as HTMLElement, OPTIONS)).toThrow(/mounted/i);
    expect(AlphaTabApiMock).not.toHaveBeenCalled();
  });

  it('initialize_NonSvgEngine_Throws', () => {
    const host = new ScoreRenderHost();
    const badOptions = { ...OPTIONS, engine: 'html5' } as unknown as RenderHostOptions;
    expect(() => host.initialize(mountedContainer(), badOptions)).toThrow(/svg/i);
    expect(AlphaTabApiMock).not.toHaveBeenCalled();
  });

  it('initialize_CalledTwice_Throws', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    expect(() => host.initialize(mountedContainer(), OPTIONS)).toThrow(/already initialized/i);
    expect(AlphaTabApiMock).toHaveBeenCalledTimes(1);
  });
});

// ---- 未初期化ガード ---------------------------------------------------

describe('ScoreRenderHost before initialize', () => {
  it('loadScore_BeforeInitialize_Throws', () => {
    const host = new ScoreRenderHost();
    expect(() => host.loadScore({})).toThrow(/initialize\(\)/);
  });

  it('render_BeforeInitialize_Throws', () => {
    const host = new ScoreRenderHost();
    expect(() => host.render()).toThrow(/initialize\(\)/);
  });
});

// ---- イベント橋渡し -------------------------------------------------

describe('ScoreRenderHost events', () => {
  it('events_AlphaTabRenderStartedFinished_ForwardedToListeners', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const started = vi.fn();
    const finished = vi.fn();
    host.on('renderStarted', started);
    host.on('renderFinished', finished);

    lastApi().renderStarted.fire();
    lastApi().renderFinished.fire();

    expect(started).toHaveBeenCalledTimes(1);
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('events_Off_RemovesListener', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const started = vi.fn();
    host.on('renderStarted', started);
    host.off('renderStarted', started);

    lastApi().renderStarted.fire();
    expect(started).not.toHaveBeenCalled();
  });

  it('events_AlphaTabError_EmitsRenderErrorWithoutThrowing', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    host.on('renderError', onError);

    const cause = new Error('boom');
    expect(() => lastApi().error.fire(cause)).not.toThrow();
    expect(onError).toHaveBeenCalledWith({ error: cause });
    expect(consoleError).toHaveBeenCalled();
  });
});

// ---- loadScore -------------------------------------------------------

describe('ScoreRenderHost.loadScore', () => {
  it('loadScore_ValidScore_DelegatesToAlphaTabLoad', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const score = { tracks: [] };
    host.loadScore(score);
    expect(lastApi().load).toHaveBeenCalledWith(score);
  });

  it('loadScore_AlphaTabReturnsFalse_EmitsRenderErrorNoThrow', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    host.on('renderError', onError);
    state.nextLoadResult = false;

    expect(() => host.loadScore({})).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it('loadScore_AlphaTabThrows_EmitsRenderErrorNoThrow', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    host.on('renderError', onError);
    const boom = new Error('parse failed');
    state.nextLoadResult = () => {
      throw boom;
    };

    expect(() => host.loadScore({})).not.toThrow();
    expect(onError).toHaveBeenCalledWith({ error: boom });
  });
});

// ---- parseAlphaTex (static) ----------------------------------------

describe('ScoreRenderHost.parseAlphaTex', () => {
  it('parseAlphaTex_ValidTex_ReturnsImportedScore', () => {
    const tex = '\\title "Hello" . 3.3.4 | 3.3.4';
    const score = ScoreRenderHost.parseAlphaTex(tex);

    expect(mocks.AlphaTexImporter).toHaveBeenCalledTimes(1);
    expect(mocks.initFromString).toHaveBeenCalledWith(tex, expect.anything());
    expect(mocks.readScore).toHaveBeenCalledTimes(1);
    expect(score).toEqual({ __fake: 'score' });
  });

  it('parseAlphaTex_ImporterThrows_PropagatesError', () => {
    const boom = new Error('bad tex');
    mocks.readScore.mockImplementationOnce(() => {
      throw boom;
    });
    expect(() => ScoreRenderHost.parseAlphaTex('nonsense')).toThrow(boom);
  });
});

// ---- render --------------------------------------------------------

describe('ScoreRenderHost.render', () => {
  it('render_NoArgs_CallsAlphaTabRender', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.render();
    expect(lastApi().render).toHaveBeenCalledTimes(1);
  });

  it('render_WithTrackIndices_StillFullRenders', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.render([0, 2]);
    expect(lastApi().render).toHaveBeenCalledTimes(1);
  });

  it('render_WithEmptyTrackIndices_FullRenders', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.render([]);
    expect(lastApi().render).toHaveBeenCalledTimes(1);
  });
});

// ---- applyViewMode / applyZoom（パッケージ6 非破壊拡張、view-modes.md §4.3） ----

describe('ScoreRenderHost.applyViewMode', () => {
  function initializedWithTracks(count: number): { host: ScoreRenderHost; api: FakeApi } {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.loadScore({ tracks: Array.from({ length: count }, (_v, i) => ({ index: i })) });
    return { host, api: lastApi() };
  }

  it('applyViewMode_FocusWithRange_SetsStartBarAndBarCountAndRendersSingleTrack', () => {
    const { host, api } = initializedWithTracks(3);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 1, focusRange: { startBarIndex: 4, barCount: 8 } });

    expect(api.settings.display.startBar).toBe(5); // 0 始まり index 4 → 1 始まり 5
    expect(api.settings.display.barCount).toBe(8);
    expect(api.settings.display.layoutMode).toBe(0); // Page
    expect(api.updateSettings).toHaveBeenCalled();
    expect(api.renderTracks).toHaveBeenCalledTimes(1);
    expect(api.renderTracks.mock.calls[0]![0]).toEqual([{ index: 1 }]);
  });

  it('applyViewMode_FocusWithoutRange_UsesAllBars', () => {
    const { host, api } = initializedWithTracks(2);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 0 });
    expect(api.settings.display.startBar).toBe(1);
    expect(api.settings.display.barCount).toBe(-1);
  });

  it('applyViewMode_FocusRangeStartBarClampedToOne', () => {
    const { host, api } = initializedWithTracks(1);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 0, focusRange: { startBarIndex: -3, barCount: 1 } });
    expect(api.settings.display.startBar).toBe(1);
    expect(api.settings.display.barCount).toBe(1);
  });

  it('applyViewMode_Scroll_AllBarsSingleTrack', () => {
    const { host, api } = initializedWithTracks(3);
    api.settings.display.startBar = 9;
    api.settings.display.barCount = 4;
    host.applyViewMode({ mode: 'scroll', focusTrackIndex: 2 });
    expect(api.settings.display.startBar).toBe(1);
    expect(api.settings.display.barCount).toBe(-1);
    expect(api.renderTracks.mock.calls.at(-1)![0]).toEqual([{ index: 2 }]);
  });

  it('applyViewMode_Score_RendersAllTracks', () => {
    const { host, api } = initializedWithTracks(3);
    host.applyViewMode({ mode: 'score', focusTrackIndex: 0 });
    expect(api.renderTracks.mock.calls.at(-1)![0]).toEqual([{ index: 0 }, { index: 1 }, { index: 2 }]);
  });

  it('applyViewMode_FocusTrackIndexOutOfRange_FallsBackToAllTracks', () => {
    const { host, api } = initializedWithTracks(2);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 9 });
    expect(api.renderTracks.mock.calls.at(-1)![0]).toEqual([{ index: 0 }, { index: 1 }]);
  });

  it('applyViewMode_ScoreWithNoLoadedScore_RendersEmptyTrackList', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.applyViewMode({ mode: 'score', focusTrackIndex: 0 });
    expect(lastApi().renderTracks).toHaveBeenCalledWith([]);
  });

  it('applyViewMode_BeforeInitialize_Throws', () => {
    const host = new ScoreRenderHost();
    expect(() => host.applyViewMode({ mode: 'focus', focusTrackIndex: 0 })).toThrow(/initialize\(\)/);
  });
});

describe('ScoreRenderHost.applyZoom', () => {
  function initialized(): { host: ScoreRenderHost; api: FakeApi } {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    return { host, api: lastApi() };
  }

  it('applyZoom_PositiveScale_SetsDisplayScaleAndRerenders', () => {
    const { host, api } = initialized();
    host.applyZoom(1.5);
    expect(api.settings.display.scale).toBe(1.5);
    expect(api.updateSettings).toHaveBeenCalled();
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it('applyZoom_ZeroOrNegative_Throws', () => {
    const { host } = initialized();
    expect(() => host.applyZoom(0)).toThrow(/scale > 0/);
    expect(() => host.applyZoom(-1)).toThrow(/scale > 0/);
  });

  it('applyZoom_BeforeInitialize_Throws', () => {
    const host = new ScoreRenderHost();
    expect(() => host.applyZoom(1)).toThrow(/initialize\(\)/);
  });
});

// ---- dispose ------------------------------------------------------

describe('ScoreRenderHost.dispose', () => {
  it('dispose_AfterInitialize_DestroysApiAndResetsState', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const api = lastApi();
    host.dispose();
    expect(api.destroy).toHaveBeenCalledTimes(1);
    expect(host.isInitialized).toBe(false);
  });

  it('dispose_BeforeInitialize_IsNoop', () => {
    const host = new ScoreRenderHost();
    expect(() => host.dispose()).not.toThrow();
  });

  it('dispose_CalledTwice_IsIdempotent', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const api = lastApi();
    host.dispose();
    host.dispose();
    expect(api.destroy).toHaveBeenCalledTimes(1);
  });

  it('dispose_ClearsListeners', () => {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const started = vi.fn();
    host.on('renderStarted', started);
    host.dispose();
    // 新しい初期化後、古いリスナーには配信されない
    host.initialize(mountedContainer(), OPTIONS);
    lastApi().renderStarted.fire();
    expect(started).not.toHaveBeenCalled();
  });
});
