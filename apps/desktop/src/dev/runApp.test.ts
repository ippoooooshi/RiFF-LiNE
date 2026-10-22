// UT-DEV-RUNAPP: web-core-foundation.md 5.3 節 — 起動の口 apps/desktop/scripts/run-app.mjs の判断の関数と、
// 検証節: web-core-foundation.md 5.3 節
// main の開発者ツールを開く判断（apps/desktop/src/main/devTools.ts）
// 検証観点: どの形で起動するか・install が要るか・Electron を直すか・Node.js の版が合うか・ログの場所（C0/C1）。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEBUG_ENV,
  BUILDER_CONFIG_FILE,
  LOCK_RECORD_FILE,
  LOG_TARGETS,
  MENU_TIMEOUT_MS,
  MODES,
  USER_DATA_DIR_NAMES,
  checkNodeVersion,
  distPaths,
  distSettingsFromConfig,
  logTailLaunch,
  logTailScript,
  logTargetFromKey,
  logsDirFor,
  majorOf,
  modeFromKey,
  needsElectronRebuild,
  needsInstall,
  parseArgs,
  pnpmCommand,
  sha256,
  stepsFor,
  todayLogFileName,
  userDataDir,
} from '../../scripts/run-app.mjs';
import { DEBUG_ENV_NAME, shouldOpenDevTools } from '../main/devTools';
import { DEV_USER_DATA_DIR_NAME, PACKAGED_USER_DATA_DIR_NAME } from '../main/userDataDir';

