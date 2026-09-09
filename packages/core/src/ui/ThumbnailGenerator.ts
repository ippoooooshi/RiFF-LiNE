/**
 * 曲一覧サムネイルの生成（screens-navigation.md §3.3、B7、00_reference.md §3.8 `ThumbnailGenerator` 行）。
 *
 * [[data-model-persistence.md#11]] が表示モードパッケージへ申し送っていたが実装されなかった問題（G6）を、
 * 画面群パッケージが引き取る。B7 の定義（「alphaTab レイアウトでの最初の 1 段（システム）」）に従い、
 * `ScoreRenderHost` の描画結果から先頭 1 段の SVG を切り出し、**実 PNG**（`base64-png`、`AppMetadata.thumbnail` 型）へ
 * ラスタライズする。`SongRepository.save()` のシグネチャは変えず、保存関数を包む非破壊フックとして接続する
 * （`AutoSaveScheduler` / 明示保存の両経路が同じ包んだ関数を使う）。
 *
 * ラスタライズは `<img>`（SVG data URL）→ `<canvas>.drawImage` → `canvas.toDataURL('image/png')` の順。
 * DOM / canvas が使えない環境（ヘッドレス・jsdom）では `null` を返す（サムネイルは次回保存で埋まればよい）。
 * 実描画の画質・サイズ確認は手動シナリオ（screens-navigation.md §6・§9.0 P2 系）。
 */

import type { AppMetadata } from '../domain/types';

/** サムネイル（`AppMetadata.thumbnail` と同型）。 */
export type Thumbnail = NonNullable<AppMetadata['thumbnail']>;

/** サムネイルの既定描画サイズ（px）。SVG に固有サイズが無いときのフォールバック。 */
export const THUMBNAIL_MAX_WIDTH = 480;
export const THUMBNAIL_MAX_HEIGHT = 120;

/** 先頭 1 段の SVG マークアップを返す source（bootstrap が `ScoreRenderHost` のコンテナ照会で実装）。 */
export interface ThumbnailSource {
  /** 現在描画中スコアの先頭システムの SVG 文字列。未描画・取得不能なら null。 */
  captureFirstSystemSvg(): string | null;
}

/** SVG をラスタライズして base64（`data:` プレフィックス無し）を返す関数（DOM 依存を差し替え可能にする縫い目）。 */
export type SvgRasterizer = (svg: string) => Promise<string | null>;

/** 保存対象ドキュメントの最小形（`appMeta.thumbnail` を差し込めればよい）。 */
export interface ThumbnailTarget {
  appMeta: Pick<AppMetadata, 'thumbnail'> & Record<string, unknown>;
}

// ===== 実 PNG ラスタライズ（既定実装） =====

/** SVG 文字列を `<img>` に読ませられる data URL へ（純関数）。 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** `data:image/png;base64,XXXX` から base64 本体だけを取り出す（純関数）。プレフィックスが無ければそのまま返す。 */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * `defaultRasterizer` が使う DOM 依存の縫い目。テストは差し替えて全分岐を網羅する
 * （実 `<img>` デコードは jsdom で決定的に動かないため）。
 */
export const rasterizeEnv: {
  /** `<canvas>` を作る。DOM 非対応環境は null。 */
  createCanvas(): HTMLCanvasElement | null;
  /** SVG data URL を画像として読み込む。失敗（デコード不能）は reject。 */
  loadImage(
    src: string,
  ): Promise<{ readonly naturalWidth: number; readonly naturalHeight: number } & CanvasImageSource>;
} = {
  createCanvas(): HTMLCanvasElement | null {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    return document.createElement('canvas');
  },
  loadImage(src: string) {
    return new Promise<{ readonly naturalWidth: number; readonly naturalHeight: number } & CanvasImageSource>(
      (resolve, reject) => {
        if (typeof Image !== 'function') {
          reject(new Error('Image is not available'));
          return;
        }
        const img = new Image();
        img.onload = (): void =>
          resolve(img as unknown as { naturalWidth: number; naturalHeight: number } & CanvasImageSource);
        img.onerror = (): void => reject(new Error('SVG image failed to decode'));
        img.src = src;
      },
    );
  },
};

/**
 * 既定ラスタライザ：SVG を実 PNG（base64）へ変換する。
 * canvas / 2D コンテキストが無い、または画像デコードに失敗した場合は `null`（doc どおり）。
 */
export const defaultRasterizer: SvgRasterizer = async (svg: string): Promise<string | null> => {
  const canvas = rasterizeEnv.createCanvas();
  const ctx = canvas !== null && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (canvas === null || ctx === null) return null;

  let image: { naturalWidth: number; naturalHeight: number } & CanvasImageSource;
  try {
    image = await rasterizeEnv.loadImage(svgToDataUrl(svg));
  } catch {
    return null;
  }

  // SVG に固有サイズが無ければ既定サイズへフォールバックする。
  const width = image.naturalWidth > 0 ? image.naturalWidth : THUMBNAIL_MAX_WIDTH;
  const height = image.naturalHeight > 0 ? image.naturalHeight : THUMBNAIL_MAX_HEIGHT;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0, width, height);

  return stripDataUrlPrefix(canvas.toDataURL('image/png'));
};

export class ThumbnailGenerator {
  private readonly source: ThumbnailSource;
  private readonly rasterize: SvgRasterizer;

  constructor(source: ThumbnailSource, rasterize: SvgRasterizer = defaultRasterizer) {
    this.source = source;
    this.rasterize = rasterize;
  }

  /**
   * 現在描画中スコアからサムネイルを生成する。SVG が取れない / ラスタライズ不能なら null。
   */
  async generate(): Promise<Thumbnail | null> {
    const svg = this.source.captureFirstSystemSvg();
    if (svg === null || svg.length === 0) return null;
    const data = await this.rasterize(svg);
    if (data === null || data.length === 0) return null;
    return { encoding: 'base64-png', data };
  }

  /**
   * 保存関数を包み、保存直前に最新サムネイルを `appMeta.thumbnail` へ差し込む非破壊フック（screens-navigation.md §3.3）。
   * 生成に失敗しても保存自体は続行する（サムネイルは次回保存で埋まればよい）。
   *
   * @param save 元の保存関数（`SongRepository.save` を bind したもの等）。
   * @returns 同じシグネチャの包んだ保存関数。`AutoSaveScheduler` と明示保存の両方がこれを使う。
   */
  wrapSave<T extends ThumbnailTarget>(save: (document: T) => Promise<void>): (document: T) => Promise<void> {
    return async (document: T): Promise<void> => {
      try {
        const thumbnail = await this.generate();
        if (thumbnail !== null) document.appMeta.thumbnail = thumbnail;
      } catch (error) {
        console.error('[ThumbnailGenerator] generate failed, saving without thumbnail:', error);
      }
      await save(document);
    };
  }
}
