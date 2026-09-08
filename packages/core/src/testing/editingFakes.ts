/**
 * タブ譜編集コアのテスト用フェイク（tests.rule.md「I/O・外部ライブラリは fake で差し替え」）。
 * 本番コードからは import しない（`src/index.ts` のバレルにも含めない）。
 */

import { createEmptyAppMetadata } from '../domain/SongDocument';
import { createInitialScore } from '../domain/newSong';
import type { AppMetadata } from '../domain/types';
import type { Command, CommandOutcome, EditTarget, NotificationReporter, RenderRequester } from '../editing';
import { model } from '@coderline/alphatab';

/** `ScoreRenderHost.render` の呼び出しを記録する fake。 */
export class RecordingRenderRequester implements RenderRequester {
  readonly calls: (number[] | undefined)[] = [];
  render(trackIndices?: number[]): void {
    this.calls.push(trackIndices ? [...trackIndices] : undefined);
  }
}

/** `NotificationCenter.report` の呼び出しを記録する fake。 */
export class RecordingReporter implements NotificationReporter {
  readonly reports: { code: string; context?: Record<string, unknown> }[] = [];
  report(code: string, context?: Record<string, unknown>): void {
    this.reports.push(context ? { code, context } : { code });
  }
}

export interface FakeCommandOptions {
  kind?: string;
  label?: string;
  affectedTrackIndices?: number[];
  sizeBytes?: number;
  cursorAdvanceOnExecute?: CommandOutcome['cursorAdvance'];
  /** canMergeWith が true を返す相手の kind。指定時のみ merge 可能になる。 */
  mergeableWithKind?: string;
}

/** 実行回数・取り消し回数を数えるだけの最小コマンド。 */
export class FakeCommand implements Command {
  readonly kind: string;
  readonly label: string;
  readonly affectedTrackIndices: readonly number[];
  executeCount = 0;
  undoCount = 0;
  mergedFrom: Command[] = [];
  private readonly sizeBytes: number;
  private readonly advance: CommandOutcome['cursorAdvance'];
  private readonly mergeableWithKind: string | undefined;

  constructor(options: FakeCommandOptions = {}) {
    this.kind = options.kind ?? 'fake';
    this.label = options.label ?? 'Fake';
    this.affectedTrackIndices = options.affectedTrackIndices ?? [0];
    this.sizeBytes = options.sizeBytes ?? 512;
    this.advance = options.cursorAdvanceOnExecute ?? 'none';
    this.mergeableWithKind = options.mergeableWithKind;
  }

  execute(): CommandOutcome {
    this.executeCount += 1;
    return { cursorAdvance: this.advance };
  }

  undo(): CommandOutcome {
    this.undoCount += 1;
    return { cursorAdvance: 'none' };
  }

  estimateSizeBytes(): number {
    return this.sizeBytes;
  }

  canMergeWith(other: Command): boolean {
    return this.mergeableWithKind !== undefined && other.kind === this.mergeableWithKind;
  }

  mergeWith(other: Command): void {
    this.mergedFrom.push(other);
  }
}

/** Score の決定的 JSON 文字列（execute/undo 対称性の C2 検証に使う）。 */
export function scoreJson(target: EditTarget): string {
  return model.JsonConverter.scoreToJson(target.score);
}

/** AppMetadata の決定的 JSON（メモ・マーカーのコマンド対称性の検証に使う）。 */
export function appMetaJson(target: EditTarget): string {
  return JSON.stringify(target.appMeta);
}

/** テスト用の EditTarget（既定：標準チューニング 6 弦ギター 1 パート、空 1 小節）。 */
export function buildEditTarget(partCount = 1): EditTarget {
  const parts = Array.from({ length: partCount }, (_v, i) => ({
    name: `Guitar ${i + 1}`,
    instrumentType: 'electric_guitar' as const,
    tuning: [64, 59, 55, 50, 45, 40],
  }));
  const score = createInitialScore({ title: 'Test', parts });
  const appMeta: AppMetadata = createEmptyAppMetadata();
  return { score, appMeta };
}

export { model };
