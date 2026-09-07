/**
 * キャパシティ上限とバリデーション（data-model-persistence.md §7、02_data_model.md §4.3、要件5.3）。
 *
 * 実際の追加操作（コマンド層）はタブ譜編集コア／画面群パッケージが担当するため、
 * 本パッケージは「定数」と「純粋なバリデーション関数」だけを提供する。
 */

/** 小節メモの最大文字数（要件5.3「100文字程度」、C13）。 */
export const MEMO_MAX_LENGTH = 100;

/** タグ総数の上限（要件5.3、TAG-001）。 */
export const TAG_COUNT_LIMIT = 50;

/** 曲数の上限（要件5.3、C12・SONG-002）。 */
export const SONG_COUNT_LIMIT = 1000;

/** 曲数警告のしきい値（上限の 90%、SONG-001。拒否は伴わない予告）。 */
export const SONG_COUNT_WARN_THRESHOLD = Math.floor(SONG_COUNT_LIMIT * 0.9);

/**
 * 小節メモ本文を保存可能な形に正規化する（C13）。
 * ユーザーの入力操作自体はブロックしないが、永続化される内容は先頭 MEMO_MAX_LENGTH 文字に切り詰める。
 * @returns `text` が上限以内ならそのまま、超過していれば切り詰めた文字列と `truncated: true`。
 */
export function clampMemoText(text: string): { value: string; truncated: boolean } {
  // Array.from で結合文字を1コードポイント単位ではなくコードポイント単位に数える（絵文字等の分断を避ける）。
  const codePoints = Array.from(text);
  if (codePoints.length <= MEMO_MAX_LENGTH) {
    return { value: text, truncated: false };
  }
  return { value: codePoints.slice(0, MEMO_MAX_LENGTH).join(''), truncated: true };
}

/** 曲数に対する状態判定（拒否は SONG-002、予告警告は SONG-001）。 */
export type SongCountStatus = 'ok' | 'warn' | 'limit';

/**
 * 現在の曲数から、新規作成の可否・警告状態を判定する。
 * @param currentCount 現在のアクティブな曲数（ゴミ箱を除く）。
 */
export function evaluateSongCount(currentCount: number): SongCountStatus {
  if (currentCount >= SONG_COUNT_LIMIT) return 'limit';
  if (currentCount >= SONG_COUNT_WARN_THRESHOLD) return 'warn';
  return 'ok';
}

/**
 * タグ新規作成の可否を判定する（TAG-001）。
 * @param currentCount 現在のタグ総数。
 */
export function canCreateTag(currentCount: number): boolean {
  return currentCount < TAG_COUNT_LIMIT;
}
