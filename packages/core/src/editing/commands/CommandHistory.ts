/**
 * コマンドの実行と取り消しとやり直しの仲立ち、履歴の深さの管理（editing-core.md 2.2 節・2.3 節・2.4 節、基本設計 13 章 C11）。
 *
 * 編集ウィンドウ（開いている曲）ごとに 1 つ作り、その曲の全部のパートの操作を 1 つの履歴にする（editing-core.md 2.3 節）。
 * 履歴はメモリの中にだけ持ち、ファイルには書かない。描き直しを頼むのはこのクラスだけ（editing-core.md 2.4 節）。
 */

import type { CommandAppliedEvent, CommandOutcome } from '../types';

import type { Command } from './Command';

/** `CommandHistory` 1 つあたりの undo と redo のスタックの推定の大きさの合計の予算（editing-core.md 2.3 節、C11）。80MB。 */
// <!-- req editingcore:c4f30c2a.9fa0 --> <!-- req editingcore:7664d367.d9eb --> <!-- req webcorefoundation:a26ea86d.328c -->
export const DEFAULT_MEMORY_BUDGET_BYTES = 80 * 1024 * 1024;

/** 予算を超えていても必ず残す直近の件数（editing-core.md 2.3 節、C11 の下限）。 */
// <!-- req editingcore:b00380e9.7f4f --> <!-- req editingcore:a10ca45b.f812 --> <!-- req editingcore:92608af0.3c80 --> <!-- req editingcore:8549fab1.7ff5 --> <!-- req webcorefoundation:a26ea86d.b9ba -->
export const MIN_RETAINED_ENTRIES = 200;

/** ScoreRenderHost のうち CommandHistory が使う所だけ（editing-core.md 2.2 節。テストで差し替える）。 */
// <!-- req editingcore:42a472a4.752b -->
export interface RenderRequester {
  // <!-- req editingcore:42a472a4.eb9c -->
  render(trackIndices?: number[]): void;
}

/** NotificationCenter.report のうち CommandHistory が使う所だけ（editing-core.md 2.2 節）。 */
// <!-- req editingcore:60515ba3.b5d2 -->
export interface NotificationReporter {
  // <!-- req editingcore:60515ba3.dab4 -->
  report(code: string, context?: Record<string, unknown>): void;
}

// <!-- req editingcore:e5387588.f615 -->
export interface CommandHistoryOptions {
  /** 既定は DEFAULT_MEMORY_BUDGET_BYTES（editing-core.md 2.3 節）。 */
  // <!-- req editingcore:b69fcd6d.a528 -->
  memoryBudgetBytes?: number;
  /** 既定は MIN_RETAINED_ENTRIES（editing-core.md 2.3 節）。 */
  // <!-- req editingcore:53b02fa0.8937 -->
  minRetainedEntries?: number;
  /**
   * 変更のたびに呼ぶ（自動保存の AutoSaveScheduler をつなぐ。data-model-persistence.md 15 節）。
   */
  // <!-- req datamodelpersistence:64f6e22a.95d9 -->
  // <!-- req editingcore:7e09307e.1ad9 --> <!-- req editingcore:7e09307e.be64 --> <!-- req editingcore:2d99edf0.0545 --> <!-- req editingcore:5db912e2.1053 -->
  onChange?: () => void;
}

type Listener = () => void;
type AppliedListener = (event: CommandAppliedEvent) => void;

