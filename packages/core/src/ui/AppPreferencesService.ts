/**
 * アプリ全体設定（設定ダイアログ項目 1〜6・8・11 ＋ オンボーディング表示済みフラグ）の読み書き（screens-navigation.md §3.1・§4.6）。
 *
 * `StorageConfigService`（`settings.json`＝ストレージ構成そのもの）とは責務・ファイルを分離し、
 * `{アクティブなストレージルート}/TabApp/preferences.json` に保存する（ストレージ移行のたびに書き換わるべき
 * 情報と、そうでない情報を混在させないため）。`FileSystemAdapter` を注入して使う（web-core-foundation.md §3.2 と同じ
 * 非破壊拡張パターン）。渡す adapter はアクティブルート（`.../TabApp`）を指す（persistence 層の各サービスと同じ前提）。
 */

import { PREFERENCES_FILE } from '../persistence/constants';
import { readJsonFile, writeJsonFile } from '../persistence/jsonIo';
import type { RenderViewMode } from '../rendering';
import type { FileSystemAdapter } from '@riff-line/shared-types';

import {
  DEFAULT_APP_PREFERENCES,
  MAX_TAP_TEMPO_SAMPLE_SIZE,
  MAX_VOLUME,
  MAX_ZOOM_SCALE_PERCENT,
  MIN_TAP_TEMPO_SAMPLE_SIZE,
  MIN_VOLUME,
  MIN_ZOOM_SCALE_PERCENT,
  type AppPreferences,
} from './types';

/** 数値を `[min, max]` に収める。NaN は `fallback` にする。 */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export class AppPreferencesService {
  private readonly adapter: FileSystemAdapter;

  /** @param adapter アクティブストレージルート（`.../TabApp`）を指す FileSystemAdapter。 */
  constructor(adapter: FileSystemAdapter) {
    this.adapter = adapter;
  }

  /**
   * `preferences.json` を読み、欠損・不正値を既定値で補完した `AppPreferences` を返す（screens-navigation.md §3.1）。
   * ファイル未作成時（初回起動・オンボーディング前）は全項目が既定値（`onboardingSeen: false`）になる。
   * 上限バリデーション（ズーム倍率・タップテンポ感度・音量）は C2 対象（screens-navigation.md §6）。
   */
  async load(): Promise<AppPreferences> {
    // 未保存なら空オブジェクトを土台にし、下の正規化で全項目が既定値に落ちる。
    const raw = await readJsonFile<Partial<AppPreferences>>(this.adapter, PREFERENCES_FILE, {});
    return this.normalize(raw);
  }

  /**
   * `AppPreferences` を正規化してから `preferences.json` へ書き込む（screens-navigation.md §5.4）。
   * 呼び出し元（設定ダイアログ・オンボーディング）は部分更新した全体像を渡す。
   */
  async save(prefs: AppPreferences): Promise<void> {
    await writeJsonFile(this.adapter, PREFERENCES_FILE, this.normalize(prefs));
  }

  /**
   * 未知キーの除去・型不一致の既定値フォールバック・数値の範囲クランプを一括で行う。
   * `load`（外部ファイル由来の信頼できない入力）と `save`（呼び出し元の作り間違い防止）の両方で通す。
   */
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
      onboardingSeen: raw.onboardingSeen === true,
    };
  }
}
