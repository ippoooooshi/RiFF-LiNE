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
 * - 描画の外の未捕捉の例外：`window` の `error`・`unhandledrejection` を 1 回ずつ登録し、受けたら `SYS-005`（`{ kind, error }`）を
 *   1 回 report する（2.6 節）。`ErrorBoundary`（2.5 節）が受け止めない、クリックのハンドラの中の例外と誰も受けなかった reject を拾う。
 * - main で出たエラーの知らせ：`notify.onFromMain` の受け口を 1 回登録し、受けた記録は report し直さずに `relay` で画面の受け手へ渡す（2.6 節）。
 *
 * ログを送れなくても画面の動きには響かせない（reject は受けて捨てる）。
 */

import { toLogEntry, type NotificationCenter } from '@riff-line/core/errors';
import type { RiffLineApi } from '@riff-line/shared-types';

/** `window` のうち、未捕捉の例外の登録に使う所（2.6 節）。 */
export type UncaughtErrorTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export interface ErrorLoggingBootstrapDeps {
  /** renderer の共有 `notificationCenter`（2.4 節）。main.tsx が渡す。 */
  center: Pick<NotificationCenter, 'subscribe' | 'report' | 'relay'>;
  /** preload が出した呼び口（`window.riffLineApi`）のうち使う所。 */
  api: Pick<RiffLineApi, 'log' | 'crash' | 'notify'>;
  /** `error`・`unhandledrejection` を登録する先。main.tsx は `window` を渡す（2.6 節）。 */
  target: UncaughtErrorTarget;
}

