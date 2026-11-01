/**
 * main が組む OS のネイティブの部品（ダイアログ）に入れる文言の、文字のデータ。
 *
 * 画面の文言を書いてよい所を 2 か所に限る決まり（screens-navigation.md 1 節）に合わせ、main には文言を書かず、
 * ここを import して使う（error-logging-foundation.md 2.3 節、screens-navigation.md 8.3 節のメニューの項目の名前と同じ置き方）。
 * React を使わない文字のデータだけを置く。main のバンドルに React を入れないため、入口は index.ts と分けて
 * package.json の exports の `./nativeText` にする。
 */

/** ネイティブのダイアログの題に出すアプリ名（error-logging-foundation.md 2.3 節の `title`＝アプリ名）。 */
export const APP_DISPLAY_NAME = 'RiFF-LiNE';

/**
 * フリーズの確認ダイアログの文言（error-logging-foundation.md 2.3 節、基本設計 08 章 5 節）。
 * ボタンの並び（0 番が「待つ」）は main の `CrashRecoveryController` が決める。
 */
// <!-- req errorloggingfoundation:042fae6c.cde2 --> <!-- req errorloggingfoundation:042fae6c.8d96 -->
export const FREEZE_DIALOG_TEXT = {
  /** 見出し（`MessageBoxOptions.message`）。 */
  // <!-- req errorloggingfoundation:042fae6c.117c -->
  message: '画面が応答していません',
  /**
   * 本文（`MessageBoxOptions.detail`）。
   * @param seconds 確認を出すまでに待つ秒数（main の `FREEZE_CONFIRM_DELAY_MS` から渡す。値を 2 か所に持たないため）
   */
  // <!-- req errorloggingfoundation:042fae6c.ef32 --> <!-- req errorloggingfoundation:042fae6c.5373 --> <!-- req errorloggingfoundation:042fae6c.b6a2 --> <!-- req errorloggingfoundation:042fae6c.c426 -->
  detail: (seconds: number): string =>
    `画面の処理が ${seconds} 秒以上止まっています。大きな曲の描画や保存など、重い処理の途中で一時的に止まっているだけのこともあります。このまま待つか、画面を再読み込みしてください。再読み込みすると最後に自動保存した内容で開き直すため、自動保存されていない直前の編集は失われます。`,
  /** 待つ側のボタン（既定・Esc の側。再読み込みしない）。 */
  waitButton: '待つ',
  /** 再読み込みする側のボタン。 */
  reloadButton: '再読み込み',
} as const;
