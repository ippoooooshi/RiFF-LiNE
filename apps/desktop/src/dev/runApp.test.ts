// UT-DEV-RUNAPP: web-core-foundation.md 5.3 節 — 起動の口 apps/desktop/scripts/run-app.mjs の判断の関数。
// 検証節: web-core-foundation.md 5.3 節 <!-- req webcorefoundation:c4200219.c25d --> <!-- req webcorefoundation:c4200219.9f04 --> <!-- req webcorefoundation:f5863a55.faea --> <!-- req webcorefoundation:f5863a55.a5dc -->
// main の開発者ツールを開く判断（apps/desktop/src/main/devTools.ts）は、対象と同じフォルダの entry.test.ts（UT-DEV-ENTRY-14〜16）で確かめる（14.2 節）
// 検証観点: どの形で起動するか・install が要るか・Electron を直すか・Node.js の版が合うか・ログの場所（C0/C1）。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
  defaultDeps,
  distPaths,
  distSettingsFromConfig,
  logTailLaunch,
  logTailScript,
  logTargetFromKey,
  logsDirFor,
  main,
  majorOf,
  modeFromKey,
  runEntry,
  needsElectronRebuild,
  needsInstall,
  parseArgs,
  pnpmCommand,
  sha256,
  stepsFor,
  todayLogFileName,
  userDataDir,
} from '../../scripts/run-app.mjs';
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

// ---------------------------------------------------------------------------
// 副作用のある手順（main）。子のプロセス・Electron の起動・ファイル・入出力は偽物を渡す（2026-10-24 チャット側の決定）
// ---------------------------------------------------------------------------

type Deps = Parameters<typeof main>[1];
type Result = { status: number | null; error?: Error };

interface FakeOptions {
  /** ファイルの名前（basename）→ 中身。undefined は「無い」 */
  files?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  tty?: boolean;
  /** 一覧ごとに、聞き始めたときに押すキー */
  keys?: string[][];
  status?: (command: string) => Result;
  electronDir?: () => string;
}

const appData = join('C:', 'AD');
const LOCK = 'lockfileVersion: 9.0\n';

function fake(o: FakeOptions = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const commands: { command: string; env: NodeJS.ProcessEnv | undefined }[] = [];
  const spawned: { file: string; args: readonly string[] }[] = [];
  const written: { path: string; data: string }[] = [];
  const sigint = { on: [] as (() => void)[], off: [] as (() => void)[] };
  const timers: (() => void)[] = [];
  const cleared: unknown[] = [];
  const stdinCalls: string[] = [];
  const prompts = [...(o.keys ?? [])];
  const files: Record<string, string | undefined> = {
    '.nvmrc': '24\n',
    'pnpm-lock.yaml': LOCK,
    [LOCK_RECORD_FILE]: `${sha256(LOCK)}\n`,
    'path.txt': 'electron.exe',
    ...o.files,
  };
  const deps = {
    spawnSync: (command: string, a?: unknown, b?: unknown) => {
      const args = Array.isArray(a) ? (a as string[]) : undefined;
      const opts = (args ? b : a) as { env?: NodeJS.ProcessEnv } | undefined;
      commands.push({ command: args ? `${command} ${args.join(' ')}` : command, env: opts?.env });
      return o.status?.(command) ?? { status: 0 };
    },
    spawn: (file: string, args: readonly string[]) => {
      spawned.push({ file, args });
      return { unref: () => stdinCalls.push('unref') };
    },
    readFileSync: (path: string) => {
      const text = files[basename(path)];
      if (text === undefined) throw new Error('ENOENT');
      return text;
    },
    existsSync: o.exists ?? ((path: string) => ['.pnpm', 'electron.exe'].includes(basename(path))),
    writeFileSync: (path: string, data: string) => written.push({ path, data }),
    stdout: { write: (text: string) => out.push(text) },
    stderr: { write: (text: string) => err.push(text) },
    stdin: {
      isTTY: o.tty ?? false,
      setRawMode: (raw: boolean) => stdinCalls.push(`raw:${raw}`),
      setEncoding: () => stdinCalls.push('enc'),
      resume: () => stdinCalls.push('resume'),
      pause: () => stdinCalls.push('pause'),
      on: (_event: string, fn: (key: string) => void) => {
        stdinCalls.push('on');
        for (const key of prompts.shift() ?? []) fn(key);
      },
      off: () => stdinCalls.push('off'),
    },
    signals: {
      on: (_event: string, fn: () => void) => sigint.on.push(fn),
      off: (_event: string, fn: () => void) => sigint.off.push(fn),
    },
    env: o.env ?? { APPDATA: appData },
    nodeVersion: o.nodeVersion ?? 'v24.1.0',
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: (timer: unknown) => cleared.push(timer),
    now: () => new Date(2026, 9, 24, 9, 0),
    electronDir: o.electronDir ?? (() => join('E:', 'electron')),
  };
  return { deps: deps as unknown as Deps, out, err, commands, spawned, written, sigint, timers, cleared, stdinCalls };
}

