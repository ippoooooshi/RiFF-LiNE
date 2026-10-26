// UT-PERSIST-CONFIG: `StorageConfigService`（`settings.json`） <!-- req webcorefoundation:078d44f6.c72f -->
// 検証節: data-model-persistence.md 11 節（StorageSettings の型と既定）・13 節（settings.json）・14.2 節（validateMirrorConfig と FILE-009〜011）
// 検証観点: load の既定値／保存した値／形の違う値の補い、save、validateMirrorConfig の組み合わせ（C0/C1）。

import { beforeEach, describe, expect, it } from 'vitest';

import { FakeFileSystemAdapter } from '../testing/FakeFileSystemAdapter';

import { STORAGE_SETTINGS_FILE } from './constants';
import { NullStorageLocationDetector, StorageConfigService, type StorageSettings } from './StorageConfigService';

const DEFAULT_ROOT = 'C:/Users/me/AppData/Roaming/RiFF-LiNE';

const DEFAULTS: StorageSettings = {
  storageLocation: { root: DEFAULT_ROOT, type: 'local' },
  mirrorLocations: [],
};

let fs: FakeFileSystemAdapter;
let service: StorageConfigService;

beforeEach(() => {
  fs = new FakeFileSystemAdapter();
  service = new StorageConfigService(fs, DEFAULT_ROOT);
});

describe('StorageConfigService.load', () => {
  it('load_NoSettingsFile_ReturnsDefaults', async () => {
    // UT-PERSIST-CONFIG-01 data-model-persistence.md 11 節：settings.json が無いときは、主ストレージ＝その PC のアプリの領域（local）、ミラー先 0 個
    expect(await service.load()).toEqual<StorageSettings>(DEFAULTS);
  });

  it('load_ExistingSettings_ReturnsPersistedValues', async () => {
    // UT-PERSIST-CONFIG-02 data-model-persistence.md 13 節：settings.json の StorageSettings をそのまま読む
    const stored: StorageSettings = {
      storageLocation: { root: 'D:/cloud', type: 'gdrive' },
      mirrorLocations: [
        { root: 'E:/backup', type: 'local' },
        { root: 'F:/picked', type: 'custom' },
      ],
    };
    fs.putJson(STORAGE_SETTINGS_FILE, stored);
    expect(await service.load()).toEqual(stored);
  });

  it('load_PartialOrInvalidSettings_FallsBackFieldwise', async () => {
    // UT-PERSIST-CONFIG-03 data-model-persistence.md 11 節：形の違う項目は項目ごとに既定で補う
    fs.putJson(STORAGE_SETTINGS_FILE, { mirrorLocations: 'nope' });
    expect(await service.load()).toEqual(DEFAULTS);

    fs.putJson(STORAGE_SETTINGS_FILE, { storageLocation: { root: 'D:/x', type: 'icloud' } });
    expect(await service.load()).toEqual({ storageLocation: { root: 'D:/x', type: 'icloud' }, mirrorLocations: [] });
  });

  it('load_OldSettingsWithTrashRetention_DoesNotCarryRetention', async () => {
    // UT-PERSIST-CONFIG-11 data-model-persistence.md 11 節：ゴミ箱の保持期間は StorageSettings に持たない（13.3 節の preferences.json）
    fs.putJson(STORAGE_SETTINGS_FILE, { ...DEFAULTS, trashRetentionDays: 14, primaryRoot: 'D:/old' });
    const loaded = await service.load();
    expect(Object.keys(loaded).sort()).toEqual(['mirrorLocations', 'storageLocation']);
    expect(loaded).toEqual(DEFAULTS);
  });

  it('load_InvalidStorageLocation_FallsBackToLocalDefault', async () => {
    // UT-PERSIST-CONFIG-12 data-model-persistence.md 11 節：主ストレージは root（文字列）と type（4 つの種別）の形でなければ既定にする
    const invalid: unknown[] = [
      null,
      'C:/x',
      { root: 1, type: 'local' },
      { root: 'C:/x', type: 5 },
      { root: 'C:/x', type: 'dropbox' },
    ];
    for (const storageLocation of invalid) {
      fs.putJson(STORAGE_SETTINGS_FILE, { storageLocation, mirrorLocations: [] });
      expect((await service.load()).storageLocation, JSON.stringify(storageLocation)).toEqual(DEFAULTS.storageLocation);
    }
  });

  it('load_MirrorLocations_KeepsOnlyValidEntriesWithRootAndType', async () => {
    // UT-PERSIST-CONFIG-13 data-model-persistence.md 11 節：ミラー先は StorageLocation の並び（形の違うものは落とし、余計な項目は持たない）
    fs.putJson(STORAGE_SETTINGS_FILE, {
      storageLocation: { root: 'C:/main', type: 'local' },
      mirrorLocations: [
        { root: 'D:/icloud', type: 'icloud', extra: true },
        { root: 'D:/drop', type: 'dropbox' },
        null,
        { root: 'D:/gdrive', type: 'gdrive' },
      ],
    });
    expect((await service.load()).mirrorLocations).toEqual([
      { root: 'D:/icloud', type: 'icloud' },
      { root: 'D:/gdrive', type: 'gdrive' },
    ]);
  });

  it('load_NonObjectJson_ReturnsDefaults', async () => {
    // UT-PERSIST-CONFIG-14 data-model-persistence.md 11 節：settings.json の中身がオブジェクトでなければ全部既定にする
    for (const content of [null, 42, 'text']) {
      fs.putJson(STORAGE_SETTINGS_FILE, content);
      expect(await service.load(), JSON.stringify(content)).toEqual(DEFAULTS);
    }
  });
});

