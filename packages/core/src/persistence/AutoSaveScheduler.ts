/**
 * 編集による変更通知（dirty）を受けてデバウンス保存をスケジュールする（data-model-persistence.md §3.2・§4.3・§9.1）。
 *
 * - デバウンス 3 秒。連続編集で繰り返しリセットされても、最初の dirty から 10 秒で強制フラッシュ。
 * - 保存失敗時は 1s / 3s / 9s の間隔で最大 3 回リトライ。全滅で Error 相当（FILE-001）を暫定通知。
 * - 保存成功後に onSaved フックを呼ぶ（bootstrap が MirrorSyncService.syncAfterSave を接続する、§4.3）。
 * - `flush()` はウィンドウクローズ時等に「確実に最新内容を書き切る」用途。進行中の保存があればそれを待ち、
 *   待っている間に来た dirty（rerun）も含めて settle するまで解決しない（データ消失窓を残さない）。
 */

import type { SongDocument } from '../domain/SongDocument';

import { notificationCenter } from '../errors';

import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_DELAY_MS, AUTOSAVE_RETRY_DELAYS_MS } from './constants';
import type { SongRepository } from './SongRepository';

/** songId ごとの進行状態。 */
interface Entry {
  /** 最初に dirty になった時刻（ms）。max-delay 判定の基準。 */
  firstDirtyAt: number;
  /** デバウンスタイマー。 */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** 保存ループが実行中か。 */
  saving: boolean;
  /** 実行中にさらに dirty 通知が来たか（ループ内でもう 1 周する）。 */
  rerunRequested: boolean;
  /** 実行中の保存ループの Promise（rerun 分も含めて settle する）。flush がこれを待つ。 */
  inFlight: Promise<void> | undefined;
}

export interface AutoSaveHooks {
  /** 保存成功時。songId を渡す（ミラー同期の起動に使う）。 */
  onSaved?: (songId: string) => void;
  /** リトライ全滅時（FILE-001 相当）。 */
  onError?: (songId: string, error: unknown) => void;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class AutoSaveScheduler {
  private readonly entries = new Map<string, Entry>();

  /**
   * @param repo 保存先。
   * @param resolveDocument songId から現在の（メモリ上の）SongDocument を解決する。undefined なら保存をスキップ。
   * @param hooks 保存成功・失敗のフック。
   */
  constructor(
    private readonly repo: SongRepository,
    private readonly resolveDocument: (songId: string) => SongDocument | undefined,
    private readonly hooks: AutoSaveHooks = {},
  ) {}

  /** 変更を通知する。デバウンス保存をスケジュールする（最初の dirty から最大 10 秒で必ず走る）。 */
  notifyDirty(songId: string): void {
    const now = Date.now();
    let entry = this.entries.get(songId);
    if (!entry) {
      entry = { firstDirtyAt: now, timer: undefined, saving: false, rerunRequested: false, inFlight: undefined };
      this.entries.set(songId, entry);
    }

    if (entry.saving) {
      // 実行中：保存ループが完了前にもう 1 周する。
      entry.rerunRequested = true;
      return;
    }

    if (entry.timer) clearTimeout(entry.timer);
    const elapsed = now - entry.firstDirtyAt;
    const wait = Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_DELAY_MS - elapsed));
    entry.timer = setTimeout(() => void this.startSave(songId, false), wait);
  }

  /**
   * 即時保存する（ウィンドウクローズ時等）。デバウンスを待たない。
   *
   * 保証：`await flush(songId)` 完了時点で、ディスク上のファイルは flush 呼び出し時点以降の
   * `resolveDocument(songId)` を反映している（または resolveDocument が undefined）。
   * 進行中の保存ループがあれば「もう 1 周」を要求して完了を待ち、レースで取りこぼした場合のみ
   * 追加でもう 1 回保存する。リトライは通常どおり行う。
   */
  async flush(songId: string): Promise<void> {
    const entry = this.entries.get(songId);
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    // 進行中ループがあれば、この時点の状態を必ず拾うよう rerun を立ててから完了待ち。
    // 無ければ新規に 1 回保存する。
    if (entry?.saving) entry.rerunRequested = true;
    await (entry?.inFlight ?? this.startSave(songId, true));

    // ループの while 判定と上の rerun 立ての間のレースで取りこぼしていたら 1 回だけ追う。
    const after = this.entries.get(songId);
    if (after && !after.saving && after.rerunRequested) {
      after.rerunRequested = false;
      await this.startSave(songId, true);
    }
  }

  /** songId のスケジュールを破棄する（保存はしない）。進行中の保存ループは中断しない。 */
  dispose(songId: string): void {
    const entry = this.entries.get(songId);
    if (entry?.timer) clearTimeout(entry.timer);
    if (!entry?.saving) this.entries.delete(songId);
  }

  /**
   * 保存ループを開始する。既に実行中なら rerun を要求して既存の Promise を返す
   * （呼び出し元＝flush がそれを await できる）。
   * @param force flush 由来。デバウンスエントリが無くても 1 回保存する。
   */
  private startSave(songId: string, force: boolean): Promise<void> {
    const entry = this.entries.get(songId);
    if (!entry && !force) return Promise.resolve();
    if (entry?.saving) {
      entry.rerunRequested = true;
      return entry.inFlight ?? Promise.resolve();
    }

    const work = this.runSaveLoop(songId, entry);
    if (entry) entry.inFlight = work;
    return work;
  }

  /** 保存を実行し、ループ中に来た dirty（rerunRequested）を吸収してもう 1 周する。 */
  private async runSaveLoop(songId: string, entry: Entry | undefined): Promise<void> {
    if (entry) {
      entry.saving = true;
      entry.timer = undefined;
    }
    try {
      do {
        if (entry) entry.rerunRequested = false;

        const document = this.resolveDocument(songId);
        if (!document) {
          // 対象が閉じられた等。スケジュールを片付けて終了。
          this.entries.delete(songId);
          return;
        }

        const saved = await this.saveWithRetry(songId, document);
        if (saved) this.hooks.onSaved?.(songId);
        if (entry) entry.firstDirtyAt = Date.now();
      } while (entry?.rerunRequested);
    } finally {
      if (entry) {
        entry.saving = false;
        entry.inFlight = undefined;
      }
    }
  }

  /**
   * 最大 3 回（1s / 3s / 9s）リトライする。全滅で onError を呼ぶ（例外は投げない）。
   * @returns 保存できたら true、全滅なら false。
   */
  private async saveWithRetry(songId: string, document: SongDocument): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.repo.save(document);
        return true;
      } catch (error) {
        if (attempt >= AUTOSAVE_RETRY_DELAYS_MS.length) {
          // リトライ全滅 = 保存不能。error-logging-foundation.md §9.2 に従い FILE-001（Error）を発行する。
          notificationCenter.report('FILE-001', { songId, error: String(error) });
          this.hooks.onError?.(songId, error);
          return false;
        }
        await delay(AUTOSAVE_RETRY_DELAYS_MS[attempt]!);
      }
    }
  }
}
