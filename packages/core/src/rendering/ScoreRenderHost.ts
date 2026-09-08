/**
 * alphaTab の唯一の窓口（web-core-foundation.md §3.1、00_reference.md §7「Host」パターン）。
 *
 * alphaTab の生 API（AlphaTabApi）を 1 インスタンスだけ保持し、初期化・破棄・再描画要求の
 * 唯一の窓口になる。編集サービス・再生サービス（後続パッケージ）は本クラス経由でのみ
 * alphaTab を扱い、生 API に直接依存しない。
 */

import { AlphaTabApi, importer, LayoutMode, Settings } from '@coderline/alphatab';

import type {
  RenderHostEventListener,
  RenderHostEventMap,
  RenderHostEvents,
  RenderHostOptions,
  ViewModeRenderRequest,
} from './types';

/**
 * ScoreRenderHost が内部で使う alphaTab API の最小構造。
 * これに限定して依存することで、alphaTab の詳細な型に結合せず、テストでも差し替えやすくする。
 */
interface AlphaTabApiLike {
  load(scoreData: unknown): boolean;
  render(): void;
  destroy(): void;
  readonly renderStarted: { on(handler: () => void): void };
  readonly renderFinished: { on(handler: () => void): void };
  readonly error: { on(handler: (error: unknown) => void): void };
  // --- 表示モード拡張（view-modes.md §4.3）で使う alphaTab の追加窓口 ---
  /** ロード済み Score。未ロードなら null。`applyViewMode` の対象トラック解決に使う。 */
  readonly score: { readonly tracks: readonly unknown[] } | null;
  /** レイアウト・ズーム設定。変更後は `updateSettings()` で反映する。 */
  readonly settings: AlphaTabDisplaySettingsLike;
  /** `settings` の変更をレンダラーへ適用する（再描画を伴う）。 */
  updateSettings(): void;
  /** 指定トラックのみを描画対象にして再描画する。 */
  renderTracks(tracks: readonly unknown[]): void;
}

/** alphaTab `Settings.display` のうち表示モード拡張が触る部分だけ（view-modes.md §4.3）。 */
interface AlphaTabDisplaySettingsLike {
  display: {
    /** 表示スケール（1 = 100%）。ズーム。 */
    scale: number;
    /** レイアウト方式（`LayoutMode`）。 */
    layoutMode: LayoutMode;
    /** 描画開始小節（1 始まり）。フォーカスビューの表示範囲に使う。 */
    startBar: number;
    /** 描画小節数（-1 で全小節）。 */
    barCount: number;
  };
}

/** alphaTab の全小節を表す `settings.display.barCount` の番兵値。 */
const ALL_BARS = -1;

type AlphaTabSettingsArg = ConstructorParameters<typeof AlphaTabApi>[1];

/** initialize() 前に他メソッドが呼ばれたときのメッセージ。 */
const NOT_INITIALIZED = 'ScoreRenderHost.initialize() must be called before this operation.';

export class ScoreRenderHost {
  /** 初期化後にのみ非 null。dispose() で null に戻す。 */
  private api: AlphaTabApiLike | null = null;

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

    // alphaTab の設定 JSON を組み立てる。本パッケージでは player を無効化する（再生は扱わない）。
    const settings = {
      core: {
        engine: 'svg',
        fontDirectory: options.fontAssetsBasePath,
        // メインスレッド同期描画に固定する（web-core-foundation.md §3.1・要件5.1）。
        // alphaTab は既定で Web Worker 描画を行うが、ESM バンドル経由のワーカー自動生成は
        //   1) import.meta.url 由来 URL（バンドラが事前最適化した alphaTab では解決不能）
        //   2) blob: ワーカー（レンダラーの厳格 CSP `script-src 'self'` が拒否）
        // のいずれも失敗し、renderFinished が返らず描画が停止する。CSP を緩めない方針のため
        // 同期描画に倒す。大曲向けの専用ワーカースクリプト同梱は表示モード/再生パッケージで扱う。
        useWorkers: false,
        // 描画チャンクを可視領域ぶんだけ DOM へ遅延追加する既定動作を無効化し、
        // 生成物を即座に全反映する（基盤動作確認シェルのため）。
        enableLazyLoading: false,
      },
      player: {
        enablePlayer: false,
        soundFont: options.soundFontAssetsBasePath,
      },
      // 表示モード拡張（view-modes.md §4.3）が更新する初期レイアウト。
      // 既定はスコア/全体スクロール相当（Page レイアウト・全小節）。
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
  }

  /**
   * Score オブジェクトを読み込む。
   *
   * 不正な Score（alphaTab のパースが失敗するもの）を渡された場合、内部で捕捉して
   * 'renderError' イベントとして通知し、**外部には例外を投げない**（web-core-foundation.md §3.1）。
   * エラー基盤パッケージ完了後、暫定ログ出力を NotificationCenter 連携へ置き換える。
   */
  loadScore(score: unknown): void {
    const api = this.requireApi();
    try {
      const accepted = api.load(score);
      if (accepted === false) {
        this.reportRenderError(new Error('alphaTab rejected the provided score.'));
      }
    } catch (error) {
      this.reportRenderError(error);
    }
  }

