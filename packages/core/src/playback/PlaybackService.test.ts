// UT: playback-integration.md §4.1・§3.2・§3.3 — PlaybackService
//
// 検証観点:
//  - preWarm：初回のみ loadSoundFont、2 回目は同じ Promise、失敗時の再 throw / onPreWarmError
//  - play / pause / stop / seekToBar / isPlaying の委譲
//  - setRegionLoop：端点の順序非依存、tick レンジ計算、setPlaybackRange + setLooping(true)
//  - setSectionLoop：次セクション手前まで / セクション無しは曲末まで
//  - clearLoop：looping OFF・range null
//  - setSoloTracks：全チャンネルへ solo ON/OFF
//  - setTempoFactor：正値で委譲、0 以下・非有限で throw
//  - resolvePlaybackPitch：computeRealMidiPitch（開放弦 + capo + fret、弦番号規約 G22）
//  - ループ境界再シーク：looping 中 & 非 seek & 終端到達で開始 tick へ、seek 由来は無視
//  - dispose：位置イベント購読解除

import { model } from '@coderline/alphatab';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeSong } from '../testing/editingFixtures';
import { FakePlaybackSynth, FakeTickMap } from '../testing/playbackFakes';

import { PlaybackService } from './PlaybackService';

let synth: FakePlaybackSynth;
let tickMap: FakeTickMap;

beforeEach(() => {
  synth = new FakePlaybackSynth();
  tickMap = new FakeTickMap(); // 1 小節 = 1000 tick、8 小節
});

function makeService(score = makeSong().score): PlaybackService {
  return new PlaybackService(synth, tickMap, score);
}

describe('PlaybackService.preWarm', () => {
  it('PlaybackService_PreWarmCalledTwice_LoadsSoundFontOnce', async () => {
    // UT: §3.3
    const service = makeService();
    const first = service.preWarm();
    const second = service.preWarm();
    expect(second).toBe(first);
    await first;
    expect(synth.loadSoundFontCallCount).toBe(1);
  });

  it('PlaybackService_PreWarmFails_RethrowsWhenNoHandler', async () => {
    // UT: §3.3
    synth.loadSoundFontError = new Error('sf failed');
    const service = makeService();
    await expect(service.preWarm()).rejects.toThrow('sf failed');
  });

  it('PlaybackService_PreWarmFailsWithHandler_InvokesHandlerAndResolves', async () => {
    // UT: §3.3
    synth.loadSoundFontError = new Error('sf failed');
    const onPreWarmError = vi.fn();
    const service = new PlaybackService(synth, tickMap, makeSong().score, { onPreWarmError });
    await expect(service.preWarm()).resolves.toBeUndefined();
    expect(onPreWarmError).toHaveBeenCalledOnce();
  });
});

describe('PlaybackService transport controls', () => {
  it('PlaybackService_Play_DelegatesToSynth', () => {
    makeService().play();
    expect(synth.calls).toContain('play');
    expect(synth.isPlaying).toBe(true);
  });

  it('PlaybackService_Pause_DelegatesToSynth', () => {
    const service = makeService();
    service.play();
    service.pause();
    expect(synth.calls).toContain('pause');
  });

  it('PlaybackService_Stop_DelegatesToSynth', () => {
    makeService().stop();
    expect(synth.calls).toContain('stop');
  });

  it('PlaybackService_SeekToBar_SeeksToBarStartTick', () => {
    makeService().seekToBar(3);
    expect(synth.seekTicks).toEqual([3000]);
  });

  it('PlaybackService_IsPlaying_ReflectsSynthState', () => {
    const service = makeService();
    expect(service.isPlaying).toBe(false);
    synth.isPlaying = true;
    expect(service.isPlaying).toBe(true);
  });
});

describe('PlaybackService loop', () => {
  it('PlaybackService_SetRegionLoop_AppliesTickRangeAndLooping', () => {
    // UT: §4.1 — 小節 [2,4] → tick [2000, 5000)
    makeService().setRegionLoop(2, 4);
    expect(synth.playbackRanges.at(-1)).toEqual({ startTick: 2000, endTick: 5000 });
    expect(synth.loopingValues.at(-1)).toBe(true);
  });

  it('PlaybackService_SetRegionLoopWithSwappedEndpoints_NormalizesOrder', () => {
    // UT: §4.1
    makeService().setRegionLoop(4, 2);
    expect(synth.playbackRanges.at(-1)).toEqual({ startTick: 2000, endTick: 5000 });
  });

  it('PlaybackService_SetSectionLoop_LoopsUntilNextSectionStart', () => {
    // UT: §4.1・05_playback_audio.md §3.1
    const { score } = makeSong();
    score.addMasterBar(new model.MasterBar());
    score.addMasterBar(new model.MasterBar());
    score.addMasterBar(new model.MasterBar());
    score.masterBars[1]!.section = new model.Section();
    score.masterBars[3]!.section = new model.Section();
    makeService(score).setSectionLoop(1);
    // セクションは小節 1〜2（小節 3 が次のセクション開始）→ tick [1000, 3000)
    expect(synth.playbackRanges.at(-1)).toEqual({ startTick: 1000, endTick: 3000 });
  });

  it('PlaybackService_SetSectionLoopWithoutFollowingSection_LoopsUntilEnd', () => {
    // UT: §4.1
    const { score } = makeSong();
    score.addMasterBar(new model.MasterBar());
    score.masterBars[0]!.section = new model.Section();
    makeService(score).setSectionLoop(0);
    expect(synth.playbackRanges.at(-1)).toEqual({ startTick: 0, endTick: 2000 });
  });

  it('PlaybackService_ClearLoop_DisablesLoopingAndRange', () => {
    // UT: §4.1
    const service = makeService();
    service.setRegionLoop(1, 2);
    service.clearLoop();
    expect(synth.loopingValues.at(-1)).toBe(false);
    expect(synth.playbackRanges.at(-1)).toBeNull();
  });
});