/** 受けた値を Error にそろえる（Error でなければ new Error(String(value)) に包む、2.6 節）。 */
function toError(value: unknown): Error {
  // <!-- req errorloggingfoundation:9018070e.b0e3 -->
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * ログ転送の購読とフリーズの復帰の購読を張り、クラッシュ復旧状態を 1 回引いて対応する知らせを出す。
 * @returns 購読を外す関数（テスト用）。
 */
// <!-- req errorloggingfoundation:965aa13a.7d98 -->
export function bootstrapErrorLogging(deps: ErrorLoggingBootstrapDeps): () => void {
  const { center, api, target } = deps;

  // 2.4 節「購読の順番」：ほかのどの購読よりも先に登録する。
  // <!-- req errorloggingfoundation:eff8188b.ede3 --> <!-- req errorloggingfoundation:eff8188b.e74a --> <!-- req errorloggingfoundation:eff8188b.cab8 --> <!-- req errorloggingfoundation:1de54fea.8e89 --> <!-- req errorloggingfoundation:5e36aaaf.1b4a -->
  const stopForwarding = center.subscribe(
    (event) => {
      // <!-- req errorloggingfoundation:eff8188b.1dc5 --> <!-- req errorloggingfoundation:eff8188b.ef55 --> <!-- req errorloggingfoundation:5e36aaaf.d757 --> <!-- req errorloggingfoundation:4d822df3.92ef -->
      // <!-- req errorloggingfoundation:3d1200d3.ff60 -->
      // <!-- req errorloggingfoundation:3d1200d3.b583 -->
      void api.log.append(toLogEntry(event)).catch(() => undefined);
    },
    // <!-- req errorloggingfoundation:cffd0968.4ecc -->
    { relayed: false },
  );

  // 2.6 節：描画の外の未捕捉の例外を SYS-005 で残す。ログ転送の購読と同じ所で、起動の最初に 1 回ずつ登録する。
  // SYS-005 は画面に出さない（showOnScreen: false）ので、画面の受け手は飛ばし、ログの受け手（上の転送）には届く。
  // <!-- req errorloggingfoundation:a1b44579.63ef -->
  // <!-- req errorloggingfoundation:a1b44579.45b6 -->
  // <!-- req errorloggingfoundation:a1b44579.e412 -->
  const onError = (event: ErrorEvent): void => {
    // <!-- req errorloggingfoundation:9018070e.08d8 -->
    // <!-- req errorloggingfoundation:9018070e.dcaa -->
    // <!-- req 00:4d4e83f6.6025 -->
    // <!-- req 00:4d4e83f6.f65a -->
    // <!-- req errorloggingfoundation:3680e262.65ae -->
    // <!-- req errorloggingfoundation:3680e262.0720 -->
    center.report('SYS-005', { kind: 'error', error: toError(event.error) }); // <!-- req 00:4d4e83f6.e926 -->
  };
  // <!-- req errorloggingfoundation:a1b44579.0bb2 -->
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    // <!-- req errorloggingfoundation:9018070e.327a -->
    // <!-- req 00:4d4e83f6.b691 -->
    // <!-- req 00:4d4e83f6.f9fb -->
    // <!-- req errorloggingfoundation:3680e262.25cf -->
    // <!-- req errorloggingfoundation:3680e262.4542 -->
    center.report('SYS-005', { kind: 'unhandledrejection', error: toError(event.reason) });
  };
  // <!-- req errorloggingfoundation:9018070e.de29 -->
  target.addEventListener('error', onError);
  // <!-- req errorloggingfoundation:9018070e.82f5 -->
  target.addEventListener('unhandledrejection', onUnhandledRejection);

  // 2.6 節：main で出たエラーの知らせ（notify:fromMain）。main がもうログに書いたので report し直さず、relay で画面の受け手へ渡す。
  // relay は { relayed: false } で登録した上のログ転送を飛ばすので、main が書いたログを renderer がもう一度書かない。
  // <!-- req errorloggingfoundation:cffd0968.9d15 -->
  // <!-- req errorloggingfoundation:cffd0968.eeff -->
  // <!-- req errorloggingfoundation:cffd0968.425c -->
  // <!-- req errorloggingfoundation:cffd0968.d4eb -->
  // <!-- req errorloggingfoundation:75c8b2ae.49d7 -->
  const stopFromMain = api.notify.onFromMain((event) => center.relay(event));

  // 2.3 節：responsive を受けた main からの freeze:recovered → SYS-003（Warning「一時的に応答が停止していました」）。
  // <!-- req errorloggingfoundation:981ed938.e19e --> <!-- req errorloggingfoundation:7654a5b1.cb50 --> <!-- req 00:a32f7f3d.faaa --> <!-- req 00:a32f7f3d.da2e --> <!-- req 00:a32f7f3d.47d2 --> <!-- req errorloggingfoundation:33672dde.3586 -->
  const stopFreezeWatch = api.crash.onFreezeRecovered(() => center.report('SYS-003'));

  // 2.4 節：強い知らせが弱い知らせを置き換える（repeatedCrash のときは SYS-002 だけ、決定 X5）。
  void api.crash
    // <!-- req errorloggingfoundation:efe204dd.ecaa --> <!-- req errorloggingfoundation:e81b2ba9.8e54 --> <!-- req errorloggingfoundation:c7d54f51.3893 -->
    .getRecoveryState()
    .then((state) => {
      // <!-- req errorloggingfoundation:e81b2ba9.367b -->
      if (state.repeatedCrash) {
        // <!-- req errorloggingfoundation:c7d54f51.4ba6 --> <!-- req errorloggingfoundation:c7d54f51.4a02 --> <!-- req 00:7201a989.3cfc --> <!-- req errorloggingfoundation:36fd1daf.2cc5 -->
        center.report('SYS-002', { logFolder: state.logFolder }); // <!-- req 00:844e8b28.cf7e -->
        // <!-- req errorloggingfoundation:c7d54f51.2e90 -->
      } else if (state.recovered) {
        // <!-- req errorloggingfoundation:c7d54f51.3909 --> <!-- req 00:7b1905ba.a51b --> <!-- req errorloggingfoundation:ce632d5c.0da2 -->
        // <!-- req errorloggingfoundation:c7e9e456.00fb -->
        center.report('SYS-001'); // <!-- req 00:844e8b28.1cc3 -->
      }
    })
    .catch(() => undefined);

  return () => {
    stopForwarding();
    stopFreezeWatch();
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onUnhandledRejection);
    stopFromMain();
  };
}
