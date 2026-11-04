/**
 * 音符と拍の属性を書き換えるコマンド（editing-core.md 2.6 節・3.4 節・3.5 節・6 節・7.3 節・8 節）。
 *
 * どれも「execute で前の値を控えて新しい値を当てる → undo で控えた値に戻す」の形で、execute と undo の対称性を
 * 各コマンドが自分で保証する（editing-core.md 2.2 節）。
 *
 * コマンドが変えるのは利用者の操作で決まる意図の項目（Note.fret・isTieDestination・slideOutType、2.6 節の表の「変えるもの」）に
 * 限り、`Score.finish()` を呼ばず、finish() が作る派生情報の 4 つ（Beat.index・前後の拍・タイによるフレットの写しとつながり
 * 〈tieOrigin・tieDestination〉・slideTarget）は変えない（editing-core.md 2.4 節、B33）。派生情報は、`CommandHistory` が
 * 頼む描き直しの前に `ScoreRenderHost` が作り直す。
 *
 * alphaTab の Note への写し方（editing-core.md 3.4 節）：
 *  - タイ   : 音符 A の tieToNext（論理名）が真のとき、同じ弦の次の音符 B の `isTieDestination` を真にする
 *  - スラー : 同じ slurGroupId（論理名）の最初の音符 A と最後の音符 B を `slurDestination`・`slurOrigin`・`isSlurDestination` でつなぐ
 *  - 奏法記号 : Note の属性は `SetTechniqueCommand`、Beat の属性は `SetBeatTechniqueCommand`（3.5 節・7.3 節）
 *  - コード名 : `Beat.text`（コード名の手の値、8 節）
 */

import { model } from '@coderline/alphatab';

import { BASE_COMMAND_BYTES } from '../commandBase';
import { findNextNoteOnString, findNoteOnString, getBar, getBeat, getVoice } from '../scoreModel';
import type { CommandOutcome, CursorPosition, EditTarget, SelectionRange } from '../types';
import type { Command, CommandLabelId } from './Command';

/** 控えた値へ戻す関数を持って、execute と undo の対称性を保証する土台。 */
abstract class AttributeCommand implements Command {
  abstract readonly kind: string;
  abstract readonly label: CommandLabelId;
  readonly affectedTrackIndices: readonly number[];
  protected readonly score: model.Score;
  private restore: (() => void) | null = null;

  /** @param trackIndex 変更が及ぶパート（どの属性のコマンドも、そのパートだけ。editing-core.md 2.6 節）。 */
  protected constructor(score: model.Score, trackIndex: number) {
    this.score = score;
    this.affectedTrackIndices = [trackIndex];
  }

  /** 前の値を控えて新しい値を当て、控えた値へ戻す関数を返す。 */
  protected abstract apply(): () => void;

  execute(): CommandOutcome {
    this.restore = this.apply();
    return { cursorAdvance: 'none' };
  }

