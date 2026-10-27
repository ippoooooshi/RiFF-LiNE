/**
 * AppLocalConfigService の Electron 実装（data-model-persistence.md 13.2 節 ローカル既定パスの木・10.1 節の (b)）。
 *
 * ローカル既定パス（`app.getPath('userData')`、11 節の (b)）の下の 2 つのファイルを読み書きする。
 *  - `settings.json`：主ストレージが決まるまでは設定全体（`StorageSettings`）、決まった後は主ストレージの場所を指す
 *    ポインタ（`StorageRootPointer`：`rootAbsolutePath`・`storageType`）だけ。
 *  - `window-bounds.json`：曲の `id` をキーにした 1 つの JSON のオブジェクトで、1 件は `{ x, y, width, height }`。
 * 主ストレージがまだ決まっていない初めての起動でも読めるよう、主ストレージの外（その PC の中）に置く。
 * 書くときは、15 節と同じ一時ファイル（`.tmp`）への書き込み（ディスクへの書き出しまで）と本ファイルへの改名で書く。
 * userData のパスはコンストラクタで受け取る（electron に依存しない。テストのため）。
 */

import { join } from 'node:path';

import type { StorageSettings } from '@riff-line/core/persistence';
import type { StorageRootPointer } from '@riff-line/shared-types';
import type { Rectangle } from 'electron';

import { ElectronFileSystemAdapter } from './ElectronFileSystemAdapter';

/**
 * ローカル既定パスの `settings.json` のポインタを読み書きする契約（data-model-persistence.md 13.2 節）。
 * 使うのは main だけ（Webコアへ注入する 4 系統のアダプタではなく、IPC の型でもない）なので、実装と同じファイルに置く
 * （packages/shared-types には IPC の型とチャンネルの名前だけを置く、web-core-foundation.md 5.1 節）。
 * ポインタが無い（初めての起動・主ストレージが決まる前・壊れている）ときは readPointer() が null を返し、
 * 呼び出し元は既定のローカルにする。
 */
export interface AppLocalConfigService {
  readPointer(): Promise<StorageRootPointer | null>;
  writePointer(pointer: StorageRootPointer): Promise<void>;
}

/** 曲ごとの窓の位置と大きさ（data-model-persistence.md 13.2 節の (b)。Electron の `BrowserWindow.getBounds()` の形）。 */
// data-model-persistence.md 13.2 節：window-bounds.json の 1 件は BrowserWindow.getBounds() の形の x・y・width・height <!-- req datamodelpersistence:9c678790.9af3 -->
export type WindowBounds = Pick<Rectangle, 'x' | 'y' | 'width' | 'height'>;

/** ローカル既定パスの設定（13.2 節の表の 1 行目）。apps/desktop/scripts/run-app.mjs のログの場所探しも同じ名前を読む。 */
// data-model-persistence.md 13.2 節：ポインタはローカル既定パスの settings.json に置き、起動のときはこれを読む <!-- req datamodelpersistence:7cd775a4.b716 --> <!-- req datamodelpersistence:7cd775a4.f81d -->
export const LOCAL_SETTINGS_FILE = 'settings.json';
/** 曲ごとの窓の位置と大きさ（13.2 節の表の 2 行目）。 */
// data-model-persistence.md 13.2 節：曲ごとの窓の位置と大きさは、主ストレージではなくローカル既定パスの window-bounds.json に曲の id ごとに 1 件置く <!-- req datamodelpersistence:a73ea055.d68d --> <!-- req datamodelpersistence:a73ea055.1904 --> <!-- req datamodelpersistence:e0dd6d5d.b517 --> <!-- req datamodelpersistence:e0dd6d5d.6975 --> <!-- req datamodelpersistence:e0dd6d5d.794b -->
export const WINDOW_BOUNDS_FILE = 'window-bounds.json';
/** 一時ファイルからの改名で書くときの一時ファイルの後ろ（15 節、packages/core の paths.ts と同じ形）。 */
const TMP_SUFFIX = '.tmp';
/** LocalBackupService 用の端末ローカル専用ルート名（B25）。 */
const LOCAL_BACKUP_DIR = 'LocalBackup';
/**
 * 変換する前の版を置くフォルダ名（data-model-persistence.md 8 節・13.2 節、`LocalBackup/` と並ぶ）。
 * packages/core の `PRE_MIGRATION_DIR` と同じ名前（main は alphaTab を引き込まないよう core の persistence を読まない。
 * 食い違いは ElectronAppLocalConfigService.test.ts が止める）。
 */
