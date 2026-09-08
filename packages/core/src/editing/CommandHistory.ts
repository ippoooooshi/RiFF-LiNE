/**
 * コマンド実行・Undo/Redo の仲介、メモリ予算管理（editing-core.md §6.2、04_editing_core.md §8.2、C11）。
 *
 * **編集ウィンドウ（＝開いている曲）ごとに 1 インスタンス**（アプリ全体で 1 つではない、§6.2 スコープ訂正）。
 * そのインスタンス内で当該曲の全パートが 1 つの履歴を共有する。メモリ上のみに保持し、ファイルへは書かない（§8.3）。
 *
 * 再描画呼び出し（`ScoreRenderHost.render(affectedTrackIndices)`）を本クラスに一元化する（§3、A1 解決）。
 */

import type { Command, CommandAppliedEvent } from './types';

/** `CommandHistory` インスタンス 1 つあたりの Undo/Redo スタック合計メモリ予算（C11）。80MB。 */
export const DEFAULT_MEMORY_BUDGET_BYTES = 80 * 1024 * 1024;

/** 予算超過時でも破棄しない undoStack の下限件数（C11 の安全弁）。 */
export const MIN_RETAINED_ENTRIES = 200;

/** `render(affectedTrackIndices)` 相当の最小要求（rendering/ScoreRenderHost への結合を避ける）。 */
export interface RenderRequester {
  render(trackIndices?: number[]): void;
}

/** `NotificationCenter.report` の最小要求。 */
export interface NotificationReporter {
  report(code: string, context?: Record<string, unknown>): void;
}

export interface CommandHistoryOptions {
  /** メモリ予算（バイト）。既定 `DEFAULT_MEMORY_BUDGET_BYTES`。 */
  memoryBudgetBytes?: number;
  /** 下限保持件数。既定 `MIN_RETAINED_ENTRIES`。 */
  minRetainedEntries?: number;
  /**
   * 変更のたびに呼ばれる（自動保存トリガ）。bootstrap が `AutoSaveScheduler.notifyDirty(songId)` を接続する。
   */
  onChange?: () => void;
  /**
   * 部分再描画で不整合が出た場合のフォールバック（§3-3）。true なら常に全トラック再描画（`render()` 引数省略）。
   * 既定 false（常に `affectedTrackIndices` 指定）。
   */
  fullRedraw?: boolean;
}

type Listener = () => void;
type AppliedListener = (event: CommandAppliedEvent) => void;

export class CommandHistory {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  /** undoStack + redoStack の推定合計サイズ（バイト）。push/pop のたびに増減させる。 */
  private estimatedBytes = 0;
  /** セッション中に実際にエビクションが起きたか（`EDIT-008` は初回のみ発行、§6.2）。 */
  private evictionNotified = false;
  private fullRedraw: boolean;

  private readonly budget: number;
  private readonly minRetained: number;
  private readonly render: RenderRequester;
  private readonly reporter: NotificationReporter;
  private readonly onChange: (() => void) | undefined;

  private readonly stateListeners = new Set<Listener>();
  private readonly appliedListeners = new Set<AppliedListener>();

  /**
   * @param render 再描画要求先（`ScoreRenderHost`）。
   * @param reporter `EDIT-008` 通知先（`NotificationCenter`）。`EDIT-xxx` コードの登録は
   *   `editing/index.ts` が共有レジストリに対して行う（`errors/index.ts` と同じ方式）。
   */
  constructor(render: RenderRequester, reporter: NotificationReporter, options: CommandHistoryOptions = {}) {
    this.render = render;
    this.reporter = reporter;
    this.budget = options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET_BYTES;
    this.minRetained = options.minRetainedEntries ?? MIN_RETAINED_ENTRIES;
    this.onChange = options.onChange;
    this.fullRedraw = options.fullRedraw ?? false;
  }

  // ===== 実行 / Undo / Redo =====