const DEV = 'pnpm --filter @riff-line/desktop run dev';
const REBUILD = 'pnpm --filter @riff-line/desktop rebuild electron';

describe('run-app.mjs：main の手順（偽物の打つ関数で）', () => {
  it('main_知らない引数_失敗のコードで止まり何も打たない', async () => {
    // UT-DEV-RUNAPP-35 5.3 節。parseArgs の断りを日本語で出して止まる
    const f = fake();
    expect(await main(['xyz'], f.deps)).toBe(1);
    expect(f.err.join('')).toContain('引数「xyz」は使えません');
    expect(f.commands).toEqual([]);
  });

  it('main_dev_確かめを通り抜けて開発の起動を打ちNodeとして動く設定を外す', async () => {
    // UT-DEV-RUNAPP-36 5.3 節「どれも前と変わっていなければすぐに通り抜ける」・表 1 番
    const f = fake({ env: { APPDATA: appData, ELECTRON_RUN_AS_NODE: '1' } });
    expect(await main(['dev'], f.deps)).toBe(0);
    expect(f.commands.map((c) => c.command)).toEqual(['pnpm --version', DEV]);
    expect(f.commands[1]?.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(f.commands[1]?.env?.[DEBUG_ENV]).toBeUndefined();
    expect(f.written).toEqual([]);
    expect(f.out.join('')).toContain('アプリが終わりました');
    // Ctrl+C は子に任せ、こちらは受け取るだけで何もしない。終わったら外す
    expect(f.sigint.on).toHaveLength(1);
    expect(f.sigint.off).toEqual(f.sigint.on);
    expect(f.sigint.on[0]?.()).toBeUndefined();
  });

  it('main_引数なしで端末でない_一覧を出して1番で起動する', async () => {
    // UT-DEV-RUNAPP-37 5.3 節「引数なしで開くと番号の一覧を日本語で出し」
    const f = fake();
    expect(await main([], f.deps)).toBe(0);
    expect(f.out.join('')).toContain('起動の形を番号で選んでください');
    expect(f.out.join('')).toContain('    5  配布と同じ形');
    expect(f.commands.at(-1)?.command).toBe(DEV);
    expect(f.stdinCalls).toEqual([]);
  });

  it('main_一覧でCtrl+C_何も打たずに終わり端末を元に戻す', async () => {
    // UT-DEV-RUNAPP-38 5.3 節の一覧。押したキーを 1 文字ずつ受け、終わったら生の入力を戻す
    const f = fake({ tty: true, keys: [['\u0003']] });
    expect(await main([], f.deps)).toBe(0);
    expect(f.commands).toEqual([]);
    expect(f.stdinCalls).toEqual(['raw:true', 'enc', 'resume', 'on', 'off', 'raw:false', 'pause']);
    expect(f.cleared).toEqual([1]);
  });

  it('main_一覧でほかのキーは待ち続け4番でログの選び直しへ進む', async () => {
    // UT-DEV-RUNAPP-39 5.3 節の表 4 番「どちらを開くかを番号で選ぶ」
    const f = fake({ tty: true, keys: [['x', '4'], ['2']] });
    expect(await main([], f.deps)).toBe(0);
    expect(f.out.join('')).toContain(join(appData, 'RiFF-LiNE', 'TabApp', 'logs'));
    expect(f.out.join('')).toContain('ログのフォルダはまだありません');
    expect(f.spawned).toEqual([]);
    expect(f.commands).toEqual([]);
  });

  it('main_logs_3秒のあいだ何も押さなければ開発のときのログ', async () => {
    // UT-DEV-RUNAPP-40 5.3 節の表 4 番「3 秒のあいだ何も押さなければ開発のとき」
    const f = fake({ tty: true, keys: [[]] });
    const running = main(['logs'], f.deps);
    expect(f.timers).toHaveLength(1);
    f.timers[0]?.();
    expect(await running).toBe(0);
    expect(f.out.join('')).toContain(join(appData, 'RiFF-LiNE-dev', 'TabApp', 'logs'));
  });

  it('main_logs_ログの選び直しでCtrl+C_開かずに終わる', async () => {
    // UT-DEV-RUNAPP-41
    const f = fake({ tty: true, keys: [['\u0003']] });
    expect(await main(['logs'], f.deps)).toBe(0);
    expect(f.out.join('')).not.toContain('TabApp');
    expect(f.spawned).toEqual([]);
  });

  it('main_logs_dist_フォルダがあり保存先の記録があればその下をエクスプローラで開く', async () => {
    // UT-DEV-RUNAPP-42 5.3 節の表 4 番「場所は data-model-persistence.md の保存先の決まりから引く」
    const root = join('D:', 'Drive');
    const f = fake({
      files: { 'storage-pointer.json': JSON.stringify({ rootAbsolutePath: root }) },
      exists: (path) => basename(path) === 'logs',
    });
    expect(await main(['logs', 'dist'], f.deps)).toBe(0);
    expect(f.spawned).toEqual([{ file: 'explorer.exe', args: [join(root, 'TabApp', 'logs')] }]);
    expect(f.stdinCalls).toEqual(['unref']);
    expect(f.out.join('')).toContain('保存先の記録から');
    expect(f.out.join('')).toContain('エクスプローラでログのフォルダを開きました');
  });

  it('main_logs_APPDATAが無ければUSERPROFILEの下_どちらも無ければ相対の場所', async () => {
    // UT-DEV-RUNAPP-43 アプリのデータのフォルダ（%APPDATA%）を引けないときの代わり
    const home = join('C:', 'Users', 'u');
    const f = fake({ env: { USERPROFILE: home } });
    await main(['logs', 'dist'], f.deps);
    expect(f.out.join('')).toContain(join(home, 'AppData', 'Roaming', 'RiFF-LiNE', 'TabApp', 'logs'));
    const g = fake({ env: {} });
    await main(['logs', 'dev'], g.deps);
    expect(g.out.join('')).toContain(`: ${join('AppData', 'Roaming', 'RiFF-LiNE-dev', 'TabApp', 'logs')}`);
  });

  it('main_pnpmが無ければcorepackを通しそう知らせる', async () => {
    // UT-DEV-RUNAPP-44 5.3 節「pnpm が見つからなければ corepack pnpm を使う」
    const f = fake({ status: (c) => ({ status: c === 'pnpm --version' ? 1 : 0 }) });
    expect(await main(['dev'], f.deps)).toBe(0);
    expect(f.out.join('')).toContain('「corepack pnpm」を使います');
    expect(f.commands.at(-1)?.command).toBe('corepack pnpm --filter @riff-line/desktop run dev');
  });

  it('main_Nodeの版が合わないか.nvmrcが無ければ起動の前に止まる', async () => {
    // UT-DEV-RUNAPP-45 5.3 節「Node.js の版の大きい番号が .nvmrc と合わなければ…止まる」
    const f = fake({ nodeVersion: 'v22.0.0' });
    expect(await main(['dev'], f.deps)).toBe(1);
    expect(f.err.join('')).toContain('Node.js 24 系を入れて');
    expect(f.commands.map((c) => c.command)).toEqual(['pnpm --version']);
    const g = fake({ files: { '.nvmrc': undefined } });
    expect(await main(['dev'], g.deps)).toBe(1);
    expect(g.err.join('')).toContain('.nvmrc の版が読めません');
  });

  it('main_lockfileが無ければ止まる', async () => {
    // UT-DEV-RUNAPP-46
    const f = fake({ files: { 'pnpm-lock.yaml': undefined } });
    expect(await main(['dev'], f.deps)).toBe(1);
    expect(f.err.join('')).toContain('pnpm-lock.yaml がありません');
  });

  it('main_lockfileが記録と違えばinstallしてから記録を書く', async () => {
    // UT-DEV-RUNAPP-47 5.3 節「SHA-256 が、前に install したときの記録と違えば pnpm install を打つ」
    const f = fake({ files: { [LOCK_RECORD_FILE]: 'old' } });
    expect(await main(['dev'], f.deps)).toBe(0);
    expect(f.commands.map((c) => c.command)).toEqual(['pnpm --version', 'pnpm install', DEV]);
    expect(f.written).toHaveLength(1);
    expect(basename(f.written[0]?.path ?? '')).toBe(LOCK_RECORD_FILE);
    expect(f.written[0]?.data).toBe(`${sha256(LOCK)}\n`);
  });

  it('main_installが失敗したら止まり記録を書かない', async () => {
    // UT-DEV-RUNAPP-48
    const f = fake({
      files: { [LOCK_RECORD_FILE]: undefined },
      status: (c) => ({ status: c === 'pnpm install' ? 1 : 0 }),
    });
    expect(await main(['dev'], f.deps)).toBe(1);
    expect(f.err.join('')).toContain('pnpm install が失敗しました');
    expect(f.written).toEqual([]);
  });

  it('main_Electronの実行ファイルが無ければ作り直して続ける', async () => {
    // UT-DEV-RUNAPP-49 5.3 節「Electron の実行ファイルが無ければ、pnpm rebuild electron を打つ」
    let rebuilt = false;
    const f = fake({
      exists: (path) => basename(path) === '.pnpm' || (basename(path) === 'electron.exe' && rebuilt),
      status: (c) => {
        if (c === REBUILD) rebuilt = true;
        return { status: 0 };
      },
    });
    expect(await main(['dev'], f.deps)).toBe(0);
    expect(f.commands.map((c) => c.command)).toEqual(['pnpm --version', REBUILD, DEV]);
  });

  it('main_作り直しが失敗するか作り直しても無ければ止まる', async () => {
    // UT-DEV-RUNAPP-50
    const exists = (path: string) => basename(path) === '.pnpm';
    const f = fake({ exists, status: (c) => ({ status: c === REBUILD ? 1 : 0 }) });
    expect(await main(['dev'], f.deps)).toBe(1);
    expect(f.err.join('')).toContain('Electron を作り直せませんでした');
    const g = fake({ exists });
    expect(await main(['dev'], g.deps)).toBe(1);
    expect(g.commands.map((c) => c.command)).toEqual(['pnpm --version', REBUILD]);
  });

  it('main_electronのパッケージが見つからないかpath.txtが無ければ作り直しを打つ', async () => {
    // UT-DEV-RUNAPP-51 needsElectronRebuild の「path.txt が無い」へつなぐ
    const f = fake({
      electronDir: () => {
        throw new Error('Cannot find module');
      },
    });
    expect(await main(['dev'], f.deps)).toBe(1);
    expect(f.commands.map((c) => c.command)).toContain(REBUILD);
    const g = fake({ files: { 'path.txt': undefined } });
    expect(await main(['dev'], g.deps)).toBe(1);
    expect(g.commands.map((c) => c.command)).toContain(REBUILD);
  });

  it('main_debug_その日のログを流す窓を開き開発者ツールの環境変数を渡す', async () => {
    // UT-DEV-RUNAPP-52 5.3 節の表 2 番「その日のログ（logs/app-YYYYMMDD.log）を流し続ける窓を別に開く」
    const f = fake();
    expect(await main(['debug'], f.deps)).toBe(0);
    const [, tail, launch] = f.commands;
    expect(tail?.command.startsWith('cmd.exe /d /c start "RiFF-LiNE log" powershell.exe')).toBe(true);
    const encoded = tail?.command.split(' ').at(-1) ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toContain(
      join(appData, 'RiFF-LiNE-dev', 'TabApp', 'logs', 'app-20261024.log'),
    );
    expect(launch?.command).toBe('pnpm --filter @riff-line/desktop run dev --inspect');
    expect(launch?.env?.[DEBUG_ENV]).toBe('1');
    expect(f.out.join('')).toContain('流し続ける窓を開きました');
  });

  it('main_debug_ログの窓を開けなくても起動は続ける', async () => {
    // UT-DEV-RUNAPP-53
    const f = fake({ status: (c) => ({ status: c === 'cmd.exe' ? 1 : 0 }) });
    expect(await main(['debug'], f.deps)).toBe(0);
    expect(f.err.join('')).toContain('ログを流す窓を開けませんでした');
    expect(f.commands.at(-1)?.command).toBe('pnpm --filter @riff-line/desktop run dev --inspect');
  });

  it('main_dist_設定ファイルの製品名と置き場所の実行ファイルで起動する', async () => {
    // UT-DEV-RUNAPP-54 5.3 節の 5 番・8.4 節（成果物の置き場所と製品名は electron-builder.yml にだけ書く）
    const f = fake({ files: { [BUILDER_CONFIG_FILE]: 'productName: X\ndirectories:\n  output: out\n' } });
    expect(await main(['dist'], f.deps)).toBe(0);
    expect(f.commands.slice(1).map((c) => c.command)).toEqual([
      'pnpm --filter @riff-line/desktop run dist',
      `"${join(desktopDir, 'out', 'win-unpacked', 'X.exe')}"`,
    ]);
    expect(f.out.join('')).toContain('止めるときは');
  });

  it('main_prod_ビルドの段では止め方を出さず起動の段だけで出す', async () => {
    // UT-DEV-RUNAPP-55 5.3 節の表 3 番
    const f = fake();
    expect(await main(['prod'], f.deps)).toBe(0);
    expect(f.out.filter((t) => t.includes('止めるときは'))).toHaveLength(1);
  });

  it('main_段が失敗したらそのコードで止まり次の段を打たない', async () => {
    // UT-DEV-RUNAPP-56 終わりのコードが 0 以外なら run-app.cmd が窓を止める
    const f = fake({ status: (c) => ({ status: c.endsWith('run build') ? 2 : 0 }) });
    expect(await main(['prod'], f.deps)).toBe(2);
    expect(f.err.join('')).toContain('終わりのコード 2');
    expect(f.commands.at(-1)?.command).toBe('pnpm --filter @riff-line/desktop run build');
  });

  it('main_コマンドを始められないか終わりのコードが無ければ1で止まる', async () => {
    // UT-DEV-RUNAPP-57
    const f = fake({ status: (c) => (c === DEV ? { status: null, error: new Error('spawn failed') } : { status: 0 }) });
    expect(await main(['dev'], f.deps)).toBe(1);
    expect(f.err.join('')).toContain('を始められませんでした（spawn failed）');
    const g = fake({ status: (c) => ({ status: c === DEV ? null : 0 }) });
    expect(await main(['dev'], g.deps)).toBe(1);
  });

  it('distPaths_製品名か置き場所が読めなければ設定ファイルの名前を挙げて投げる', () => {
    // UT-DEV-RUNAPP-60 8.4 節（成果物の置き場所と製品名は electron-builder.yml にだけ書く）。読めないまま起動を打たない
    expect(() => distPaths('D:/d', 'productName: X\n')).toThrow(BUILDER_CONFIG_FILE);
  });

  it('defaultDeps_台本の入口が使う本物の打つ関数', () => {
    // UT-DEV-RUNAPP-58
    const d = defaultDeps();
    expect(d.spawnSync).toBe(spawnSync);
    expect(d.signals).toBe(process);
    expect(d.env).toBe(process.env);
    expect(d.nodeVersion).toBe(process.version);
    expect(d.now()).toBeInstanceOf(Date);
    expect(basename(d.electronDir())).toBe('electron');
  });

  it('run-app.mjsを子のプロセスで直に打つ_入口がmainの終わりのコードで終わる', () => {
    // UT-DEV-RUNAPP-59 台本の入口（そのファイルを直に打ったときだけ main を呼ぶ）。カバレッジでは数えない入口をここで確かめる
    const result = spawnSync(process.execPath, [join(desktopDir, 'scripts', 'run-app.mjs'), 'xyz'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('引数「xyz」は使えません');
  });

  it('runEntry_mainの終わりのコードで終え思いがけないエラーは日本語の文を出して1で終える', async () => {
    // UT-DEV-RUNAPP-61 5.3 節「表示は日本語で出す」。入口の処理を分かれ目の外に出して確かめる（turn 184 の照合で、
    // 分かれ目の中の処理が引数を変えた後の fail を古い形で呼んでいた）
    const codes: number[] = [];
    const ok = fake();
    await runEntry(['xyz'], ok.deps, (code) => codes.push(code));
    expect(codes).toEqual([1]);
    const broken = fake({
      status: () => {
        throw new Error('spawn exploded');
      },
    });
    await runEntry(['dev'], broken.deps, (code) => codes.push(code));
    expect(codes).toEqual([1, 1]);
    expect(broken.err.join('')).toContain('思いがけないエラーで止まりました（spawn exploded）');
    await runEntry(['logs', 'dev'], fake().deps, (code) => codes.push(code));
    expect(codes).toEqual([1, 1, 0]);
  });

  it('runEntry_Errorでない値で止まったとき_その値を文字にして出して1で終える', async () => {
    // UT-DEV-RUNAPP-63 5.3 節「表示は日本語で出す」。投げられた値が Error でないとき（文字列など）も同じ文で知らせる
    const codes: number[] = [];
    const broken = fake({
      status: () => {
        throw 'not an error object';
      },
    });
    await runEntry(['dev'], broken.deps, (code) => codes.push(code));
    expect(codes).toEqual([1]);
    expect(broken.err.join('')).toContain('思いがけないエラーで止まりました（not an error object）');
  });
});
