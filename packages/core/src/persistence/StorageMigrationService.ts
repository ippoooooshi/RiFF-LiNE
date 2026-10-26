/**
 * 保存先の移行（data-model-persistence.md 12 節、基本設計 06 章 2.2 節）。
 *
 * `StorageMigrationService` は、古い保存先の `TabApp/` から新しい保存先の `TabApp/` へ、13.1 節の表で「移す」とした
 * ファイルを 1 つずつ写すことだけを受け持つ（12 節の (b)）。主ストレージを切り替える（ポインタを書く）のは、
 * 結果（`MigrationResult`）を受けた設定ダイアログの側。古いフォルダのファイルは消さない。
 *
 * `runStorageMigration` は、12 節のロックの順（flush を待って保存を止める → 写す → 成功なら切り替えてからロックを解いて
 * `FILE-014`、失敗なら古いままロックを解いて `FILE-013`）を組む。ロックの中身（各編集ウィンドウの覆い・保存を止めること）と
 * 切り替えの中身は、呼ぶ側（設定ダイアログ）から渡す。
 */

import type { DirEntry, FileSystemAdapter, FileSystemAdapterFactory } from '../platform';

import { ChecksumUtil } from './ChecksumUtil';
import { TMP_SUFFIX } from './constants';
import { decodeText, isFileNotFound } from './jsonIo';
import { isSongFileInTree, PRIMARY_STORAGE_TREE } from './paths';

export interface MigrationFailure {
  /** 写せなかったファイルの `TabApp/` からの相対パス。写す前の手順で失敗したときは空の文字列。 */
  path: string;
  error: string;
}

export interface MigrationResult {
  /** 全部を写せたときだけ true。false なら主ストレージを切り替えない（12 節の 5）。 */
  success: boolean;
  /** 写せたファイルの数。 */
  copied: number;
  /** 写す対象の総数。 */
  total: number;
  failures: MigrationFailure[];
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** フォルダの中の実ファイルの相対パスを、下のフォルダごと並べる。フォルダが無ければ空。一時ファイルは写さない。 */
async function listFilesRecursively(adapter: FileSystemAdapter, dir: string): Promise<string[]> {
  let entries: DirEntry[];
  try {
    entries = await adapter.listDirectory(dir);
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  }
  const out: string[] = [];
  for (const entry of entries) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...(await listFilesRecursively(adapter, child)));
    else if (!entry.name.endsWith(TMP_SUFFIX)) out.push(child);
  }
  return out;
}

/** 曲のファイルの中身の `integrity.checksum` が、中身から作り直した値と合うかを確かめる（12 節の 3、7 節）。 */
// data-model-persistence.md 12 節：曲のファイルは、読み戻したものの integrity.checksum を確かめる <!-- req datamodelpersistence:6ac44f86.97c9 -->
function verifySongChecksum(bytes: Uint8Array, relativePath: string): void {
  const raw = JSON.parse(decodeText(bytes)) as {
    schemaVersion?: string;
    song?: unknown;
    appMeta?: unknown;
    integrity?: { checksum?: unknown };
  };
  const stored = raw.integrity?.checksum;
  // チェックサムを持たない古い曲のファイルは、読むとき（SongRepository.load）と同じく確かめずに通す。
  if (typeof stored !== 'string' || !stored.startsWith('sha256:')) return;
  const recomputed = ChecksumUtil.compute(raw.schemaVersion ?? '', raw.song, raw.appMeta as never);
  if (recomputed !== stored) throw new Error(`チェックサムが合いません: ${relativePath}`);
}

// data-model-persistence.md 12 節：StorageMigrationService はファイルを写すことだけを受け持ち、主ストレージの切り替え（ポインタを書くこと）はせず、古いフォルダのファイルを自動で消さない <!-- req datamodelpersistence:df36f1fa.84c2 --> <!-- req datamodelpersistence:df36f1fa.b85b --> <!-- req datamodelpersistence:a86df126.18ce -->
export class StorageMigrationService {
  constructor(private readonly adapterFactory: FileSystemAdapterFactory) {}

