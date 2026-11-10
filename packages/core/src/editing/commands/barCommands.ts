/**
 * 小節の挿入と削除（editing-core.md 2.6 節の表・10 節、基本設計 04 章 10 節）。
 *
 * `InsertBarCommand` と `DeleteBarCommand` は、曲の全部のパートの小節の並びを同じように変える `CompositeCommand` として作る
 * （editing-core.md 10 節）。子は 10 節の箇条の順に並べ、1 回の取り消しで全体が戻る（2.3 節）。
 *
 * - 挿入の子：曲共通の小節（MasterBar）を足す `InsertMasterBarCommand` → パートごとに小節を足す `InsertPartBarCommand`（パートの番号の順）
 * - 削除の子：マーカーとメモを消すか移す `MoveBarAnnotationsCommand` → パートごとに小節を消す `DeletePartBarCommand` → 曲共通の小節を消す `DeleteMasterBarCommand`
 *
 * 子のコマンドは `CompositeCommand` の中だけで使い、履歴に単独で積まない（10 節の (b)）。
 *
 * 継ぐ向きの指定（10 節）：新しい小節の拍子もテンポも、いつも「直前を継ぐ」で始める。拍子は `explicitTimeSignatureBars`（3.2 節）に
 * 入れないこと、テンポは `MasterBar.tempoAutomations` を空にすることで表す。挿入と削除では一覧の小節の番号をずらすだけで、
 * 継ぐという指定そのものは変えず、継いでいる小節の拍子の値は `resolveInheritedTimeSignatures` で execute と undo の最後にそろえる。
 */

import { model } from '@coderline/alphatab';

import type { Memo, SectionMarker } from '../../domain/types';
import { BASE_COMMAND_BYTES } from '../commandBase';
import { CompositeCommand } from '../CompositeCommand';
import type { BarDeleteDisposition } from '../EditingService';
import {
  allTrackIndices,
  barCount,
  createRestBeat,
  getMasterBar,
  getStaff,
  insertBeatAt,
  resolveInheritedTimeSignatures,
} from '../scoreModel';
import type { CommandOutcome, EditTarget } from '../types';
import type { Command } from './Command';
import { tempoAutomationsFor } from './SetTempoCommand';

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

/** 消した小節が持つ拍と音符 1 つあたりの推定の大きさ（バイト、editing-core.md 2.3 節の予算の見積もり）。 */
const HELD_ITEM_BYTES = 64;

/** 並びから item を 1 つ外す（execute で足したものを undo で外す）。 */
function removeItem<T>(items: T[], item: T): void {
  items.splice(items.indexOf(item), 1);
}

/** `barId`（曲共通の小節の番号の文字列）が `fromIndex` 以上のものを `delta` だけずらす（挿入か削除の位置より後ろの番号を振り直す）。 */
// <!-- req editingcore:b660b6f3.ff29 -->
function shiftBarRefs(items: readonly { barId: string }[], fromIndex: number, delta: number): void {
  for (const item of items) {
    const index = Number(item.barId);
    if (index >= fromIndex) item.barId = String(index + delta);
  }
}

/**
 * 小節 `barIndex` に効いている拍子（editing-core.md 3.2 節）。一覧（`explicitTimeSignatureBars`）にある小節ならその小節の値、
 * 無ければ直前へさかのぼって、一覧にある小節か 1 小節目（継ぐ先が無い）の値を返す。継いでいる小節の `MasterBar` に置いた写しは読まず、
 * 継ぐ向きの指定から求める。小節が無ければ null。
 */
function effectiveTimeSignature(
  score: model.Score,
  explicitBars: readonly number[],
  barIndex: number,
): { numerator: number; denominator: number } | null {
  if (barIndex >= score.masterBars.length) return null;
  const explicit = new Set(explicitBars);
  let source = barIndex;
  while (source > 0 && !explicit.has(source)) source -= 1;
  const masterBar = score.masterBars[source]!;
  return { numerator: masterBar.timeSignatureNumerator, denominator: masterBar.timeSignatureDenominator };
}