// 11 節：編集は alphaTab の専用の API を使わず、コマンド層が Score を直接変えてから、CommandHistory が ScoreRenderHost.render で描き直しを頼む（A1）。プロパティごとに分けず、実行と取り消しのたびに対象のトラックだけを一律に描き直す。render に渡すのはコマンドで変わったパートの番号（affectedTrackIndices）。10.4 節：コマンドの実行はファイルの I/O を伴わない <!-- req webcorefoundation:5f84570b.44a3 --> <!-- req webcorefoundation:fbe0cce7.f7b6 --> <!-- req webcorefoundation:fbe0cce7.bd8f --> <!-- req webcorefoundation:fbe0cce7.d339 --> <!-- req webcorefoundation:fbe0cce7.4c95 --> <!-- req webcorefoundation:5f84570b.f014 --> <!-- req webcorefoundation:5f84570b.75ba --> <!-- req webcorefoundation:20560646.b80e --> <!-- req webcorefoundation:20560646.d379 --> <!-- req webcorefoundation:20560646.f065 --> <!-- req webcorefoundation:8a1a23cc.fd2a -->
// <!-- req editingcore:8ee56da1.6ff3 --> <!-- req editingcore:ff7c701d.e19e --> <!-- req editingcore:ff8d401a.62f6 --> <!-- req editingcore:b750e85f.416c --> <!-- req editingcore:9134a4b0.6f6a --> <!-- req editingcore:9134a4b0.3130 --> <!-- req editingcore:43c37ae5.59a0 --> <!-- req editingcore:43c37ae5.829f --> <!-- req editingcore:d49219fc.1402 -->
export class CommandHistory {
  // <!-- req editingcore:d164f963.febd --> <!-- req editingcore:d164f963.4e59 --> <!-- req editingcore:dd4e4d07.7c5b --> <!-- req editingcore:dd4e4d07.229c -->
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  /** undo と redo のスタックの推定の大きさの合計（バイト）。積むたび・捨てるたびに増減させる。 */
  // <!-- req editingcore:7664d367.8aff --> <!-- req editingcore:7664d367.7cf7 -->
  private estimatedBytes = 0;
  /** この履歴で破棄の知らせ（EDIT-008）を出したか。編集ウィンドウごとに初めての 1 回だけ出す（editing-core.md 2.3 節）。 */
  // <!-- req editingcore:79bf1a10.00af --> <!-- req editingcore:79bf1a10.1b79 --> <!-- req editingcore:79bf1a10.46f3 --> <!-- req editingcore:79bf1a10.b3d0 -->
  private evictionNotified = false;

  private readonly budget: number;
  private readonly minRetained: number;
  private readonly render: RenderRequester;
  private readonly reporter: NotificationReporter;
  private readonly onChange: (() => void) | undefined;

  private readonly stateListeners = new Set<Listener>();
  private readonly appliedListeners = new Set<AppliedListener>();

  /**
   * @param render 描き直しを頼む先（ScoreRenderHost）。
   * @param reporter EDIT-008 を知らせる先（NotificationCenter）。コードの登録は editing/index.ts が行う。
   */
  // <!-- req editingcore:ed5b0480.a222 --> <!-- req editingcore:9898c86b.0e99 -->
  constructor(render: RenderRequester, reporter: NotificationReporter, options: CommandHistoryOptions = {}) {
    this.render = render;
    this.reporter = reporter;
    this.budget = options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET_BYTES;
    this.minRetained = Math.max(0, options.minRetainedEntries ?? MIN_RETAINED_ENTRIES);
    this.onChange = options.onChange;
  }

  /**
   * コマンドを実行して履歴に積む（editing-core.md 2.4 節の execute の順番）。
   * execute() → undo のスタックに積む（直前の項目とまとめられるなら置き換える、2.2 節）→ redo のスタックを空にする
   * → 予算を超えていれば古いほうから捨てる（2.3 節）→ 描き直しを頼む → onChange → 購読に知らせる。
   */
  // <!-- req editingcore:ac03bac0.5276 --> <!-- req editingcore:53a14a01.e904 -->
  execute(command: Command): CommandOutcome {
    const outcome = command.execute();

    const top = this.undoStack[this.undoStack.length - 1];
    // <!-- req editingcore:5b6d969c.bf64 --> <!-- req editingcore:9f0c58e2.cfe4 --> <!-- req editingcore:9f0c58e2.c522 --> <!-- req editingcore:9f0c58e2.cebb -->
    if (top !== undefined && command.canMergeWith?.(top) === true && command.mergeWith !== undefined) {
      // editing-core.md 2.2 節：新しいコマンドが直前の項目を取り込み、直前の項目と置き換える（新しい項目を積まない）。
      this.undoStack.pop();
      this.estimatedBytes -= top.estimateSizeBytes();
      // <!-- req editingcore:9f0c58e2.5471 --> <!-- req editingcore:55a203ef.0320 -->
      command.mergeWith(top);
    }

    this.undoStack.push(command);
    this.estimatedBytes += command.estimateSizeBytes();
    // <!-- req editingcore:a2e5a6a8.7644 -->
    this.clearRedoStack();
    // <!-- req editingcore:53205c5f.59df -->
    this.enforceBudget();

    this.afterApply('execute', command);
    return outcome;
  }