  /**
   * 古い保存先から新しい保存先へ、13.1 節で「移す」としたファイルを 1 つずつ写す（12 節の 2・3）。
   * 1 つ写せなくても残りは写し続け、失敗を全部 `failures` に入れて返す（12 節の 5）。古いフォルダのファイルは消さない。
   * @param fromRoot 古い保存先の `TabApp/` の絶対パス。
   * @param toRoot 新しい保存先の `TabApp/` の絶対パス。
   * @param onProgress 写すファイルを 1 つ終えるたびに呼ぶ（done / total、screens-navigation.md 12.10 節の 9 項目目）。
   * @throws FileReadError 古い保存先のフォルダの一覧を読めないとき（何を写すか決められない）。
   */
  // data-model-persistence.md 12 節：migrate(fromRoot, toRoot, onProgress?) で、古いフォルダから新しいフォルダへ、13 節で移すとしたファイルだけを 1 つずつ写す <!-- req datamodelpersistence:cbe0af7b.afbe --> <!-- req datamodelpersistence:cbe0af7b.2021 --> <!-- req datamodelpersistence:cbe0af7b.9ceb --> <!-- req datamodelpersistence:cbe0af7b.1a47 -->
  async migrate(
    fromRoot: string,
    toRoot: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<MigrationResult> {
    const source = this.adapterFactory.createForRoot(fromRoot);
    // data-model-persistence.md 10.1 節：移行先は、その絶対パスをルートにした FileSystemAdapter を createForRoot で作る <!-- req datamodelpersistence:a5185d1e.4a69 -->
    const dest = this.adapterFactory.createForRoot(toRoot);

    const targets: string[] = [];
    for (const entry of PRIMARY_STORAGE_TREE) {
      if (!entry.migrate) continue;
      if (entry.kind === 'directory') targets.push(...(await listFilesRecursively(source, entry.path)));
      else targets.push(entry.path);
    }

    const failures: MigrationFailure[] = [];
    let copied = 0;
    let done = 0;

    for (const relativePath of targets) {
      try {
        if (await this.copyOne(source, dest, relativePath)) copied++;
      } catch (error) {
        failures.push({ path: relativePath, error: String(error) });
      }
      onProgress?.(++done, targets.length);
    }

    return { success: failures.length === 0, copied, total: targets.length, failures };
  }

  /**
   * 1 つのファイルを、一時ファイルに書いて改名し（15 節と同じ）、読み戻してバイトが全部同じか、
   * 曲のファイルなら `integrity.checksum` も確かめる。
   * @returns 写したら true。古い保存先に無いファイル（まだ作られていない設定のファイル）なら写さずに false。
   */
  // data-model-persistence.md 12 節：移す先に 15 節と同じ一時ファイルからの改名で書き、移す先から読み戻して古いほうとバイトが全部同じかを確かめる <!-- req datamodelpersistence:6ac44f86.34e3 --> <!-- req datamodelpersistence:6ac44f86.d652 -->
  private async copyOne(source: FileSystemAdapter, dest: FileSystemAdapter, relativePath: string): Promise<boolean> {
    let data: Uint8Array;
    try {
      data = await source.readFile(relativePath);
    } catch (error) {
      if (isFileNotFound(error)) return false;
      throw error;
    }

    const slash = relativePath.lastIndexOf('/');
    await dest.ensureDirectory(slash > 0 ? relativePath.slice(0, slash) : '.');

    const tmpPath = `${relativePath}${TMP_SUFFIX}`;
    await dest.writeFile(tmpPath, data);
    await dest.renameFile(tmpPath, relativePath);

    const readBack = await dest.readFile(relativePath);
    if (!bytesEqual(data, readBack)) {
      throw new Error(`読み戻した中身が違います: ${relativePath}`);
    }
    if (isSongFileInTree(relativePath)) verifySongChecksum(readBack, relativePath);
    return true;
  }
}

/** 移している間の 1 つの編集ウィンドウのロック（12 節の (b)）。中身は編集ウィンドウの側が持つ。 */
// data-model-persistence.md 12 節：ロックは、各編集ウィンドウの AutoSaveScheduler.flush(songId) の終わりを待ってから保存を止め、編集のコマンドを受け付けないようにし、ロックの間は保存しない（中身は編集ウィンドウの側） <!-- req datamodelpersistence:20071a07.a0ce --> <!-- req datamodelpersistence:20071a07.8593 --> <!-- req datamodelpersistence:20071a07.8343 --> <!-- req datamodelpersistence:20071a07.b32e --> <!-- req datamodelpersistence:20071a07.f59c --> <!-- req datamodelpersistence:4ce3542c.aa6b -->
export interface MigrationLockTarget {
  /** その編集ウィンドウの `AutoSaveScheduler.flush(songId)` の終わりを待ってから保存を止め、編集のコマンドを受け付けないようにする。 */
  lock(): Promise<void>;
  /** ロックを解き、保存と編集を戻す。 */
  unlock(): Promise<void>;
}

/** `runStorageMigration` に渡すもの。 */
export interface StorageMigrationRunDeps {
  service: Pick<StorageMigrationService, 'migrate'>;
  /** 開いている編集ウィンドウ全部のロック。 */
  lockTargets: readonly MigrationLockTarget[];
  /** 主ストレージを新しいフォルダに切り替える（`settings.json` とローカル既定パスのポインタを書く、設定ダイアログの側）。 */
  // data-model-persistence.md 12 節：主ストレージの切り替えは settings.json とローカル既定パスのポインタを書き換え、ここで主ストレージが決まったと数える（13.2 節、中身は設定ダイアログの側） <!-- req datamodelpersistence:9c9329ea.c227 --> <!-- req datamodelpersistence:9c9329ea.8b37 --> <!-- req datamodelpersistence:7cd775a4.f235 -->
  switchPrimaryStorage(toRoot: string): Promise<void>;
  reporter: { report(code: string, context?: Record<string, unknown>): void };
}

/**
 * 12 節の移行の順を組む。`FILE-012` の確かめで利用者が移すことを選んだ後に呼ぶ。
 * 1. 開いている編集ウィンドウを全部ロックする（flush を待って保存を止める）
 * 2. `migrate` で写す
 * 3. 成功なら主ストレージを切り替えてからロックを解き、`FILE-014` を出す
 * 4. 失敗なら（ロック・写す・切り替えのどれかが投げたときを含む）主ストレージは古いままロックを解き、`FILE-013` を出す
 * @returns 移行の結果。切り替えたときだけ `success` が true。
 */
// data-model-persistence.md 12 節：動いている間の保存先の変更を、FILE-012 の後に開いている編集ウィンドウを全部ロックして写し、成功なら切り替えてからロックを解いて FILE-014、失敗なら古いフォルダのままロックを解いて FILE-013 の順で組む <!-- req datamodelpersistence:11bfdb8f.a9d4 --> <!-- req datamodelpersistence:fb871d5e.ee84 --> <!-- req datamodelpersistence:cbe0af7b.9e73 --> <!-- req datamodelpersistence:9c9329ea.ba0e --> <!-- req datamodelpersistence:863de9d9.b8bd --> <!-- req datamodelpersistence:863de9d9.c095 --> <!-- req datamodelpersistence:20071a07.54f2 --> <!-- req datamodelpersistence:4ce3542c.1e3b --> <!-- req datamodelpersistence:4ce3542c.7344 --> <!-- req datamodelpersistence:4ce3542c.5c4a --> <!-- req datamodelpersistence:88900b9a.61a2 --> <!-- req datamodelpersistence:88900b9a.9e08 --> <!-- req datamodelpersistence:88900b9a.1f13 --> <!-- req datamodelpersistence:88900b9a.20a7 --> <!-- req datamodelpersistence:88900b9a.1b15 --> <!-- req datamodelpersistence:88900b9a.e87b --> <!-- req datamodelpersistence:88900b9a.59c9 -->
export async function runStorageMigration(
  deps: StorageMigrationRunDeps,
  fromRoot: string,
  toRoot: string,
  onProgress?: (done: number, total: number) => void,
): Promise<MigrationResult> {
  const locked: MigrationLockTarget[] = [];
  let result: MigrationResult = { success: false, copied: 0, total: 0, failures: [] };
  try {
    for (const target of deps.lockTargets) {
      await target.lock();
      locked.push(target);
    }
    result = await deps.service.migrate(fromRoot, toRoot, onProgress);
    if (result.success) await deps.switchPrimaryStorage(toRoot);
  } catch (error) {
    result = { ...result, success: false, failures: [...result.failures, { path: '', error: String(error) }] };
  }
  for (const target of locked) await target.unlock();

  if (result.success) {
    deps.reporter.report('FILE-014');
  } else {
    deps.reporter.report('FILE-013', {
      failedCount: result.failures.length,
      failedPaths: result.failures
        .map((f) => f.path)
        .filter((p) => p !== '')
        .join('、'),
    });
  }
  return result;
}
