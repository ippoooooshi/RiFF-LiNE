/**
 * メニューバー構成とサービス呼び出しの配線（screens-navigation.md §4.2、03_screens_ui_pc.md §6）。
 *
 * 03 章のメニュー構成をフレームワーク非依存の `MenuItemDescriptor` ツリーとして組み立て、各項目を
 * 対応する下位パッケージの API 呼び出し（`CommandHistory.undo()` 等）へ配線する。OS ネイティブメニューへの
 * 変換自体は L5（`apps/desktop/src/main`）が `buildTemplate()` の結果を使って行う。
 *
 * UI から Score モデル / `ScoreRenderHost` / AlphaSynth を直接操作しない層構造（AD-2）を、メニュー項目の
 * 配線でも維持する（action は必ず ViewModel / Service 経由のコールバック）。
 */

import type { MenuItemDescriptor } from './types';

/** メニュー項目 id → 実行アクション。未指定（undefined）の項目は無効表示になる。 */
export type MenuActionMap = Partial<Record<MenuItemId, () => void>>;

/** 03_screens_ui_pc.md §6 のメニュー項目 id 一覧。 */
export type MenuItemId =
  | 'file.newSong'
  | 'file.openSong'
  | 'file.save'
  | 'file.export'
  | 'file.print'
  | 'file.closeWindow'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.insertBar'
  | 'edit.deleteBar'
  | 'view.focusMode'
  | 'view.scrollMode'
  | 'view.scoreMode'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'playback.playPause'
  | 'playback.stop'
  | 'playback.toggleRegionLoop'
  | 'help.showOnboarding'
  | 'help.showLicense';

export interface MenuBarOptions {
  /** エクスポート実行を有効にするか（Phase 1 は false＝無効化＋ツールチップ、B19、screens-navigation.md §3.6）。 */
  exportEnabled?: boolean;
  /** 印刷実行を有効にするか（Phase 1 は false、B19）。 */
  printEnabled?: boolean;
}

export class MenuBarController {
  private readonly actions: MenuActionMap;
  private readonly options: Required<MenuBarOptions>;

  constructor(actions: MenuActionMap, options: MenuBarOptions = {}) {
    this.actions = actions;
    this.options = {
      exportEnabled: options.exportEnabled ?? false,
      printEnabled: options.printEnabled ?? false,
    };
  }

  /**
   * メニューツリーを構築する（screens-navigation.md §4.2）。
   * action 未配線の項目は `enabled: false`。エクスポート / 印刷は B19 により既定で無効（ツールチップは L5 が付与）。
   */
  buildTemplate(): MenuItemDescriptor[] {
    return [
      {
        id: 'file',
        label: 'ファイル',
        submenu: [
          this.item('file.newSong', '新規曲…', 'CmdOrCtrl+N'),
          this.item('file.openSong', '開く…', 'CmdOrCtrl+O'),
          this.item('file.save', '保存', 'CmdOrCtrl+S'),
          { separator: true },
          // B19: Phase 1 は実処理を接続しない。action があっても options で無効化できる。
          this.item('file.export', 'エクスポート…', 'CmdOrCtrl+E', this.options.exportEnabled),
          this.item('file.print', '印刷…', 'CmdOrCtrl+P', this.options.printEnabled),
          { separator: true },
          this.item('file.closeWindow', 'ウィンドウを閉じる', 'CmdOrCtrl+W'),
        ],
      },
      {
        id: 'edit',
        label: '編集',
        submenu: [
          this.item('edit.undo', '元に戻す', 'CmdOrCtrl+Z'),
          this.item('edit.redo', 'やり直し', 'CmdOrCtrl+Shift+Z'),
          { separator: true },
          this.item('edit.copy', 'コピー', 'CmdOrCtrl+C'),
          this.item('edit.paste', '貼り付け', 'CmdOrCtrl+V'),
          { separator: true },
          this.item('edit.insertBar', '小節を挿入'),
          this.item('edit.deleteBar', '小節を削除'),
        ],
      },
      {
        id: 'view',
        label: '表示',
        submenu: [
          this.item('view.focusMode', 'フォーカス表示'),
          this.item('view.scrollMode', '全体スクロール表示'),
          this.item('view.scoreMode', 'スコア表示'),
          { separator: true },
          this.item('view.zoomIn', 'ズームイン', 'CmdOrCtrl+Plus'),
          this.item('view.zoomOut', 'ズームアウト', 'CmdOrCtrl+-'),
        ],
      },
      {
        id: 'playback',
        label: '再生',
        submenu: [
          this.item('playback.playPause', '再生 / 一時停止', 'Space'),
          this.item('playback.stop', '停止'),
          this.item('playback.toggleRegionLoop', '区間ループ'),
        ],
      },
      {
        id: 'help',
        label: 'ヘルプ',
        submenu: [
          this.item('help.showOnboarding', '使い方を表示'),
          this.item('help.showLicense', 'ライセンス / クレジット'),
        ],
      },
    ];
  }

  /**
   * id のアクションを実行する（`KeyboardShortcutRouter` やテスト・L5 のメニュークリックから使う）。
   * @returns 実行したら true。未配線なら false。
   */
  invoke(id: MenuItemId): boolean {
    const action = this.actions[id];
    if (action === undefined) return false;
    action();
    return true;
  }

  /** 1 項目を組み立てる。action 未配線または `forceEnabled === false` で `enabled: false`。 */
  private item(id: MenuItemId, label: string, accelerator?: string, forceEnabled?: boolean): MenuItemDescriptor {
    const action = this.actions[id];
    const enabled = action !== undefined && forceEnabled !== false;
    const descriptor: MenuItemDescriptor = { id, label, enabled };
    if (accelerator !== undefined) descriptor.accelerator = accelerator;
    if (action !== undefined) descriptor.action = action;
    return descriptor;
  }
}