export const PRE_MIGRATION_ROOT_DIR = 'PreMigration';
/** 主ストレージ配下のアプリデータフォルダ名（06_file_io_persistence.md 3 節）。ミラー先の下の `TabApp/` も同じ名前（14.1 節、mirrorSync.ts）。 */
export const TABAPP_DIR = 'TabApp';
/** ポインタの `storageType` に入れてよい値（11 節の `StorageType`）。 */
const STORAGE_TYPES: ReadonlySet<string> = new Set<StorageRootPointer['storageType']>([
  'local',
  'icloud',
  'gdrive',
  'custom',
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 読んだ値が JSON のオブジェクト（配列でない）か。ファイルは手で書き換えられるので、型を信じない。 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 読んだ値がポインタ（`StorageRootPointer`）の形か。 */
function toPointer(value: unknown): StorageRootPointer | null {
  if (!isJsonObject(value)) return null;
  const { rootAbsolutePath, storageType } = value;
  if (typeof rootAbsolutePath !== 'string' || rootAbsolutePath === '') return null;
  if (typeof storageType !== 'string' || !STORAGE_TYPES.has(storageType)) return null;
  return { rootAbsolutePath, storageType: storageType as StorageRootPointer['storageType'] };
}

/** 読んだ値が設定全体（`StorageSettings`）の形か（主ストレージの場所を持つか）。 */
function isStorageSettings(value: unknown): boolean {
  if (!isJsonObject(value) || !isJsonObject(value['storageLocation'])) return false;
  const { root, type } = value['storageLocation'];
  return typeof root === 'string' && typeof type === 'string' && STORAGE_TYPES.has(type);
}

/** 読んだ値が窓の位置と大きさ（4 つとも整数）の形か。 */
function toWindowBounds(value: unknown): WindowBounds | null {
  if (!isJsonObject(value)) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => Number.isInteger(n))) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

// data-model-persistence.md 13.2 節：アプリの側に置くローカル既定パスのファイルは 13.2 節の木に含まれるものに限る <!-- req datamodelpersistence:639788d0.31bc -->
export class ElectronAppLocalConfigService implements AppLocalConfigService {
  /** ローカル既定パスを根にしたアダプタ（一時ファイルへの書き込みと改名をここに任せる）。 */
  private readonly localFs: ElectronFileSystemAdapter;

  /**
   * @param userDataPath `app.getPath('userData')` の値（絶対パス）。
   */
  // data-model-persistence.md 13.2 節：ローカル既定パスは、その PC の中の userData で、主ストレージの既定の TabApp/ とは別の場所にする <!-- req datamodelpersistence:fdc64d7d.dca9 --> <!-- req datamodelpersistence:fdc64d7d.1d12 --> <!-- req datamodelpersistence:fdc64d7d.501e -->
  constructor(private readonly userDataPath: string) {
    // ローカル既定パスは同期フォルダの中に無いので、空のファイルを読んだときの読み直し（16 節）はしない。
    this.localFs = new ElectronFileSystemAdapter(userDataPath, { retryOnDemandDownload: false });
  }

  /** ローカル既定パスの下の JSON を読む。無い・読めない・JSON でないときは undefined。 */
  private async readJson(fileName: string): Promise<unknown> {
    try {
      return JSON.parse(decoder.decode(await this.localFs.readFile(fileName))) as unknown;
    } catch {
      return undefined;
    }
  }

  /** ローカル既定パスの下へ、一時ファイルへの書き込み（ディスクへの書き出しまで）と改名で JSON を書く（15 節）。 */
  private async writeJsonAtomically(fileName: string, value: unknown): Promise<void> {
    await this.localFs.ensureDirectory('.');
    const tmp = `${fileName}${TMP_SUFFIX}`;
    await this.localFs.writeFile(tmp, encoder.encode(`${JSON.stringify(value, null, 2)}\n`));
    await this.localFs.renameFile(tmp, fileName);
  }

  /** ローカル既定パスの `settings.json` のポインタを読む。ポインタの形でなければ（設定全体・無い・壊れている）null。 */
  async readPointer(): Promise<StorageRootPointer | null> {
    return toPointer(await this.readJson(LOCAL_SETTINGS_FILE));
  }

  /** 主ストレージが決まった後の `settings.json`：ポインタだけを書く（設定全体はそのまま置き換える）。 */
  // data-model-persistence.md 13.2 節：主ストレージが決まった後は、ローカル既定パスの settings.json に主ストレージを指すポインタだけを写しておく <!-- req datamodelpersistence:5a55a4ad.f985 --> <!-- req datamodelpersistence:ddb32fa0.1131 --> <!-- req datamodelpersistence:ddb32fa0.9a92 -->
  async writePointer(pointer: StorageRootPointer): Promise<void> {
    await this.writeJsonAtomically(LOCAL_SETTINGS_FILE, {
      rootAbsolutePath: pointer.rootAbsolutePath,
      storageType: pointer.storageType,
    });
  }

  /**
   * 初めての起動で主ストレージがまだ決まっていないときに、`settings.json` に設定全体（既定のローカル、ミラー先 0 個）を置く。
   * ポインタがある（決まっている）とき・設定全体が既にあるときは何もしない。
   */
  // data-model-persistence.md 13.2 節：初めて起動して主ストレージがまだ決まっていないときは、ローカル既定パスの settings.json に設定全体（StorageSettings）を置く <!-- req datamodelpersistence:5a55a4ad.75ea --> <!-- req datamodelpersistence:ddb32fa0.c8d0 -->
  async writeInitialSettingsIfUndetermined(): Promise<void> {
    const current = await this.readJson(LOCAL_SETTINGS_FILE);
    if (toPointer(current) !== null || isStorageSettings(current)) return;
    const settings: StorageSettings = {
      storageLocation: { root: this.userDataPath, type: 'local' },
      mirrorLocations: [],
    };
    await this.writeJsonAtomically(LOCAL_SETTINGS_FILE, settings);
  }

  /**
   * 既定のローカルの `TabApp/` を作り終えた後に呼ぶ。ポインタがまだ無ければ、主ストレージが決まったとして
   * `settings.json` を既定のローカル（`userData`）を指すポインタだけにする。ポインタがあれば何もしない。
   */
  // data-model-persistence.md 13.2 節：初めての起動で既定のローカルの TabApp/ を作り終えたときに、主ストレージが決まったと数える <!-- req datamodelpersistence:7cd775a4.65f9 -->
  async confirmDefaultLocalIfUndetermined(): Promise<void> {
    if ((await this.readPointer()) !== null) return;
    await this.writePointer({ rootAbsolutePath: this.userDataPath, storageType: 'local' });
  }

  /**
   * 起動のときの主ストレージ：`settings.json` にポインタがあればその先の `{root}/TabApp`、無ければ既定のローカルの
   * `{userData}/TabApp`。data-model-persistence.md 10.1 節の `appconfig:getActiveRoot` に対応する。
   */
  // data-model-persistence.md 13.2 節：起動のときは最初にローカル既定パスの settings.json を読み、ポインタがあればその先、無ければ既定のローカルを主ストレージとし、その下の TabApp/ をアプリのファイルのルートにする（13.1 節） <!-- req datamodelpersistence:7cd775a4.0a5b --> <!-- req datamodelpersistence:7cd775a4.ae46 --> <!-- req datamodelpersistence:7cd775a4.5c28 --> <!-- req datamodelpersistence:ddb32fa0.4220 --> <!-- req datamodelpersistence:ddb32fa0.5f4c --> <!-- req datamodelpersistence:be62431b.f1dd --> <!-- req datamodelpersistence:be62431b.522a --> <!-- req datamodelpersistence:be62431b.3fbb -->
  async getActiveRoot(): Promise<string> {
    const pointer = await this.readPointer();
    // data-model-persistence.md 11 節：主ストレージの既定の場所は、Electron がアプリごとに用意する app.getPath('userData') <!-- req datamodelpersistence:7697ee9c.aa26 -->
    const base = pointer?.rootAbsolutePath ?? this.userDataPath;
    // data-model-persistence.md 11 節：曲のファイルはその下の TabApp/ に入れ、ローカル既定パスの木のファイルと重ねない <!-- req datamodelpersistence:7697ee9c.1afd -->
    return join(base, TABAPP_DIR);
  }

  /** LocalBackupService 用の端末ローカル専用ルート（`{userData}/LocalBackup`）。 */
  getLocalBackupRoot(): string {
    return join(this.userDataPath, LOCAL_BACKUP_DIR);
  }

  /**
   * PreMigrationService 用の端末ローカル専用ルート（`{userData}/PreMigration`、`getLocalBackupRoot` と同じ親の下）。
   * data-model-persistence.md 10.1 節の `appconfig:getPreMigrationRoot` に対応する（honnin-queue 206 番）。
   */
  getPreMigrationRoot(): string {
    return join(this.userDataPath, PRE_MIGRATION_ROOT_DIR);
  }

  /** `window-bounds.json` の中身。無い・壊れている・オブジェクトでないときは空のオブジェクト。 */
  private async readAllWindowBounds(): Promise<Record<string, unknown>> {
    const all = await this.readJson(WINDOW_BOUNDS_FILE);
    return isJsonObject(all) ? all : {};
  }

  /** その曲の窓の位置と大きさ。記録が無い・形が違うときは null。 */
  async readWindowBounds(songId: string): Promise<WindowBounds | null> {
    const all = await this.readAllWindowBounds();
    return Object.hasOwn(all, songId) ? toWindowBounds(all[songId]) : null;
  }

  /** `window-bounds.json` を読み、その曲の 1 件だけを替えて、一時ファイルからの改名で書く。ほかの曲の記録はそのまま残す。 */
  // data-model-persistence.md 13.2 節：曲の id をキーにした 1 つの JSON のオブジェクトを読んでその曲の 1 件だけを替え、15 節と同じ一時ファイルからの改名で書く <!-- req datamodelpersistence:9c678790.9e5a --> <!-- req datamodelpersistence:9c678790.c95d --> <!-- req datamodelpersistence:9c678790.74ba -->
  async writeWindowBounds(songId: string, bounds: WindowBounds): Promise<void> {
    const all = await this.readAllWindowBounds();
    const entry: WindowBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    await this.writeJsonAtomically(WINDOW_BOUNDS_FILE, { ...all, [songId]: entry });
  }
}
