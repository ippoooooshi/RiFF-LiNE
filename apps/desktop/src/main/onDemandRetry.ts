/**
 * クラウド同期フォルダのオンデマンドダウンロード対策（data-model-persistence.md §6、A5 関連の暫定実装）。
 *
 * iCloud Drive / Google Drive for Desktop はローカルに実体が無い「プレースホルダーファイル」状態に
 * なりうる。読み込み時に実体化を待つ指数バックオフのリトライを挟む。A5 の実機検証で調整可能なよう定数化。
 * `FileSystemAdapter` インターフェース自体にはリトライの存在を露出させない（呼び出し側は通常の readFile として扱う）。
 */

/** 指数バックオフ間隔（ms）。合計約 6.2 秒、最大 5 回リトライ（data-model-persistence.md §6 の表）。 */
export const ONDEMAND_RETRY_BACKOFF_MS: readonly number[] = [200, 400, 800, 1600, 3200];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `read` を実行し、空データ（プレースホルダー実体化待ちの疑い）が返る間はバックオフしてリトライする。
 * リトライ上限まで空のままなら Error を投げる（呼び出し元＝readFile が FileReadError へ正規化する）。
 *
 * @param read 1 回分の読み取り。
 * @param options.backoffMs バックオフ間隔（既定 ONDEMAND_RETRY_BACKOFF_MS）。
 * @param options.wait 待機関数（テスト用に差し替え可能。既定は setTimeout ベース）。
 */
export async function retryOnEmptyRead(
  read: () => Promise<Uint8Array>,
  options?: { backoffMs?: readonly number[]; wait?: (ms: number) => Promise<void> },
): Promise<Uint8Array> {
  const backoff = options?.backoffMs ?? ONDEMAND_RETRY_BACKOFF_MS;
  const wait = options?.wait ?? sleep;

  let data = await read();
  for (let attempt = 0; data.length === 0 && attempt < backoff.length; attempt++) {
    await wait(backoff[attempt]!);
    data = await read();
  }

  if (data.length === 0) {
    throw new Error('On-demand download did not materialize after retries (placeholder file suspected).');
  }
  return data;
}
