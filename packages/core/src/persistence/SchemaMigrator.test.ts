// UT-PERSIST-MIGRATE: `SchemaMigrator`（スキーマ移行、C2 対象）
// 検証節: data-model-persistence.md 8 節・6.4 節
// UT: data-model-persistence.md 8 節、02_data_model.md 4.2 節 — SchemaMigrator
// 検証観点: 逐次適用、経路なし／新しすぎるバージョンでの UnsupportedSchemaVersionError（FILE-004）、
// 壊れたファイル（いちばん上がオブジェクトでない・schemaVersion が空でない文字列でない）の CorruptSongFileError（FILE-008）、
// 版の 1 つ目の数で変換の要否を見分けること（同じなら 2 つ目の数が小さくても大きくても変換の関数を使わず読むときの整えで開く）、
// 6.4 節の補い方、到達後の欠損フィールド補完（C0/C1/C2）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from '../domain/SongDocument';
import type { NotificationEvent } from '../errors';
import { notificationCenter } from '../errors';

import { SchemaMigrator, deriveExplicitTimeSignatureBars, derivePartPresetIds } from './SchemaMigrator';
import { CorruptSongFileError, UnsupportedSchemaVersionError } from './errors';

let reported: NotificationEvent[];
let unsubscribe: () => void;

beforeEach(() => {
  reported = [];
  unsubscribe = notificationCenter.subscribe((event) => reported.push(event));
});

afterEach(() => {
  unsubscribe();
});

function codes(): string[] {
  return reported.map((event) => event.code);
}

function baseFile(schemaVersion: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion,
    id: 's1',
    createdAt: '2026-01-01T00:00:00.000Z',
    song: { title: 'T' },
    appMeta: {
      tags: [],
      memos: [],
      sectionMarkers: [],
      settings: { defaultViewMode: 'focus', mixerSnapshot: null },
      thumbnail: null,
    },
    integrity: { savedAtMonotonic: 1, checksum: 'sha256:x' },
    ...extra,
  };
}

