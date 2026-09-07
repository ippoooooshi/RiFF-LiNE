// UT: data-model-persistence.md §3.2・§8、02_data_model.md §4.2 — SchemaMigrator
// 検証観点: 逐次適用、経路なし／新しすぎるバージョンでの UnsupportedSchemaVersionError、
// 到達後の欠損フィールド補完（C0/C1/C2）。

import { describe, expect, it } from 'vitest';

import { SchemaMigrator } from './SchemaMigrator';
import { UnsupportedSchemaVersionError } from './errors';

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
    const m = new SchemaMigrator();
    const out = m.migrate(baseFile('1.0.0'), '1.0.0');
    expect(out.schemaVersion).toBe('1.0.0');
    expect(out.song).toEqual({ title: 'T' });
  });

  it('SchemaMigrator_ChainedSteps_AppliedInOrder', () => {
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
    const m = new SchemaMigrator();
    m.register('1.0.0', '1.1.0', (j) => j);
    expect(() => m.migrate(baseFile('1.0.0'), '2.0.0')).toThrow(UnsupportedSchemaVersionError);
  });

  it('SchemaMigrator_FileNewerThanApp_ThrowsUnsupported', () => {
    const m = new SchemaMigrator();
    expect(() => m.migrate(baseFile('9.9.9'), '1.0.0')).toThrow(UnsupportedSchemaVersionError);
  });

  it('SchemaMigrator_MissingSchemaVersion_ThrowsUnsupported', () => {
    const m = new SchemaMigrator();
    expect(() => m.migrate({ song: {} }, '1.0.0')).toThrow(UnsupportedSchemaVersionError);
  });

  it('SchemaMigrator_NonObjectInput_ThrowsUnsupported', () => {
    const m = new SchemaMigrator();
    expect(() => m.migrate('not-json', '1.0.0')).toThrow(UnsupportedSchemaVersionError);
  });

  it('SchemaMigrator_MissingAppMetaFields_FilledWithDefaults', () => {
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
    const m = new SchemaMigrator();
    // 1.0.0 -> 1.0.0 の自己ループ。current(2.0.0)に到達できず、ガードで打ち切って throw。
    m.register('1.0.0', '1.0.0', (j) => j);
    expect(() => m.migrate(baseFile('1.0.0'), '2.0.0')).toThrow(UnsupportedSchemaVersionError);
  });

  it('SchemaMigrator_DuplicateRegister_LastWins', () => {
    const m = new SchemaMigrator();
    m.register('1.0.0', '1.1.0', () => ({ schemaVersion: '1.1.0', song: { v: 'first' } }));
    m.register('1.0.0', '1.1.0', () => ({ schemaVersion: '1.1.0', song: { v: 'second' } }));
    const out = m.migrate(baseFile('1.0.0'), '1.1.0');
    expect(out.song).toEqual({ v: 'second' });
  });
});