  /**
   * コマンドを実行して履歴へ積む（editing-core.md §10.1）。
   * 手順：execute → （直前エントリと結合可能なら結合、不可なら push）→ redoStack クリア →
   * 予算エビクション → 再描画 → 自動保存トリガ → コマンド適用通知 → 状態通知。
   */
  execute(command: Command): void {
    command.execute();

    const top = this.undoStack[this.undoStack.length - 1];
    if (top !== undefined && command.canMergeWith?.(top) === true && command.mergeWith !== undefined) {
      // 直前エントリを新コマンドへ取り込み、1 エントリに畳む（連続ドラッグ等の履歴肥大化を防ぐ）。
      this.undoStack.pop();
      this.estimatedBytes -= top.estimateSizeBytes();
      command.mergeWith(top);
    }

    this.undoStack.push(command);
    this.estimatedBytes += command.estimateSizeBytes();
    this.clearRedoStack();
    this.enforceBudget();

    this.afterApply('execute', command);
  }

  /** 直前のコマンドを取り消す（editing-core.md §10.2）。何もなければ無視。 */
  undo(): void {
    const command = this.undoStack.pop();
    if (command === undefined) return;
    command.undo();
    this.redoStack.push(command);
    this.afterApply('undo', command);
  }

  /** 直前に取り消したコマンドを再実行する。何もなければ無視。 */
  redo(): void {
    const command = this.redoStack.pop();
    if (command === undefined) return;
    command.execute();
    this.undoStack.push(command);
    this.afterApply('redo', command);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ===== 購読 =====

  /** Undo/Redo ボタンの活性状態更新用（UI）。戻り値で解除。 */
  subscribe(listener: Listener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * コマンド適用のたびに「どのコマンドがどのトラックへ適用されたか」を通知する（他パッケージ向け拡張、§6.2）。
   * 再生エンジン統合の `PlaybackSyncController` / `PlaybackMixerBinder` 等が購読する。戻り値で解除。
   */
  onCommandApplied(listener: AppliedListener): () => void {
    this.appliedListeners.add(listener);
    return () => {
      this.appliedListeners.delete(listener);
    };
  }

  // ===== 診断・設定（テスト用含む） =====

  get estimatedSizeBytes(): number {
    return this.estimatedBytes;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /** §3-3 のフォールバック：全トラック再描画へ切り替える。 */
  setFullRedraw(enabled: boolean): void {
    this.fullRedraw = enabled;
  }

  /** ウィンドウクローズ時。スタック・購読を破棄する。 */
  dispose(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.estimatedBytes = 0;
    this.stateListeners.clear();
    this.appliedListeners.clear();
  }

  // ===== 内部 =====

  /** redoStack を捨て、推定サイズを戻す。 */
  private clearRedoStack(): void {
    for (const command of this.redoStack) {
      this.estimatedBytes -= command.estimateSizeBytes();
    }
    this.redoStack.length = 0;
  }

  /**
   * 予算超過かつ下限（`minRetained`）を満たしている間、undoStack の最古エントリから破棄する（§6.2）。
   * 単一コマンドだけで予算超過する場合でも、下限まで破棄したら打ち切る（実行自体は拒否しない）。
   * 実際に 1 件でも破棄したらセッション初回のみ `EDIT-008`（Info）を発行する。
   */
  private enforceBudget(): void {
    let evicted = 0;
    while (this.estimatedBytes > this.budget && this.undoStack.length > this.minRetained) {
      const oldest = this.undoStack.shift();
      if (oldest === undefined) break;
      this.estimatedBytes -= oldest.estimateSizeBytes();
      evicted += 1;
    }
    if (evicted > 0 && !this.evictionNotified) {
      this.evictionNotified = true;
      this.reporter.report('EDIT-008', { evictedCount: evicted });
    }
  }

  /** execute/undo/redo 共通の後処理：再描画・自動保存トリガ・適用通知・状態通知。 */
  private afterApply(phase: CommandAppliedEvent['phase'], command: Command): void {
    const affected = [...command.affectedTrackIndices];
    this.render.render(this.fullRedraw ? undefined : affected);
    this.onChange?.();

    for (const listener of this.appliedListeners) {
      try {
        listener({ phase, kind: command.kind, affectedTrackIndices: affected });
      } catch (error) {
        console.error('[CommandHistory] onCommandApplied listener threw:', error);
      }
    }
    for (const listener of this.stateListeners) {
      try {
        listener();
      } catch (error) {
        console.error('[CommandHistory] subscribe listener threw:', error);
      }
    }
  }
}
