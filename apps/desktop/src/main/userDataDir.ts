/**
 * アプリの領域（Electron の `app.getPath('userData')`）のフォルダの名前（data-model-persistence.md 11 節、本人決定 2026-10-22）。
 *
 * 配布したアプリ（`app.isPackaged` が true）は製品名の `RiFF-LiNE`、開発で動かすとき（false）は `RiFF-LiNE-dev` にする。
 * 開発のときの読み書きが、配布したアプリのデータに混ざらないようにするため。
 * 製品名は apps/desktop/electron-builder.yml の productName と同じ値で、起動の口（apps/desktop/scripts/run-app.mjs）の
 * 4 番が開くログの場所も同じ名前から引く。どちらとの一致も単体テスト（UT-FS-USERDATA）が確かめる。
 */

import { join } from 'node:path';

/** 配布したアプリのフォルダの名前（製品名）。dist（5.3 節の 5 番）で起動したアプリもこの名前を使う。 */
// <!-- req datamodelpersistence:7697ee9c.a1ed --> <!-- req webcorefoundation:e1c3b818.ca7c -->
// data-model-persistence.md 11 節：配布したアプリ（app.isPackaged が true）のアプリの領域のフォルダの名前は製品名の RiFF-LiNE <!-- req datamodelpersistence:7697ee9c.a1ed -->
export const PACKAGED_USER_DATA_DIR_NAME = 'RiFF-LiNE';

/** 開発で動かすときのフォルダの名前。 */
// <!-- req datamodelpersistence:7697ee9c.1e4e -->
// data-model-persistence.md 11 節：開発で動かすとき（app.isPackaged が false）は RiFF-LiNE-dev <!-- req datamodelpersistence:7697ee9c.1e4e -->
export const DEV_USER_DATA_DIR_NAME = 'RiFF-LiNE-dev';

/**
 * @param isPackaged Electron の `app.isPackaged`
 * @returns アプリの領域のフォルダの名前
 */
export function userDataDirName(isPackaged: boolean): string {
  return isPackaged ? PACKAGED_USER_DATA_DIR_NAME : DEV_USER_DATA_DIR_NAME;
}

/**
 * @param appDataDir Electron の `app.getPath('appData')`（Windows では `%APPDATA%`）
 * @param isPackaged Electron の `app.isPackaged`
 * @returns `app.setPath('userData', …)` に渡す場所
 */
// data-model-persistence.md 13.2 節：Windows ではローカル既定パスは %APPDATA%（app.getPath(appData)）の下になる <!-- req datamodelpersistence:fdc64d7d.8658 -->
export function userDataPath(appDataDir: string, isPackaged: boolean): string {
  return join(appDataDir, userDataDirName(isPackaged));
}

/**
 * 起動の引数 `--user-data-dir` があれば、名前で決めるフォルダを使わず、渡されたフォルダを使う（確かめのため）。
 * Electron では `app.setPath('userData', …)` が起動の引数より強いので、引数があるときは setPath しない。
 * 確かめのために配布用のパッケージを scratch のフォルダへ向けて起動したとき、本人のデータのフォルダに書かないようにするため。
 * @param appDataDir Electron の `app.getPath('appData')`
 * @param isPackaged Electron の `app.isPackaged`
 * @param userDataDirSwitch Electron の `app.commandLine.getSwitchValue('user-data-dir')`（無ければ空の文字列）
 * @returns `app.setPath('userData', …)` に渡す場所。引数があるときは null（setPath しない）
 */
// <!-- req datamodelpersistence:7697ee9c.ed35 -->
// data-model-persistence.md 11 節：起動の引数 --user-data-dir があれば、名前で決めるフォルダを使わず、渡されたフォルダを使う <!-- req datamodelpersistence:7697ee9c.ed35 -->
export function userDataPathToSet(appDataDir: string, isPackaged: boolean, userDataDirSwitch: string): string | null {
  return userDataDirSwitch.trim() === '' ? userDataPath(appDataDir, isPackaged) : null;
}

/** アプリの領域の場所を決めるのに使う `app` の部分。 */
export interface UserDataApp {
  readonly isPackaged: boolean;
  readonly commandLine: { getSwitchValue(name: string): string };
  getPath(name: 'appData'): string;
  setPath(name: 'userData', path: string): void;
}

/**
 * アプリの領域の場所を決めて `app.setPath('userData', …)` する。起動の引数 `--user-data-dir` があれば setPath しない。
 * userData を使う所より前に呼ぶ（入口の main.ts に分かれ道を置かないため。web-core-foundation.md 14.7 節）。
 * @param app Electron の `app`
 */
export function applyUserDataPath(app: UserDataApp): void {
  const userDataToSet = userDataPathToSet(
    app.getPath('appData'),
    app.isPackaged,
    app.commandLine.getSwitchValue('user-data-dir'),
  );
  if (userDataToSet !== null) app.setPath('userData', userDataToSet);
}
