/**
 * 自動保存の時機を決める（data-model-persistence.md 15 節、基本設計 06 章 5 節）。
 *
 * - 編集のコマンドが `notifyDirty(songId)` を呼ぶ。編集が止まってから `AUTOSAVE_DEBOUNCE_MS`（2 秒）で保存する。
 *   編集が続いていても、最後の保存から `AUTOSAVE_MAX_DELAY_MS`（10 秒）たったら、止まるのを待たずに保存する。
 *   まだ一度も保存していない曲では、10 秒は最初の未保存の編集から数える。
 * - 保存は `SongRepository.save(document)`。失敗したら `AUTOSAVE_RETRY_DELAYS_MS`（1 秒・3 秒・9 秒）の間を空けて 3 回まで書き直し、
 *   それでも失敗したら Error の `FILE-001` を出す。保存が終わったことは知らせない（トーストを出さない）。
 * - 保存が成功したら `onSaved` を呼ぶ。`onSaved` が始めるミラーの写し（14 節）とサムネイルの作り直し（9.1 節）は待たない。
 * - `flush(songId)` は、未保存の編集があれば待たずに保存し、保存（書き直しを含む）が終わるまで待つ。保存の途中で呼ばれたら、
 *   その保存が終わった後に、まだ未保存の編集があればもう 1 回保存してから終える。
 * - `pause()` は待っている保存を取り消し、`resume()` まで保存しない（移行のロック、12 節）。止めている間の `notifyDirty` は
 *   未保存として覚え、`resume()` の後に上の秒数で保存する。
 * - 2 つ目の数が今の版より大きい版で読んだ曲（`SongRepository.isNewerVersion`）は、`notifyDirty` と `flush` で保存しない
 *   （8 節、2026-10-27 本人決定、honnin-queue 213 番）。
 */

import type { SongDocument } from '../domain/SongDocument';

import { notificationCenter } from '../errors';

import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_DELAY_MS, AUTOSAVE_RETRY_DELAYS_MS } from './constants';
import { warnProvisional } from './log';
import type { SongRepository } from './SongRepository';

/** 曲ごとの自動保存の状態。 */
interface Entry {
  /** 保存していない編集があるか。保存を始めるときに下ろし、保存の途中の編集で立て直す。 */
  dirty: boolean;
  /** 最初の未保存の編集の時刻（ms）。まだ一度も保存していない曲の 10 秒の起点。 */
  firstUnsavedAt: number | undefined;
  /** 最後に保存が成功した時刻（ms）。10 秒の起点。 */
  lastSavedAt: number | undefined;
  /** 次の保存のタイマー。 */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** 保存の処理が進んでいるか。 */
  saving: boolean;
  /** 保存の途中で flush が呼ばれたか（その保存の後に、まだ未保存ならもう 1 回保存する）。 */
  flushRequested: boolean;
  /** dispose されたか（進んでいる保存の後に、次の保存を予約しない）。 */
  disposed: boolean;
  /** 進んでいる保存の処理。flush がこれを待つ。 */
  inFlight: Promise<void> | undefined;
}

export interface AutoSaveHooks {
  /**
   * 保存が成功したとき。songId を渡す。ここで始めるミラーの写しとサムネイルの作り直しは待たない
   * （戻り値が Promise でも待たず、失敗は中で受ける）。
   */
  // <!-- req datamodelpersistence:bf476dab.e967 -->
  onSaved?: (songId: string) => void | Promise<void>;
  /** 書き直しが尽きたとき（FILE-001 を出した後）。 */
  onError?: (songId: string, error: unknown) => void;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 次の保存までの待ち（ms）。編集が止まるのを待つ 2 秒と、10 秒の期限までの残りの短いほう（負なら 0）。
 * 10 秒の起点は最後の保存の時刻で、まだ一度も保存していなければ最初の未保存の編集の時刻（data-model-persistence.md 15 節）。
 */
// <!-- req datamodelpersistence:028b92d3.d8e2 -->
// <!-- req datamodelpersistence:028b92d3.7a9d -->
// <!-- req datamodelpersistence:028b92d3.d188 -->
// <!-- req datamodelpersistence:028b92d3.b7fc -->
export function autoSaveWaitMs(now: number, lastSavedAt: number | undefined, firstUnsavedAt: number): number {
  const origin = lastSavedAt ?? firstUnsavedAt;
  return Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, origin + AUTOSAVE_MAX_DELAY_MS - now));
}

