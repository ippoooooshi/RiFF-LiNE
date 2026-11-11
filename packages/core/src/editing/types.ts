/**
 * タブ譜編集コアの共通型（editing-core.md 2.2 節・2.6 節・4.1 節・5 節）。
 *
 * 実行時のモデルは alphaTab の `model.Score` そのもの（AD-1、domain/SongDocument.ts）。
 * コマンドはその Score とサイドカー（メモ・セクションマーカー）を変え、`CommandHistory` が
 * 変えた後に描き直しを頼む（editing-core.md 2.4 節）。コマンドの型は commands/Command.ts。
 */

import type { AppMetadata } from '../domain/types';
import { model } from '@coderline/alphatab';

/**
 * コマンドが変える対象（editing-core.md 2.6 節）。曲の Score と、サイドカーのうちコマンドが触る部分。
 * テストで最小の Score を渡せるようにするための縫い目でもある。
 */
// <!-- req editingcore:4078a65f.3bd1 --> <!-- req editingcore:fdc39573.5bf4 -->
export interface EditTarget {
  // <!-- req editingcore:fdc39573.ae86 -->
  score: model.Score;
  // <!-- req editingcore:fdc39573.002c -->
  appMeta: AppMetadata;
}

/** カーソルの位置（editing-core.md 4.1 節）。 */
// <!-- req editingcore:0ff7e5a2.fb6d --> <!-- req editingcore:3898189b.119a --> <!-- req editingcore:3898189b.c6fe --> <!-- req editingcore:00587515.f8a8 --> <!-- req editingcore:00587515.e7d0 --> <!-- req editingcore:c21fa2a1.cca2 -->
export interface CursorPosition {
  /** 対象のパート（`score.tracks` のインデックス）。 */
  // <!-- req editingcore:0b43129b~1.0904 --> <!-- req editingcore:00587515.1a15 --> <!-- req editingcore:c21fa2a1.09d3 -->
  trackIndex: number;
  /** 対象の小節（`staff.bars` のインデックス、全部のパートで同じ並び）。 */
  // <!-- req editingcore:2144385c.4f38 --> <!-- req editingcore:00587515.f9e5 --> <!-- req editingcore:c21fa2a1.7690 -->
  barIndex: number;
  /** 0 か 1（Bar.voices の 1 つ目か 2 つ目、editing-core.md 3.1 節）。カーソルは選んでいるボイスの拍の上だけを動く。 */
  // <!-- req editingcore:9c556369~1.6ab5 --> <!-- req editingcore:00587515.a319 --> <!-- req editingcore:c21fa2a1.390a --> <!-- req editingcore:c21fa2a1.61e1 -->
  voiceIndex: 0 | 1;
  /** Voice.beats のインデックス。beats.length は、最後の拍の後ろ（次に置く所）を指す。 */
  // <!-- req editingcore:fbf1399e.f454 --> <!-- req editingcore:00587515.9b18 --> <!-- req editingcore:c21fa2a1.ab9c -->
  beatIndex: number;
}

/** 範囲選択（editing-core.md 2.6 節・9 節）。1 つのパートの 1 つのボイスの中で、start と end の拍を両端に含む。 */
// <!-- req editingcore:b366b073.8ecf -->
export interface SelectionRange {
  // 範囲は 1 つのパートの中だけで、パートをまたいだ選択はできない（パートの番号を 1 つだけ持つ。editing-core.md 9 節）
  // <!-- req editingcore:0b43129b.0e80 --> <!-- req editingcore:8cb4c8de.3729 --> <!-- req editingcore:003922b6.ff13 -->
  trackIndex: number;
  /** 範囲の拍を持つボイス（Bar.voices の 1 つ目か 2 つ目、editing-core.md 3.1 節）。もう一方のボイスの拍は範囲に入れない。 */
  // <!-- req editingcore:71c0a373.5a5c -->
  // <!-- req editingcore:9c556369.d92f --> <!-- req editingcore:c21fa2a1.39c5 --> <!-- req editingcore:c21fa2a1.644b -->
  voiceIndex: 0 | 1;
  // <!-- req editingcore:d67542ef.5d23 -->
  startBarIndex: number;
  // <!-- req editingcore:dbcfc9d2.4e87 -->
  startBeatIndex: number;
  // <!-- req editingcore:1c66b630.d404 -->
  endBarIndex: number;
  // <!-- req editingcore:d54053dc.6b87 -->
  endBeatIndex: number;
}

