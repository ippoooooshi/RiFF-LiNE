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

interface FakeApi {
  element: unknown;
  settings: unknown;
  load: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
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
    const api: FakeApi = {
      element,
      settings,
      load: vi.fn(() => (typeof state.nextLoadResult === 'function' ? state.nextLoadResult() : state.nextLoadResult)),
      render: vi.fn(),
      destroy: vi.fn(),
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
    const settings = lastApi().settings as {
      core: { engine: string; fontDirectory: string };
      player: { enablePlayer: boolean };
    };
    expect(settings.core.engine).toBe('svg');
    expect(settings.core.fontDirectory).toBe(OPTIONS.fontAssetsBasePath);
    expect(settings.player.enablePlayer).toBe(false);
  });

  it('initialize_UnmountedContainer_Throws', () => {
    const host = new ScoreRenderHost();
    const detached = document.createElement('div'); // not appended → isConnected === false
    expect(() => host.initialize(detached, OPTIONS)).toThrow(/mounted/i);
    expect(AlphaTabApiMock).not.toHaveBeenCalled();
    expect(host.isInitialized).toBe(false);
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
