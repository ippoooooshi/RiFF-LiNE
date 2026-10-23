// UT-RENDER-HOST: `ScoreRenderHost`（初期化・曲の読み込み・描き直し・表示モード・ズーム）と rebuildDerivedLinks
// 検証節: web-core-foundation.md 12.1 節・12.2 節
//
// alphaTab（@coderline/alphatab）は完全に偽物にする。検証観点:
//  - オプション検証（engine !== 'svg' の拒否、未マウント container の拒否、二重初期化の拒否）
//  - 未初期化状態での loadScore / render の拒否
//  - alphaTab のイベント → 本クラスのイベント橋渡し
//  - loadScore は alphaTab の Score でなければ描かずに renderError で知らせ、外部に例外を投げない
//  - render は rebuildDerivedLinks の後に、変わったパートが表示中のときだけ renderScore を表示中のパートで呼ぶ（パートが 0 なら呼ばない）
//  - rebuildDerivedLinks は finish の前に前後の拍・スライドの行き先・全部の音符のタイのつながりを空にする（実物の alphaTab でも確かめる）
//  - dispose の冪等性、dispose 後のリスナークリア
// 番号 11・12・13・16・17・18 は、作り直す前の api.load と api.render の形を確かめていたので欠番にした（turn 179）。
// 番号 25・27 は、曲が無くても描画を呼ぶ前の形を確かめていたので欠番にした（turn 179、45・46 に置き換え）。
// 番号 42 は、タイの指定が付いたままの音符のつながりを残す前の形を確かめていたので欠番にした（turn 182、honnin-queue 187 番。53・54 に置き換え）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rebuildDerivedLinks } from './rebuildDerivedLinks';
import { ScoreRenderHost } from './ScoreRenderHost';
import type { RenderHostOptions } from './types';

// ---- alphaTab の偽物 ------------------------------------------------------

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
  renderScore: ReturnType<typeof vi.fn>;
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
      // 実 alphaTab と同じく、renderScore は描く曲を api.score に入れる
      renderScore: vi.fn((score: { tracks: unknown[] }) => {
        api.score = score;
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

  return { createdApis, AlphaTabApi, initFromString, readScore, AlphaTexImporter, Settings };
});

vi.mock('@coderline/alphatab', () => ({
  AlphaTabApi: mocks.AlphaTabApi,
  Settings: mocks.Settings,
  importer: { AlphaTexImporter: mocks.AlphaTexImporter },
  // ScoreRenderHost.applyViewMode が使う LayoutMode（実 alphaTab の enum 値と一致させる）。
  LayoutMode: { Page: 0, Horizontal: 1 },
}));

const { createdApis } = mocks;
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

interface FakeNote {
  isTieDestination: boolean;
  tieOrigin: FakeNote | null;
  tieDestination: FakeNote | null;
  slideTarget?: FakeNote | null;
}

/** alphaTab の Score の形の偽物（masterBars・tracks の配列と finish の関数）。パートごとに音符の並びを渡せる。 */
function fakeScore(trackCount: number, notesOfTrack: (i: number) => FakeNote[] = () => []) {
  const order: string[] = [];
  const score = {
    masterBars: [{}],
    tracks: Array.from({ length: trackCount }, (_v, i) => ({
      index: i,
      staves: [{ bars: [{ voices: [{ beats: [{ notes: notesOfTrack(i) }] }] }] }],
    })),
    finish: vi.fn(() => order.push('finish')),
  };
  return { score, order };
}

function note(): FakeNote {
  return { isTieDestination: false, tieOrigin: null, tieDestination: null };
}