  /**
   * 再描画を要求する。
   *
   * @param trackIndices 影響するトラック（パート）のインデックス。省略時は全体を再描画する。
   *   本パッケージでは常に全体再描画のみを行う。トラック単位の部分再描画は
   *   「タブ譜編集コア」パッケージが ScoreRenderHost を非破壊拡張して実装する（00_reference.md §4）。
   */
  render(trackIndices?: number[]): void {
    const api = this.requireApi();
    if (trackIndices !== undefined && trackIndices.length > 0) {
      // 将来の部分再描画の拡張点。現状は指定を無視して全体再描画にフォールバックする
      // （00_reference.md §2「分類しない一律処理」の考え方に沿う）。
    }
    api.render();
  }

  /**
   * 表示モードに応じたレンダリング構成を適用する（view-modes.md §4.3、パッケージ6の非破壊拡張）。
   *
   * - `focus` … `focusTrackIndex` の 1 パートを `focusRange` の小節レンジで描画する
   * - `scroll` … `focusTrackIndex` の 1 パートを曲全体（全小節）で描画する
   * - `score` … 全パートを縦並びで描画する。パート識別色オーバーレイ自体はパッケージ8の責務
   *   （alphaTab 1.8.4 の SVG 出力はトラック単位の DOM 要素を持たず `data-track-index` を付与できないため、
   *   `boundsLookup` 由来の幾何オーバーレイ方式へ変更。13_design_decision_points.md B34、view-modes.md §4.3）
   *
   * `focusTrackIndex` が範囲外・Score 未ロードの場合は全トラック描画にフォールバックする。
   */
  applyViewMode(request: ViewModeRenderRequest): void {
    const api = this.requireApi();
    const tracks = api.score?.tracks ?? [];
    const { display } = api.settings;

    // フォーカスビューだけが表示範囲（小節レンジ）を絞る。他モードは常に全小節。
    if (request.mode === 'focus' && request.focusRange !== undefined) {
      // alphaTab の startBar は 1 始まり。startBarIndex(0 始まり) + 1 に変換する。
      display.startBar = Math.max(1, Math.floor(request.focusRange.startBarIndex) + 1);
      display.barCount = Math.max(1, Math.floor(request.focusRange.barCount));
    } else {
      display.startBar = 1;
      display.barCount = ALL_BARS;
    }
    display.layoutMode = LayoutMode.Page;
    api.updateSettings();

    // 対象トラックを決める。score は全パート、focus/scroll は現在パート 1 つ。
    if (request.mode === 'score') {
      api.renderTracks(tracks);
      return;
    }
    const one = tracks[request.focusTrackIndex];
    api.renderTracks(one === undefined ? tracks : [one]);
  }

  /**
   * ズームレベル（表示スケール）を適用して再描画する（view-modes.md §4.2）。
   * @param scale 1 = 100%。0 以下は不正として拒否する。
   */
  applyZoom(scale: number): void {
    const api = this.requireApi();
    if (!(scale > 0)) {
      throw new RangeError(`ScoreRenderHost.applyZoom() requires scale > 0 (got: ${String(scale)}).`);
    }
    api.settings.display.scale = scale;
    api.updateSettings();
    api.render();
  }

  /** alphaTab インスタンスを破棄する。未初期化でも安全（冪等）。 */
  dispose(): void {
    if (this.api !== null) {
      this.api.destroy();
      this.api = null;
    }
    this.listeners.renderStarted.clear();
    this.listeners.renderFinished.clear();
    this.listeners.renderError.clear();
  }

  /** イベントリスナーを登録する。 */
  on<E extends RenderHostEvents>(event: E, listener: RenderHostEventListener<E>): void {
    this.listeners[event].add(listener);
  }

  /** イベントリスナーを解除する。 */
  off<E extends RenderHostEvents>(event: E, listener: RenderHostEventListener<E>): void {
    this.listeners[event].delete(listener);
  }

  /** 初期化済みか。 */
  get isInitialized(): boolean {
    return this.api !== null;
  }

  /**
   * alphaTex 文字列を Score オブジェクトへパースする（web-core-foundation.md §3.1・§3.5）。
   *
   * alphaTab のインポータをここに集約し、他モジュール（本パッケージのレンダラーシェル、
   * 将来のインポート機能）が alphaTab の生 API を直接触らずに済むようにする（「Host」パターン）。
   * データモデルパッケージ完成後は、アプリの SongDocument からの変換に置き換わる想定。
   *
   * @throws alphaTex の構文が不正な場合（インポータが送出する例外をそのまま伝える）。
   */
  static parseAlphaTex(tex: string): unknown {
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

  /**
   * レンダリングエラーを 'renderError' イベントとして通知する（web-core-foundation.md §3.1）。
   *
   * 本クラスは alphaTab の Host として NotificationCenter に依存しない。エラーコード（RENDER-001）の
   * 発行は購読側の責務で、レンダラーの起動配線が `on('renderError')` → `notificationCenter.report('RENDER-001')`
   * を結ぶ（error-logging-foundation.md §9.1）。ここでは開発時診断用に console.error を残す。
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
