/**
 * コピー＆ペースト用のアプリ内クリップボード（editing-core.md §9、04_editing_core.md §9）。
 *
 * OS クリップボード連携は行わず、アプリ内メモリのみに保持する。選択範囲は単一パート内のみ（§9）。
 * `PasteCommand` 構築時にスナップショットを渡す。
 */

import { model } from '@coderline/alphatab';

import { getBeat } from './scoreModel';
import type { EditTarget, SelectionRange } from './types';

/** クリップボードへ取り込む Beat 1 つ分の中立形式。 */
export interface ClipboardBeat {
  duration: model.Duration;
  /** 弦番号（1 起点）とフレット。奏法記号は MVP では持ち運ばない。 */
  notes: { string: number; fret: number }[];
}

export interface ClipboardSnapshot {
  beats: ClipboardBeat[];
}

export class ClipboardService {
  private snapshot: ClipboardSnapshot | null = null;

  /** 選択範囲（同一パート内）の Beat 群を内部形式へシリアライズして保持する。 */
  copy(target: EditTarget, range: SelectionRange): void {
    const beats: ClipboardBeat[] = [];
    for (let bar = range.startBarIndex; bar <= range.endBarIndex; bar++) {
      const firstBeat = bar === range.startBarIndex ? range.startBeatIndex : 0;
      // 末尾 Bar は endBeatIndex まで、それ以外は Bar 内の全 Beat。
      let beatIndex = firstBeat;
      for (;;) {
        let beat: model.Beat;
        try {
          beat = getBeat(target.score, range.trackIndex, bar, beatIndex);
        } catch {
          break;
        }
        beats.push({
          duration: beat.duration,
          notes: beat.notes.map((note) => ({ string: note.string, fret: note.fret })),
        });
        if (bar === range.endBarIndex && beatIndex >= range.endBeatIndex) break;
        beatIndex += 1;
      }
    }
    this.snapshot = { beats };
  }

  hasContent(): boolean {
    return this.snapshot !== null && this.snapshot.beats.length > 0;
  }

  /** 現在のスナップショット（無ければ null）。`PasteCommand` へ渡す。 */
  getSnapshot(): ClipboardSnapshot | null {
    return this.snapshot;
  }

  clear(): void {
    this.snapshot = null;
  }
}
