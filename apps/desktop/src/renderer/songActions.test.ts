// UT-SONGACT: songActions（screens-navigation.md §4.8 #1・#2、§5.2、§3.5）
// 検証節: screens-navigation.md §5.2（新規曲作成 → 編集ウィンドウ）、§3.5（SONG-001 / SONG-002 の発火・拒否）
import { SONG_COUNT_LIMIT, SONG_COUNT_WARN_THRESHOLD, type NewSongSetup } from '@riff-line/core';
import { describe, expect, it, vi } from 'vitest';

import { createSongAndOpen, warnIfNearSongLimit, type SongCreationDeps } from './songActions';

const SETUP: NewSongSetup = {
  title: 't',
  parts: [{ name: 'G', instrumentType: 'electric_guitar', tuning: [64, 59, 55, 50, 45, 40] }],
};

function makeDeps(count: number): SongCreationDeps {
  return {
    countActiveSongs: () => count,
    createSong: vi.fn<(setup: NewSongSetup) => Promise<string>>(async () => 'song-new'),
    openSong: vi.fn<(songId: string) => Promise<void>>(async () => undefined),
    report: vi.fn<(code: string, context?: Record<string, unknown>) => void>(),
  };
}

describe('createSongAndOpen', () => {
  it('createSongAndOpen_通常時_作成して編集ウィンドウを開き曲IDを返す', async () => {
    // UT-SONGACT-01 §5.2
    const deps = makeDeps(5);
    const id = await createSongAndOpen(deps, SETUP);
    expect(id).toBe('song-new');
    expect(deps.createSong).toHaveBeenCalledWith(SETUP);
    expect(deps.openSong).toHaveBeenCalledWith('song-new');
    expect(deps.report).not.toHaveBeenCalled();
  });

  it('createSongAndOpen_上限1000件到達_作成せずSONG-002を発行しnull（C12・C2境界）', async () => {
    // UT-SONGACT-02 §3.5（SONG-002 = Error、拒否）
    const deps = makeDeps(SONG_COUNT_LIMIT);
    const id = await createSongAndOpen(deps, SETUP);
    expect(id).toBeNull();
    expect(deps.createSong).not.toHaveBeenCalled();
    expect(deps.openSong).not.toHaveBeenCalled();
    expect(deps.report).toHaveBeenCalledWith('SONG-002', { count: SONG_COUNT_LIMIT });
  });

  it('createSongAndOpen_999件_上限未満なので作成し、作成後1000件でSONG-001（C2境界）', async () => {
    // UT-SONGACT-03 §3.5（上限直前は作成可、警告は出る）
    const deps = makeDeps(SONG_COUNT_LIMIT - 1);
    const id = await createSongAndOpen(deps, SETUP);
    expect(id).toBe('song-new');
    expect(deps.createSong).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledWith('SONG-001', { count: SONG_COUNT_LIMIT });
  });

  it('createSongAndOpen_作成後に警告しきい値到達_SONG-001を発行（C2境界: 899→900）', async () => {
    // UT-SONGACT-04 §3.5（SONG-001 = Warning、拒否なし）
    const deps = makeDeps(SONG_COUNT_WARN_THRESHOLD - 1);
    await createSongAndOpen(deps, SETUP);
    expect(deps.report).toHaveBeenCalledWith('SONG-001', { count: SONG_COUNT_WARN_THRESHOLD });
    expect(deps.openSong).toHaveBeenCalled();
  });

  it('createSongAndOpen_しきい値未満_SONG-001を発行しない（C2境界: 898→899）', async () => {
    // UT-SONGACT-05 §3.5
    const deps = makeDeps(SONG_COUNT_WARN_THRESHOLD - 2);
    await createSongAndOpen(deps, SETUP);
    expect(deps.report).not.toHaveBeenCalled();
  });

  it('createSongAndOpen_countActiveSongsがPromiseでも待つ', async () => {
    // UT-SONGACT-06 §5.2（非同期 dep）
    const deps = { ...makeDeps(0), countActiveSongs: () => Promise.resolve(3) };
    const id = await createSongAndOpen(deps, SETUP);
    expect(id).toBe('song-new');
  });
});

describe('warnIfNearSongLimit', () => {
  it('warnIfNearSongLimit_しきい値到達でSONG-001（C2境界: 900）', () => {
    // UT-SONGACT-07 §3.5（曲一覧ロード時）
    const report = vi.fn();
    warnIfNearSongLimit(SONG_COUNT_WARN_THRESHOLD, report);
    expect(report).toHaveBeenCalledWith('SONG-001', { count: SONG_COUNT_WARN_THRESHOLD });
  });

  it('warnIfNearSongLimit_しきい値未満は無発行（C2境界: 899）', () => {
    // UT-SONGACT-08 §3.5
    const report = vi.fn();
    warnIfNearSongLimit(SONG_COUNT_WARN_THRESHOLD - 1, report);
    expect(report).not.toHaveBeenCalled();
  });
});
