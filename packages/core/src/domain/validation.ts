/**
 * 上限の定数と、確かめる関数（data-model-persistence.md 6.2 節・6.3 節・9 節、基本設計 02 章 4.3 節、要件 5.3）。
 *
 * 足す・作る操作そのもの（コマンド・画面）は編集コアと画面群のパッケージが受け持つので、
 * ここは定数と、副作用の無い確かめる関数だけを置く。
 */

// data-model-persistence.md 6.2 節：メモ本文の上限 100 文字を定数 MEMO_MAX_LENGTH に置く <!-- req datamodelpersistence:f169e7b5.3175 --> <!-- req datamodelpersistence:f169e7b5.8b0f --> <!-- req datamodelpersistence:f169e7b5.7140 -->
/** 小節メモの本文の文字数の上限（data-model-persistence.md 6.2 節、基本設計 13 章 C13）。 */
export const MEMO_MAX_LENGTH = 100;

// data-model-persistence.md 6.3 節：タグの総数の上限は 50 <!-- req datamodelpersistence:1e2f61e1.bce9 -->
/** タグの総数の上限。超えたら作らずに TAG-001（Error）を出す（data-model-persistence.md 6.3 節）。 */
export const TAG_COUNT_LIMIT = 50;

/** 曲の数の上限（data-model-persistence.md 9 節、基本設計 13 章 C12・SONG-002）。 */
export const SONG_COUNT_LIMIT = 1000;

/** 曲の数の予告のしきい値（上限の 90%、SONG-001。拒否は伴わない。data-model-persistence.md 9 節）。 */
export const SONG_COUNT_WARN_THRESHOLD = Math.floor(SONG_COUNT_LIMIT * 0.9);

// data-model-persistence.md 6.2 節：文字数は Intl.Segmenter の書記素で数え、絵文字・改行も 1 文字 <!-- req datamodelpersistence:92d148aa.42a6 --> <!-- req datamodelpersistence:92d148aa.ba57 --> <!-- req datamodelpersistence:92d148aa.1dd7 --> <!-- req datamodelpersistence:92d148aa.f1d2 --> <!-- req datamodelpersistence:92d148aa.7078 --> <!-- req datamodelpersistence:92d148aa.706d -->
/**
 * 見た目の 1 文字（書記素のまとまり）で区切る（data-model-persistence.md 6.2 節）。
 * いくつかの符号位置からできた絵文字も 1 つに、改行の CR と LF の組も 1 つに数える。
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// data-model-persistence.md 6.2 節：clampMemoText は書記素で数え、改行を残す <!-- req datamodelpersistence:92d148aa.f557 --> <!-- req datamodelpersistence:92d148aa.62ad -->
/**
 * 小節メモの本文を、曲のファイルに書く形にする（data-model-persistence.md 6.2 節、基本設計 13 章 C13）。
 * 文字数は `Intl.Segmenter`（`granularity: 'grapheme'`）で区切った数で数え、絵文字も改行も 1 つで 1 文字とする。
 * 入力は止めず、そのメモを確定したときに呼ばれて、上限を超えていれば先頭の MEMO_MAX_LENGTH 文字へ切り詰める。
 * @returns 上限以内ならそのままの `text` と `truncated: false`、超えていれば切り詰めた文字列と `truncated: true`。
 */
export function clampMemoText(text: string): { value: string; truncated: boolean } {
  const graphemes = Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
  if (graphemes.length <= MEMO_MAX_LENGTH) {
    return { value: text, truncated: false };
  }
  return { value: graphemes.slice(0, MEMO_MAX_LENGTH).join(''), truncated: true };
}

/** 曲の数の状態（拒否は SONG-002、予告は SONG-001）。 */
export type SongCountStatus = 'ok' | 'warn' | 'limit';

/**
 * 今の曲の数から、新しく作れるかと予告の要否を決める（data-model-persistence.md 9 節）。
 * @param currentCount 今の曲の数（ゴミ箱を除く）。
 */
export function evaluateSongCount(currentCount: number): SongCountStatus {
  if (currentCount >= SONG_COUNT_LIMIT) return 'limit';
  if (currentCount >= SONG_COUNT_WARN_THRESHOLD) return 'warn';
  return 'ok';
}

// data-model-persistence.md 6.3 節：タグの総数を確かめる関数を TAG_COUNT_LIMIT で置く <!-- req datamodelpersistence:1e2f61e1.f8f7 -->
/**
 * タグを作る前に、もう 1 つ作れるかを確かめる（data-model-persistence.md 6.3 節）。
 * false のとき、呼ぶ側はタグを作らずに TAG-001（Error）を出す。
 * @param currentCount 今のタグの総数。
 */
export function canCreateTag(currentCount: number): boolean {
  return currentCount < TAG_COUNT_LIMIT;
}
