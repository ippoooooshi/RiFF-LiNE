// UT-UI-TG: ThumbnailGenerator（screens-navigation.md §3.3・§6、B7、G6）
// 検証節: screens-navigation.md §3.3（先頭1段 SVG→実 base64-png、SongRepository.save フック）、§6（フック呼び出しタイミング）
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ThumbnailGenerator,
  defaultRasterizer,
  rasterizeEnv,
  stripDataUrlPrefix,
  svgToDataUrl,
  THUMBNAIL_MAX_HEIGHT,
  THUMBNAIL_MAX_WIDTH,
  type ThumbnailSource,
} from './ThumbnailGenerator';

function source(svg: string | null): ThumbnailSource {
  return { captureFirstSystemSvg: () => svg };
}

describe('svgToDataUrl / stripDataUrlPrefix（純関数）', () => {
  it('svgToDataUrl_SVGをimgが読めるdata URLへ包む', () => {
    // UT-UI-TG-01 §3.3
    expect(svgToDataUrl('<svg><rect/></svg>')).toBe(
      'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3Crect%2F%3E%3C%2Fsvg%3E',
    );
  });

  it('stripDataUrlPrefix_data URLのbase64本体だけ取り出す / プレフィックス無しはそのまま', () => {
    // UT-UI-TG-02 §3.3
    expect(stripDataUrlPrefix('data:image/png;base64,AAAB')).toBe('AAAB');
    expect(stripDataUrlPrefix('AAAB')).toBe('AAAB');
  });
});

describe('defaultRasterizer（実 PNG ラスタライズ、rasterizeEnv 差し替えで全分岐網羅）', () => {
  const originalCreateCanvas = rasterizeEnv.createCanvas;
  const originalLoadImage = rasterizeEnv.loadImage;

  afterEach(() => {
    rasterizeEnv.createCanvas = originalCreateCanvas;
    rasterizeEnv.loadImage = originalLoadImage;
    vi.unstubAllGlobals();
  });

  it('defaultRasterizer_canvasが作れない環境はnull', async () => {
    // UT-UI-TG-03 §3.3（DOM 非対応環境）
    rasterizeEnv.createCanvas = () => null;
    await expect(defaultRasterizer('<svg/>')).resolves.toBeNull();
  });

  it('defaultRasterizer_2Dコンテキストが取れない環境はnull（jsdom 既定）', async () => {
    // UT-UI-TG-04 §3.3（canvas 非対応）
    rasterizeEnv.createCanvas = () => ({ getContext: () => null }) as unknown as HTMLCanvasElement;
    await expect(defaultRasterizer('<svg/>')).resolves.toBeNull();
  });

  it('defaultRasterizer_画像デコード失敗はnull', async () => {
    // UT-UI-TG-05 §3.3（不正 SVG 等）
    rasterizeEnv.createCanvas = () => ({ getContext: () => ({ drawImage: vi.fn() }) }) as unknown as HTMLCanvasElement;
    rasterizeEnv.loadImage = () => Promise.reject(new Error('decode failed'));
    await expect(defaultRasterizer('<svg/>')).resolves.toBeNull();
  });

  it('defaultRasterizer_成功時はPNGのbase64本体を返す（naturalサイズを使う）', async () => {
    // UT-UI-TG-06 §3.3（B7 実 base64-png）
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: vi.fn(() => 'data:image/png;base64,PNGDATA'),
    };
    rasterizeEnv.createCanvas = () => canvas as unknown as HTMLCanvasElement;
    rasterizeEnv.loadImage = () => Promise.resolve({ naturalWidth: 300, naturalHeight: 80 } as never);

    await expect(defaultRasterizer('<svg width="300" height="80"/>')).resolves.toBe('PNGDATA');
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(80);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 300, 80);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('defaultRasterizer_固有サイズが無いSVGは既定サイズへフォールバック', async () => {
    // UT-UI-TG-07 §3.3（naturalWidth/Height = 0 分岐）
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => 'data:image/png;base64,X',
    };
    rasterizeEnv.createCanvas = () => canvas as unknown as HTMLCanvasElement;
    rasterizeEnv.loadImage = () => Promise.resolve({ naturalWidth: 0, naturalHeight: 0 } as never);

    await expect(defaultRasterizer('<svg/>')).resolves.toBe('X');
    expect(canvas.width).toBe(THUMBNAIL_MAX_WIDTH);
    expect(canvas.height).toBe(THUMBNAIL_MAX_HEIGHT);
  });
});

