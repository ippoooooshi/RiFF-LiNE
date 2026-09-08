/**
 * レベル → 表示チャンネルの固定対応（error-logging-foundation.md §2.1、08_error_logging.md §1 の表をコード化）。
 *
 * この表を単一の真実源にすることで、同じレベルが呼び出し箇所ごとに違うチャンネルへ流れる事故を防ぐ。
 */

import type { NotificationChannel, NotificationLevel } from './types';

/** `info`/`warning` → toast、`error` → highlight、`critical` → modal。 */
export const LEVEL_TO_CHANNEL: Readonly<Record<NotificationLevel, NotificationChannel>> = {
  info: 'toast',
  warning: 'toast',
  error: 'highlight',
  critical: 'modal',
};
