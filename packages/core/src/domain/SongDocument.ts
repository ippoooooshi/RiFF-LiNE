/**
 * 1 曲を表すクラス（data-model-persistence.md 2 節、基本設計 01 章 AD-1）。
 *
 * 中核は alphaTab の Score をそのまま持つ `score` で、アプリ独自の曲のモデルを別に作らない。
 * サイドカーのうち曲のファイルに入れるものは `appMeta`（AppMetadata）に持ち、Score の外に置く。
 * Score とその下のオブジェクトにはアプリ独自のプロパティを足さない（data-model-persistence.md 2 節）。
 * 曲名は `Score.title`、アーティスト名は `Score.artist` に持つ（data-model-persistence.md 4 節の対応表と 5 節）。
 * 移行は `fromFileJson` に渡す前に SchemaMigrator が済ませている前提（data-model-persistence.md 8 節）。
 */

import { model } from '@coderline/alphatab';

import { computeChecksum } from './checksum';
import type { AppMetadata, SectionMarker, SongFileJson } from './types';

// data-model-persistence.md 5 節：schemaVersion の中身はセマンティックバージョニングの文字列 <!-- req datamodelpersistence:04633196.4133 -->
/**
 * 今の曲のファイルの形の版（セマンティックバージョニングの文字列。data-model-persistence.md 5 節の schemaVersion）。
 * 6.4 節の `settings` に省いてよい 2 つの項目を足したので、2 つ目の数を上げた `1.1.0`（data-model-persistence.md 8 節）。
 * 新しい曲はこの版で作り、古い版の曲は SchemaMigrator が変換して、次の自動保存でこの版で上書きされる。
 */
// <!-- req datamodelpersistence:f61be00a.a4f8 --> <!-- req datamodelpersistence:f61be00a.dc8d --> <!-- req datamodelpersistence:e083e271.2b25 --> <!-- req datamodelpersistence:e083e271.d239 --> <!-- req datamodelpersistence:0546cb24.6ca7 --> <!-- req datamodelpersistence:0546cb24.3af4 --> <!-- req datamodelpersistence:7d41877b.3e1b -->
// <!-- req datamodelpersistence:0546cb24.ee1a --> <!-- req datamodelpersistence:0546cb24.1c5f -->
export const CURRENT_SCHEMA_VERSION = '1.1.0';

/**
 * 空の AppMetadata（新しい曲と、移行で項目を補うときに使う）。項目は data-model-persistence.md 6 節の 5 つ。
 * `settings` はミキサーの値を持たない（data-model-persistence.md 6.4 節）。1 小節目は拍子を継ぐ先が無いので、
 * `explicitTimeSignatureBars` にいつも入れる（editing-core.md 3.2 節）。
 */
export function createEmptyAppMetadata(): AppMetadata {
  return {
    tags: [],
    memos: [],
    sectionMarkers: [],
    settings: { defaultViewMode: 'focus', explicitTimeSignatureBars: [0], partPresetIds: [] },
    // data-model-persistence.md 6.5 節：サムネイルをまだ作っていないときは null <!-- req datamodelpersistence:b20ccd11.0a58 -->
    thumbnail: null,
  };
}

/** `barId`（曲共通の小節の番号を文字列にしたもの）として読める形：0 か、0 で始まらない数字の並び。 */
const BAR_ID_PATTERN = /^(0|[1-9]\d*)$/;

/**
 * alphaTab の `MasterBar.section` を `appMeta.sectionMarkers` から作り直す（data-model-persistence.md 6.1 節、G69）。
 * マーカーの正は `appMeta.sectionMarkers` で、`MasterBar.section` は譜面にセクション名を描かせるための写しなので、
 * 曲のファイルの `song` に入っていた写しは読まずに全部外し、マーカーごとに置き直す。
 * `barId` が小節の番号として読めないマーカーと、曲の小節の数を超えるマーカーは写さない（マーカーそのものは消さない）。
 */
function rebuildSectionsFromMarkers(score: model.Score, markers: readonly SectionMarker[]): void {
  // data-model-persistence.md 6.1 節：MasterBar.section の写しは正として読まずに外す <!-- req datamodelpersistence:90a6b1c2.1383 -->
  for (const masterBar of score.masterBars) {
    masterBar.section = null;
  }
  for (const marker of markers) {
    const masterBar = BAR_ID_PATTERN.test(marker.barId) ? score.masterBars[Number(marker.barId)] : undefined;
    if (masterBar === undefined) continue;
    // data-model-persistence.md 6.1 節：マーカーを MasterBar.section（Section）へ写す <!-- req datamodelpersistence:975d1015.a469 --> <!-- req datamodelpersistence:90a6b1c2.897b -->
    const section = new model.Section();
    section.text = marker.label;
    masterBar.section = section;
  }
}

