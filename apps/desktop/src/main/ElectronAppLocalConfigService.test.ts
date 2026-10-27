// IT-FS-APPCONFIG: `AppLocalConfigService`（端末ローカル設定） <!-- req webcorefoundation:d1f32e1c.b95d -->
// 検証節: data-model-persistence.md 13.2 節（ローカル既定パスの木：settings.json・window-bounds.json）・10.1 節の (b)
// UT/IT: data-model-persistence.md 13.2 節・10.1 節 — ElectronAppLocalConfigService
// 検証観点: settings.json のポインタの往復と設定全体からの切り替え、未作成・破損時は null、getActiveRoot / getLocalBackupRoot、
//           window-bounds.json の曲ごとの 1 件の読み書き（C0/C1）。

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PRE_MIGRATION_DIR } from '@riff-line/core/persistence';
import type { StorageRootPointer } from '@riff-line/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ElectronAppLocalConfigService,
  LOCAL_SETTINGS_FILE,
  PRE_MIGRATION_ROOT_DIR,
  WINDOW_BOUNDS_FILE,
} from './ElectronAppLocalConfigService';

let userData: string;
let service: ElectronAppLocalConfigService;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'tabapp-alcs-'));
  service = new ElectronAppLocalConfigService(userData);
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

/** ローカル既定パスの下の JSON を読む。 */
async function readLocalJson(fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(join(userData, fileName), 'utf-8')) as unknown;
}

describe('readPointer / writePointer', () => {
  it('readPointer_BeforeWrite_ReturnsNull', async () => {
    // IT-FS-APPCONFIG-01
    expect(await service.readPointer()).toBeNull();
  });

  it('writePointer_thenReadPointer_RoundTrips', async () => {
    // IT-FS-APPCONFIG-02
    const pointer: StorageRootPointer = { rootAbsolutePath: 'D:/cloud', storageType: 'icloud' };
    await service.writePointer(pointer);
    expect(await service.readPointer()).toEqual(pointer);
  });

  it('readPointer_CorruptFile_ReturnsNull', async () => {
    // IT-FS-APPCONFIG-03
    await writeFile(join(userData, LOCAL_SETTINGS_FILE), 'not json');
    expect(await service.readPointer()).toBeNull();
  });

  it('readPointer_MissingFields_ReturnsNull', async () => {
    // IT-FS-APPCONFIG-04
    await writeFile(join(userData, LOCAL_SETTINGS_FILE), JSON.stringify({ rootAbsolutePath: 'x' }));
    expect(await service.readPointer()).toBeNull();
  });

  it('writePointer_ローカル既定パスのsettings.jsonにポインタの2項目だけを一時ファイルからの改名で書く', async () => {
    // IT-FS-APPCONFIG-08 13.2 節「決まった後は主ストレージの場所を指すポインタ（StorageRootPointer：rootAbsolutePath・storageType）だけ」
    const withExtra = { rootAbsolutePath: 'D:/cloud', storageType: 'gdrive', extra: 1 } as StorageRootPointer;
    await service.writePointer(withExtra);
    expect(await readLocalJson('settings.json')).toEqual({ rootAbsolutePath: 'D:/cloud', storageType: 'gdrive' });
    // 前のファイル名には書かず、一時ファイルも残さない
    expect((await readdir(userData)).sort()).toEqual(['settings.json']);
  });

  it('readPointer_設定全体やポインタの形でない中身_nullで既定のローカル', async () => {
    // IT-FS-APPCONFIG-09 13.2 節の (b)「ポインタがあればその先を主ストレージとし、無ければ既定のローカルにする」
    const notPointers: unknown[] = [
      { storageLocation: { root: 'D:/Drive', type: 'custom' }, mirrorLocations: [] },
      [{ rootAbsolutePath: 'D:/x', storageType: 'local' }],
      null,
      { rootAbsolutePath: '', storageType: 'local' },
      { rootAbsolutePath: 'D:/x', storageType: 3 },
      { rootAbsolutePath: 'D:/x', storageType: 'dropbox' },
    ];
    for (const value of notPointers) {
      await writeFile(join(userData, LOCAL_SETTINGS_FILE), JSON.stringify(value));
      expect(await service.readPointer()).toBeNull();
      expect(await service.getActiveRoot()).toBe(join(userData, 'TabApp'));
    }
  });
});