/**
 * 1 小節目を消す前に、2 小節目へ置くテンポ（editing-core.md 3.2 節・10 節）。2 小節目が継いでいて（`tempoAutomations` が空で）、
 * 1 小節目がテンポを持つときだけ、2 小節目に効いているテンポ（1 小節目の `tempoAutomations` の最後の値）を返す。
 * 2 小節目が自分のテンポを持つとき・1 小節目にテンポが無いとき・2 小節目が無いときは null（何も置かない）。
 */
function inheritedTempoOfSecondBar(score: model.Score): number | null {
  const second = score.masterBars[1];
  if (second === undefined || second.tempoAutomations.length > 0) return null;
  const automations = score.masterBars[0]!.tempoAutomations;
  return automations[automations.length - 1]?.value ?? null;
}

/**
 * 曲共通の小節の並びの逆参照と番号を張り直す（editing-core.md 2.4 節：小節を足すコマンドも逆参照を明示的に張る）。
 * alphaTab の `Score.finish` は `MasterBar.index`・`previousMasterBar`・`nextMasterBar`・`score` を作り直さない
 * （`Score.addMasterBar` だけが張る）ので、並びの途中へ足す・消すときはここで張る。
 */
function relinkMasterBars(score: model.Score): void {
  // <!-- req editingcore:1d5ebb81.b6e6 -->
  score.masterBars.forEach((masterBar, index) => {
    masterBar.score = score;
    masterBar.index = index; // <!-- req editingcore:1d5ebb81.d094 -->
    masterBar.previousMasterBar = index > 0 ? score.masterBars[index - 1]! : null; // <!-- req editingcore:1d5ebb81.fd88 -->
    masterBar.nextMasterBar = score.masterBars[index + 1] ?? null;
  });
}

/** パートの小節の並びの逆参照（`Bar.staff`）と番号を張り直す（`relinkMasterBars` と同じ理由）。パートごとの子が呼び、全部のパートで振り直す。 */
// <!-- req editingcore:b660b6f3.7c20 -->
function relinkStaffBars(staff: model.Staff): void {
  staff.bars.forEach((bar, index) => {
    bar.staff = staff; // <!-- req editingcore:1d5ebb81.d449 -->
    bar.index = index; // <!-- req editingcore:1d5ebb81.e373 -->
    bar.previousBar = index > 0 ? staff.bars[index - 1]! : null; // <!-- req editingcore:1d5ebb81.0a87 -->
    bar.nextBar = staff.bars[index + 1] ?? null;
  });
}

/**
 * 曲共通の小節（MasterBar）を `at` に足し、後ろの小節の番号と `explicitTimeSignatureBars`・セクションマーカー・小節メモの小節の番号をずらす
 * （editing-core.md 10 節の `InsertMasterBarCommand(target, at)`）。足した小節は一覧に入れず（拍子は直前を継ぐ）、テンポも継ぐ（空）。
 * 曲の頭に足した 1 小節目だけは、元の 1 小節目の拍子で始めて一覧に入れ、元の 1 小節目にテンポがあれば足す前の曲のテンポを置く（3.2 節）。
 * 直前の値を写して固定の値にしないので、後で挿入した位置より前の拍子やテンポを変えたときにも、新しい小節に自動で届く（10 節）。
 */
// <!-- req editingcore:b13f25dc.79b6 -->
// <!-- req editingcore:7293657e.bcf1 --> <!-- req editingcore:7293657e.e1c2 --> <!-- req editingcore:5626c2ad.1024 -->
// <!-- req editingcore:02f8bb62.1e4a --> <!-- req editingcore:3bf2612d.6217 --> <!-- req editingcore:3bf2612d.c5ff --> <!-- req editingcore:3bf2612d.bc5a -->
export class InsertMasterBarCommand implements Command {
  readonly kind = 'insert-master-bar';
  readonly label = 'insert-bar';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly memos: Memo[];
  private readonly markers: SectionMarker[];
  private readonly explicitBars: number[];
  private readonly at: number;
  private inserted: model.MasterBar | null = null;
  private explicitBefore: number[] = [];

