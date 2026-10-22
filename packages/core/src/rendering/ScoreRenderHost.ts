/**
 * alphaTab の唯一の窓口（web-core-foundation.md 12.1 節）。
 *
 * alphaTab の `AlphaTabApi` を 1 つだけ持ち、初期化・曲の読み込み・描き直し・破棄の窓口になる。
 * ほかのモジュールは本クラスを通してだけ alphaTab を扱い、`AlphaTabApi` に直接触れない。
 */

import { AlphaTabApi, importer, LayoutMode, Settings } from '@coderline/alphatab';
// 12.1 節：alphaTab の model は型のみで取り込む <!-- req webcorefoundation:ea04cbe1.b7af --> <!-- req webcorefoundation:ea04cbe1.fab4 -->
import type { model } from '@coderline/alphatab';

import { rebuildDerivedLinks } from './rebuildDerivedLinks';
import type {
  PartRegion,
  RenderHostEventListener,
  RenderHostEventMap,
  RenderHostEvents,
  RenderHostOptions,
  ScoreHighlightRequest,
  ViewModeRenderRequest,
} from './types';
import { DEFAULT_HIGHLIGHT_DURATION_MS } from './types';

/**
 * ScoreRenderHost が内部で使う alphaTab API の最小構造。
 * これに限定して依存することで、テストで偽物の alphaTab に差し替えやすくする。
 */
interface AlphaTabApiLike {
  /** 曲を描く（描き直す）。trackIndexes は表示するパートの番号（alphaTab の型定義の注のとおり、省くと最初のパートだけ）。 */
  renderScore(score: model.Score, trackIndexes?: number[]): void;
  /** 今の設定と今の曲のまま描き直す（ズームで使う。作り直しをしない）。 */
  render(): void;
  destroy(): void;
  readonly renderStarted: { on(handler: () => void): void };
  readonly renderFinished: { on(handler: () => void): void };
  readonly error: { on(handler: (error: unknown) => void): void };
  /** 描いている曲。描く前なら null。 */
  readonly score: { readonly tracks: readonly unknown[] } | null;
  /** alphaTab の設定。表示モードとズームは display を変えてから `updateSettings()` で反映する。 */
  readonly settings: Settings;
  /** `settings` の変更をレンダラーへ適用する。 */
  updateSettings(): void;
  /** 指定したパートだけを表示して描き直す（表示モードの切り替えで使う。作り直しをしない）。 */
  renderTracks(tracks: readonly unknown[]): void;
  /** レンダラー。描いた結果の `boundsLookup` から小節とパートの矩形を引く（描く前は boundsLookup が null）。 */
  readonly renderer: { readonly boundsLookup: BoundsLookupLike | null } | undefined;
}

/** alphaTab 1.8.4 の `Bounds`（x・y・w・h）。 */
interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** alphaTab 1.8.4 の `BarBounds` のうち読む所（`bar.staff.track.index` と `visualBounds`）。 */
interface BarBoundsLike {
  visualBounds: RectLike;
  bar: { staff: { track: { index: number } } };
}
/** alphaTab 1.8.4 の `MasterBarBounds` のうち読む所。 */
interface MasterBarBoundsLike {
  bars: readonly BarBoundsLike[];
  staffSystemBounds: { index: number } | null;
}
/** alphaTab 1.8.4 の `StaffSystemBounds` のうち読む所。 */
interface StaffSystemBoundsLike {
  index: number;
  bars: readonly MasterBarBoundsLike[];
}
/** alphaTab 1.8.4 の `BoundsLookup` のうち読む所。 */
interface BoundsLookupLike {
  staffSystems: readonly StaffSystemBoundsLike[];
  findMasterBarByIndex(index: number): MasterBarBoundsLike | null;
}

