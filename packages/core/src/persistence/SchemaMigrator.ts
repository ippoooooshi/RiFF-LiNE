/**
 * スキーマバージョンごとの逐次マイグレーション（data-model-persistence.md §3.2、02_data_model.md §4.2）。
 *
 * `register(from, to, fn)` で 1 段ずつの変換関数を登録し、`migrate(json, current)` が
 * `v1→v2→v3...` と順に適用して現行バージョンの SongFileJson を返す。
 * 経路が無い（未知の将来バージョン等）場合は UnsupportedSchemaVersionError（呼び出し元は Critical=FILE-004）。
 * 到達後は「新フィールドは常にオプショナル＋読み込み時デフォルト補完」（§4.2）に従い欠損を補う。
 */

import { CURRENT_SCHEMA_VERSION, createEmptyAppMetadata } from '../domain/SongDocument';
import type { AppMetadata, SongFileJson } from '../domain/types';
import { notificationCenter } from '../errors';

import { UnsupportedSchemaVersionError } from './errors';

type MigrationFn = (json: unknown) => unknown;

interface MigrationStep {
  toVersion: string;
  fn: MigrationFn;
}

/** `"1.2.3"` → `[1,2,3]`。数値でない要素は 0 に倒す。 */
function parseSemver(version: string): [number, number, number] {
  const parts = version.split('.').map((p) => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** a > b なら正、a < b なら負、等しければ 0。 */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class SchemaMigrator {
  /** fromVersion → 1 段の変換ステップ。 */
  private readonly steps = new Map<string, MigrationStep>();

  /**
   * `fromVersion` から `toVersion` への 1 段の変換関数を登録する。
   * 同じ `fromVersion` に対する二重登録は後勝ち（テスト・拡張時の差し替えを許す）。
   */
  register(fromVersion: string, toVersion: string, fn: MigrationFn): void {
    this.steps.set(fromVersion, { toVersion, fn });
  }

  /**
   * `json` を現行スキーマバージョンまで移行し、欠損フィールドを補って返す。
   * @param json 生の（パース済み）ファイル内容。
   * @param currentAppSchemaVersion 現行のアプリスキーマバージョン（既定は CURRENT_SCHEMA_VERSION）。
   */
  migrate(json: unknown, currentAppSchemaVersion: string = CURRENT_SCHEMA_VERSION): SongFileJson {
    if (!isRecord(json)) {
      throw this.failUnsupported('(not an object)', currentAppSchemaVersion);
    }

    const rawVersion = json['schemaVersion'];
    if (typeof rawVersion !== 'string' || rawVersion.length === 0) {
      throw this.failUnsupported('(missing)', currentAppSchemaVersion);
    }

    // ファイル側が現行より新しい＝このアプリでは開けない。
    if (compareSemver(rawVersion, currentAppSchemaVersion) > 0) {
      throw this.failUnsupported(rawVersion, currentAppSchemaVersion);
    }

    let working: unknown = json;
    let version = rawVersion;
    // 無限ループ保険：登録ステップ数を上限とする。
    let guard = this.steps.size + 1;

    while (compareSemver(version, currentAppSchemaVersion) < 0) {
      const step = this.steps.get(version);
      if (!step) {
        throw this.failUnsupported(version, currentAppSchemaVersion);
      }
      working = step.fn(working);
      version = step.toVersion;
      if (--guard < 0) {
        throw this.failUnsupported(rawVersion, currentAppSchemaVersion);
      }
    }

    return normalizeToFileJson(working, currentAppSchemaVersion);
  }

  /**
   * `UnsupportedSchemaVersionError` を組み立てて返す。あわせて FILE-004（Critical）を発行する
   * （error-logging-foundation.md §9.2：`UnsupportedSchemaVersionError` の伝播を `report()` へ置き換える。
   * 呼び出し元は制御フローのために引き続き throw された型付きエラーを受け取る）。
   */
  private failUnsupported(fromVersion: string, toVersion: string): UnsupportedSchemaVersionError {
    notificationCenter.report('FILE-004', { fromVersion, toVersion });
    return new UnsupportedSchemaVersionError(fromVersion, toVersion);
  }
}

/**
 * マイグレーション後のオブジェクトを SongFileJson へ正規化する（欠損の既定値補完）。
 * `song` はそのまま通す（alphaTab がパースする責務）。
 */
function normalizeToFileJson(value: unknown, schemaVersion: string): SongFileJson {
  const obj = isRecord(value) ? value : {};

  const appMetaRaw = isRecord(obj['appMeta']) ? obj['appMeta'] : {};
  const defaults = createEmptyAppMetadata();
  const settingsRaw = isRecord(appMetaRaw['settings']) ? appMetaRaw['settings'] : {};

  const appMeta: AppMetadata = {
    tags: Array.isArray(appMetaRaw['tags']) ? (appMetaRaw['tags'] as AppMetadata['tags']) : defaults.tags,
    memos: Array.isArray(appMetaRaw['memos']) ? (appMetaRaw['memos'] as AppMetadata['memos']) : defaults.memos,
    sectionMarkers: Array.isArray(appMetaRaw['sectionMarkers'])
      ? (appMetaRaw['sectionMarkers'] as AppMetadata['sectionMarkers'])
      : defaults.sectionMarkers,
    settings: {
      defaultViewMode:
        settingsRaw['defaultViewMode'] === 'focus' ||
        settingsRaw['defaultViewMode'] === 'scroll' ||
        settingsRaw['defaultViewMode'] === 'score'
          ? settingsRaw['defaultViewMode']
          : defaults.settings.defaultViewMode,
      mixerSnapshot: 'mixerSnapshot' in settingsRaw ? settingsRaw['mixerSnapshot'] : defaults.settings.mixerSnapshot,
    },
    thumbnail: isThumbnail(appMetaRaw['thumbnail']) ? appMetaRaw['thumbnail'] : defaults.thumbnail,
  };

  const integrityRaw = isRecord(obj['integrity']) ? obj['integrity'] : {};

  return {
    schemaVersion,
    id: typeof obj['id'] === 'string' ? obj['id'] : '',
    createdAt: typeof obj['createdAt'] === 'string' ? obj['createdAt'] : new Date(0).toISOString(),
    song: obj['song'],
    appMeta,
    integrity: {
      savedAtMonotonic: typeof integrityRaw['savedAtMonotonic'] === 'number' ? integrityRaw['savedAtMonotonic'] : 0,
      checksum: typeof integrityRaw['checksum'] === 'string' ? integrityRaw['checksum'] : '',
    },
  };
}

function isThumbnail(value: unknown): value is AppMetadata['thumbnail'] {
  return isRecord(value) && value['encoding'] === 'base64-png' && typeof value['data'] === 'string';
}
