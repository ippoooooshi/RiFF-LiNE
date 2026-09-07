/**
 * 保存内容の完全性検証チェックサム（data-model-persistence.md §3.2・§9.2）。
 *
 * アルゴリズム本体はドメイン層の純粋関数（domain/checksum.ts）にあり、本クラスは
 * 00_reference.md §3.2 の登録簿どおりの窓口（`ChecksumUtil.compute`）を提供する薄いラッパー。
 * `integrity` ブロック自身はハッシュ対象に含めない。
 */

import { computeChecksum } from '../domain/checksum';
import type { AppMetadataJson } from '../domain/types';

export const ChecksumUtil = {
  /**
   * `{schemaVersion, song, appMeta}` の `sha256:<hex>` チェックサムを返す。
   * @param schemaVersion スキーマバージョン文字列。
   * @param song Score の JSON 表現（プレーン値）。
   * @param appMeta 付随情報。
   */
  compute(schemaVersion: string, song: unknown, appMeta: AppMetadataJson): string {
    return computeChecksum(schemaVersion, song, appMeta);
  },
} as const;