/** 矩形を合わせる（x・y・w・h の外側を囲む矩形）。 */
function unionRect(a: RectLike | undefined, b: RectLike): RectLike {
  if (a === undefined) return { x: b.x, y: b.y, w: b.w, h: b.h };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * 今描いている譜面の、段ごと・パートごとの矩形（純関数・テストの対象）。
 * (b) alphaTab 1.8.4 の `StaffSystemBounds` はパートごとの矩形を持たないので、`StaffSystemBounds.bars` →
 * `MasterBarBounds.bars` → `BarBounds.bar.staff.track.index` とたどり、同じパートの `BarBounds.visualBounds` を合わせる。
 * 描く前（boundsLookup が無い）は空の配列を返す。
 */
// 12.1 節：パートの描画の領域は段ごと・パートごとの矩形を小節の側から組み立てる（作り直す前の staffSystems.tracks を読む形と、小節の範囲を見ないハイライトは直した） <!-- req webcorefoundation:bc6a7d71.8ea9 --> <!-- req webcorefoundation:bc6a7d71.5ceb --> <!-- req webcorefoundation:bc6a7d71.a848 --> <!-- req webcorefoundation:bc6a7d71.d441 --> <!-- req webcorefoundation:bc6a7d71.29ce --> <!-- req webcorefoundation:f62f8619.a222 --> <!-- req webcorefoundation:f62f8619.0cde --> <!-- req webcorefoundation:f62f8619.518b --> <!-- req webcorefoundation:f62f8619.6179 -->
export function resolvePartRegions(boundsLookup: BoundsLookupLike | null | undefined): PartRegion[] {
  const out: PartRegion[] = [];
  for (const system of boundsLookup?.staffSystems ?? []) {
    const byTrack = new Map<number, RectLike>();
    for (const masterBar of system.bars) {
      for (const barBounds of masterBar.bars) {
        const trackIndex = barBounds.bar.staff.track.index;
        byTrack.set(trackIndex, unionRect(byTrack.get(trackIndex), barBounds.visualBounds));
      }
    }
    for (const [trackIndex, r] of [...byTrack].sort(([a], [b]) => a - b)) {
      out.push({ trackIndex, x: r.x, y: r.y, width: r.w, height: r.h });
    }
  }
  return out;
}

/**
 * Error のハイライトの枠（純関数・テストの対象）。`trackIndex` のパートの、`startBarIndex` から `barCount` 個の小節の
 * `visualBounds` を、段ごとに 1 つの枠へまとめる。
 * (b) 小節の矩形は `boundsLookup.findMasterBarByIndex(小節の番号)` が返す `MasterBarBounds` の `bars` から、
 * `bar.staff.track.index` が `trackIndex` に当たるものを取る。今の描画に無い小節（フォーカス表示の範囲の外）は飛ばし、
 * 1 つも無いか、描く前で boundsLookup が無いときは空の配列を返す（枠を出さない）。
 */
// 12.1 節：小節の矩形は findMasterBarByIndex の MasterBarBounds の bars から、bar.staff.track.index が trackIndex のものの visualBounds を取り、段ごとにまとめる。描かれていない小節には枠を出さない <!-- req webcorefoundation:6f631cdc.d3b3 --> <!-- req webcorefoundation:6f631cdc.c585 --> <!-- req webcorefoundation:6f631cdc.350b --> <!-- req webcorefoundation:6f631cdc.e28e --> <!-- req webcorefoundation:6f631cdc.d76a --> <!-- req webcorefoundation:6f631cdc.e38c --> <!-- req webcorefoundation:6f631cdc.ebd6 --> <!-- req webcorefoundation:6f631cdc.d6ec --> <!-- req webcorefoundation:6f631cdc.3a49 --> <!-- req webcorefoundation:6f631cdc.e0e7 -->
export function resolveHighlightFrames(
  boundsLookup: BoundsLookupLike | null | undefined,
  request: Pick<ScoreHighlightRequest, 'trackIndex' | 'startBarIndex' | 'barCount'>,
): PartRegion[] {
  if (boundsLookup === null || boundsLookup === undefined) return [];
  const bySystem = new Map<number, RectLike>();
  for (let i = request.startBarIndex; i < request.startBarIndex + request.barCount; i += 1) {
    const masterBar = boundsLookup.findMasterBarByIndex(i);
    if (masterBar === null) continue;
    const system = masterBar.staffSystemBounds?.index ?? -1;
    for (const barBounds of masterBar.bars) {
      if (barBounds.bar.staff.track.index !== request.trackIndex) continue;
      bySystem.set(system, unionRect(bySystem.get(system), barBounds.visualBounds));
    }
  }
  return [...bySystem]
    .sort(([a], [b]) => a - b)
    .map(([, r]) => ({ trackIndex: request.trackIndex, x: r.x, y: r.y, width: r.w, height: r.h }));
}

/**
 * alphaTab の `model.Score` か。
 * (b) 12.1 節のとおり `model` は型のみで取り込むので、`instanceof` を使わず、alphaTab の Score が持つ
 * `masterBars`・`tracks` の配列と `finish` の関数がそろっているかで確かめる。
 */
function isAlphaTabScore(value: unknown): value is model.Score {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { masterBars?: unknown; tracks?: unknown; finish?: unknown };
  return Array.isArray(v.masterBars) && Array.isArray(v.tracks) && typeof v.finish === 'function';
}

/** alphaTab の全小節を表す `settings.display.barCount` の番兵値。 */
const ALL_BARS = -1;

/** Error のハイライトの枠の色（基本設計 08 章 4 節。直値を書かず danger のトークンを使う）。 */
const HIGHLIGHT_BORDER = '2px solid var(--color-danger)';

type AlphaTabSettingsArg = ConstructorParameters<typeof AlphaTabApi>[1];

/** initialize() 前に他メソッドが呼ばれたときのメッセージ。 */
const NOT_INITIALIZED = 'ScoreRenderHost.initialize() must be called before this operation.';

// 9.1 節：譜面の描画は alphaTab のレイアウトエンジンに委ね、符頭・符幹・符尾の規則を自前で持たない。alphaTab の描画を呼ぶのはこの窓口だけ（AlphaTabApi の import は eslint.config.js で rendering の外を止める）。9.3 節：自前の描画・解釈の規則を起こさず、足りないと分かったら実装より先に基本設計 13 章に分岐点を起こす <!-- req webcorefoundation:00cf0110.a0b4 --> <!-- req webcorefoundation:00cf0110.30e5 --> <!-- req webcorefoundation:00cf0110.3100 --> <!-- req webcorefoundation:294b10b0.aebb --> <!-- req webcorefoundation:294b10b0.5c57 --> <!-- req webcorefoundation:294b10b0.2295 --> <!-- req webcorefoundation:294b10b0.6795 --> <!-- req webcorefoundation:294b10b0.4620 --> <!-- req webcorefoundation:294b10b0.4964 --> <!-- req webcorefoundation:47d7d1bb.dbc0 --> <!-- req webcorefoundation:47d7d1bb.396b --> <!-- req webcorefoundation:47d7d1bb.49af --> <!-- req webcorefoundation:47d7d1bb.c13f --> <!-- req webcorefoundation:e3ea8d58.d231 -->
// 12.1 節：alphaTab の描画を呼ぶのは packages/core/src/rendering の ScoreRenderHost だけで、AlphaTabApi を 1 つ持ち、初期化・曲の読み込み・描き直し・破棄の窓口になる。ズーム・エラーのハイライト・パートの描画の領域のメソッドもここに置く <!-- req webcorefoundation:c0005589.6a93 --> <!-- req webcorefoundation:c0005589.26ef --> <!-- req webcorefoundation:c0005589.3a73 --> <!-- req webcorefoundation:c0005589.6d16 --> <!-- req webcorefoundation:c0005589.da1d --> <!-- req webcorefoundation:c0005589.6a37 --> <!-- req webcorefoundation:c0005589.a42f --> <!-- req webcorefoundation:c0005589.4ca7 --> <!-- req webcorefoundation:de2efcc6.75fd --> <!-- req webcorefoundation:de2efcc6.79cc --> <!-- req webcorefoundation:de2efcc6.cd98 --> <!-- req webcorefoundation:de2efcc6.6f93 -->
// 12.1 節：公開のシグネチャは足す形でだけ広げ、前からあるメソッドの名前・引数・戻り値を変えない（12.2 節の (2) のフォールバックも）。印刷と PDF の描画はこのクラスを広げず、別のクラス PrintLayoutRenderHost にする（export-print.md の作業パッケージ） <!-- req webcorefoundation:a760bb9e.7326 --> <!-- req webcorefoundation:a760bb9e.8845 --> <!-- req webcorefoundation:a760bb9e.e034 --> <!-- req webcorefoundation:a760bb9e.e630 --> <!-- req webcorefoundation:a760bb9e.adf9 --> <!-- req webcorefoundation:a760bb9e.3d62 --> <!-- req webcorefoundation:a760bb9e.8450 --> <!-- req webcorefoundation:a760bb9e.c87b --> <!-- req webcorefoundation:a760bb9e.3f72 --> <!-- req webcorefoundation:a760bb9e.1bd6 --> <!-- req webcorefoundation:a760bb9e.0b2a --> <!-- req webcorefoundation:a760bb9e.cd61 --> <!-- req webcorefoundation:a760bb9e.42f7 --> <!-- req webcorefoundation:a760bb9e.5441 --> <!-- req webcorefoundation:a760bb9e.bd87 --> <!-- req webcorefoundation:a760bb9e.656f --> <!-- req webcorefoundation:a760bb9e.3d0c --> <!-- req webcorefoundation:a760bb9e.0273 --> <!-- req webcorefoundation:a760bb9e.7104 --> <!-- req webcorefoundation:a760bb9e.8ec2 --> <!-- req webcorefoundation:a760bb9e.7732 --> <!-- req webcorefoundation:b3fc3787.b785 --> <!-- req webcorefoundation:b3fc3787.349c --> <!-- req webcorefoundation:70da18db.4b39 -->
export class ScoreRenderHost {
  /** 初期化後にのみ非 null。dispose() で null に戻す。 */
  private api: AlphaTabApiLike | null = null;

  /** initialize() で受け取ったマウント先。ハイライトの枠を重ねる表示領域に使う。 */
  private container: HTMLElement | null = null;

  /** loadScore() で受け取った曲。読み込む前は null。 */
  private score: model.Score | null = null;

  /** 最後に受けた表示モードの要求。render() が表示するパートをここから決める。 */
  private viewRequest: ViewModeRenderRequest | null = null;

  /** 今出ている Error のハイライト（枠をまとめた要素）。出ていなければ null。 */
  private highlightEl: HTMLElement | null = null;

  /** ハイライトを外すタイマー。 */
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  /** イベント名 → リスナー集合。 */
  private readonly listeners: {
    [E in RenderHostEvents]: Set<RenderHostEventListener<E>>;
  } = {
    renderStarted: new Set(),
    renderFinished: new Set(),
    renderError: new Set(),
  };

  /**
   * alphaTab を初期化する。
   *
   * @throws コンテナ要素が未マウント（`isConnected === false`）の場合、または既に初期化済みの場合。
   * @throws options.engine が 'svg' 以外の場合（SVG 固定、A2）。
   */
  // 12.1 節：initialize(container, options) <!-- req webcorefoundation:0e742315.cc71 -->
  initialize(container: HTMLElement, options: RenderHostOptions): void {
    // 二重初期化を防ぐ（呼び出し側の設計ミスを早期に顕在化させる）。
    if (this.api !== null) {
      throw new Error('ScoreRenderHost is already initialized. Call dispose() before re-initializing.');
    }

    // コンテナがドキュメントにマウントされていること。alphaTab はマウント済み要素を前提とする。
    if (!container || container.isConnected !== true) {
      throw new Error('ScoreRenderHost.initialize() requires a container element that is mounted in the document.');
    }

    // engine は型上 'svg' 固定だが、JS からの呼び出しに備えて実行時にも検証する。
    if (options.engine !== 'svg') {
      throw new Error(`ScoreRenderHost only supports the 'svg' engine (got: ${String(options.engine)}).`);
    }

    // alphaTab の設定 JSON を組み立てる。再生は作業パッケージ 7 で扱うので、ここでは player を無効にする。
    const settings = {
      core: {
        // 11 節：描画エンジンは SVG（A2）。設定は 4.1 節の core.engine <!-- req webcorefoundation:2e80da1d.1b7d --> <!-- req webcorefoundation:2e80da1d.1af7 -->
        engine: 'svg',
        // <!-- req webcorefoundation:39f13b58.f14d --> <!-- req webcorefoundation:39f13b58.4902 --> <!-- req webcorefoundation:39f13b58.435d -->
        fontDirectory: options.fontAssetsBasePath,
        // 12.2 節：Web Worker を使わず、メインスレッドで同期に描く（B30）。Web Worker の自動生成が CSP の
        // script-src 'self' とぶつかり renderFinished が返らなかったため。渡すのは engine・enableLazyLoading と同じこの 1 か所だけ
        // 12.2 節：useWorkers に false を渡す 1 か所。30fps に届かないと負荷テスト（10.6 節・14.8 節）で分かったときだけ A9 のフォールバック（(1) 簡易描画のレイヤー・(2) 専用のワーカーで非同期の描画に戻す。(2) はここの useWorkers の切り替えで、enableLazyLoading は変えない）を入れる。どちらにするかは測ってから決める <!-- req webcorefoundation:7e6e649b.25d3 --> <!-- req webcorefoundation:7e6e649b.1a6a --> <!-- req webcorefoundation:7e6e649b.2ce3 --> <!-- req webcorefoundation:7e6e649b.0d75 --> <!-- req webcorefoundation:84164c9a.914c --> <!-- req webcorefoundation:84164c9a.90b2 --> <!-- req webcorefoundation:84164c9a.eb91 --> <!-- req webcorefoundation:84164c9a.6f6e --> <!-- req webcorefoundation:84164c9a.d51d --> <!-- req webcorefoundation:84164c9a.dc5a --> <!-- req webcorefoundation:84164c9a.9585 --> <!-- req webcorefoundation:84164c9a.a5d0 --> <!-- req webcorefoundation:84164c9a.f36c --> <!-- req webcorefoundation:f196e0b5.e896 --> <!-- req webcorefoundation:f196e0b5.3b3d -->
        useWorkers: false,
        // 10.3 節：alphaTab の遅延描画は使わない（B30）。core.enableLazyLoading に false を渡すのは rendering のこの 1 か所だけ <!-- req webcorefoundation:56ac4d37.530a --> <!-- req webcorefoundation:56ac4d37.966c --> <!-- req webcorefoundation:56ac4d37.92fd -->
        enableLazyLoading: false,
      },
      player: {
        enablePlayer: false,
        soundFont: options.soundFontAssetsBasePath,
      },
      // 表示モードが変える前の初めのレイアウト（Page レイアウト・全小節）。
      display: {
        scale: 1,
        layoutMode: LayoutMode.Page,
        startBar: 1,
        barCount: ALL_BARS,
      },
    } satisfies Record<string, unknown>;

    const api = new AlphaTabApi(container, settings as AlphaTabSettingsArg) as unknown as AlphaTabApiLike;

    // alphaTab のイベントを本クラスのイベントへ橋渡しする。
    api.renderStarted.on(() => this.emit('renderStarted', undefined));
    api.renderFinished.on(() => this.emit('renderFinished', undefined));
    api.error.on((error: unknown) => this.reportRenderError(error));

    this.api = api;
    this.container = container;
  }

  /**
   * 曲を読み込んで描く。alphaTab の `model.Score` でなければ描かずに 'renderError' で知らせ、外へ例外を投げない。
   * 引数の型は前からの `unknown` のまま（12.1 節の (b)）。
   */
  // 12.1 節：loadScore(score: unknown) は引数の型を unknown のままにし、alphaTab の model.Score かを確かめ、違えば描かずに renderError で知らせる。parseAlphaTex の戻り値は model.Score <!-- req webcorefoundation:6e6c1ead.6c66 --> <!-- req webcorefoundation:6e6c1ead.4814 --> <!-- req webcorefoundation:6e6c1ead.536b --> <!-- req webcorefoundation:2df2dc46.8e38 --> <!-- req webcorefoundation:2df2dc46.dc05 --> <!-- req webcorefoundation:2df2dc46.31fa --> <!-- req webcorefoundation:2df2dc46.48bd --> <!-- req webcorefoundation:2df2dc46.5c4e --> <!-- req webcorefoundation:2df2dc46.0071 --> <!-- req webcorefoundation:2df2dc46.dc47 -->
  loadScore(score: unknown): void {
    this.requireApi();
    if (!isAlphaTabScore(score)) {
      this.reportRenderError(new Error('ScoreRenderHost.loadScore() requires an alphaTab model.Score.'));
      return;
    }
    this.score = score;
    this.render();
  }

  /**
   * 描き直す。描き直しを頼むのは CommandHistory（11 節）。
   * 順は (1)(2) の作り直し（`rebuildDerivedLinks`）→ (3) `AlphaTabApi.renderScore(score, 表示するパートの番号)`。
   * alphaTab の描画を呼ぶのはこの render の中だけ（11 節）。
   * @param trackIndices 変わったパートの番号。(b) alphaTab の `renderScore` の 2 つ目の引数は「表示するパート」で、
   *   変わったパートだけを渡すとほかのパートが表示から消えるので、渡すのは表示モードが決めた表示中のパートにする
   *   （詳細設計の 12.1 節の「renderScore(score, trackIndices)」との違いは honnin-queue 185 番）。
   */
  // 11 節：描き直しは AlphaTabApi.renderScore をこの render の中だけで呼ぶ（2 つ目の引数は表示中のパート。honnin-queue 185 番）。パートが 0 の曲は描けない前提で、描画を呼ぶかをこの窓口で決める（案内を出すのは作業パッケージ 8）。描けるかは実装の前に確かめる（Phase 0） <!-- req webcorefoundation:05899c08.84cd --> <!-- req webcorefoundation:05899c08.5d45 --> <!-- req webcorefoundation:77fe67f1.9e03 --> <!-- req webcorefoundation:77fe67f1.153e --> <!-- req webcorefoundation:77fe67f1.26ab --> <!-- req webcorefoundation:77fe67f1.c90a --> <!-- req webcorefoundation:1c73e094.5697 -->
  // 12.1 節：render(trackIndices) は描く前に rebuildDerivedLinks で作り直してから renderScore を呼ぶ（今は Score.finish を呼ぶ）。描き直しを頼むのは CommandHistory <!-- req webcorefoundation:7ec32fe0.7b3f --> <!-- req webcorefoundation:7ec32fe0.3652 --> <!-- req webcorefoundation:7ec32fe0.dc60 --> <!-- req webcorefoundation:ad06c3f9.9423 --> <!-- req webcorefoundation:ad06c3f9.eeae --> <!-- req webcorefoundation:ad06c3f9.5ae9 --> <!-- req webcorefoundation:ad06c3f9.f422 --> <!-- req webcorefoundation:ad06c3f9.bcb8 --> <!-- req webcorefoundation:ad06c3f9.0313 --> <!-- req webcorefoundation:ad06c3f9.df8c --> <!-- req webcorefoundation:ad06c3f9.7338 --> <!-- req webcorefoundation:ad06c3f9.fb98 --> <!-- req webcorefoundation:ad06c3f9.f09a --> <!-- req webcorefoundation:ad06c3f9.cea9 --> <!-- req webcorefoundation:bf1c6231.8b64 -->
  render(trackIndices?: number[]): void {
    const api = this.requireApi();
    void trackIndices;
    const score = this.score;
    if (score === null) return;
    // 11 節：パートが 0 の曲は alphaTab がそのまま描けるかを確かめていないので、描画を呼ばない（案内は作業パッケージ 8）
    if (score.tracks.length === 0) return;
    // (b) 作り直しと描き直しの中の例外は外へ投げず 'renderError' で知らせる。loadScore と同じく、
    // 描画の失敗で編集ウィンドウの起動やコマンドの実行ごと止めないため
    try {
      rebuildDerivedLinks(score, api.settings);
      api.renderScore(score, this.displayedTrackIndices(score));
    } catch (error) {
      this.reportRenderError(error);
    }
  }

  /**
   * 表示モードの構成を当てる（view-modes.md）。曲の中身を変えないので、作り直さずに描き直す。
   * - `focus` … `focusTrackIndex` の 1 パートを `focusRange` の小節で描く（12.2 節）
   * - `scroll` … `focusTrackIndex` の 1 パートを全部の小節で描く
   * - `score` … 全部のパートを描く（パートの色の帯は作業パッケージ 8 の PartColorOverlay）
   * `focusTrackIndex` が範囲の外のときは全部のパートを描く。
   */
  // 10.3 節：100 小節を超える曲でも速さを保つため、フォーカス表示で描く小節を絞り（display.startBar・barCount）、全部の小節を一度に DOM に描く仕組みを自前で作らない。大曲の全体表示の速さは A9 で実機を使って確かめる（Phase 0 と 14.8 節） <!-- req webcorefoundation:cbcd0f67.d2f9 --> <!-- req webcorefoundation:cbcd0f67.1ce2 --> <!-- req webcorefoundation:cbcd0f67.7a67 --> <!-- req webcorefoundation:63a0e279.3af8 --> <!-- req webcorefoundation:63a0e279.d432 -->
  // 12.1 節：applyViewMode は作り直さずに描き直す。12.2 節：フォーカスビューで描く小節を display.startBar（1 始まり）と display.barCount に絞って 30fps を満たし、遅延描画に頼らない。全体スクロールとスコア表示は alphaTab の描画をそのまま使い、簡易描画のレイヤーを作らない。もう一方のボイスを薄く出す描き方は作業パッケージ 6 <!-- req webcorefoundation:800f1d75.b1b6 --> <!-- req webcorefoundation:daf82259.e690 --> <!-- req webcorefoundation:daf82259.4ef1 --> <!-- req webcorefoundation:daf82259.cc1d --> <!-- req webcorefoundation:daf82259.eca9 --> <!-- req webcorefoundation:daf82259.9589 --> <!-- req webcorefoundation:cc8dd29b.f8bd --> <!-- req webcorefoundation:cc8dd29b.6813 --> <!-- req webcorefoundation:cc8dd29b.6518 -->
  applyViewMode(request: ViewModeRenderRequest): void {
    const api = this.requireApi();
    this.viewRequest = request;
    const { display } = api.settings;

    // 12.2 節：フォーカスビューだけが描く小節を絞る。alphaTab の startBar は 1 始まりなので、0 始まりの startBarIndex に 1 を足す
    if (request.mode === 'focus' && request.focusRange !== undefined) {
      display.startBar = Math.max(1, Math.floor(request.focusRange.startBarIndex) + 1);
      display.barCount = Math.max(1, Math.floor(request.focusRange.barCount));
    } else {
      display.startBar = 1;
      display.barCount = ALL_BARS;
    }
    display.layoutMode = LayoutMode.Page;
    api.updateSettings();

    // 11 節：曲を読み込む前と、パートが 0 の曲は描画を呼ばない
    const tracks = this.score?.tracks ?? [];
    if (tracks.length === 0) return;
    const indices = this.selectTrackIndices(request, tracks.length);
    api.renderTracks(indices.map((i) => tracks[i]));
  }

  /**
   * ズームを当てる（view-modes.md 1.3 節）。1 が 100%。`display.scale` に入れて、作り直さずに描き直す。
   * @throws scale が 0 以下のとき
   */
  // 12.1 節：applyZoom(scale) は 1 が 100% で、display.scale に入れて作り直さずに描き直す <!-- req webcorefoundation:0822aa14.e934 --> <!-- req webcorefoundation:0822aa14.06e4 --> <!-- req webcorefoundation:0822aa14.c08a --> <!-- req webcorefoundation:0822aa14.b86d -->
  applyZoom(scale: number): void {
    const api = this.requireApi();
    if (!(scale > 0)) {
      throw new RangeError(`ScoreRenderHost.applyZoom() requires scale > 0 (got: ${String(scale)}).`);
    }
    api.settings.display.scale = scale;
    api.updateSettings();
    // 11 節：曲を読み込む前と、パートが 0 の曲は描画を呼ばない
    if ((this.score?.tracks.length ?? 0) === 0) return;
    api.render();
  }

  /**
   * Error のハイライト（基本設計 03 章 11 節と 08 章 1 節の「譜面上の該当箇所を赤枠ハイライト」）。
   * screens-navigation.md 13.2 節の `ScoreHighlightHost` を名前と引数をそろえて満たし、`ScoreHighlightBinder` から呼ばれる。
   * `trackIndex` のパートの、`startBarIndex` から `barCount` 個の小節を囲む枠を、表示領域の上に重ねた `<div>` で出す。
   * alphaTab が描いた SVG は書き換えない。前に出ていたハイライトは外してから出し、同時に出すハイライトは 1 つにする。
   * 範囲が段をまたげば段ごとに枠を出す。枠を出せないとき（描く前・範囲の小節が描かれていない）は何も出さない。
   * `durationMs`（省いたら `DEFAULT_HIGHLIGHT_DURATION_MS`）たったら外す。
   */
  // 12.1 節：showErrorHighlight は ScoreHighlightHost を満たし、小節の範囲を囲む枠を重ねた div で出す。枠は danger のトークンの色で、クリックを下の譜面へ通す <!-- req webcorefoundation:99a88d99.ddb0 --> <!-- req webcorefoundation:53595be9.d3a2 --> <!-- req webcorefoundation:53595be9.7de6 --> <!-- req webcorefoundation:53595be9.4a4a --> <!-- req webcorefoundation:53595be9.ecef --> <!-- req webcorefoundation:53595be9.f8ad --> <!-- req webcorefoundation:53595be9.e31f --> <!-- req webcorefoundation:53595be9.ae26 --> <!-- req webcorefoundation:53595be9.d482 --> <!-- req webcorefoundation:53595be9.aa3f --> <!-- req webcorefoundation:53595be9.51d0 --> <!-- req webcorefoundation:53595be9.101e --> <!-- req webcorefoundation:53595be9.78c0 --> <!-- req webcorefoundation:53595be9.b345 --> <!-- req webcorefoundation:53595be9.20f0 --> <!-- req webcorefoundation:6e254f2b.2dd2 --> <!-- req webcorefoundation:6e254f2b.ac9f --> <!-- req webcorefoundation:6e254f2b.eaf1 --> <!-- req webcorefoundation:6e254f2b.0a59 --> <!-- req webcorefoundation:6e254f2b.beab -->
  showErrorHighlight(request: ScoreHighlightRequest): void {
    const api = this.requireApi();
    const container = this.container;
    if (container === null) return;

    this.clearErrorHighlight();

    const frames = resolveHighlightFrames(api.renderer?.boundsLookup, request);
    if (frames.length === 0) return;

    // 枠の絶対配置の基準にするため、コンテナが static のままなら relative にする。
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const doc = container.ownerDocument;
    const group = doc.createElement('div');
    group.className = 'riff-line-error-highlight';
    group.setAttribute('data-track-index', String(request.trackIndex));
    group.setAttribute('data-start-bar', String(request.startBarIndex));
    group.setAttribute('data-bar-count', String(request.barCount));
    if (request.code !== undefined) group.setAttribute('data-code', request.code);
    // 枠はクリックを下の譜面へ通し、ハイライトが出ている間も譜面の上の操作を止めない
    group.style.pointerEvents = 'none';
    for (const frame of frames) {
      const el = doc.createElement('div');
      el.className = 'riff-line-error-highlight-frame';
      el.style.position = 'absolute';
      el.style.pointerEvents = 'none';
      el.style.border = HIGHLIGHT_BORDER;
      el.style.boxSizing = 'border-box';
      el.style.left = `${frame.x}px`;
      el.style.top = `${frame.y}px`;
      el.style.width = `${frame.width}px`;
      el.style.height = `${frame.height}px`;
      group.appendChild(el);
    }
    container.appendChild(group);
    this.highlightEl = group;

    const duration = request.durationMs ?? DEFAULT_HIGHLIGHT_DURATION_MS;
    this.highlightTimer = setTimeout(() => this.clearErrorHighlight(), duration);
  }

  /** ハイライトを外す。出ていないときに呼んでも何もしない。 */
  // 12.1 節：clearErrorHighlight() <!-- req webcorefoundation:9c9511e8.9296 -->
  clearErrorHighlight(): void {
    if (this.highlightTimer !== null) {
      clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }
    if (this.highlightEl !== null) {
      this.highlightEl.remove();
      this.highlightEl = null;
    }
  }

  /**
   * 今描いている譜面の、段ごと・パートごとの矩形（view-modes.md 1.2 節の `PartColorOverlay` が使う）。
   * 座標は表示領域の左上を原点にした CSS ピクセル。描く前は空の配列を返す。
   */
  // 12.1 節：getPartRegions(): PartRegion[]（PartRegion の型は rendering から出す） <!-- req webcorefoundation:b9c77d3e.c44b --> <!-- req webcorefoundation:b9c77d3e.d451 --> <!-- req webcorefoundation:b9c77d3e.d9f8 --> <!-- req webcorefoundation:b9c77d3e.bd28 -->
  getPartRegions(): PartRegion[] {
    const api = this.requireApi();
    return resolvePartRegions(api.renderer?.boundsLookup);
  }

  /** alphaTab を破棄する。ハイライトも外す。未初期化でも安全（冪等）。 */
  // 12.1 節：dispose() <!-- req webcorefoundation:20848bc5.9929 -->
  dispose(): void {
    this.clearErrorHighlight();
    this.container = null;
    this.score = null;
    this.viewRequest = null;
    if (this.api !== null) {
      this.api.destroy();
      this.api = null;
    }
    this.listeners.renderStarted.clear();
    this.listeners.renderFinished.clear();
    this.listeners.renderError.clear();
  }

  /** イベントリスナーを登録する。 */
  // 12.1 節：on(event, listener) <!-- req webcorefoundation:dc94fbf4.37c9 -->
  on<E extends RenderHostEvents>(event: E, listener: RenderHostEventListener<E>): void {
    this.listeners[event].add(listener);
  }

  /** イベントリスナーを解除する。 */
  // 12.1 節：off(event, listener) <!-- req webcorefoundation:02431c5d.fb11 -->
  off<E extends RenderHostEvents>(event: E, listener: RenderHostEventListener<E>): void {
    this.listeners[event].delete(listener);
  }

  /** 初期化済みか。 */
  get isInitialized(): boolean {
    return this.api !== null;
  }

  /**
   * alphaTex の文字列を alphaTab の `model.Score` にする。alphaTab のインポータをここに集める。
   * @throws alphaTex の構文が不正な場合（インポータが送出する例外をそのまま伝える）。
   */
  // 12.1 節：static parseAlphaTex(tex): model.Score <!-- req webcorefoundation:d56ea01a.a9b8 -->
  static parseAlphaTex(tex: string): model.Score {
    const settings = new Settings();
    const texImporter = new importer.AlphaTexImporter();
    texImporter.initFromString(tex, settings);
    return texImporter.readScore();
  }

  // ===== 内部ヘルパー =====

  /** api が初期化済みであることを保証して返す。 */
  private requireApi(): AlphaTabApiLike {
    if (this.api === null) {
      throw new Error(NOT_INITIALIZED);
    }
    return this.api;
  }

  /** 表示モードの要求から、表示するパートの番号を決める。 */
  private selectTrackIndices(request: ViewModeRenderRequest | null, trackCount: number): number[] {
    const all = Array.from({ length: trackCount }, (_v, i) => i);
    if (request === null || request.mode === 'score') return all;
    const one = request.focusTrackIndex;
    return Number.isInteger(one) && one >= 0 && one < trackCount ? [one] : all;
  }

  /** render() が表示するパート（最後の表示モードの要求のまま。要求がまだ無ければ全部のパート）。 */
  private displayedTrackIndices(score: model.Score): number[] {
    return this.selectTrackIndices(this.viewRequest, score.tracks.length);
  }

  /**
   * 描画のエラーを 'renderError' で知らせる。エラーコード（RENDER-001）を出すのは購読する側
   * （レンダラーの起動の配線が on('renderError') から NotificationCenter へ結ぶ）。
   */
  private reportRenderError(error: unknown): void {
    console.error('[ScoreRenderHost] render error:', error);
    this.emit('renderError', { error });
  }

  /** 登録済みリスナーへイベントを配信する。 */
  private emit<E extends RenderHostEvents>(event: E, payload: RenderHostEventMap[E]): void {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }
}
