/**
 * レンダラー起動時のエラー・ログ基盤の結線（error-logging-foundation.md 2.3 節・2.4 節、B32）。
 *
 * - ログ転送：Webコアの `NotificationCenter` の記録を、`showOnScreen` を見ずに全部、`toLogEntry(event)` で `LogEntry` に組み立てて
 *   `log.append` で main の `Logger` へ送る（2.1 節の「ログの受け手」、2.4 節の結線）。組み立ては renderer（Webコア）で、main は書くだけ。
 *   表示側（`NotificationUIBinder`）の購読より**先に**登録する（2.4 節の「購読の順番」）ので、画面の部品を描く前に呼ぶ（main.tsx）。
 *   main から届く記録（`relay`）は main がもう書いたので受けない（`{ relayed: false }`、2.6 節）。
 * - クラッシュ復旧：起動時に `crash:getRecoveryState` を 1 回引き、`repeatedCrash` なら `SYS-002` だけ（`context.logFolder` にログの
 *   フォルダの場所）、そうでなく `recovered` なら `SYS-001` を出す（2.4 節、決定 X5・O3）。
 * - フリーズからの復帰：`freeze:recovered` を受けたら `SYS-003` を出す（2.3 節の案 A）。
 *
 * ログを送れなくても画面の動きには響かせない（reject は受けて捨てる）。
 */

import { toLogEntry, type NotificationCenter } from '@riff-line/core/errors';
import type { RiffLineApi } from '@riff-line/shared-types';

export interface ErrorLoggingBootstrapDeps {
  /** renderer の共有 `notificationCenter`（2.4 節）。main.tsx が渡す。 */
  center: Pick<NotificationCenter, 'subscribe' | 'report'>;
  /** preload が出した呼び口（`window.riffLineApi`）のうち使う所。 */
  api: Pick<RiffLineApi, 'log' | 'crash'>;
}

/**
 * ログ転送の購読とフリーズの復帰の購読を張り、クラッシュ復旧状態を 1 回引いて対応する知らせを出す。
 * @returns 購読を外す関数（テスト用）。
 */
export function bootstrapErrorLogging(deps: ErrorLoggingBootstrapDeps): () => void {
  const { center, api } = deps;

  // 2.4 節「購読の順番」：ほかのどの購読よりも先に登録する。
  // <!-- req errorloggingfoundation:e6bd7249.ede3 --> <!-- req errorloggingfoundation:e6bd7249.e74a --> <!-- req errorloggingfoundation:e6bd7249.cab8 --> <!-- req errorloggingfoundation:1de54fea.8e89 --> <!-- req errorloggingfoundation:527c56a7.1b4a -->
  const stopForwarding = center.subscribe(
    (event) => {
      // <!-- req errorloggingfoundation:e6bd7249.1dc5 --> <!-- req errorloggingfoundation:e6bd7249.ef55 --> <!-- req errorloggingfoundation:527c56a7.d757 --> <!-- req errorloggingfoundation:4d822df3.92ef -->
      void api.log.append(toLogEntry(event)).catch(() => undefined);
    },
    { relayed: false },
  );

  // 2.3 節：responsive を受けた main からの freeze:recovered → SYS-003（Warning「一時的に応答が停止していました」）。
  // <!-- req errorloggingfoundation:981ed938.e19e --> <!-- req errorloggingfoundation:7654a5b1.cb50 --> <!-- req 00:4621b13b.faaa --> <!-- req 00:4621b13b.da2e --> <!-- req 00:4621b13b.47d2 --> <!-- req errorloggingfoundation:33672dde.3586 -->
  const stopFreezeWatch = api.crash.onFreezeRecovered(() => center.report('SYS-003'));

  // 2.4 節：強い知らせが弱い知らせを置き換える（repeatedCrash のときは SYS-002 だけ、決定 X5）。
  void api.crash
    // <!-- req errorloggingfoundation:efe204dd.ecaa --> <!-- req errorloggingfoundation:e81b2ba9.8e54 --> <!-- req errorloggingfoundation:c7d54f51.3893 -->
    .getRecoveryState()
    .then((state) => {
      // <!-- req errorloggingfoundation:e81b2ba9.367b -->
      if (state.repeatedCrash) {
        // <!-- req errorloggingfoundation:c7d54f51.4ba6 --> <!-- req errorloggingfoundation:c7d54f51.4a02 --> <!-- req 00:7201a989.3cfc --> <!-- req errorloggingfoundation:c065ba9a.2cc5 --> <!-- req 00:b0f21041.cf7e -->
        center.report('SYS-002', { logFolder: state.logFolder });
        // <!-- req errorloggingfoundation:c7d54f51.2e90 -->
      } else if (state.recovered) {
        // <!-- req errorloggingfoundation:c7d54f51.3909 --> <!-- req 00:7b1905ba.a51b --> <!-- req errorloggingfoundation:ce632d5c.0da2 --> <!-- req 00:b0f21041.1cc3 -->
        center.report('SYS-001');
      }
    })
    .catch(() => undefined);

  return () => {
    stopForwarding();
    stopFreezeWatch();
  };
}