beforeEach(() => {
  createdApis.length = 0;
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
    // UT-RENDER-HOST-01
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
    // 12.2 節：Web Worker を使わず、メインスレッドで同期に描く（B30）
    expect(settings.core.useWorkers).toBe(false);
    expect(settings.core.enableLazyLoading).toBe(false);
    expect(settings.player.enablePlayer).toBe(false);
  });

  it('initialize_UnmountedContainer_Throws', () => {
    // UT-RENDER-HOST-02
    const host = new ScoreRenderHost();
    const detached = document.createElement('div'); // not appended → isConnected === false
    expect(() => host.initialize(detached, OPTIONS)).toThrow(/mounted/i);
    expect(AlphaTabApiMock).not.toHaveBeenCalled();
    expect(host.isInitialized).toBe(false);
  });

  it('initialize_NullContainer_Throws', () => {
    // UT-RENDER-HOST-03
    const host = new ScoreRenderHost();
    // JS からの呼び出しで container が渡らないケース（`!container` ガード）。
    expect(() => host.initialize(null as unknown as HTMLElement, OPTIONS)).toThrow(/mounted/i);
    expect(AlphaTabApiMock).not.toHaveBeenCalled();
  });

  it('initialize_NonSvgEngine_Throws', () => {
    // UT-RENDER-HOST-04
    const host = new ScoreRenderHost();
    const badOptions = { ...OPTIONS, engine: 'html5' } as unknown as RenderHostOptions;
    expect(() => host.initialize(mountedContainer(), badOptions)).toThrow(/svg/i);
    expect(AlphaTabApiMock).not.toHaveBeenCalled();
  });

  it('initialize_CalledTwice_Throws', () => {
    // UT-RENDER-HOST-05
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    expect(() => host.initialize(mountedContainer(), OPTIONS)).toThrow(/already initialized/i);
    expect(AlphaTabApiMock).toHaveBeenCalledTimes(1);
  });
});

// ---- 未初期化ガード ---------------------------------------------------

describe('ScoreRenderHost before initialize', () => {
  it('loadScore_BeforeInitialize_Throws', () => {
    // UT-RENDER-HOST-06
    const host = new ScoreRenderHost();
    expect(() => host.loadScore({})).toThrow(/initialize\(\)/);
  });

  it('render_BeforeInitialize_Throws', () => {
    // UT-RENDER-HOST-07
    const host = new ScoreRenderHost();
    expect(() => host.render()).toThrow(/initialize\(\)/);
  });
});

// ---- イベント橋渡し -------------------------------------------------

