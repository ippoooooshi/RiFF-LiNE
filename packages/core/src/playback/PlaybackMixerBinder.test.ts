// UT/IT: playback-integration.md §4.3・§6.2・§7 — PlaybackMixerBinder
//
// 検証観点:
//  - onCommandApplied 購読 / dispose で解除
//  - syncAll：全トラックの volume / pan / solo を送る（冪等・一律再送、§4.3）
//  - ソロ優先：ソロ 1 つ以上で「ソロ対象外」を実効ミュート、明示ミュートは常に尊重（B35）
//  - §7 結合観点：Undo/Redo でミキサー値が変わるケースで冪等に追従する（実 CommandHistory + 実コマンド）

import { model } from '@coderline/alphatab';
import { beforeEach, describe, expect, it } from 'vitest';

import { CommandHistory } from '../editing/CommandHistory';
import { getMixer } from '../parts/partModel';
import { SetPartSoloCommand, SetPartVolumeCommand } from '../parts/commands/partAttributeCommands';
import { makeSong } from '../testing/editingFixtures';
import { RecordingRenderRequester, RecordingReporter } from '../testing/editingFakes';
import { FakeCommandAppliedSource, FakePlaybackSynth } from '../testing/playbackFakes';

import { PlaybackMixerBinder } from './PlaybackMixerBinder';

let synth: FakePlaybackSynth;
let history: FakeCommandAppliedSource;
let score: model.Score;

beforeEach(() => {
  synth = new FakePlaybackSynth();
  history = new FakeCommandAppliedSource();
  score = makeSong(3).score;
});

describe('PlaybackMixerBinder subscription', () => {
  it('PlaybackMixerBinder_Constructor_SubscribesToCommandApplied', () => {
    // UT: §4.3
    new PlaybackMixerBinder(synth, history, score);
    expect(history.listenerCount).toBe(1);
  });

  it('PlaybackMixerBinder_Dispose_Unsubscribes', () => {
    // UT: §4.3
    const binder = new PlaybackMixerBinder(synth, history, score);
    binder.dispose();
    expect(history.listenerCount).toBe(0);
  });

  it('PlaybackMixerBinder_CommandApplied_TriggersFullResync', () => {
    // UT: §4.3 — 通知のたびに全チャンネルへ再送
    new PlaybackMixerBinder(synth, history, score);
    score.tracks[1]!.playbackInfo.volume = 12;
    history.emit([1]);
    expect(synth.channelVolume.get(1)).toBe(12);
    // affected でないトラックも毎回まるごと送る
    expect(synth.channelVolume.has(0)).toBe(true);
    expect(synth.channelVolume.has(2)).toBe(true);
  });
});

describe('PlaybackMixerBinder.syncAll', () => {
  it('PlaybackMixerBinder_SyncAllNoSolo_SendsVolumePanSoloAndRawMute', () => {
    // UT: §4.3
    score.tracks[0]!.playbackInfo.volume = 9;
    score.tracks[0]!.playbackInfo.balance = 4;
    score.tracks[1]!.playbackInfo.isMute = true;
    const binder = new PlaybackMixerBinder(synth, history, score);
    binder.syncAll();
    expect(synth.channelVolume.get(0)).toBe(9);
    expect(synth.channelPan.get(0)).toBe(4);
    expect(synth.channelMute.get(0)).toBe(false);
    expect(synth.channelMute.get(1)).toBe(true);
    expect(synth.channelSolo.get(0)).toBe(false);
  });

  it('PlaybackMixerBinder_SyncAllWithSolo_MutesNonSoloTracks', () => {
    // UT: §4.3・05_playback_audio.md §2 — ソロ優先
    score.tracks[1]!.playbackInfo.isSolo = true;
    const binder = new PlaybackMixerBinder(synth, history, score);
    binder.syncAll();
    expect(synth.channelMute.get(0)).toBe(true); // ソロ対象外 → 実効ミュート
    expect(synth.channelMute.get(1)).toBe(false); // ソロ対象
    expect(synth.channelMute.get(2)).toBe(true);
    expect(synth.channelSolo.get(1)).toBe(true);
  });

  it('PlaybackMixerBinder_SyncAllWithSoloAndExplicitMuteOnSoloTrack_KeepsMuted', () => {
    // UT: §4.3・13_design_decision_points.md B35（2026-09-09 設計オーナー裁定）
    //   — 同一トラックに明示ミュートとソロが両立する場合は明示ミュートを優先（無音のまま）。
    //   solo はソロ対象「以外」を内部ミュートする機能で、ユーザーの明示ミュートを上書きしない。
    score.tracks[1]!.playbackInfo.isSolo = true;
    score.tracks[1]!.playbackInfo.isMute = true;
    const binder = new PlaybackMixerBinder(synth, history, score);
    binder.syncAll();
    expect(synth.channelMute.get(1)).toBe(true);
  });

  it('PlaybackMixerBinder_SyncAllIsIdempotent_RepeatedCallsSameResult', () => {
    // UT: §4.3 — 冪等（同じ値を送るだけで実害なし）
    const binder = new PlaybackMixerBinder(synth, history, score);
    binder.syncAll();
    const snapshot = new Map(synth.channelVolume);
    binder.syncAll();
    expect(synth.channelVolume).toEqual(snapshot);
  });
});

describe('PlaybackMixerBinder integration with CommandHistory (Undo/Redo)', () => {
  function realHistory(): { commandHistory: CommandHistory; render: RecordingRenderRequester } {
    const render = new RecordingRenderRequester();
    const commandHistory = new CommandHistory(render, new RecordingReporter());
    return { commandHistory, render };
  }

  it('PlaybackMixerBinder_VolumeCommandThenUndoRedo_TracksModelValueEachTime', () => {
    // IT: §7 — Undo/Redo でミキサー値が変わるケースに冪等追従
    const { commandHistory } = realHistory();
    const originalVolume = getMixer(score, 0).volume;
    new PlaybackMixerBinder(synth, commandHistory, score);

    commandHistory.execute(new SetPartVolumeCommand(score, 0, 15));
    expect(synth.channelVolume.get(0)).toBe(15);

    commandHistory.undo();
    expect(synth.channelVolume.get(0)).toBe(originalVolume);

    commandHistory.redo();
    expect(synth.channelVolume.get(0)).toBe(15);
  });

  it('PlaybackMixerBinder_SoloCommandThenUndo_RecomputesEffectiveMute', () => {
    // IT: §7 — ソロ ON→OFF（Undo）で実効ミュートが戻る
    const { commandHistory } = realHistory();
    new PlaybackMixerBinder(synth, commandHistory, score);

    commandHistory.execute(new SetPartSoloCommand(score, 1, true));
    expect(synth.channelMute.get(0)).toBe(true);
    expect(synth.channelMute.get(2)).toBe(true);

    commandHistory.undo();
    expect(synth.channelMute.get(0)).toBe(false);
    expect(synth.channelMute.get(2)).toBe(false);
  });
});