// 10.4 節：自動保存はコマンドの実行とは別に非同期で行い、数秒の間隔でまとめて保存する（デバウンス、data-model-persistence.md 15 節）。10.5 節：曲全体を毎回シリアライズせず差分にするかは、2048 小節の大曲で 1 回のシリアライズの時間を測って決める（100ms 未満なら差分にしない、100ms 以上なら変更のあった小節とパートだけの差分へ切り替える。A6、14.8 節の負荷テスト） <!-- req webcorefoundation:8a1a23cc.ce39 --> <!-- req webcorefoundation:8a1a23cc.3685 --> <!-- req webcorefoundation:80574068.de81 --> <!-- req webcorefoundation:80574068.ec11 --> <!-- req webcorefoundation:80574068.1c68 --> <!-- req webcorefoundation:7c3aa0e8.31c2 --> <!-- req webcorefoundation:7c3aa0e8.a242 --> <!-- req webcorefoundation:7c3aa0e8.ff3b --> <!-- req webcorefoundation:18e22e5c.c536 --> <!-- req webcorefoundation:18e22e5c.6136 -->
export class AutoSaveScheduler {
  private readonly entries = new Map<string, Entry>();
  /** pause() から resume() までの間か。 */
  private paused = false;

  /**
   * @param repo 保存先。
   * @param resolveDocument songId から今の（メモリの上の）SongDocument を返す。undefined なら保存しない（曲が閉じられた）。
   * @param hooks 保存の成功と、書き直しが尽きたときのフック。
   */
  constructor(
    private readonly repo: SongRepository,
    private readonly resolveDocument: (songId: string) => SongDocument | undefined,
    private readonly hooks: AutoSaveHooks = {},
  ) {}

  /**
   * 編集があったことを受ける。上の秒数で保存を予約する。止めている間は未保存として覚えるだけにする。
   * 2 つ目の数が今の版より大きい版で読んだ曲（`SongRepository.isNewerVersion` が true）は、保存も予約もしない
   * （読むだけで開く曲。data-model-persistence.md 8 節、honnin-queue 213 番）。`allowEditing` の後は今までどおり保存する。
   */
  notifyDirty(songId: string): void {
    if (this.repo.isNewerVersion(songId)) return;
    const now = Date.now();
    let entry = this.entries.get(songId);
    if (!entry) {
      entry = {
        dirty: false,
        firstUnsavedAt: undefined,
        lastSavedAt: undefined,
        timer: undefined,
        saving: false,
        flushRequested: false,
        disposed: false,
        inFlight: undefined,
      };
      this.entries.set(songId, entry);
    }
    // <!-- req datamodelpersistence:5e60e4be.993e -->
    entry.firstUnsavedAt ??= now;
    entry.dirty = true;
    this.schedule(songId, entry, now);
  }

  /**
   * 未保存の編集があれば待たずに保存し、保存（書き直しを含む）が終わるまで待つ。
   * 保存の途中で呼ばれたら、その保存が終わった後に、まだ未保存の編集があればもう 1 回保存してから終える。
   * 止めている間（pause() から resume() まで）は保存を始めない。
   * 2 つ目の数が今の版より大きい版で読んだ曲（`SongRepository.isNewerVersion` が true）は保存しない（data-model-persistence.md 8 節）。
   */
  // <!-- req datamodelpersistence:5e60e4be.a96f -->
  async flush(songId: string): Promise<void> {
    if (this.repo.isNewerVersion(songId)) return;
    const entry = this.entries.get(songId);
    if (!entry) return;
    this.clearTimer(entry);
    if (entry.saving) {
      // <!-- req datamodelpersistence:5e60e4be.1eb9 -->
      entry.flushRequested = true;
      await entry.inFlight;
      return;
    }
    if (!entry.dirty || this.paused) return;
    // <!-- req datamodelpersistence:5e60e4be.7a26 -->
    await this.startSave(songId, entry);
  }

  /** 保存を止める。待っている保存を取り消し、resume() まで保存しない（data-model-persistence.md 12 節の移行のロック）。 */
  // <!-- req datamodelpersistence:5e60e4be.337b -->
  pause(): void {
    this.paused = true;
    // <!-- req datamodelpersistence:5e60e4be.99c6 -->
    for (const entry of this.entries.values()) this.clearTimer(entry);
  }

  /** 保存を再開する。止めている間に来た編集は、上の秒数で保存する。 */
  // <!-- req datamodelpersistence:5e60e4be.7ed3 -->
  resume(): void {
    this.paused = false;
    const now = Date.now();
    for (const [songId, entry] of this.entries) {
      // <!-- req datamodelpersistence:5e60e4be.cba0 -->
      if (entry.dirty) this.schedule(songId, entry, now);
    }
  }

  /** songId の予約を捨てる（保存はしない）。進んでいる保存は止めないが、その後の保存は予約しない。 */
  dispose(songId: string): void {
    const entry = this.entries.get(songId);
    if (!entry) return;
    this.clearTimer(entry);
    entry.disposed = true;
    this.entries.delete(songId);
  }