/** apps/desktop の場所。 */
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('run-app.mjs：起動の形', () => {
  it('parseArgs_引数なし_一覧を出す', () => {
    // UT-DEV-RUNAPP-01 5.3 節「引数なしで開くと番号の一覧を日本語で出し」
    expect(parseArgs([])).toEqual({ kind: 'menu' });
    expect(parseArgs([''])).toEqual({ kind: 'menu' });
  });

  it('parseArgs_5つの引数_一覧を出さずにその形', () => {
    // UT-DEV-RUNAPP-02 5.3 節「引数（dev・debug・prod・logs）を付けると、一覧を出さずにその形で起動する」・
    // 5.3 節「配布と同じ形…は、8.4 節の配布の設定を書く区切りで、5 番（引数 dist）として足す」（turn 177）
    expect(MODES).toEqual(['dev', 'debug', 'prod', 'logs', 'dist']);
    for (const mode of MODES) expect(parseArgs([mode])).toEqual({ kind: 'mode', mode });
    expect(parseArgs(['DEBUG'])).toEqual({ kind: 'mode', mode: 'debug' });
  });

  it('parseArgs_知らない引数_使える引数を挙げて断る', () => {
    // UT-DEV-RUNAPP-03
    const result = parseArgs(['xyz']);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toContain('xyz');
    expect(result.message).toContain('dev・debug・prod・logs・dist');
  });

  it('modeFromKey_番号とEnter_形を返しほかは待ち続ける', () => {
    // UT-DEV-RUNAPP-04 5.3 節の表の番号 1〜4 と 5 番（dist）
    expect(modeFromKey('1')).toBe('dev');
    expect(modeFromKey('2')).toBe('debug');
    expect(modeFromKey('3')).toBe('prod');
    expect(modeFromKey('4')).toBe('logs');
    expect(modeFromKey('5')).toBe('dist');
    expect(modeFromKey('\r')).toBe('dev');
    expect(modeFromKey('0')).toBeNull();
    expect(modeFromKey('6')).toBeNull();
    expect(modeFromKey('a')).toBeNull();
  });

  it('一覧の待ち時間_3秒で1番', () => {
    // UT-DEV-RUNAPP-05 5.3 節「3 秒のあいだ何も押さなければ 1 で起動する」
    expect(MENU_TIMEOUT_MS).toBe(3000);
    expect(MODES[0]).toBe('dev');
  });

  it('stepsFor_dev_開発の起動だけ', () => {
    // UT-DEV-RUNAPP-06 5.3 節の表 1 番
    expect(stepsFor('dev', 'pnpm')).toEqual([
      { title: expect.any(String), command: 'pnpm --filter @riff-line/desktop run dev', debugEnv: false },
    ]);
  });

  it('stepsFor_debug_inspectと開発者ツールの環境変数', () => {
    // UT-DEV-RUNAPP-07 5.3 節の表 2 番「--inspect」・「開発者ツールを別の窓で開き」
    const steps = stepsFor('debug', 'pnpm');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.command).toBe('pnpm --filter @riff-line/desktop run dev --inspect');
    expect(steps[0]?.debugEnv).toBe(true);
  });

  it('stepsFor_prod_ビルドしてからビルドしたもので起動し開発者ツールは開かない', () => {
    // UT-DEV-RUNAPP-08 5.3 節の表 3 番
    const steps = stepsFor('prod', 'corepack pnpm');
    expect(steps.map((s) => s.command)).toEqual([
      'corepack pnpm --filter @riff-line/desktop run build',
      'corepack pnpm --filter @riff-line/desktop exec electron-vite preview --skipBuild',
    ]);
    expect(steps.every((s) => !s.debugEnv)).toBe(true);
  });

  it('stepsFor_logs_コマンドを打たない', () => {
    // UT-DEV-RUNAPP-09 5.3 節の表 4 番（フォルダを開くだけ）
    expect(stepsFor('logs', 'pnpm')).toEqual([]);
    expect(() => stepsFor('xyz', 'pnpm')).toThrow();
  });

  it('stepsFor_dist_配布用のパッケージを作ってからその中の実行ファイルで起動し開発者ツールは開かない', () => {
    // UT-DEV-RUNAPP-27 5.3 節「配布と同じ形（Electron Builder で作ったパッケージをそのまま起動する形）は…5 番（引数 dist）」・8.4 節
    const steps = stepsFor('dist', 'pnpm', 'D:/x/release/win-unpacked/RiFF-LiNE.exe');
    expect(steps.map((s) => s.command)).toEqual([
      'pnpm --filter @riff-line/desktop run dist',
      '"D:/x/release/win-unpacked/RiFF-LiNE.exe"',
    ]);
    expect(steps.every((s) => !s.debugEnv)).toBe(true);
  });

  it('distPaths_成果物の置き場所と製品名をelectron-builderの設定ファイルから読む', () => {
    // UT-DEV-RUNAPP-28 8.4 節「パッケージング、インストーラの生成、成果物の置き場所は、すべてその設定ファイルに書く」（turn 177 の照合で、
    // run-app.mjs と check-license-files.mjs が release/win-unpacked を直に持っていた）
    const config = readFileSync(join(desktopDir, BUILDER_CONFIG_FILE), 'utf8');
    expect(distSettingsFromConfig(config)).toEqual({ productName: 'RiFF-LiNE', output: 'release' });
    expect(distPaths(desktopDir, config)).toEqual({
      dir: join(desktopDir, 'release', 'win-unpacked'),
      exe: join(desktopDir, 'release', 'win-unpacked', 'RiFF-LiNE.exe'),
    });
    const other = 'productName: X\ndirectories:\n  # 注\n  output: out\n';
    expect(distPaths('D:/d', other)).toEqual({
      dir: join('D:/d', 'out', 'win-unpacked'),
      exe: join('D:/d', 'out', 'win-unpacked', 'X.exe'),
    });
    expect(distSettingsFromConfig('productName: X\n')).toBeNull();
    for (const f of ['run-app.mjs', 'check-license-files.mjs'])
      expect(readFileSync(join(desktopDir, 'scripts', f), 'utf8')).not.toMatch(/'release'|release\/win-unpacked/);
  });

  it('run-app.cmdとrun-app.mjsの使い方の注_起動の形を全部挙げる', () => {
    // UT-DEV-RUNAPP-30 5.3 節の表。形を足したときに使い方の注が古いまま残らないように（turn 177 に run-app.cmd の注が 4 つのままだった）
    const cmd = readFileSync(join(desktopDir, '..', '..', 'run-app.cmd'), 'utf8');
    const mjs = readFileSync(join(desktopDir, 'scripts', 'run-app.mjs'), 'utf8');
    expect(cmd).toContain(`run-app.cmd ${MODES.join('|')}`);
    expect(cmd).toContain(MODES.map((m, i) => `${i + 1} ${m}`).join(' / '));
    expect(mjs).toContain(`run-app.cmd [${MODES.join('|')}]`);
  });

  it('package.json_distは組み立ての後にelectron-builderを打ち表示義務のファイルを確かめる', () => {
    // UT-DEV-RUNAPP-29 8.4 節「apps/desktop/package.json の scripts だけで完結させる」・8.3 節「配布用のパッケージを作った後に…確かめる」
    const pkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dist']).toBe('pnpm run build && electron-builder --win --publish never');
    expect(pkg.scripts['postdist']).toBe('node scripts/check-license-files.mjs');
  });
});

