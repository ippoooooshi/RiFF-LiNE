// UT: data-model-persistence.md §3.1・§4.1 — SongDocument / newSong
// 検証観点: 初期 Score 生成、toFileJson/fromFileJson の往復、チェックサムの決定性（C0/C1）。

import { describe, expect, it } from 'vitest';

import { createInitialScore, STANDARD_BASS_TUNING, STANDARD_GUITAR_TUNING } from './newSong';
import { CURRENT_SCHEMA_VERSION, SongDocument, createEmptyAppMetadata } from './SongDocument';

function makeDoc(title = 'Test Song'): SongDocument {
  return new SongDocument({
    id: 'song-1',
    score: createInitialScore({ title }),
    appMeta: createEmptyAppMetadata(),
  });
}

describe('createInitialScore', () => {
  it('createInitialScore_Default_OneGuitarTrackWithOneBar', () => {
    const score = createInitialScore({ title: 'My Song' });
    expect(score.title).toBe('My Song');
    expect(score.tracks).toHaveLength(1);
    expect(score.tracks[0]!.staves[0]!.bars.length).toBeGreaterThanOrEqual(1);
    expect(score.tracks[0]!.staves[0]!.tuning).toEqual([...STANDARD_GUITAR_TUNING]);
  });

  it('createInitialScore_WithParts_BuildsEachTrack', () => {
    const score = createInitialScore({
      title: 'Duo',
      parts: [
        { name: 'Gtr', instrumentType: 'electric_guitar', tuning: [...STANDARD_GUITAR_TUNING] },
        { name: 'Bass', instrumentType: 'bass', tuning: [...STANDARD_BASS_TUNING] },
      ],
    });
    expect(score.tracks.map((t) => t.name)).toEqual(['Gtr', 'Bass']);
    expect(score.tracks[1]!.staves[0]!.tuning).toEqual([...STANDARD_BASS_TUNING]);
  });
});

describe('SongDocument', () => {
  it('SongDocument_ToFileJson_HasExpectedShape', () => {
    const json = makeDoc().toFileJson(1234);
    expect(json.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(json.id).toBe('song-1');
    expect(json.integrity.savedAtMonotonic).toBe(1234);
    expect(json.integrity.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(json.appMeta).toEqual(createEmptyAppMetadata());
  });

  it('SongDocument_FromFileJson_RoundTripsScoreAndMeta', () => {
    const original = makeDoc('Round Trip');
    original.appMeta.tags = [{ tagId: 'rock' }];
    const json = original.toFileJson();

    const restored = SongDocument.fromFileJson(json);
    expect(restored.id).toBe('song-1');
    expect(restored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(restored.appMeta.tags).toEqual([{ tagId: 'rock' }]);
    expect(restored.score.title).toBe('Round Trip');
    expect(restored.score.tracks).toHaveLength(1);
  });

  it('SongDocument_Checksum_StableAcrossSerializeRoundTrips', () => {
    const doc = makeDoc('Stable');
    const first = doc.computeChecksum();
    const restored = SongDocument.fromFileJson(doc.toFileJson());
    expect(restored.computeChecksum()).toBe(first);
    // toFileJson の integrity も同じ値。
    expect(doc.toFileJson().integrity.checksum).toBe(first);
  });

  it('SongDocument_Checksum_ChangesWhenMetadataChanges', () => {
    const doc = makeDoc('Sensitive');
    const before = doc.computeChecksum();
    doc.appMeta.sectionMarkers.push({ id: 'm1', barId: 'b1', label: 'Intro' });
    expect(doc.computeChecksum()).not.toBe(before);
  });

  it('SongDocument_Constructor_DefaultsSchemaVersionAndCreatedAt', () => {
    const doc = new SongDocument({
      id: 'x',
      score: createInitialScore({ title: 'D' }),
      appMeta: createEmptyAppMetadata(),
    });
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() => new Date(doc.createdAt).toISOString()).not.toThrow();
  });
});
