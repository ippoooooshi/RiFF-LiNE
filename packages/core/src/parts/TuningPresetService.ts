/**
 * チューニングプリセットの管理と適用（part-tuning-management.md §3.2・§3.5・§4.2）。
 *
 * ユーザー定義プリセットは Song 非依存のグローバルストア（`tuning-presets.json`）に保持する。
 * 作成・削除は `CommandHistory` を経由しない単純なサービス操作（§3.5）。削除は論理削除＋期限付きパージ（B27）。
 * プリセットの**適用**だけは特定曲の `CommandHistory` へ `ApplyTuningPresetCommand` を発行する。
 */

import { STANDARD_BASS_TUNING, STANDARD_GUITAR_TUNING } from '../domain/newSong';
import type { TuningPreset } from '../domain/types';
import type { CommandHistory, EditTarget } from '../editing';

import { ApplyTuningPresetCommand, type TuningReporter } from './commands/tuningCommands';
import { getTuning } from './partModel';
import type { TuningPresetStore } from './TuningPresetStore';

/** 論理削除の保持日数（曲のゴミ箱30日より短い。試行錯誤で頻繁に作成・削除されうるため、B27）。 */
export const PRESET_TRASH_RETENTION_DAYS = 7;
/** 論理削除プリセットの件数上限（超過分は古いものから物理パージ、B27）。 */
export const PRESET_TRASH_MAX_ENTRIES = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** アプリ同梱の標準プリセット（part-tuning-management.md §4.2）。ファイルには保存しない。 */
export const BUILTIN_TUNING_PRESETS: readonly TuningPreset[] = [
  {
    id: 'builtin-guitar-standard',
    name: 'ギター標準（EADGBE）',
    builtin: true,
    stringPitches: [...STANDARD_GUITAR_TUNING],
  },
  { id: 'builtin-guitar-drop-d', name: 'ドロップD', builtin: true, stringPitches: [64, 59, 55, 50, 45, 38] },
  { id: 'builtin-guitar-dadgad', name: 'DADGAD', builtin: true, stringPitches: [62, 57, 55, 50, 45, 38] },
  { id: 'builtin-guitar-half-down', name: '半音下げ', builtin: true, stringPitches: [63, 58, 54, 49, 44, 39] },
  { id: 'builtin-bass-standard', name: 'ベース標準（EADG）', builtin: true, stringPitches: [...STANDARD_BASS_TUNING] },
  { id: 'builtin-bass-drop-d', name: 'ベース ドロップD', builtin: true, stringPitches: [43, 38, 33, 26] },
];

export class TuningPresetService {
  constructor(
    private readonly store: TuningPresetStore,
    private readonly reporter: TuningReporter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 表示用の全プリセット（組み込み＋ユーザー定義、論理削除分は除外）。 */
  async list(): Promise<TuningPreset[]> {
    const user = await this.store.load();
    return [...BUILTIN_TUNING_PRESETS, ...user.filter((preset) => preset.isDeleted !== true)];
  }

  /** 論理削除分も含む全ユーザープリセット（「元に戻す」導線・診断用）。 */
  async listIncludingDeleted(): Promise<TuningPreset[]> {
    return this.store.load();
  }

  /** ユーザー定義プリセットを新規作成する。 */
  async create(name: string, stringPitches: number[]): Promise<TuningPreset> {
    const preset: TuningPreset = {
      id: `user-${crypto.randomUUID()}`,
      name,
      builtin: false,
      stringPitches: [...stringPitches],
    };
    const user = await this.store.load();
    await this.store.save([...user, preset]);
    return preset;
  }

  /** ユーザー定義プリセットを論理削除する（`isDeleted`＋`deletedAt`）。組み込みは削除不可。 */
  async delete(presetId: string): Promise<void> {
    const user = await this.store.load();
    const next = user.map((preset) =>
      preset.id === presetId && !preset.builtin
        ? { ...preset, isDeleted: true, deletedAt: this.now().toISOString() }
        : preset,
    );
    await this.store.save(next);
    await this.purgeExpired();
  }

  /** 論理削除を取り消す（削除直後の「元に戻す」導線）。 */
  async restore(presetId: string): Promise<void> {
    const user = await this.store.load();
    const next = user.map((preset) => {
      if (preset.id !== presetId || preset.isDeleted !== true) return preset;
      const { isDeleted: _isDeleted, deletedAt: _deletedAt, ...rest } = preset;
      return rest;
    });
    await this.store.save(next);
  }

  /**
   * 論理削除プリセットを、7 日経過または件数 20 超過（削除日時の古い順）で物理パージする（B27）。
   * アプリ起動時に `TrashService.purgeExpired()` と合わせて呼ぶ。
   * @returns パージした件数。
   */
  async purgeExpired(): Promise<number> {
    const user = await this.store.load();
    const nowMs = this.now().getTime();

    const deleted = user
      .filter((preset) => preset.isDeleted === true)
      .sort((a, b) => (a.deletedAt ?? '').localeCompare(b.deletedAt ?? '')); // 古い順

    const purge = new Set<string>();
    for (const preset of deleted) {
      const ageMs = nowMs - new Date(preset.deletedAt ?? 0).getTime();
      if (ageMs >= PRESET_TRASH_RETENTION_DAYS * DAY_MS) purge.add(preset.id);
    }
    const overflow = deleted.length - PRESET_TRASH_MAX_ENTRIES;
    for (let i = 0; i < overflow; i++) purge.add(deleted[i]!.id);

    if (purge.size === 0) return 0;
    await this.store.save(user.filter((preset) => !purge.has(preset.id)));
    return purge.size;
  }

  /**
   * 指定パートへプリセットを適用する（弦数同期・Note 破棄・`EDIT-006` は `ApplyTuningPresetCommand`）。
   * @param preset `list()` で得たプリセット、またはその id。
   */
  applyPreset(target: EditTarget, history: CommandHistory, trackIndex: number, preset: TuningPreset): void {
    history.execute(
      new ApplyTuningPresetCommand(
        target.score,
        trackIndex,
        { name: preset.name, stringPitches: [...preset.stringPitches] },
        this.reporter,
      ),
    );
  }

  /**
   * 指定パートの現在のチューニングをその場でスナップショットとして返す
   * （新規曲作成ウィザードの「既存パートのチューニングをコピー」用。プリセットとしては保存しない）。
   */
  snapshotTuningFrom(target: EditTarget, trackIndex: number): { stringPitches: number[] } {
    return { stringPitches: getTuning(target.score, trackIndex) };
  }
}
