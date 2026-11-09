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
// <!-- req editingcore:8ee56da1.7617 -->
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
    // <!-- req editingcore:927478a0.c906 -->
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
    // <!-- req editingcore:54e0b2f1.ea2b --> <!-- req editingcore:067be5b3.f7bf --> <!-- req editingcore:3610d19d.a986 --> <!-- req editingcore:3610d19d.0139 --> <!-- req editingcore:3610d19d.54a4 --> <!-- req editingcore:927478a0.5c7e --> <!-- req editingcore:927478a0.fe9a -->
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
// <!-- req editingcore:5ab5a2e6.b6d2 --> <!-- req editingcore:8ee56da1.9efb -->
// <!-- req editingcore:36819059.208d --> <!-- req editingcore:36819059.2576 -->
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
    // <!-- req editingcore:c8eec0d8.ed3c -->
    // <!-- req editingcore:36819059.bf25 -->
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
  // <!-- req editingcore:78e97175.e1a6 --> <!-- req editingcore:78e97175.09cf --> <!-- req editingcore:78e97175.05f8 --> <!-- req editingcore:78e97175.0091 -->
  harmonicType?: model.HarmonicType;
  /**
   * `Note.harmonicValue` に入れる値（editing-core.md 7.2 節）。意味はハーモニクスの種類で違う。
   *  - 人工ハーモニクス：押さえたフレットから何フレット上の倍音を鳴らすか。0 は「指定なし」、候補は 12・7・5・4 の 4 つ
   *    （0 と合わせて 5 つの候補から選び、数を入れる欄は出さない）。
   *  - 自然ハーモニクス：押さえたフレット（`Note.fret`）から `naturalHarmonicValue` で決めた値。patch では渡さず、
   *    コマンドがフレットから入れる（7.3 節）。変えた後の種類が自然になる音では、patch に 0 があっても書かない
   *    （0 でない値は人工でない音では拒む）。
   */
  // <!-- req editingcore:56aa503a.6189 -->
  // <!-- req editingcore:9930711e.50ab --> <!-- req editingcore:9930711e.1831 -->
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
  // <!-- req editingcore:3f09ce28.9cae -->
  bendPoints?: readonly BendPointSpec[];
}

/**
 * patch のうち、値をそのまま Note の同じ名前の項目へ入れるキー（bendPoints は中身を写すので別に扱う。harmonicValue は
 * 変えた後のハーモニクスの種類で入れる値が変わるので、`harmonicValueToSet` で別に決める）。
 */
