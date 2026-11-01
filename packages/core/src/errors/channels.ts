/**
 * レベル → 表示チャンネルの固定対応（error-logging-foundation.md 2.1 節、08_error_logging.md 1 節の表をコード化）。
 *
 * この表を単一の真実源にすることで、同じレベルが呼び出し箇所ごとに違うチャンネルへ流れる事故を防ぐ。
 * `NotificationEvent.level`／`channel` は、表示の部品がどの色トークンを使うかを決める入力になる（同 5 節。 <!-- req errorloggingfoundation:bbc157fd.2b0c --> <!-- req errorloggingfoundation:bbc157fd.301a -->
 * レベルとトークンの対応は screens-navigation.md 13.2 節に書き、本パッケージは色トークンの値を持たない）。 <!-- req errorloggingfoundation:3052c108.a670 --> <!-- req errorloggingfoundation:bbc157fd.ac0b -->
 */

import type { NotificationChannel, NotificationLevel } from './types';

/** `info`/`warning` → toast、`error` → highlight、`critical` → modal。 */
// <!-- req errorloggingfoundation:bfb5910c.73cb --> <!-- req errorloggingfoundation:4b6088e9.1b41 -->
export const LEVEL_TO_CHANNEL: Readonly<Record<NotificationLevel, NotificationChannel>> = {
  // <!-- req errorloggingfoundation:e8eddb7c.d5b2 --> <!-- req errorloggingfoundation:4b6088e9.587c -->
  info: 'toast',
  // <!-- req errorloggingfoundation:e8eddb7c.1b98 --> <!-- req errorloggingfoundation:4b6088e9.e4b3 -->
  warning: 'toast',
  // <!-- req errorloggingfoundation:e8eddb7c.da45 --> <!-- req errorloggingfoundation:4b6088e9.62fd --> <!-- req errorloggingfoundation:e1105ca2.7fc5 -->
  error: 'highlight',
  // <!-- req errorloggingfoundation:e8eddb7c.b9b7 --> <!-- req errorloggingfoundation:4b6088e9.7647 -->
  critical: 'modal',
};
