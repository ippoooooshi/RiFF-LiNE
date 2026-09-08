// UT: playback-integration.md §4.4、05_playback_audio.md §6、C1 — MetronomeService
//
// 検証観点:
//  - playPattern：measureCount × beatsPerMeasure 回のクリック、各小節頭が accented
//  - プリセット ID / 音量を設定（PlaybackPreferencesSource）から読む
//  - 最後のクリック後は待たない（scheduler 呼び出し回数 = totalBeats - 1）
//  - 不正引数（measureCount<1 / beatsPerMeasure<1 / beatDurationMs<=0）で throw
//  - applyToSynth：enabled で音量、disabled で 0

import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakePlaybackPreferences,
  FakePlaybackSynth,
  RecordingMetronomeSink,
  createImmediateScheduler,
} from '../testing/playbackFakes';

import { MetronomeService } from './MetronomeService';

let sink: RecordingMetronomeSink;
let prefs: FakePlaybackPreferences;
let scheduler: ReturnType<typeof createImmediateScheduler>;

beforeEach(() => {
  sink = new RecordingMetronomeSink();
  prefs = new FakePlaybackPreferences({ metronomePresetId: 'electronic', metronomeVolume: 0.5 });
  scheduler = createImmediateScheduler();
});

function makeService(): MetronomeService {
  return new MetronomeService(sink, prefs, { scheduler: scheduler.schedule });
}

describe('MetronomeService.playPattern', () => {
  it('MetronomeService_PlayPatternOneMeasure_EmitsBeatsPerMeasureClicks', async () => {
    // UT: §4.4
    await makeService().playPattern(1, 4, 500);
    expect(sink.clicks).toHaveLength(4);
    expect(sink.clicks.map((c) => c.accented)).toEqual([true, false, false, false]);
  });

  it('MetronomeService_PlayPatternTwoMeasures_AccentsEachDownbeat', async () => {
    // UT: §4.4・C2（カウントイン倍率 2）
    await makeService().playPattern(2, 3, 400);
    expect(sink.clicks).toHaveLength(6);
    expect(sink.clicks.map((c) => c.accented)).toEqual([true, false, false, true, false, false]);
  });

  it('MetronomeService_PlayPattern_UsesPresetIdAndVolumeFromPreferences', async () => {
    // UT: §4.4・C1
    await makeService().playPattern(1, 2, 500);
    expect(sink.clicks.every((c) => c.presetId === 'electronic' && c.volume === 0.5)).toBe(true);
  });

  it('MetronomeService_PlayPattern_WaitsBetweenClicksButNotAfterLast', async () => {
    // UT: §4.4
    await makeService().playPattern(1, 4, 500);
    expect(scheduler.delays).toEqual([500, 500, 500]);
  });

  it('MetronomeService_PlayPatternInvalidMeasureOrBeatCount_Throws', async () => {
    // UT: §4.4
    const service = makeService();
    await expect(service.playPattern(0, 4, 500)).rejects.toThrow(RangeError);
    await expect(service.playPattern(1, 0, 500)).rejects.toThrow(RangeError);
  });

  it('MetronomeService_PlayPatternNonPositiveBeatDuration_Throws', async () => {
    // UT: §4.4
    const service = makeService();
    await expect(service.playPattern(1, 4, 0)).rejects.toThrow(RangeError);
    await expect(service.playPattern(1, 4, -10)).rejects.toThrow(RangeError);
  });

  it('MetronomeService_DefaultScheduler_ResolvesWithoutExplicitInjection', async () => {
    // UT: §4.4 — 既定 scheduler（setTimeout）でも完走する
    const service = new MetronomeService(sink, prefs);
    await service.playPattern(1, 1, 1);
    expect(sink.clicks).toHaveLength(1);
  });
});

describe('MetronomeService.applyToSynth', () => {
  it('MetronomeService_ApplyToSynthEnabled_SetsMetronomeVolumeFromPreferences', async () => {
    // UT: §4.4
    const synth = new FakePlaybackSynth();
    await makeService().applyToSynth(synth, true);
    expect(synth.metronomeVolumes.at(-1)).toBe(0.5);
  });

  it('MetronomeService_ApplyToSynthDisabled_SetsMetronomeVolumeZero', async () => {
    // UT: §4.4
    const synth = new FakePlaybackSynth();
    await makeService().applyToSynth(synth, false);
    expect(synth.metronomeVolumes.at(-1)).toBe(0);
  });
});
