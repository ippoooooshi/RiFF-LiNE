// UT: playback-integration.md §4.4・§6.3、C2 — CountInController
//
// 検証観点:
//  - start：倍率 1（既定）で 1 小節、倍率 2 で 2 小節ぶんのクリック → 完了後 play()
//  - beatDurationMs = 60000 / bpm を MetronomeService へ渡す
//  - cancel 後は play() を呼ばない
//  - bpm / beatsPerMeasure が非正なら throw、多重 start で throw

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakePlaybackPreferences, RecordingMetronomeSink, createImmediateScheduler } from '../testing/playbackFakes';

import { CountInController } from './CountInController';
import { MetronomeService } from './MetronomeService';

let sink: RecordingMetronomeSink;
let prefs: FakePlaybackPreferences;
let metronome: MetronomeService;
let play: ReturnType<typeof makePlayMock>;

function makePlayMock() {
  return vi.fn((): void => undefined);
}

beforeEach(() => {
  sink = new RecordingMetronomeSink();
  prefs = new FakePlaybackPreferences();
  metronome = new MetronomeService(sink, prefs, { scheduler: createImmediateScheduler().schedule });
  play = makePlayMock();
});

function makeController(): CountInController {
  return new CountInController(metronome, { play }, prefs);
}

describe('CountInController.start', () => {
  it('CountInController_DefaultMultiplier_PlaysOneMeasureThenStartsPlayback', async () => {
    // UT: §6.3・C2（既定 1 小節）
    await makeController().start({ beatsPerMeasure: 4, bpm: 120 });
    expect(sink.clicks).toHaveLength(4);
    expect(play).toHaveBeenCalledOnce();
  });

  it('CountInController_MultiplierTwo_PlaysTwoMeasures', async () => {
    // UT: §6.3・C2（2 小節倍率）
    prefs.set({ countInMeasureMultiplier: 2 });
    await makeController().start({ beatsPerMeasure: 3, bpm: 90 });
    expect(sink.clicks).toHaveLength(6);
    expect(play).toHaveBeenCalledOnce();
  });

  it('CountInController_OutOfRangeMultiplier_FallsBackToOneMeasure', async () => {
    // UT: §6.3 — 範囲外倍率は 1 小節へ丸め
    prefs.set({ countInMeasureMultiplier: 5 as 1 | 2 });
    await makeController().start({ beatsPerMeasure: 4, bpm: 120 });
    expect(sink.clicks).toHaveLength(4);
  });

  it('CountInController_CancelledDuringClicks_DoesNotStartPlayback', async () => {
    // UT: §6.3 — カウントイン進行中に cancel されたら再生を開始しない
    let releaseNextClick: () => void = () => undefined;
    const deferredScheduler = (): Promise<void> =>
      new Promise<void>((resolve) => {
        releaseNextClick = resolve;
      });
    const controller = new CountInController(
      new MetronomeService(sink, prefs, { scheduler: deferredScheduler }),
      { play },
      prefs,
    );

    const started = controller.start({ beatsPerMeasure: 4, bpm: 120 });
    await Promise.resolve(); // 最初のクリックまで進める
    controller.cancel();
    // 残りのクリックを流し切る
    for (let i = 0; i < 4; i += 1) {
      releaseNextClick();
      await Promise.resolve();
    }
    await started;
    expect(play).not.toHaveBeenCalled();
  });

  it('CountInController_NonPositiveBpmOrBeats_Throws', async () => {
    // UT: §6.3
    const controller = makeController();
    await expect(controller.start({ beatsPerMeasure: 4, bpm: 0 })).rejects.toThrow(RangeError);
    await expect(controller.start({ beatsPerMeasure: 0, bpm: 120 })).rejects.toThrow(RangeError);
  });

  it('CountInController_StartWhileRunning_Throws', async () => {
    // UT: §6.3 — 多重起動防止
    const controller = makeController();
    const first = controller.start({ beatsPerMeasure: 4, bpm: 120 });
    await expect(controller.start({ beatsPerMeasure: 4, bpm: 120 })).rejects.toThrow(/already running/);
    await first;
  });

  it('CountInController_AfterCompletion_CanStartAgain', async () => {
    // UT: §6.3 — running フラグが finally で解除される
    const controller = makeController();
    await controller.start({ beatsPerMeasure: 2, bpm: 120 });
    await controller.start({ beatsPerMeasure: 2, bpm: 120 });
    expect(play).toHaveBeenCalledTimes(2);
  });
});
