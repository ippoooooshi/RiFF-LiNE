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
// <!-- req editingcore:206e8bba.76da --> <!-- req editingcore:206e8bba.d1de --> <!-- req editingcore:206e8bba.ab1f --> <!-- req editingcore:1490c2e1.173a -->
export interface BendPointSpec {
  readonly offset: number;
  readonly value: number;
}

/**
 * チョーキングの幅（`BendPointSpec.value`）の上限。幅は 1/4 音きざみで 1/4 音から 3 音までの 12 とする（editing-core.md 7.3 節。
 * alphaTab 1.8.4 の `BendPoint.MaxValue` も 12）。`bendTechniquePatch` が 1 からこの値までの整数だけを受ける。
 */
// <!-- req editingcore:1490c2e1.6c8c -->
export const BEND_WIDTH_MAX = 12; // <!-- req editingcore:5e3119ad.b916 --> <!-- req editingcore:5e3119ad.3df3 -->

/** チョーキングの終わりの点の offset（拍の中の位置の終わり。alphaTab 1.8.4 の `BendPoint.MaxPosition` と同じ 60。editing-core.md 7.3 節）。 */
const BEND_OFFSET_END = 60;

/**
 * `SetTechniqueCommand` が受ける部分更新。指定したキーだけを変える（editing-core.md 3.5 節・7.3 節）。
 * チョーキング・スライド・ハンマリング・プリング・ハーモニクス・パームミュート・ビブラート・ゴースト・スタッカート・アクセントを扱う。
 * 奏法記号の論理名 `Note.techniques` は 1 つの項目としては持たず、alphaTab の `Note` の属性（このパッチのキー）と `Beat` の属性
 * （`BeatTechniquePatch` の `tap`・`slap`・`pop`・`brushType`）に分けて持つ（editing-core.md 3.5 節の表）。
 */
