/**
 * 1 曲の集約ルート（data-model-persistence.md §3.1、AD-1）。
 *
 * alphaTab の Score オブジェクトと本アプリ独自の AppMetadata をまとめて保持し、
 * `.tabapp` ファイル（SongFileJson）との相互変換の単位になる。
 * マイグレーションは `fromFileJson` に渡す前に SchemaMigrator が適用済みである前提。
 */

import { model, Settings } from '@coderline/alphatab';

import { computeChecksum } from './checksum';
import type { AppMetadata, SongFileJson } from './types';

/** 本パッケージ時点のスキーマバージョン（02_data_model.md §4.2、セマンティックバージョニング文字列）。 */
export const CURRENT_SCHEMA_VERSION = '1.0.0';

/** 空の AppMetadata（新規曲・移行時のデフォルト補完に使う）。 */
export function createEmptyAppMetadata(): AppMetadata {
  return {
    tags: [],
    memos: [],
    sectionMarkers: [],
    settings: { defaultViewMode: 'focus', mixerSnapshot: null },
    thumbnail: null,
  };
}

/** Score を決定的な JSON 値（プレーンオブジェクト）へ変換する。 */
function serializeScore(score: model.Score): unknown {
  return JSON.parse(model.JsonConverter.scoreToJson(score)) as unknown;
}

/** 決定的な JSON 値から Score を復元する。 */
function deserializeScore(song: unknown): model.Score {
  return model.JsonConverter.jsonToScore(JSON.stringify(song), new Settings());
}

export class SongDocument {
  /** 曲の識別子（UUID）。ファイル名（`songs/{id}.tabapp`）の id を最終的な真実とする。 */
  id: string;
  /** 実行時のドメインモデル（alphaTab）。編集操作はタブ譜編集コアパッケージがここを直接触る。 */
  score: model.Score;
  appMeta: AppMetadata;
  /** このドキュメントのスキーマバージョン。保存時に現行バージョンへ更新される。 */
  schemaVersion: string;
  /** 作成時刻（ISO 8601）。 */
  createdAt: string;

  constructor(params: {
    id: string;
    score: model.Score;
    appMeta: AppMetadata;
    schemaVersion?: string;
    createdAt?: string;
  }) {
    this.id = params.id;
    this.score = params.score;
    this.appMeta = params.appMeta;
    this.schemaVersion = params.schemaVersion ?? CURRENT_SCHEMA_VERSION;
    this.createdAt = params.createdAt ?? new Date().toISOString();
  }

  /**
   * `.tabapp` ファイル形式へシリアライズする。
   * @param savedAtMonotonic 保存時刻（ms）。省略時は現在時刻。integrity.checksum はここで確定する。
   */
  toFileJson(savedAtMonotonic: number = Date.now()): SongFileJson {
    const song = serializeScore(this.score);
    return {
      schemaVersion: this.schemaVersion,
      id: this.id,
      createdAt: this.createdAt,
      song,
      appMeta: this.appMeta,
      integrity: {
        savedAtMonotonic,
        checksum: computeChecksum(this.schemaVersion, song, this.appMeta),
      },
    };
  }

  /**
   * マイグレーション適用済みの SongFileJson から復元する。
   * id はファイル JSON の値を採るが、呼び出し元（SongRepository.load）がファイル名の id で上書きしてよい。
   */
  static fromFileJson(json: SongFileJson): SongDocument {
    return new SongDocument({
      id: json.id,
      score: deserializeScore(json.song),
      appMeta: json.appMeta,
      schemaVersion: json.schemaVersion,
      createdAt: json.createdAt,
    });
  }

  /** 現在の内容の `sha256:<hex>` チェックサム（integrity ブロックを除く、§9.2）。 */
  computeChecksum(): string {
    return computeChecksum(this.schemaVersion, serializeScore(this.score), this.appMeta);
  }
}