  /** @param at 足す位置（この位置へ入り、以降が 1 つ後ろへ）。0 から小節の数まで。範囲の外は端に寄せる。 */
  constructor(target: EditTarget, at: number) {
    this.score = target.score;
    this.memos = target.appMeta.memos;
    this.markers = target.appMeta.sectionMarkers;
    this.explicitBars = target.appMeta.settings.explicitTimeSignatureBars;
    this.at = Math.min(Math.max(0, at), barCount(target.score));
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const at = this.at;
    this.explicitBefore = [...this.explicitBars];

    const masterBar = new model.MasterBar();
    // editing-core.md 10 節：新しい小節のテンポは「直前を継ぐ」で始める（3.2 節：継ぐは tempoAutomations を空にして表す）。
    // 曲の頭に足した 1 小節目だけは、下の at === 0 の所で曲のテンポを置く（元の 1 小節目にテンポが無い曲では空のまま）
    // <!-- req editingcore:66ed117c.2fa4 --> <!-- req editingcore:66ed117c.567d --> <!-- req editingcore:5741aa16.4f5b --> <!-- req editingcore:cbb6a748.db71 -->
    masterBar.tempoAutomations = [];
    const next = this.score.masterBars[at];
    // alphaTab の Score.tempo は 1 小節目の tempoAutomations の最初の値（無ければ 120）なので、足す前に読む
    const songTempo = this.score.tempo;
    this.score.masterBars.splice(at, 0, masterBar);
    relinkMasterBars(this.score);
    this.inserted = masterBar;

    // <!-- req editingcore:7293657e.ef17 -->
    shiftBarRefs(this.memos, at, +1);
    // <!-- req editingcore:7293657e.7b28 -->
    shiftBarRefs(this.markers, at, +1);
    // editing-core.md 3.2 節：一覧の小節の番号を足した数だけずらし、足した小節は一覧に入れない（拍子は「直前を継ぐ」で始める）
    // <!-- req editingcore:7293657e.d6f9 --> <!-- req editingcore:8cce21d7.9ac6 --> <!-- req editingcore:5741aa16.1280 --> <!-- req editingcore:5741aa16.7137 -->
    const shifted = this.explicitBars.map((index) => (index >= at ? index + 1 : index)); // <!-- req editingcore:60e2c5cb.aee3 --> // <!-- req editingcore:60e2c5cb.990f --> // <!-- req editingcore:60e2c5cb.343d -->
    // <!-- req editingcore:8cce21d7.4019 -->
    if (at === 0 && next !== undefined) {
      // editing-core.md 3.2 節：1 小節目は継ぐ先が無いので、いつも一覧に入れる。曲の頭に足したときは、元の 1 小節目の拍子で始める
      // <!-- req datamodelpersistence:806faf90.64eb --> <!-- req datamodelpersistence:806faf90.b2e8 --> <!-- req webcorefoundation:b751fe7e.4bdb --> <!-- req webcorefoundation:b751fe7e.13c1 --> <!-- req webcorefoundation:b751fe7e.3771 -->
      masterBar.timeSignatureNumerator = next.timeSignatureNumerator; // <!-- req editingcore:60e2c5cb.e186 --> // <!-- req editingcore:8cce21d7.c42a -->
      masterBar.timeSignatureDenominator = next.timeSignatureDenominator; // <!-- req editingcore:60e2c5cb.5307 -->
      shifted.unshift(0); // <!-- req editingcore:60e2c5cb.e186 -->
      // editing-core.md 10 節・3.2 節：テンポは曲のテンポのまま。元の 1 小節目にテンポがあれば、新しい 1 小節目に足す前の
      // 曲のテンポを置く（元の 1 小節目にテンポが無い曲では何も置かない）。取り消しは足した小節ごと外すので戻る
      if (next.tempoAutomations.length > 0) masterBar.tempoAutomations = tempoAutomationsFor(songTempo);
    }
    this.explicitBars.splice(0, this.explicitBars.length, ...shifted.sort((a, b) => a - b));
    // <!-- req editingcore:5741aa16.af4a --> <!-- req editingcore:5741aa16.67a2 -->
    resolveInheritedTimeSignatures(this.score, this.explicitBars);
    this.score.rebuildRepeatGroups(); // <!-- req editingcore:1d5ebb81.bf00 --> // <!-- req editingcore:1d5ebb81.8d01 -->
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.inserted === null) return NO_ADVANCE;
    removeItem(this.score.masterBars, this.inserted);
    relinkMasterBars(this.score);
    shiftBarRefs(this.memos, this.at + 1, -1);
    shiftBarRefs(this.markers, this.at + 1, -1);
    // editing-core.md 3.2 節：undo で一覧を変更の前に戻す
    this.explicitBars.splice(0, this.explicitBars.length, ...this.explicitBefore);
    // <!-- req editingcore:5741aa16.cb38 -->
    resolveInheritedTimeSignatures(this.score, this.explicitBars);
    this.score.rebuildRepeatGroups();
    this.inserted = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

/**
 * パート 1 つの `at` に小節を足し、4.4 節の全音符の休符の拍を置く（editing-core.md 10 節の `InsertPartBarCommand(target, trackIndex, at)`）。
 * 休符の拍から `Voice` への逆参照は `insertBeatAt` で張る（2.4 節）。
 */
// <!-- req editingcore:7293657e.2a9f -->
export class InsertPartBarCommand implements Command {
  readonly kind = 'insert-part-bar';
  readonly label = 'insert-bar';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly trackIndex: number;
  private readonly at: number;
  private inserted: model.Bar | null = null;

