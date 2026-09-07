/**
 * 保存内容の完全性検証チェックサム（data-model-persistence.md §3.2 `ChecksumUtil`・§9.2）。
 *
 * ハッシュ対象は `{schemaVersion, song, appMeta}` を **決定的な鍵順序**で JSON 文字列化した
 * UTF-8 バイト列（`integrity` ブロック自身は含めない）。sha256 は同期実装（sha256.ts）を使う。
 */

import { sha256Hex } from './sha256';
import type { AppMetadataJson } from './types';

/**
 * 決定的な JSON 文字列化：オブジェクトのキーを辞書順に並べ、配列順は保持する。
 * `JSON.stringify` は挿入順に依存するため、保存のたびにキー順が揺れると
 * 同一内容でもチェックサムが変わってしまう。それを防ぐための正規化。
 * `undefined` はキーごと省略（JSON.stringify と同じ）。関数・シンボルは扱わない（Score JSON には現れない）。
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

/**
 * `{schemaVersion, song, appMeta}` のチェックサムを `sha256:<hex>` 形式で返す。
 * @param schemaVersion スキーマバージョン文字列。
 * @param song Score の JSON 表現（プレーン値）。
 * @param appMeta 付随情報。
 */
export function computeChecksum(schemaVersion: string, song: unknown, appMeta: AppMetadataJson): string {
  const canonical = canonicalJsonStringify({ appMeta, schemaVersion, song });
  const bytes = new TextEncoder().encode(canonical);
  return `sha256:${sha256Hex(bytes)}`;
}
