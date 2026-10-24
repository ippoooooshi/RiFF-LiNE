/**
 * 開発者ツールを開くかの判断（web-core-foundation.md 5.3 節）。
 *
 * 開くのは、配布したアプリでない（`app.isPackaged` が false）ときに、起動の口（apps/desktop/scripts/run-app.mjs）が
 * デバッグの形で渡す環境変数があるときだけ。配布したアプリでは開かない（6 節のセキュリティの既定値は変えない）。
 * 単体テストは apps/desktop/src/dev/runApp.test.ts（UT-DEV-RUNAPP）。
 */

// <!-- req webcorefoundation:cc4c9850.101e --> <!-- req webcorefoundation:cc4c9850.d5ad --> <!-- req webcorefoundation:cc4c9850.be24 --> <!-- req webcorefoundation:cc4c9850.38b4 -->
/** run-app.mjs の `DEBUG_ENV` と同じ名前（テストが一致を確かめる）。 */
export const DEBUG_ENV_NAME = 'RIFFLINE_DEBUG';

/**
 * @param isPackaged Electron の `app.isPackaged`
 * @param env `process.env`
 * @returns 開発者ツールを開くなら true
 */
export function shouldOpenDevTools(isPackaged: boolean, env: Readonly<Record<string, string | undefined>>): boolean {
  return !isPackaged && env[DEBUG_ENV_NAME] === '1';
}

/**
 * 開発者ツールを開くときだけ、別の窓で開く（入口の main.ts に分かれ道を置かないため。web-core-foundation.md 14.7 節）。
 * @param isPackaged Electron の `app.isPackaged`
 * @param env `process.env`
 * @param webContents 開くウィンドウの `webContents`
 */
export function openDevToolsIfDebug(
  isPackaged: boolean,
  env: Readonly<Record<string, string | undefined>>,
  webContents: { openDevTools(options: { mode: 'detach' }): void },
): void {
  if (shouldOpenDevTools(isPackaged, env)) webContents.openDevTools({ mode: 'detach' });
}
