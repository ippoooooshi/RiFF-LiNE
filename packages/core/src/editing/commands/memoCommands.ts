/**
 * 小節メモを足す・変える・消す（editing-core.md 2.6 節の表・3.10 節、基本設計 02 章 3.6 節、要件 4.1「小節メモ／注釈」）。
 *
 * メモは `appMeta.memos`（サイドカー）に持つ。コマンドが変えてよい項目に `AppMetadata.memos` を含める（2.4 節）。
 * 譜面に描かず、小節メモ一覧パネルを直すだけなので、`affectedTrackIndices` は無し（`[]`、2.6 節の表・10 節）。
 * 文字数（`EDIT-004`、先頭の 100 文字への切り詰め）は、`EditingService` がコマンドを作る前に済ませる（3.10 節）。
 */

import type { AppMetadata, Memo } from '../../domain/types';
import { BASE_COMMAND_BYTES } from '../commandBase';
import type { CommandOutcome, EditTarget } from '../types';
import type { Command } from './Command';

/** バー位置 → メモが参照する安定 ID（小節インデックスの文字列表現）。 */
export function barRef(barIndex: number): string {
  return String(barIndex);
}

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

// <!-- req editingcore:d3bc5b45.6f3f --> <!-- req editingcore:0debbb93.dfc4 --> <!-- req editingcore:0debbb93.ff35 -->
export class AddMemoCommand implements Command {
  readonly kind = 'add-memo';
  readonly label = 'add-memo';
  // <!-- req editingcore:d3bc5b45.4faf -->
  readonly affectedTrackIndices: readonly number[] = [];
  private readonly memos: Memo[];
  private readonly created: Memo;

  // <!-- req editingcore:63f1d788.9ec9 --> <!-- req editingcore:63f1d788.50f7 --> <!-- req editingcore:63f1d788.3b18 --> <!-- req editingcore:63f1d788.8f61 -->
  constructor(target: EditTarget, barIndex: number, text: string, now: () => Date = () => new Date()) {
    this.memos = target.appMeta.memos;
    this.created = { id: crypto.randomUUID(), barId: barRef(barIndex), text, createdAt: now().toISOString() };
  }

  execute(): CommandOutcome {
    // <!-- req editingcore:54e0b2f1.592d -->
    this.memos.push(this.created);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    const index = this.memos.indexOf(this.created);
    if (index >= 0) this.memos.splice(index, 1);
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

// <!-- req editingcore:d3bc5b45.993a --> <!-- req editingcore:3a0fbf42.b6d7 --> <!-- req editingcore:3a0fbf42.b1ba -->
export class EditMemoCommand implements Command {
  readonly kind = 'edit-memo';
  readonly label = 'edit-memo';
  readonly affectedTrackIndices: readonly number[] = [];
  private readonly memos: Memo[];
  private readonly memoId: string;
  private readonly nextText: string;
  private previousText: string | null = null;

  // <!-- req editingcore:cb10f340.9ec9 --> <!-- req editingcore:cb10f340.f801 --> <!-- req editingcore:cb10f340.4b19 -->
  constructor(target: EditTarget, memoId: string, nextText: string) {
    this.memos = target.appMeta.memos;
    this.memoId = memoId;
    this.nextText = nextText;
  }

  execute(): CommandOutcome {
    const memo = this.find();
    if (memo === undefined) return NO_ADVANCE;
    this.previousText = memo.text;
    memo.text = this.nextText;
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    const memo = this.find();
    if (memo !== undefined && this.previousText !== null) memo.text = this.previousText;
    this.previousText = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }

  private find(): Memo | undefined {
    return this.memos.find((m) => m.id === this.memoId);
  }
}

// <!-- req editingcore:d3bc5b45.6a7f --> <!-- req editingcore:ac57fdb7.ac8c -->
export class DeleteMemoCommand implements Command {
  readonly kind = 'delete-memo';
  readonly label = 'delete-memo';
  readonly affectedTrackIndices: readonly number[] = [];
  private readonly memos: Memo[];
  private readonly memoId: string;
  private removed: { memo: Memo; index: number } | null = null;

  // <!-- req editingcore:559e14ea.e8d8 -->
  constructor(target: EditTarget, memoId: string) {
    this.memos = target.appMeta.memos;
    this.memoId = memoId;
  }

  execute(): CommandOutcome {
    const index = this.memos.findIndex((m) => m.id === this.memoId);
    if (index < 0) return NO_ADVANCE;
    this.removed = { memo: this.memos[index]!, index };
    this.memos.splice(index, 1);
    return NO_ADVANCE;
  }

  undo(): CommandOutcome {
    if (this.removed !== null) this.memos.splice(this.removed.index, 0, this.removed.memo);
    this.removed = null;
    return NO_ADVANCE;
  }

  estimateSizeBytes(): number {
    return BASE_COMMAND_BYTES;
  }
}

/** テスト・他パッケージ向け：barIndex に紐づくメモを取得する（AppMetadata から）。 */
export function memosForBar(appMeta: AppMetadata, barIndex: number): Memo[] {
  const ref = barRef(barIndex);
  return appMeta.memos.filter((m) => m.barId === ref);
}
// 13.2 節：音声メモは作らない。足すときは小節メモに音声のファイルを指す項目を 1 つ足し、録音はアダプタを 1 つ足して受け、メモの並びと小節の参照は変えない <!-- req webcorefoundation:285aac21.e5d6 --> <!-- req webcorefoundation:285aac21.78e0 --> <!-- req webcorefoundation:285aac21.4d51 --> <!-- req webcorefoundation:285aac21.12a8 --> <!-- req webcorefoundation:285aac21.ddf8 -->
