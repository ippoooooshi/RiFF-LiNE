/**
 * 曲のファイルのスキーマの版の移行（data-model-persistence.md 8 節、基本設計 02 章 4.2 節）。
 *
 * - 版を調べる前にファイルの形を確かめる。いちばん上がオブジェクトでない・`schemaVersion` が空でない文字列でない
 *   ときは壊れたファイルとして `CorruptSongFileError` を投げ、Critical の `FILE-008` を出す（JSON として読めないときは
 *   `SongRepository.load` が受け持つ）。
 * - 今の版より古ければ、`register(from, to, fn)` で足した 1 版ずつの変換の関数を順につないで当てる（`v1→v2→v3`）。
 *   つながらないとき（今より新しい版のとき）だけ `UnsupportedSchemaVersionError` を投げ、Critical の `FILE-004` を出す。
 * - 新しい項目は省いてよい項目として足し、読むときに既定の値で補う。`settings` の `explicitTimeSignatureBars`・
 *   `partPresetIds` は data-model-persistence.md 6.4 節の補い方で補う。
 */

import { CURRENT_SCHEMA_VERSION, createEmptyAppMetadata } from '../domain/SongDocument';
import type { AppMetadata, SongFileJson } from '../domain/types';
import { notificationCenter } from '../errors';

import { CorruptSongFileError, UnsupportedSchemaVersionError } from './errors';
import type { CorruptSongFileReason } from './errors';

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

/**
 * alphaTab の `JsonConverter` は項目の名前を小文字にしてから読む（alphaTab 1.8.4 の `*Serializer.fromJson` の
 * `k.toLowerCase()`）ので、`song` の中の項目も同じく大小を問わずに引く。同じ名前が 2 つあれば後のものを採る。
 */
function readField(obj: Record<string, unknown>, lowerName: string): unknown {
  let value: unknown;
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lowerName) value = obj[key];
  }
  return value;
}

/** `song` の中の配列の項目（`masterbars`・`tracks`）。配列でなければ空の並び。 */
function readArrayField(song: unknown, lowerName: string): unknown[] {
  if (!isRecord(song)) return [];
  const value = readField(song, lowerName);
  return Array.isArray(value) ? value : [];
}

/** alphaTab の `MasterBar` の拍子の初めの値（4/4）。曲のファイルに無い項目は、alphaTab が読むときと同じくこの値とみなす。 */
const DEFAULT_TIME_SIGNATURE_PART = 4;

function readTimeSignaturePart(masterBar: unknown, lowerName: string): number {
  const value = isRecord(masterBar) ? readField(masterBar, lowerName) : undefined;
  return typeof value === 'number' ? value : DEFAULT_TIME_SIGNATURE_PART;
}

/**
 * 曲のファイルに `explicitTimeSignatureBars` が無いときの補い方（data-model-persistence.md 6.4 節）：
 * 1 小節目と、`MasterBar` の拍子の値（分子・分母）が直前の小節と違う小節を、小さい順に入れる。
 * 空の一覧として読むと、前の版で途中の小節に入れた拍子が「継ぐ」と読まれてしまうため。小節が 1 つも無ければ空の一覧。
 */
export function deriveExplicitTimeSignatureBars(song: unknown): number[] {
  const masterBars = readArrayField(song, 'masterbars');
  const bars: number[] = [];
  let previousNumerator = Number.NaN;
  let previousDenominator = Number.NaN;
  for (let index = 0; index < masterBars.length; index++) {
    const numerator = readTimeSignaturePart(masterBars[index], 'timesignaturenumerator');
    const denominator = readTimeSignaturePart(masterBars[index], 'timesignaturedenominator');
    // 1 小節目は直前が無い（NaN はどの値とも等しくない）ので、いつも入る
    // <!-- req datamodelpersistence:a3ffb6a6.40a0 --> <!-- req datamodelpersistence:a3ffb6a6.d32f -->
    if (numerator !== previousNumerator || denominator !== previousDenominator) bars.push(index);
    previousNumerator = numerator;
    previousDenominator = denominator;
  }
  return bars;
}

