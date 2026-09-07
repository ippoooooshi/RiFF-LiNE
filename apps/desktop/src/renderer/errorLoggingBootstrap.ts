/**
 * レンダラー起動時のエラー・ログ基盤の結線（error-logging-foundation.md §2・§3.2、B32）。
 *
 * - Webコアの共有 `notificationCenter`（Webコア内シングルトン）が発行する全イベントを
 *   `window.riffLineApi.log.append` 経由で main プロセスの `Logger` へ転送する（永続ログ）。
 * - 直前がレンダラークラッシュからの復旧なら SYS-001 を、繰り返しクラッシュ状態なら SYS-002 を発行する。
 *
 * `Logger` は main プロセス側にあるため、Webコアの `setLogSink` ではなく `subscribe` で転送する
 * （プロセス境界を越えるので `NotificationEvent` をそのまま渡し、`LogEntry` 化は main 側が行う）。
 */

import { notificationCenter } from '@riff-line/core/errors';

/**
 * ログ転送の購読を張り、クラッシュ復旧状態を 1 回問い合わせて対応する通知を発行する。
 * @returns 購読解除関数（テスト・HMR 用）。
 */
export function bootstrapErrorLogging(): () => void {
  const unsubscribe = notificationCenter.subscribe((event) => {
    // ログ記録失敗は UI 動作へ影響させない（握り潰す。§2.2）。
    void window.riffLineApi.log.append(event).catch(() => undefined);
  });

  void window.riffLineApi.crash
    .getRecoveryState()
    .then((state) => {
      if (state.repeatedCrash) {
        notificationCenter.report('SYS-002');
      } else if (state.recovered) {
        notificationCenter.report('SYS-001');
      }
    })
    .catch(() => undefined);

  return unsubscribe;
}
