/**
 * タブ譜編集コアの結合テスト用フィクスチャ（editing-core.md §11）。
 *
 * 開発用サンプルデータは packages/core/src/testing に置き、そのための `tools/` はリポジトリに設けない
 * （web-core-foundation.md 5.1 節、2026-09-27 本人決定）。全奏法記号・大曲のフィクスチャは 14.9 節を受け持つ区切りで足す。
 * 本番コードからは import しない。
 */
// <!-- req webcorefoundation:03b99b93.c802 -->

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
// 10.2 節と 10.6 節：09 章のメモリの目標値（アイドル 150MB・通常の編集 400MB・大曲 600MB）はウィンドウ 1 つあたりで、アイドルは曲を開いていない曲一覧ウィンドウ 1 枚。印刷と PDF の見えないウィンドウは別に数え、目標値は Phase 0 から 1 の実測の後に決める。大曲のメモリは Phase 0 から 1 で実測し、600MB を超えたら何が押し上げるかを測ってから対策（開いていない小節の Beat と Note を使うときに読み込む、が候補）を決める。Phase 1 の後半に 2048 小節・全部の奏法記号の 4 パートと 8 パートのデータをここに足し、4 パートで目標値を満たすこと・8 パートで落ちずに動くこと（測った値を記録し、超えても不合格にしない）と A6・A8・A9 を 14.8 節の手順で確かめる。2 つ目の AlphaSynth のメモリの増えは Phase 0 で SoundFont を選ぶときに測り、ゆとりの幅は 1 つ目の常駐の大きさが分かってから本人が決め、収まらなければ PreviewSynth を song-boundary にする <!-- req webcorefoundation:bbcbd559.be1f --> <!-- req webcorefoundation:c9eddff2.5d13 --> <!-- req webcorefoundation:c9eddff2.51c1 --> <!-- req webcorefoundation:c9eddff2.23d5 --> <!-- req webcorefoundation:c9eddff2.f048 --> <!-- req webcorefoundation:c9eddff2.ad3d --> <!-- req webcorefoundation:85f469e9.418e --> <!-- req webcorefoundation:907456e9.9dd8 --> <!-- req webcorefoundation:907456e9.b470 --> <!-- req webcorefoundation:907456e9.a49f --> <!-- req webcorefoundation:907456e9.f4e0 --> <!-- req webcorefoundation:4be90122.b3e9 --> <!-- req webcorefoundation:4be90122.2881 --> <!-- req webcorefoundation:4be90122.6539 --> <!-- req webcorefoundation:4be90122.93b6 --> <!-- req webcorefoundation:4be90122.ffa9 --> <!-- req webcorefoundation:e39e66e0.9cf0 --> <!-- req webcorefoundation:e39e66e0.6eef --> <!-- req webcorefoundation:e39e66e0.24e6 --> <!-- req webcorefoundation:e39e66e0.73e3 --> <!-- req webcorefoundation:e39e66e0.8de1 --> <!-- req webcorefoundation:e39e66e0.255b --> <!-- req webcorefoundation:e39e66e0.9d7b --> <!-- req webcorefoundation:e39e66e0.2e53 --> <!-- req webcorefoundation:01f21fa4.554b --> <!-- req webcorefoundation:01f21fa4.8c21 --> <!-- req webcorefoundation:01f21fa4.2e7e --> <!-- req webcorefoundation:2242f3d3.9178 --> <!-- req webcorefoundation:2242f3d3.e979 --> <!-- req webcorefoundation:2242f3d3.b1f0 --> <!-- req webcorefoundation:2242f3d3.9d4a --> <!-- req webcorefoundation:2242f3d3.c88d --> <!-- req webcorefoundation:2242f3d3.8db5 -->
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