// <!-- req editingcore:0e5701e6.6abd --> <!-- req editingcore:0e5701e6.8be3 --> <!-- req editingcore:0e5701e6.32d4 --> <!-- req editingcore:0e5701e6.cdb6 -->
// <!-- req editingcore:cf586218.455c --> <!-- req editingcore:cf586218.6bc2 --> <!-- req editingcore:cf586218.192e --> <!-- req editingcore:8a0456c1.9f8d -->
// <!-- req editingcore:8a0456c1.1cfd --> <!-- req editingcore:0b44efd1.2e65 -->
export interface NoteTechniquePatch {
  // <!-- req editingcore:54e0b2f1.344d -->
  // <!-- req editingcore:be452280.b740 --> <!-- req editingcore:bc2ca04e.a343 --> <!-- req editingcore:bc2ca04e.b59c -->
  // <!-- req editingcore:7dd1a558.d8fa --> <!-- req editingcore:ee07d1b0.a050 -->
  slideOutType?: model.SlideOutType;
  // data-model-persistence.md 4 節：スライドインと人工ハーモニクスの音の高さは Note の属性に持ち、JsonConverter が song に書くので保存の形を足さない <!-- req datamodelpersistence:4457041c.fea9 --> <!-- req datamodelpersistence:4457041c.0d6e --> <!-- req datamodelpersistence:4457041c.a5f3 --> <!-- req datamodelpersistence:4457041c.ab84 -->
  // <!-- req datamodelpersistence:4457041c.f566 -->
  // <!-- req editingcore:be452280.7799 --> <!-- req editingcore:bc2ca04e.602e --> <!-- req editingcore:1c389377.f2ec --> <!-- req editingcore:1c389377.6747 -->
  // <!-- req editingcore:51d05c81.19ef --> <!-- req editingcore:52bca86e.b1a9 -->
  slideInType?: model.SlideInType;
  // <!-- req editingcore:04ce02ad.1eb6 --> <!-- req editingcore:a4b3af74.38e9 --> <!-- req editingcore:062435c5.8579 --> <!-- req editingcore:062435c5.e6bf --> <!-- req editingcore:062435c5.1886 -->
  // <!-- req editingcore:7dd1a558.ea0e --> <!-- req editingcore:7dd1a558.144b --> <!-- req editingcore:63082ec2.dd65 -->
  isHammerPullOrigin?: boolean;
  // <!-- req editingcore:98413237.34a3 --> <!-- req editingcore:98413237.b089 --> <!-- req editingcore:98413237.e73c --> <!-- req editingcore:98413237.fbe2 -->
  // <!-- req editingcore:78e97175.e1a6 --> <!-- req editingcore:78e97175.09cf --> <!-- req editingcore:78e97175.05f8 --> <!-- req editingcore:78e97175.0091 -->
  // <!-- req editingcore:7dd1a558.0b59 --> <!-- req editingcore:e931a8bf.293e -->
  harmonicType?: model.HarmonicType;
  /**
   * `Note.harmonicValue` に入れる値（editing-core.md 7.2 節）。意味はハーモニクスの種類で違う。
   *  - 人工ハーモニクス：押さえたフレットから何フレット上の倍音を鳴らすか。0 は「指定なし」、候補は 12・7・5・4 の 4 つ
   *    （0 と合わせて 5 つの候補から選び、数を入れる欄は出さない）。
   *  - 自然ハーモニクス：押さえたフレット（`Note.fret`）から `naturalHarmonicValue` で決めた値。patch では渡さず、
   *    コマンドがフレットから入れる（7.3 節）。変えた後の種類が自然になる音では、patch に 0 があっても書かない
   *    （0 でない値は人工でない音では拒む）。
   */
  // <!-- req editingcore:98413237.6189 -->
  // <!-- req editingcore:9930711e.50ab --> <!-- req editingcore:9930711e.1831 -->
  // <!-- req editingcore:51d05c81.3e41 --> <!-- req editingcore:430fce18.9ee8 -->
  harmonicValue?: number;
  // <!-- req editingcore:f6ce605b.efd7 -->
  // <!-- req editingcore:7dd1a558.a3d0 --> <!-- req editingcore:0342e41f.a251 -->
  isPalmMute?: boolean;
  // <!-- req editingcore:e8124263.2879 -->
  // <!-- req editingcore:7dd1a558.6473 --> <!-- req editingcore:39a20028.857a -->
  vibrato?: model.VibratoType;
  // <!-- req editingcore:0124c163.bfa8 --> <!-- req editingcore:1a0ee3c5.2729 -->
  // <!-- req editingcore:7dd1a558.fa7d --> <!-- req editingcore:11b620e0.b62a -->
  isGhost?: boolean;
  // <!-- req editingcore:210cae0b.309f --> <!-- req editingcore:4cb86f1f.309b --> <!-- req editingcore:1a0ee3c5.b59b -->
  // <!-- req editingcore:7dd1a558.0baf --> <!-- req editingcore:b8bebec8.cdf3 -->
  isStaccato?: boolean;
  // <!-- req editingcore:210cae0b.1e03 --> <!-- req editingcore:1a0ee3c5.4403 --> <!-- req editingcore:9013bf00.968d --> <!-- req editingcore:91b54db8.859a --> <!-- req editingcore:91b54db8.075a -->
  // <!-- req editingcore:7dd1a558.0a8d --> <!-- req editingcore:7dd1a558.59c0 --> <!-- req editingcore:4b8e164c.8ca4 -->
  accentuated?: model.AccentuationType;
  // <!-- req editingcore:c33d8a67.3e56 --> <!-- req editingcore:9013bf00.8c98 -->
  // <!-- req editingcore:7dd1a558.2339 --> <!-- req editingcore:8a479e6b.9b8f -->
  bendType?: model.BendType;
  // <!-- req editingcore:c33d8a67.4480 -->
  // <!-- req editingcore:3f09ce28.9cae -->
  // <!-- req editingcore:7dd1a558.1234 --> <!-- req editingcore:9661847c.086b -->
  bendPoints?: readonly BendPointSpec[];
}

