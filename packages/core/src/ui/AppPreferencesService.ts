/**
 * アプリ全体設定（`preferences.json`）の読み書き（data-model-persistence.md 13.3 節、screens-navigation.md 6.2 節・12.10 節・14 節）。
 * 持つのは 13.3 節の 4 つのまとまり：設定ダイアログの値・曲一覧の表示方式・曲一覧の並べ替えのキーと向き（`songListSort`）・`onboardingSeen`。
 * 読んだファイルに無い項目は既定の値で補う（古い `preferences.json` もそのまま読む）。
 *
 * `StorageConfigService`（`settings.json`＝ストレージ構成そのもの）とは責務・ファイルを分離し、
 * `{アクティブなストレージルート}/TabApp/preferences.json` に保存する（ストレージ移行のたびに書き換わるべき
 * 情報と、そうでない情報を混在させないため）。`FileSystemAdapter` を注入して使う（web-core-foundation.md 3.1 節の
 * 注入の形）。渡す adapter はアクティブルート（`.../TabApp`）を指す（persistence 層の各サービスと同じ前提）。
 */

import { DEFAULT_TRASH_RETENTION_DAYS, PREFERENCES_FILE } from '../persistence/constants';
import { readJsonFile, writeJsonFile } from '../persistence/jsonIo';
import type { RenderViewMode } from '../rendering';
import type { FileSystemAdapter } from '../platform';

import {
  DEFAULT_APP_PREFERENCES,
  MAX_TAP_TEMPO_SAMPLE_SIZE,
  MAX_VOLUME,
  MAX_ZOOM_SCALE_PERCENT,
  MIN_TAP_TEMPO_SAMPLE_SIZE,
  MIN_VOLUME,
  MIN_ZOOM_SCALE_PERCENT,
  SONG_LIST_SORT_KEYS,
  TRASH_RETENTION_DAY_OPTIONS,
  type AppPreferences,
  type SongListSort,
  type SongListSortKey,
  type TrashRetentionDays,
} from './types';

/** 数値を `[min, max]` に収める。NaN は `fallback` にする。 */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// data-model-persistence.md 13.3 節：5 つの値のどれでもない保持期間は、その値を下回らないいちばん小さい値に読み替え、90 を超えるなら 90、数でなければ 30
/**
 * 読んだゴミ箱の保持期間を 5 つの値のどれかにする。短いほうへ読み替えると、
 * 利用者が思っていたより早く曲が完全に消えるため、いつも長いほうへ寄せる。
 */
// data-model-persistence.md 13.3 節：読んだ trashRetentionDays が 5 つの値のどれでもなければ、下回らないいちばん小さい値に、90 を超えるなら 90 に、数でなければ 30 に読み替える <!-- req datamodelpersistence:5f081703.bac2 --> <!-- req datamodelpersistence:5f081703.9fad --> <!-- req datamodelpersistence:5f081703.b983 --> <!-- req datamodelpersistence:5f081703.e9b3 --> <!-- req datamodelpersistence:5f081703.72df --> <!-- req datamodelpersistence:5f081703.e7d7 -->
function normalizeTrashRetentionDays(value: unknown): TrashRetentionDays {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_TRASH_RETENTION_DAYS;
  const longest = TRASH_RETENTION_DAY_OPTIONS[TRASH_RETENTION_DAY_OPTIONS.length - 1] as TrashRetentionDays;
  return TRASH_RETENTION_DAY_OPTIONS.find((days) => days >= value) ?? longest;
}

/**
 * 読んだ並べ替えを `{ key, direction }` の形にする（data-model-persistence.md 13.3 節の (b)）。
 * キーと向きは 2 つそろって 1 つの並べ方なので、どちらかが読めなければ 2 つとも既定にする（片方だけ古い値を残さない）。
 */
function normalizeSongListSort(value: unknown): SongListSort {
  const fallback = DEFAULT_APP_PREFERENCES.songListSort;
  if (typeof value !== 'object' || value === null) return { ...fallback };
  const { key, direction } = value as { key?: unknown; direction?: unknown };
  const keyOk = (SONG_LIST_SORT_KEYS as readonly unknown[]).includes(key);
  const directionOk = direction === 'asc' || direction === 'desc';
  return keyOk && directionOk ? { key: key as SongListSortKey, direction } : { ...fallback };
}

// data-model-persistence.md 13.3 節：preferences.json はアプリ全体の設定を持ち、AppPreferencesService が読み書きする <!-- req datamodelpersistence:3d9dd43e.4a77 --> <!-- req datamodelpersistence:3d9dd43e.c952 --> <!-- req datamodelpersistence:9b9d539e.98b8 -->
export class AppPreferencesService {
  private readonly adapter: FileSystemAdapter;