/** 曲のファイルに `partPresetIds` が無いときの補い方（data-model-persistence.md 6.4 節）：パートの数だけ `null` を並べる。 */
export function derivePartPresetIds(song: unknown): (string | null)[] {
  // <!-- req datamodelpersistence:a3ffb6a6.ec23 -->
  return readArrayField(song, 'tracks').map(() => null);
}

/**
 * `settings` の省いてよい 2 つの項目（data-model-persistence.md 6.4 節）を、曲のファイルに在ればそのまま、
 * 無ければ 6.4 節の補い方で作って返す。
 */
// <!-- req datamodelpersistence:a3ffb6a6.b376 --> <!-- req datamodelpersistence:9fc52364.ba50 --> <!-- req datamodelpersistence:f4efdb00.3735 -->
function fillOmittedSettings(
  settings: Record<string, unknown>,
  song: unknown,
): { explicitTimeSignatureBars: number[]; partPresetIds: (string | null)[] } {
  return {
    // <!-- req datamodelpersistence:f61be00a.ec1b -->
    explicitTimeSignatureBars: Array.isArray(settings['explicitTimeSignatureBars'])
      ? (settings['explicitTimeSignatureBars'] as number[])
      : deriveExplicitTimeSignatureBars(song),
    // <!-- req datamodelpersistence:f61be00a.66c7 -->
    partPresetIds: Array.isArray(settings['partPresetIds'])
      ? (settings['partPresetIds'] as (string | null)[])
      : derivePartPresetIds(song),
  };
}

/** `1.0.0` から `1.1.0` へ（data-model-persistence.md 8 節）。`settings` に省いてよい 2 つの項目を 6.4 節の補い方で足す。 */
// <!-- req datamodelpersistence:a3ffb6a6.0a84 -->
function migrate_1_0_0_to_1_1_0(json: unknown): unknown {
  // 形の確かめ（checkShape）を通った後に呼ばれるので、いちばん上はオブジェクト
  const obj = json as Record<string, unknown>;
  const appMeta = isRecord(obj['appMeta']) ? obj['appMeta'] : {};
  const settings = isRecord(appMeta['settings']) ? appMeta['settings'] : {};
  return {
    // <!-- req datamodelpersistence:9fc52364.dea6 --> <!-- req datamodelpersistence:9fc52364.00d5 -->
    ...obj,
    schemaVersion: '1.1.0',
    appMeta: { ...appMeta, settings: { ...settings, ...fillOmittedSettings(settings, obj['song']) } },
  };
}

// <!-- req datamodelpersistence:28f8323b.ebb1 --> <!-- req datamodelpersistence:7d41877b.8b21 -->
export class SchemaMigrator {
  /** fromVersion → 1 段の変換ステップ。 */
  private readonly steps = new Map<string, MigrationStep>();

  /** アプリが持つ 1 版ずつの変換の関数を登録しておく（data-model-persistence.md 8 節の `1.0.0` → `1.1.0`）。 */
  constructor() {
    this.register('1.0.0', '1.1.0', migrate_1_0_0_to_1_1_0);
  }

  /**
   * `fromVersion` から `toVersion` への 1 段の変換関数を登録する。
   * 同じ `fromVersion` に対する二重登録は後勝ち（テスト・拡張時の差し替えを許す）。
   */
  // <!-- req datamodelpersistence:0fbf55d1.0e1a -->
  register(fromVersion: string, toVersion: string, fn: MigrationFn): void {
    this.steps.set(fromVersion, { toVersion, fn });
  }

  /**
   * 版を調べる前の形の確かめ（data-model-persistence.md 8 節の (2)(3)）。形が正しければ `schemaVersion` を返す。
   * @throws CorruptSongFileError いちばん上がオブジェクトでない、または `schemaVersion` が空でない文字列でない（`FILE-008` を出す）。
   */
  checkShape(json: unknown): string {
    // <!-- req datamodelpersistence:4619cb61.bdcd -->
    if (!isRecord(json)) throw this.failCorrupt('not-object');
    const rawVersion = json['schemaVersion'];
    // <!-- req datamodelpersistence:4619cb61.e29f -->
    if (typeof rawVersion !== 'string' || rawVersion.length === 0) throw this.failCorrupt('invalid-schema-version');
    return rawVersion;
  }