describe('SchemaMigrator.migrate', () => {
  it('SchemaMigrator_CurrentVersion_NoStepsApplied', () => {
    // UT-PERSIST-MIGRATE-01
    const m = new SchemaMigrator();
    const out = m.migrate(baseFile('1.0.0'), '1.0.0');
    expect(out.schemaVersion).toBe('1.0.0');
    expect(out.song).toEqual({ title: 'T' });
  });

  it('SchemaMigrator_ChainedSteps_AppliedInOrder', () => {
    // UT-PERSIST-MIGRATE-02
    const m = new SchemaMigrator();
    // 各ステップが song.trail に自分の印を積む → 適用順が観測できる。
    m.register('1.0.0', '1.1.0', (j) => {
      const o = j as { song?: { trail?: string[] } };
      return { ...(o as object), schemaVersion: '1.1.0', song: { trail: [...(o.song?.trail ?? []), 'A'] } };
    });
    m.register('1.1.0', '2.0.0', (j) => {
      const o = j as { song?: { trail?: string[] } };
      return { ...(o as object), schemaVersion: '2.0.0', song: { trail: [...(o.song?.trail ?? []), 'B'] } };
    });
    const out = m.migrate(baseFile('1.0.0'), '2.0.0');
    expect(out.schemaVersion).toBe('2.0.0');
    expect(out.song).toEqual({ trail: ['A', 'B'] });
  });

  it('SchemaMigrator_NoMigrationPath_ThrowsUnsupported', () => {
    // UT-PERSIST-MIGRATE-03
    const m = new SchemaMigrator();
    m.register('1.0.0', '1.1.0', (j) => j);
    expect(() => m.migrate(baseFile('1.0.0'), '2.0.0')).toThrow(UnsupportedSchemaVersionError);
  });

  it('SchemaMigrator_FileNewerThanApp_ThrowsUnsupported', () => {
    // UT-PERSIST-MIGRATE-04
    const m = new SchemaMigrator();
    expect(() => m.migrate(baseFile('9.9.9'), '1.0.0')).toThrow(UnsupportedSchemaVersionError);
  });

  it('SchemaMigrator_MissingSchemaVersion_ThrowsCorruptWithFile008', () => {
    // UT-PERSIST-MIGRATE-05 data-model-persistence.md 8 節 (3)：schemaVersion が空でない文字列でなければ壊れたファイル。FILE-004 は出さない
    const m = new SchemaMigrator();
    for (const json of [{ song: {} }, { schemaVersion: '', song: {} }, { schemaVersion: 110, song: {} }]) {
      reported = [];
      expect(() => m.migrate(json, '1.0.0')).toThrow(CorruptSongFileError);
      expect(codes()).toEqual(['FILE-008']);
    }
  });

  it('SchemaMigrator_NonObjectInput_ThrowsCorruptWithFile008', () => {
    // UT-PERSIST-MIGRATE-06 data-model-persistence.md 8 節 (2)：いちばん上がオブジェクトでなければ壊れたファイル。FILE-004 は出さない
    const m = new SchemaMigrator();
    for (const json of ['not-json', null, 5, [{ schemaVersion: '1.0.0' }]]) {
      reported = [];
      let thrown: unknown;
      try {
        m.migrate(json, '1.0.0');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CorruptSongFileError);
      expect((thrown as CorruptSongFileError).reason).toBe('not-object');
      expect(codes()).toEqual(['FILE-008']);
    }
  });

  it('SchemaMigrator_MissingAppMetaFields_FilledWithDefaults', () => {
    // UT-PERSIST-MIGRATE-07
    const m = new SchemaMigrator();
    const out = m.migrate({ schemaVersion: '1.0.0', song: {}, appMeta: { tags: [{ tagId: 't' }] } }, '1.0.0');
    expect(out.appMeta.tags).toEqual([{ tagId: 't' }]);
    expect(out.appMeta.memos).toEqual([]);
    expect(out.appMeta.sectionMarkers).toEqual([]);
    expect(out.appMeta.settings.defaultViewMode).toBe('focus');
    expect(out.appMeta.thumbnail).toBeNull();
    expect(out.id).toBe('');
    expect(typeof out.createdAt).toBe('string');
    expect(out.integrity).toEqual({ savedAtMonotonic: 0, checksum: '' });
  });

  it('SchemaMigrator_InvalidViewModeAndThumbnail_Normalized', () => {
    // UT-PERSIST-MIGRATE-08
    const m = new SchemaMigrator();
    const out = m.migrate(
      {
        schemaVersion: '1.0.0',
        song: {},
        appMeta: { settings: { defaultViewMode: 'bogus' }, thumbnail: { encoding: 'x', data: 1 } },
      },
      '1.0.0',
    );
    expect(out.appMeta.settings.defaultViewMode).toBe('focus');
    expect(out.appMeta.thumbnail).toBeNull();
  });

  it('SchemaMigrator_PreservesValidViewModeAndThumbnail', () => {
    // UT-PERSIST-MIGRATE-09
    const m = new SchemaMigrator();
    const thumb = { encoding: 'base64-png' as const, data: 'AAAA' };
    const out = m.migrate(
      { schemaVersion: '1.0.0', song: {}, appMeta: { settings: { defaultViewMode: 'score' }, thumbnail: thumb } },
      '1.0.0',
    );
    expect(out.appMeta.settings.defaultViewMode).toBe('score');
    expect(out.appMeta.thumbnail).toEqual(thumb);
  });

  it('SchemaMigrator_CyclicRegistration_GuardStopsAndThrows', () => {
    // UT-PERSIST-MIGRATE-10
    const m = new SchemaMigrator();
    // 1.0.0 -> 1.0.0 の自己ループ。current(2.0.0)に到達できず、ガードで打ち切って throw。
    m.register('1.0.0', '1.0.0', (j) => j);
    expect(() => m.migrate(baseFile('1.0.0'), '2.0.0')).toThrow(UnsupportedSchemaVersionError);
  });

  it('SchemaMigrator_DuplicateRegister_LastWins', () => {
    // UT-PERSIST-MIGRATE-11（変換の関数を使うのは 1 つ目の数が上がるときだけなので、1.0.0 → 2.0.0 で確かめる）
    const m = new SchemaMigrator();
    m.register('1.0.0', '2.0.0', () => ({ schemaVersion: '2.0.0', song: { v: 'first' } }));
    m.register('1.0.0', '2.0.0', () => ({ schemaVersion: '2.0.0', song: { v: 'second' } }));
    const out = m.migrate(baseFile('1.0.0'), '2.0.0');
    expect(out.song).toEqual({ v: 'second' });
  });

  it('SchemaMigrator_FileNewerThanApp_ReportsFile004NotFile008', () => {
    // UT-PERSIST-MIGRATE-12 data-model-persistence.md 8 節：形が正しく今より新しい版のときだけ FILE-004。壊れたファイルの FILE-008 は出さない
    const m = new SchemaMigrator();
    expect(() => m.migrate(baseFile('9.9.9'))).toThrow(UnsupportedSchemaVersionError);
    expect(codes()).toEqual(['FILE-004']);
  });
});

