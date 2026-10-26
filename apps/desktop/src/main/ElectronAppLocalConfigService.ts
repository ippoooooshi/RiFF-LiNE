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

import type { StorageRootPointer } from '@riff-line/shared-types';

/**
 * OS 標準アプリ設定フォルダ上の storage-pointer.json を読み書きする契約。
 * 使うのは main だけ（Webコアへ注入する 4 系統のアダプタではなく、IPC の型でもない）なので、実装と同じファイルに置く
 * （packages/shared-types には IPC の型とチャンネルの名前だけを置く、web-core-foundation.md 5.1 節）。
 * 初回起動時（ポインタ未作成）は readPointer() が null を返し、呼び出し元はローカル既定へフォールバックする。
 */
export interface AppLocalConfigService {
  readPointer(): Promise<StorageRootPointer | null>;
  writePointer(pointer: StorageRootPointer): Promise<void>;
}

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
    // data-model-persistence.md 11 節：主ストレージの既定の場所は、Electron がアプリごとに用意する app.getPath('userData') <!-- req datamodelpersistence:7697ee9c.aa26 -->
    const base = pointer?.rootAbsolutePath ?? this.userDataPath;
    // data-model-persistence.md 11 節：曲のファイルはその下の TabApp/ に入れ、ローカル既定パスの木のファイルと重ねない <!-- req datamodelpersistence:7697ee9c.1afd -->
    return join(base, TABAPP_DIR);
  }

  /** LocalBackupService 用の端末ローカル専用ルート（`{userData}/LocalBackup`）。 */
  getLocalBackupRoot(): string {
    return join(this.userDataPath, LOCAL_BACKUP_DIR);
  }
}