  constructor(target: EditTarget, trackIndex: number, at: number) {
    this.score = target.score;
    this.trackIndex = trackIndex;
    this.at = at;
    this.affectedTrackIndices = [trackIndex];
  }

  execute(): CommandOutcome {
    const staff = getStaff(this.score, this.trackIndex);
    const bar = new model.Bar();
    const voice = new model.Voice();
    bar.addVoice(voice);
    // editing-core.md 4.4 節の (b)：新しい小節のボイスに、全音符の長さの休符の拍を 1 つ置く
    // <!-- req editingcore:1d5ebb81.97c6 --> <!-- req editingcore:3e714fd8.c358 --> <!-- req editingcore:7293657e.dbe0 -->
    // <!-- req editingcore:8ec5d809.23ee --> <!-- req editingcore:09849a5d.f759 -->
    insertBeatAt(voice, 0, createRestBeat(model.Duration.Whole));
    staff.bars.splice(Math.min(this.at, staff.bars.length), 0, bar);
    relinkStaffBars(staff);
    this.inserted = bar;
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.inserted === null) return NO_ADVANCE;
    const staff = getStaff(this.score, this.trackIndex);
    removeItem(staff.bars, this.inserted);
    relinkStaffBars(staff);
    this.inserted = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

/**
 * 小節の挿入（editing-core.md 2.6 節の表・10 節）。カーソルのあるパートだけでなく、全部のパートに小節を足す `CompositeCommand`。
 * 全部のパートを 1 つのコマンドの中で変える形から、パートごとの子のコマンドを持つ形に直した（10 節、B33 の 2026-10-16 本人決定）。
 */
// <!-- req editingcore:cd299ae2.6636 -->
// <!-- req editingcore:549936ea.cff3 --> <!-- req editingcore:549936ea.0830 --> <!-- req editingcore:d4623d35.8b4a --> <!-- req editingcore:d4623d35.3577 -->
// <!-- req editingcore:44a2d000.fb2e --> <!-- req editingcore:b660b6f3.6923 --> <!-- req editingcore:22e5779d.9231 --> <!-- req editingcore:22e5779d.a394 -->
export class InsertBarCommand extends CompositeCommand {
  /** kind 'insert-bar'。子は 10 節の箇条の順（曲共通の小節を先に、パートを番号の順に）。 */
  // <!-- req editingcore:42288aa1.9ec9 --> <!-- req editingcore:42288aa1.bcff -->
  constructor(target: EditTarget, at: number) {
    const clamped = Math.min(Math.max(0, at), barCount(target.score));
    // <!-- req editingcore:7293657e.7314 -->
    super('insert-bar', 'insert-bar', [
      new InsertMasterBarCommand(target, clamped),
      // <!-- req editingcore:549936ea.962d --> <!-- req editingcore:549936ea.1599 -->
      // <!-- req editingcore:44a2d000.b456 --> <!-- req editingcore:44a2d000.882b -->
      // <!-- req editingcore:09849a5d.c637 -->
      ...allTrackIndices(target.score).map((trackIndex) => new InsertPartBarCommand(target, trackIndex, clamped)),
    ]);
  }
}

/**
 * 消す小節 `at` のセクションマーカーと小節メモを、`disposition` が `'delete'` なら消し、`'move-to-previous'` なら直前の小節へ移す
 * （editing-core.md 10 節の `MoveBarAnnotationsCommand(target, at, disposition)`）。`'none'` は何もしない。
 * 消すのが 1 小節目（直前が無い）ときの「移す」は、次の小節（消した後の 1 小節目）へ移す（10 節の (b)）。
 * マーカーは譜面に描く写し（`MasterBar.section`）も一緒に移す（3.10 節）。
 */
// <!-- req editingcore:5c155b1e.7774 -->
export class MoveBarAnnotationsCommand implements Command {
  readonly kind = 'move-bar-annotations';
  readonly label = 'delete-bar';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly memos: Memo[];
  private readonly markers: SectionMarker[];
  private readonly at: number;
  private readonly disposition: BarDeleteDisposition;
  private memoBefore: { list: Memo[]; barIds: string[] } | null = null;
  private markerBefore: { list: SectionMarker[]; barIds: string[] } | null = null;
  private sectionBefore: { masterBar: model.MasterBar; section: model.Section | null } | null = null;