  undo(): CommandOutcome {
    this.restore?.();
    this.restore = null;
    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

/** 何も変えなかったときの戻す関数。 */
const NOTHING_TO_RESTORE = (): void => undefined;

// ===== タイ =====

/**
 * タイ（論理名 `Note.tieToNext`）を付ける・外す（editing-core.md 3.4 節・6 節）。position と stringNumber は、タイの始まりの
 * 音符 A（前の音符）を指す。A の同じ弦の次の音符 B（小節をまたいで探す）の `isTieDestination` を tied にし、
 * `B.tieOrigin` と `A.tieDestination` のつながりはコマンドでは入れない（描く前の `Score.finish` が `isTieDestination` から張り直す）。
 * タイを付けると `Note.chain` が B に A のフレットを写し、タイが外れても戻さないので、execute で B の `fret` を控え、
 * undo で控えた値に戻す（`fret` は利用者の操作で決まる意図の項目で、finish() が作る派生情報の 4 つではない）。
 * A か B が無いときは何もしない（宙に浮いたタイの終わりを作らない）。
 */
// 9.1 節：奏法記号は alphaTab の属性として持ち、Note 単位のものは Note の属性に持つ。タイは Note の isTieDestination として扱い、音価の連結と再生のときに 1 つの音にまとめることを自前の規則で持たない。Beat の tap・slap・pop・brushType に持つ奏法（タッピング・スラップ・ポップ・ブラシ）は、作業パッケージ 4（editing-core.md 7.3 節）で足す <!-- req webcorefoundation:f92357cd.2f43 --> <!-- req webcorefoundation:f92357cd.6f41 --> <!-- req webcorefoundation:f92357cd.8188 --> <!-- req webcorefoundation:f92357cd.668a --> <!-- req webcorefoundation:f92357cd.6400 --> <!-- req webcorefoundation:f92357cd.0572 --> <!-- req webcorefoundation:e6454b30.e41a --> <!-- req webcorefoundation:e6454b30.687b --> <!-- req webcorefoundation:e6454b30.ce2f --> <!-- req webcorefoundation:e6454b30.d528 -->
// <!-- req editingcore:ed43b5d7.8fe5 --> <!-- req editingcore:d99a8929.7885 --> <!-- req editingcore:d99a8929.f7be -->
export class SetTieCommand extends AttributeCommand {
  readonly kind = 'set-tie';
  readonly label = 'set-tie';
  private readonly position: CursorPosition;
  private readonly stringNumber: number;
  private readonly tied: boolean;

  // <!-- req editingcore:4d4a8a66.09e7 --> <!-- req editingcore:babc72fc.ad70 -->
  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, tied: boolean) {
    // <!-- req editingcore:067be5b3.c069 -->
    super(target.score, position.trackIndex);
    this.position = position;
    this.stringNumber = stringNumber;
    this.tied = tied;
  }

  protected apply(): () => void {
    const { trackIndex, barIndex, beatIndex } = this.position;
    const beat = getVoice(getBar(this.score, trackIndex, barIndex)).beats[beatIndex];
    const origin = beat === undefined ? null : findNoteOnString(beat, this.stringNumber);
    if (origin === null) return NOTHING_TO_RESTORE;
    // <!-- req editingcore:b1c0352e.c906 -->
    const destination = findNextNoteOnString(this.score, trackIndex, barIndex, beatIndex, this.stringNumber);
    if (destination === null) return NOTHING_TO_RESTORE;

    // <!-- req editingcore:fd6a1424.b430 --> <!-- req editingcore:fd6a1424.69e6 --> <!-- req editingcore:fd6a1424.a9bb -->
    const old = { fret: destination.fret, isTieDestination: destination.isTieDestination };
    // data-model-persistence.md 4 節：タイは isTieDestination・tieOrigin・tieDestination で持つ <!-- req datamodelpersistence:cf9b39de.db0f --> <!-- req datamodelpersistence:cf9b39de.54ef --> <!-- req datamodelpersistence:cf9b39de.061a -->
    // <!-- req editingcore:54e0b2f1.ea2b --> <!-- req editingcore:067be5b3.f7bf --> <!-- req editingcore:3610d19d.a986 --> <!-- req editingcore:3610d19d.0139 --> <!-- req editingcore:3610d19d.54a4 --> <!-- req editingcore:b1c0352e.5c7e --> <!-- req editingcore:b1c0352e.fe9a -->
    destination.isTieDestination = this.tied;

    return () => {
      // <!-- req editingcore:fd6a1424.6bd0 -->
      destination.fret = old.fret;
      destination.isTieDestination = old.isTieDestination;
    };
  }
}

// ===== スラー =====

/**
 * スラー（論理名 `Note.slurGroupId`）を範囲の音符に付ける（editing-core.md 3.4 節・6 節）。タイとは別の属性・別のコマンドで持つ。
 * 範囲の最初の拍の音符 A と最後の拍の音符 B（どちらも弦の番号の小さい音符）をつなぎ、`A.slurDestination` に B を、
 * `B.slurOrigin` に A を入れ、`B.isSlurDestination` を真にする。範囲は選んでいるボイス（range.voiceIndex）の拍だけ。
 * A と B が取れない（休符の拍・同じ音符）ときは、どのつながりの項目も入れない。
 */
// <!-- req editingcore:83f645c5.1e5d --> <!-- req editingcore:f270f4a2.01f2 --> <!-- req editingcore:f270f4a2.7f4e --> <!-- req editingcore:729e1d7d.24dd --> <!-- req editingcore:d99a8929.e639 -->
export class SetSlurCommand extends AttributeCommand {
  readonly kind = 'set-slur';
  readonly label = 'set-slur';
  private readonly range: SelectionRange;

