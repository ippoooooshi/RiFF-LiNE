/**
 * 曲のファイルのスキーマの版の移行（data-model-persistence.md 8 節、基本設計 02 章 4.2 節）。
 *
 * - 版を調べる前にファイルの形を確かめる。いちばん上がオブジェクトでない・`schemaVersion` が空でない文字列でない
 *   ときは壊れたファイルとして `CorruptSongFileError` を投げ、Critical の `FILE-008` を出す（JSON として読めないときは
 *   `SongRepository.load` が受け持つ）。
 * - 変換の要否は版の 1 つ目の数（major）だけで見分ける（8 節の (b) の版の上げ方、2026-10-27 本人決定、honnin-queue 211 番）。
 *   - 1 つ目の数が今の版より大きい → 今の版へ移せないので `UnsupportedSchemaVersionError` を投げ、Critical の `FILE-004` を出す。
 *   - 1 つ目の数が今の版より小さい → `register(from, to, fn)` で足した 1 版ずつの変換の関数を順につないで当てる（`v1→v2→v3`）。
 *     つながらないときも `FILE-004`。
 *   - 1 つ目の数が同じ → 2 つ目の数が小さくても大きくても変換の関数を使わず、読むときの整え（`normalizeToFileJson`）だけで開く。
 * - 新しい項目は省いてよい項目として足し、読むときに既定の値で補う。`settings` の `explicitTimeSignatureBars`・
 *   `partPresetIds` は data-model-persistence.md 6.4 節の補い方で補う（読むときの整えで補い、変換の関数は使わない）。
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

/**
 * 版の 1 つ目の数（major。`"1.2.3"` なら 1）。数でなければ 0 に倒す。
 * 変換の要否はこれだけで見分ける（data-model-persistence.md 8 節の (b)）。
 */
function majorOf(version: string): number {
  return Number.parseInt(version.split('.')[0]!, 10) || 0;
}

/**
 * 版の 2 つ目の数（minor。`"1.2.3"` なら 2）。無い・数でなければ 0 に倒す。
 * 2 つ目の数が今の版より大きい曲を読むだけで開くかを見分けるのに使う（data-model-persistence.md 8 節、honnin-queue 213 番）。
 */
function minorOf(version: string): number {
  return Number.parseInt(version.split('.')[1] ?? '', 10) || 0;
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
    // <!-- req datamodelpersistence:59aa9796.40a0 --> <!-- req datamodelpersistence:59aa9796.d32f -->
    if (numerator !== previousNumerator || denominator !== previousDenominator) bars.push(index);
    previousNumerator = numerator;
    previousDenominator = denominator;
  }
  return bars;
}

/** 曲のファイルに `partPresetIds` が無いときの補い方（data-model-persistence.md 6.4 節）：パートの数だけ `null` を並べる。 */
export function derivePartPresetIds(song: unknown): (string | null)[] {
  // <!-- req datamodelpersistence:59aa9796.ec23 -->
  return readArrayField(song, 'tracks').map(() => null);
}

/**
 * `settings` の省いてよい 2 つの項目（data-model-persistence.md 6.4 節）を、曲のファイルに在ればそのまま、
 * 無ければ 6.4 節の補い方で作って返す。
 */
// <!-- req datamodelpersistence:59aa9796.b376 --> <!-- req datamodelpersistence:9fc52364.ba50 --> <!-- req datamodelpersistence:f4efdb00.3735 -->
function fillOmittedSettings(
  settings: Record<string, unknown>,
  song: unknown,
): { explicitTimeSignatureBars: number[]; partPresetIds: (string | null)[] } {
  return {
    // <!-- req datamodelpersistence:f61be00a.ec1b -->
    // <!-- req datamodelpersistence:59aa9796.0a84 -->
    explicitTimeSignatureBars: Array.isArray(settings['explicitTimeSignatureBars'])
      ? (settings['explicitTimeSignatureBars'] as number[])
      : deriveExplicitTimeSignatureBars(song),
    // <!-- req datamodelpersistence:f61be00a.66c7 -->
    partPresetIds: Array.isArray(settings['partPresetIds'])
      ? (settings['partPresetIds'] as (string | null)[])
      : derivePartPresetIds(song),
  };
}

