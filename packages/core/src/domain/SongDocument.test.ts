// UT-CORE-SONGDOC: 1 曲を表す SongDocument（読み取り専用の 5 つのメンバー・曲のファイルの形への書き出しと読み込み）と、新しい曲の初めの Score（createInitialScore）
// 検証節: data-model-persistence.md 2 節・4 節・5 節・6 節・7 節
// 検証観点: メンバーを差し替えられないこと、Score を song に・サイドカーを appMeta に分けて置くこと、Score にアプリ独自のプロパティを足さないこと、
// 書き出しと読み込みの往復、artist の無い古いファイルを空の文字列として読むこと、チェックサムの決定性（C0/C1）、
// appMeta の 5 つの項目と曲のファイルの 6 つの項目の形、セクションの写しを開くときに作り直すこと、メモを読み書きで切り詰めないこと。

import { model, Settings } from '@coderline/alphatab';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { computeChecksum } from './checksum';
import { createInitialScore, STANDARD_BASS_TUNING, STANDARD_GUITAR_TUNING } from './newSong';
import { CURRENT_SCHEMA_VERSION, SongDocument, createEmptyAppMetadata } from './SongDocument';
import type { AppMetadata, AppMetadataJson, Memo, SectionMarker, SongFileJson, SongSettings, TagRef } from './types';

function makeDoc(title = 'Test Song'): SongDocument {
  return new SongDocument({
    id: 'song-1',
    score: createInitialScore({ title }),
    appMeta: createEmptyAppMetadata(),
  });
}