// data-model-persistence.md 2 節：JsonConverter.scoreToJson(score) の結果を JSON.parse して song に入れ、Score とその下（Track・Staff・Bar・Voice・Beat・Note）にアプリ独自のプロパティを足さない <!-- req datamodelpersistence:36cfc150.c149 --> <!-- req datamodelpersistence:36cfc150.dd65 --> <!-- req datamodelpersistence:36cfc150.64f5 --> <!-- req datamodelpersistence:36cfc150.53a9 --> <!-- req datamodelpersistence:36cfc150.c95e --> <!-- req datamodelpersistence:36cfc150.86b9 --> <!-- req datamodelpersistence:36cfc150.e3f1 --> <!-- req datamodelpersistence:638dde2a.b48b -->
/** Score を曲のファイルの `song` に入れる値へ変える：`JsonConverter.scoreToJson(score)` の結果を `JSON.parse` する（data-model-persistence.md 2 節）。 */
function serializeScore(score: model.Score): unknown {
  return JSON.parse(model.JsonConverter.scoreToJson(score)) as unknown;
}

// data-model-persistence.md 2 節：song を JsonConverter.jsonToScore(JSON.stringify(song)) で Score に戻す <!-- req datamodelpersistence:638dde2a.f303 -->
/** 曲のファイルの `song` から Score に戻す：`JsonConverter.jsonToScore(JSON.stringify(song))`（data-model-persistence.md 2 節）。 */
function deserializeScore(song: unknown): model.Score {
  return model.JsonConverter.jsonToScore(JSON.stringify(song));
}

// data-model-persistence.md 2 節：1 曲を表すクラス SongDocument を packages/core/src/domain に置いて export する（4 節の SONG の受け先も同じ） <!-- req datamodelpersistence:320852ef.71d4 --> <!-- req datamodelpersistence:7fb35d88.d025 --> <!-- req datamodelpersistence:3a890a1f.4fc7 -->
export class SongDocument {
  // data-model-persistence.md 2 節：読み取り専用の id（版 4 の UUID の文字列）を持つ（4 節の対応表と 5 節の id も同じ） <!-- req datamodelpersistence:e8936f32.a043 --> <!-- req datamodelpersistence:3a890a1f.9bf0 --> <!-- req datamodelpersistence:fbd2e0bc.fbdb -->
  /** 曲の識別子（版 4 の UUID の文字列）。曲のファイルの名前 `{id}.tabapp` にも使う（data-model-persistence.md 5 節）。 */
  readonly id: string;
  // data-model-persistence.md 2 節：中核は alphaTab の Score をそのまま持つ読み取り専用の score で、アプリ独自の曲のモデルを別に作らず、Score にアプリ独自のプロパティを足さない（4 節の SONG と Score の対応、5 節の artist を Score.artist に持つことも同じ） <!-- req datamodelpersistence:320852ef.d6bc --> <!-- req datamodelpersistence:320852ef.cc9e --> <!-- req datamodelpersistence:495b398a.c81c --> <!-- req datamodelpersistence:495b398a.7780 --> <!-- req datamodelpersistence:3a890a1f.954e --> <!-- req datamodelpersistence:3a890a1f.2b77 --> <!-- req datamodelpersistence:02c1a593.56f8 --> <!-- req datamodelpersistence:02c1a593.ed7d --> <!-- req datamodelpersistence:02c1a593.b1de -->
  /** 中核。alphaTab の Score をそのまま持ち、アプリ独自のプロパティを足さない（data-model-persistence.md 2 節）。 */
  readonly score: model.Score;
  // data-model-persistence.md 2 節：サイドカーのうち曲のファイルに入れるものを、Score の外の読み取り専用の appMeta（AppMetadata）に持つ <!-- req datamodelpersistence:638dde2a.c766 --> <!-- req datamodelpersistence:638dde2a.0e82 --> <!-- req datamodelpersistence:1802d778.d669 -->
  /** サイドカーのうち曲のファイルに入れるもの（data-model-persistence.md 2 節）。 */
  readonly appMeta: AppMetadata;
  // data-model-persistence.md 2 節：読み取り専用の schemaVersion（文字列）を持つ（4 節の対応表と 5 節の schemaVersion も同じ） <!-- req datamodelpersistence:fb6aaf7c.8821 --> <!-- req datamodelpersistence:3a890a1f.28b9 --> <!-- req datamodelpersistence:04633196.fbc7 --> <!-- req datamodelpersistence:04633196.a71d -->
  /** 曲のファイルの形の版（セマンティックバージョニングの文字列。data-model-persistence.md 5 節）。 */
  readonly schemaVersion: string;
  // data-model-persistence.md 2 節：読み取り専用の createdAt（文字列）を持つ（4 節の対応表も同じ） <!-- req datamodelpersistence:7caef7c1.c54c --> <!-- req datamodelpersistence:3a890a1f.43c7 -->
  /** 作った時刻（ISO 8601）。曲のファイルに持つ（data-model-persistence.md 5 節）。 */
  readonly createdAt: string;

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

