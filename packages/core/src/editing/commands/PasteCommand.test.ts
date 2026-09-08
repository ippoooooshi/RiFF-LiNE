// UT-EDIT-PASTE: editing-core.md §6.4・§10.4、04_editing_core.md §9、B3 — PasteCommand / ClipboardService
// 検証観点（C2）: コピー→ペーストの往復、弦数不足で EDIT-009＋破棄、弦数過多で警告なし、undo で完全復元。

import { describe, expect, it } from 'vitest';

import { model } from '@coderline/alphatab';

import { PasteCommand } from './PasteCommand';
import { PlaceNoteCommand } from './PlaceNoteCommand';
import { createEmptyAppMetadata } from '../../domain/SongDocument';
import { createInitialScore } from '../../domain/newSong';
import { ClipboardService } from '../ClipboardService';
import { getBeat, getVoice, getBar } from '../scoreModel';
import type { EditTarget } from '../types';
import { buildEditTarget, RecordingReporter, scoreJson } from '../../testing/editingFakes';

/** track0 = 6弦ギター、track1 = 4弦ベースの target。 */
function guitarAndBass(): EditTarget {
  const score = createInitialScore({
    title: 'GB',
    parts: [
      { name: 'Guitar', instrumentType: 'electric_guitar', tuning: [64, 59, 55, 50, 45, 40] },
      { name: 'Bass', instrumentType: 'bass', tuning: [43, 38, 33, 28] },
    ],
  });
  return { score, appMeta: createEmptyAppMetadata() };
}

describe('ClipboardService + PasteCommand', () => {
  it('copyThenPaste_SamePart_RoundTrips_UndoRestores', () => {
    const target = buildEditTarget();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 3, 5, model.Duration.Quarter).execute();
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 1 }, 3, 7, model.Duration.Quarter).execute();
    const before = scoreJson(target);

    const clip = new ClipboardService();
    clip.copy(target, { trackIndex: 0, startBarIndex: 0, startBeatIndex: 0, endBarIndex: 0, endBeatIndex: 1 });
    expect(clip.hasContent()).toBe(true);

    const reporter = new RecordingReporter();
    const paste = new PasteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 2 }, clip.getSnapshot()!, reporter);
    paste.execute();
    expect(getVoice(getBar(target.score, 0, 0)).beats.length).toBe(4); // 2 元 + 2 貼付
    expect(reporter.reports).toEqual([]); // 同一パート＝弦数十分

    paste.undo();
    expect(getVoice(getBar(target.score, 0, 0)).beats.length).toBe(2);
    expect(scoreJson(target)).toBe(before);
  });

  it('paste_TargetHasFewerStrings_DropsNotes_ReportsEDIT009', () => {
    const target = guitarAndBass();
    // ギター(track0)の bar0 beat0 に弦6の音を置く
    new PlaceNoteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 0 }, 6, 3, model.Duration.Quarter).execute();

    const clip = new ClipboardService();
    clip.copy(target, { trackIndex: 0, startBarIndex: 0, startBeatIndex: 0, endBarIndex: 0, endBeatIndex: 0 });

    const reporter = new RecordingReporter();
    // ベース(track1、4弦)へ貼り付け → 弦6は破棄
    const paste = new PasteCommand(target, { trackIndex: 1, barIndex: 0, beatIndex: 1 }, clip.getSnapshot()!, reporter);
    paste.execute();

    const pastedBeat = getBeat(target.score, 1, 0, 1);
    expect(pastedBeat.notes).toHaveLength(0); // 弦6は 4弦ベースに乗らず破棄
    expect(reporter.reports).toHaveLength(1);
    expect(reporter.reports[0]!.code).toBe('EDIT-009');
    expect(reporter.reports[0]!.context).toMatchObject({ droppedCount: 1, targetStringCount: 4 });
  });

  it('paste_TargetHasMoreStrings_NoWarning', () => {
    const target = guitarAndBass();
    // ベース(track1)の弦2に音を置いてコピー
    new PlaceNoteCommand(target, { trackIndex: 1, barIndex: 0, beatIndex: 0 }, 2, 5, model.Duration.Quarter).execute();
    const clip = new ClipboardService();
    clip.copy(target, { trackIndex: 1, startBarIndex: 0, startBeatIndex: 0, endBarIndex: 0, endBeatIndex: 0 });

    const reporter = new RecordingReporter();
    // ギター(track0、6弦)へ貼り付け → 破棄なし
    const paste = new PasteCommand(target, { trackIndex: 0, barIndex: 0, beatIndex: 1 }, clip.getSnapshot()!, reporter);
    paste.execute();
    expect(getBeat(target.score, 0, 0, 1).notes).toHaveLength(1);
    expect(reporter.reports).toEqual([]);
  });
});
