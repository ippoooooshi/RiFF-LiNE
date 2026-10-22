// UT-UI-SRH: ScoreRenderHost の Error のハイライトとパートの描画の領域
// 検証節: web-core-foundation.md 12.1 節（showErrorHighlight・clearErrorHighlight・getPartRegions）
// alphaTab は最小の偽物。boundsLookup は alphaTab 1.8.4 の型定義の形（findMasterBarByIndex・MasterBarBounds.bars・
// BarBounds.bar.staff.track.index・BarBounds.visualBounds・StaffSystemBounds.bars）で組む。ハイライトはコンテナ上の
// DOM なので jsdom で確かめる。実物の alphaTab の座標の確かめは作業パッケージ 8 の実機の確かめ。
// 番号 05・09・10 は、作り直す前の staffSystems.tracks の形を確かめていたので欠番にした（turn 179）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScoreRenderHost, resolveHighlightFrames, resolvePartRegions } from './ScoreRenderHost';
import type { RenderHostOptions } from './types';

const mocks = vi.hoisted(() => {
  const state: { renderer: unknown } = { renderer: undefined };
  const AlphaTabApi = vi.fn(function (element: unknown, settings: unknown) {
    const s = (settings ?? {}) as { display?: unknown };
    s.display = s.display ?? { scale: 1, layoutMode: 0, startBar: 1, barCount: -1 };
    return {
      element,
      settings: s,
      score: { tracks: [] },
      get renderer() {
        return state.renderer;
      },
      renderScore: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(),
      updateSettings: vi.fn(),
      renderTracks: vi.fn(),
      renderStarted: { on: vi.fn() },
      renderFinished: { on: vi.fn() },
      error: { on: vi.fn() },
    };
  });
  return { state, AlphaTabApi };
});

vi.mock('@coderline/alphatab', () => ({
  AlphaTabApi: mocks.AlphaTabApi,
  LayoutMode: { Page: 0 },
  Settings: vi.fn(),
  importer: { AlphaTexImporter: vi.fn() },
}));

const OPTIONS: RenderHostOptions = {
  engine: 'svg',
  fontAssetsBasePath: 'font/',
  soundFontAssetsBasePath: 'sf/',
};

function mountedContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 偽物の boundsLookup。systems は段ごとの小節の並びで、小節ごとにパートの矩形（track → Rect）を持つ。
 * 小節の番号は段をまたいで 0 から数える。
 */
interface FakeBarBounds {
  visualBounds: Rect;
  bar: { staff: { track: { index: number } } };
}
interface FakeMasterBarBounds {
  index: number;
  bars: FakeBarBounds[];
  staffSystemBounds: { index: number };
}
function fakeBoundsLookup(systems: Array<Array<Record<number, Rect>>>) {
  const masterBars: FakeMasterBarBounds[] = [];
  const staffSystems = systems.map((bars, systemIndex) => {
    const system = { index: systemIndex, bars: [] as FakeMasterBarBounds[] };
    for (const parts of bars) {
      const masterBar: FakeMasterBarBounds = {
        index: masterBars.length,
        staffSystemBounds: { index: systemIndex },
        bars: Object.entries(parts).map(([track, visualBounds]) => ({
          visualBounds,
          bar: { staff: { track: { index: Number(track) } } },
        })),
      };
      masterBars.push(masterBar);
      system.bars.push(masterBar);
    }
    return system;
  });
  return {
    staffSystems,
    findMasterBarByIndex: (i: number) => masterBars.find((m) => m.index === i) ?? null,
  };
}

/** 段 0 に小節 0〜1、段 1 に小節 2。パート 0 と 1 が縦に並ぶ。 */
const TWO_SYSTEMS = fakeBoundsLookup([
  [
    { 0: { x: 10, y: 0, w: 100, h: 40 }, 1: { x: 10, y: 40, w: 100, h: 30 } },
    { 0: { x: 110, y: 0, w: 90, h: 40 }, 1: { x: 110, y: 40, w: 90, h: 30 } },
  ],
  [{ 0: { x: 10, y: 100, w: 120, h: 40 }, 1: { x: 10, y: 140, w: 120, h: 30 } }],
]);

