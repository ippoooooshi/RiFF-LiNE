/**
 * タブ譜編集コアの結合テスト用フィクスチャ（editing-core.md §11）。
 *
 * 設計 §11 は「全奏法記号網羅フィクスチャ」「2048小節フィクスチャ」を `tools/` パッケージへ、としているが、
 * `tools/` はまだワークスペース未整備のため、当面は本テスト支援モジュールに置く。スタンドアロンの
 * サンプルデータ生成器（負荷テスト用）は Phase 1 後半に `tools/` を整備した時点で切り出す（申し送り）。
 * 本番コードからは import しない。
 */

import { createEmptyAppMetadata } from '../domain/SongDocument';
import { createInitialScore } from '../domain/newSong';
import { CommandHistory } from '../editing';
import { EditingService } from '../editing';
import { CursorController } from '../editing';
import { ValidationService } from '../editing';
import type { EditTarget } from '../editing';
import { model } from '@coderline/alphatab';

import { RecordingRenderRequester, RecordingReporter } from './editingFakes';

/** 空 1 小節・N パートの EditTarget。 */
export function makeSong(partCount = 1): EditTarget {
  const parts = Array.from({ length: partCount }, (_v, i) => ({
    name: `Guitar ${i + 1}`,
    instrumentType: 'electric_guitar' as const,
    tuning: [64, 59, 55, 50, 45, 40],
  }));
  return { score: createInitialScore({ title: 'Fixture', parts }), appMeta: createEmptyAppMetadata() };
}

/** 指定小節数の MasterBar を持つ EditTarget（`validateBarInsertion` の上限境界テスト用）。 */
export function makeSongWithBars(barCount: number, partCount = 1): EditTarget {
  const target = makeSong(partCount);
  while (target.score.masterBars.length < barCount) target.score.addMasterBar(new model.MasterBar());
  return target;
}

/** `EditingService` 一式（履歴・カーソル・検証・レコーディング fake）を束ねたテストリグ。 */
export interface EditingRig {
  target: EditTarget;
  cursor: CursorController;
  history: CommandHistory;
  render: RecordingRenderRequester;
  reporter: RecordingReporter;
  service: EditingService;
}

export function makeEditingRig(target: EditTarget = makeSong()): EditingRig {
  const cursor = new CursorController();
  const render = new RecordingRenderRequester();
  const reporter = new RecordingReporter();
  const history = new CommandHistory(render, reporter);
  const service = new EditingService(target, cursor, new ValidationService(), history, reporter);
  return { target, cursor, history, render, reporter, service };
}