const NOTE_SCALAR_KEYS = [
  'slideOutType',
  'slideInType',
  'isHammerPullOrigin',
  'harmonicType',
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
// <!-- req editingcore:1c51f82c.999f -->
export const SLIDE_IN_TYPES: readonly model.SlideInType[] = [
  // <!-- req editingcore:1c51f82c.4bf4 -->
  model.SlideInType.None,
  // <!-- req editingcore:1c51f82c.64e8 -->
  model.SlideInType.IntoFromBelow,
  // <!-- req editingcore:1c51f82c.db05 -->
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
 * patch の harmonicValue が 0 でないとき、変えた後のハーモニクスの種類（patch に harmonicType があればそれ、無ければ音の今の種類）が
 * 人工ハーモニクスかを確かめる。人工でなければ何も変えずに RangeError を投げる（editing-core.md 3.5 節・7.2 節。人工ハーモニクスを
 * 付けた音でだけ鳴らす音の高さを選べ、自然ハーモニクスの値は patch では渡さずコマンドがフレットから入れる）。0 は「指定なし」なので、
 * どの種類の音でも受ける。画面は人工ハーモニクスの音にしか音の高さを出さない前提で、外の値はコードの誤りなので、利用者向けのエラーコードは作らない。
 */
function assertHarmonicValueTarget(note: model.Note, patch: NoteTechniquePatch): void {
  const value = patch.harmonicValue;
  if (value === undefined || value === 0) return;
  const harmonicType = patch.harmonicType ?? note.harmonicType;
  if (harmonicType !== model.HarmonicType.Artificial) {
    throw new RangeError(`harmonicValue out of range: ${String(value)} (harmonicType ${String(harmonicType)})`);
  }
}

/**
 * 自然ハーモニクスの `harmonicValue` を、押さえたフレットから alphaTab 1.8.4 の `ModelUtils.deltaFretToHarmonicValue` と同じ表で返す
 * （editing-core.md 7.2 節）。alphaTab 1.8.4 は `ModelUtils` を外に出していないので、表を写して持つ。
 */
// <!-- req editingcore:c4e00446.3726 --> <!-- req editingcore:c4e00446.c81c --> <!-- req editingcore:1ef261de.0a75 --> <!-- req editingcore:1ef261de.60b6 --> <!-- req editingcore:1ef261de.f7c2 --> <!-- req editingcore:1ef261de.c1ee -->
export function naturalHarmonicValue(fret: number): number {
  switch (fret) {
    // <!-- req editingcore:c4e00446.cd82 -->
    case 2:
      return 2.4;
    // <!-- req editingcore:c4e00446.d2eb -->
    case 3:
      return 3.2;
    // <!-- req editingcore:c4e00446.77fe --> <!-- req editingcore:c4e00446.149a --> <!-- req editingcore:c4e00446.8d17 --> <!-- req editingcore:c4e00446.004a --> <!-- req editingcore:c4e00446.2dcc --> <!-- req editingcore:c4e00446.6278 --> <!-- req editingcore:c4e00446.c1f8 --> <!-- req editingcore:c4e00446.7e1c --> <!-- req editingcore:c4e00446.4759 -->
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
    // <!-- req editingcore:c4e00446.6ffb -->
    case 8:
      return 8.2;
    // <!-- req editingcore:c4e00446.9c41 -->
    case 10:
      return 9.6;
    // <!-- req editingcore:c4e00446.7e53 --> <!-- req editingcore:c4e00446.ea21 -->
    case 14:
    case 15:
      return 14.7;
    // <!-- req editingcore:c4e00446.f12f --> <!-- req editingcore:c4e00446.c582 -->
    case 21:
    case 22:
      return 21.7;
    // <!-- req editingcore:c4e00446.3a7f --> <!-- req editingcore:c4e00446.ebbb --> <!-- req editingcore:c4e00446.a6d6 --> <!-- req editingcore:c4e00446.c87e --> <!-- req editingcore:c4e00446.8e40 --> <!-- req editingcore:c4e00446.aea0 --> <!-- req editingcore:c4e00446.af1c --> <!-- req editingcore:c4e00446.0be0 -->
    default:
      return 12;
  }
}

/**
 * patch を当てるときに音へ入れる harmonicValue（editing-core.md 7.2 節・7.3 節）。undefined なら harmonicValue を変えない。
 *  - patch に harmonicValue があり、変えた後の種類（patch に harmonicType があればそれ、無ければ音の今の種類）が自然でない：patch の値
 *  - 変えた後の種類が自然になる音の patch の harmonicValue は書かない（7.3 節「自然ハーモニクスでは渡さず、コマンドがフレットから入れる」。
 *    0 でない値は `assertHarmonicValueTarget` が先に拒むので、書かずに落とすのは 0 だけ）。下の決まりへ進む
 * patch に harmonicValue が無いか、上で書かなかったとき、ハーモニクスの種類を変える patch では次の値を入れる。
 *  - 自然へ変える：その音のフレットから `naturalHarmonicValue` の値（音の今の種類が自然でも、フレットから入れ直す）
 *  - 人工からピンチか「なし」へ変える：0（人工ハーモニクスのために選んだ値を、別の種類の鳴り方と描き方に残さない）
 *  - 自然からピンチか「なし」へ変える：0（自然ハーモニクスでフレットから決めた値を、ピンチと「なし」の音に残さない。
 *    editing-core.md 3.5 節「人工のときだけ、鳴らす音の高さを `Note.harmonicValue` に持つ」。alphaTab 1.8.4 の `harmonicPitch` は
 *    harmonicType が None でなければ harmonicValue から高さを出すので、残すとピンチの音がその値で鳴る）
 *  - 自然から人工へ変える：0（音の高さを選ばないときは「指定なし」。自然ハーモニクスでフレットから決めた値を人工に残さない。
 *    editing-core.md 7.2 節「自然から人工へ変えるときも、音の高さを選ばなければ同じ patch で 0 にする」）
 * それ以外（種類を変えない〈自然の音へ種類の無い patch で 0 を渡したときも、今の値を残す〉・ハーモニクスの無い音かピンチの音を
 * 人工へ変える〈「指定なし」の既定で 0 のまま変えない〉・ハーモニクスの無い音かピンチの音をピンチか「なし」へ変える〈もともと 0〉）は undefined。
 */
// <!-- req editingcore:6deaf793.28d1 -->
function harmonicValueToSet(note: model.Note, patch: NoteTechniquePatch): number | undefined {
  const harmonicTypeAfter = patch.harmonicType ?? note.harmonicType;
  if (patch.harmonicValue !== undefined && harmonicTypeAfter !== model.HarmonicType.Natural) return patch.harmonicValue;
  // <!-- req editingcore:6deaf793.396e --> <!-- req editingcore:c4e00446.fb79 --> <!-- req editingcore:c4e00446.7f25 --> <!-- req editingcore:c4e00446.df59 -->
  if (patch.harmonicType === model.HarmonicType.Natural) return naturalHarmonicValue(note.fret);
  // <!-- req editingcore:6deaf793.e8c6 --> <!-- req editingcore:6deaf793.b89e -->
  const toPinchOrNone =
    patch.harmonicType === model.HarmonicType.Pinch || patch.harmonicType === model.HarmonicType.None;
  const leavesArtificial = note.harmonicType === model.HarmonicType.Artificial && toPinchOrNone;
  // 自然からピンチか「なし」へ：自然でフレットから入れた値を残さない（editing-core.md 3.5 節・7.2 節）
  const naturalToPinchOrNone = note.harmonicType === model.HarmonicType.Natural && toPinchOrNone;
  // <!-- req editingcore:6deaf793.25bd -->
  const naturalToArtificial =
    note.harmonicType === model.HarmonicType.Natural && patch.harmonicType === model.HarmonicType.Artificial;
  // <!-- req editingcore:e92d36cf.b103 --> <!-- req editingcore:e92d36cf.e406 --> <!-- req editingcore:e92d36cf.d531 --> <!-- req editingcore:e92d36cf.4f0c -->
  return leavesArtificial || naturalToPinchOrNone || naturalToArtificial ? 0 : undefined;
}

/**
 * Note の奏法記号とアーティキュレーションを変える（editing-core.md 3.5 節・7.3 節）。patch で指定したキーだけを変え、undo は
 * 指定したキーの前の値だけを戻す。アーティキュレーション（アクセント・強いアクセント・テヌート・スタッカート・ゴースト）は、
 * 付けるのも外すのも本コマンドで行う（外すのは accentuated を None、isStaccato と isGhost を偽にする patch）。
 * patch の harmonicType が Natural で harmonicValue が無いときは、その音のフレットから naturalHarmonicValue で値を入れ、
 * 人工ハーモニクスの音をピンチか「なし」へ変える patch と、自然ハーモニクスの音をピンチか「なし」か人工へ変える patch で
 * harmonicValue が無いときは、同じコマンドで harmonicValue を 0 にする（3.5 節・7.2 節。undo で前の値に戻る）。
 * 変えた後の種類が自然になる音では、patch の harmonicValue（0 だけが通る）を書かず、上の決まりで入れる（7.3 節）。
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
    // 音の高さは人工ハーモニクスの音でだけ受ける（editing-core.md 3.5 節・7.2 節）。音の今の種類を見るので、音が分かるここで、何かを変える前に拒む
    assertHarmonicValueTarget(note, this.patch);

    const noteRecord = note as unknown as Record<string, unknown>;
    const old = new Map<string, unknown>();
    // 同じキーを 2 度は入れない（harmonicValue・bendPoints・maxBendPoint は scalar のキーに無く、下で 1 度だけ入れる）
    const set = (key: string, value: unknown): void => {
      old.set(key, noteRecord[key]);
      noteRecord[key] = value;
    };

    // <!-- req editingcore:08fd2177.374c -->
    // <!-- req editingcore:1c389377.554f --> <!-- req editingcore:b07f0d0e.773d -->
    const harmonicValue = harmonicValueToSet(note, this.patch);
    for (const key of NOTE_SCALAR_KEYS) {
      const value = this.patch[key];
      if (value !== undefined) set(key, value);
    }
    // <!-- req editingcore:6deaf793.0447 --> <!-- req editingcore:6deaf793.bb5b -->
    if (harmonicValue !== undefined) set('harmonicValue', harmonicValue);
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
// <!-- req editingcore:e67c3e99.d2b6 --> <!-- req editingcore:e67c3e99.040d -->
export type PalmMuteScope = 'note' | 'untilNext';

/**
 * パームミュートを範囲で付ける・外すコマンドを作る（editing-core.md 3.5 節・7.3 節）。データは音符ごとの `Note.isPalmMute` で持つ。
 * 「その音だけ」はその音符への `SetTechniqueCommand` 1 つ。「次の音まで」は、その音符と、同じ弦の次の音符（同じボイスを
 * `findNextNoteRefOnString` でパートの最後の小節まで探す。無ければその音符だけ）への `SetTechniqueCommand` 2 つを `CompositeCommand` にまとめ、
 * 1 回の取り消しで 2 つとも戻るようにする。次の音符は作る時点の Score で決める。範囲を選ぶ画面の操作は 7.2 節と 7.3 節。
 */
// <!-- req editingcore:e67c3e99.34fe -->
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
  // <!-- req editingcore:2be45d8b.fdd7 -->
  slap?: boolean;
  // <!-- req editingcore:b5a670dd.befb --> <!-- req editingcore:61a23fc2.77a9 -->
  // <!-- req editingcore:2be45d8b.69fa -->
  pop?: boolean;
  // <!-- req editingcore:939dd3d2.fdb5 --> <!-- req editingcore:61a23fc2.69f1 -->
  // <!-- req editingcore:2be45d8b.fe97 -->
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
// <!-- req editingcore:2be45d8b.2bc4 -->
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