describe('PlaybackService loop boundary re-seek', () => {
  it('PlaybackService_PositionReachesLoopEndWhilePlaying_SeeksToLoopStart', () => {
    // UT: §4.1 — 境界到達で開始小節の先頭へシークし直す
    const service = makeService();
    service.setRegionLoop(1, 2); // [1000, 3000)
    synth.emitPosition({ currentTick: 3000 });
    expect(synth.seekTicks.at(-1)).toBe(1000);
  });

  it('PlaybackService_PositionBelowLoopEnd_DoesNotSeek', () => {
    // UT: §4.1
    const service = makeService();
    service.setRegionLoop(1, 2);
    synth.emitPosition({ currentTick: 2500 });
    expect(synth.seekTicks).toHaveLength(0);
  });

  it('PlaybackService_SeekOriginatedPositionEvent_Ignored', () => {
    // UT: §4.1 — 無限ループ防止
    const service = makeService();
    service.setRegionLoop(1, 2);
    synth.emitPosition({ currentTick: 3000, isSeek: true });
    expect(synth.seekTicks).toHaveLength(0);
  });

  it('PlaybackService_NoLoopConfigured_PositionEventDoesNothing', () => {
    // UT: §4.1
    makeService();
    synth.emitPosition({ currentTick: 9999 });
    expect(synth.seekTicks).toHaveLength(0);
  });
});

describe('PlaybackService solo & tempo', () => {
  it('PlaybackService_SetSoloTracks_TogglesEveryChannel', () => {
    // UT: §4.1・05_playback_audio.md §2
    const { score } = makeSong(3);
    makeService(score).setSoloTracks([1]);
    expect(synth.channelSolo.get(0)).toBe(false);
    expect(synth.channelSolo.get(1)).toBe(true);
    expect(synth.channelSolo.get(2)).toBe(false);
  });

  it('PlaybackService_SetSoloTracksEmpty_ClearsAllSolo', () => {
    // UT: §4.1
    const { score } = makeSong(2);
    makeService(score).setSoloTracks([]);
    expect(synth.channelSolo.get(0)).toBe(false);
    expect(synth.channelSolo.get(1)).toBe(false);
  });

  it('PlaybackService_SetTempoFactorPositive_DelegatesToSynth', () => {
    // UT: §4.1・05_playback_audio.md §4
    makeService().setTempoFactor(0.5);
    expect(synth.playbackSpeeds).toEqual([0.5]);
  });

  it('PlaybackService_SetTempoFactorZeroOrNegativeOrNaN_Throws', () => {
    // UT: §4.1
    const service = makeService();
    expect(() => service.setTempoFactor(0)).toThrow(RangeError);
    expect(() => service.setTempoFactor(-1)).toThrow(RangeError);
    expect(() => service.setTempoFactor(Number.NaN)).toThrow(RangeError);
  });
});

describe('PlaybackService.resolvePlaybackPitch', () => {
  it('PlaybackService_ResolvePlaybackPitchNoCapo_ReturnsOpenStringPlusFret', () => {
    // UT: §3.2 — 標準チューニング 6 弦（stringNumber=6 は最高音弦 e4=64）
    const { score } = makeSong();
    const pitch = makeService(score).resolvePlaybackPitch(0, { string: 6, fret: 3 });
    expect(pitch).toBe(67);
  });

  it('PlaybackService_ResolvePlaybackPitchLowestString_UsesStringNumberConvention', () => {
    // UT: §3.2・G22 — stringNumber=1 は最低音弦 E2=40
    const { score } = makeSong();
    const pitch = makeService(score).resolvePlaybackPitch(0, { string: 1, fret: 0 });
    expect(pitch).toBe(40);
  });

  it('PlaybackService_ResolvePlaybackPitchWithCapo_AddsCapoFret', () => {
    // UT: §3.2 — capo は staff.capo から取得
    const { score } = makeSong();
    score.tracks[0]!.staves[0]!.capo = 2;
    const pitch = makeService(score).resolvePlaybackPitch(0, { string: 1, fret: 5 });
    expect(pitch).toBe(47); // 40 + 2 + 5
  });
});

describe('PlaybackService.dispose', () => {
  it('PlaybackService_Dispose_UnsubscribesPositionListener', () => {
    // UT: §4.1
    const service = makeService();
    expect(synth.positionListenerCount).toBe(1);
    service.dispose();
    expect(synth.positionListenerCount).toBe(0);
  });
});
