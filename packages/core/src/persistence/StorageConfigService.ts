/**
 * 保存先の設定（主ストレージとミラー先）の読み書きと確かめ（data-model-persistence.md 11 節・13 節・14.2 節）。
 *
 * 実体は保存先のルート（`.../TabApp`）の `settings.json`（data-model-persistence.md 13.1 節）。
 * ゴミ箱の保持期間はここに持たず、`preferences.json`（13.3 節、`AppPreferencesService`）に持つ。
 */

import type { FileSystemAdapter } from '../platform';

import { STORAGE_SETTINGS_FILE } from './constants';
import { readJsonFile, writeJsonFile } from './jsonIo';

// data-model-persistence.md 11 節：保存先の種別は local・icloud・gdrive・custom の 4 つで、ローカル・iCloud Drive・Google Drive を選べる <!-- req datamodelpersistence:96f83bf3.43e4 --> <!-- req datamodelpersistence:96f83bf3.5526 --> <!-- req datamodelpersistence:96f83bf3.918c --> <!-- req datamodelpersistence:96f83bf3.c0b6 --> <!-- req datamodelpersistence:96f83bf3.4d28 --> <!-- req datamodelpersistence:11bfdb8f.a04f --> <!-- req datamodelpersistence:11bfdb8f.55d8 --> <!-- req datamodelpersistence:11bfdb8f.fe2f --> <!-- req datamodelpersistence:a827d2fd.1c9d -->
/** 保存先の種別（data-model-persistence.md 11 節）。 */
export type StorageType = 'local' | 'icloud' | 'gdrive' | 'custom';

const STORAGE_TYPES: ReadonlySet<string> = new Set<StorageType>(['local', 'icloud', 'gdrive', 'custom']);

// data-model-persistence.md 11 節：保存先はどの種類も 1 つのフォルダのパス（root）と種別（type）だけで表し、種類の違いは type にだけ出す <!-- req datamodelpersistence:6a38014f.4fe9 --> <!-- req datamodelpersistence:8fb02f45.9a06 --> <!-- req datamodelpersistence:b193e875.5f89 --> <!-- req datamodelpersistence:a827d2fd.dc3d --> <!-- req datamodelpersistence:a827d2fd.cd7d --> <!-- req datamodelpersistence:a827d2fd.e26b --> <!-- req datamodelpersistence:a827d2fd.8620 --> <!-- req datamodelpersistence:a827d2fd.964d -->
/** 保存先 1 つ（data-model-persistence.md 11 節）。 */
export interface StorageLocation {
  /** 選んだフォルダの絶対パス。この下に TabApp/ を作る。 */
  root: string;
  type: StorageType;
}

// data-model-persistence.md 11 節：保存先の設定は StorageSettings の型で持ち、主ストレージ 1 つとミラー先 0 個以上だけを持つ（ゴミ箱の保持期間は持たない） <!-- req datamodelpersistence:b827fe5d.edad --> <!-- req datamodelpersistence:b956412f.6a27 --> <!-- req datamodelpersistence:cfa5fa33.9620 --> <!-- req datamodelpersistence:25e46b1d.3f01 --> <!-- req datamodelpersistence:9d624964.9975 --> <!-- req datamodelpersistence:11bfdb8f.843c --> <!-- req datamodelpersistence:7697ee9c.c487 --> <!-- req datamodelpersistence:7697ee9c.7e87 --> <!-- req datamodelpersistence:1d867737.9e76 -->
/** 保存先の設定（data-model-persistence.md 11 節）。 */
export interface StorageSettings {
  /** 主ストレージ。アプリが曲を実際に読み書きするフォルダで、1 つだけ決める。 */
  storageLocation: StorageLocation;
  /** ミラー先。0 個以上（14 節）。 */
  mirrorLocations: StorageLocation[];
}

/**
 * ミラーの組み合わせの確かめの結果（data-model-persistence.md 14.2 節）。
 * `errors` と `infos` にはエラーコードの文字列（`'FILE-009'` の形）を入れ、呼ぶ側が `NotificationCenter.report` に渡す。
 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  infos: string[];
}

// data-model-persistence.md 11 節：同期フォルダの候補を探す処理は StorageLocationDetector.detectCandidates で、種類の違いは候補の見つけ方に出る <!-- req datamodelpersistence:c8a754a4.03d2 --> <!-- req datamodelpersistence:a827d2fd.fa7f -->
/** 同期フォルダの候補を探す（data-model-persistence.md 11 節。本物の実装はまだ無い）。 <!-- req datamodelpersistence:c48526b7.c2c5 --> <!-- req datamodelpersistence:c48526b7.46ee --> <!-- req datamodelpersistence:c48526b7.d7a4 --> <!-- req datamodelpersistence:c48526b7.bce8 --> <!-- req datamodelpersistence:c8a754a4.b5d8 --> <!-- req datamodelpersistence:c8a754a4.2094 --> <!-- req datamodelpersistence:0354cb15.e523 --> <!-- req datamodelpersistence:0354cb15.9505 --> <!-- req datamodelpersistence:0354cb15.0f1d --> <!-- req datamodelpersistence:0354cb15.e5fa --> <!-- req datamodelpersistence:0354cb15.bfc3 --> */
export interface StorageLocationDetector {
  detectCandidates(): Promise<{ type: 'icloud' | 'gdrive'; path: string }[]>;
}