  /** 直前のコマンドを取り消す（editing-core.md 2.4 節の undo の順番）。取り消すものが無ければ何もしない。 */
  // <!-- req editingcore:b0607adf~1.e915 --> <!-- req editingcore:04d7a165.48c4 -->
  undo(): CommandOutcome {
    const command = this.undoStack.pop();
    if (command === undefined) return { cursorAdvance: 'none' };
    const outcome = command.undo();
    this.redoStack.push(command);
    this.afterApply('undo', command);
    return outcome;
  }

  /** 直前に取り消したコマンドをやり直す（editing-core.md 2.4 節の redo の順番）。やり直すものが無ければ何もしない。 */
  // <!-- req editingcore:b94535fd.280a --> <!-- req editingcore:aaee759c.0f1c --> <!-- req editingcore:4bef4441.4fd5 -->
  redo(): CommandOutcome {
    const command = this.redoStack.pop();
    if (command === undefined) return { cursorAdvance: 'none' };
    const outcome = command.execute();
    this.undoStack.push(command);
    this.afterApply('redo', command);
    return outcome;
  }

  // <!-- req editingcore:518c8d47.ed5f -->
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  // <!-- req editingcore:93055886.37d5 -->
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 取り消しとやり直しのボタンの押せる状態を直すための購読（editing-core.md 2.2 節）。戻り値で外す。 */
  // <!-- req editingcore:03992629.b18c --> <!-- req editingcore:ba014f38.de9d -->
  subscribe(listener: Listener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** 曲の変更を知りたい所（コード名の推し直し・再生の同期）の購読（editing-core.md 2.2 節）。戻り値で外す。 */
  // <!-- req editingcore:e6bd2373.e4ca --> <!-- req editingcore:ba014f38.f4e6 --> <!-- req editingcore:ba014f38.78eb --> <!-- req editingcore:ba014f38.c84c -->
  onCommandApplied(listener: AppliedListener): () => void {
    this.appliedListeners.add(listener);
    return () => {
      this.appliedListeners.delete(listener);
    };
  }

  /** 編集ウィンドウを閉じるときに、履歴と購読を捨てる（editing-core.md 2.3 節）。 */
  // <!-- req editingcore:20848bc5.81b9 --> <!-- req editingcore:5db912e2.e70a -->
  dispose(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.estimatedBytes = 0;
    this.stateListeners.clear();
    this.appliedListeners.clear();
  }

  /** redo のスタックを捨て、推定の大きさの合計から引く（editing-core.md 2.3 節）。 */
  private clearRedoStack(): void {
    for (const command of this.redoStack) {
      this.estimatedBytes -= command.estimateSizeBytes();
    }
    this.redoStack.length = 0;
  }

  /**
   * 予算を超えていて、undo のスタックの件数が下限より多い間、一番古い項目から捨てる（editing-core.md 2.3 節）。
   * 1 つのコマンドだけで予算を超えるときも実行は拒まず、下限を残す範囲で捨てる。
   * 実際に捨てたときは、この履歴で初めての 1 回だけ EDIT-008（Info）を知らせる。
   */
  // <!-- req editingcore:22e85869.082b --> <!-- req editingcore:22e85869.ae7f --> <!-- req editingcore:22e85869.826e --> <!-- req editingcore:22e85869.27bb --> <!-- req editingcore:18792504.61fa --> <!-- req editingcore:18792504.4c12 -->
  private enforceBudget(): void {
    let evicted = 0;
    // <!-- req editingcore:3626c06c.af2f --> <!-- req editingcore:a10ca45b.f56b --> <!-- req editingcore:a10ca45b.0457 --> <!-- req editingcore:92608af0.ed7e --> <!-- req editingcore:53205c5f.9925 --> <!-- req editingcore:53205c5f.38f9 --> <!-- req editingcore:8549fab1.d488 --> <!-- req editingcore:e993149f.8f7d --> <!-- req editingcore:e993149f.1d8a --> <!-- req editingcore:e993149f.2947 --> <!-- req editingcore:2798641f.489b --> <!-- req editingcore:2798641f.559c -->
    while (this.estimatedBytes > this.budget && this.undoStack.length > this.minRetained) {
      // <!-- req editingcore:3626c06c.fc95 --> <!-- req editingcore:f73b9a3c.dbdb --> <!-- req editingcore:2798641f.02f6 -->
      const oldest = this.undoStack.shift()!;
      this.estimatedBytes -= oldest.estimateSizeBytes();
      evicted += 1;
    }
    // <!-- req editingcore:27fb3d78.bed6 --> <!-- req editingcore:27fb3d78.7a70 --> <!-- req editingcore:27fb3d78.89d3 --> <!-- req editingcore:05c29a46.9757 --> <!-- req editingcore:05c29a46.04f9 --> <!-- req 00:db2fd366.7e1f -->
    if (evicted > 0 && !this.evictionNotified) {
      this.evictionNotified = true;
      // <!-- req editingcore:8f269be0.ffb3 --> <!-- req 00:db2fd366.1a75 -->
      this.reporter.report('EDIT-008', { evictedCount: evicted });
    }
  }

  /**
   * execute・undo・redo の後の始末（editing-core.md 2.2 節・2.4 節）。描き直しを操作の最後に 1 回だけ頼み、
   * onChange を呼び、最後に onCommandApplied の購読と subscribe の購読に知らせる。
   */
  // <!-- req editingcore:256bdfad.05be --> <!-- req editingcore:256bdfad.2255 --> <!-- req editingcore:256bdfad.79a9 -->
  private afterApply(phase: CommandAppliedEvent['phase'], command: Command): void {
    // <!-- req editingcore:bda03848.e5ea --> <!-- req editingcore:bda03848.bb19 --> <!-- req editingcore:bda03848.487b -->
    const affected = [...command.affectedTrackIndices];
    // <!-- req editingcore:f21b91b6.9d38 --> <!-- req editingcore:4bef4441.a872 --> <!-- req editingcore:d49219fc.f0e1 --> <!-- req editingcore:d49219fc.c0a6 --> <!-- req editingcore:d49219fc.b3a9 --> <!-- req editingcore:e8a12819.e830 --> <!-- req editingcore:e8a12819.63fa --> <!-- req editingcore:bc137792.b8a9 --> <!-- req editingcore:bc137792.bece --> <!-- req editingcore:32e52505.86f6 --> <!-- req editingcore:32e52505.1754 --> <!-- req editingcore:32e52505.03ce --> <!-- req editingcore:5593382f.f311 --> <!-- req editingcore:1f68edd2.7630 --> <!-- req editingcore:1f68edd2.5d20 --> <!-- req editingcore:1f68edd2.859a --> <!-- req editingcore:1f68edd2.d2ba --> <!-- req editingcore:1f68edd2.762b -->
    this.render.render(affected);
    // <!-- req editingcore:256bdfad.f689 -->
    this.onChange?.();

    // <!-- req editingcore:256bdfad.c61b -->
    for (const listener of this.appliedListeners) {
      try {
        listener({ phase, kind: command.kind, affectedTrackIndices: affected });
      } catch (error) {
        console.error('[CommandHistory] onCommandApplied listener threw:', error);
      }
    }
    // <!-- req editingcore:256bdfad.83be --> <!-- req editingcore:ba014f38.e881 -->
    for (const listener of this.stateListeners) {
      try {
        listener();
      } catch (error) {
        console.error('[CommandHistory] subscribe listener threw:', error);
      }
    }
  }
}
// <!-- req webcorefoundation:4645a6e9.5432 --> <!-- req webcorefoundation:4645a6e9.dcb3 --> <!-- req webcorefoundation:4645a6e9.b59c --> <!-- req webcorefoundation:4645a6e9.3b4e -->