describe('ScoreRenderHost events', () => {
  it('events_AlphaTabRenderStartedFinished_ForwardedToListeners', () => {
    // UT-RENDER-HOST-08
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
    // UT-RENDER-HOST-09
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const started = vi.fn();
    host.on('renderStarted', started);
    host.off('renderStarted', started);

    lastApi().renderStarted.fire();
    expect(started).not.toHaveBeenCalled();
  });

  it('events_AlphaTabError_EmitsRenderErrorWithoutThrowing', () => {
    // UT-RENDER-HOST-10
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
  it('loadScore_AlphaTabScore_DrawsWithRenderScore', () => {
    // UT-RENDER-HOST-34 12.1 節「loadScore の引数の型は前からの unknown のままとし、中で alphaTab の model.Score かを確かめ」
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const { score } = fakeScore(2);
    host.loadScore(score);
    expect(lastApi().renderScore).toHaveBeenCalledTimes(1);
    expect(lastApi().renderScore.mock.calls[0]![0]).toBe(score);
  });

  it('loadScore_NotScore_EmitsRenderErrorWithoutDrawing', () => {
    // UT-RENDER-HOST-35 12.1 節「違えば描かずに renderError で知らせる」。外へ例外を投げない
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    host.on('renderError', onError);

    for (const notScore of [{}, null, 'tex', { tracks: [] }, { masterBars: [], tracks: [] }]) {
      expect(() => host.loadScore(notScore)).not.toThrow();
    }
    expect(onError).toHaveBeenCalledTimes(5);
    expect(lastApi().renderScore).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });
});

// ---- parseAlphaTex (static) ----------------------------------------

describe('ScoreRenderHost.parseAlphaTex', () => {
  it('parseAlphaTex_ValidTex_ReturnsImportedScore', () => {
    // UT-RENDER-HOST-14
    const tex = '\\title "Hello" . 3.3.4 | 3.3.4';
    const score = ScoreRenderHost.parseAlphaTex(tex);

    expect(mocks.AlphaTexImporter).toHaveBeenCalledTimes(1);
    expect(mocks.initFromString).toHaveBeenCalledWith(tex, expect.anything());
    expect(mocks.readScore).toHaveBeenCalledTimes(1);
    expect(score).toEqual({ __fake: 'score' });
  });

  it('parseAlphaTex_ImporterThrows_PropagatesError', () => {
    // UT-RENDER-HOST-15
    const boom = new Error('bad tex');
    mocks.readScore.mockImplementationOnce(() => {
      throw boom;
    });
    expect(() => ScoreRenderHost.parseAlphaTex('nonsense')).toThrow(boom);
  });
});

// ---- render --------------------------------------------------------

describe('ScoreRenderHost.render', () => {
  it('render_NoScoreLoaded_DoesNotDraw', () => {
    // UT-RENDER-HOST-36 読み込む前は描くものが無い
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.render();
    expect(lastApi().renderScore).not.toHaveBeenCalled();
    expect(lastApi().render).not.toHaveBeenCalled();
  });

  it('render_RebuildsDerivedLinksBeforeRenderScore', () => {
    // UT-RENDER-HOST-37 12.1 節「render の中の順は (1)(2) の作り直し → (3) renderScore」
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const { score, order } = fakeScore(1);
    host.loadScore(score);
    lastApi().renderScore.mockImplementation(() => order.push('renderScore'));
    order.length = 0;

    host.render([0]);
    expect(order).toEqual(['finish', 'renderScore']);
    expect(score.finish).toHaveBeenLastCalledWith(lastApi().settings);
  });

  it('render_ScoreView_KeepsAllTracksEvenIfOnlyOneChanged', () => {
    // UT-RENDER-HOST-38 12.1 節「スコア表示で描き直すときは表示中の全部のパートを渡す」（honnin-queue 185 番）
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.applyViewMode({ mode: 'score', focusTrackIndex: 0 });
    host.loadScore(fakeScore(3).score);
    host.render([1]);
    expect(lastApi().renderScore.mock.calls.at(-1)![1]).toEqual([0, 1, 2]);
  });

  it('render_FocusView_ShowsTheFocusTrack', () => {
    // UT-RENDER-HOST-39 フォーカスビューとスクロールビューは focusTrackIndex の 1 パートを描く
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 2, focusRange: { startBarIndex: 0, barCount: 4 } });
    host.loadScore(fakeScore(3).score);
    expect(lastApi().renderScore.mock.calls.at(-1)![1]).toEqual([2]);
    host.applyViewMode({ mode: 'scroll', focusTrackIndex: 9 });
    host.render();
    // 範囲の外の focusTrackIndex は全部のパート
    expect(lastApi().renderScore.mock.calls.at(-1)![1]).toEqual([0, 1, 2]);
  });

  it('render_FinishThrows_EmitsRenderErrorWithoutThrowing', () => {
    // UT-RENDER-HOST-44 作り直しと描き直しの中の例外は外へ投げず renderError で知らせる（loadScore と同じ扱い）
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    host.on('renderError', onError);
    const { score } = fakeScore(1);
    const boom = new Error('finish failed');
    score.finish.mockImplementation(() => {
      throw boom;
    });
    expect(() => host.loadScore(score)).not.toThrow();
    expect(onError).toHaveBeenCalledWith({ error: boom });
    expect(lastApi().renderScore).not.toHaveBeenCalled();
  });

  it('render_ZeroTracks_DoesNotCallRenderScore', () => {
    // UT-RENDER-HOST-40 11 節「パートが 0 のときはアプリの側で描画を呼ばず」（描けるかは Phase 0）
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const { score } = fakeScore(0);
    host.loadScore(score);
    host.render();
    expect(lastApi().renderScore).not.toHaveBeenCalled();
    expect(score.finish).not.toHaveBeenCalled();
  });

  it('render_FocusAndScrollView_ChangedTrackDisplayed_PassesThatTrack', () => {
    // UT-RENDER-HOST-47 12.1 節「フォーカス表示と全体スクロール表示は … 渡すのは変わったパートと同じになる」
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 2, focusRange: { startBarIndex: 0, barCount: 8 } });
    host.loadScore(fakeScore(3).score);
    lastApi().renderScore.mockClear();
    host.render([2]);
    expect(lastApi().renderScore).toHaveBeenCalledTimes(1);
    expect(lastApi().renderScore.mock.calls[0]![1]).toEqual([2]);

    host.applyViewMode({ mode: 'scroll', focusTrackIndex: 1 });
    lastApi().renderScore.mockClear();
    host.render([1]);
    expect(lastApi().renderScore.mock.calls[0]![1]).toEqual([1]);
  });

  it('render_ChangedTrackNotDisplayed_RebuildsButDoesNotRender', () => {
    // UT-RENDER-HOST-48 12.1 節「変わったパートが今表示されていなければ描き直さない」「描き直さないときも、(1) と (2) の作り直しはする」
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 0, focusRange: { startBarIndex: 0, barCount: 8 } });
    const { score } = fakeScore(3);
    host.loadScore(score);
    lastApi().renderScore.mockClear();
    score.finish.mockClear();

    host.render([2]);
    expect(lastApi().renderScore).not.toHaveBeenCalled();
    expect(score.finish).toHaveBeenCalledTimes(1);
  });

  it('render_ChangeAffectsAllTracks_RedrawsTheDisplayedTrack', () => {
    // UT-RENDER-HOST-49 12.1 節「全部のパートに効く変更も、全部のパートが変わったとして扱う（表示中のパートが描き直される）」
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 1, focusRange: { startBarIndex: 0, barCount: 8 } });
    host.loadScore(fakeScore(3).score);
    lastApi().renderScore.mockClear();
    host.render([0, 1, 2]);
    expect(lastApi().renderScore.mock.calls[0]![1]).toEqual([1]);
    lastApi().renderScore.mockClear();
    host.render();
    expect(lastApi().renderScore.mock.calls[0]![1]).toEqual([1]);
  });
});

