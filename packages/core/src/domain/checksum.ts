/**
 * 曲のファイルの `integrity.checksum` を作る（data-model-persistence.md 7 節）。
 *
 * アトミック書き込みで書いたファイルを確かめるためと、落ちたあとの立ち直りで壊れたファイルを見つけるために付ける
 * （確かめる流れは data-model-persistence.md 15 節）。
 * ハッシュをかける対象は `integrity` を除いた `{schemaVersion, song, appMeta}` で、鍵の順をそろえて JSON の文字列にした
 * UTF-8 のバイト列。ハッシュの種類は SHA-256（同期で求める。sha256.ts）、値は `sha256:` で始まる文字列。
 */

import { sha256Hex } from './sha256';
import type { AppMetadataJson } from './types';

/**
 * 鍵の順をそろえた JSON の文字列にする：オブジェクトの鍵を辞書順に並べ、配列の順はそのまま残す。
 * `JSON.stringify` は足した順に並べるので、保存のたびに鍵の順が揺れると、同じ中身でもチェックサムが変わってしまう。それを防ぐ。
 * `undefined` の項目は鍵ごと省き、配列の中の `undefined` は null にする（JSON.stringify と同じ）。関数とシンボルは扱わない（Score の JSON には出てこない）。
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v === undefined ? null : v)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const child = record[key];
    if (child === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJsonStringify(child)}`);
  }
  return `{${parts.join(',')}}`;
}

// data-model-persistence.md 7 節：checksum の値は checksum.ts が作る <!-- req datamodelpersistence:f25f3192.06da -->
/**
 * `{schemaVersion, song, appMeta}` のチェックサムを `sha256:<16 進 64 桁>` の形で返す（data-model-persistence.md 7 節）。
 * `id`・`createdAt`・`integrity` はハッシュをかける対象に入れない。
 * @param schemaVersion 曲のファイルの形の版。
 * @param song Score を JSON にしたもの。
 * @param appMeta サイドカーのうち曲のファイルに入れるもの。
 */
export function computeChecksum(schemaVersion: string, song: unknown, appMeta: AppMetadataJson): string {
  // data-model-persistence.md 7 節：ハッシュの対象は integrity を除いた {schemaVersion, song, appMeta} <!-- req datamodelpersistence:f25f3192.87a8 -->
  const canonical = canonicalJsonStringify({ appMeta, schemaVersion, song });
  const bytes = new TextEncoder().encode(canonical);
  // data-model-persistence.md 7 節：ハッシュは SHA-256 で、値は sha256: で始まる <!-- req datamodelpersistence:f25f3192.d13d --> <!-- req datamodelpersistence:f25f3192.8b1b -->
  return `sha256:${sha256Hex(bytes)}`;
}
