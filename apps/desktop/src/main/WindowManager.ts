/**
 * 曲一覧ウィンドウ・編集ウィンドウの複数ウィンドウ管理（screens-navigation.md §4.1・§5.1、`WindowAdapter` 実装）。
 *
 * 責務:
 *  - 起動時に単一の曲一覧ウィンドウを生成（[[../../../..//docs/basic_design/01_architecture.md#3]] の単一インスタンスロックと連携）
 *  - `focusExistingWindow(songId)` で既存編集ウィンドウがあれば前面化、無ければ新規生成
 *  - 生成時、当該曲専用の `CommandHistory` / `CursorController` / `ViewModeController` / `ZoomController` /
 *    `PlaybackService` インスタンス一式（編集ウィンドウ単位スコープ）をウィンドウへ紐付ける
 *  - クローズ時、`flushAutoSave(songId)`（注入 dep）の完了を待ってからウィンドウ破棄・インスタンス一式破棄
 *
 * `flushAutoSave` の実体は `main.ts` が `AutoSaveFlushBridge`（トークン付き `flushAutoSaveRequest`/`Ack` の
 * ハンドシェイク＋タイムアウト、`autoSaveFlushBridge.ts`）で供給する。renderer 側で実際に
 * `AutoSaveScheduler.flush()` を行う配線は編集ウィンドウ単位の Webコア bootstrap に依存するため、現状の
 * `App.tsx` は受け口を登録して即 ack する（ハンドシェイクの往復は実体化済み・実 flush の中身は Phase 1
 * 追い込みで差し込む。screens-navigation.md §9.0 P2-a、00_reference.md §3.8）。
 *
 * Electron `BrowserWindow` そのものへは依存せず、`ManagedWindow` の最小契約と注入されたファクトリだけを使う
 * （テストで実 Electron を起動せずに重複防止ロジックを C2 検証できるようにするため。screens-navigation.md §6）。
 * 実 `BrowserWindow` 生成（`contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`）は `main.ts` が
 * ファクトリとして渡す（electron.rule.md セキュリティ既定値）。
 */

import type { WindowAdapter } from '@riff-line/shared-types';

/** クローズ割り込み可能なウィンドウの最小契約。 */
export interface ManagedWindow {
  /** ウィンドウ識別子。 */
  readonly id: number;
  /** 前面化する。 */
  focus(): void;
  /** 最小化されているか。 */
  isMinimized(): boolean;
  /** 最小化から復帰する。 */
  restore(): void;
  /**
   * `close` 割り込みを購読する。ハンドラ内で `event.preventDefault()` すると実クローズを保留できる。
   * 自動保存 flush 完了後に `destroy()` を呼んで実際に閉じる。
   */
  onClose(handler: (event: { preventDefault: () => void }) => void): void;
  /** `closed`（破棄完了）を購読する。 */
  onClosed(handler: () => void): void;
  /** ウィンドウを即時破棄する（`close` 割り込みを経由しない）。 */
  destroy(): void;
}

/** 編集ウィンドウ単位スコープのインスタンス一式（screens-navigation.md §4.1、00_reference.md §2）。 */
export interface EditWindowInstances {
  /**
   * インスタンス一式をまとめて破棄する（`CommandHistory.dispose()` 等）。
   * **冪等契約**：複数回呼ばれても安全でなければならない（`close` 割り込み経路と `closed` 後始末経路の
   * 両方から呼ばれ得るため。`WindowManager` 側でも二重呼び出しは避けるが、実装側も冪等にすること）。
   */
  dispose(): void;
}

export interface WindowManagerDeps {
  /** 曲一覧ウィンドウを生成する。 */
  createSongListWindow(): ManagedWindow;
  /** 曲 `songId` の編集ウィンドウを生成する（Score のロードは呼び出し先が行う）。 */
  createEditWindow(songId: string): ManagedWindow;
  /** 当該曲専用のインスタンス一式を生成する。 */
  createEditWindowInstances(songId: string): EditWindowInstances;
  /** クローズ時に自動保存を確定させる（`AutoSaveScheduler.flush(songId)` を bootstrap が接続する）。 */
  flushAutoSave(songId: string): Promise<void>;
}