  /** 次の保存のタイマーを置き直す。止めている間・保存の途中（終わった後に置く）は置かない。 */
  private schedule(songId: string, entry: Entry, now: number): void {
    // <!-- req datamodelpersistence:5e60e4be.a14d -->
    if (this.paused || entry.saving) return;
    this.clearTimer(entry);
    // dirty のときは firstUnsavedAt が必ず入っている（notifyDirty で入れ、保存の成功でだけ消す）。
    const wait = autoSaveWaitMs(now, entry.lastSavedAt, entry.firstUnsavedAt!);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      // <!-- req datamodelpersistence:57199294.a062 -->
      void this.startSave(songId, entry);
    }, wait);
  }

  private clearTimer(entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private startSave(songId: string, entry: Entry): Promise<void> {
    const work = this.runSave(songId, entry);
    entry.inFlight = work;
    return work;
  }

  /** 保存する。途中で flush が呼ばれ、まだ未保存の編集があれば、もう 1 回保存する。 */
  private async runSave(songId: string, entry: Entry): Promise<void> {
    entry.saving = true;
    let failed = false;
    try {
      do {
        entry.flushRequested = false;
        const document = this.resolveDocument(songId);
        if (!document) {
          // 曲が閉じられた。予約を片付けて終える。
          entry.disposed = true;
          this.entries.delete(songId);
          return;
        }
        // ここまでの編集をこの保存で書く。保存の途中の編集は notifyDirty が立て直す。
        const unsavedSince = entry.firstUnsavedAt;
        entry.dirty = false;
        entry.firstUnsavedAt = undefined;
        const saved = await this.saveWithRetry(songId, document);
        if (!saved) {
          // 書き直しが尽きた。編集は未保存のまま残し、次の編集か flush で保存し直す。
          entry.dirty = true;
          entry.firstUnsavedAt = unsavedSince;
          failed = true;
          return;
        }
        // <!-- req datamodelpersistence:06583ea4.81ae -->
        entry.lastSavedAt = Date.now();
        // <!-- req datamodelpersistence:1d867737.132c -->
        this.notifySaved(songId);
        // <!-- req datamodelpersistence:5e60e4be.4b8f -->
      } while (entry.flushRequested && entry.dirty && !this.paused && !entry.disposed);
    } finally {
      entry.saving = false;
      entry.inFlight = undefined;
      entry.flushRequested = false;
      // 保存の途中の編集は、ふつうの秒数で保存する（書き直しが尽きたときは次の編集を待つ）。
      if (entry.dirty && !failed && !entry.disposed) this.schedule(songId, entry, Date.now());
    }
  }

  /** onSaved を呼ぶ。始めた処理（ミラーの写し・サムネイルの作り直し）は待たず、失敗しても保存の処理を止めない。 */
  // <!-- req datamodelpersistence:982be0d7.c642 -->
  // <!-- req datamodelpersistence:982be0d7.2c46 -->
  // <!-- req datamodelpersistence:bf476dab.4caa -->
  private notifySaved(songId: string): void {
    const onSaved = this.hooks.onSaved;
    if (!onSaved) return;
    try {
      const started = onSaved(songId);
      if (started instanceof Promise) {
        started.catch((error: unknown) => {
          warnProvisional(`保存の後の処理が失敗しました（保存は済んでいる）: ${songId}`, { error: String(error) });
        });
      }
    } catch (error) {
      warnProvisional(`保存の後の処理が失敗しました（保存は済んでいる）: ${songId}`, { error: String(error) });
    }
  }

  /**
   * 1 秒・3 秒・9 秒の間を空けて 3 回まで書き直す。尽きたら FILE-001 を出して onError を呼ぶ（投げない）。
   * @returns 保存できたら true、尽きたら false。
   */
  // <!-- req datamodelpersistence:06583ea4.4081 -->
  // <!-- req datamodelpersistence:06583ea4.21ce -->
  private async saveWithRetry(songId: string, document: SongDocument): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      try {
        // <!-- req datamodelpersistence:57199294.e490 -->
        await this.repo.save(document);
        return true;
      } catch (error) {
        if (attempt >= AUTOSAVE_RETRY_DELAYS_MS.length) {
          // 書き直しが尽きた＝保存できない。Error の FILE-001（data-model-persistence.md 15 節）。
          // <!-- req datamodelpersistence:06583ea4.119a -->
          notificationCenter.report('FILE-001', { songId, error: String(error) });
          this.hooks.onError?.(songId, error);
          return false;
        }
        await delay(AUTOSAVE_RETRY_DELAYS_MS[attempt]!);
      }
    }
  }
}