  constructor(target: EditTarget, at: number, disposition: BarDeleteDisposition) {
    this.score = target.score;
    this.memos = target.appMeta.memos;
    this.markers = target.appMeta.sectionMarkers;
    this.at = at;
    this.disposition = disposition;
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    if (this.disposition === 'none') return NO_ADVANCE;
    this.memoBefore = { list: [...this.memos], barIds: this.memos.map((m) => m.barId) };
    this.markerBefore = { list: [...this.markers], barIds: this.markers.map((m) => m.barId) };

    const ref = String(this.at);
    // 直前が無い（消すのが 1 小節目）ときは、次の小節へ移す。消した後に詰めると、そこが 1 小節目になり、マーカーとメモを失わない（10 節の (b)）
    // <!-- req editingcore:afe1ec77.3131 --> <!-- req editingcore:afe1ec77.e706 --> <!-- req editingcore:afe1ec77.e3b2 --> <!-- req editingcore:afe1ec77.a434 -->
    const destination = this.at > 0 ? this.at - 1 : this.at + 1;
    // 移す先の小節が無い（曲に 1 小節しか無い）ときは、移せないので消す
    // <!-- req editingcore:5c155b1e.2c49 -->
    if (this.disposition === 'delete' || destination >= barCount(this.score)) {
      this.memos.splice(0, this.memos.length, ...this.memos.filter((m) => m.barId !== ref));
      this.markers.splice(0, this.markers.length, ...this.markers.filter((m) => m.barId !== ref));
      return NO_ADVANCE;
    }

    const moved = this.markers.filter((m) => m.barId === ref);
    for (const memo of this.memos) if (memo.barId === ref) memo.barId = String(destination);
    for (const marker of moved) marker.barId = String(destination);
    if (moved.length > 0) {
      const target = getMasterBar(this.score, destination);
      this.sectionBefore = { masterBar: target, section: target.section };
      target.section = getMasterBar(this.score, this.at).section;
    }
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.sectionBefore !== null) this.sectionBefore.masterBar.section = this.sectionBefore.section;
    if (this.memoBefore !== null) {
      const { list, barIds } = this.memoBefore;
      this.memos.splice(0, this.memos.length, ...list);
      list.forEach((memo, i) => (memo.barId = barIds[i]!));
    }
    if (this.markerBefore !== null) {
      const { list, barIds } = this.markerBefore;
      this.markers.splice(0, this.markers.length, ...list);
      list.forEach((marker, i) => (marker.barId = barIds[i]!));
    }
    this.memoBefore = null;
    this.markerBefore = null;
    this.sectionBefore = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

/**
 * パート 1 つの小節 `at` を消す（editing-core.md 10 節の `DeletePartBarCommand(target, trackIndex, at)`）。
 * 消した小節の中身（Bar）を持ち、取り消しで同じ位置へ戻す（2.3 節：消した小節の全部のパートの中身を持つ）。
 */
// <!-- req editingcore:5c155b1e.a1c3 --> <!-- req editingcore:5626c2ad.1024 -->
export class DeletePartBarCommand implements Command {
  readonly kind = 'delete-part-bar';
  readonly label = 'delete-bar';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly trackIndex: number;
  private readonly at: number;
  /** 予算の見積もり用に、消す小節の拍と音符の数を作るときに数えておく（execute の後は並びが変わるため）。 */
  private readonly heldItemCount: number;
  private removed: model.Bar | null = null;

