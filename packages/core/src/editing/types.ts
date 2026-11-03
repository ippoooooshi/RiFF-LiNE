/**
 * タブ譜編集コアの共通型（editing-core.md 2.2 節・2.6 節・4.1 節・5 節）。
 *
 * 実行時のモデルは alphaTab の `model.Score` そのもの（AD-1、domain/SongDocument.ts）。
 * コマンドはその Score とサイドカー（メモ・セクションマーカー）を変え、`CommandHistory` が
 * 変えた後に描き直しを頼む（editing-core.md 2.4 節）。コマンドの型は commands/Command.ts。
 */

import type { AppMetadata } from '../domain/types';
import type { model } from '@coderline/alphatab';

/**
 * コマンドが変える対象（editing-core.md 2.6 節）。曲の Score と、サイドカーのうちコマンドが触る部分。
 * テストで最小の Score を渡せるようにするための縫い目でもある。
 */
export interface EditTarget {
  score: model.Score;
  appMeta: AppMetadata;
}

/** カーソルの位置（editing-core.md 4.1 節）。 */
export interface CursorPosition {
  /** 対象のパート（`score.tracks` のインデックス）。 */
  trackIndex: number;
  /** 対象の小節（`staff.bars` のインデックス、全部のパートで同じ並び）。 */
  barIndex: number;
  /** 小節の中の拍のインデックス（voice.beats のインデックス）。 */
  beatIndex: number;
}

/** 範囲選択（editing-core.md 9 節）。1 つのパートの中で、start と end の拍を両端に含む。 */
export interface SelectionRange {
  trackIndex: number;
  startBarIndex: number;
  startBeatIndex: number;
  endBarIndex: number;
  endBeatIndex: number;
}

/** `Command.execute()` と `undo()` の戻り値（editing-core.md 2.2 節）。`EditingService` がこれを見てカーソルを動かす。 */
// <!-- req editingcore:3839865e.c9d9 -->
export interface CommandOutcome {
  /** 実行の後のカーソルの動き。PlaceNoteCommand と InsertRestCommand の execute は 'beat'、それ以外と undo は 'none'（4.2 節）。 */
  // <!-- req editingcore:3f126dbf.f2df -->
  cursorAdvance: 'beat' | 'none';
}

/** 確かめの結果（editing-core.md 5 節）。拒むときはエラーコードと文脈を持つ。 */
export type ValidationOutcome = { ok: true } | { ok: false; code: string; context: Record<string, unknown> };

/** `CommandHistory.onCommandApplied` が購読する側へ渡す出来事（editing-core.md 2.2 節）。 */
// <!-- req editingcore:a6abdc70.5edf -->
export interface CommandAppliedEvent {
  /** redo は中では execute を呼び直すが、購読する側が見分けられるように別の値にする。 */
  // <!-- req editingcore:c811be90.c88e -->
  phase: 'execute' | 'undo' | 'redo';
  // <!-- req editingcore:1d0a8374.233e -->
  kind: string;
  // <!-- req editingcore:a8f4acc9.ad47 -->
  affectedTrackIndices: readonly number[];
}