describe('StorageConfigService.save', () => {
  it('save_WritesSettingsJson', async () => {
    // UT-PERSIST-CONFIG-04 data-model-persistence.md 13 節：保存先の設定は settings.json に書き、読み直すと同じになる
    const settings: StorageSettings = {
      storageLocation: { root: 'D:/icloud', type: 'icloud' },
      mirrorLocations: [{ root: 'E:/gdrive', type: 'gdrive' }],
    };
    await service.save(settings);
    expect(fs.readJson<StorageSettings>(STORAGE_SETTINGS_FILE)).toEqual(settings);
    expect(await service.load()).toEqual(settings);
  });

  it('save_ExtraKeys_WritesOnlyStorageSettings', async () => {
    // UT-PERSIST-CONFIG-15 data-model-persistence.md 11 節：settings.json には主ストレージとミラー先だけを書く（保持期間を書かない）
    const withExtra = { ...DEFAULTS, trashRetentionDays: 30 } as StorageSettings;
    await service.save(withExtra);
    expect(Object.keys(fs.readJson<Record<string, unknown>>(STORAGE_SETTINGS_FILE)).sort()).toEqual([
      'mirrorLocations',
      'storageLocation',
    ]);
  });
});

describe('StorageConfigService.validateMirrorConfig', () => {
  const base: StorageSettings = {
    storageLocation: { root: 'C:/data', type: 'local' },
    mirrorLocations: [],
  };

  it('validateMirrorConfig_NoMirrors_Ok', () => {
    // UT-PERSIST-CONFIG-05 data-model-persistence.md 14.2 節：主＝ローカルだけ（ミラーなし）はできる
    expect(service.validateMirrorConfig(base)).toEqual({ ok: true, errors: [], infos: [] });
  });

  it('validateMirrorConfig_DistinctMirrors_Ok', () => {
    // UT-PERSIST-CONFIG-06 data-model-persistence.md 14.2 節：主＝ローカル＋ミラー＝iCloud Drive＋ミラー＝Google Drive（別のフォルダ）はできる
    const result = service.validateMirrorConfig({
      ...base,
      mirrorLocations: [
        { root: 'C:/icloud', type: 'icloud' },
        { root: 'C:/gdrive', type: 'gdrive' },
      ],
    });
    expect(result).toEqual({ ok: true, errors: [], infos: [] });
  });

  it('validateMirrorConfig_MirrorEqualsPrimary_File009', () => {
    // UT-PERSIST-CONFIG-07 data-model-persistence.md 14.2 節：同じフォルダを主とミラー先の両方にすると FILE-009（末尾の区切りと大小の差は同じとみなす）
    const result = service.validateMirrorConfig({
      ...base,
      mirrorLocations: [{ root: 'C:/DATA/', type: 'custom' }],
    });
    expect(result).toEqual({ ok: false, errors: ['FILE-009'], infos: [] });
  });

  it('validateMirrorConfig_DuplicateMirrors_File009', () => {
    // UT-PERSIST-CONFIG-08 data-model-persistence.md 14.2 節：ミラー先どうしが同じフォルダのときも FILE-009
    const result = service.validateMirrorConfig({
      ...base,
      mirrorLocations: [
        { root: 'C:/m', type: 'local' },
        { root: 'C:/m', type: 'custom' },
      ],
    });
    expect(result).toEqual({ ok: false, errors: ['FILE-009'], infos: [] });
  });

  it('validateMirrorConfig_MultipleViolations_EachCodeOnce', () => {
    // UT-PERSIST-CONFIG-09 data-model-persistence.md 14.2 節：同じ違反が何組あっても errors にはコードを 1 回だけ入れる
    const result = service.validateMirrorConfig({
      ...base,
      mirrorLocations: [
        { root: 'C:/data', type: 'local' },
        { root: 'C:/data', type: 'custom' },
      ],
    });
    expect(result).toEqual({ ok: false, errors: ['FILE-009'], infos: [] });
  });

  it('validateMirrorConfig_ICloudAndGoogleDriveSamePath_File010', () => {
    // UT-PERSIST-CONFIG-16 data-model-persistence.md 14.2 節：iCloud Drive 用と Google Drive 用に同じパスを選ぶと FILE-010（同じフォルダの FILE-009 も入る）
    const result = service.validateMirrorConfig({
      ...base,
      mirrorLocations: [
        { root: 'D:/shared', type: 'gdrive' },
        { root: 'd:/Shared\\', type: 'icloud' },
      ],
    });
    expect(result).toEqual({ ok: false, errors: ['FILE-009', 'FILE-010'], infos: [] });
  });

  it('validateMirrorConfig_PrimaryICloudMirrorGoogleDrive_InfoFile011', () => {
    // UT-PERSIST-CONFIG-17 data-model-persistence.md 14.2 節：主＝iCloud Drive＋ミラー＝Google Drive は止めずに infos に FILE-011
    const result = service.validateMirrorConfig({
      storageLocation: { root: 'C:/icloud', type: 'icloud' },
      mirrorLocations: [{ root: 'C:/gdrive', type: 'gdrive' }],
    });
    expect(result).toEqual({ ok: true, errors: [], infos: ['FILE-011'] });
  });

  it('validateMirrorConfig_PrimaryGoogleDriveMirrorICloud_NoInfo', () => {
    // UT-PERSIST-CONFIG-18 data-model-persistence.md 14.2 節：FILE-011 は主＝iCloud Drive のときだけ（主＝Google Drive＋ミラー＝iCloud Drive は表に無い）
    const result = service.validateMirrorConfig({
      storageLocation: { root: 'C:/gdrive', type: 'gdrive' },
      mirrorLocations: [{ root: 'C:/icloud', type: 'icloud' }],
    });
    expect(result).toEqual({ ok: true, errors: [], infos: [] });
  });

  it('validateMirrorConfig_PrimaryICloudSamePathAsGoogleDriveMirror_ErrorsAndInfo', () => {
    // UT-PERSIST-CONFIG-19 data-model-persistence.md 14.2 節：止めるもの（errors）と知らせるだけのもの（infos）を分けて両方返す
    const result = service.validateMirrorConfig({
      storageLocation: { root: 'C:/both', type: 'icloud' },
      mirrorLocations: [{ root: 'C:/both', type: 'gdrive' }],
    });
    expect(result).toEqual({ ok: false, errors: ['FILE-009', 'FILE-010'], infos: ['FILE-011'] });
  });
});

describe('NullStorageLocationDetector', () => {
  it('detectCandidates_ReturnsEmpty', async () => {
    // UT-PERSIST-CONFIG-10 data-model-persistence.md 11 節：今は何も見つけない仮の実装
    expect(await NullStorageLocationDetector.detectCandidates()).toEqual([]);
  });
});