// <!-- req datamodelpersistence:28f8323b.ebb1 --> <!-- req datamodelpersistence:7d41877b.8b21 -->
export class SchemaMigrator {
  /**
   * fromVersion → 1 段の変換ステップ。アプリが今持つ変換の関数は無い（今の版 `1.1.0` は 2 つ目の数を上げた版で、
   * `1.0.0` の曲は読むときの整えで 6.4 節の補い方をして開く。data-model-persistence.md 8 節、honnin-queue 211 番）。
   * 1 つ目の数を上げるときに、ここへ `register` で足す。
   */
  // <!-- req datamodelpersistence:59aa9796.9192 -->
  private readonly steps = new Map<string, MigrationStep>();

  /**
   * `fromVersion` から `toVersion` への 1 段の変換関数を登録する。
   * 同じ `fromVersion` に対する二重登録は後勝ち（テスト・拡張時の差し替えを許す）。
   */
  // <!-- req datamodelpersistence:819af376.0e1a -->
  register(fromVersion: string, toVersion: string, fn: MigrationFn): void {
    this.steps.set(fromVersion, { toVersion, fn });
  }

  /**
   * 版を調べる前の形の確かめ（data-model-persistence.md 8 節の (2)(3)）。形が正しければ `schemaVersion` を返す。
   * @throws CorruptSongFileError いちばん上がオブジェクトでない、または `schemaVersion` が空でない文字列でない（`FILE-008` を出す）。
   */
  checkShape(json: unknown): string {
    // <!-- req datamodelpersistence:7944390e.bdcd -->
    if (!isRecord(json)) throw this.failCorrupt('not-object');
    const rawVersion = json['schemaVersion'];
    // <!-- req datamodelpersistence:7944390e.e29f -->
    if (typeof rawVersion !== 'string' || rawVersion.length === 0) throw this.failCorrupt('invalid-schema-version');
    return rawVersion;
  }

  /**
   * 変換の関数が要るか＝`schemaVersion` の 1 つ目の数が今の版より小さいか（data-model-persistence.md 8 節）。
   * 1 つ目の数が同じなら、2 つ目の数が小さくても変換は要らない（読むときの整えで補う）。
   * `SongRepository.load` は、これが true のときだけ変換する前の版を `PreMigration/` へ写す。
   */
  // <!-- req datamodelpersistence:04633196.5e16 -->
  // <!-- req datamodelpersistence:0546cb24.fea8 -->
  needsMigration(schemaVersion: string, currentAppSchemaVersion: string = CURRENT_SCHEMA_VERSION): boolean {
    // <!-- req datamodelpersistence:819af376.8a68 -->
    return majorOf(schemaVersion) < majorOf(currentAppSchemaVersion);
  }

  /**
   * 1 つ目の数が今の版と同じで、2 つ目の数が今の版より大きいか（data-model-persistence.md 8 節、2026-10-27 本人決定、honnin-queue 213 番）。
   * true の曲は、このアプリが知らない項目を持ちうるので、読むだけ（編集も自動保存もしない）で開く。
   * `SongRepository.load` は、これが true の曲の id を覚える（`SongRepository.isNewerVersion`）。
   * 1 つ目の数が今の版より大きい曲は `migrate` が `FILE-004` で止めるので、ここでは false。
   */
  isNewerMinorVersion(schemaVersion: string, currentAppSchemaVersion: string = CURRENT_SCHEMA_VERSION): boolean {
    return (
      majorOf(schemaVersion) === majorOf(currentAppSchemaVersion) &&
      minorOf(schemaVersion) > minorOf(currentAppSchemaVersion)
    );
  }

