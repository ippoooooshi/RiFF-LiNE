/**
 * ウィンドウ管理のアダプタ（PlatformAdapter の 4 系統の 1 つ）。
 *
 * 置き場所は web-core-foundation.md 3.1 節（packages/core/src/platform、実装は置かない）。
 * PC 版で IPC を通るので、どのメソッドも Promise を返す（3.3 節の非同期の決まり）。
 * メンバーは今のコード（apps/desktop/src/main/WindowManager）の形のまま。screens-navigation.md 4.3 節の
 * focusExistingWindow・openEditWindow の 2 つの形へ作り直すのは、画面の作業パッケージ（8）で行う。
 */

export interface WindowAdapter {
  /** 曲一覧ウィンドウを開く（既にあれば前に出す）。 */
  openSongListWindow(): Promise<void>;
  /**
   * 曲 `songId` の編集ウィンドウを前に出す。無ければ新しく作る（同じ曲を二重に開かない）。
   * @returns 既にあったウィンドウを前に出したら true、新しく作ったら false。
   */
  focusExistingWindow(songId: string): Promise<boolean>;
  /** 曲 `songId` の編集ウィンドウを、自動保存の flush を待ってから閉じる。開いていなければ何もしない。 */
  closeEditWindow(songId: string): Promise<void>;
  /** いま開いている編集ウィンドウの曲 ID の一覧。 */
  listOpenEditWindowSongIds(): Promise<string[]>;
}
