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
    expect(await service.readPointer()).toBeNull();
  });

  it('writePointer_thenReadPointer_RoundTrips', async () => {
    const pointer: StorageRootPointer = { rootAbsolutePath: 'D:/cloud', storageType: 'icloud' };
    await service.writePointer(pointer);
    expect(await service.readPointer()).toEqual(pointer);
  });

  it('readPointer_CorruptFile_ReturnsNull', async () => {
    await writeFile(join(userData, 'storage-pointer.json'), 'not json');
    expect(await service.readPointer()).toBeNull();
  });

  it('readPointer_MissingFields_ReturnsNull', async () => {
    await writeFile(join(userData, 'storage-pointer.json'), JSON.stringify({ rootAbsolutePath: 'x' }));
    expect(await service.readPointer()).toBeNull();
  });
});

describe('getActiveRoot / getLocalBackupRoot', () => {
  it('getActiveRoot_NoPointer_DefaultsToUserDataTabApp', async () => {
    expect(await service.getActiveRoot()).toBe(join(userData, 'TabApp'));
  });

  it('getActiveRoot_WithPointer_UsesPointerRootPlusTabApp', async () => {
    await service.writePointer({ rootAbsolutePath: join(userData, 'drive'), storageType: 'custom' });
    expect(await service.getActiveRoot()).toBe(join(userData, 'drive', 'TabApp'));
  });

  it('getLocalBackupRoot_ReturnsUserDataLocalBackup', () => {
    expect(service.getLocalBackupRoot()).toBe(join(userData, 'LocalBackup'));
  });
});
