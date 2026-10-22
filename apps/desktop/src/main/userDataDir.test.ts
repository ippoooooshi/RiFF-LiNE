// UT-FS-USERDATA: data-model-persistence.md §11 — アプリの領域（userData）のフォルダの名前（本人決定 2026-10-22）
// 検証観点: 配布したアプリと開発で動かすときでフォルダを分けること・製品名との一致・userData を使う前に決めること（C0/C1）。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILDER_CONFIG_FILE, distSettingsFromConfig } from '../../scripts/run-app.mjs';
import { DEV_USER_DATA_DIR_NAME, PACKAGED_USER_DATA_DIR_NAME, userDataDirName, userDataPath } from './userDataDir';

/** apps/desktop の場所。 */
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('userDataDir', () => {
  it('userDataDirName_配布したアプリは製品名_開発はdevを付ける', () => {
    // UT-FS-USERDATA-01 11 節「配布したアプリ（app.isPackaged が true）では製品名の RiFF-LiNE、開発で動かすとき（false）は RiFF-LiNE-dev」
    expect(userDataDirName(true)).toBe('RiFF-LiNE');
    expect(userDataDirName(false)).toBe('RiFF-LiNE-dev');
    expect(PACKAGED_USER_DATA_DIR_NAME).not.toBe(DEV_USER_DATA_DIR_NAME);
  });

  it('userDataPath_appDataの下に名前のフォルダ', () => {
    // UT-FS-USERDATA-02 11 節「アプリの領域（app.getPath('userData')）のフォルダの名前」
    const appData = join('C:', 'Users', 'u', 'AppData', 'Roaming');
    expect(userDataPath(appData, true)).toBe(join(appData, 'RiFF-LiNE'));
    expect(userDataPath(appData, false)).toBe(join(appData, 'RiFF-LiNE-dev'));
  });

  it('配布したアプリの名前_electron-builderの製品名と同じ', () => {
    // UT-FS-USERDATA-03 11 節「製品名の RiFF-LiNE」。製品名を electron-builder.yml と 2 か所に持つので、食い違いをここで止める
    const config = readFileSync(join(desktopDir, BUILDER_CONFIG_FILE), 'utf8');
    expect(distSettingsFromConfig(config)?.productName).toBe(PACKAGED_USER_DATA_DIR_NAME);
  });

  it('main_userDataを使う前にフォルダを決める', () => {
    // UT-FS-USERDATA-04 11 節。setPath より前に userData を読むと、開発のときに前のフォルダ（@riff-line/desktop）を使ってしまう
    const main = readFileSync(join(desktopDir, 'src', 'main', 'main.ts'), 'utf8');
    const setAt = main.indexOf("app.setPath('userData', userDataPath(app.getPath('appData'), app.isPackaged))");
    expect(setAt).toBeGreaterThan(0);
    expect(setAt).toBeLessThan(main.indexOf("app.getPath('userData')"));
    expect(setAt).toBeLessThan(main.indexOf('app.requestSingleInstanceLock()'));
    expect(main.indexOf('app.whenReady()')).toBeGreaterThan(setAt);
  });
});