/** 小節が barCount 個のギター 1 パートの Score（各小節は全音符の休符 1 つ）。 */
function makeScoreWithBars(barCount: number): model.Score {
  const score = createInitialScore({ title: 'Bars' });
  const staff = score.tracks[0]!.staves[0]!;
  while (score.masterBars.length < barCount) {
    score.addMasterBar(new model.MasterBar());
    const bar = new model.Bar();
    staff.addBar(bar);
    const voice = new model.Voice();
    bar.addVoice(voice);
    const rest = new model.Beat();
    rest.duration = model.Duration.Whole;
    voice.addBeat(rest);
  }
  score.finish(new Settings());
  return score;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createInitialScore', () => {
  it('createInitialScore_パートの指定なし_標準チューニングのギター1パートと1小節', () => {
    // UT-CORE-SONGDOC-01 data-model-persistence.md 5 節：曲名は Score.title に持つ。既定のパートは標準チューニングのギター 1 本
    const score = createInitialScore({ title: 'My Song' });
    expect(score.title).toBe('My Song');
    expect(score.tracks).toHaveLength(1);
    expect(score.tracks[0]!.staves[0]!.bars.length).toBeGreaterThanOrEqual(1);
    expect(score.tracks[0]!.staves[0]!.tuning).toEqual([...STANDARD_GUITAR_TUNING]);
  });

  it('createInitialScore_パートの指定あり_パートごとにTrackを作る', () => {
    // UT-CORE-SONGDOC-02 data-model-persistence.md 4 節：PART は Track（パート名は Track.name）、チューニングは Staff.stringTuning
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
  it('SongDocument_constructor_版と作った時刻を省くと今の版と今の時刻', () => {
    // UT-CORE-SONGDOC-07 data-model-persistence.md 5 節：schemaVersion はセマンティックバージョニングの文字列、createdAt を持つ
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    try {
      const doc = makeDoc();
      expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(doc.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(doc.createdAt).toBe('2026-01-02T03:04:05.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('SongDocument_constructor_渡した版と作った時刻をそのまま持つ', () => {
    // UT-CORE-SONGDOC-08 data-model-persistence.md 2 節：id・score・appMeta・schemaVersion・createdAt の 5 つを持つ
    const score = createInitialScore({ title: 'Given' });
    const appMeta = createEmptyAppMetadata();
    const doc = new SongDocument({
      id: 'given-id',
      score,
      appMeta,
      schemaVersion: '0.9.0',
      createdAt: '2020-05-06T07:08:09.000Z',
    });
    expect(doc.id).toBe('given-id');
    expect(doc.score).toBe(score);
    expect(doc.appMeta).toBe(appMeta);
    expect(doc.schemaVersion).toBe('0.9.0');
    expect(doc.createdAt).toBe('2020-05-06T07:08:09.000Z');
  });

  it('SongDocument_メンバー_5つとも読み取り専用で差し替えられない', () => {
    // UT-CORE-SONGDOC-09 data-model-persistence.md 2 節：id・score・appMeta・schemaVersion・createdAt は readonly
    // 型の検査（tsc -b）で確かめる。readonly を外すと @ts-expect-error が使われずに tsc が落ちる。
    // 中の関数は呼ばない（呼ぶと実行時には代入できてしまうため。確かめるのは型だけ）。
    const assignAll = (doc: SongDocument): void => {
      // @ts-expect-error id は読み取り専用
      doc.id = 'other';
      // @ts-expect-error score は読み取り専用
      doc.score = new model.Score();
      // @ts-expect-error appMeta は読み取り専用
      doc.appMeta = createEmptyAppMetadata();
      // @ts-expect-error schemaVersion は読み取り専用
      doc.schemaVersion = '9.9.9';
      // @ts-expect-error createdAt は読み取り専用
      doc.createdAt = '2000-01-01T00:00:00.000Z';
    };
    expect(typeof assignAll).toBe('function');
  });

  it('SongDocument_toFileJson_Scoreをsongにサイドカーをappmetaに分けて置く', () => {
    // UT-CORE-SONGDOC-03 data-model-persistence.md 2 節：曲のファイルでは Score を song に、サイドカーを appMeta に分けて置き、混ぜない
    const doc = makeDoc('Split');
    doc.appMeta.memos.push({
      id: 'memo-1',
      barId: 'b1',
      text: 'sidecar-memo-text',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const json = doc.toFileJson(1234);
    expect(Object.keys(json).sort()).toEqual(['appMeta', 'createdAt', 'id', 'integrity', 'schemaVersion', 'song']);
    expect(json.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(json.id).toBe('song-1');
    expect(json.createdAt).toBe(doc.createdAt);
    expect(json.appMeta).toBe(doc.appMeta);
    expect(json.integrity.savedAtMonotonic).toBe(1234);
    expect(json.integrity.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    // サイドカーの中身は song に入らない。
    expect(JSON.stringify(json.song)).not.toContain('sidecar-memo-text');
  });

  it('SongDocument_toFileJson_songはscoreToJsonの結果と同じでアプリ独自の項目を足さない', () => {
    // UT-CORE-SONGDOC-10 data-model-persistence.md 2 節：song は JsonConverter.scoreToJson(score) を JSON.parse したもの。Score にアプリ独自のプロパティを足さない
    const doc = makeDoc('Pure Score');
    doc.score.artist = 'Some Artist';
    const json = doc.toFileJson(1);
    expect(json.song).toEqual(JSON.parse(model.JsonConverter.scoreToJson(doc.score)));
    // 曲のファイルにしても Score の持ち物が alphaTab の初めの Score と同じ名前だけであること。
    const plainKeys = Object.keys(new model.Score()).sort();
    expect(Object.keys(doc.score).sort()).toEqual(plainKeys);
    expect(Object.keys(SongDocument.fromFileJson(json).score).sort()).toEqual(plainKeys);
  });

  it('SongDocument_toFileJson_時刻を省くと今の時刻を入れる', () => {
    // UT-CORE-SONGDOC-11 data-model-persistence.md 2 節：toFileJson(savedAtMonotonic?) は省くと今の時刻
    const doc = makeDoc();
    const before = Date.now();
    const json = doc.toFileJson();
    const after = Date.now();
    expect(json.integrity.savedAtMonotonic).toBeGreaterThanOrEqual(before);
    expect(json.integrity.savedAtMonotonic).toBeLessThanOrEqual(after);
  });

  it('SongDocument_fromFileJson_書き出した形から同じ中身に戻る', () => {
    // UT-CORE-SONGDOC-04 data-model-persistence.md 2 節：読むときは JsonConverter.jsonToScore(JSON.stringify(song))、appMeta は AppMetadata で読む
    const original = new SongDocument({
      id: 'round-1',
      score: createInitialScore({ title: 'Round Trip' }),
      appMeta: createEmptyAppMetadata(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: '2025-12-31T23:59:59.000Z',
    });
    original.score.artist = 'The Band';
    original.appMeta.tags.push({ tagId: 'rock' });
    const json = original.toFileJson(42);

    const restored = SongDocument.fromFileJson(json);
    expect(restored).toBeInstanceOf(SongDocument);
    expect(restored.id).toBe('round-1');
    expect(restored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(restored.createdAt).toBe('2025-12-31T23:59:59.000Z');
    expect(restored.appMeta).toEqual(original.appMeta);
    expect(restored.score.title).toBe('Round Trip');
    expect(restored.score.artist).toBe('The Band');
    expect(restored.score.tracks).toHaveLength(1);
    // もう一度書き出すと同じ song になる。
    expect(restored.toFileJson(42).song).toEqual(json.song);
  });

  it('SongDocument_fromFileJson_artistが無い古いファイルは空の文字列として読む', () => {
    // UT-CORE-SONGDOC-12 data-model-persistence.md 5 節：artist は Score.artist に持ち、古いファイルに無いときは空の文字列として読む
    const doc = makeDoc('Old File');
    doc.score.artist = 'To Be Removed';
    const json = doc.toFileJson(1);
    const song = json.song as Record<string, unknown>;
    expect(song).toHaveProperty('artist', 'To Be Removed');
    delete song.artist;
    const oldFile: SongFileJson = { ...json, song };

    const restored = SongDocument.fromFileJson(oldFile);
    expect(restored.score.artist).toBe('');
    expect(restored.score.title).toBe('Old File');
  });

  it('SongDocument_appMeta_曲名とアーティスト名とstatusを持たない', () => {
    // UT-CORE-SONGDOC-13 data-model-persistence.md 5 節：曲名・アーティスト名は Score に持ち、status という専用の項目は持たない。
    // thumbnailRef・isTrashed は曲のファイルに持たない
    const json = makeDoc().toFileJson(1);
    expect(Object.keys(json.appMeta).sort()).toEqual(['memos', 'sectionMarkers', 'settings', 'tags', 'thumbnail']);
    for (const key of ['title', 'artist', 'status', 'thumbnailRef', 'isTrashed', 'trashedAt', 'updatedAt']) {
      expect(json.appMeta).not.toHaveProperty(key);
      expect(json).not.toHaveProperty(key);
    }
  });
  // UT-CORE-SONGDOC-05・06 は欠番（本人決定 197 番 2026-10-26：SongDocument に computeChecksum を持たせない）

  it('SongDocument_toFileJson_checksumはschemaVersionとsongとappMetaだけにかける', () => {
    // UT-CORE-SONGDOC-14 data-model-persistence.md 7 節：ハッシュをかける対象は integrity を除いた {schemaVersion, song, appMeta}
    const a = makeDoc('Same');
    // 同じ Score を持ち、id・createdAt だけが違う曲。
    const b = new SongDocument({
      id: 'other-id',
      score: a.score,
      appMeta: createEmptyAppMetadata(),
      createdAt: '1999-01-01T00:00:00.000Z',
    });
    const ja = a.toFileJson(1);
    const jb = b.toFileJson(999);
    expect(ja.integrity.checksum).toBe(computeChecksum(ja.schemaVersion, ja.song, ja.appMeta));
    // id・createdAt・savedAtMonotonic が違っても、3 つが同じなら同じ値。
    expect(jb.integrity.checksum).toBe(ja.integrity.checksum);
    // appMeta が変われば変わる。
    b.appMeta.tags.push({ tagId: 't' });
    expect(b.toFileJson(999).integrity.checksum).not.toBe(ja.integrity.checksum);
  });

  it('SongDocument_fromFileJson_MasterBarのsectionをsectionMarkersから作り直す', () => {
    // UT-CORE-SONGDOC-15 data-model-persistence.md 6.1 節：マーカーの正は appMeta.sectionMarkers。
    // MasterBar.section の写しは正として読まず、曲を開くときに作り直す（G69）
    const score = makeScoreWithBars(3);
    const stale = new model.Section();
    stale.text = '古い写し';
    score.masterBars[0]!.section = stale;
    const doc = new SongDocument({ id: 's', score, appMeta: createEmptyAppMetadata() });
    doc.appMeta.sectionMarkers.push(
      { id: 'm1', barId: '1', label: 'サビ' },
      { id: 'm2', barId: '2', label: 'アウトロ' },
    );
    const json = doc.toFileJson(1);
    // 曲のファイルの song には古い写しが入っている。
    expect(JSON.stringify(json.song)).toContain('古い写し');

    const restored = SongDocument.fromFileJson(json);
    expect(restored.score.masterBars.map((mb) => mb.section?.text ?? null)).toEqual([null, 'サビ', 'アウトロ']);
    expect(restored.appMeta.sectionMarkers).toEqual(doc.appMeta.sectionMarkers);
  });

  it('SongDocument_fromFileJson_小節の番号として読めないマーカー_写さずにマーカーは残す', () => {
    // UT-CORE-SONGDOC-16 data-model-persistence.md 6.1 節：barId は Score.masterBars の番号を文字列にしたもの
    const score = makeScoreWithBars(2);
    const doc = new SongDocument({ id: 's', score, appMeta: createEmptyAppMetadata() });
    const markers: SectionMarker[] = [
      { id: 'empty', barId: '', label: '空' },
      { id: 'word', barId: 'b1', label: '文字' },
      { id: 'lead0', barId: '01', label: '先頭0' },
      { id: 'over', barId: '2', label: '範囲外' },
      { id: 'ok', barId: '0', label: 'イントロ' },
    ];
    doc.appMeta.sectionMarkers.push(...markers);

    const restored = SongDocument.fromFileJson(doc.toFileJson(1));
    expect(restored.score.masterBars.map((mb) => mb.section?.text ?? null)).toEqual(['イントロ', null]);
    expect(restored.appMeta.sectionMarkers).toEqual(markers);
  });

  it('SongDocument_読み書き_上限を超えたメモも切り詰めずにそのまま持つ', () => {
    // UT-CORE-SONGDOC-17 data-model-persistence.md 6.2 節：100 文字を超えるメモを含む古いファイルは、開いたときに切り詰めずにそのまま見せる。
    // 入力・編集して保存したとき以外の保存では、そのメモの中身に触れない
    const long = 'あ'.repeat(150);
    const doc = makeDoc('Long memo');
    const memo: Memo = { id: 'm', barId: '0', text: long, createdAt: '2026-01-01T00:00:00.000Z' };
    doc.appMeta.memos.push(memo);
    const restored = SongDocument.fromFileJson(doc.toFileJson(1));
    expect(restored.appMeta.memos[0]!.text).toBe(long);
    expect(restored.toFileJson(2).appMeta.memos[0]!.text).toBe(long);
  });

  it('createEmptyAppMetadata_settings_3つの項目でミキサーの値を持たず1小節目をはっきり入れた小節にする', () => {
    // UT-CORE-SONGDOC-18 data-model-persistence.md 6.4 節：settings は defaultViewMode・explicitTimeSignatureBars・partPresetIds を持ち、ミキサーの値を持たない。
    // editing-core.md 3.2 節：1 小節目は継ぐ先が無いので、いつも一覧に入れる
    const meta = createEmptyAppMetadata();
    expect(meta.settings).toEqual({ defaultViewMode: 'focus', explicitTimeSignatureBars: [0], partPresetIds: [] });
    expect(meta.settings).not.toHaveProperty('mixerSnapshot');
    expect(meta.thumbnail).toBeNull();
    // 呼ぶたびに別の入れ物を返す（一方を足しても他方に混ざらない）。
    meta.settings.explicitTimeSignatureBars.push(3);
    expect(createEmptyAppMetadata().settings.explicitTimeSignatureBars).toEqual([0]);
  });

  it('SongDocument_読み書き_settingsの2つの項目とサムネイルをそのまま往復する', () => {
    // UT-CORE-SONGDOC-19 data-model-persistence.md 6.4 節・6.5 節・7 節：曲のファイルの上とメモリの上で同じ形を使う
    const doc = makeDoc('Settings');
    doc.appMeta.settings.defaultViewMode = 'score';
    doc.appMeta.settings.explicitTimeSignatureBars.push(4, 9);
    doc.appMeta.settings.partPresetIds.push('preset-drop-d', null);
    doc.appMeta.thumbnail = { encoding: 'base64-png', data: 'iVBORw0KGgo=' };
    const json = doc.toFileJson(1);
    const restored = SongDocument.fromFileJson(JSON.parse(JSON.stringify(json)) as SongFileJson);
    expect(restored.appMeta.settings).toEqual({
      defaultViewMode: 'score',
      explicitTimeSignatureBars: [0, 4, 9],
      partPresetIds: ['preset-drop-d', null],
    });
    expect(restored.appMeta.thumbnail).toEqual({ encoding: 'base64-png', data: 'iVBORw0KGgo=' });
  });

  it('型_appMetaは5つ曲のファイルは6つの項目に限る', () => {
    // UT-CORE-SONGDOC-20 data-model-persistence.md 6 節・6.1〜6.5 節・7 節：型の検査（tsc -b）で確かめる。
    // 項目を足す・外す・型を変えると toEqualTypeOf が合わずに tsc が落ちる。
    expectTypeOf<keyof AppMetadata>().toEqualTypeOf<'sectionMarkers' | 'memos' | 'tags' | 'settings' | 'thumbnail'>();
    expectTypeOf<AppMetadataJson>().toEqualTypeOf<AppMetadata>();
    expectTypeOf<AppMetadata['sectionMarkers']>().toEqualTypeOf<SectionMarker[]>();
    expectTypeOf<SectionMarker>().toEqualTypeOf<{ id: string; barId: string; label: string }>();
    expectTypeOf<AppMetadata['memos']>().toEqualTypeOf<Memo[]>();
    expectTypeOf<Memo>().toEqualTypeOf<{ id: string; barId: string; text: string; createdAt: string }>();
    expectTypeOf<AppMetadata['tags']>().toEqualTypeOf<TagRef[]>();
    expectTypeOf<TagRef>().toEqualTypeOf<{ tagId: string }>();
    expectTypeOf<AppMetadata['settings']>().toEqualTypeOf<SongSettings>();
    expectTypeOf<SongSettings>().toEqualTypeOf<{
      defaultViewMode: 'focus' | 'scroll' | 'score';
      explicitTimeSignatureBars: number[];
      partPresetIds: (string | null)[];
    }>();
    expectTypeOf<AppMetadata['thumbnail']>().toEqualTypeOf<{ encoding: 'base64-png'; data: string } | null>();
    expectTypeOf<SongFileJson>().toEqualTypeOf<{
      schemaVersion: string;
      id: string;
      createdAt: string;
      song: unknown;
      appMeta: AppMetadataJson;
      integrity: { savedAtMonotonic: number; checksum: string };
    }>();
    // 実行するときの確かめ：書き出した settings の中身が型の 3 つと同じ名前だけ（appMeta の 5 つは UT-CORE-SONGDOC-13）。
    expect(Object.keys(makeDoc().toFileJson(1).appMeta.settings).sort()).toEqual([
      'defaultViewMode',
      'explicitTimeSignatureBars',
      'partPresetIds',
    ]);
  });
});