  /** @param adapter アクティブストレージルート（`.../TabApp`）を指す FileSystemAdapter。 */
  constructor(adapter: FileSystemAdapter) {
    this.adapter = adapter;
  }

  /**
   * `preferences.json` を読み、欠損・不正値を既定値で補完した `AppPreferences` を返す（data-model-persistence.md 13.3 節）。
   * ファイル未作成時（初回起動・オンボーディング前）は全項目が既定値（`onboardingSeen: false`）になる。
   * 上限バリデーション（ズーム倍率・タップテンポ感度・音量）は C2 対象（作り直す前の screens-navigation.md §6、`2759936` 時点）。
   */
  async load(): Promise<AppPreferences> {
    // 未保存なら空オブジェクトを土台にし、下の正規化で全項目が既定値に落ちる。
    const raw = await readJsonFile<Partial<AppPreferences>>(this.adapter, PREFERENCES_FILE, {});
    return this.normalize(raw);
  }

  /**
   * `AppPreferences` を正規化してから `preferences.json` へ書き込む（data-model-persistence.md 13.3 節）。
   * 呼び出し元（設定ダイアログ・オンボーディング）は部分更新した全体像を渡す。
   */
  async save(prefs: AppPreferences): Promise<void> {
    await writeJsonFile(this.adapter, PREFERENCES_FILE, this.normalize(prefs));
  }

  /**
   * 未知キーの除去・型不一致の既定値フォールバック・数値の範囲クランプを一括で行う。
   * `load`（外部ファイル由来の信頼できない入力）と `save`（呼び出し元の作り間違い防止）の両方で通す。
   */
  // data-model-persistence.md 13.3 節：読んだファイルに無い項目は既定の値で補い、古い preferences.json もそのまま読む <!-- req datamodelpersistence:af935b21.ca2b --> <!-- req datamodelpersistence:af935b21.0b8f -->
  private normalize(raw: Partial<AppPreferences>): AppPreferences {
    const d = DEFAULT_APP_PREFERENCES;
    const zoomIn: Partial<Record<RenderViewMode, unknown>> = raw.zoomScaleByMode ?? {};
    return {
      defaultTuningPresetId: typeof raw.defaultTuningPresetId === 'string' ? raw.defaultTuningPresetId : null,
      defaultInstrumentSoundId: typeof raw.defaultInstrumentSoundId === 'string' ? raw.defaultInstrumentSoundId : null,
      zoomScaleByMode: {
        focus: clampNumber(zoomIn.focus, MIN_ZOOM_SCALE_PERCENT, MAX_ZOOM_SCALE_PERCENT, d.zoomScaleByMode.focus),
        scroll: clampNumber(zoomIn.scroll, MIN_ZOOM_SCALE_PERCENT, MAX_ZOOM_SCALE_PERCENT, d.zoomScaleByMode.scroll),
        score: clampNumber(zoomIn.score, MIN_ZOOM_SCALE_PERCENT, MAX_ZOOM_SCALE_PERCENT, d.zoomScaleByMode.score),
      },
      metronomeVolume: clampNumber(raw.metronomeVolume, MIN_VOLUME, MAX_VOLUME, d.metronomeVolume),
      metronomePresetId:
        raw.metronomePresetId === 'acoustic' ||
        raw.metronomePresetId === 'click' ||
        raw.metronomePresetId === 'wood' ||
        raw.metronomePresetId === 'beep'
          ? raw.metronomePresetId
          : d.metronomePresetId,
      countInMeasureMultiplier: raw.countInMeasureMultiplier === 2 ? 2 : 1,
      tapTempoSampleSize: Math.round(
        clampNumber(raw.tapTempoSampleSize, MIN_TAP_TEMPO_SAMPLE_SIZE, MAX_TAP_TEMPO_SAMPLE_SIZE, d.tapTempoSampleSize),
      ),
      partDefaultVolume: clampNumber(raw.partDefaultVolume, MIN_VOLUME, MAX_VOLUME, d.partDefaultVolume),
      showAppInfoOnStartup:
        typeof raw.showAppInfoOnStartup === 'boolean' ? raw.showAppInfoOnStartup : d.showAppInfoOnStartup,
      songListLayout: raw.songListLayout === 'list' ? 'list' : 'grid',
      songListSort: normalizeSongListSort(raw.songListSort),
      onboardingSeen: raw.onboardingSeen === true,
      // <!-- req datamodelpersistence:81154086.c43e -->
      trashRetentionDays: normalizeTrashRetentionDays(raw.trashRetentionDays),
    };
  }
}