  // <!-- req editingcore:d1cad41b.a9db -->
  constructor(target: EditTarget, range: SelectionRange) {
    // <!-- req editingcore:498ee697.5393 -->
    super(target.score, range.trackIndex);
    this.range = range;
  }

  protected apply(): () => void {
    const { trackIndex, voiceIndex } = this.range;
    const first = firstNoteOfBeat(
      getBeat(this.score, trackIndex, this.range.startBarIndex, this.range.startBeatIndex, voiceIndex),
    );
    const last = firstNoteOfBeat(
      getBeat(this.score, trackIndex, this.range.endBarIndex, this.range.endBeatIndex, voiceIndex),
    );
    // <!-- req editingcore:a9bcb3d8.4ade --> <!-- req editingcore:a9bcb3d8.f4f0 --> <!-- req editingcore:62d35d22.1e0a -->
    if (first === null || last === null || first === last) return NOTHING_TO_RESTORE;

    const old = {
      firstSlurDestination: first.slurDestination,
      lastSlurOrigin: last.slurOrigin,
      lastIsSlurDestination: last.isSlurDestination,
    };
    // data-model-persistence.md 4 節：スラーは slurOrigin・slurDestination・isSlurDestination で持つ <!-- req datamodelpersistence:cf9b39de.6157 --> <!-- req datamodelpersistence:cf9b39de.47d2 --> <!-- req datamodelpersistence:cf9b39de.0516 -->
    // <!-- req editingcore:498ee697.e3c6 --> <!-- req editingcore:729e1d7d.d13c --> <!-- req editingcore:3610d19d.873e --> <!-- req editingcore:62d35d22.6025 --> <!-- req editingcore:62d35d22.0e0c -->
    first.slurDestination = last;
    // <!-- req editingcore:62d35d22.e0b1 -->
    last.slurOrigin = first;
    // <!-- req editingcore:62d35d22.8844 -->
    last.isSlurDestination = true;

    return () => {
      first.slurDestination = old.firstSlurDestination;
      last.slurOrigin = old.lastSlurOrigin;
      last.isSlurDestination = old.lastIsSlurDestination;
    };
  }
}

// ===== 奏法記号（Note の属性） =====

/** alphaTab の BendPoint に当たる。value は 1 が 1/4 音、offset は拍の中の位置（0 から 60）（editing-core.md 7.3 節）。 */
export interface BendPointSpec {
  readonly offset: number;
  readonly value: number;
}

/**
 * `SetTechniqueCommand` が受ける部分更新。指定したキーだけを変える（editing-core.md 3.5 節・7.3 節）。
 * チョーキング・スライド・ハンマリング・プリング・ハーモニクス・パームミュート・ビブラート・ゴースト・スタッカート・アクセントを扱う。
 */
export interface NoteTechniquePatch {
  // <!-- req editingcore:54e0b2f1.344d -->
  slideOutType?: model.SlideOutType;
  // data-model-persistence.md 4 節：スライドインと人工ハーモニクスの音の高さは Note の属性に持ち、JsonConverter が song に書くので保存の形を足さない <!-- req datamodelpersistence:4457041c.fea9 --> <!-- req datamodelpersistence:4457041c.0d6e --> <!-- req datamodelpersistence:4457041c.a5f3 --> <!-- req datamodelpersistence:4457041c.ab84 -->
  // <!-- req datamodelpersistence:4457041c.f566 -->
  slideInType?: model.SlideInType;
  isHammerPullOrigin?: boolean;
  harmonicType?: model.HarmonicType;
  /** 人工ハーモニクスで鳴らす音の高さ。0（指定なし）・12・7・5・4 のどれか（7.2 節）。自然ハーモニクスでは渡さず、コマンドがフレットから入れる（7.3 節）。 */
  harmonicValue?: number;
  isPalmMute?: boolean;
  vibrato?: model.VibratoType;
  isGhost?: boolean;
  isStaccato?: boolean;
  accentuated?: model.AccentuationType;
  bendType?: model.BendType;
  bendPoints?: readonly BendPointSpec[];
}

/** patch のうち、値をそのまま Note の同じ名前の項目へ入れるキー（bendPoints は中身を写すので別に扱う）。 */
const NOTE_SCALAR_KEYS = [
  'slideOutType',
  'slideInType',
  'isHammerPullOrigin',
  'harmonicType',
  'harmonicValue',
  'isPalmMute',
  'vibrato',
  'isGhost',
  'isStaccato',
  'accentuated',
  'bendType',
] as const satisfies readonly (keyof NoteTechniquePatch)[];

/**
 * 自然ハーモニクスの `harmonicValue` を、押さえたフレットから alphaTab 1.8.4 の `ModelUtils.deltaFretToHarmonicValue` と同じ表で返す
 * （editing-core.md 7.2 節）。alphaTab 1.8.4 は `ModelUtils` を外に出していないので、表を写して持つ。
 */
export function naturalHarmonicValue(fret: number): number {
  switch (fret) {
    case 2:
      return 2.4;
    case 3:
      return 3.2;
    case 4:
    case 5:
    case 7:
    case 9:
    case 12:
    case 16:
    case 17:
    case 19:
    case 24:
      return fret;
    case 8:
      return 8.2;
    case 10:
      return 9.6;
    case 14:
    case 15:
      return 14.7;
    case 21:
    case 22:
      return 21.7;
    default:
      return 12;
  }
}

/**
 * Note の奏法記号とアーティキュレーションを変える（editing-core.md 3.5 節・7.3 節）。patch で指定したキーだけを変え、undo は
 * 指定したキーの前の値だけを戻す。アーティキュレーション（アクセント・強いアクセント・テヌート・スタッカート・ゴースト）は、
 * 付けるのも外すのも本コマンドで行う（外すのは accentuated を None、isStaccato と isGhost を偽にする patch）。
 * patch の harmonicType が Natural で harmonicValue が無いときは、その音のフレットから naturalHarmonicValue で値を入れる。
 * bendPoints は中身を写して持ち、`Note.addBendPoint` で入れる（alphaTab 1.8.4 の描画が読む `maxBendPoint` は
 * `addBendPoint` だけが入れるため）。
 */
// <!-- req editingcore:08fd2177.fe6e -->
export class SetTechniqueCommand extends AttributeCommand {
  readonly kind = 'set-technique';
  readonly label = 'set-technique';
  private readonly position: CursorPosition;
  private readonly stringNumber: number;
  private readonly patch: NoteTechniquePatch;

