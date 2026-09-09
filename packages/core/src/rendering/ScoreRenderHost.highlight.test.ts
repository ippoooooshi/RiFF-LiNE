// UT-UI-SRH: ScoreRenderHost ハイライト表示 / パート識別色オーバーレイ拡張
//   screens-navigation.md §4.5.1（showErrorHighlight / clearErrorHighlight）、G24（getPartRegions / resolvePartRegions）
// alphaTab は最小モック。ハイライトはコンテナ上の DOM オーバーレイなので jsdom で検証できる。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScoreRenderHost, resolvePartRegions } from './ScoreRenderHost';
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
      load: vi.fn(() => true),
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

describe('ScoreRenderHost.showErrorHighlight / clearErrorHighlight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.state.renderer = undefined;
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('showErrorHighlight_コンテナへ赤枠オーバーレイを1つ追加する', () => {
    // UT-UI-SRH-01 §4.5.1
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);

    host.showErrorHighlight({ trackIndex: 1, startBarIndex: 4, barCount: 2, code: 'EDIT-002' });

    const el = container.querySelector('.riff-line-error-highlight') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-track-index')).toBe('1');
    expect(el?.getAttribute('data-start-bar')).toBe('4');
    expect(el?.getAttribute('data-code')).toBe('EDIT-002');
    expect(container.style.position).toBe('relative');
    host.dispose();
  });

  it('showErrorHighlight_連続呼び出しで前のハイライトを置き換える', () => {
    // UT-UI-SRH-02 §4.5.1
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 1 });
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 5, barCount: 1 });
    expect(container.querySelectorAll('.riff-line-error-highlight')).toHaveLength(1);
    host.dispose();
  });

  it('showErrorHighlight_durationMs経過で自動解除する', () => {
    // UT-UI-SRH-03 §4.5.1（一定時間経過後に自動解除）
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
    // UT-UI-SRH-04 §4.5.1
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.clearErrorHighlight(); // 未表示
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 1 });
    host.clearErrorHighlight();
    expect(container.querySelector('.riff-line-error-highlight')).toBeNull();
    host.dispose();
  });

  it('showErrorHighlight_boundsLookupから対象トラックの矩形を使う', () => {
    // UT-UI-SRH-05 §4.5.1・G24（getPartRegions と連携）
    mocks.state.renderer = {
      boundsLookup: { staffSystems: [{ tracks: [{ trackIndex: 2, visualBounds: { x: 10, y: 20, w: 300, h: 50 } }] }] },
    };
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.showErrorHighlight({ trackIndex: 2, startBarIndex: 0, barCount: 1 });
    const el = container.querySelector('.riff-line-error-highlight') as HTMLElement;
    expect(el.style.left).toBe('10px');
    expect(el.style.width).toBe('300px');
    host.dispose();
  });

  it('dispose_ハイライトも除去する', () => {
    // UT-UI-SRH-06 §4.5.1
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    host.showErrorHighlight({ trackIndex: 0, startBarIndex: 0, barCount: 1 });
    host.dispose();
    expect(container.querySelector('.riff-line-error-highlight')).toBeNull();
  });

  it('getPartRegions_boundsLookup未提供なら空配列', () => {
    // UT-UI-SRH-07 G24（トラック別矩形が取れない alphaTab 版）
    const container = mountedContainer();
    const host = new ScoreRenderHost();
    host.initialize(container, OPTIONS);
    expect(host.getPartRegions()).toEqual([]);
    host.dispose();
  });
});

describe('resolvePartRegions（純関数、G24）', () => {
  it('resolvePartRegions_null/undefinedは空配列', () => {
    // UT-UI-SRH-08 G24
    expect(resolvePartRegions(null)).toEqual([]);
    expect(resolvePartRegions(undefined)).toEqual([]);
  });

  it('resolvePartRegions_staffSystems.tracksをコンテナ相対矩形へ写す', () => {
    // UT-UI-SRH-09 G24
    const regions = resolvePartRegions({
      staffSystems: [
        { tracks: [{ index: 0, bounds: { x: 0, y: 0, width: 100, height: 40 } }] },
        { tracks: [{ trackIndex: 1, visualBounds: { x: 0, y: 40, w: 100, h: 40 } }] },
      ],
    });
    expect(regions).toEqual([
      { trackIndex: 0, x: 0, y: 0, width: 100, height: 40 },
      { trackIndex: 1, x: 0, y: 40, width: 100, height: 40 },
    ]);
  });

  it('resolvePartRegions_trackIndexや矩形が欠けた要素はスキップ', () => {
    // UT-UI-SRH-10 G24（頑健性）
    const regions = resolvePartRegions({
      staffSystems: [{ tracks: [{ bounds: { x: 0, y: 0 } }, { trackIndex: 3 }] }],
    });
    expect(regions).toEqual([]);
  });
});