describe('主ストレージが決まるまでと決まった後の settings.json', () => {
  const defaults = (): unknown => ({
    storageLocation: { root: userData, type: 'local' },
    mirrorLocations: [],
  });

  it('writeInitialSettingsIfUndetermined_初めての起動_設定全体を既定のローカルで置く', async () => {
    // IT-FS-APPCONFIG-10 13.2 節「主ストレージが決まるまでは設定全体（StorageSettings）」・417 行「settings.json をローカル既定パスに置き」
    await service.writeInitialSettingsIfUndetermined();
    expect(await readLocalJson(LOCAL_SETTINGS_FILE)).toEqual(defaults());
    expect(await service.readPointer()).toBeNull();
  });

  it('writeInitialSettingsIfUndetermined_ポインタや設定全体が既にある_書き換えない', async () => {
    // IT-FS-APPCONFIG-11
    const pointer = { rootAbsolutePath: join(userData, 'drive'), storageType: 'custom' };
    await writeFile(join(userData, LOCAL_SETTINGS_FILE), JSON.stringify(pointer));
    await service.writeInitialSettingsIfUndetermined();
    expect(await readLocalJson(LOCAL_SETTINGS_FILE)).toEqual(pointer);

    const settings = { storageLocation: { root: join(userData, 'other'), type: 'custom' }, mirrorLocations: [] };
    await writeFile(join(userData, LOCAL_SETTINGS_FILE), JSON.stringify(settings));
    await service.writeInitialSettingsIfUndetermined();
    expect(await readLocalJson(LOCAL_SETTINGS_FILE)).toEqual(settings);
  });

  it('writeInitialSettingsIfUndetermined_形の違う設定全体や壊れた中身_既定で置き直す', async () => {
    // IT-FS-APPCONFIG-12
    const broken: string[] = [
      'not json',
      JSON.stringify({ storageLocation: 'D:/x' }),
      JSON.stringify({ storageLocation: { root: 1, type: 'local' } }),
      JSON.stringify({ storageLocation: { root: 'D:/x', type: 1 } }),
      JSON.stringify({ storageLocation: { root: 'D:/x', type: 'dropbox' } }),
    ];
    for (const text of broken) {
      await writeFile(join(userData, LOCAL_SETTINGS_FILE), text);
      await service.writeInitialSettingsIfUndetermined();
      expect(await readLocalJson(LOCAL_SETTINGS_FILE)).toEqual(defaults());
    }
  });

  it('confirmDefaultLocalIfUndetermined_ポインタが無い_既定のローカルを指すポインタだけにする', async () => {
    // IT-FS-APPCONFIG-13 13.2 節の (b)「主ストレージが決まったと数えるのは、初めての起動で既定のローカルの TabApp/ を作り終えたとき」
    await service.writeInitialSettingsIfUndetermined();
    await service.confirmDefaultLocalIfUndetermined();
    expect(await readLocalJson(LOCAL_SETTINGS_FILE)).toEqual({ rootAbsolutePath: userData, storageType: 'local' });
    expect(await service.getActiveRoot()).toBe(join(userData, 'TabApp'));
  });

  it('confirmDefaultLocalIfUndetermined_移行で切り替えたポインタがある_書き換えない', async () => {
    // IT-FS-APPCONFIG-14 13.2 節の (b)「12 節の移行で切り替えたとき」も決まったと数える
    const pointer: StorageRootPointer = { rootAbsolutePath: join(userData, 'drive'), storageType: 'gdrive' };
    await service.writePointer(pointer);
    await service.confirmDefaultLocalIfUndetermined();
    expect(await service.readPointer()).toEqual(pointer);
    expect(await service.getActiveRoot()).toBe(join(userData, 'drive', 'TabApp'));
  });
});

describe('getActiveRoot / getLocalBackupRoot', () => {
  it('getActiveRoot_NoPointer_DefaultsToUserDataTabApp', async () => {
    // IT-FS-APPCONFIG-05
    expect(await service.getActiveRoot()).toBe(join(userData, 'TabApp'));
  });

  it('getActiveRoot_WithPointer_UsesPointerRootPlusTabApp', async () => {
    // IT-FS-APPCONFIG-06
    await service.writePointer({ rootAbsolutePath: join(userData, 'drive'), storageType: 'custom' });
    expect(await service.getActiveRoot()).toBe(join(userData, 'drive', 'TabApp'));
  });

  it('getLocalBackupRoot_ReturnsUserDataLocalBackup', () => {
    // IT-FS-APPCONFIG-07
    expect(service.getLocalBackupRoot()).toBe(join(userData, 'LocalBackup'));
  });

  it('getPreMigrationRoot_ReturnsUserDataPreMigration_SameNameAsCore', () => {
    // IT-FS-APPCONFIG-21 data-model-persistence.md 10.1 節・13.2 節：PreMigration/ は LocalBackup/ と同じ親（userData）の下。
    // 名前を core の PRE_MIGRATION_DIR と main の 2 か所に持つので、食い違いをここで止める
    expect(service.getPreMigrationRoot()).toBe(join(userData, 'PreMigration'));
    expect(PRE_MIGRATION_ROOT_DIR).toBe(PRE_MIGRATION_DIR);
  });
});

