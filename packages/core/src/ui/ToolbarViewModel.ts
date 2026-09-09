/**
 * ツールバーの状態管理（編集ウィンドウごと、screens-navigation.md §4.4）。
 *
 * - Undo/Redo ボタンの活性状態は当該ウィンドウの `CommandHistory.subscribe(listener)`（editing-core.md §6.2）を購読して更新
 * - 再生系ボタンの活性状態は当該ウィンドウの再生状態（`PlaybackService` 相当）を反映
 * - パネル表示トグル（ミキサー / パート管理 / チューニング / フレットボード / メモ一覧）は編集ウィンドウ単位で保持（Undo/Redo 対象外）
 *
 * `ScoreRenderHost` / Score モデル / AlphaSynth を直接触らない（AD-2）。表示専用の派生状態のみを持つ。
 */

import type { ToolbarPanelName, ToolbarState } from './types';

/** `CommandHistory` の購読部分だけの最小契約（editing-core.md §6.2）。 */
export interface HistoryStateSource {
  canUndo(): boolean;
  canRedo(): boolean;
  /** 状態変化の購読。戻り値で解除。 */
  subscribe(listener: () => void): () => void;
}

/** `PlaybackService` の再生状態部分だけの最小契約（playback-integration.md §4.1）。 */
export interface PlaybackStateSource {
  readonly isPlaying: boolean;
  /** 再生 / 停止の状態変化通知。戻り値で解除。bootstrap が `PlaybackSynth.onStateChanged` を橋渡しする。 */
  onStateChanged(listener: () => void): () => void;
}

/** 全パネル非表示の初期状態。 */
const INITIAL_PANELS: ToolbarState['panels'] = {
  mixer: false,
  partManagement: false,
  tuning: false,
  fretboard: false,
  memoList: false,
};

export class ToolbarViewModel {
  private readonly history: HistoryStateSource;
  private readonly playback: PlaybackStateSource | null;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribes: Array<() => void> = [];
  private panels: ToolbarState['panels'] = { ...INITIAL_PANELS };

  /**
   * @param history 当該編集ウィンドウの `CommandHistory`。
   * @param playback 当該編集ウィンドウの再生状態源。未配線（再生エンジン未起動）なら null 可。
   */
  constructor(history: HistoryStateSource, playback: PlaybackStateSource | null = null) {
    this.history = history;
    this.playback = playback;
    // 履歴・再生状態の変化をそのまま onChange へ中継する（活性状態は都度 getState で読む）。
    this.unsubscribes.push(this.history.subscribe(() => this.emit()));
    if (this.playback !== null) {
      this.unsubscribes.push(this.playback.onStateChanged(() => this.emit()));
    }
  }

  /** 現在のツールバー表示状態を返す（描画のたびに呼ぶ）。 */
  getState(): ToolbarState {
    return {
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      isPlaying: this.playback?.isPlaying ?? false,
      panels: { ...this.panels },
    };
  }

  /** 状態変化を購読する。戻り値で解除。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 指定パネルの表示・非表示を反転する（screens-navigation.md §4.4「パネル表示トグル」）。 */
  togglePanel(name: ToolbarPanelName): void {
    this.setPanelVisible(name, !this.panels[name]);
  }

  /** 指定パネルの表示状態を明示設定する。変化が無ければ通知しない。 */
  setPanelVisible(name: ToolbarPanelName, visible: boolean): void {
    if (this.panels[name] === visible) return;
    this.panels = { ...this.panels, [name]: visible };
    this.emit();
  }

  /** 購読を全解除する（ウィンドウクローズ時、WindowManager から呼ばれる）。 */
  dispose(): void {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.listeners.clear();
  }

  /** 登録済みリスナーへ通知する。1 つが投げても残りは続行。 */
  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[ToolbarViewModel] listener threw:', error);
      }
    }
  }
}
