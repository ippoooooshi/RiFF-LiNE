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
import { CompositeCommand } from '../CompositeCommand';
import { findNextNoteOnString, findNextNoteRefOnString, findNoteOnString, getBeat, voiceBeats } from '../scoreModel';
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

/** カーソルの位置の拍。位置のボイス（position.voiceIndex）の拍を見る（editing-core.md 3.1 節）。 */
function beatAt(score: model.Score, position: CursorPosition): model.Beat {
  return getBeat(score, position.trackIndex, position.barIndex, position.beatIndex, position.voiceIndex);
}

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
// <!-- req editingcore:01031fb0.4040 --> <!-- req editingcore:01031fb0.e93f -->
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
    const { trackIndex, barIndex, voiceIndex, beatIndex } = this.position;
    const beat = voiceBeats(this.score, trackIndex, barIndex, voiceIndex)[beatIndex];
    const origin = beat === undefined ? null : findNoteOnString(beat, this.stringNumber);
    if (origin === null) return NOTHING_TO_RESTORE;
    // <!-- req editingcore:b1c0352e.c906 -->
    const destination = findNextNoteOnString(
      this.score,
      trackIndex,
      barIndex,
      beatIndex,
      this.stringNumber,
      voiceIndex,
    );
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
// <!-- req editingcore:70164317.dc62 --> <!-- req editingcore:70164317.8fd8 -->
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
 * 奏法記号の論理名 `Note.techniques` は 1 つの項目としては持たず、alphaTab の `Note` の属性（このパッチのキー）と `Beat` の属性
 * （`BeatTechniquePatch` の `tap`・`slap`・`pop`・`brushType`）に分けて持つ（editing-core.md 3.5 節の表）。
 */