describe('rasterizeEnv.createCanvas / loadImage（DOM 縫い目）', () => {
  const originalCreateCanvas = rasterizeEnv.createCanvas;
  const originalLoadImage = rasterizeEnv.loadImage;
  afterEach(() => {
    rasterizeEnv.createCanvas = originalCreateCanvas;
    rasterizeEnv.loadImage = originalLoadImage;
    vi.unstubAllGlobals();
  });

  it('createCanvas_documentがあれば<canvas>を返す（jsdom）', () => {
    // UT-UI-TG-08 §3.3
    const canvas = originalCreateCanvas();
    expect(canvas).not.toBeNull();
    expect(canvas?.tagName?.toLowerCase()).toBe('canvas');
  });

  it('createCanvas_documentが無い環境はnull', () => {
    // UT-UI-TG-09 §3.3（typeof document === "undefined" 分岐）
    vi.stubGlobal('document', undefined);
    expect(originalCreateCanvas()).toBeNull();
  });

  it('createCanvas_createElementが関数でない環境はnull', () => {
    // UT-UI-TG-10 §3.3（typeof document.createElement !== "function" 分岐）
    vi.stubGlobal('document', {});
    expect(originalCreateCanvas()).toBeNull();
  });

  it('loadImage_Imageが無い環境はreject', async () => {
    // UT-UI-TG-11 §3.3（typeof Image !== "function" 分岐）
    vi.stubGlobal('Image', undefined);
    await expect(originalLoadImage('data:image/svg+xml,x')).rejects.toBeInstanceOf(Error);
  });

  it('loadImage_onloadでresolve / onerrorでreject', async () => {
    // UT-UI-TG-12 §3.3（Image のイベント分岐）
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 10;
      naturalHeight = 4;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    await expect(originalLoadImage('data:image/svg+xml,ok')).resolves.toMatchObject({ naturalWidth: 10 });

    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);
    await expect(originalLoadImage('data:image/svg+xml,bad')).rejects.toBeInstanceOf(Error);
  });
});

describe('ThumbnailGenerator', () => {
  it('ThumbnailGenerator_SVGが取れない_nullを返す', async () => {
    // UT-UI-TG-13 §3.3（未描画時）
    const gen = new ThumbnailGenerator(source(null), () => Promise.resolve('x'));
    await expect(gen.generate()).resolves.toBeNull();
  });

  it('ThumbnailGenerator_ラスタライズ成功_base64-pngサムネイルを返す', async () => {
    // UT-UI-TG-14 §3.3（AppMetadata.thumbnail 型）
    const gen = new ThumbnailGenerator(source('<svg/>'), () => Promise.resolve('BASE64DATA'));
    await expect(gen.generate()).resolves.toEqual({ encoding: 'base64-png', data: 'BASE64DATA' });
  });

  it('ThumbnailGenerator_ラスタライズがnull/空文字_nullを返す', async () => {
    // UT-UI-TG-15 §3.3（ヘッドレス環境）
    await expect(new ThumbnailGenerator(source('<svg/>'), () => Promise.resolve(null)).generate()).resolves.toBeNull();
    await expect(new ThumbnailGenerator(source('<svg/>'), () => Promise.resolve('')).generate()).resolves.toBeNull();
  });

  it('ThumbnailGenerator_既定ラスタライザを注入せずに構築できる（2Dコンテキスト無しでnull生成）', async () => {
    // UT-UI-TG-16 §3.3（既定 rasterize=defaultRasterizer の結線確認）
    const original = rasterizeEnv.createCanvas;
    rasterizeEnv.createCanvas = () => ({ getContext: () => null }) as unknown as HTMLCanvasElement;
    try {
      const gen = new ThumbnailGenerator(source('<svg/>'));
      await expect(gen.generate()).resolves.toBeNull();
    } finally {
      rasterizeEnv.createCanvas = original;
    }
  });

  it('ThumbnailGenerator_wrapSave_保存前にサムネイルをappMeta.thumbnailへ差し込む', async () => {
    // UT-UI-TG-17 §3.3・§6（フック呼び出しタイミング）
    const gen = new ThumbnailGenerator(source('<svg/>'), () => Promise.resolve('DATA'));
    const order: string[] = [];
    const rawSave = vi.fn(async (doc: { appMeta: { thumbnail: unknown } }) => {
      order.push('save');
      expect(doc.appMeta.thumbnail).toEqual({ encoding: 'base64-png', data: 'DATA' });
    });
    const doc = { appMeta: { thumbnail: null } };
    await gen.wrapSave(rawSave)(doc);
    expect(order).toEqual(['save']);
    expect(rawSave).toHaveBeenCalledTimes(1);
  });

  it('ThumbnailGenerator_wrapSave_生成失敗でも保存は続行する', async () => {
    // UT-UI-TG-18 §3.3（サムネイルは次回保存で埋まればよい）
    const gen = new ThumbnailGenerator(source('<svg/>'), () => Promise.reject(new Error('boom')));
    const rawSave = vi.fn(async () => undefined);
    const doc = { appMeta: { thumbnail: null } };
    await gen.wrapSave(rawSave)(doc);
    expect(rawSave).toHaveBeenCalledTimes(1);
    expect(doc.appMeta.thumbnail).toBeNull();
  });
});