  constructor(target: EditTarget, trackIndex: number, at: number) {
    this.score = target.score;
    this.trackIndex = trackIndex;
    this.at = at;
    this.affectedTrackIndices = [trackIndex];
    const bar = getStaff(target.score, trackIndex).bars[at];
    this.heldItemCount =
      bar === undefined
        ? 0
        : bar.voices.reduce((sum, voice) => sum + voice.beats.reduce((n, beat) => n + 1 + beat.notes.length, 0), 0);
  }

  execute(): CommandOutcome {
    const staff = getStaff(this.score, this.trackIndex);
    const [bar] = staff.bars.splice(this.at, 1);
    this.removed = bar ?? null;
    relinkStaffBars(staff);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    const staff = getStaff(this.score, this.trackIndex);
    if (this.removed !== null) {
      staff.bars.splice(this.at, 0, this.removed);
      relinkStaffBars(staff);
    }
    this.removed = null;
    return NO_ADVANCE;
  }

  /** 消した小節の音符の数に比例させる（2.3 節：消した小節の中身を持つので大きくなる）。 */
  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES + this.heldItemCount * HELD_ITEM_BYTES;
  }
}

/**
 * 曲共通の小節 `at` を消して後ろの番号を詰める（editing-core.md 10 節の `DeleteMasterBarCommand(target, at)`）。
 * `explicitTimeSignatureBars` から消した小節を外し、後ろの番号を消した数だけずらす（3.2 節）。マーカーとメモの番号も詰める。
 * 前後の小節の継ぐ向きの指定（一覧に無いこと・`tempoAutomations` が空であること）は変えない（null は値ではなく、継ぐという向きの指定、10 節）。
 * ただし 1 小節目を消したときの新しい 1 小節目は継ぐ先が無いので、消す前に効いていた拍子とテンポで始める（3.2 節）。
 */
// <!-- req editingcore:b13f25dc.1b15 -->
// <!-- req editingcore:5c155b1e.e0f2 --> <!-- req editingcore:3d97b6bb.d430 --> <!-- req editingcore:3d97b6bb.3d31 --> <!-- req editingcore:3d97b6bb.c8d1 -->
export class DeleteMasterBarCommand implements Command {
  readonly kind = 'delete-master-bar';
  readonly label = 'delete-bar';
  readonly affectedTrackIndices: readonly number[];

