/**
 * AppLocalConfigService の Electron 実装（data-model-persistence.md §3.4・§3.3.1）。
 *
 * OS 標準のアプリ設定フォルダ（`app.getPath('userData')`）配下の `storage-pointer.json` に、
 * 現在のアクティブストレージルートの絶対パスと種別だけを持つ。主ストレージが未確定な初回起動時も
 * 参照できるよう、ストレージ抽象（FileSystemAdapter）の外側に置く。
 * userData パスはコンストラクタで受け取る（electron 非依存・テスト容易性）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppLocalConfigService, StorageRootPointer } from '@riff-line/shared-types';

const POINTER_FILE = 'storage-pointer.json';
/** LocalBackupService 用の端末ローカル専用ルート名（B25）。 */
const LOCAL_BACKUP_DIR = 'LocalBackup';
/** 主ストレージ配下のアプリデータフォルダ名（06_file_io_persistence.md §3）。 */
const TABAPP_DIR = 'TabApp';

export class ElectronAppLocalConfigService implements AppLocalConfigService {
  /**
   * @param userDataPath `app.getPath('userData')` の値。
   */
  constructor(private readonly userDataPath: string) {}

  private get pointerPath(): string {
    return join(this.userDataPath, POINTER_FILE);
  }

  async readPointer(): Promise<StorageRootPointer | null> {
    try {
      const text = await readFile(this.pointerPath, 'utf-8');
      const parsed = JSON.parse(text) as Partial<StorageRootPointer>;
      if (typeof parsed.rootAbsolutePath === 'string' && typeof parsed.storageType === 'string') {
        return { rootAbsolutePath: parsed.rootAbsolutePath, storageType: parsed.storageType };
      }
      return null;
    } catch {
      // 初回起動（未作成）・破損いずれも「ポインタなし」として扱い、呼び出し元がローカル既定へフォールバックする。
      return null;
    }
  }

  async writePointer(pointer: StorageRootPointer): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true });
    await writeFile(this.pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf-8');
  }

  /**
   * 初回起動時の既定アクティブルート（`{userData}/TabApp`）、またはポインタ先の `{root}/TabApp`。
   * data-model-persistence.md §3.3.1 の `appconfig:getActiveRoot` に対応する。
   */
  async getActiveRoot(): Promise<string> {
    const pointer = await this.readPointer();
    const base = pointer?.rootAbsolutePath ?? this.userDataPath;
    return join(base, TABAPP_DIR);
  }

  /** LocalBackupService 用の端末ローカル専用ルート（`{userData}/LocalBackup`）。 */
  getLocalBackupRoot(): string {
    return join(this.userDataPath, LOCAL_BACKUP_DIR);
  }
}