// <!-- req editingcore:0e5701e6.6abd --> <!-- req editingcore:0e5701e6.8be3 --> <!-- req editingcore:0e5701e6.32d4 --> <!-- req editingcore:0e5701e6.cdb6 -->
export interface NoteTechniquePatch {
  // <!-- req editingcore:54e0b2f1.344d -->
  // <!-- req editingcore:be452280.b740 --> <!-- req editingcore:bc2ca04e.a343 --> <!-- req editingcore:bc2ca04e.b59c -->
  slideOutType?: model.SlideOutType;
  // data-model-persistence.md 4 節：スライドインと人工ハーモニクスの音の高さは Note の属性に持ち、JsonConverter が song に書くので保存の形を足さない <!-- req datamodelpersistence:4457041c.fea9 --> <!-- req datamodelpersistence:4457041c.0d6e --> <!-- req datamodelpersistence:4457041c.a5f3 --> <!-- req datamodelpersistence:4457041c.ab84 -->
  // <!-- req datamodelpersistence:4457041c.f566 -->
  // <!-- req editingcore:be452280.7799 --> <!-- req editingcore:bc2ca04e.602e --> <!-- req editingcore:1c389377.f2ec --> <!-- req editingcore:1c389377.6747 -->
  slideInType?: model.SlideInType;
  // <!-- req editingcore:04ce02ad.1eb6 --> <!-- req editingcore:a4b3af74.38e9 --> <!-- req editingcore:062435c5.8579 --> <!-- req editingcore:062435c5.e6bf --> <!-- req editingcore:062435c5.1886 -->
  isHammerPullOrigin?: boolean;
  // <!-- req editingcore:56aa503a.34a3 --> <!-- req editingcore:56aa503a.b089 --> <!-- req editingcore:56aa503a.e73c --> <!-- req editingcore:56aa503a.fbe2 -->
  harmonicType?: model.HarmonicType;
  /** 人工ハーモニクスで鳴らす音の高さ。0（指定なし）・12・7・5・4 のどれか（7.2 節）。自然ハーモニクスでは渡さず、コマンドがフレットから入れる（7.3 節）。 */
  // <!-- req editingcore:56aa503a.6189 -->
  harmonicValue?: number;
  // <!-- req editingcore:f6ce605b.efd7 -->
  isPalmMute?: boolean;
  // <!-- req editingcore:e8124263.2879 -->
  vibrato?: model.VibratoType;
  // <!-- req editingcore:0124c163.bfa8 --> <!-- req editingcore:1a0ee3c5.2729 -->
  isGhost?: boolean;
  // <!-- req editingcore:210cae0b.309f --> <!-- req editingcore:4cb86f1f.309b --> <!-- req editingcore:1a0ee3c5.b59b -->
  isStaccato?: boolean;
  // <!-- req editingcore:210cae0b.1e03 --> <!-- req editingcore:1a0ee3c5.4403 --> <!-- req editingcore:b07f0d0e.968d --> <!-- req editingcore:91b54db8.859a --> <!-- req editingcore:91b54db8.075a -->
  accentuated?: model.AccentuationType;
  // <!-- req editingcore:c33d8a67.3e56 --> <!-- req editingcore:b07f0d0e.8c98 -->
  bendType?: model.BendType;
  // <!-- req editingcore:c33d8a67.4480 -->
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
 * スライドアウトの種類（editing-core.md 3.5 節）：シフト・レガート・下へ・上への 4 つと、外す `None`。alphaTab 1.8.4 の
 * `SlideOutType` にあるピックスライド（`PickSlideDown`・`PickSlideUp`）は受けない。
 */
// <!-- req editingcore:ff4040a8.9712 --> <!-- req editingcore:ff4040a8.f08f --> <!-- req editingcore:ff4040a8.013c --> <!-- req editingcore:ff4040a8.22c3 -->
export const SLIDE_OUT_TYPES: readonly model.SlideOutType[] = [
  model.SlideOutType.None,
  model.SlideOutType.Shift,
  model.SlideOutType.Legato,
  model.SlideOutType.OutDown,
  model.SlideOutType.OutUp,
];

/** スライドインの種類（editing-core.md 3.5 節）：下から入る・上から入るの 2 つと、外す `None`。スライドアウトの 4 つと合わせて 6 つ。 */
// <!-- req editingcore:119e6874.374a --> <!-- req editingcore:119e6874.f4bf -->
export const SLIDE_IN_TYPES: readonly model.SlideInType[] = [
  model.SlideInType.None,
  model.SlideInType.IntoFromBelow,
  model.SlideInType.IntoFromAbove,
];

/**
 * アーティキュレーションのうち `Note.accentuated` で持つ 3 つ（アクセント・強いアクセント・テヌート）と、外す `None`
 * （editing-core.md 3.5 節「次の 5 つに限り、増やさない」。残りの 2 つはスタッカート `isStaccato` とゴースト `isGhost`）。
 */
// <!-- req editingcore:210cae0b.1b70 --> <!-- req editingcore:7dfc71bb.d9c7 --> <!-- req editingcore:f8a42167.3b3c --> <!-- req editingcore:6955a88f.57f1 -->
export const ACCENTUATION_TYPES: readonly model.AccentuationType[] = [
  model.AccentuationType.None,
  model.AccentuationType.Normal,
  model.AccentuationType.Heavy,
  model.AccentuationType.Tenuto,
];

/**
 * patch のスライドとアクセントの値が、3.5 節の種類の中にあるかを確かめる。外なら何も変えずに RangeError を投げる
 * （`applyDurationSpec` と同じく、画面は 3.5 節の種類しか出さない前提で、外の値はコードの誤り）。
 */
function assertTechniqueKinds(patch: NoteTechniquePatch): void {
  // <!-- req editingcore:ff4040a8.073e -->
  assertKind('slideOutType', patch.slideOutType, SLIDE_OUT_TYPES);
  // <!-- req editingcore:119e6874.cb71 -->
  assertKind('slideInType', patch.slideInType, SLIDE_IN_TYPES);
  // <!-- req editingcore:210cae0b.25ba -->
  assertKind('accentuated', patch.accentuated, ACCENTUATION_TYPES);
}

function assertKind<T>(key: string, value: T | undefined, allowed: readonly T[]): void {
  if (value !== undefined && !allowed.includes(value)) throw new RangeError(`${key} out of range: ${String(value)}`);
}

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
// <!-- req editingcore:1a0ee3c5.fc19 --> <!-- req editingcore:1a0ee3c5.ee2a --> <!-- req editingcore:1a0ee3c5.1384 --> <!-- req editingcore:b07f0d0e.f48c --> <!-- req editingcore:b07f0d0e.36bb -->
export class SetTechniqueCommand extends AttributeCommand {
  readonly kind = 'set-technique';
  readonly label = 'set-technique';
  private readonly position: CursorPosition;
  private readonly stringNumber: number;
  private readonly patch: NoteTechniquePatch;

  // <!-- req editingcore:4d4a8a66.530b -->
  // <!-- req editingcore:c8327208.aad1 -->
  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, patch: NoteTechniquePatch) {
    // <!-- req editingcore:08fd2177.49a9 -->
    super(target.score, position.trackIndex);
    // スライドは 6 つ、アーティキュレーションは 5 つに限る（editing-core.md 3.5 節）。外の値は作る前に拒む
    // <!-- req editingcore:119e6874.43b0 -->
    assertTechniqueKinds(patch);
    this.position = position;
    this.stringNumber = stringNumber;
    this.patch = patch;
  }

