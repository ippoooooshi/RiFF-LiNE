/**
 * 自動更新チェックのアダプタ（PlatformAdapter の 4 系統の 1 つ）。
 *
 * 置き場所は web-core-foundation.md 3.1 節、シグネチャは同じ文書の 13.3 節。
 * v1 は通信しないダミーの実装で、常に「更新なし」を返す（3.2 節）。
 * 6.2 節・7.2 節の④：v1 は通信しない。問い合わせの失敗は無視し、起動・編集・再生に欠かせない経路に置かない <!-- req webcorefoundation:780a25e7.eeb2 --> <!-- req webcorefoundation:780a25e7.0e4a --> <!-- req webcorefoundation:991b5e82.807f --> <!-- req webcorefoundation:991b5e82.72d3 --> <!-- req webcorefoundation:991b5e82.5394 --> <!-- req webcorefoundation:991b5e82.a1ef --> <!-- req webcorefoundation:991b5e82.c680 --> <!-- req webcorefoundation:991b5e82.49f3 -->
 */

/** v1 は「更新なし」の 1 つだけ。 */
export type UpdateCheckResult = { kind: 'none' };

export interface UpdateCheckAdapter {
  // <!-- req webcorefoundation:ffcf2cd9.194f --> <!-- req webcorefoundation:ffcf2cd9.23c7 --> <!-- req webcorefoundation:ffcf2cd9.e6db --> <!-- req webcorefoundation:ffcf2cd9.d7fe -->
  /** 更新があるかを確かめる。失敗しても reject せず、{ kind: 'none' } を返す。 */
  check(): Promise<UpdateCheckResult>;
}
