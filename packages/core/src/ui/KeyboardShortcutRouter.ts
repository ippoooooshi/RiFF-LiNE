/**
 * キーボードショートカットの配線（screens-navigation.md §4.3、03_screens_ui_pc.md §7）。
 *
 * フォーカスのある編集ウィンドウのコンテキストに対してショートカット一覧を配線する。
 * OS 標準ショートカット（Ctrl+C 等）と競合しないよう、テキスト入力欄にフォーカスがある場合は
 * `allowInTextInput` を明示したバインドを除きアプリ側の処理を行わず、入力欄側の既定動作を優先する。
 *
 * キーイベントの生成元（DOM / Electron のどちらか）に結合しないよう、`KeyEventLike` の最小形だけを受け取る。
 */

/** DOM `KeyboardEvent` / Electron の before-input-event から必要な分だけ抜き出した形。 */
export interface KeyEventLike {
  /** `KeyboardEvent.key`（例 `'z'` `'ArrowRight'` `' '`）。 */
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** ショートカット 1 件の登録内容。 */
export interface ShortcutBinding {
  /** 一意な識別子（メニュー項目 id と揃えると配線が追いやすい）。 */
  id: string;
  /**
   * 正規化コンボ文字列。修飾子は `mod`（Ctrl か Cmd）/ `shift` / `alt` の順、キーは小文字。
   * 例 `'mod+z'` `'mod+shift+z'` `'space'` `'delete'` `'arrowright'`。
   */
  combo: string;
  /** 発火時の処理。 */
  handler: () => void;
  /** テキスト入力欄フォーカス時でも発火させるか（既定 false＝入力欄優先）。 */
  allowInTextInput?: boolean;
}

/** ルーティング時のフォーカス状況。 */
export interface ShortcutContext {
  /** テキスト入力欄（input / textarea / contenteditable）にフォーカスがあるか。 */
  isTextInputFocused: boolean;
}

/** `KeyEventLike` を正規化コンボ文字列へ変換する。修飾子順を固定して照合を安定させる。 */
export function normalizeCombo(event: KeyEventLike): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('mod');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');

  // 表示上のキー名を安定した識別子へ寄せる（スペースは 'space'、1 文字は小文字化）。
  const rawKey = event.key;
  const key = rawKey === ' ' ? 'space' : rawKey.toLowerCase();
  parts.push(key);
  return parts.join('+');
}

export class KeyboardShortcutRouter {
  /** コンボ文字列 → バインド。後勝ち（同一コンボの再 `register` で上書き）。 */
  private readonly bindings = new Map<string, ShortcutBinding>();

  /** ショートカットを登録する。同一コンボは上書きする。 */
  register(binding: ShortcutBinding): void {
    this.bindings.set(binding.combo.toLowerCase(), binding);
  }

  /** 登録を解除する。存在しなければ何もしない。 */
  unregister(combo: string): void {
    this.bindings.delete(combo.toLowerCase());
  }

  /**
   * キーイベントを対応するハンドラへ振り分ける。
   * @returns ハンドラを実行したら true（呼び出し側は `preventDefault` すべき）。未登録・入力欄優先なら false。
   */
  handleKeyEvent(event: KeyEventLike, context: ShortcutContext): boolean {
    const binding = this.bindings.get(normalizeCombo(event));
    if (binding === undefined) return false;

    // テキスト入力中は、明示的に許可されたショートカットだけ通す（OS 標準の編集操作を殺さない）。
    if (context.isTextInputFocused && binding.allowInTextInput !== true) return false;

    binding.handler();
    return true;
  }

  /** 登録済みコンボ一覧（デバッグ・重複確認用）。 */
  registeredCombos(): string[] {
    return [...this.bindings.keys()];
  }
}
