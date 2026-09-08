/**
 * 小節メモの追加・編集・削除（editing-core.md §6.4、02_data_model.md §3.6、要件4.1「小節メモ／注釈」）。
 *
 * メモは `AppMetadata.memos`（Score 非従属データ）に保持する。譜面自体の再描画は不要なため
 * `affectedTrackIndices` は空配列（小節メモ一覧パネルの更新のみで足りる、§6.4）。
 * 文字数上限（`EDIT-004` / C13：先頭100字へ切り詰め）は `ValidationService` が済ませている前提。
 */

import type { AppMetadata, Memo } from '../../domain/types';
import { BASE_COMMAND_BYTES } from '../commandBase';
import type { Command, CommandOutcome, EditTarget } from '../types';

/** バー位置 → メモが参照する安定 ID（小節インデックスの文字列表現）。 */
export function barRef(barIndex: number): string {
  return String(barIndex);
}

const NO_ADVANCE: CommandOutcome = { cursorAdvance: 'none' };

export class AddMemoCommand implements Command {
  readonly kind = 'add-memo';
  readonly label = 'メモを追加';
  readonly affectedTrackIndices: readonly number[] = [];
  private readonly memos: Memo[];
  private readonly created: Memo;

  constructor(target: EditTarget, barIndex: number, text: string, now: () => Date = () => new Date()) {
    this.memos = target.appMeta.memos;
    this.created = { id: crypto.randomUUID(), barId: barRef(barIndex), text, createdAt: now().toISOString() };
  }

  execute(): CommandOutcome {
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

export class EditMemoCommand implements Command {
  readonly kind = 'edit-memo';
  readonly label = 'メモを編集';
  readonly affectedTrackIndices: readonly number[] = [];
  private readonly memos: Memo[];
  private readonly memoId: string;
  private readonly nextText: string;
  private previousText: string | null = null;

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

export class DeleteMemoCommand implements Command {
  readonly kind = 'delete-memo';
  readonly label = 'メモを削除';
  readonly affectedTrackIndices: readonly number[] = [];
  private readonly memos: Memo[];
  private readonly memoId: string;
  private removed: { memo: Memo; index: number } | null = null;

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
