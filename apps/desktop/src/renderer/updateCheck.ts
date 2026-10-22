/**
 * 更新の確認のダミー（web-core-foundation.md 13.3 節、7.2 節の表の④）。
 *
 * v1 は通信しないダミーで、常に「更新なし」を返す。(b) PC 版のダミーはレンダラーの側に置き、IPC を使わない。
 * 通信しないので、main に置く理由が無いため。将来は実際に問い合わせる実装に差し替えるだけにする（3.2 節）。
 */
// 13.3 節：UpdateCheckAdapter は v1 では通信しないダミーの実装とし、将来は問い合わせる実装に差し替えるだけにする。PC 版のダミーはレンダラーの側に置き、IPC を使わない（7.2 節の表の④の置くプロセス）。失敗で reject せず { kind: 'none' } を返す
import type { UpdateCheckAdapter, UpdateCheckResult } from '@riff-line/core';

/** v1 の更新の確認。通信せず、常に「更新なし」を返す。reject しない。 */
export const noUpdateCheckAdapter: UpdateCheckAdapter = {
  check(): Promise<UpdateCheckResult> {
    return Promise.resolve({ kind: 'none' });
  },
};

/** このレンダラーで check を呼んだか。 */
let checked = false;

/**
 * 曲一覧ウィンドウのレンダラーが起動した後に 1 回だけ呼ぶ（13.3 節の (b)）。
 * v1 のダミーは「更新なし」を返すので、画面には何も出さない。結果も失敗も起動を止めない
 * （更新の確認を起動・編集・再生に欠かせない経路に置かない、6.2 節）。
 */
// 13.3 節：check を呼ぶのは曲一覧ウィンドウのレンダラーが起動した後の 1 回。v1 のダミーは「更新なし」を返すので画面には何も出さない
export function runUpdateCheckOnce(adapter: UpdateCheckAdapter = noUpdateCheckAdapter): void {
  // (b) レンダラー（ウィンドウ）ごとに 1 回にする。開発の起動の StrictMode は効果を 2 回呼ぶため、呼んだ印で 2 回目を止める
  if (checked) return;
  checked = true;
  void adapter.check().catch(() => undefined);
}
// 13.2 節・13.3 節：自動アップデートは UpdateCheckAdapter のダミーの実装で受ける。PC 版のダミーはレンダラーの側に置き IPC を使わず、曲一覧ウィンドウのレンダラーが起動した後に 1 回だけ呼び、「更新なし」なので画面に何も出さない。失敗しても reject しない <!-- req webcorefoundation:7f9a826f.dc46 --> <!-- req webcorefoundation:0c9c26a6.0318 --> <!-- req webcorefoundation:0c9c26a6.615a --> <!-- req webcorefoundation:23934647.c229 --> <!-- req webcorefoundation:23934647.36d7 --> <!-- req webcorefoundation:04b489b1.42b0 --> <!-- req webcorefoundation:04b489b1.37bf --> <!-- req webcorefoundation:04b489b1.5893 --> <!-- req webcorefoundation:04b489b1.c993 --> <!-- req webcorefoundation:04b489b1.1506 -->
