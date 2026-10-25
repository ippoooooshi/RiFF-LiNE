// UT-FS-RETRY: `retryOnEmptyRead`（オンデマンドDL対策、A5）
// 検証節: data-model-persistence.md §6
// UT: data-model-persistence.md §6 — onDemandRetry (retryOnEmptyRead)
// 検証観点: 空データでのバックオフ再試行、途中で実体化したら返す、枯渇で throw（C0/C1）。

import { describe, expect, it, vi } from 'vitest';

import { ONDEMAND_RETRY_BACKOFF_MS, retryOnEmptyRead } from './onDemandRetry';

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
});