// ---- rebuildDerivedLinks --------------------------------------------

describe('rebuildDerivedLinks', () => {
  it('rebuildDerivedLinks_TieRemoved_ClearsBothLinksThenFinish', () => {
    // UT-RENDER-HOST-41 12.1 節 (1)：タイの指定が偽で tieOrigin が空でない音符は、相手の tieDestination と自分の tieOrigin を空にする
    const a = note();
    const b = note();
    a.tieDestination = b;
    b.tieOrigin = a; // b.isTieDestination は偽（タイを取り消した後）
    const { score, order } = fakeScore(1, () => [a, b]);
    rebuildDerivedLinks(score as never, {} as never);
    expect(a.tieDestination).toBeNull();
    expect(b.tieOrigin).toBeNull();
    expect(order).toEqual(['finish']);
  });

  it('rebuildDerivedLinks_TieKept_ClearsLinksBeforeFinishAndKeepsTheTieMark', () => {
    // UT-RENDER-HOST-53 12.1 節 (1)「タイの指定（isTieDestination）が付いたままの音符も含めて、全部の音符のタイのつながり
    // （tieOrigin・tieDestination）を空にする」(2) finish。タイの指定は利用者が決める中身なので残す
    const a = note();
    const b = note();
    a.tieDestination = b;
    b.tieOrigin = a;
    b.isTieDestination = true;
    const seenAtFinish: unknown[] = [];
    const { score } = fakeScore(1, () => [a, b]);
    score.finish.mockImplementation(() => seenAtFinish.push(a.tieDestination, b.tieOrigin));
    rebuildDerivedLinks(score as never, {} as never);
    expect(seenAtFinish).toEqual([null, null]);
    expect(b.isTieDestination).toBe(true);
    expect(score.finish).toHaveBeenCalledTimes(1);
  });

  it('rebuildDerivedLinks_RealAlphaTab_TieOriginRemoved_FindsTheRemainingNote', async () => {
    // UT-RENDER-HOST-54 12.1 節「(1) でタイの指定が付いたままの音符のつながりも空にするのは、alphaTab 1.8.4 の Note.chain が、
    // tieOrigin が入っていればタイの元の音符を探し直さず」。実物の alphaTab で、タイの元の音符の拍を消した後に、
    // 消した音符を指したまま残らず、残った前の同じ弦の音符を元の音符として探し直してフレットを写すこと（honnin-queue 187 番）
    const actual = await vi.importActual<typeof import('@coderline/alphatab')>('@coderline/alphatab');
    const settings = new actual.Settings();
    const texImporter = new actual.importer.AlphaTexImporter();
    texImporter.initFromString('\\tuning e5 b4 g4 d4 a3 e3 . 3.3 5.3 7.3 5.3 | -.3 9.3 10.3 12.3', settings);
    const score = texImporter.readScore();
    score.finish(settings);
    const firstVoice = score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!;
    const tied = score.tracks[0]!.staves[0]!.bars[1]!.voices[0]!.beats[0]!.notes[0]!;
    const oldOrigin = tied.tieOrigin;
    expect(tied.isTieDestination).toBe(true);
    expect(oldOrigin?.fret).toBe(5);
    expect(tied.fret).toBe(5);

    firstVoice.beats.pop();
    score.finish(settings);
    // 前提：finish だけでは、消した元の音符を指したまま残り、そこからフレットを写す
    expect(tied.tieOrigin).toBe(oldOrigin);
    expect(tied.fret).toBe(5);

    rebuildDerivedLinks(score, settings);
    expect(tied.tieOrigin).not.toBe(oldOrigin);
    expect(tied.tieOrigin).toBe(firstVoice.beats.at(-1)!.notes[0]);
    expect(tied.tieOrigin?.tieDestination).toBe(tied);
    expect(tied.fret).toBe(7);
  });

  it('rebuildDerivedLinks_ClearsBeatLinksAndSlideTargetsBeforeFinish', () => {
    // UT-RENDER-HOST-50 12.1 節 (1)「全部の拍の前後の拍（previousBeat・nextBeat）と全部の音符のスライドの行き先（slideTarget）を空に」してから (2) finish
    const target = note();
    const slid: FakeNote = { ...note(), slideTarget: target };
    const stale = { previousBeat: null, nextBeat: null, notes: [] };
    const first = { previousBeat: stale as unknown, nextBeat: stale as unknown, notes: [slid] };
    const last = { previousBeat: first as unknown, nextBeat: stale as unknown, notes: [target] };
    const seenAtFinish: unknown[] = [];
    const score = {
      masterBars: [{}],
      tracks: [{ staves: [{ bars: [{ voices: [{ beats: [first, last] }] }] }] }],
      finish: vi.fn(() =>
        seenAtFinish.push(first.previousBeat, first.nextBeat, last.previousBeat, last.nextBeat, slid.slideTarget),
      ),
    };
    rebuildDerivedLinks(score as never, {} as never);
    expect(seenAtFinish).toEqual([null, null, null, null, null]);
    expect(score.finish).toHaveBeenCalledTimes(1);
  });

  it('rebuildDerivedLinks_RealAlphaTab_FirstAndLastBeatRemoved_NoStaleNeighbours', async () => {
    // UT-RENDER-HOST-51 12.1 節「(1) で前後の拍 … を空にするのは、alphaTab 1.8.4 の finish が、曲の最初の拍の前の拍と、
    // ボイスの最後の拍で次の小節が無いときの次の拍を書き換えず」。実物の alphaTab で、拍を消した後に古い拍を指したまま残らないこと
    const actual = await vi.importActual<typeof import('@coderline/alphatab')>('@coderline/alphatab');
    const settings = new actual.Settings();
    const texImporter = new actual.importer.AlphaTexImporter();
    texImporter.initFromString('\\tuning e5 b4 g4 d4 a3 e3 . 3.3 5.3 7.3 8.3 | 5.3 7.3 9.3 10.3', settings);
    const score = texImporter.readScore();
    const firstVoice = score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!;
    const lastVoice = score.tracks[0]!.staves[0]!.bars[1]!.voices[0]!;

    const removedFirst = firstVoice.beats.shift()!;
    const removedLast = lastVoice.beats.pop()!;
    score.finish(settings);
    // 前提：finish だけでは、曲の最初と最後の拍が消した拍を指したまま残る（この確かめが空振りでないこと）
    expect(firstVoice.beats[0]!.previousBeat).toBe(removedFirst);
    expect(lastVoice.beats.at(-1)!.nextBeat).toBe(removedLast);

    rebuildDerivedLinks(score, settings);
    expect(firstVoice.beats[0]!.previousBeat).toBeNull();
    expect(lastVoice.beats.at(-1)!.nextBeat).toBeNull();
    // 間の拍のつながりは finish が張り直す
    expect(firstVoice.beats[0]!.nextBeat).toBe(firstVoice.beats[1]);
    expect(firstVoice.beats.at(-1)!.nextBeat).toBe(lastVoice.beats[0]);
  });

  it('rebuildDerivedLinks_RealAlphaTab_SlideTargetRemoved_PointsToTheNextNote', async () => {
    // UT-RENDER-HOST-52 12.1 節「スライドの行き先がすでに入っていれば作り直さない（Note.finish の if (!this.slideTarget)）ため」(1) で空にする。
    // 実物の alphaTab で、行き先の拍を消した後、スライドが消した音符を指したまま残らず、今の次の音符を指すこと
    const actual = await vi.importActual<typeof import('@coderline/alphatab')>('@coderline/alphatab');
    const settings = new actual.Settings();
    const texImporter = new actual.importer.AlphaTexImporter();
    texImporter.initFromString('\\tuning e5 b4 g4 d4 a3 e3 . 5.3{sl} 7.3 9.3 10.3', settings);
    const score = texImporter.readScore();
    score.finish(settings);
    const voice = score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!;
    const slid = voice.beats[0]!.notes[0]!;
    const oldTarget = slid.slideTarget;
    expect(oldTarget?.fret).toBe(7);

    voice.beats.splice(1, 1);
    score.finish(settings);
    // 前提：finish だけでは、消した音符を指したまま残る
    expect(slid.slideTarget).toBe(oldTarget);

    rebuildDerivedLinks(score, settings);
    expect(slid.slideTarget).not.toBe(oldTarget);
    expect(slid.slideTarget?.fret).toBe(9);
  });
});

