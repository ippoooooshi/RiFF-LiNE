// UT: playback-integration.md §4.4、05_playback_audio.md §6 — TapTempoController
//
// 検証観点:
//  - tap：1 回目は null、2 回目以降で直近 sampleSize 件の平均間隔から BPM
//  - TAP_RESET_GAP_MS 超のギャップで履歴リセット
//  - BPM が入力可能範囲外ならクランプ（MIN/MAX_TEMPO_BPM）
//  - refreshPreferences：感度パラメータ（平均タップ数）を [MIN,MAX] にクランプ
//  - commit：推定 BPM で SetTempoCommand を history へ発行、未確定なら false
//  - reset：履歴と推定値を捨てる

import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '../editing/commands/SetTempoCommand';
import { makeSong } from '../testing/editingFixtures';
import { FakePlaybackPreferences, RecordingTempoCommandSink } from '../testing/playbackFakes';

import { MAX_TAP_SAMPLE_SIZE, MIN_TAP_SAMPLE_SIZE, TapTempoController } from './TapTempoController';

let clock: number;
let history: RecordingTempoCommandSink;
let prefs: FakePlaybackPreferences;

function makeController(overrides: Partial<{ tapTempoSampleSize: number }> = {}): TapTempoController {
  prefs = new FakePlaybackPreferences(overrides);
  history = new RecordingTempoCommandSink();
  return new TapTempoController({ history, target: makeSong(), preferences: prefs, now: () => clock });
}

beforeEach(() => {
  clock = 1000;
});

describe('TapTempoController.tap', () => {
  it('TapTempoController_FirstTap_ReturnsNull', () => {
    // UT: §4.4
    expect(makeController().tap()).toBeNull();
  });

  it('TapTempoController_TwoTaps500msApart_Estimates120Bpm', () => {
    // UT: §4.4 — 60000 / 500 = 120
    const controller = makeController();
    controller.tap();
    clock += 500;
    expect(controller.tap()).toBe(120);
    expect(controller.currentBpm).toBe(120);
  });

  it('TapTempoController_FourEvenTaps_AveragesIntervals', () => {
    // UT: §4.4 — 直近 4 件（間隔 3 つ）の平均
    const controller = makeController();
    controller.tap();
    clock += 400;
    controller.tap();
    clock += 600;
    controller.tap();
    clock += 500;
    expect(controller.tap()).toBe(120); // 平均間隔 500ms → 120 BPM
  });

  it('TapTempoController_GapLongerThanResetWindow_RestartsHistory', () => {
    // UT: §4.4 — 別フレーズの叩き直し
    const controller = makeController();
    controller.tap();
    clock += 500;
    controller.tap(); // 120 BPM
    clock += 5000; // > TAP_RESET_GAP_MS
    expect(controller.tap()).toBeNull(); // 履歴リセット、1 タップのみ
    expect(controller.currentBpm).toBeNull();
  });

  it('TapTempoController_VeryFastTaps_ClampsToMaxTempo', () => {
    // UT: §4.4 — 10ms 間隔 → 6000 BPM → MAX へクランプ
    const controller = makeController();
    controller.tap();
    clock += 10;
    expect(controller.tap()).toBe(MAX_TEMPO_BPM);
  });

  it('TapTempoController_SlowTapsWithinResetWindow_ProducesLowBpmNotBelowMin', () => {
    // UT: §4.4 — reset 窓（2000ms）内の最も遅い間隔でも下限 MIN_TEMPO_BPM を下回らない
    const controller = makeController();
    controller.tap();
    clock += 1999; // 60000 / 1999 ≈ 30 BPM
    const bpm = controller.tap();
    expect(bpm).toBe(30);
    expect(bpm).toBeGreaterThanOrEqual(MIN_TEMPO_BPM);
  });

  it('TapTempoController_DefaultClock_EstimatesWithoutInjectedNow', () => {
    // UT: §4.4 — now を注入せず既定（performance.now/Date.now）で構築できる。
    // 同期連続タップは間隔ほぼ 0 → MAX_TEMPO_BPM へクランプされ、例外なく確定値を返す。
    const controller = new TapTempoController({
      history: new RecordingTempoCommandSink(),
      target: makeSong(),
      preferences: new FakePlaybackPreferences(),
    });
    controller.tap();
    expect(controller.tap()).toBe(MAX_TEMPO_BPM);
  });

  it('TapTempoController_KeepsOnlyRecentSampleSizeTaps', async () => {
    // UT: §4.4 — 古いタップは平均に含めない（sampleSize=2 で直近 1 間隔のみ）
    const controller = makeController({ tapTempoSampleSize: 2 });
    await controller.refreshPreferences();
    controller.tap();
    clock += 1000; // 60 BPM 相当の間隔（使われない）
    controller.tap();
    clock += 300; // 200 BPM 相当（これが採用される）
    expect(controller.tap()).toBe(200);
  });
});