/** alphaTab の JsonConverter が書く形（項目の名前は小文字）の曲。拍子は [分子, 分母] の並び、パートは数だけ。 */
function songJson(timeSignatures: [number, number][], trackCount: number): Record<string, unknown> {
  return {
    title: 'T',
    masterbars: timeSignatures.map(([n, d]) => ({ timesignaturenumerator: n, timesignaturedenominator: d })),
    tracks: Array.from({ length: trackCount }, (_, i) => ({ name: `P${i}` })),
  };
}

describe('SchemaMigrator：1.0.0 の曲（1 つ目の数が同じ）と、1 つ目の数が上がるときの変換の関数', () => {
  it('SchemaMigrator_Version100_MigratedToCurrentWithSettingsFilledPer64', () => {
    // UT-PERSIST-MIGRATE-13 data-model-persistence.md 8 節・6.4 節：今の版は 1.1.0。1.0.0 の曲は 1 つ目の数が同じなので変換の関数を使わず、
    // 読むときの整えで 1.1.0 の形にし、explicitTimeSignatureBars は 1 小節目と拍子が直前と違う小節、partPresetIds はパートの数だけ null で補う
    expect(CURRENT_SCHEMA_VERSION).toBe('1.1.0');
    const m = new SchemaMigrator();
    const json = baseFile('1.0.0', {
      song: songJson(
        [
          [4, 4],
          [4, 4],
          [3, 4],
          [3, 4],
          [3, 8],
          [4, 4],
        ],
        2,
      ),
    });
    const out = m.migrate(json);
    expect(out.schemaVersion).toBe('1.1.0');
    expect(out.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 2, 4, 5]);
    expect(out.appMeta.settings.partPresetIds).toEqual([null, null]);
    // 新しい曲の値（[0] と []）で補っていない
    expect(out.appMeta.settings.partPresetIds).not.toEqual([]);
    expect(codes()).toEqual([]);
  });

  it('SchemaMigrator_Version100_StepRunsBeforeNextStepInChain', () => {
    // UT-PERSIST-MIGRATE-14 data-model-persistence.md 8 節：1 つ目の数が小さいときは 1 版ずつの変換を順につなぐ。前の変換の出力が次の変換の入力になる
    // （アプリが持つ 1.0.0 → 1.1.0 の変換の関数は無くしたので、1 つ目の数が上がる 0.9.0 → 1.0.0 → 2.0.0 で確かめる）
    const m = new SchemaMigrator();
    let seen: unknown;
    m.register('0.9.0', '1.0.0', (j) => ({ ...(j as object), schemaVersion: '1.0.0', step: 'first' }));
    m.register('1.0.0', '2.0.0', (j) => {
      seen = j;
      return { ...(j as object), schemaVersion: '2.0.0' };
    });
    const out = m.migrate(baseFile('0.9.0', { song: songJson([[4, 4]], 1) }), '2.0.0');
    expect(seen).toMatchObject({ schemaVersion: '1.0.0', step: 'first' });
    expect(out.schemaVersion).toBe('2.0.0');
  });

  it('SchemaMigrator_Version100_KeepsFieldsAlreadyInFile', () => {
    // UT-PERSIST-MIGRATE-15 data-model-persistence.md 6.4 節：補うのは曲のファイルに無いときだけ。在る値はそのまま
    const m = new SchemaMigrator();
    const json = baseFile('1.0.0', {
      song: songJson(
        [
          [4, 4],
          [3, 4],
        ],
        2,
      ),
      appMeta: {
        settings: { defaultViewMode: 'scroll', explicitTimeSignatureBars: [0], partPresetIds: ['p1', null] },
      },
    });
    const out = m.migrate(json);
    expect(out.appMeta.settings).toEqual({
      defaultViewMode: 'scroll',
      explicitTimeSignatureBars: [0],
      partPresetIds: ['p1', null],
    });
  });

  it('SchemaMigrator_Version100_AppMetaOrSettingsMissing_StillFilled', () => {
    // UT-PERSIST-MIGRATE-16 data-model-persistence.md 6.4 節：appMeta や settings ごと無い古いファイルも同じ補い方で補う
    const m = new SchemaMigrator();
    const noAppMeta = m.migrate({ schemaVersion: '1.0.0', song: songJson([[6, 8]], 3) });
    expect(noAppMeta.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect(noAppMeta.appMeta.settings.partPresetIds).toEqual([null, null, null]);
    const noSettings = m.migrate({ schemaVersion: '1.0.0', song: songJson([[6, 8]], 1), appMeta: { tags: [] } });
    expect(noSettings.appMeta.settings.partPresetIds).toEqual([null]);
  });

  it('SchemaMigrator_CurrentVersionMissingFields_FilledPer64', () => {
    // UT-PERSIST-MIGRATE-17 data-model-persistence.md 8 節：新しい項目は省いてよく、読むときに既定の値で補う（今の版の曲でも 6.4 節の補い方）
    const m = new SchemaMigrator();
    const out = m.migrate(
      baseFile('1.1.0', {
        song: songJson(
          [
            [2, 4],
            [2, 4],
            [5, 4],
          ],
          1,
        ),
      }),
    );
    expect(out.schemaVersion).toBe('1.1.0');
    expect(out.appMeta.settings.explicitTimeSignatureBars).toEqual([0, 2]);
    expect(out.appMeta.settings.partPresetIds).toEqual([null]);
  });

  it('SchemaMigrator_StepReturnsNonObject_NormalizedToDefaults', () => {
    // UT-PERSIST-MIGRATE-24 data-model-persistence.md 8 節：変換の結果がオブジェクトでなくても、今の版の形（既定の値で補ったもの）で返す
    // （変換の関数を使うのは 1 つ目の数が小さいときなので、0.9.0 → 1.0.0 で確かめる）
    const m = new SchemaMigrator();
    m.register('0.9.0', '1.0.0', () => 'oops');
    const out = m.migrate(baseFile('0.9.0'));
    expect(out.schemaVersion).toBe('1.1.0');
    expect(out.id).toBe('');
    expect(out.appMeta.settings).toEqual({
      defaultViewMode: 'focus',
      explicitTimeSignatureBars: [],
      partPresetIds: [],
    });
  });

  it('SchemaMigrator_UnreachableOlderVersion_ReportsFile004', () => {
    // UT-PERSIST-MIGRATE-18 data-model-persistence.md 8 節：形が正しく、今の版へ移す変換の関数がつながらないときは FILE-004
    const m = new SchemaMigrator();
    expect(() => m.migrate(baseFile('0.9.0'))).toThrow(UnsupportedSchemaVersionError);
    expect(codes()).toEqual(['FILE-004']);
  });

  it('SchemaMigrator_SameMajorOlderMinor_DoesNotUseRegisteredStep', () => {
    // UT-PERSIST-MIGRATE-25 data-model-persistence.md 8 節：1 つ目の数が同じなら、2 つ目の数が小さくても変換の関数を使わず、
    // 読むときの整えで 6.4 節の補い方をして開く（2026-10-27 本人決定、honnin-queue 211 番）
    const m = new SchemaMigrator();
    let called = false;
    m.register('1.0.0', '1.1.0', (j) => {
      called = true;
      return j;
    });
    const out = m.migrate(baseFile('1.0.0', { song: songJson([[4, 4]], 2) }));
    expect(called).toBe(false);
    expect(out.schemaVersion).toBe('1.1.0');
    expect(out.appMeta.settings.partPresetIds).toEqual([null, null]);
    expect(out.appMeta.settings.explicitTimeSignatureBars).toEqual([0]);
    expect(codes()).toEqual([]);
  });

  it('SchemaMigrator_SameMajorNewerMinor_OpensWithoutFile004OrStep', () => {
    // UT-PERSIST-MIGRATE-26 data-model-persistence.md 8 節：1 つ目の数が同じなら、2 つ目の数が今の版より大きくても FILE-004 にせず、
    // 変換の関数を使わずに読むときの整えで開く（在る項目はそのまま、無い項目は 6.4 節の補い方）
    const m = new SchemaMigrator();
    let called = false;
    m.register('1.2.0', '1.1.0', (j) => {
      called = true;
      return j;
    });
    const out = m.migrate(
      baseFile('1.2.0', {
        song: songJson([[4, 4]], 1),
        appMeta: { tags: [{ tagId: 't' }], settings: { defaultViewMode: 'score', partPresetIds: ['p1'] } },
      }),
    );
    expect(called).toBe(false);
    expect(codes()).toEqual([]);
    expect(out.id).toBe('s1');
    expect(out.appMeta.tags).toEqual([{ tagId: 't' }]);
    expect(out.appMeta.settings).toEqual({
      defaultViewMode: 'score',
      explicitTimeSignatureBars: [0],
      partPresetIds: ['p1'],
    });
  });

  it('SchemaMigrator_SameMajorNewerMinor_CurrentBehaviorSetsCurrentVersionAndDropsUnknownFields', () => {
    // UT-PERSIST-MIGRATE-27 2 つ目の数が新しい曲を開いて保存したときの schemaVersion と知らない項目の扱いは設計書で未決（本人の判断待ち）。
    // 決まるまでの今の動きを書き表す：読むときの整えが schemaVersion を今の版にし、知らない項目を持ち越さない
    const m = new SchemaMigrator();
    const out = m.migrate(
      baseFile('1.5.0', {
        futureTop: 1,
        appMeta: { settings: { defaultViewMode: 'focus', futureSetting: true }, futureMeta: 'x' },
      }),
    );
    expect(out.schemaVersion).toBe('1.1.0');
    expect(Object.keys(out).sort()).toEqual(['appMeta', 'createdAt', 'id', 'integrity', 'schemaVersion', 'song']);
    expect(Object.keys(out.appMeta).sort()).toEqual(['memos', 'sectionMarkers', 'settings', 'tags', 'thumbnail']);
    expect(Object.keys(out.appMeta.settings).sort()).toEqual([
      'defaultViewMode',
      'explicitTimeSignatureBars',
      'partPresetIds',
    ]);
  });

  it('SchemaMigrator_NewerMajorEvenWithLowerMinor_ThrowsFile004', () => {
    // UT-PERSIST-MIGRATE-28 data-model-persistence.md 8 節：1 つ目の数がファイルのほうが大きければ、2 つ目の数によらず FILE-004
    const m = new SchemaMigrator();
    expect(() => m.migrate(baseFile('2.0.0'))).toThrow(UnsupportedSchemaVersionError);
    expect(() => m.migrate(baseFile('3.0.0'), '2.9.9')).toThrow(UnsupportedSchemaVersionError);
    expect(codes()).toEqual(['FILE-004', 'FILE-004']);
  });

  it('SchemaMigrator_StepJumpsPastCurrentMajor_ThrowsFile004', () => {
    // UT-PERSIST-MIGRATE-29 data-model-persistence.md 8 節：1 つ目の数が小さく、変換の関数が今の版につながらない（今の版を飛び越える）ときも FILE-004
    const m = new SchemaMigrator();
    m.register('0.9.0', '2.0.0', (j) => ({ ...(j as object), schemaVersion: '2.0.0' }));
    let thrown: unknown;
    try {
      m.migrate(baseFile('0.9.0'));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnsupportedSchemaVersionError);
    expect(reported.map((event) => [event.code, event.context])).toEqual([
      ['FILE-004', { fromVersion: '0.9.0', toVersion: '1.1.0' }],
    ]);
  });
});