  /**
   * `json` を今の版で開ける形にして返す（data-model-persistence.md 8 節）。
   * 1 つ目の数が今の版より小さければ 1 版ずつの変換の関数を順につないで当て、1 つ目の数が同じなら変換の関数を使わない。
   * どちらも最後に読むときの整え（6.4 節の補い方と、欠けた項目の既定の値）をし、`schemaVersion` を今の版にする。
   * @param json 生の（パース済み）ファイル内容。
   * @param currentAppSchemaVersion 現行のアプリスキーマバージョン（既定は CURRENT_SCHEMA_VERSION）。
   * @throws CorruptSongFileError 形が壊れている（`FILE-008`）。
   * @throws UnsupportedSchemaVersionError 1 つ目の数が今の版より大きい、または変換の関数がつながらない（`FILE-004`）。
   */
  migrate(json: unknown, currentAppSchemaVersion: string = CURRENT_SCHEMA_VERSION): SongFileJson {
    // <!-- req datamodelpersistence:7944390e.6251 --> <!-- req datamodelpersistence:7944390e.7402 --> <!-- req datamodelpersistence:7944390e.992f -->
    const rawVersion = this.checkShape(json);
    const currentMajor = majorOf(currentAppSchemaVersion);

    // 1 つ目の数がファイルのほうが大きい＝前と合わない変更の後の版なので、このアプリでは開けない。
    // 1 つ目の数が同じなら、2 つ目の数が大きくてもここでは止めない（前と合う足し方なので、読むときの整えで開く）。
    // <!-- req datamodelpersistence:819af376.6805 -->
    // <!-- req datamodelpersistence:7944390e.772a -->
    if (majorOf(rawVersion) > currentMajor) {
      throw this.failUnsupported(rawVersion, currentAppSchemaVersion);
    }

    let working: unknown = json;
    let version = rawVersion;
    // 無限ループ保険：登録ステップ数を上限とする。
    let guard = this.steps.size + 1;

    // 1 つ目の数が今の版より小さいあいだだけ、1 版ずつの変換の関数を順につなぐ
    // <!-- req datamodelpersistence:819af376.ef5d -->
    while (this.needsMigration(version, currentAppSchemaVersion)) {
      const step = this.steps.get(version);
      if (!step) {
        // <!-- req datamodelpersistence:7944390e.d828 -->
        throw this.failUnsupported(version, currentAppSchemaVersion);
      }
      // <!-- req datamodelpersistence:819af376.233b -->
      working = step.fn(working);
      version = step.toVersion;
      if (--guard < 0) {
        throw this.failUnsupported(rawVersion, currentAppSchemaVersion);
      }
    }

    // 変換の関数が今の版の 1 つ目の数を飛び越えた＝今の版へはつながらない
    if (majorOf(version) > currentMajor) {
      throw this.failUnsupported(rawVersion, currentAppSchemaVersion);
    }

    // <!-- req datamodelpersistence:819af376.b520 -->
    return normalizeToFileJson(working, currentAppSchemaVersion);
  }

  /** `CorruptSongFileError` を組み立てて返す。あわせて Critical の `FILE-008` を出す（data-model-persistence.md 8 節）。 */
  private failCorrupt(reason: CorruptSongFileReason): CorruptSongFileError {
    // <!-- req datamodelpersistence:7944390e.50e1 -->
    notificationCenter.report('FILE-008', { reason });
    // <!-- req datamodelpersistence:7944390e.e4c4 -->
    return new CorruptSongFileError(reason);
  }

  /**
   * `UnsupportedSchemaVersionError` を組み立てて返す。あわせて FILE-004（Critical）を発行する
   * （error-logging-foundation.md 9.2 節：`UnsupportedSchemaVersionError` の伝播を `report()` へ置き換える。
   * 呼び出し元は制御フローのために引き続き throw された型付きエラーを受け取る）。
   */
  private failUnsupported(fromVersion: string, toVersion: string): UnsupportedSchemaVersionError {
    // <!-- req datamodelpersistence:7944390e.60de -->
    // <!-- req datamodelpersistence:8db5ad15.fed6 -->
    notificationCenter.report('FILE-004', { fromVersion, toVersion });
    // <!-- req datamodelpersistence:7944390e.7d8b -->
    return new UnsupportedSchemaVersionError(fromVersion, toVersion);
  }
}

/**
 * 読むときの整え：変換の後（または変換の要らない曲）のオブジェクトを SongFileJson へ正規化する（欠損の既定値補完）。
 * `song` はそのまま通す（alphaTab がパースする責務）。`settings` の 2 つの項目は 6.4 節の補い方で補う
 * （1 つ目の数が同じ `1.0.0` の曲も、変換の関数を使わずにここで補う。data-model-persistence.md 6.4 節・8 節）。
 * `schemaVersion` は今の版にし、知らない項目は持ち越さない。2 つ目の数が今の版より大きい曲は、読むだけで開き、
 * `SongRepository.allowEditing` の後に保存したときだけ、知らない項目が消え版の数が今の版になる
 * （data-model-persistence.md 8 節、2026-10-27 本人決定、honnin-queue 213 番）。
 */
// <!-- req datamodelpersistence:9fc52364.b50e --> <!-- req datamodelpersistence:f4efdb00.4568 -->
// <!-- req datamodelpersistence:59aa9796.7dff -->
// <!-- req datamodelpersistence:9fc52364.dea6 -->
// <!-- req datamodelpersistence:9fc52364.00d5 -->
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
      // <!-- req datamodelpersistence:59aa9796.5680 -->
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