/**
 * patch のうち、値をそのまま Note の同じ名前の項目へ入れるキー（bendPoints は中身を写すので別に扱う。harmonicValue は
 * 変えた後のハーモニクスの種類で入れる値が変わるので、`harmonicValueToSet` で別に決める）。
 */
// <!-- req editingcore:7dd1a558.5cba --> <!-- req editingcore:51d05c81.e42b --> <!-- req editingcore:c98f585f.d470 --> <!-- req editingcore:c98f585f.827c -->
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
 * ハーモニクスの種類（editing-core.md 3.5 節の「ハーモニクス 3 種」）：自然 `Natural`・人工 `Artificial`・ピンチ `Pinch` の 3 つと、
 * 外す `None`。alphaTab 1.8.4 の `HarmonicType` にある `Tap`・`Semi`・`Feedback` は 3.5 節の外で、読み込んだ曲にだけあり得る。
 */
export const HARMONIC_TYPES: readonly model.HarmonicType[] = [
  model.HarmonicType.None,
  model.HarmonicType.Natural,
  model.HarmonicType.Artificial,
  model.HarmonicType.Pinch,
];

/**
 * アーティキュレーションのうち `Note.accentuated` で持つ 3 つ（アクセント・強いアクセント・テヌート）と、外す `None`
 * （editing-core.md 3.5 節「次の 5 つに限り、増やさない」。残りの 2 つはスタッカート `isStaccato` とゴースト `isGhost`）。
 */
// <!-- req editingcore:210cae0b.1b70 --> <!-- req editingcore:7dfc71bb.d9c7 --> <!-- req editingcore:f8a42167.3b3c --> <!-- req editingcore:6955a88f.57f1 -->
// <!-- req editingcore:53a859eb.cb0f --> <!-- req editingcore:53a859eb.d573 -->
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
  // <!-- req editingcore:ee07d1b0.3430 --> <!-- req editingcore:ee07d1b0.b046 --> <!-- req editingcore:ee07d1b0.93be -->
  assertKind('slideOutType', patch.slideOutType, SLIDE_OUT_TYPES);
  // <!-- req editingcore:119e6874.cb71 -->
  assertKind('slideInType', patch.slideInType, SLIDE_IN_TYPES);
  // <!-- req editingcore:210cae0b.25ba -->
  assertKind('accentuated', patch.accentuated, ACCENTUATION_TYPES);
}

/**
 * patch の harmonicType が 3.5 節のハーモニクスの種類（`HARMONIC_TYPES`：自然・人工・ピンチと、外す `None`）の外なら、
 * その patch の harmonicType を受け付けず（音の harmonicType を変えず）、ほかの項目だけの patch を返す。中なら patch をそのまま返す
 * （editing-core.md 3.5 節の「ハーモニクス 3 種」・7.2 節の「自然・人工・ピンチから選べる」。alphaTab 1.8.4 の `Tap`・`Semi`・`Feedback` は当てない）。
 */