  // <!-- req editingcore:4d4a8a66.530b -->
  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, patch: NoteTechniquePatch) {
    // <!-- req editingcore:08fd2177.49a9 -->
    super(target.score, position.trackIndex);
    this.position = position;
    this.stringNumber = stringNumber;
    this.patch = patch;
  }

  protected apply(): () => void {
    const beat = getBeat(this.score, this.position.trackIndex, this.position.barIndex, this.position.beatIndex);
    const note = findNoteOnString(beat, this.stringNumber);
    if (note === null) return NOTHING_TO_RESTORE;

    const noteRecord = note as unknown as Record<string, unknown>;
    const old = new Map<string, unknown>();
    // 同じキーを 2 度は入れない（harmonicValue は patch に無いときだけ下で入れ、bendPoints・maxBendPoint は scalar のキーに無い）
    const set = (key: string, value: unknown): void => {
      old.set(key, noteRecord[key]);
      noteRecord[key] = value;
    };

    // <!-- req editingcore:08fd2177.374c -->
    for (const key of NOTE_SCALAR_KEYS) {
      const value = this.patch[key];
      if (value !== undefined) set(key, value);
    }
    if (this.patch.harmonicType === model.HarmonicType.Natural && this.patch.harmonicValue === undefined) {
      set('harmonicValue', naturalHarmonicValue(note.fret));
    }
    if (this.patch.bendPoints !== undefined) {
      const bendType = note.bendType;
      set('bendPoints', null);
      set('maxBendPoint', null);
      for (const point of this.patch.bendPoints) note.addBendPoint(new model.BendPoint(point.offset, point.value));
      // addBendPoint は bendType が None のとき Custom に変えるので、patch で決まった値（無ければ前の値）に戻す
      note.bendType = bendType;
    }

    return () => {
      for (const [key, value] of old) noteRecord[key] = value;
    };
  }
}

