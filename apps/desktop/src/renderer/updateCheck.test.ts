// UT-UPDATE-CHECK: 更新の確認の v1 のダミー（noUpdateCheckAdapter）と、起動の後に 1 回だけ check を呼ぶ関数（runUpdateCheckOnce）
// 検証節: web-core-foundation.md 13.3 節 <!-- req webcorefoundation:abaa6ed5.4109 --> <!-- req webcorefoundation:abaa6ed5.9859 --> <!-- req webcorefoundation:abaa6ed5.33d3 --> <!-- req webcorefoundation:02b66237.b32a -->
// 検証観点: ダミーは通信せず「更新なし」を返すこと、呼ぶのはレンダラーごとに 1 回だけであること、差し替えた実装の失敗で投げないこと（C0/C1）。
// runUpdateCheckOnce は「呼んだか」をモジュールの中に持つので、テストごとに読み込み直して前のテストの印を持ち越さない。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type UpdateCheckModule = typeof import('./updateCheck');

async function loadFresh(): Promise<UpdateCheckModule> {
  vi.resetModules();
  return import('./updateCheck');
}

/** 渡した Promise が片づく（成功・失敗の後の処理が走り切る）まで待つ。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('noUpdateCheckAdapter', () => {
  it('noUpdateCheckAdapter_check_通信せず更新なしを返す', async () => {
    // UT-UPDATE-CHECK-01 web-core-foundation.md 13.3 節：v1 では通信しないダミーの実装。check は { kind: 'none' } を返す
    const { noUpdateCheckAdapter } = await loadFresh();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(noUpdateCheckAdapter.check()).resolves.toEqual({ kind: 'none' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('noUpdateCheckAdapter_インターフェース_チェックの1段だけを持つ', async () => {
    // UT-UPDATE-CHECK-02 web-core-foundation.md 13.3 節：インターフェースが持つのは「チェック」の 1 段だけ（確認と適用の 2 段は持たせない）
    const { noUpdateCheckAdapter } = await loadFresh();
    expect(Object.keys(noUpdateCheckAdapter)).toEqual(['check']);
  });
});

describe('runUpdateCheckOnce', () => {
  it('runUpdateCheckOnce_引数なし_ダミーのcheckを1回呼ぶ', async () => {
    // UT-UPDATE-CHECK-03 web-core-foundation.md 13.3 節：既定の引数（v1 のダミー）を使い、起動の後に 1 回だけ check を呼ぶ
    const updateCheck = await loadFresh();
    const check = vi.spyOn(updateCheck.noUpdateCheckAdapter, 'check');
    expect(updateCheck.runUpdateCheckOnce()).toBeUndefined();
    await flush();
    expect(check).toHaveBeenCalledTimes(1);
    expect(await check.mock.results[0]!.value).toEqual({ kind: 'none' });
  });

  it('runUpdateCheckOnce_差し替えた実装を渡す_渡した側のcheckを呼びダミーは呼ばない', async () => {
    // UT-UPDATE-CHECK-04 web-core-foundation.md 13.3 節：実際に問い合わせる実装に差し替えたとき、呼ぶ側を変えずに済む
    const updateCheck = await loadFresh();
    const dummy = vi.spyOn(updateCheck.noUpdateCheckAdapter, 'check');
    const replaced = { check: vi.fn(() => Promise.resolve({ kind: 'none' as const })) };
    updateCheck.runUpdateCheckOnce(replaced);
    await flush();
    expect(replaced.check).toHaveBeenCalledTimes(1);
    expect(dummy).not.toHaveBeenCalled();
  });

  it('runUpdateCheckOnce_同じレンダラーで2回目_checkを呼ばない', async () => {
    // UT-UPDATE-CHECK-05 web-core-foundation.md 13.3 節：呼ぶのは起動した後の 1 回。2 回目は別の実装を渡しても呼ばない
    const updateCheck = await loadFresh();
    const first = { check: vi.fn(() => Promise.resolve({ kind: 'none' as const })) };
    const second = { check: vi.fn(() => Promise.resolve({ kind: 'none' as const })) };
    updateCheck.runUpdateCheckOnce(first);
    updateCheck.runUpdateCheckOnce(second);
    updateCheck.runUpdateCheckOnce();
    await flush();
    expect(first.check).toHaveBeenCalledTimes(1);
    expect(second.check).not.toHaveBeenCalled();
  });

  it('runUpdateCheckOnce_差し替えた実装がreject_投げずにrejectを受けて捨てる', async () => {
    // UT-UPDATE-CHECK-06 web-core-foundation.md 13.3 節：更新の確認の失敗で起動を止めない。
    // catch に渡した後の Promise が undefined で成功することで、reject を受けて捨てたことを見る（受けられない reject は Node の環境では実行を失敗にする）
    const updateCheck = await loadFresh();
    const rejected = Promise.reject(new Error('offline'));
    const caught = vi.spyOn(rejected, 'catch');
    const failing = { check: vi.fn(() => rejected) };
    expect(() => updateCheck.runUpdateCheckOnce(failing)).not.toThrow();
    await flush();
    expect(failing.check).toHaveBeenCalledTimes(1);
    expect(caught).toHaveBeenCalledTimes(1);
    await expect(caught.mock.results[0]!.value).resolves.toBeUndefined();
  });
});
