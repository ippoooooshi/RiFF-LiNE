// UT: playback-integration.md §5 — AudioSyncStrategy（PartialReloadStrategy / PauseResumeStrategy）
//
// 検証観点:
//  - PartialReloadStrategy：dirty トラックのみ reloadTracks へ委譲
//  - PauseResumeStrategy：位置を控えて pause → reloadAll → seek → （再生中だったら）play
//  - PauseResumeStrategy：停止中に呼ばれた場合は play しない
//  - createDefaultAudioSyncStrategy：A4 未解決の既定は PauseResumeStrategy
//  - どちらも同じインターフェース（設定切替のみで入替可能、DoD）

import { describe, expect, it } from 'vitest';

import { makeSong } from '../testing/editingFixtures';
import { FakePlaybackSynth } from '../testing/playbackFakes';

import { PartialReloadStrategy, PauseResumeStrategy, createDefaultAudioSyncStrategy } from './AudioSyncStrategy';

const score = makeSong().score;

describe('PartialReloadStrategy', () => {
  it('PartialReloadStrategy_Sync_ReloadsOnlyDirtyTracks', () => {
    // UT: §5
    const synth = new FakePlaybackSynth();
    new PartialReloadStrategy().sync([1, 3], { synth, score });
    expect(synth.reloadTracksCalls).toEqual([{ trackIndices: [1, 3], score }]);
    expect(synth.reloadAllCalls).toHaveLength(0);
  });

  it('PartialReloadStrategy_Kind_IsPartialReload', () => {
    expect(new PartialReloadStrategy().kind).toBe('partial-reload');
  });
});

describe('PauseResumeStrategy', () => {
  it('PauseResumeStrategy_SyncWhilePlaying_PausesReloadsSeeksBackAndResumes', () => {
    // UT: §5 — 一旦停止して最新データで即再開（境界の数十 ms 空白は許容）
    const synth = new FakePlaybackSynth();
    synth.isPlaying = true;
    synth.currentTick = 4200;
    new PauseResumeStrategy().sync([0], { synth, score });
    expect(synth.calls).toEqual(['pause', 'seekTick:4200', 'play']);
    expect(synth.reloadAllCalls).toEqual([score]);
  });

  it('PauseResumeStrategy_SyncWhileNotPlaying_DoesNotResume', () => {
    // UT: §5
    const synth = new FakePlaybackSynth();
    synth.isPlaying = false;
    synth.currentTick = 1000;
    new PauseResumeStrategy().sync([0], { synth, score });
    expect(synth.calls).toEqual(['pause', 'seekTick:1000']);
    expect(synth.calls).not.toContain('play');
  });

  it('PauseResumeStrategy_Kind_IsPauseResume', () => {
    expect(new PauseResumeStrategy().kind).toBe('pause-resume');
  });
});

describe('createDefaultAudioSyncStrategy', () => {
  it('createDefaultAudioSyncStrategy_Default_IsPauseResumeStrategy', () => {
    // UT: §5 — A4 未解決のため PauseResumeStrategy が既定
    const strategy = createDefaultAudioSyncStrategy();
    expect(strategy).toBeInstanceOf(PauseResumeStrategy);
    expect(strategy.kind).toBe('pause-resume');
  });
});