describe('TapTempoController.refreshPreferences', () => {
  it('TapTempoController_RefreshPreferences_ClampsSampleSizeIntoRange', async () => {
    // UT: §4.4
    const controller = makeController({ tapTempoSampleSize: 99 });
    await controller.refreshPreferences();
    // クランプ確認：99 → MAX_TAP_SAMPLE_SIZE。多数の等間隔タップでも例外なく推定できる
    controller.tap();
    for (let i = 0; i < MAX_TAP_SAMPLE_SIZE + 2; i += 1) {
      clock += 500;
      controller.tap();
    }
    expect(controller.currentBpm).toBe(120);
  });

  it('TapTempoController_RefreshPreferencesTooSmall_ClampsToMin', async () => {
    // UT: §4.4
    const controller = makeController({ tapTempoSampleSize: 0 });
    await controller.refreshPreferences();
    controller.tap();
    clock += 500;
    controller.tap();
    clock += 250;
    // sampleSize = MIN_TAP_SAMPLE_SIZE(2) → 直近 1 間隔（250ms → 240 BPM）
    expect(controller.tap()).toBe(240);
    expect(MIN_TAP_SAMPLE_SIZE).toBe(2);
  });

  it('TapTempoController_RefreshPreferencesNonFinite_FallsBackToDefault', async () => {
    // UT: §4.4
    const controller = makeController({ tapTempoSampleSize: Number.NaN });
    await controller.refreshPreferences();
    controller.tap();
    clock += 500;
    expect(controller.tap()).toBe(120);
  });
});

describe('TapTempoController.commit / reset', () => {
  it('TapTempoController_CommitWithEstimate_ExecutesSetTempoCommand', () => {
    // UT: §4.4 — 対象曲の CommandHistory 経由で SetTempoCommand
    const controller = makeController();
    controller.tap();
    clock += 500;
    controller.tap(); // 120 BPM
    expect(controller.commit(0)).toBe(true);
    expect(history.executed).toHaveLength(1);
    expect(history.executed[0]!.kind).toBe('set-tempo');
  });

  it('TapTempoController_CommitWithoutEstimate_ReturnsFalse', () => {
    // UT: §4.4
    const controller = makeController();
    controller.tap();
    expect(controller.commit(0)).toBe(false);
    expect(history.executed).toHaveLength(0);
  });

  it('TapTempoController_Reset_ClearsHistoryAndEstimate', () => {
    // UT: §4.4
    const controller = makeController();
    controller.tap();
    clock += 500;
    controller.tap();
    controller.reset();
    expect(controller.currentBpm).toBeNull();
    clock += 500;
    expect(controller.tap()).toBeNull(); // 履歴が空なので 1 タップ扱い
  });

  it('TapTempoController_CommitBoundsCheck_UsesIsValidTempoBpm', () => {
    // UT: §4.4 — クランプ後の値は常に [MIN,MAX] なので commit 可能
    const controller = makeController();
    controller.tap();
    clock += 10;
    controller.tap(); // MAX へクランプ
    expect(controller.currentBpm).toBe(MAX_TEMPO_BPM);
    expect(controller.commit(0)).toBe(true);
  });
});