  private readonly score: model.Score;
  private readonly memos: Memo[];
  private readonly markers: SectionMarker[];
  private readonly explicitBars: number[];
  private readonly at: number;
  private removed: model.MasterBar | null = null;
  private explicitBefore: number[] = [];
  /** 1 小節目を消したときに拍子の値を書き換えた、新しい 1 小節目と、書き換える前の値。 */
  private firstBefore: { masterBar: model.MasterBar; numerator: number; denominator: number } | null = null;
  /** 1 小節目を消したときにテンポを置いた、新しい 1 小節目と、置く前の `tempoAutomations`。 */
  private firstTempoBefore: { masterBar: model.MasterBar; automations: model.Automation[] } | null = null;

  constructor(target: EditTarget, at: number) {
    this.score = target.score;
    this.memos = target.appMeta.memos;
    this.markers = target.appMeta.sectionMarkers;
    this.explicitBars = target.appMeta.settings.explicitTimeSignatureBars;
    this.at = at;
    this.affectedTrackIndices = allTrackIndices(target.score);
  }

  execute(): CommandOutcome {
    const at = this.at;
    this.explicitBefore = [...this.explicitBars];
    // 1 小節目を消すときは、次の小節（消した後の 1 小節目）に消す前に効いていた拍子を、消す前の一覧から求めておく
    const nextSignature = at === 0 ? effectiveTimeSignature(this.score, this.explicitBars, 1) : null;
    // テンポも同じく、次の小節が継いでいたなら、消す前にその小節に効いていたテンポ（元の 1 小節目の最後の値）を求めておく
    const nextTempo = at === 0 ? inheritedTempoOfSecondBar(this.score) : null;
    const [masterBar] = this.score.masterBars.splice(at, 1);
    this.removed = masterBar ?? null;
    relinkMasterBars(this.score);

    shiftBarRefs(this.memos, at + 1, -1);
    shiftBarRefs(this.markers, at + 1, -1);
    // editing-core.md 3.2 節：消した小節は一覧から外し、一覧の小節の番号を消した数だけずらす
    const shifted = this.explicitBars.filter((index) => index !== at).map((index) => (index > at ? index - 1 : index)); // <!-- req editingcore:60e2c5cb.7850 --> // <!-- req editingcore:60e2c5cb.27ca -->
    // editing-core.md 3.2 節：1 小節目はいつも一覧に入れる（曲の頭を消したときは、次の小節が今の拍子のまま 1 小節目になる）
    if (!shifted.includes(0) && this.score.masterBars.length > 0) shifted.unshift(0); // <!-- req editingcore:60e2c5cb.3e77 -->
    // 曲の頭を消したときの新しい 1 小節目は、消す前に効いていた拍子（継いでいた値か、はっきり入れた値）で始める（3.2 節、拍子の見た目は変わらない）
    // nextSignature があるのは消す前に 2 小節以上あったときだけなので、消した後にも 1 小節目がある
    if (nextSignature !== null) {
      // <!-- req editingcore:60e2c5cb.76c2 --> // <!-- req editingcore:60e2c5cb.96d3 --> // <!-- req editingcore:60e2c5cb.fea7 --> // <!-- req editingcore:60e2c5cb.be3c -->
      const first = this.score.masterBars[0]!;
      this.firstBefore = {
        masterBar: first,
        numerator: first.timeSignatureNumerator,
        denominator: first.timeSignatureDenominator,
      };
      first.timeSignatureNumerator = nextSignature.numerator;
      first.timeSignatureDenominator = nextSignature.denominator;
    }
    // 3.2 節・10 節：1 小節目を消した後の新しい 1 小節目は、消す前にその小節に効いていたテンポで始める。自分のテンポを
    // 持っていればそのまま、継いでいたなら元の 1 小節目の最後の値を置く（元の 1 小節目にテンポが無い曲では何も置かない）
    // nextTempo があるのは消す前に 2 小節以上あったときだけなので、消した後にも 1 小節目がある
    if (nextTempo !== null) {
      const first = this.score.masterBars[0]!;
      this.firstTempoBefore = { masterBar: first, automations: first.tempoAutomations };
      first.tempoAutomations = tempoAutomationsFor(nextTempo);
    }
    this.explicitBars.splice(0, this.explicitBars.length, ...shifted.sort((a, b) => a - b));
    // <!-- req editingcore:5741aa16.af4a --> <!-- req editingcore:5741aa16.120f -->
    resolveInheritedTimeSignatures(this.score, this.explicitBars);
    this.score.rebuildRepeatGroups(); // <!-- req editingcore:1d5ebb81.3d06 -->
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.removed === null) return NO_ADVANCE;
    this.score.masterBars.splice(this.at, 0, this.removed);
    relinkMasterBars(this.score);
    shiftBarRefs(this.memos, this.at, +1);
    shiftBarRefs(this.markers, this.at, +1);
    // editing-core.md 3.2 節：undo で一覧を変更の前に戻す
    this.explicitBars.splice(0, this.explicitBars.length, ...this.explicitBefore);
    // 1 小節目を消したときに書き換えた次の小節の拍子の値を、消す前の値に戻す。継いでいる小節の値は、この後の
    // resolveInheritedTimeSignatures で一覧から写し直す（editing-core.md 10 節の (b)：undo の最後にそろえる）
    if (this.firstBefore !== null) {
      this.firstBefore.masterBar.timeSignatureNumerator = this.firstBefore.numerator;
      this.firstBefore.masterBar.timeSignatureDenominator = this.firstBefore.denominator;
      this.firstBefore = null;
    }
    // 1 小節目を消したときに置いたテンポを外し、置く前の tempoAutomations（継ぐ状態）に戻す
    if (this.firstTempoBefore !== null) {
      this.firstTempoBefore.masterBar.tempoAutomations = this.firstTempoBefore.automations;
      this.firstTempoBefore = null;
    }
    // <!-- req editingcore:5741aa16.cb38 -->
    resolveInheritedTimeSignatures(this.score, this.explicitBars);
    this.score.rebuildRepeatGroups();
    this.removed = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

/**
 * 小節の削除（editing-core.md 2.6 節の表・10 節）。全部のパートから小節を消す `CompositeCommand`。
 * 全部のパートを 1 つのコマンドの中で変える形から、パートごとの子のコマンドを持つ形に直した（10 節、B33 の 2026-10-16 本人決定）。
 */
// <!-- req editingcore:da207603.ec0f --> <!-- req editingcore:da207603.2322 --> <!-- req editingcore:b62bcc8d.b0a0 --> <!-- req editingcore:b62bcc8d.d5f9 -->
// <!-- req editingcore:36372f75.4cdc --> <!-- req editingcore:b660b6f3.6923 --> <!-- req editingcore:22e5779d.c9b9 --> <!-- req editingcore:22e5779d.a394 -->
export class DeleteBarCommand extends CompositeCommand {
  /** kind 'delete-bar'。子は 10 節の箇条の順（マーカーとメモ → パートの番号の順に小節 → 曲共通の小節）。 */
  // <!-- req editingcore:2c1ea3fe.9ec9 --> <!-- req editingcore:2c1ea3fe.bcff --> <!-- req editingcore:2c1ea3fe.f4e8 -->
  constructor(target: EditTarget, at: number, disposition: BarDeleteDisposition) {
    // <!-- req editingcore:5c155b1e.f8a3 -->
    super('delete-bar', 'delete-bar', [
      new MoveBarAnnotationsCommand(target, at, disposition),
      // <!-- req editingcore:da2c9762.26cb --> <!-- req editingcore:da207603.a0f1 --> <!-- req editingcore:da207603.c112 -->
      // <!-- req editingcore:36372f75.fc63 -->
      ...allTrackIndices(target.score).map((trackIndex) => new DeletePartBarCommand(target, trackIndex, at)),
      new DeleteMasterBarCommand(target, at),
    ]);
  }
}
