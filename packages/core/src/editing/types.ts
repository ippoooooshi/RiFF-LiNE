/**
 * タブ譜編集コアの共通型（editing-core.md §4〜§7）。
 *
 * 実行時ドメインモデルは alphaTab の `model.Score` グラフそのもの（AD-1、domain/SongDocument.ts）。
 * コマンドはそのグラフ＋`AppMetadata`（メモ・セクションマーカー）を直接変更し、`CommandHistory` が
 * 変更後に `ScoreRenderHost.render(affectedTrackIndices)` を一元的に呼ぶ（§3）。
 */

import type { AppMetadata } from '../domain/types';
import type { model } from '@coderline/alphatab';

/**
 * コマンドが変更を加える対象。`SongDocument` のうちコマンドが触る部分だけを要求する
 * （テストで最小の Score を渡せるようにするための縫い目）。
 */
export interface EditTarget {
  score: model.Score;
  appMeta: AppMetadata;
}

/** カーソル位置（editing-core.md §4）。Voice は MVP では常に 1 つのため Bar 内 Beat インデックスで足りる。 */
export interface CursorPosition {
  /** 対象パート（`score.tracks` のインデックス）。 */
  trackIndex: number;
  /** 対象小節（`staff.bars` のインデックス、全パートで同一の並び）。 */
  barIndex: number;
  /** 小節内の Beat インデックス（voice.beats のインデックス）。 */
  beatIndex: number;
}

/** 範囲選択（同一パート内、editing-core.md §4・§9）。start/end は含む端点。 */
export interface SelectionRange {
  trackIndex: number;
  startBarIndex: number;
  startBeatIndex: number;
  endBarIndex: number;
  endBeatIndex: number;
}

/**
 * `Command.execute()` / `undo()` の戻り値。`EditingService` がこれを見て `CursorController` を更新する
 * （カーソル移動自体はコマンド化しない、§4）。
 */
export interface CommandOutcome {
  /**
   * 実行後にカーソルを進めるべきか。`PlaceNoteCommand` / `InsertRestCommand` の execute は
   * `'beat'`（現在音価分だけ次 Beat へ）、それ以外は `'none'`。undo は原則 `'none'`。
   */
  cursorAdvance: 'beat' | 'none';
}

/**
 * Undo/Redo 単位（editing-core.md §6.1）。B13 により基本設計では責務表のみだったものを実装形に確定する。
 */
export interface Command {
  /** 履歴上の安定識別子（例：`'place-note'`）。ロジック分岐・テレメトリ用。 */
  readonly kind: string;
  /** Undo/Redo 履歴でユーザーに見せるラベル（例：「音符を配置」）。 */
  readonly label: string;
  /** この変更が影響するパート（`score.tracks`）のインデックス一覧。§3 の再描画で使う。 */
  readonly affectedTrackIndices: readonly number[];

  /** Score / AppMetadata へ変更を適用する。冪等ではない（`CommandHistory` が二重実行しない前提）。 */
  execute(): CommandOutcome;
  /** `execute` の変更を打ち消し、直前の状態へ戻す（execute/undo の対称性を保証する）。 */
  undo(): CommandOutcome;

  /**
   * 直前の履歴エントリ `other` と 1 エントリへまとめられるか（連続ドラッグ等の履歴肥大化を防ぐ、任意）。
   * 実装しないコマンドは常に結合不可として扱われる。
   */
  canMergeWith?(other: Command): boolean;
  /** `canMergeWith` が true のとき、`other` を自身へ取り込む（`other` が古い方、`this` が新しい方）。 */
  mergeWith?(other: Command): void;

  /**
   * Undo/Redo スタック上での推定保持サイズ（バイト）。`CommandHistory` の 80MB 予算判定に使う
   * （editing-core.md §6.2、C11）。通常の差分コマンドは数百バイト。`RemovePartCommand` 等の
   * スナップショット保持コマンドはその実サイズを見積もる。
   */
  estimateSizeBytes(): number;
}

/** 検証結果（editing-core.md §7）。NG のときはエラーコードと文脈を持つ。 */
export type ValidationOutcome = { ok: true } | { ok: false; code: string; context: Record<string, unknown> };

/** `CommandHistory.onCommandApplied` が購読者へ渡すイベント（editing-core.md §6.2）。 */
export interface CommandAppliedEvent {
  /** 適用の種類（`redo` は内部的には再 execute だが、購読者が区別できるよう別値にする）。 */
  phase: 'execute' | 'undo' | 'redo';
  kind: string;
  affectedTrackIndices: readonly number[];
}