/** 何も見つけない仮の実装（data-model-persistence.md 11 節の `NullStorageLocationDetector`）。 */
export const NullStorageLocationDetector: StorageLocationDetector = {
  detectCandidates: () => Promise.resolve([]),
};

/** 同じフォルダかを比べるための形（data-model-persistence.md 14.2 節の (b)：末尾の区切りを除き、大文字と小文字を区別しない）。 */
function normalizeRoot(root: string): string {
  return root.replace(/[\\/]+$/, '').toLowerCase();
}

/** 読んだ値が `StorageLocation` の形か（ファイルは手で書き換えられるので、型を信じない）。 */
function isStorageLocation(value: unknown): value is StorageLocation {
  if (typeof value !== 'object' || value === null) return false;
  const { root, type } = value as { root?: unknown; type?: unknown };
  return typeof root === 'string' && typeof type === 'string' && STORAGE_TYPES.has(type);
}

/** 2 つの種別が iCloud Drive と Google Drive の組か（順は問わない）。 */
function isICloudAndGoogleDrive(a: StorageType, b: StorageType): boolean {
  return (a === 'icloud' && b === 'gdrive') || (a === 'gdrive' && b === 'icloud');
}

export class StorageConfigService {
  /**
   * @param adapter 保存先のルート（`.../TabApp`）を指すアダプタ。
   * @param defaultPrimaryRoot `settings.json` が無いときの主ストレージ（その PC のアプリの領域）。
   */
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly defaultPrimaryRoot: string,
  ) {}

  // data-model-persistence.md 11 節：settings.json が無いときの主ストレージの既定はローカルで、その PC のアプリの領域とし、ミラー先は 0 個 <!-- req datamodelpersistence:7697ee9c.d51c -->
  private defaults(): StorageSettings {
    return { storageLocation: { root: this.defaultPrimaryRoot, type: 'local' }, mirrorLocations: [] };
  }

  // data-model-persistence.md 13 節：保存先の設定の置き場所は settings.json（読む） <!-- req datamodelpersistence:b827fe5d.e6d1 -->
  /** `settings.json` を読む。無い項目・形の違う項目は既定で補い、形の違うミラー先は落とす。 */
  async load(): Promise<StorageSettings> {
    const fallback = this.defaults();
    const loaded = await readJsonFile<unknown>(this.adapter, STORAGE_SETTINGS_FILE, fallback);
    const raw = (typeof loaded === 'object' && loaded !== null ? loaded : {}) as {
      storageLocation?: unknown;
      mirrorLocations?: unknown;
    };
    return {
      storageLocation: isStorageLocation(raw.storageLocation)
        ? { root: raw.storageLocation.root, type: raw.storageLocation.type }
        : fallback.storageLocation,
      mirrorLocations: Array.isArray(raw.mirrorLocations)
        ? raw.mirrorLocations.filter(isStorageLocation).map(({ root, type }) => ({ root, type }))
        : fallback.mirrorLocations,
    };
  }

  // data-model-persistence.md 13 節：保存先の設定の置き場所は settings.json（書く）
  async save(settings: StorageSettings): Promise<void> {
    await writeJsonFile(this.adapter, STORAGE_SETTINGS_FILE, {
      storageLocation: settings.storageLocation,
      mirrorLocations: settings.mirrorLocations,
    });
  }

  /**
   * ミラーの組み合わせを確かめる（data-model-persistence.md 14.2 節）。例外を投げず、結果を返す。
   * - 同じフォルダを 2 回選んだ（主とミラー先、ミラー先どうし）→ `errors` に `FILE-009`
   * - iCloud Drive 用と Google Drive 用に同じパスを選んだ → `errors` に `FILE-010`
   * - 主＝iCloud Drive＋ミラー＝Google Drive（冗長、止めない）→ `infos` に `FILE-011`
   * 同じコードは 1 回だけ入れる。
   */
  validateMirrorConfig(settings: StorageSettings): ValidationResult {
    const errors = new Set<string>();
    const infos = new Set<string>();
    const locations = [settings.storageLocation, ...settings.mirrorLocations];

    // 2 つずつ、すべての組を比べる（主とミラー先の組と、ミラー先どうしの組）。
    locations.forEach((a, index) => {
      for (const b of locations.slice(index + 1)) {
        if (normalizeRoot(a.root) !== normalizeRoot(b.root)) continue;
        errors.add('FILE-009');
        if (isICloudAndGoogleDrive(a.type, b.type)) errors.add('FILE-010');
      }
    });

    if (
      settings.storageLocation.type === 'icloud' &&
      settings.mirrorLocations.some((mirror) => mirror.type === 'gdrive')
    ) {
      infos.add('FILE-011');
    }

    return { ok: errors.size === 0, errors: [...errors], infos: [...infos] };
  }
}
