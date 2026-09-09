/**
 * スコア表示のパート識別色オーバーレイの DOM/CSS 生成（G24、screens-navigation.md スコープ #10、
 * view-modes.md §4.3・§9、02_data_model.md §3.2）。
 *
 * `ScoreRenderHost.getPartRegions()` が `boundsLookup` から提供するパート別描画領域を用い、コンテナ上に
 * 絶対配置の半透明カラーバンド `<div>` を重ねる。alphaTab 1.8.4 の SVG 出力はトラック単位の DOM 要素を持たず
 * `data-track-index` を付与できない（B34）ため、SVG そのものではなくオーバーレイ要素で着色する。
 *
 * パート色は `PartManagementService` / `PartColorAllocator`（part-tuning-management.md §4.3）が確定した HEX を
 * `colorByTrackIndex` として受け取るだけ（本モジュールは色を決めない）。
 */

import type { PartRegion } from '../rendering';

/** オーバーレイ帯の不透明度（識別はできるが譜面可読性を損なわない程度）。 */
const OVERLAY_OPACITY = 0.14;

/** 生成するオーバーレイ要素のクラス名（L5 の CSS からも参照できるよう固定）。 */
export const PART_COLOR_OVERLAY_CLASS = 'riff-line-part-color-overlay';

export class PartColorOverlay {
  private readonly container: HTMLElement;
  /** 本オーバーレイが生成した帯要素をまとめる親（コンテナ直下に 1 つだけ持つ）。 */
  private root: HTMLElement | null = null;

  /** @param container `ScoreRenderHost` を初期化したのと同じスコア描画コンテナ。 */
  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 現在のパート別描画領域と色マップからオーバーレイを再構築する（スコア表示への切替・再描画・ズーム後に呼ぶ）。
   * regions が空（トラック別矩形が取れない alphaTab 版）なら既存オーバーレイを消すだけで何もしない。
   *
   * @param regions `ScoreRenderHost.getPartRegions()` の結果。
   * @param colorByTrackIndex trackIndex → パート識別色（`#RRGGBB`）。未指定トラックは着色しない。
   */
  update(regions: readonly PartRegion[], colorByTrackIndex: ReadonlyMap<number, string>): void {
    this.ensureRoot();
    const root = this.root;
    if (root === null) return;
    root.replaceChildren();

    for (const region of regions) {
      const color = colorByTrackIndex.get(region.trackIndex);
      if (color === undefined) continue;
      const band = this.container.ownerDocument.createElement('div');
      band.className = `${PART_COLOR_OVERLAY_CLASS}__band`;
      band.setAttribute('data-track-index', String(region.trackIndex));
      band.style.position = 'absolute';
      band.style.pointerEvents = 'none';
      band.style.left = `${region.x}px`;
      band.style.top = `${region.y}px`;
      band.style.width = `${region.width}px`;
      band.style.height = `${region.height}px`;
      band.style.backgroundColor = color;
      band.style.opacity = String(OVERLAY_OPACITY);
      root.appendChild(band);
    }
  }

  /** オーバーレイを消す（フォーカス / 全体スクロール表示へ切替時など、スコア表示以外では出さない）。 */
  clear(): void {
    this.root?.replaceChildren();
  }

  /** オーバーレイ用の親要素ごと除去する（ウィンドウクローズ時）。 */
  dispose(): void {
    this.root?.remove();
    this.root = null;
  }

  /** コンテナ直下にオーバーレイ用の絶対配置レイヤーを 1 つ用意する（無ければ作る）。 */
  private ensureRoot(): void {
    if (this.root !== null && this.root.isConnected) return;
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    const root = this.container.ownerDocument.createElement('div');
    root.className = PART_COLOR_OVERLAY_CLASS;
    root.style.position = 'absolute';
    root.style.left = '0';
    root.style.top = '0';
    root.style.right = '0';
    root.style.bottom = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '3';
    this.container.appendChild(root);
    this.root = root;
  }
}