  protected apply(): () => void {
    const beat = beatAt(this.score, this.position);
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
    // <!-- req editingcore:1c389377.554f --> <!-- req editingcore:b07f0d0e.773d -->
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

// ===== パームミュートの範囲 =====

/** パームミュートの範囲（editing-core.md 3.5 節）：その音だけ（'note'）と、次の音まで（'untilNext'）。付けるときの操作の単位。 */
// <!-- req editingcore:719dce4d.64c9 --> <!-- req editingcore:719dce4d.6cdd --> <!-- req editingcore:719dce4d.57f9 -->
export type PalmMuteScope = 'note' | 'untilNext';

/**
 * パームミュートを範囲で付ける・外すコマンドを作る（editing-core.md 3.5 節・7.3 節）。データは音符ごとの `Note.isPalmMute` で持つ。
 * 「その音だけ」はその音符への `SetTechniqueCommand` 1 つ。「次の音まで」は、その音符と、同じ弦の次の音符（同じボイスを
 * `findNextNoteRefOnString` でパートの最後の小節まで探す。無ければその音符だけ）への `SetTechniqueCommand` 2 つを `CompositeCommand` にまとめ、
 * 1 回の取り消しで 2 つとも戻るようにする。次の音符は作る時点の Score で決める。範囲を選ぶ画面の操作は 7.2 節と 7.3 節。
 */
export function createPalmMuteCommand(
  target: EditTarget,
  position: CursorPosition,
  stringNumber: number,
  scope: PalmMuteScope,
  isPalmMute: boolean,
): Command {
  // <!-- req editingcore:719dce4d.547d -->
  const first = new SetTechniqueCommand(target, position, stringNumber, { isPalmMute });
  // <!-- req editingcore:719dce4d.f0c5 -->
  if (scope === 'note') return first;
  // <!-- req editingcore:719dce4d.3796 -->
  const next = findNextNoteRefOnString(
    target.score,
    position.trackIndex,
    position.barIndex,
    position.beatIndex,
    stringNumber,
    position.voiceIndex,
  );
  if (next === null) return first;
  const second = new SetTechniqueCommand(target, next.ref.position, next.ref.stringNumber, { isPalmMute });
  return new CompositeCommand('set-technique', 'set-technique', [first, second]);
}

// ===== 奏法記号（Beat の属性） =====

/** `SetBeatTechniqueCommand` が受ける部分更新。指定したキーだけを変える（editing-core.md 3.5 節・7.3 節）。 */
// <!-- req editingcore:0e5701e6.002d -->
export interface BeatTechniquePatch {
  // <!-- req editingcore:21b34bbf.b3a2 --> <!-- req editingcore:61a23fc2.2c5e -->
  slap?: boolean;
  // <!-- req editingcore:b5a670dd.befb --> <!-- req editingcore:61a23fc2.77a9 -->
  pop?: boolean;
  // <!-- req editingcore:939dd3d2.fdb5 --> <!-- req editingcore:61a23fc2.69f1 -->
  tap?: boolean;
  // <!-- req editingcore:551671f6.eeac --> <!-- req editingcore:61a23fc2.9fb7 -->
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
// <!-- req editingcore:150285cb.0d8d -->
// <!-- req editingcore:150285cb.ad84 --> <!-- req editingcore:5671eaf8.c3be --> <!-- req editingcore:5671eaf8.13a5 --> <!-- req editingcore:5671eaf8.5c3e --> <!-- req editingcore:5671eaf8.5176 --> <!-- req editingcore:5671eaf8.5926 --> <!-- req editingcore:c8327208.eebd -->
export class SetBeatTechniqueCommand extends AttributeCommand {
  readonly kind = 'set-beat-technique';
  readonly label = 'set-beat-technique';
  private readonly position: CursorPosition;
  private readonly patch: BeatTechniquePatch;

  // <!-- req editingcore:c8327208.2933 --> <!-- req editingcore:c8327208.43a3 --> <!-- req editingcore:c8327208.b2ab --> <!-- req editingcore:c8327208.7ac5 -->
  constructor(target: EditTarget, position: CursorPosition, patch: BeatTechniquePatch) {
    // <!-- req editingcore:150285cb.febf -->
    super(target.score, position.trackIndex);
    this.position = position;
    this.patch = patch;
  }

  protected apply(): () => void {
    const beat = beatAt(this.score, this.position);
    const beatRecord = beat as unknown as Record<string, unknown>;
    const old = new Map<string, unknown>();
    for (const key of BEAT_TECHNIQUE_KEYS) {
      const value = this.patch[key];
      if (value === undefined) continue;
      old.set(key, beatRecord[key]);
      // <!-- req editingcore:150285cb.f575 -->
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
    const beat = beatAt(this.score, this.position);
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