describe('window-bounds.json（13.2 節の (b)）', () => {
  it('readWindowBounds_記録が無い_null', async () => {
    // IT-FS-APPCONFIG-15
    expect(await service.readWindowBounds('song-a')).toBeNull();
  });

  it('writeWindowBounds_曲のidをキーにした1つのオブジェクトに位置と大きさの4項目だけを書く', async () => {
    // IT-FS-APPCONFIG-16 13.2 節の (b)「曲の id をキーにした 1 つの JSON のオブジェクトとし、window-bounds.json の 1 件は { x, y, width, height }」
    const bounds = { x: 10, y: 20, width: 800, height: 600, extra: true };
    await service.writeWindowBounds('song-a', bounds);
    expect(await readLocalJson(WINDOW_BOUNDS_FILE)).toEqual({ 'song-a': { x: 10, y: 20, width: 800, height: 600 } });
    expect(await service.readWindowBounds('song-a')).toEqual({ x: 10, y: 20, width: 800, height: 600 });
    // 一時ファイルを残さず、settings.json（主ストレージの場所）には入れない
    expect(await readdir(userData)).toEqual(['window-bounds.json']);
  });

  it('writeWindowBounds_読んでその曲の1件だけを替え_ほかの曲の記録はそのまま残す', async () => {
    // IT-FS-APPCONFIG-17 13.2 節の (b)「書くときは読んでその曲の 1 件だけを替え」
    await writeFile(
      join(userData, WINDOW_BOUNDS_FILE),
      JSON.stringify({ 'song-a': { x: 1, y: 2, width: 3, height: 4 }, 'song-b': { x: 5, y: 6, width: 7, height: 8 } }),
    );
    await service.writeWindowBounds('song-a', { x: -100, y: 0, width: 1280, height: 800 });
    expect(await readLocalJson(WINDOW_BOUNDS_FILE)).toEqual({
      'song-a': { x: -100, y: 0, width: 1280, height: 800 },
      'song-b': { x: 5, y: 6, width: 7, height: 8 },
    });
  });

  it('readWindowBounds_壊れた中身や形の違う1件_null_書くとその曲の1件で置き直す', async () => {
    // IT-FS-APPCONFIG-18
    const cases: string[] = ['not json', JSON.stringify([1, 2]), JSON.stringify({ 'song-a': 'x' })];
    for (const text of cases) {
      await writeFile(join(userData, WINDOW_BOUNDS_FILE), text);
      expect(await service.readWindowBounds('song-a')).toBeNull();
    }
    await writeFile(
      join(userData, WINDOW_BOUNDS_FILE),
      JSON.stringify({ 'song-a': { x: 1.5, y: 0, width: 1, height: 1 } }),
    );
    expect(await service.readWindowBounds('song-a')).toBeNull();

    await writeFile(join(userData, WINDOW_BOUNDS_FILE), 'not json');
    await service.writeWindowBounds('song-a', { x: 0, y: 0, width: 1, height: 1 });
    expect(await readLocalJson(WINDOW_BOUNDS_FILE)).toEqual({ 'song-a': { x: 0, y: 0, width: 1, height: 1 } });
  });

  it('readWindowBounds_オブジェクトの元から引き継ぐ名前_記録として読まない', async () => {
    // IT-FS-APPCONFIG-19 曲の id をキーにした自前の項目だけを記録として読む
    await service.writeWindowBounds('song-a', { x: 0, y: 0, width: 1, height: 1 });
    expect(await service.readWindowBounds('toString')).toBeNull();
    expect(await service.readWindowBounds('__proto__')).toBeNull();
  });

  it('writeWindowBounds_settings.jsonの中身を巻き込まない', async () => {
    // IT-FS-APPCONFIG-20 13.2 節：ポインタ（settings.json）と窓の位置（window-bounds.json）は別のファイル
    const pointer: StorageRootPointer = { rootAbsolutePath: join(userData, 'drive'), storageType: 'custom' };
    await service.writePointer(pointer);
    await service.writeWindowBounds('song-a', { x: 0, y: 0, width: 1, height: 1 });
    expect(await service.readPointer()).toEqual(pointer);
    expect((await readdir(userData)).sort()).toEqual(['settings.json', 'window-bounds.json']);
  });
});