// ===== 奏法記号（Beat の属性） =====

/** `SetBeatTechniqueCommand` が受ける部分更新。指定したキーだけを変える（editing-core.md 3.5 節・7.3 節）。 */
export interface BeatTechniquePatch {
  slap?: boolean;
  pop?: boolean;
  tap?: boolean;
  brushType?: model.BrushType;
}

const BEAT_TECHNIQUE_KEYS = [
  'slap',
  'pop',
  'tap',
  'brushType',
] as const satisfies readonly (keyof BeatTechniquePatch)[];

/**
 * Beat の奏法記号（スラップ・ポップ・タップ・ブラシ）を変える（editing-core.md 3.5 節・7.3 節、B40）。弦を持たない Beat の属性なので、
 * 弦を指定して Note を変える `SetTechniqueCommand` と別のコマンドにする。patch で指定したキーだけを変え、undo はその前の値だけを戻す。
 */
// <!-- req editingcore:4f841ca1.0d8d -->
export class SetBeatTechniqueCommand extends AttributeCommand {
  readonly kind = 'set-beat-technique';
  readonly label = 'set-beat-technique';
  private readonly position: CursorPosition;
  private readonly patch: BeatTechniquePatch;

  constructor(target: EditTarget, position: CursorPosition, patch: BeatTechniquePatch) {
    // <!-- req editingcore:4f841ca1.febf -->
    super(target.score, position.trackIndex);
    this.position = position;
    this.patch = patch;
  }

  protected apply(): () => void {
    const beat = getBeat(this.score, this.position.trackIndex, this.position.barIndex, this.position.beatIndex);
    const beatRecord = beat as unknown as Record<string, unknown>;
    const old = new Map<string, unknown>();
    for (const key of BEAT_TECHNIQUE_KEYS) {
      const value = this.patch[key];
      if (value === undefined) continue;
      old.set(key, beatRecord[key]);
      // <!-- req editingcore:4f841ca1.f575 -->
      beatRecord[key] = value;
    }
    return () => {
      for (const [key, value] of old) beatRecord[key] = value;
    };
  }
}

// ===== コード名（手の値） =====

/** コード名の手の値（`Beat.text`）を入れる。name が null なら手の値を外す（editing-core.md 8 節）。 */
// <!-- req editingcore:3a51f00e.03d8 --> <!-- req editingcore:31405a78.9d6f -->
export class SetChordNameCommand extends AttributeCommand {
  readonly kind = 'set-chord-name';
  readonly label = 'set-chord-name';
  private readonly position: CursorPosition;
  private readonly name: string | null;

  // <!-- req editingcore:4bdfacd9.e7f9 -->
  constructor(target: EditTarget, position: CursorPosition, name: string | null) {
    // <!-- req editingcore:3a51f00e.e490 -->
    super(target.score, position.trackIndex);
    this.position = position;
    this.name = name;
  }

  protected apply(): () => void {
    const beat = getBeat(this.score, this.position.trackIndex, this.position.barIndex, this.position.beatIndex);
    const old = beat.text;
    // <!-- req editingcore:3a51f00e.04ca -->
    beat.text = this.name;
    return () => {
      beat.text = old;
    };
  }
}

/** Beat の中で弦の番号が一番小さい音符（無ければ null）。 */
function firstNoteOfBeat(beat: model.Beat): model.Note | null {
  return beat.notes.length > 0 ? [...beat.notes].sort((a, b) => a.string - b.string)[0]! : null;
}