  /** `schemaVersion` が今の版より古く、変換が要るか（data-model-persistence.md 8 節）。 */
  // <!-- req datamodelpersistence:04633196.5e16 -->
  // <!-- req datamodelpersistence:0546cb24.fea8 -->
  needsMigration(schemaVersion: string, currentAppSchemaVersion: string = CURRENT_SCHEMA_VERSION): boolean {
    return compareSemver(schemaVersion, currentAppSchemaVersion) < 0;
  }

  /**
   * `json` を現行スキーマバージョンまで移行し、欠損フィールドを補って返す。
   * @param json 生の（パース済み）ファイル内容。
   * @param currentAppSchemaVersion 現行のアプリスキーマバージョン（既定は CURRENT_SCHEMA_VERSION）。
   * @throws CorruptSongFileError 形が壊れている（`FILE-008`）。
   * @throws UnsupportedSchemaVersionError 今の版へ移す変換の関数がつながらない（`FILE-004`）。
   */
  migrate(json: unknown, currentAppSchemaVersion: string = CURRENT_SCHEMA_VERSION): SongFileJson {
    // <!-- req datamodelpersistence:4619cb61.6251 --> <!-- req datamodelpersistence:4619cb61.7402 --> <!-- req datamodelpersistence:4619cb61.992f -->
    const rawVersion = this.checkShape(json);

    // ファイル側が現行より新しい＝このアプリでは開けない。
    if (compareSemver(rawVersion, currentAppSchemaVersion) > 0) {
      // <!-- req datamodelpersistence:4619cb61.e14a -->
      throw this.failUnsupported(rawVersion, currentAppSchemaVersion);
    }

    let working: unknown = json;
    let version = rawVersion;
    // 無限ループ保険：登録ステップ数を上限とする。
    let guard = this.steps.size + 1;

    // <!-- req datamodelpersistence:0fbf55d1.d533 -->
    while (this.needsMigration(version, currentAppSchemaVersion)) {
      const step = this.steps.get(version);
      if (!step) {
        throw this.failUnsupported(version, currentAppSchemaVersion);
      }
      // <!-- req datamodelpersistence:0fbf55d1.233b -->
      working = step.fn(working);
      version = step.toVersion;
      if (--guard < 0) {
        throw this.failUnsupported(rawVersion, currentAppSchemaVersion);
      }
    }

    return normalizeToFileJson(working, currentAppSchemaVersion);
  }

  /** `CorruptSongFileError` を組み立てて返す。あわせて Critical の `FILE-008` を出す（data-model-persistence.md 8 節）。 */
  private failCorrupt(reason: CorruptSongFileReason): CorruptSongFileError {
    // <!-- req datamodelpersistence:4619cb61.50e1 -->
    notificationCenter.report('FILE-008', { reason });
    // <!-- req datamodelpersistence:4619cb61.e4c4 -->
    return new CorruptSongFileError(reason);
  }

  /**
   * `UnsupportedSchemaVersionError` を組み立てて返す。あわせて FILE-004（Critical）を発行する
   * （error-logging-foundation.md 9.2 節：`UnsupportedSchemaVersionError` の伝播を `report()` へ置き換える。
   * 呼び出し元は制御フローのために引き続き throw された型付きエラーを受け取る）。
   */
  private failUnsupported(fromVersion: string, toVersion: string): UnsupportedSchemaVersionError {
    // <!-- req datamodelpersistence:4619cb61.60de -->
    notificationCenter.report('FILE-004', { fromVersion, toVersion });
    return new UnsupportedSchemaVersionError(fromVersion, toVersion);
  }
}

/**
 * マイグレーション後のオブジェクトを SongFileJson へ正規化する（欠損の既定値補完）。
 * `song` はそのまま通す（alphaTab がパースする責務）。`settings` の 2 つの項目は 6.4 節の補い方で補う。
 */
// <!-- req datamodelpersistence:9fc52364.b50e --> <!-- req datamodelpersistence:f4efdb00.4568 -->
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
      // data-model-persistence.md 6.4 節：曲のファイルに無ければ、1 小節目と拍子の値が直前の小節と違う小節・パートの数だけの null で補う
      // <!-- req datamodelpersistence:a3ffb6a6.5680 -->
      ...fillOmittedSettings(settingsRaw, obj['song']),
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