/** 編集ウィンドウ 1 件の管理エントリ。 */
interface EditWindowEntry {
  window: ManagedWindow;
  instances: EditWindowInstances;
  /** クローズ処理が進行中か（多重クローズ・flush 二重実行を防ぐ）。 */
  closing: boolean;
}

export class WindowManager implements WindowAdapter {
  private readonly deps: WindowManagerDeps;
  private songListWindow: ManagedWindow | null = null;
  /** songId → 編集ウィンドウエントリ。 */
  private readonly editWindows = new Map<string, EditWindowEntry>();

  constructor(deps: WindowManagerDeps) {
    this.deps = deps;
  }

  /**
   * 曲一覧ウィンドウを開く（screens-navigation.md §5.1）。既にあれば前面化のみ（最小化中は復帰も）。
   */
  openSongListWindow(): void {
    if (this.songListWindow !== null) {
      this.bringToFront(this.songListWindow);
      return;
    }
    const window = this.deps.createSongListWindow();
    window.onClosed(() => {
      this.songListWindow = null;
    });
    this.songListWindow = window;
  }

  /**
   * 曲 `songId` の編集ウィンドウを前面化する。既存が無ければ新規生成し、インスタンス一式を紐付ける
   * （screens-navigation.md §4.1・§5.1）。
   *
   * 複合条件（C2 対象、screens-navigation.md §6）:
   *  - 既存あり かつ 最小化中 → `restore()` してから `focus()`、戻り値 true
   *  - 既存あり かつ 非最小化 → `focus()` のみ、戻り値 true
   *  - 既存なし → 新規ウィンドウ＋インスタンス一式生成、`close` 割り込み配線、戻り値 false
   */
  focusExistingWindow(songId: string): boolean {
    const existing = this.editWindows.get(songId);
    if (existing !== undefined) {
      this.bringToFront(existing.window);
      return true;
    }

    const window = this.deps.createEditWindow(songId);
    const instances = this.deps.createEditWindowInstances(songId);
    const entry: EditWindowEntry = { window, instances, closing: false };
    this.editWindows.set(songId, entry);

    // クローズ要求を割り込み、自動保存 flush 完了を待ってから実破棄する（screens-navigation.md §4.1）。
    window.onClose((event) => {
      if (entry.closing) return;
      entry.closing = true;
      event.preventDefault();
      void this.finalizeClose(songId, entry);
    });
    // 何らかの理由で割り込みを経ずに閉じられた場合の後始末（インスタンス破棄漏れ防止）。
    window.onClosed(() => {
      if (this.editWindows.get(songId) === entry) {
        entry.instances.dispose();
        this.editWindows.delete(songId);
      }
    });
    return false;
  }

  /**
   * 曲 `songId` の編集ウィンドウをプログラムから閉じる（screens-navigation.md §4.1）。
   * 自動保存 flush 完了まで待つ。開いていなければ何もしない。
   */
  async closeEditWindow(songId: string): Promise<void> {
    const entry = this.editWindows.get(songId);
    if (entry === undefined || entry.closing) return;
    entry.closing = true;
    await this.finalizeClose(songId, entry);
  }

  /** 現在開いている編集ウィンドウの曲 ID 一覧。 */
  listOpenEditWindowSongIds(): string[] {
    return [...this.editWindows.keys()];
  }

  // ===== 内部ヘルパー =====

  /**
   * flush → 管理表から除去 → ウィンドウ破棄 → インスタンス破棄。
   *
   * 管理表からの除去を `destroy()` より**前**に行う：`destroy()` が同期的に `closed` を発火する実装でも、
   * `onClosed` ハンドラの `this.editWindows.get(songId) === entry` 判定が false になり `instances.dispose()` が
   * 二重に走らない（非ブロッキング#5 対応）。
   */
  private async finalizeClose(songId: string, entry: EditWindowEntry): Promise<void> {
    try {
      await this.deps.flushAutoSave(songId);
    } catch (error) {
      // flush 失敗（FILE-001 相当は AutoSaveScheduler 側で通知済み）でもウィンドウは閉じる。
      console.error(`[WindowManager] flushAutoSave(${songId}) failed on close:`, error);
    }
    this.editWindows.delete(songId);
    entry.window.destroy();
    entry.instances.dispose();
  }

  /** 最小化中なら復帰してから前面化する。 */
  private bringToFront(window: ManagedWindow): void {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
}