  // data-model-persistence.md 2 節：toFileJson(savedAtMonotonic?) で SongFileJson を返す <!-- req datamodelpersistence:9c68d744.5e41 -->
  /**
   * 曲のファイルの形（SongFileJson）に書き出す。Score は `song` に、サイドカーは `appMeta` に分けて置く（data-model-persistence.md 2 節）。
   * @param savedAtMonotonic 保存したときの時刻（壁時計のミリ秒）。省くと今の時刻（data-model-persistence.md 2 節・5 節）。
   */
  toFileJson(savedAtMonotonic?: number): SongFileJson {
    // data-model-persistence.md 2 節：曲のファイルでは Score を song に、サイドカーを appMeta に分けて置き、同じ JSON の中で混ぜない <!-- req datamodelpersistence:638dde2a.651d --> <!-- req datamodelpersistence:638dde2a.a2ec --> <!-- req datamodelpersistence:638dde2a.99c2 -->
    // data-model-persistence.md 7 節：song には Score を JsonConverter で JSON にしたものを入れる <!-- req datamodelpersistence:080cacc3.6231 -->
    const song = serializeScore(this.score);
    return {
      schemaVersion: this.schemaVersion,
      id: this.id,
      // data-model-persistence.md 5 節：createdAt を曲のファイルに持つ <!-- req datamodelpersistence:1cf63af6.028d -->
      createdAt: this.createdAt,
      song,
      // data-model-persistence.md 6.2 節：入力・編集以外の保存ではメモの中身に触れない <!-- req datamodelpersistence:68ce415e.f41a -->
      appMeta: this.appMeta,
      integrity: {
        // data-model-persistence.md 2 節：savedAtMonotonic を省くと今の時刻を使う <!-- req datamodelpersistence:9c68d744.ffe7 -->
        // data-model-persistence.md 7 節：savedAtMonotonic に保存したときの壁時計のミリ秒を入れる <!-- req datamodelpersistence:b40ba64d.5d6f -->
        savedAtMonotonic: savedAtMonotonic ?? Date.now(),
        // <!-- req datamodelpersistence:4135089b.33c7 -->
        checksum: computeChecksum(this.schemaVersion, song, this.appMeta),
      },
    };
  }

  // data-model-persistence.md 2 節：静的メソッド fromFileJson で SongFileJson から SongDocument を作る <!-- req datamodelpersistence:876a2925.e252 -->
  /**
   * 移行の済んだ曲のファイルの形（SongFileJson）から読む（data-model-persistence.md 2 節）。
   * `song` に artist が無い古いファイルは、Score.artist の初めの値（空の文字列）として読む（data-model-persistence.md 5 節）。
   * `MasterBar.section` は `appMeta.sectionMarkers` から作り直す（data-model-persistence.md 6.1 節）。
   * `appMeta` はそのまま持ち、メモの本文も切り詰めない（上限を超えた古いメモもそのまま見せる。data-model-persistence.md 6.2 節）。
   */
  static fromFileJson(json: SongFileJson): SongDocument {
    // data-model-persistence.md 5 節：古いファイルに artist が無いときは、Score.artist の初めの値の空の文字列として読む <!-- req datamodelpersistence:02c1a593.1923 -->
    const score = deserializeScore(json.song);
    // data-model-persistence.md 6.1 節：曲を開くときに appMeta.sectionMarkers から作り直す <!-- req datamodelpersistence:90a6b1c2.3d2a -->
    rebuildSectionsFromMarkers(score, json.appMeta.sectionMarkers);
    return new SongDocument({
      id: json.id,
      score,
      // data-model-persistence.md 6.2 節：古いファイルを開いたときメモを切り詰めずにそのまま持つ <!-- req datamodelpersistence:68ce415e.806d --> <!-- req datamodelpersistence:68ce415e.086a -->
      appMeta: json.appMeta,
      schemaVersion: json.schemaVersion,
      createdAt: json.createdAt,
    });
  }
}