/** 連符（editing-core.md 4.3 節）。 */
// <!-- req editingcore:a8c1f983.8fb6 --> <!-- req editingcore:9b80bafb.c389 -->
export interface TupletSpec {
  /** 実際に弾く音符の数（3 連符なら 3）。 */
  // <!-- req editingcore:871a2d8b.d924 -->
  readonly numerator: number;
  /** 置き換えられる音符の数（3 連符なら 2）。 */
  // <!-- req editingcore:23d1f767.7192 -->
  readonly denominator: number;
}

/**
 * n 連符の連符の組（editing-core.md 4.3 節）。分子は渡した数（7.3 節の欄に入れた数）、分母は分子より小さい 2 の累乗のうち
 * 一番大きいもの（3 なら 2、5 なら 4、6 なら 4、7 なら 4、9 なら 8）。音価のパレットの 3 連符（3:2）と 5 連符（5:4）も、
 * 任意の連符も、この関数で作る。分子が 2 から 12 の外かを見るのは `ValidationService.validateBeatDuration`（`EDIT-016`）で、
 * ここでは範囲の外でも組を返す（2 以下なら分母は 1）。
 */
// <!-- req editingcore:cea4df7d.7ba1 --> <!-- req editingcore:cea4df7d.b86e --> <!-- req editingcore:1ea55c1f.def7 -->
export function tupletSpecFor(numerator: number): TupletSpec {
  // <!-- req editingcore:c950de37.7fbb --> // <!-- req editingcore:c950de37.a402 -->
  let denominator = 1;
  // <!-- req editingcore:1ea55c1f.4884 --> <!-- req editingcore:1ea55c1f.87b6 --> <!-- req editingcore:1ea55c1f.bee0 --> <!-- req editingcore:1ea55c1f.ba9b -->
  while (denominator * 2 < numerator) denominator *= 2; // <!-- req editingcore:c950de37.e0cb -->
  return { numerator, denominator }; // <!-- req editingcore:c950de37.c646 -->
}

/**
 * 音価の 3 つの要素（editing-core.md 3.3 節・4.3 節）。音符の長さ（Beat.duration）・付点の数（Beat.dots）・
 * 連符（Beat.tupletNumerator・Beat.tupletDenominator）の組で、32 分音符と 3 連符も表せる。
 * 新しく置く PlaceNoteCommand・InsertRestCommand にも、今ある拍を変える SetBeatDurationCommand にも同じ形で渡す。
 */
// <!-- req editingcore:a8c1f983.49ce --> <!-- req editingcore:2f220cd6.cec9 --> <!-- req editingcore:fe783de0.ba7d -->
export interface BeatDurationSpec {
  // <!-- req editingcore:2961a89f.3d49 -->
  readonly duration: model.Duration;
  /** 0 = なし、1 = 付点、2 = 複付点（Beat.dots）。 */
  // <!-- req editingcore:336be07f.2981 -->
  readonly dots: 0 | 1 | 2;
  /** null は連符でない（alphaTab では分子と分母が 1）。 */
  // <!-- req editingcore:0aba3183.437c --> <!-- req editingcore:cea4df7d.1144 -->
  readonly tuplet: TupletSpec | null;
}

/** 既定の入力音価（4 分音符、付点なし、連符なし。editing-core.md 4.3 節）。 */
// <!-- req editingcore:c950de37.c105 -->
export const DEFAULT_DURATION_SPEC: BeatDurationSpec = {
  duration: model.Duration.Quarter,
  dots: 0,
  tuplet: null,
};

/** 1 つの音符の場所（editing-core.md 4.5 節）。拍の位置と弦（1 が最も低い弦。alphaTab の Note.string と同じ数え方）。 */
// <!-- req editingcore:e87ec223.888a -->
export interface NoteRef {
  // <!-- req editingcore:e87ec223.005d -->
  position: CursorPosition;
  // <!-- req editingcore:e87ec223.da6f -->
  stringNumber: number;
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