// ---- applyViewMode / applyZoom ----

describe('ScoreRenderHost.applyViewMode', () => {
  function initializedWithTracks(count: number): { host: ScoreRenderHost; api: FakeApi } {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.loadScore(fakeScore(count).score);
    return { host, api: lastApi() };
  }
  const track = (i: number) => expect.objectContaining({ index: i });

  it('applyViewMode_FocusWithRange_SetsStartBarAndBarCountAndRendersSingleTrack', () => {
    // UT-RENDER-HOST-19
    const { host, api } = initializedWithTracks(3);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 1, focusRange: { startBarIndex: 4, barCount: 8 } });

    expect(api.settings.display.startBar).toBe(5); // 0 始まり index 4 → 1 始まり 5
    expect(api.settings.display.barCount).toBe(8);
    expect(api.settings.display.layoutMode).toBe(0); // Page
    expect(api.updateSettings).toHaveBeenCalled();
    expect(api.renderTracks).toHaveBeenCalledTimes(1);
    expect(api.renderTracks.mock.calls[0]![0]).toEqual([track(1)]);
  });

  it('applyViewMode_FocusWithoutRange_UsesAllBars', () => {
    // UT-RENDER-HOST-20
    const { host, api } = initializedWithTracks(2);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 0 });
    expect(api.settings.display.startBar).toBe(1);
    expect(api.settings.display.barCount).toBe(-1);
  });

  it('applyViewMode_FocusRangeStartBarClampedToOne', () => {
    // UT-RENDER-HOST-21
    const { host, api } = initializedWithTracks(1);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 0, focusRange: { startBarIndex: -3, barCount: 1 } });
    expect(api.settings.display.startBar).toBe(1);
    expect(api.settings.display.barCount).toBe(1);
  });

  it('applyViewMode_Scroll_AllBarsSingleTrack', () => {
    // UT-RENDER-HOST-22
    const { host, api } = initializedWithTracks(3);
    api.settings.display.startBar = 9;
    api.settings.display.barCount = 4;
    host.applyViewMode({ mode: 'scroll', focusTrackIndex: 2 });
    expect(api.settings.display.startBar).toBe(1);
    expect(api.settings.display.barCount).toBe(-1);
    expect(api.renderTracks.mock.calls.at(-1)![0]).toEqual([track(2)]);
  });

  it('applyViewMode_Score_RendersAllTracks', () => {
    // UT-RENDER-HOST-23
    const { host, api } = initializedWithTracks(3);
    host.applyViewMode({ mode: 'score', focusTrackIndex: 0 });
    expect(api.renderTracks.mock.calls.at(-1)![0]).toEqual([track(0), track(1), track(2)]);
  });

  it('applyViewMode_FocusTrackIndexOutOfRange_FallsBackToAllTracks', () => {
    // UT-RENDER-HOST-24
    const { host, api } = initializedWithTracks(2);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 9 });
    expect(api.renderTracks.mock.calls.at(-1)![0]).toEqual([track(0), track(1)]);
  });

  it('applyViewMode_NoScoreOrZeroTracks_DoesNotDraw', () => {
    // UT-RENDER-HOST-45 11 節「パートが 0 のときはアプリの側で描画を呼ばず」。読み込む前も描かない（設定は当てる）
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    host.applyViewMode({ mode: 'score', focusTrackIndex: 0 });
    expect(lastApi().updateSettings).toHaveBeenCalled();
    host.loadScore(fakeScore(0).score);
    host.applyViewMode({ mode: 'focus', focusTrackIndex: 0 });
    expect(lastApi().renderTracks).not.toHaveBeenCalled();
  });

  it('applyViewMode_BeforeInitialize_Throws', () => {
    // UT-RENDER-HOST-26
    const host = new ScoreRenderHost();
    expect(() => host.applyViewMode({ mode: 'focus', focusTrackIndex: 0 })).toThrow(/initialize\(\)/);
  });

  it('applyViewMode_DoesNotRebuildDerivedLinks', () => {
    // UT-RENDER-HOST-43 12.1 節「applyViewMode・applyZoom は曲の中身を変えないので、作り直さずに描き直す」
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const { score } = fakeScore(2);
    host.loadScore(score);
    score.finish.mockClear();
    host.applyViewMode({ mode: 'score', focusTrackIndex: 0 });
    host.applyZoom(2);
    expect(score.finish).not.toHaveBeenCalled();
  });
});

