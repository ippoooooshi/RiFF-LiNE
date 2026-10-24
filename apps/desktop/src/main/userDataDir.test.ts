// UT-FS-USERDATA: data-model-persistence.md 11 節 — アプリの領域（userData）のフォルダの名前（本人決定 2026-10-22）
// 検証節: data-model-persistence.md 11 節
// 検証観点: 配布したアプリと開発で動かすときでフォルダを分けること・製品名との一致・userData を使う前に決めること・
// 起動の引数 --user-data-dir があれば setPath しないこと（C0/C1）。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILDER_CONFIG_FILE, distSettingsFromConfig } from '../../scripts/run-app.mjs';
import {
  applyUserDataPath,
  DEV_USER_DATA_DIR_NAME,
  PACKAGED_USER_DATA_DIR_NAME,
  userDataDirName,
  userDataPath,
  userDataPathToSet,
} from './userDataDir';

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
    // UT-FS-USERDATA-04 11 節。setPath より前に userData を読むと、開発のときに前のフォルダ（@riff-line/desktop）を使ってしまう。
    // 起動の引数 --user-data-dir を見てから setPath する（UT-FS-USERDATA-05・06）。
    // 判断は applyUserDataPath に出し、入口の main.ts は呼ぶだけにする（web-core-foundation.md 14.7 節）
    const main = readFileSync(join(desktopDir, 'src', 'main', 'main.ts'), 'utf8');
    const setAt = main.indexOf('applyUserDataPath(app);');
    expect(setAt).toBeGreaterThan(0);
    expect(main.match(/applyUserDataPath\(/g)).toHaveLength(1);
    expect(main).not.toMatch(/\.setPath\(/);
    expect(setAt).toBeLessThan(main.indexOf("app.getPath('userData')"));
    expect(setAt).toBeLessThan(main.indexOf('runWithSingleInstanceLock(app'));
    expect(main.indexOf('app.whenReady()')).toBeGreaterThan(setAt);
  });

  it('userDataPathToSet_起動の引数があればsetPathしない', () => {
    // UT-FS-USERDATA-05 11 節「起動の引数 --user-data-dir があれば、そのフォルダを使う（確かめのため）」。
    // Electron では setPath が起動の引数より強いので、引数があるときは null を返して setPath させない
    const appData = join('C:', 'Users', 'u', 'AppData', 'Roaming');
    expect(userDataPathToSet(appData, true, '')).toBe(join(appData, 'RiFF-LiNE'));
    expect(userDataPathToSet(appData, false, '')).toBe(join(appData, 'RiFF-LiNE-dev'));
    expect(userDataPathToSet(appData, true, join('C:', 'scratch', 'ud'))).toBeNull();
    expect(userDataPathToSet(appData, false, join('C:', 'scratch', 'ud'))).toBeNull();
    expect(userDataPathToSet(appData, true, '   ')).toBe(join(appData, 'RiFF-LiNE'));
  });

  it('applyUserDataPath_引数が無ければsetPath_あればsetPathしない', () => {
    // UT-FS-USERDATA-06 11 節。UT-FS-USERDATA-05 の判断で app.setPath('userData', …) を呼ぶか決める（web-core-foundation.md 14.7 節で入口から出した）
    const appData = join('C:', 'Users', 'u', 'AppData', 'Roaming');
    const fakeApp = (isPackaged: boolean, userDataDirSwitch: string) => {
      const setPaths: [string, string][] = [];
      const asked: string[] = [];
      return {
        setPaths,
        asked,
        isPackaged,
        commandLine: {
          getSwitchValue: (name: string) => {
            asked.push(name);
            return userDataDirSwitch;
          },
        },
        getPath: (name: 'appData') => {
          asked.push(name);
          return appData;
        },
        setPath: (name: 'userData', path: string) => void setPaths.push([name, path]),
      };
    };
    const dev = fakeApp(false, '');
    applyUserDataPath(dev);
    expect(dev.setPaths).toEqual([['userData', join(appData, 'RiFF-LiNE-dev')]]);
    expect(dev.asked).toEqual(['appData', 'user-data-dir']);
    const packaged = fakeApp(true, '');
    applyUserDataPath(packaged);
    expect(packaged.setPaths).toEqual([['userData', join(appData, 'RiFF-LiNE')]]);
    const withSwitch = fakeApp(true, join('C:', 'scratch', 'ud'));
    applyUserDataPath(withSwitch);
    expect(withSwitch.setPaths).toEqual([]);
  });
});