describe('run-app.mjs：起動の前の確かめ', () => {
  it('checkNodeVersion_大きい番号が合えば通す', () => {
    // UT-DEV-RUNAPP-10 5.3 節「Node.js の版の大きい番号が .nvmrc と合わなければ」
    expect(checkNodeVersion('v24.13.0', '24\n')).toEqual({ ok: true });
    expect(checkNodeVersion('v24.1.0', 'v24.13')).toEqual({ ok: true });
    expect(majorOf('v22.3.0')).toBe(22);
    expect(majorOf('lts')).toBeNull();
  });

  it('checkNodeVersion_合わなければ直し方を日本語で出す', () => {
    // UT-DEV-RUNAPP-11 5.3 節「そのことと直し方を日本語で出して止まる」
    const result = checkNodeVersion('v22.3.0', '24');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('v22.3.0');
    expect(result.message).toContain('Node.js 24 系を入れて');
    expect(checkNodeVersion('v24.0.0', '').ok).toBe(false);
  });

  it('needsInstall_lockfileのSHA256が記録と同じなら通り抜ける', () => {
    // UT-DEV-RUNAPP-12 5.3 節「pnpm-lock.yaml の中身の SHA-256 が、前に install したときの記録と違えば」
    const lockHash = sha256('lockfileVersion: 9.0\n');
    expect(needsInstall({ hasNodeModules: true, lockHash, recordedHash: `${lockHash}\n` })).toBe(false);
    expect(needsInstall({ hasNodeModules: true, lockHash, recordedHash: sha256('old') })).toBe(true);
    expect(needsInstall({ hasNodeModules: true, lockHash, recordedHash: null })).toBe(true);
    expect(needsInstall({ hasNodeModules: false, lockHash, recordedHash: lockHash })).toBe(true);
    expect(LOCK_RECORD_FILE).toBe('.run-app-lock');
  });

  it('sha256_既知の値', () => {
    // UT-DEV-RUNAPP-13
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('needsElectronRebuild_実行ファイルが無いときだけ直す', () => {
    // UT-DEV-RUNAPP-14 5.3 節「Electron の実行ファイルが無ければ、pnpm rebuild electron を打つ」
    expect(needsElectronRebuild({ pathTxt: 'electron.exe', binaryExists: true })).toBe(false);
    expect(needsElectronRebuild({ pathTxt: 'electron.exe', binaryExists: false })).toBe(true);
    expect(needsElectronRebuild({ pathTxt: null, binaryExists: false })).toBe(true);
    expect(needsElectronRebuild({ pathTxt: '  ', binaryExists: true })).toBe(true);
  });

  it('pnpmCommand_pnpmが無ければcorepackを通す', () => {
    // UT-DEV-RUNAPP-15 5.3 節「pnpm が見つからなければ corepack pnpm を使う」
    expect(pnpmCommand(true)).toBe('pnpm');
    expect(pnpmCommand(false)).toBe('corepack pnpm');
  });
});

describe('run-app.mjs：ログの場所', () => {
  const appData = join('C:', 'Users', 'u', 'AppData', 'Roaming');

  it('userDataDir_開発のときと配布したアプリでフォルダを分ける', () => {
    // UT-DEV-RUNAPP-31 5.3 節の表 4 番「開発のときのログ（RiFF-LiNE-dev）と配布したアプリのログ（RiFF-LiNE）」・
    // data-model-persistence.md 11 節（本人決定 2026-10-22）。UT-DEV-RUNAPP-16（package.json の name から引いていた）を置き換えた
    expect(userDataDir(appData, 'dev')).toBe(join(appData, 'RiFF-LiNE-dev'));
    expect(userDataDir(appData, 'dist')).toBe(join(appData, 'RiFF-LiNE'));
    expect(() => userDataDir(appData, 'xyz')).toThrow();
  });

  it('フォルダの名前_run-app.mjsとmainで同じ', () => {
    // UT-DEV-RUNAPP-32 名前を run-app.mjs と main（userDataDir.ts）の 2 か所に持つので、食い違いをここで止める
    expect(USER_DATA_DIR_NAMES).toEqual({ dev: DEV_USER_DATA_DIR_NAME, dist: PACKAGED_USER_DATA_DIR_NAME });
  });

  it('parseArgs_logsの後の引数_開くログを決める', () => {
    // UT-DEV-RUNAPP-33 5.3 節の表 4 番「引数は logs dev・logs dist」
    expect(parseArgs(['logs', 'dev'])).toEqual({ kind: 'mode', mode: 'logs', logTarget: 'dev' });
    expect(parseArgs(['LOGS', 'Dist'])).toEqual({ kind: 'mode', mode: 'logs', logTarget: 'dist' });
    expect(parseArgs(['logs'])).toEqual({ kind: 'mode', mode: 'logs' });
    const result = parseArgs(['logs', 'xyz']);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toContain('xyz');
    expect(result.message).toContain('dev・dist');
  });

  it('logTargetFromKey_番号とEnter_開くログを返し3秒で開発のとき', () => {
    // UT-DEV-RUNAPP-34 5.3 節の表 4 番「どちらを開くかを番号で選ぶ（3 秒のあいだ何も押さなければ開発のとき）」
    expect(LOG_TARGETS).toEqual(['dev', 'dist']);
    expect(logTargetFromKey('1')).toBe('dev');
    expect(logTargetFromKey('2')).toBe('dist');
    expect(logTargetFromKey('\r')).toBe('dev');
    expect(logTargetFromKey('3')).toBeNull();
    expect(logTargetFromKey('a')).toBeNull();
    expect(MENU_TIMEOUT_MS).toBe(3000);
  });

  it('logsDirFor_保存先の記録が無ければ既定の場所', () => {
    // UT-DEV-RUNAPP-17 5.3 節の表 4 番「場所は data-model-persistence.md の保存先の決まりから引く」
    const userData = join(appData, '@riff-line', 'desktop');
    expect(logsDirFor(userData, null)).toEqual({ dir: join(userData, 'TabApp', 'logs'), fromPointer: false });
    expect(logsDirFor(userData, 'not json')).toEqual({ dir: join(userData, 'TabApp', 'logs'), fromPointer: false });
  });

  it('logsDirFor_保存先の記録があればその下', () => {
    // UT-DEV-RUNAPP-18
    const userData = join(appData, '@riff-line', 'desktop');
    const root = join('D:', 'Drive');
    const pointer = JSON.stringify({ rootAbsolutePath: root, storageType: 'custom' });
    expect(logsDirFor(userData, pointer)).toEqual({ dir: join(root, 'TabApp', 'logs'), fromPointer: true });
  });

  it('todayLogFileName_ローカルの日付', () => {
    // UT-DEV-RUNAPP-19 5.3 節の表 2 番「その日のログ（logs/app-YYYYMMDD.log）」
    expect(todayLogFileName(new Date(2026, 0, 5, 23, 59))).toBe('app-20260105.log');
    expect(todayLogFileName(new Date(2026, 9, 21, 0, 0))).toBe('app-20261021.log');
  });

  it('logTailScript_ファイルの名前の引用符を逃がし流し続ける', () => {
    // UT-DEV-RUNAPP-20 5.3 節の表 2 番「流し続ける窓」
    const script = logTailScript("C:\\it's\\app-20261021.log");
    expect(script).toContain("$f = 'C:\\it''s\\app-20261021.log'");
    expect(script).toContain('Get-Content -LiteralPath $f -Wait');
    expect(script).toContain('待っています');
  });

  it('logTailLaunch_cmdのstartで新しい窓を開きPowerShellに文を渡す', () => {
    // UT-DEV-RUNAPP-23 5.3 節の表 2 番「流し続ける窓を別に開く」（detached では窓が開かなかった、turn 174）
    const script = logTailScript('C:\\logs\\app-20261021.log');
    const { file, args } = logTailLaunch(script);
    expect(file).toBe('cmd.exe');
    const line = args.at(-1) ?? '';
    expect(line.startsWith('start "RiFF-LiNE log" powershell.exe -NoExit -NoProfile -EncodedCommand ')).toBe(true);
    const encoded = line.split(' ').at(-1) ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script);
  });
});

describe('起動の口のファイル', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

  it('run-app.cmd_英数字だけでrun-app.mjsを呼ぶだけ', () => {
    // UT-DEV-RUNAPP-24 5.3 節「run-app.cmd は Node.js を見つけて apps/desktop/scripts/run-app.mjs を呼ぶだけ」。
    // 日本語を入れると chcp 65001 のあとの読み込みがずれて rem の行がコマンドとして動いた（turn 174）ので、英数字だけにする
    const text = readFileSync(join(repoRoot, 'run-app.cmd'), 'utf8');
    expect([...text].filter((c) => c.charCodeAt(0) > 0x7e)).toEqual([]);
    expect(text).toContain('node "%~dp0apps\\desktop\\scripts\\run-app.mjs" %*');
    expect(text).not.toMatch(/pnpm|electron-vite/);
  });

  it('直下のpackage.json_起動の別名を置かない', () => {
    // UT-DEV-RUNAPP-25 5.3 節「直下の package.json に起動の別名（dev など）を置かない」
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts)).not.toContain('dev');
    expect(
      Object.values(pkg.scripts).some((s) => /electron-vite|--filter @riff-line\/desktop (run )?(dev|start)/.test(s)),
    ).toBe(false);
  });

  it('apps/desktopのpackage.json_run-app.mjsが使うdevとbuildのほかに起動の別名を置かない', () => {
    // UT-DEV-RUNAPP-26 5.3 節「ほかに起動用のスクリプトを作らず」。run-app.mjs を通らない start（electron-vite preview）が
    // 残っていた（turn 175 の照合）ので、起動に使う electron-vite の別名は run-app.mjs が呼ぶ dev と build だけにする
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const launchers = Object.entries(pkg.scripts)
      .filter(([, s]) => /electron-vite|electron\s/.test(s))
      .map(([name]) => name)
      .sort();
    expect(launchers).toEqual(['build', 'dev']);
  });
});

describe('main：開発者ツールを開く判断', () => {
  it('shouldOpenDevTools_配布していないうえに環境変数があるときだけ開く', () => {
    // UT-DEV-RUNAPP-21 5.3 節「app.isPackaged が false で、run-app.mjs が渡す環境変数（RIFFLINE_DEBUG=1）があるときだけ」
    expect(shouldOpenDevTools(false, { RIFFLINE_DEBUG: '1' })).toBe(true);
    expect(shouldOpenDevTools(true, { RIFFLINE_DEBUG: '1' })).toBe(false);
    expect(shouldOpenDevTools(false, {})).toBe(false);
    expect(shouldOpenDevTools(false, { RIFFLINE_DEBUG: '0' })).toBe(false);
  });

  it('環境変数の名前_run-app.mjsとmainで同じ', () => {
    // UT-DEV-RUNAPP-22 名前を 2 か所に持つので、食い違いをここで止める
    expect(DEBUG_ENV).toBe(DEBUG_ENV_NAME);
    expect(DEBUG_ENV_NAME).toBe('RIFFLINE_DEBUG');
  });
});
