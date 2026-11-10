/**
 * 範囲のコピーと切り取りのためのクリップボード（editing-core.md 9 節、基本設計 04 章 9 節）。
 *
 * アプリのメモリの中に持ち、OS のクリップボードとはつながない（基本設計が任意としていて、写す形を別のアプリと合わせる決まりが無いため）。
 * 編集ウィンドウごとに 1 つ作り（`EditingService` のコンストラクタの引数 `clipboard`、4.8 節）、別の曲の編集ウィンドウへは貼れない
 * （v1 は同じ曲の中だけ、honnin-queue 60 番。別の曲へ貼るための口は v1 では作らない、honnin-queue 62 番）。
 * クリップボードへ置く側は曲の状態を変えないのでコマンドにせず、履歴に積まない（9 節）。
 *
 * 写すのは、拍の音価（`BeatDurationSpec`）と、音符の弦とフレットと Note の奏法記号（`NoteTechniquePatch` の形）と、
 * 拍の Beat の単位の奏法記号（`BeatTechniquePatch` の形）とする。タイとスラーの印は写さない（範囲の外の音符とつながる印を写すと、
 * 貼った先でつながる相手がいないため、9 節の (b)）。写した中身（`ClipboardSnapshot`）は数と真偽だけでできている。
 */

import { model } from '@coderline/alphatab';

import { collectRangeBeats } from './commands/DeleteSelectionCommand';
import type { BeatTechniquePatch, NoteTechniquePatch } from './commands/noteAttributeCommands';
import { findNoteOnString, voiceBeats } from './scoreModel';
import type { BeatDurationSpec, CursorPosition, EditTarget, NoteRef, SelectionRange } from './types';

/** クリップボードの中の音符 1 つ（editing-core.md 9 節）。弦は 1 が最も低い弦（alphaTab の `Note.string` と同じ数え方）。 */
// <!-- req editingcore:72d8757e.993f -->
export interface ClipboardNote {
  string: number; // <!-- req editingcore:72d8757e.bcab --> <!-- req editingcore:d3b8a2a3.5fa1 -->
  fret: number; // <!-- req editingcore:72d8757e.2a20 --> <!-- req editingcore:d3b8a2a3.71ff -->
  /** 付いている Note の奏法記号だけを持つ（付いていなければ空）。 */
  techniques: NoteTechniquePatch; // <!-- req editingcore:72d8757e.7762 --> <!-- req editingcore:d3b8a2a3.3a7e -->
}

/** クリップボードの中の拍 1 つ（editing-core.md 9 節）。 */
// <!-- req editingcore:a2fbd657.bc04 -->
export interface ClipboardBeat {
  duration: BeatDurationSpec; // <!-- req editingcore:a2fbd657.e274 --> <!-- req editingcore:d3b8a2a3.1d2a -->
  notes: ClipboardNote[]; // <!-- req editingcore:a2fbd657.28de -->
  /** 付いている Beat の単位の奏法記号だけを持つ（付いていなければ空）。 */
  beatTechniques: BeatTechniquePatch; // <!-- req editingcore:a2fbd657.2706 --> <!-- req editingcore:d3b8a2a3.c183 -->
}

/** クリップボードの中の形（editing-core.md 9 節）。数と真偽だけでできている。 */
// <!-- req editingcore:a4c01483.127b --> <!-- req editingcore:74ebd76d.77ad --> <!-- req editingcore:aa765aff.fb67 -->
export interface ClipboardSnapshot {
  beats: ClipboardBeat[]; // <!-- req editingcore:a4c01483.8f59 -->
}

/**
 * 拍の音価（音符の長さ・付点・連符、editing-core.md 3.3 節・4.3 節）を `BeatDurationSpec` の形で写す。連符でないこと（alphaTab では
 * 分子と分母が 1、作ったばかりの拍は -1）は `Beat.hasTuplet` で見る。
 */
function durationSpecOf(beat: model.Beat): BeatDurationSpec {
  return {
    duration: beat.duration,
    dots: Math.min(beat.dots, 2) as 0 | 1 | 2,
    tuplet: beat.hasTuplet ? { numerator: beat.tupletNumerator, denominator: beat.tupletDenominator } : null,
  };
}