describe('SchemaMigrator.checkShape / needsMigration', () => {
  it('SchemaMigrator_checkShape_ReturnsVersionWithoutReporting', () => {
    // UT-PERSIST-MIGRATE-19 data-model-persistence.md 8 節：形が正しければ schemaVersion を返し、何も出さない
    const m = new SchemaMigrator();
    expect(m.checkShape(baseFile('1.0.0'))).toBe('1.0.0');
    expect(codes()).toEqual([]);
  });

  it('SchemaMigrator_needsMigration_TrueOnlyForOlderThanCurrent', () => {
    // UT-PERSIST-MIGRATE-20 data-model-persistence.md 8 節：変換が要るのは 1 つ目の数が今の版より小さいときだけ（2 つ目の数が小さくても要らない）
    const m = new SchemaMigrator();
    expect(m.needsMigration('1.0.0')).toBe(false);
    expect(m.needsMigration('0.9.9')).toBe(true);
    expect(m.needsMigration('1.1.0')).toBe(false);
    expect(m.needsMigration('1.10.0')).toBe(false);
    expect(m.needsMigration('2.0.0', '1.1.0')).toBe(false);
    expect(m.needsMigration('1.9.0', '2.0.0')).toBe(true);
    // 1 つ目の数が数でなければ 0 とみなす
    expect(m.needsMigration('x.1.0')).toBe(true);
    expect(m.needsMigration('1.0.0', 'x')).toBe(false);
  });
});

