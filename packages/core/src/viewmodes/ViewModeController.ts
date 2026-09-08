/**
 * 表示モード（focus / scroll / score）の保持・切替と、フォーカスビューの表示範囲追従（view-modes.md §4.1）。
 *
 * **編集ウィンドウ（＝開いている曲）ごとに 1 インスタンス**（`CommandHistory` / `CursorController` と同じスコープ）。
 * モード切替時に `CursorController` の状態（現在位置・入力音価）は変更しない（editing-core.md §14 の引き継ぎ契約）。
 * `ScoreRenderHost` の生 API には触れず、`ViewModeRenderHost.applyViewMode` にのみ依存する。
 */

import type { CursorLike, FocusRange, RenderViewMode, ViewModeRenderHost } from './types';

/** フォーカスビューが一度に描画対象にする小節数（カーソルがこの窓を外れたら追従する）。 */
export const FOCUS_RANGE_BAR_SPAN = 8;

/** 曲を開いた直後の既定モード（`SONG_SETTINGS.defaultViewMode` 未指定時）。 */
export const DEFAULT_INITIAL_VIEW_MODE: RenderViewMode = 'focus';

export interface ViewModeControllerOptions {
  /**
   * 初期表示モード。bootstrap が `appMeta.settings.defaultViewMode`（02_data_model.md SONG_SETTINGS）を渡す。
   * 省略時は `DEFAULT_INITIAL_VIEW_MODE`。
   */
  initialMode?: RenderViewMode;
  /** フォーカスビューの表示範囲の小節数。省略時 `FOCUS_RANGE_BAR_SPAN`。 */
  focusRangeBarSpan?: number;
  /** モード・表示範囲が変わるたびに呼ばれる（bootstrap が `ZoomController.reapplyForCurrentMode` 等を接続）。 */
  onChange?: () => void;
}

export class ViewModeController {
  private mode: RenderViewMode;
  /** focus / scroll モードで描画する単一パート。カーソルの `trackIndex` に追従する。 */
  private focusTrackIndex: number;
  /** フォーカスビューの現在の表示範囲。 */
  private focusRange: FocusRange;
  private readonly span: number;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeCursor: () => void;

  constructor(
    private readonly host: ViewModeRenderHost,
    private readonly cursor: CursorLike,
    options: ViewModeControllerOptions = {},
  ) {
    this.span = Math.max(1, Math.floor(options.focusRangeBarSpan ?? FOCUS_RANGE_BAR_SPAN));
    this.mode = options.initialMode ?? DEFAULT_INITIAL_VIEW_MODE;
    this.focusTrackIndex = Math.max(0, cursor.position.trackIndex);
    this.focusRange = this.computeRangeAround(cursor.position.barIndex);
    if (options.onChange) this.listeners.add(options.onChange);

    // カーソル移動を購読して、フォーカスビューの範囲追従・パート追従を行う。
    this.unsubscribeCursor = cursor.onChange(() => this.onCursorChange());

    // 初期モードを適用する（view-modes.md §4.1「初期値の適用」）。ここでは onChange は発火しない。
    this.applyToHost();
  }

  /** 現在の表示モード。 */
  get currentMode(): RenderViewMode {
    return this.mode;
  }

  /** フォーカスビューの現在の表示範囲（診断・テスト用のコピー）。 */
  get focusVisibleRange(): FocusRange {
    return { ...this.focusRange };
  }

  /**
   * 表示モードを切り替える（UI のセグメントコントロール、view-modes.md §5.1）。
   * 同じモードを再指定した場合も再描画する（強制リフレッシュに使える）。
   * カーソル状態は変更しない。フォーカスへ切替時のみ、現在のカーソル位置を中心に表示範囲を取り直す。
   */
  setViewMode(mode: RenderViewMode): void {
    this.mode = mode;
    if (mode === 'focus') {
      this.focusRange = this.computeRangeAround(this.cursor.position.barIndex);
    }
    this.applyToHost();
    this.emitChange();
  }

  /** モード・表示範囲の変化購読。戻り値で解除。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** ウィンドウクローズ時。カーソル購読と自身のリスナーを解除する。 */
  dispose(): void {
    this.unsubscribeCursor();
    this.listeners.clear();
  }

  // ===== 内部 =====

  /**
   * カーソル移動時の処理（view-modes.md §5.2）。
   * - focus / scroll：カーソルのパートが変わったら描画対象パートを追従させる
   * - focus：カーソルが表示範囲を外れたときのみ範囲を取り直す（範囲内なら何もしない＝過剰スクロール防止）
   */
  private onCursorChange(): void {
    const pos = this.cursor.position;
    let changed = false;

    // パート追従（score は全パート表示のため対象外だが、内部の追従先だけは最新化しておく）。
    const nextTrackIndex = Math.max(0, pos.trackIndex);
    if (nextTrackIndex !== this.focusTrackIndex) {
      this.focusTrackIndex = nextTrackIndex;
      if (this.mode !== 'score') changed = true;
    }

    // フォーカスビューの表示範囲追従（範囲外に出た時のみ）。
    if (this.mode === 'focus' && !this.isBarInFocusRange(pos.barIndex)) {
      this.focusRange = this.computeRangeAround(pos.barIndex);
      changed = true;
    }

    if (changed) {
      this.applyToHost();
      this.emitChange();
    }
  }

  /** `barIndex` が現在のフォーカス表示範囲に含まれるか。 */
  private isBarInFocusRange(barIndex: number): boolean {
    const start = this.focusRange.startBarIndex;
    const end = start + this.focusRange.barCount - 1;
    return barIndex >= start && barIndex <= end;
  }

  /** `barIndex` を中心（やや前寄り）に `span` 小節の表示範囲を作る。先頭は 0 で下限クランプ。 */
  private computeRangeAround(barIndex: number): FocusRange {
    const centered = Math.floor(barIndex) - Math.floor(this.span / 2);
    return { startBarIndex: Math.max(0, centered), barCount: this.span };
  }

  /** 現在のモード・パート・表示範囲を `host` へ適用する。 */
  private applyToHost(): void {
    this.host.applyViewMode({
      mode: this.mode,
      focusTrackIndex: this.focusTrackIndex,
      focusRange: this.mode === 'focus' ? { ...this.focusRange } : undefined,
    });
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[ViewModeController] listener threw:', error);
      }
    }
  }
}