/**
 * 音符に付いている Note の奏法記号を、`SetTechniqueCommand` が受ける patch の形で写す（editing-core.md 9 節の (b)）。
 * 付いていない（既定の値の）キーは入れない。アプリで付けられる種類（editing-core.md 3.5 節）の外の値も、そのまま写す
 * （ここで絞りを外したのはスライドアウトとハーモニクスの種類で、外の値は alphaTab のピックスライド `PickSlideDown`・`PickSlideUp` と、
 * ハーモニクスの `Tap`・`Semi`・`Feedback` の 5 つ。どれも Guitar Pro・MusicXML の読み込みで入る値。2026-11-10 本人の決定、honnin-done 271 番。貼った先では `PasteCommand` の子だけが外の値を受ける、editing-core.md 9 節）。
 * ハーモニクスの音の高さ（`harmonicValue`）は、自然ハーモニクス以外のどの種類でも、0 でなければ写す（alphaTab 1.8.4 は人工・ピンチ・
 * `Tap`・`Semi`・`Feedback` のどれでも、押さえたフレットからの差として持つ）。自然ハーモニクスの値は写さず、貼った先の
 * `SetTechniqueCommand` がフレットから入れる（editing-core.md 7.3 節）。
 * タイ（`isTieDestination`）とスラーの印は写さない。
 */
// <!-- req editingcore:d3b8a2a3.84d2 -->
function noteTechniquesOf(note: model.Note): NoteTechniquePatch {
  const patch: NoteTechniquePatch = {};
  // <!-- req editingcore:b046b3a2.864a --> <!-- req editingcore:b046b3a2.d64c -->
  if (note.slideOutType !== model.SlideOutType.None) patch.slideOutType = note.slideOutType;
  if (note.slideInType !== model.SlideInType.None) patch.slideInType = note.slideInType;
  if (note.isHammerPullOrigin) patch.isHammerPullOrigin = true;
  // <!-- req editingcore:b046b3a2.907a --> <!-- req editingcore:b046b3a2.1b30 --> <!-- req editingcore:b046b3a2.620b -->
  // ハーモニクスは 3.5 節の外の種類もそのまま写す。音の高さは自然以外で 0 でなければ写す（自然はフレットから入れ直す、7.3 節）
  if (note.harmonicType !== model.HarmonicType.None) {
    patch.harmonicType = note.harmonicType;
    // <!-- req editingcore:b046b3a2.785b -->
    if (note.harmonicType !== model.HarmonicType.Natural && note.harmonicValue !== 0) {
      patch.harmonicValue = note.harmonicValue;
    }
  }
  if (note.isPalmMute) patch.isPalmMute = true;
  if (note.vibrato !== model.VibratoType.None) patch.vibrato = note.vibrato;
  if (note.isGhost) patch.isGhost = true;
  if (note.isStaccato) patch.isStaccato = true;
  if (note.accentuated !== model.AccentuationType.None) patch.accentuated = note.accentuated;
  if (note.bendType !== model.BendType.None) patch.bendType = note.bendType;
  const points = note.bendPoints ?? [];
  if (points.length > 0) patch.bendPoints = points.map((point) => ({ offset: point.offset, value: point.value }));
  return patch;
}

/** 拍に付いている Beat の単位の奏法記号（スラップ・ポップ・タップ・ブラシ）を、`SetBeatTechniqueCommand` が受ける patch の形で写す。 */
function beatTechniquesOf(beat: model.Beat): BeatTechniquePatch {
  const patch: BeatTechniquePatch = {};
  if (beat.slap) patch.slap = true;
  if (beat.pop) patch.pop = true;
  if (beat.tap) patch.tap = true;
  if (beat.brushType !== model.BrushType.None) patch.brushType = beat.brushType;
  return patch;
}

/** 音符 1 つを、弦・フレット・Note の奏法記号だけの形に写す。 */
function clipNote(note: model.Note): ClipboardNote {
  return { string: note.string, fret: note.fret, techniques: noteTechniquesOf(note) };
}

/** 拍 1 つを、音価・Beat の奏法記号と、渡した音符だけの形に写す。 */
function clipBeat(beat: model.Beat, notes: readonly model.Note[]): ClipboardBeat {
  return { duration: durationSpecOf(beat), notes: notes.map(clipNote), beatTechniques: beatTechniquesOf(beat) };
}

/** 1 つの音符の場所（`NoteRef`）か、拍の位置（`CursorPosition`）か。 */
export function isNoteRef(at: NoteRef | CursorPosition): at is NoteRef {
  return 'stringNumber' in at;
}