describe('ScoreRenderHost.applyZoom', () => {
  function initialized(): { host: ScoreRenderHost; api: FakeApi } {
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    return { host, api: lastApi() };
  }

  it('applyZoom_PositiveScale_SetsDisplayScaleAndRerendersOnlyWithParts', () => {
    // UT-RENDER-HOST-46 12.1 節「display.scale に入れて描き直す」。11 節のとおり、読み込む前とパートが 0 の曲は描画を呼ばない
    const { host, api } = initialized();
    host.applyZoom(1.5);
    expect(api.settings.display.scale).toBe(1.5);
    expect(api.updateSettings).toHaveBeenCalled();
    expect(api.render).not.toHaveBeenCalled();
    host.loadScore(fakeScore(0).score);
    host.applyZoom(2);
    expect(api.render).not.toHaveBeenCalled();
    host.loadScore(fakeScore(1).score);
    host.applyZoom(1);
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it('applyZoom_ZeroOrNegative_Throws', () => {
    // UT-RENDER-HOST-28
    const { host } = initialized();
    expect(() => host.applyZoom(0)).toThrow(/scale > 0/);
    expect(() => host.applyZoom(-1)).toThrow(/scale > 0/);
  });

  it('applyZoom_BeforeInitialize_Throws', () => {
    // UT-RENDER-HOST-29
    const host = new ScoreRenderHost();
    expect(() => host.applyZoom(1)).toThrow(/initialize\(\)/);
  });
});

// ---- dispose ------------------------------------------------------

describe('ScoreRenderHost.dispose', () => {
  it('dispose_AfterInitialize_DestroysApiAndResetsState', () => {
    // UT-RENDER-HOST-30
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const api = lastApi();
    host.dispose();
    expect(api.destroy).toHaveBeenCalledTimes(1);
    expect(host.isInitialized).toBe(false);
  });

  it('dispose_BeforeInitialize_IsNoop', () => {
    // UT-RENDER-HOST-31
    const host = new ScoreRenderHost();
    expect(() => host.dispose()).not.toThrow();
  });

  it('dispose_CalledTwice_IsIdempotent', () => {
    // UT-RENDER-HOST-32
    const host = new ScoreRenderHost();
    host.initialize(mountedContainer(), OPTIONS);
    const api = lastApi();
    host.dispose();
    host.dispose();
    expect(api.destroy).toHaveBeenCalledTimes(1);
  });

  it('dispose_ClearsListeners', () => {
    // UT-RENDER-HOST-33
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
