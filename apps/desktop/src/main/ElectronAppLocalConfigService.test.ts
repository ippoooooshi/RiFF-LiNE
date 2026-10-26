// IT-FS-APPCONFIG: `AppLocalConfigService`（端末ローカル設定） <!-- req webcorefoundation:d1f32e1c.b95d -->
// 検証節: data-model-persistence.md §3.4
// UT/IT: data-model-persistence.md §3.4・§3.3.1 — ElectronAppLocalConfigService
// 検証観点: ポインタの往復、未作成・破損時は null、getActiveRoot / getLocalBackupRoot（C0/C1）。

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StorageRootPointer } from '@riff-line/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ElectronAppLocalConfigService } from './ElectronAppLocalConfigService';

let userData: string;
let service: ElectronAppLocalConfigService;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'tabapp-alcs-'));
  service = new ElectronAppLocalConfigService(userData);
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

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
    await writeFile(join(userData, 'storage-pointer.json'), 'not json');
    expect(await service.readPointer()).toBeNull();
  });

  it('readPointer_MissingFields_ReturnsNull', async () => {
    // IT-FS-APPCONFIG-04
    await writeFile(join(userData, 'storage-pointer.json'), JSON.stringify({ rootAbsolutePath: 'x' }));
    expect(await service.readPointer()).toBeNull();
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
});