// <!-- req editingcore:0f249bbc.0a6b --> <!-- req editingcore:aa74e211.9d7d --> <!-- req editingcore:aa74e211.1a45 --> <!-- req editingcore:a00ec65e.7017 -->
// <!-- req editingcore:294212db.f55d --> <!-- req editingcore:294212db.8d0c -->
export class ClipboardService {
  /** アプリのメモリの中に持つ写し（OS のクリップボードとはつながない）。 */
  private snapshot: ClipboardSnapshot | null = null;

  /**
   * 選択範囲（1 つのパートの 1 つのボイスの中）の拍と音符を、クリップボードの中の形に写す（editing-core.md 9 節）。
   * 範囲の拍の集め方は `DeleteSelectionCommand` と同じ（`collectRangeBeats`）。曲の状態は変えない。
   */
  // <!-- req editingcore:c21fa2a1.5b3a --> <!-- req editingcore:c21fa2a1.472a -->
  // <!-- req editingcore:ff118ffe.1878 --> <!-- req editingcore:74ebd76d.f84c --> <!-- req editingcore:74ebd76d.8f5b -->
  copy(target: EditTarget, range: SelectionRange): void {
    const beats = collectRangeBeats(target.score, range).map(({ beat }) => clipBeat(beat, beat.notes));
    this.snapshot = { beats };
  }

  /**
   * 選択範囲が無いときの右クリックの「コピー」「切り取り」（editing-core.md 9 節）。音符（`NoteRef`）なら、その拍の音価と Beat の単位の
   * 奏法記号と、その音符 1 つ（弦・フレット・Note の奏法記号）だけを持つ 1 拍を、休符の拍（`CursorPosition`）なら、その音価の音符の無い
   * 1 拍を写す。音符 1 つでも 1 拍の形で写すのは、貼り付けが拍を単位に挿入するので、範囲のコピーと同じ形にしておくため（9 節の (b)）。
   * 指した所に拍か音符が無いとき（画面からは渡らない）は、クリップボードを変えない。
   *
   * 前提：拍（`CursorPosition`）を渡すのは、その拍が休符の拍のときだけ。音のある拍の空いた弦を右クリックしたときは「コピー」「切り取り」を
   * 押せない（screens-navigation.md 10.2 節）ので、`copyAt`・`cutAt` に音のある拍は渡らない（editing-core.md 9 節の (b)）。
   * 前提が崩れて音のある拍を渡されたときは、クリップボードを変えない。`cutAt` の消す側は `deleteNoteAt(at)` と同じ消し方で、
   * 音のある拍を渡されたときは何もしない（4.5 節）ので、写す側もそろえて何もしない（音の無い 1 拍を写して前の中身を消さないため）。
   */
  // <!-- req editingcore:361d688e.7b18 --> <!-- req editingcore:60ed4fb0.d40d --> <!-- req editingcore:1eab0cdf.4797 -->
  copyAt(target: EditTarget, at: NoteRef | CursorPosition): void {
    const position = isNoteRef(at) ? at.position : at;
    const beat = voiceBeats(target.score, position.trackIndex, position.barIndex, position.voiceIndex)[
      position.beatIndex
    ];
    if (beat === undefined) return;
    if (isNoteRef(at)) {
      const note = findNoteOnString(beat, at.stringNumber);
      if (note === null) return;
      // <!-- req editingcore:60ed4fb0.016f --> <!-- req editingcore:60ed4fb0.4d88 --> <!-- req editingcore:60ed4fb0.452a -->
      // <!-- req editingcore:60ed4fb0.52a7 --> <!-- req editingcore:60ed4fb0.b088 --> <!-- req editingcore:60ed4fb0.a2c8 -->
      this.snapshot = { beats: [clipBeat(beat, [note])] };
      return;
    }
    // 音のある拍は画面から渡らない（9 節の (b)）。渡されたら何もしない
    if (beat.notes.length > 0) return;
    // 休符の拍：その音価の音符の無い 1 拍
    // <!-- req editingcore:60ed4fb0.d504 -->
    this.snapshot = { beats: [clipBeat(beat, [])] };
  }

  // <!-- req editingcore:bef754d8.1d45 -->
  hasContent(): boolean {
    return this.snapshot !== null && this.snapshot.beats.length > 0;
  }

  /** 今の写し（無ければ null）。`PasteCommand` へ渡す。 */
  // <!-- req editingcore:ed3255c4.5041 -->
  getSnapshot(): ClipboardSnapshot | null {
    return this.snapshot;
  }

  // <!-- req editingcore:2e4bcd86.47b1 -->
  clear(): void {
    this.snapshot = null;
  }
}