describe('ScoreRenderHost.showErrorHighlight / clearErrorHighlight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.state.renderer = { boundsLookup: TWO_SYSTEMS };
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('showErrorHighlight_コンテナへ赤枠オーバーレイを1つ追加する', () => {
    // UT-UI-SRH-01 12.1 節「表示領域の上に重ねた <div> で出す」
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);

    host.showErrorHighlight({ trackIndex: 1, startBarIndex: 0, barCount: 2, code: 'EDIT-002' });

    const el = container.querySelector('.riff-line-error-highlight') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-track-index')).toBe('1');
    expect(el?.getAttribute('data-start-bar')).toBe('0');
    expect(el?.getAttribute('data-code')).toBe('EDIT-002');
    expect(container.style.position).toBe('relative');
    host.dispose();
  });

  it('showErrorHighlight_連続呼び出しで前のハイライトを置き換える', () => {
    // UT-UI-SRH-02 12.1 節「前に出ていたハイライトは外してから出し、同時に出すハイライトは 1 つにする」
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 1 });
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 2, barCount: 1 });
    expect(container.querySelectorAll('.riff-line-error-highlight')).toHaveLength(1);
    host.dispose();
  });

  it('showErrorHighlight_durationMs経過で自動解除する', () => {
    // UT-UI-SRH-03 12.1 節「durationMs たったら外す」
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 1, durationMs: 1000 });
    expect(container.querySelector('.riff-line-error-highlight')).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(container.querySelector('.riff-line-error-highlight')).toBeNull();
    host.dispose();
  });

  it('clearErrorHighlight_明示解除できる / 未表示でも安全', () => {
    // UT-UI-SRH-04 12.1 節「clearErrorHighlight は、出ていないときに呼んでも何もしない」
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.clearErrorHighlight(); // 未表示
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 1 });
    host.clearErrorHighlight();
    expect(container.querySelector('.riff-line-error-highlight')).toBeNull();
    host.dispose();
  });

  it('dispose_ハイライトも除去する', () => {
    // UT-UI-SRH-06 12.1 節「dispose でも外す」
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 1 });
    host.dispose();
    expect(container.querySelector('.riff-line-error-highlight')).toBeNull();
  });

  it('showErrorHighlight_省いたdurationMsは4000ミリ秒', () => {
    // UT-UI-SRH-11 12.1 節「durationMs（省いたら DEFAULT_HIGHLIGHT_DURATION_MS の 4000 ミリ秒）」
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 1 });
    vi.advanceTimersByTime(3999);
    expect(container.querySelector('.riff-line-error-highlight')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(container.querySelector('.riff-line-error-highlight')).toBeNull();
    host.dispose();
  });

  it('showErrorHighlight_小節の範囲を段ごとの枠で囲み_色はdangerのトークン', () => {
    // UT-UI-SRH-12 12.1 節「範囲の小節を段ごとに 1 つの枠へまとめる（範囲が段をまたげば、段ごとに枠を出す）」
    // 「枠の色は danger のトークン（--color-danger）で、直値を書かない」「pointer-events: none」
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 3 });
    const frames = [...container.querySelectorAll<HTMLElement>('.riff-line-error-highlight-frame')];
    expect(frames).toHaveLength(2);
    expect([frames[0]!.style.left, frames[0]!.style.width, frames[0]!.style.height]).toEqual(['10px', '190px', '40px']);
    expect([frames[1]!.style.top, frames[1]!.style.width]).toEqual(['100px', '120px']);
    for (const f of frames) {
      expect(f.style.border).toContain('var(--color-danger)');
      expect(f.style.pointerEvents).toBe('none');
    }
    const group = container.querySelector('.riff-line-error-highlight') as HTMLElement;
    expect(group.style.pointerEvents).toBe('none');
    host.dispose();
  });

  it('showErrorHighlight_描く前や範囲の小節が無いときは枠を出さない', () => {
    // UT-UI-SRH-13 12.1 節「1 つも無いか、描く前で boundsLookup が無いときは枠を出さない」
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 7, barCount: 2 });
    expect(container.querySelector('.riff-line-error-highlight')).toBeNull();
    mocks.state.renderer = { boundsLookup: null };
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 1 });
    expect(container.querySelector('.riff-line-error-highlight')).toBeNull();
    host.dispose();
  });

  it('getPartRegions_boundsLookup未提供なら空配列', () => {
    // UT-UI-SRH-07 12.1 節「描く前（boundsLookup が無い）は空の配列を返す」
    mocks.state.renderer = undefined;
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    expect(host.getPartRegions()).toEqual([]);
    host.dispose();
  });
});

describe('resolveHighlightFrames（純関数）', () => {
  it('resolveHighlightFrames_描いている小節だけに枠を出す', () => {
    // UT-UI-SRH-14 12.1 節「範囲の小節が今の描画に無い（フォーカス表示の範囲の外）ときは、描いている小節だけに枠を出し」
    expect(resolveHighlightFrames(TWO_SYSTEMS, { trackIndex: 1, startBarIndex: 2, barCount: 5 })).toEqual([
      { trackIndex: 1, x: 10, y: 140, width: 120, height: 30 },
    ]);
    expect(resolveHighlightFrames(TWO_SYSTEMS, { trackIndex: 3, startBarIndex: 0, barCount: 3 })).toEqual([]);
    expect(resolveHighlightFrames(undefined, { trackIndex: 0, startBarIndex: 0, barCount: 1 })).toEqual([]);
  });
});

describe('resolvePartRegions（純関数）', () => {
  it('resolvePartRegions_null/undefinedは空配列', () => {
    // UT-UI-SRH-08 12.1 節「描く前（boundsLookup が無い）は空の配列を返す」
    expect(resolvePartRegions(null)).toEqual([]);
    expect(resolvePartRegions(undefined)).toEqual([]);
  });

  it('resolvePartRegions_段ごと・パートごとに小節の矩形を合わせる', () => {
    // UT-UI-SRH-15 12.1 節「矩形は段ごと・パートごとに 1 つとし、StaffSystemBounds.bars → MasterBarBounds.bars →
    // BarBounds.bar.staff.track.index のたどり方で同じパートの BarBounds.visualBounds を合わせた矩形にする」
    expect(resolvePartRegions(TWO_SYSTEMS)).toEqual([
      { trackIndex: 0, x: 10, y: 0, width: 190, height: 40 },
      { trackIndex: 1, x: 10, y: 40, width: 190, height: 30 },
      { trackIndex: 0, x: 10, y: 100, width: 120, height: 40 },
      { trackIndex: 1, x: 10, y: 140, width: 120, height: 30 },
    ]);
  });
});