describe('6.4 節の補い方', () => {
  it('deriveExplicitTimeSignatureBars_MissingOrMixedCaseKeys_ReadLikeAlphaTab', () => {
    // UT-PERSIST-MIGRATE-21 data-model-persistence.md 6.4 節：alphaTab と同じく項目の名前の大小を問わずに読み、無い拍子は 4/4
    const song = {
      MasterBars: [
        {},
        { timeSignatureNumerator: 4 },
        { TimeSignatureNumerator: 6, timesignaturedenominator: 8 },
        { timesignaturenumerator: '6', timesignaturedenominator: 8 },
        'not-a-bar',
      ],
    };
    // 3 番目の '6' は数でないので 4 とみなし（4/8）、5 番目は 4/4
    expect(deriveExplicitTimeSignatureBars(song)).toEqual([0, 2, 3, 4]);
  });

  it('derive_NoBarsOrNoSong_EmptyLists', () => {
    // UT-PERSIST-MIGRATE-22 data-model-persistence.md 6.4 節：小節もパートも無ければ空の一覧（1 小節目が無い）
    expect(deriveExplicitTimeSignatureBars({ masterbars: [] })).toEqual([]);
    expect(deriveExplicitTimeSignatureBars(null)).toEqual([]);
    expect(deriveExplicitTimeSignatureBars({ masterbars: 'x' })).toEqual([]);
    expect(derivePartPresetIds(undefined)).toEqual([]);
    expect(derivePartPresetIds({ tracks: {} })).toEqual([]);
  });

  it('derive_FromRealAlphaTabScoreJson_MatchesMasterBars', async () => {
    // UT-PERSIST-MIGRATE-23 data-model-persistence.md 6.4 節：alphaTab 1.8.4 の JsonConverter.scoreToJson が書いた song から作る
    const { model } = await import('@coderline/alphatab');
    const score = new model.Score();
    score.addTrack(new model.Track());
    score.addTrack(new model.Track());
    const signatures: [number, number][] = [
      [4, 4],
      [7, 8],
      [7, 8],
      [4, 4],
    ];
    for (const [n, d] of signatures) {
      const masterBar = new model.MasterBar();
      masterBar.timeSignatureNumerator = n;
      masterBar.timeSignatureDenominator = d;
      score.addMasterBar(masterBar);
    }
    const song = JSON.parse(model.JsonConverter.scoreToJson(score)) as unknown;
    expect(deriveExplicitTimeSignatureBars(song)).toEqual([0, 1, 3]);
    expect(derivePartPresetIds(song)).toEqual([null, null]);
  });
});
