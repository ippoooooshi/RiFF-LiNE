// UT: data-model-persistence.md §3.2・§5・§8、06_file_io_persistence.md §2・§4.2、B9 — StorageConfigService
// 検証観点: load の既定値／永続値、save、validateMirrorConfig の禁止パターン網羅（C0/C1/C2）。

import { beforeEach, describe, expect, it } from 'vitest';

import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { DEFAULT_TRASH_RETENTION_DAYS, STORAGE_SETTINGS_FILE } from './constants';
import { NullStorageLocationDetector, StorageConfigService, type StorageConfig } from './StorageConfigService';

const DEFAULT_ROOT = 'C:/Users/me/AppData/Roaming/TabApp';

let fs: FakeFileSystemAdapter;
let service: StorageConfigService;

beforeEach(() => {
  fs = new FakeFileSystemAdapter();
  service = new StorageConfigService(fs, DEFAULT_ROOT);
});

describe('StorageConfigService.load', () => {
  it('load_NoSettingsFile_ReturnsDefaults', async () => {
    expect(await service.load()).toEqual<StorageConfig>({
      primaryRoot: DEFAULT_ROOT,
      primaryType: 'local',
      mirrors: [],
      trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
    });
  });

  it('load_ExistingSettings_ReturnsPersistedValues', async () => {
    const stored: StorageConfig = {
      primaryRoot: 'D:/cloud/TabApp',
      primaryType: 'gdrive',
      mirrors: [{ root: 'E:/backup/TabApp', type: 'local' }],
      trashRetentionDays: 14,
    };
    fs.putJson(STORAGE_SETTINGS_FILE, stored);
    expect(await service.load()).toEqual(stored);
  });

  it('load_PartialOrInvalidSettings_FallsBackFieldwise', async () => {
    fs.putJson(STORAGE_SETTINGS_FILE, { mirrors: 'nope', trashRetentionDays: -5 });
    const config = await service.load();
    expect(config.primaryRoot).toBe(DEFAULT_ROOT);
    expect(config.mirrors).toEqual([]);
    expect(config.trashRetentionDays).toBe(DEFAULT_TRASH_RETENTION_DAYS);
  });
});

describe('StorageConfigService.save', () => {
  it('save_WritesSettingsJson', async () => {
    const config: StorageConfig = {
      primaryRoot: DEFAULT_ROOT,
      primaryType: 'local',
      mirrors: [],
      trashRetentionDays: 30,
    };
    await service.save(config);
    expect(fs.readJson<StorageConfig>(STORAGE_SETTINGS_FILE)).toEqual(config);
  });
});

describe('StorageConfigService.validateMirrorConfig', () => {
  const base: StorageConfig = {
    primaryRoot: 'C:/data/TabApp',
    primaryType: 'local',
    mirrors: [],
    trashRetentionDays: 30,
  };

  it('validateMirrorConfig_NoMirrors_Ok', () => {
    expect(service.validateMirrorConfig(base)).toEqual({ ok: true, errors: [] });
  });

  it('validateMirrorConfig_DistinctMirrors_Ok', () => {
    const result = service.validateMirrorConfig({
      ...base,
      mirrors: [
        { root: 'C:/icloud/TabApp', type: 'icloud' },
        { root: 'C:/gdrive/TabApp', type: 'gdrive' },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('validateMirrorConfig_MirrorEqualsPrimary_NotOk', () => {
    const result = service.validateMirrorConfig({
      ...base,
      mirrors: [{ root: 'C:/DATA/TabApp/', type: 'local' }], // 末尾スラッシュ・大小差も同一とみなす
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/主ストレージと同じ/);
  });

  it('validateMirrorConfig_DuplicateMirrors_NotOk', () => {
    const result = service.validateMirrorConfig({
      ...base,
      mirrors: [
        { root: 'C:/m/TabApp', type: 'icloud' },
        { root: 'C:/m/TabApp', type: 'gdrive' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /ミラー1とミラー2/.test(e))).toBe(true);
  });

  it('validateMirrorConfig_MultipleViolations_AllReported', () => {
    const result = service.validateMirrorConfig({
      ...base,
      mirrors: [
        { root: 'C:/data/TabApp', type: 'local' }, // == primary
        { root: 'C:/data/TabApp', type: 'icloud' }, // == primary AND dup of mirror1
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('NullStorageLocationDetector', () => {
  it('detectCandidates_ReturnsEmpty', async () => {
    expect(await NullStorageLocationDetector.detectCandidates()).toEqual([]);
  });
});
