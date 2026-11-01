// UT-FS-RETRY: `retryOnEmptyRead`（オンデマンドDL対策、A5） <!-- req webcorefoundation:59bcd606.3fdf --> <!-- req webcorefoundation:99fd9437.50bb -->
// 検証節: data-model-persistence.md §6
// UT: data-model-persistence.md §6 — onDemandRetry (retryOnEmptyRead)
// 検証観点: 空データでのバックオフ再試行、途中で実体化したら返す、枯渇で throw（C0/C1）。

import { describe, expect, it, vi } from 'vitest';

import { ONDEMAND_RETRY_BACKOFF_MS, OnDemandDownloadExhaustedError, retryOnEmptyRead } from './onDemandRetry';

const empty = new Uint8Array(0);
const data = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('retryOnEmptyRead', () => {
  it('retryOnEmptyRead_FirstReadNonEmpty_ReturnsWithoutWaiting', async () => {
    // UT-FS-RETRY-01
    const wait = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValue(data('ok'));
    const result = await retryOnEmptyRead(read, { wait });
    expect(new TextDecoder().decode(result)).toBe('ok');
    expect(read).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('retryOnEmptyRead_EmptyThenMaterializes_RetriesWithBackoffThenReturns', async () => {
    // UT-FS-RETRY-02
    const wait = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(empty).mockResolvedValueOnce(data('late'));
    const result = await retryOnEmptyRead(read, { wait });
    expect(new TextDecoder().decode(result)).toBe('late');
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map((c) => c[0])).toEqual([ONDEMAND_RETRY_BACKOFF_MS[0], ONDEMAND_RETRY_BACKOFF_MS[1]]);
  });

  it('retryOnEmptyRead_AlwaysEmpty_ExhaustsRetriesThenThrows', async () => {
    // UT-FS-RETRY-03
    const wait = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValue(empty);
    await expect(retryOnEmptyRead(read, { wait })).rejects.toThrow(/did not materialize/i);
    // 初回 + バックオフ回数分。
    expect(read).toHaveBeenCalledTimes(ONDEMAND_RETRY_BACKOFF_MS.length + 1);
    expect(wait).toHaveBeenCalledTimes(ONDEMAND_RETRY_BACKOFF_MS.length);
  });

  it('retryOnEmptyRead_CustomBackoff_Respected', async () => {
    // UT-FS-RETRY-04
    const wait = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValue(empty);
    await expect(retryOnEmptyRead(read, { wait, backoffMs: [10] })).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(10);
  });

  it('retryOnEmptyRead_AlwaysEmpty_ThrowsOnDemandDownloadExhaustedError', async () => {
    // UT-FS-RETRY-05 data-model-persistence.md 16 節：それでも空なら FILE-003 を出す（readFile がほかの読み取り失敗と見分けられる例外）
    const wait = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValue(empty);
    const failure = await retryOnEmptyRead(read, { wait }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OnDemandDownloadExhaustedError);
    expect((failure as Error).name).toBe('OnDemandDownloadExhaustedError');
  });

  it('retryOnEmptyRead_DefaultWait_WaitsBackoffWithTimers', async () => {
    // UT-FS-RETRY-06 data-model-persistence.md 16 節：待ちを渡さなければ既定の間（200ms から）を空けて読み直す
    vi.useFakeTimers();
    try {
      const read = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(data('late'));
      const reading = retryOnEmptyRead(read);
      await vi.advanceTimersByTimeAsync(ONDEMAND_RETRY_BACKOFF_MS[0]! - 1);
      expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(new TextDecoder().decode(await reading)).toBe('late');
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