// <!-- req editingcore:98413237.b089 --> <!-- req editingcore:98413237.e73c --> <!-- req editingcore:98413237.fbe2 -->
// <!-- req editingcore:78e97175.09cf --> <!-- req editingcore:78e97175.05f8 --> <!-- req editingcore:78e97175.0091 -->
function acceptedHarmonicType(patch: NoteTechniquePatch): NoteTechniquePatch {
  if (patch.harmonicType === undefined || HARMONIC_TYPES.includes(patch.harmonicType)) return patch;
  const { harmonicType: _ignored, ...others } = patch;
  return others;
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
// <!-- req editingcore:b472a88b.08df -->
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
// <!-- req editingcore:c1b35673.28d1 -->
function harmonicValueToSet(note: model.Note, patch: NoteTechniquePatch): number | undefined {
  const harmonicTypeAfter = patch.harmonicType ?? note.harmonicType;
  // <!-- req editingcore:437f348c.cc8e -->
  if (patch.harmonicValue !== undefined && harmonicTypeAfter !== model.HarmonicType.Natural) return patch.harmonicValue;
  // <!-- req editingcore:c1b35673.396e --> <!-- req editingcore:c4e00446.fb79 --> <!-- req editingcore:c4e00446.7f25 --> <!-- req editingcore:c4e00446.df59 -->
  // <!-- req editingcore:437f348c.27e6 --> <!-- req editingcore:437f348c.5328 --> <!-- req editingcore:437f348c.649a --> <!-- req editingcore:437f348c.ad1a -->
  // <!-- req editingcore:437f348c.963f -->
  if (patch.harmonicType === model.HarmonicType.Natural) return naturalHarmonicValue(note.fret);
  // <!-- req editingcore:c1b35673.e8c6 --> <!-- req editingcore:c1b35673.b89e -->
  const toPinchOrNone =
    patch.harmonicType === model.HarmonicType.Pinch || patch.harmonicType === model.HarmonicType.None;
  const leavesArtificial = note.harmonicType === model.HarmonicType.Artificial && toPinchOrNone;
  // 自然からピンチか「なし」へ：自然でフレットから入れた値を残さない（editing-core.md 3.5 節・7.2 節）
  // <!-- req editingcore:c1b35673.aa5e --> <!-- req editingcore:c1b35673.96ea -->
  const naturalToPinchOrNone = note.harmonicType === model.HarmonicType.Natural && toPinchOrNone;
  // <!-- req editingcore:c1b35673.25bd -->
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
// <!-- req editingcore:1a0ee3c5.fc19 --> <!-- req editingcore:1a0ee3c5.ee2a --> <!-- req editingcore:1a0ee3c5.1384 --> <!-- req editingcore:9013bf00.f48c --> <!-- req editingcore:9013bf00.36bb -->
// <!-- req editingcore:51d05c81.b585 --> <!-- req editingcore:6938b8e2.00a8 --> <!-- req editingcore:7f086564.14ce -->
export class SetTechniqueCommand extends AttributeCommand {
  readonly kind = 'set-technique';
  readonly label = 'set-technique';
  private readonly position: CursorPosition;
  private readonly stringNumber: number;
  private readonly patch: NoteTechniquePatch;

  // <!-- req editingcore:4d4a8a66.530b -->
  // <!-- req editingcore:c8327208.aad1 -->
  // <!-- req editingcore:dc8a409c.efaa --> <!-- req editingcore:03c0c9db.4113 --> <!-- req editingcore:03c0c9db.8ac8 --> <!-- req editingcore:03c0c9db.2642 -->
  // <!-- req editingcore:03c0c9db.2776 -->
  constructor(target: EditTarget, position: CursorPosition, stringNumber: number, patch: NoteTechniquePatch) {
    // <!-- req editingcore:08fd2177.49a9 -->
    super(target.score, position.trackIndex);
    const imported = this.acceptsImportedValues();
    // スライドは 6 つ、アーティキュレーションは 5 つに限る（editing-core.md 3.5 節）。外の値は作る前に拒む
    // <!-- req editingcore:119e6874.43b0 -->
    if (!imported) assertTechniqueKinds(patch);
    this.position = position;
    this.stringNumber = stringNumber;
    // ハーモニクスは自然・人工・ピンチ（と外す None）に限る（3.5 節・7.2 節）。外の harmonicType は受け付けず、ほかの項目だけを当てる
    // <!-- req editingcore:98413237.b089 --> <!-- req editingcore:78e97175.09cf -->
    this.patch = imported ? patch : acceptedHarmonicType(patch);
  }

  /**
   * 3.5 節の外の値（読み込みで入るピックスライド・`Tap`・`Semi`・`Feedback` のハーモニクス、人工以外の音の高さ）を、確かめずに受けるか。
   * 画面から作るこのクラスは受けない（false）。貼り付けの子（`PasteCommand.ts` の中だけのクラス）だけが true を返し、コピーした音の値を
   * そのまま写す（editing-core.md 9 節、2026-11-10 本人の決定、honnin-done 271 番）。コンストラクタの中で呼ぶので、継いだクラスの
   * フィールドを読まずに値を返すこと（継いだクラスのフィールドは、このクラスのコンストラクタの後で入る）。
   */
  protected acceptsImportedValues(): boolean {
    return false;
  }

  protected apply(): () => void {
    const beat = beatAt(this.score, this.position);
    const note = findNoteOnString(beat, this.stringNumber);
    if (note === null) return NOTHING_TO_RESTORE;
    // 音の高さは人工ハーモニクスの音でだけ受ける（editing-core.md 3.5 節・7.2 節）。音の今の種類を見るので、音が分かるここで、何かを変える前に拒む
    if (!this.acceptsImportedValues()) assertHarmonicValueTarget(note, this.patch);

    // <!-- req editingcore:c34b75ec.ecd4 -->
    const noteRecord = note as unknown as Record<string, unknown>;
    const old = new Map<string, unknown>();
    // 同じキーを 2 度は入れない（harmonicValue・bendPoints・maxBendPoint は scalar のキーに無く、下で 1 度だけ入れる）
    const set = (key: string, value: unknown): void => {
      old.set(key, noteRecord[key]);
      noteRecord[key] = value;
    };

    // <!-- req editingcore:08fd2177.374c -->
    // <!-- req editingcore:1c389377.554f --> <!-- req editingcore:9013bf00.ced5 --> <!-- req editingcore:9013bf00.2a69 --> <!-- req editingcore:174a70f0.2a69 -->
    const harmonicValue = harmonicValueToSet(note, this.patch);
    for (const key of NOTE_SCALAR_KEYS) {
      const value = this.patch[key];
      // <!-- req editingcore:174a70f0.db80 --> <!-- req editingcore:174a70f0.8b28 -->
      if (value !== undefined) set(key, value);
    }
    // <!-- req editingcore:c1b35673.0447 --> <!-- req editingcore:c1b35673.bb5b -->
    if (harmonicValue !== undefined) set('harmonicValue', harmonicValue);
    if (this.patch.bendPoints !== undefined) {
      const bendType = note.bendType;
      set('bendPoints', null);
      set('maxBendPoint', null); // <!-- req editingcore:9013bf00.d1a9 --> <!-- req editingcore:174a70f0.49a4 -->
      for (const point of this.patch.bendPoints) note.addBendPoint(new model.BendPoint(point.offset, point.value));
      // addBendPoint は bendType が None のとき Custom に変えるので、patch で決まった値（無ければ前の値）に戻す
      note.bendType = bendType;
    }

    return () => {
      // <!-- req editingcore:51d05c81.76fa --> <!-- req editingcore:437f348c.95ab -->
      for (const [key, value] of old) noteRecord[key] = value;
    };
  }
}

// ===== 奏法記号の patch を作る関数（editing-core.md 7.3 節） =====
// チョーキングの幅と形・ビブラートの付け外し・アーティキュレーションを外すときの patch は、ここの patch を返すだけの関数で作る。
// どの関数もモデルを書き換えず、新しい patch を返すだけ。画面はこの patch を EditingService.setTechnique(stringNumber, patch) に渡す
// （EditingService に新しい口は足さない）。呼び方の文言（「1/4 音」から「3 音」）は画面の側に置き、ここは数と形だけを受ける。
// <!-- req editingcore:d0e2b0bf.733c --> <!-- req editingcore:d0e2b0bf.b400 --> <!-- req editingcore:d0e2b0bf.63cd --> <!-- req editingcore:d0e2b0bf.5a3b -->
// <!-- req editingcore:d0e2b0bf.1052 --> <!-- req editingcore:d0e2b0bf.0dcf --> <!-- req editingcore:47ced8c5.2ce2 -->

/** チョーキングの形。'bend' が上げる、'bend-release' が上げて戻す、'prebend-release' が戻す（editing-core.md 7.3 節）。 */
// <!-- req editingcore:b174f20f.3b2d --> <!-- req editingcore:61e3a528.a622 --> <!-- req editingcore:61e3a528.3f46 --> <!-- req editingcore:61e3a528.c5eb -->
export type BendShape = 'bend' | 'bend-release' | 'prebend-release';

/**
 * 幅 width（`BendPointSpec.value` の 1 から 12 の整数。1 が 1/4 音、2 が半音、4 が 1 音、6 が 1 音半）と形から、チョーキングの patch を
 * 作る（editing-core.md 7.3 節の表）。幅の value を v として：
 *  - 上げる（'bend'）：`BendType.Bend`、(0, 0)・(60, v) の 2 点（「半音」「1 音」「1 音半」も、ほかの幅も同じ写し方）
 *  - 上げて戻す（'bend-release'）：`BendType.BendRelease`、(0, 0)・(20, v)・(40, v)・(60, 0) の 4 点（中の 2 点は拍の中を 3 つに分けた位置）
 *  - 戻す（'prebend-release'）：`BendType.PrebendRelease`、(0, v)・(60, 0) の 2 点
 * 幅が 1 から 12 の整数でなければ、コマンドのほかの範囲の外の値と同じく RangeError を投げる。`Note.bendStyle` は patch に入れない。
 */
// <!-- req editingcore:eb8c2f57.2ed2 --> <!-- req editingcore:83dbe72d.244c --> <!-- req editingcore:83dbe72d.f2c9 -->
// <!-- req editingcore:61e3a528.3b32 --> <!-- req editingcore:61e3a528.b06b -->
export function bendTechniquePatch(width: number, shape: BendShape): NoteTechniquePatch {
  // <!-- req editingcore:83dbe72d.0ea3 --> <!-- req editingcore:83dbe72d.8732 -->
  if (!Number.isInteger(width) || width < 1 || width > BEND_WIDTH_MAX) {
    throw new RangeError(`bend width out of range: ${String(width)}`);
  }
  switch (shape) {
    // <!-- req editingcore:83dbe72d.a071 --> <!-- req editingcore:527041b2.b8e7 --> <!-- req editingcore:527041b2.2f41 -->
    // <!-- req editingcore:d1f26619.3d84 --> <!-- req editingcore:d1f26619.b247 --> <!-- req editingcore:d1f26619.7d92 --> <!-- req editingcore:d1f26619.677f -->
    // <!-- req editingcore:d1f26619.fb2c --> <!-- req editingcore:d1f26619.e028 --> <!-- req editingcore:d1f26619.d24d --> <!-- req editingcore:d1f26619.b4be -->
    // <!-- req editingcore:d1f26619.7613 --> <!-- req editingcore:b86aff2d.dcd6 --> <!-- req editingcore:b86aff2d.6a0d --> <!-- req editingcore:b86aff2d.da55 -->
    // <!-- req editingcore:b86aff2d.2ee3 -->
    case 'bend':
      return {
        bendType: model.BendType.Bend,
        bendPoints: [
          { offset: 0, value: 0 },
          { offset: BEND_OFFSET_END, value: width },
        ],
      };
    // <!-- req editingcore:83dbe72d.98cb --> <!-- req editingcore:149af8bd.5577 --> <!-- req editingcore:149af8bd.169e --> <!-- req editingcore:149af8bd.bc07 -->
    // <!-- req editingcore:149af8bd.cc9b --> <!-- req editingcore:149af8bd.ad3b --> <!-- req editingcore:4ab7f7f4.1cb5 --> <!-- req editingcore:4ab7f7f4.6fec -->
    // <!-- req editingcore:4ab7f7f4.d6e1 -->
    case 'bend-release':
      return {
        bendType: model.BendType.BendRelease,
        bendPoints: [
          { offset: 0, value: 0 },
          { offset: BEND_OFFSET_END / 3, value: width },
          { offset: (BEND_OFFSET_END * 2) / 3, value: width },
          { offset: BEND_OFFSET_END, value: 0 },
        ],
      };
    // <!-- req editingcore:83dbe72d.9c1a --> <!-- req editingcore:f22c5a1c.9e03 --> <!-- req editingcore:f22c5a1c.20ac --> <!-- req editingcore:f22c5a1c.62fe -->
    case 'prebend-release':
      return {
        bendType: model.BendType.PrebendRelease,
        bendPoints: [
          { offset: 0, value: width },
          { offset: BEND_OFFSET_END, value: 0 },
        ],
      };
  }
}

/** チョーキングを外す patch（bendType は None、bendPoints は空。editing-core.md 7.3 節）。 */
// <!-- req editingcore:1979daa4.2ce1 --> <!-- req editingcore:83dbe72d.bbfb --> <!-- req editingcore:83dbe72d.1dee -->
// <!-- req editingcore:d1f26619.f1e0 --> <!-- req editingcore:d1f26619.bb1d -->
export function clearBendPatch(): NoteTechniquePatch {
  return { bendType: model.BendType.None, bendPoints: [] };
}

/** ビブラートを付ける（on が真で Slight）か外す（on が偽で None）patch。強さは 1 つに決める（editing-core.md 7.3 節）。 */
// <!-- req editingcore:50317b6c.63d3 --> <!-- req editingcore:a562405e.009e --> <!-- req editingcore:a562405e.a0c4 -->
// <!-- req editingcore:3ddf9fd1.e09b --> <!-- req editingcore:3ddf9fd1.0593 --> <!-- req editingcore:3ddf9fd1.625d -->
export function vibratoPatch(on: boolean): NoteTechniquePatch {
  return { vibrato: on ? model.VibratoType.Slight : model.VibratoType.None };
}

/** アーティキュレーションを外す patch（accentuated は None、isStaccato と isGhost は偽。editing-core.md 7.3 節）。 */
// <!-- req editingcore:7759dec2.29c5 --> <!-- req editingcore:405c4cbc.d54c --> <!-- req editingcore:405c4cbc.897b --> <!-- req editingcore:405c4cbc.d5d9 -->
// <!-- req editingcore:7f086564.7e4b --> <!-- req editingcore:df8b34b5.6719 --> <!-- req editingcore:df8b34b5.ca61 --> <!-- req editingcore:df8b34b5.a0cd -->
// <!-- req editingcore:df8b34b5.a1ca -->
export function clearArticulationPatch(): NoteTechniquePatch {
  return { accentuated: model.AccentuationType.None, isStaccato: false, isGhost: false };
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
  // <!-- req editingcore:df776d48.9ed2 --> <!-- req editingcore:df776d48.cabb -->
  return new CompositeCommand('set-technique', 'set-technique', [first, second]);
}

// ===== 奏法記号（Beat の属性） =====

/** `SetBeatTechniqueCommand` が受ける部分更新。指定したキーだけを変える（editing-core.md 3.5 節・7.3 節）。 */
// <!-- req editingcore:0e5701e6.002d -->
// <!-- req editingcore:58be95eb.3832 --> <!-- req editingcore:58be95eb.f766 --> <!-- req editingcore:58be95eb.bada --> <!-- req editingcore:58be95eb.4eff -->
// <!-- req editingcore:58be95eb.98b9 -->
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

// <!-- req editingcore:c18f9805.38e2 --> <!-- req editingcore:c18f9805.23a1 --> <!-- req editingcore:c18f9805.77b3 --> <!-- req editingcore:c18f9805.63b5 -->
// <!-- req editingcore:c18f9805.1383 -->
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
// <!-- req editingcore:89c37625.49d5 -->
export class SetBeatTechniqueCommand extends AttributeCommand {
  readonly kind = 'set-beat-technique';
  readonly label = 'set-beat-technique';
  private readonly position: CursorPosition;
  private readonly patch: BeatTechniquePatch;

  // <!-- req editingcore:c8327208.2933 --> <!-- req editingcore:c8327208.43a3 --> <!-- req editingcore:c8327208.b2ab --> <!-- req editingcore:c8327208.7ac5 -->
  // <!-- req editingcore:49e1a5bc.01fe --> <!-- req editingcore:8a732b83.715d --> <!-- req editingcore:8a732b83.6ed7 --> <!-- req editingcore:8a732b83.32b4 -->
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
    // <!-- req editingcore:dbca6851.818e --> <!-- req editingcore:dbca6851.d164 -->
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
