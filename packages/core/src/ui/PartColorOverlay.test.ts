// UT-UI-PCO: PartColorOverlay（G24、screens-navigation.md スコープ #10、view-modes.md §4.3・§9）
// 検証節: 00_reference.md §8.1 G24（パート識別色オーバーレイの DOM/CSS 生成）
import { describe, expect, it } from 'vitest';

import type { PartRegion } from '../rendering';

import { PART_COLOR_OVERLAY_CLASS, PartColorOverlay } from './PartColorOverlay';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const REGIONS: PartRegion[] = [
  { trackIndex: 0, x: 0, y: 0, width: 100, height: 40 },
  { trackIndex: 1, x: 0, y: 40, width: 100, height: 40 },
];

describe('PartColorOverlay', () => {
  it('PartColorOverlay_regionsと色マップから帯要素を生成する', () => {
    // UT-UI-PCO-01 G24
    const container = makeContainer();
    const overlay = new PartColorOverlay(container);
    overlay.update(
      REGIONS,
      new Map([
        [0, '#ff0000'],
        [1, '#00ff00'],
      ]),
    );

    const root = container.querySelector(`.${PART_COLOR_OVERLAY_CLASS}`);
    expect(root).not.toBeNull();
    const bands = container.querySelectorAll(`.${PART_COLOR_OVERLAY_CLASS}__band`);
    expect(bands).toHaveLength(2);
    expect((bands[0] as HTMLElement).style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect((bands[0] as HTMLElement).getAttribute('data-track-index')).toBe('0');
    expect((bands[1] as HTMLElement).style.top).toBe('40px');
  });

  it('PartColorOverlay_色マップに無いトラックは着色しない', () => {
    // UT-UI-PCO-02 G24（part-tuning の色確定分だけ着色）
    const container = makeContainer();
    const overlay = new PartColorOverlay(container);
    overlay.update(REGIONS, new Map([[0, '#123456']]));
    expect(container.querySelectorAll(`.${PART_COLOR_OVERLAY_CLASS}__band`)).toHaveLength(1);
  });

  it('PartColorOverlay_regionsが空_帯を出さない（boundsLookup非対応版のフォールバック）', () => {
    // UT-UI-PCO-03 G24（トラック別矩形が取れない alphaTab 版）
    const container = makeContainer();
    const overlay = new PartColorOverlay(container);
    overlay.update([], new Map([[0, '#123456']]));
    expect(container.querySelectorAll(`.${PART_COLOR_OVERLAY_CLASS}__band`)).toHaveLength(0);
  });

  it('PartColorOverlay_clearで帯だけ消しrootは残す / disposeでroot自体を除去', () => {
    // UT-UI-PCO-04 G24（表示モード切替でオーバーレイを出し入れ）
    const container = makeContainer();
    const overlay = new PartColorOverlay(container);
    overlay.update(REGIONS, new Map([[0, '#111111']]));
    overlay.clear();
    expect(container.querySelectorAll(`.${PART_COLOR_OVERLAY_CLASS}__band`)).toHaveLength(0);
    expect(container.querySelector(`.${PART_COLOR_OVERLAY_CLASS}`)).not.toBeNull();
    overlay.dispose();
    expect(container.querySelector(`.${PART_COLOR_OVERLAY_CLASS}`)).toBeNull();
  });

  it('PartColorOverlay_update再呼び出しで帯を作り直す（重複しない）', () => {
    // UT-UI-PCO-05 G24（再描画・ズーム後の再構築）
    const container = makeContainer();
    const overlay = new PartColorOverlay(container);
    overlay.update(
      REGIONS,
      new Map([
        [0, '#111111'],
        [1, '#222222'],
      ]),
    );
    overlay.update([REGIONS[0]!], new Map([[0, '#333333']]));
    expect(container.querySelectorAll(`.${PART_COLOR_OVERLAY_CLASS}__band`)).toHaveLength(1);
  });

  it('PartColorOverlay_static配置のコンテナをrelativeへ寄せる', () => {
    // UT-UI-PCO-06 G24（絶対配置の基準）
    const container = makeContainer();
    new PartColorOverlay(container).update(REGIONS, new Map([[0, '#111111']]));
    expect(container.style.position).toBe('relative');
  });
});
