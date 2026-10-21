// 起動の口の中身（詳細設計 web-core-foundation.md 5.3 節）。
// リポジトリ直下の run-app.cmd が Node.js を見つけてこのファイルを呼ぶ。起動の手順はすべてこの 1 ファイルに置く。
// 判断（どの形で起動するか・install が要るか・Electron を直すか・Node.js の版が合うか）は副作用の無い関数に分け、 <!-- req webcorefoundation:6b4164d2.e26b -->
// apps/desktop/src/dev/runApp.test.ts（UT-DEV-RUNAPP）で確かめる。
//
// 使い方: run-app.cmd [dev|debug|prod|logs]
//   引数なしで開くと番号の一覧を出し、3 秒のあいだ何も押さなければ 1（dev）で起動する。
//   配布と同じ形（引数 dist、5 番）は、8.4 節の配布の設定を書く区切りで足す（今は無い）。
// <!-- req webcorefoundation:d06d6ff3.b93d --> <!-- req webcorefoundation:fbf53582.4509 --> <!-- req webcorefoundation:0938c87d.2aec -->
// <!-- req webcorefoundation:1c69e00f.05c3 --> <!-- req webcorefoundation:1c69e00f.b6cf --> <!-- req webcorefoundation:1c69e00f.e005 -->

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 起動の形。番号は配列の並び（1 から）。 */
// <!-- req webcorefoundation:a8e78459.bff8 --> <!-- req webcorefoundation:a8e78459.311d --> <!-- req webcorefoundation:a8e78459.9ee3 --> <!-- req webcorefoundation:a8e78459.ca96 --> <!-- req webcorefoundation:a8e78459.8e0f -->
export const MODES = ['dev', 'debug', 'prod', 'logs'];

/** 形ごとの一覧の表示。 */
export const MODE_LABELS = {
  dev: 'ふだん（開発。書き換えるとすぐ画面に出る）',
  debug: 'デバッグ（開発者ツール・デバッガー・ログの窓を開く）',
  prod: '本番に近い形（ビルドしてから起動する）',
  logs: 'ログのフォルダを開く',
};

/** 引数なしで開いたとき、何も押さなければ 1 で起動するまでの時間。 */
// <!-- req webcorefoundation:a8e78459.10b3 -->
export const MENU_TIMEOUT_MS = 3000;

/**
 * main に「開発者ツールを開く」を伝える環境変数の名前。
 * main 側の apps/desktop/src/main/devTools.ts の DEBUG_ENV_NAME と同じ値で、テストが一致を確かめる。
 */
export const DEBUG_ENV = 'RIFFLINE_DEBUG';

/** 前に install したときの pnpm-lock.yaml の SHA-256 を残すファイル（node_modules の下）。 */
// <!-- req webcorefoundation:a03addc9.5990 -->
export const LOCK_RECORD_FILE = '.run-app-lock';

/** PC 版のパッケージ名（pnpm の --filter に渡す）。 */
export const DESKTOP_PACKAGE = '@riff-line/desktop';

/**
 * 引数から起動の形を決める。
 * @param {readonly string[]} argv `run-app.cmd` に付けた引数
 * @returns {{ kind: 'menu' } | { kind: 'mode', mode: string } | { kind: 'error', message: string }}
 */
// <!-- req webcorefoundation:a8e78459.f065 --> <!-- req webcorefoundation:0938c87d.51db -->
export function parseArgs(argv) {
  const [first] = argv;
  if (first === undefined || first === '') return { kind: 'menu' };
  const mode = first.toLowerCase();
  if (MODES.includes(mode)) return { kind: 'mode', mode };
  return {
    kind: 'error',
    message: `引数「${first}」は使えません。${MODES.join('・')} のどれかを付けるか、引数なしで開いてください。`,
  };
}

/**
 * 一覧で押したキーから起動の形を決める。Enter は 1 と同じ。それ以外のキーは null（待ち続ける）。
 * @param {string} key 押したキー（1 文字）
 * @returns {string | null}
 */
export function modeFromKey(key) {
  if (key === '\r' || key === '\n') return MODES[0];
  const index = Number.parseInt(key, 10);
  if (String(index) === key && index >= 1 && index <= MODES.length) return MODES[index - 1];
  return null;
}

/**
 * 版の文字列（`24`・`v24.13.0`・`24.1`）から大きい番号を取る。読めなければ null。
 * @param {string} version
 * @returns {number | null}
 */
export function majorOf(version) {
  const match = /^\s*v?(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

/**
 * Node.js の版の大きい番号が `.nvmrc` と合うか。
 * @param {string} nodeVersion `process.version`
 * @param {string} nvmrcText `.nvmrc` の中身
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
// <!-- req webcorefoundation:0e8f30a4.237d --> <!-- req webcorefoundation:0e8f30a4.7f71 --> <!-- req webcorefoundation:0938c87d.1023 -->
export function checkNodeVersion(nodeVersion, nvmrcText) {
  const required = majorOf(nvmrcText);
  const actual = majorOf(nodeVersion);
  if (required === null) {
    return { ok: false, message: '.nvmrc の版が読めません。リポジトリ直下の .nvmrc を確かめてください。' };
  }
  if (actual === required) return { ok: true };
  return {
    ok: false,
    message:
      `Node.js の版が合いません（今は ${nodeVersion}、.nvmrc は ${required} 系）。` +
      `Node.js ${required} 系を入れてから、もう一度開いてください（nvm を使っているなら「nvm use ${required}」）。`,
  };
}

/**
 * 文字列の SHA-256（16 進）。
 * @param {string | Buffer} content
 * @returns {string}
 */
export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * `pnpm install` が要るか。node_modules が無いか、lockfile の SHA-256 が前の記録と違えば要る。
 * @param {{ hasNodeModules: boolean, lockHash: string, recordedHash: string | null }} state
 * @returns {boolean}
 */
// <!-- req webcorefoundation:a03addc9.8fb8 --> <!-- req webcorefoundation:a03addc9.0ed0 --> <!-- req webcorefoundation:0938c87d.27b0 --> <!-- req webcorefoundation:1068876c.d40f --> <!-- req webcorefoundation:1068876c.c307 -->
export function needsInstall({ hasNodeModules, lockHash, recordedHash }) {
  if (!hasNodeModules) return true;
  return recordedHash === null || recordedHash.trim() !== lockHash;
}

/**
 * Electron の実行ファイルを直す（`pnpm rebuild electron`）必要があるか。
 * electron のパッケージの `path.txt` が無いか、そこに書かれた実行ファイルが無ければ要る。
 * @param {{ pathTxt: string | null, binaryExists: boolean }} state
 * @returns {boolean}
 */
// <!-- req webcorefoundation:a7ed0e1c.0843 --> <!-- req webcorefoundation:0938c87d.51ec -->
export function needsElectronRebuild({ pathTxt, binaryExists }) {
  return pathTxt === null || pathTxt.trim() === '' || !binaryExists;
}

/**
 * pnpm を呼ぶときの先頭の語。pnpm が見つからなければ corepack を通す。
 * @param {boolean} hasPnpm
 * @returns {string}
 */
// <!-- req webcorefoundation:7b0729e1.3811 -->
export function pnpmCommand(hasPnpm) {
  return hasPnpm ? 'pnpm' : 'corepack pnpm';
}

/**
 * 形ごとに打つコマンドの並び。`logs` はコマンドを打たない（フォルダを開くだけ）。
 * @param {string} mode
 * @param {string} pm `pnpmCommand` の値
 * @returns {{ title: string, command: string, debugEnv: boolean }[]}
 */
// <!-- req webcorefoundation:7bd8e8ef.74f6 --> <!-- req webcorefoundation:8bb46d4e.28f6 --> <!-- req webcorefoundation:8bb46d4e.adf9 --> <!-- req webcorefoundation:b50a7d60.86da --> <!-- req webcorefoundation:b50a7d60.9ef5 --> <!-- req webcorefoundation:b50a7d60.d426 -->
export function stepsFor(mode, pm) {
  const desktop = `${pm} --filter ${DESKTOP_PACKAGE}`;
  switch (mode) {
    case 'dev':
      return [{ title: '開発の起動（electron-vite dev）', command: `${desktop} run dev`, debugEnv: false }];
    case 'debug':
      return [
        {
          title: 'デバッグの起動（electron-vite dev --inspect、開発者ツールを開く）',
          command: `${desktop} run dev --inspect`,
          debugEnv: true,
        },
      ];
    case 'prod':
      return [
        { title: 'ビルド（electron-vite build）', command: `${desktop} run build`, debugEnv: false },
        {
          title: 'ビルドしたもので起動（electron-vite preview）',
          command: `${desktop} exec electron-vite preview --skipBuild`,
          debugEnv: false,
        },
      ];
    case 'logs':
      return [];
    default:
      throw new Error(`知らない起動の形: ${mode}`);
  }
}

/**
 * アプリのデータのフォルダ（Electron の `app.getPath('userData')` と同じ場所）。
 * Windows では `%APPDATA%` の下の、apps/desktop/package.json の productName（無ければ name）のフォルダ。
 * @param {string} appDataDir `%APPDATA%`
 * @param {{ name?: string, productName?: string }} desktopPackageJson
 * @returns {string}
 */
export function userDataDir(appDataDir, desktopPackageJson) {
  const appName = desktopPackageJson.productName ?? desktopPackageJson.name ?? 'Electron';
  return join(appDataDir, ...appName.split('/'));
}

/**
 * ログのフォルダ（error-logging-foundation.md の `logs/`）。保存先の決まり（data-model-persistence.md 11 節）のとおり、
 * userData の `storage-pointer.json` に主ストレージの場所があればその下の `TabApp/logs`、無ければ `{userData}/TabApp/logs`。
 * @param {string} userData `userDataDir` の値
 * @param {string | null} pointerText `storage-pointer.json` の中身（無ければ null）
 * @returns {{ dir: string, fromPointer: boolean }}
 */
// <!-- req webcorefoundation:0a87d854.fe36 -->
export function logsDirFor(userData, pointerText) {
  let root = userData;
  let fromPointer = false;
  if (pointerText !== null) {
    try {
      const parsed = JSON.parse(pointerText);
      if (parsed && typeof parsed.rootAbsolutePath === 'string' && parsed.rootAbsolutePath !== '') {
        root = parsed.rootAbsolutePath;
        fromPointer = true;
      }
    } catch {
      // 壊れた記録は「記録なし」と同じに扱う（main の ElectronAppLocalConfigService.readPointer と同じ）。
    }
  }
  return { dir: join(root, 'TabApp', 'logs'), fromPointer };
}

/**
 * その日の通常ログのファイル名（`app-YYYYMMDD.log`、ローカルの日付。packages/core の Logger と同じ）。
 * @param {Date} date
 * @returns {string}
 */
export function todayLogFileName(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `app-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.log`;
}

/**
 * ログを流し続ける窓で打つ PowerShell の文。ファイルがまだ無ければ、できるのを待つ旨を出して待つ。
 * @param {string} logFile その日のログのファイルの場所
 * @returns {string}
 */
// <!-- req webcorefoundation:8bb46d4e.616d -->
export function logTailScript(logFile) {
  const quoted = `'${logFile.replace(/'/g, "''")}'`;
  return [
    "$Host.UI.RawUI.WindowTitle = 'RiFF-LiNE ログ'",
    `$f = ${quoted}`,
    'Write-Host "その日のログ: $f"',
    'if (-not (Test-Path -LiteralPath $f)) {',
    "  Write-Host 'その日のログはまだありません。アプリが書き始めるのを待っています。'",
    '  while (-not (Test-Path -LiteralPath $f)) { Start-Sleep -Seconds 1 }',
    '}',
    'Get-Content -LiteralPath $f -Wait -Tail 50 -Encoding UTF8',
  ].join('\n');
}

/**
 * ログを流し続ける窓を開くコマンド。Node.js の `detached` は Windows では窓を持たない形で始めるので、
 * cmd の `start` で新しい窓を開き、その中で PowerShell に `logTailScript` の文を渡す（文は -EncodedCommand で渡し、引用符を逃がさずに済ませる）。
 * @param {string} script `logTailScript` の値
 * @returns {{ file: string, args: string[] }} `spawn` に `windowsVerbatimArguments: true` で渡す
 */
export function logTailLaunch(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return {
    file: 'cmd.exe',
    args: ['/d', '/c', `start "RiFF-LiNE log" powershell.exe -NoExit -NoProfile -EncodedCommand ${encoded}`],
  };
}

// ---------------------------------------------------------------------------
// ここから下は副作用のある手順（テストしない。判断は上の関数に任せる）
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const repoRoot = resolve(desktopDir, '..', '..');

/** @param {string} text */
const say = (text) => process.stdout.write(`[run-app] ${text}\n`);
/** @param {string} text */
const fail = (text) => process.stderr.write(`[run-app] 失敗: ${text}\n`);

/** @param {string} path */
const readOrNull = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * シェルを通してコマンドを打ち、終わるまで待つ。Ctrl+C は子に任せ、こちらは終わりのコードを受け取る。
 * @param {string} command
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
function run(command, env) {
  const ignoreSigint = () => {};
  process.on('SIGINT', ignoreSigint);
  try {
    const result = spawnSync(command, { cwd: repoRoot, env, shell: true, stdio: 'inherit' });
    if (result.error) {
      fail(`「${command}」を始められませんでした（${result.error.message}）。`);
      return 1;
    }
    return result.status ?? 1;
  } finally {
    process.off('SIGINT', ignoreSigint);
  }
}

/** @returns {boolean} */
function hasPnpmOnPath() {
  const result = spawnSync('pnpm --version', { cwd: repoRoot, shell: true, stdio: 'ignore' });
  return result.status === 0;
}

/** @returns {Promise<string | null>} 選んだ形。Ctrl+C なら null。 */
// <!-- req webcorefoundation:a8e78459.1ac1 --> <!-- req webcorefoundation:e1397463.c291 -->
function askMode() {
  say('起動の形を番号で選んでください（3 秒のあいだ何も押さなければ 1 で起動します）。');
  MODES.forEach((mode, i) => process.stdout.write(`    ${i + 1}  ${MODE_LABELS[mode]}\n`));
  if (!process.stdin.isTTY) return Promise.resolve(MODES[0]);
  return new Promise((resolvePromise) => {
    const stdin = process.stdin;
    /** @param {string | null} mode */
    const done = (mode) => {
      clearTimeout(timer);
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      resolvePromise(mode);
    };
    /** @param {string} key */
    const onData = (key) => {
      if (key === '\u0003') return done(null);
      const mode = modeFromKey(key);
      if (mode !== null) done(mode);
    };
    const timer = setTimeout(() => done(MODES[0]), MENU_TIMEOUT_MS);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

/**
 * 起動の前の確かめ（5.3 節）。どれも前と変わっていなければすぐに通り抜ける。
 * @param {string} pm
 * @returns {boolean} 続けてよいか
 */
// <!-- req webcorefoundation:1068876c.7739 --> <!-- req webcorefoundation:a03addc9.cc5f --> <!-- req webcorefoundation:a7ed0e1c.a07e --> <!-- req webcorefoundation:e1397463.418f --> <!-- req webcorefoundation:e1397463.bc91 -->
function prepare(pm) {
  say('手順 1/3：Node.js の版を確かめています。');
  const nvmrc = readOrNull(join(repoRoot, '.nvmrc')) ?? '';
  const version = checkNodeVersion(process.version, nvmrc);
  if (!version.ok) {
    fail(version.message);
    return false;
  }

  say('手順 2/3：依存のパッケージが今の pnpm-lock.yaml と合っているかを確かめています。');
  const lockText = readOrNull(join(repoRoot, 'pnpm-lock.yaml'));
  if (lockText === null) {
    fail('リポジトリ直下に pnpm-lock.yaml がありません。リポジトリを取り直してください。');
    return false;
  }
  const lockHash = sha256(lockText);
  const recordPath = join(repoRoot, 'node_modules', LOCK_RECORD_FILE);
  const hasNodeModules = existsSync(join(repoRoot, 'node_modules', '.pnpm'));
  if (needsInstall({ hasNodeModules, lockHash, recordedHash: readOrNull(recordPath) })) {
    say(`依存のパッケージを入れ直します（${pm} install）。数分かかることがあります。`);
    if (run(`${pm} install`, process.env) !== 0) {
      fail(
        `${pm} install が失敗しました。上の表示を読み、ネットワークにつながっているかを確かめてから開き直してください。`,
      );
      return false;
    }
    writeFileSync(recordPath, `${lockHash}\n`);
  }

  say('手順 3/3：Electron の実行ファイルを確かめています。');
  if (needsElectronRebuild(electronState())) {
    say(`Electron の実行ファイルが無いので作り直します（${pm} --filter ${DESKTOP_PACKAGE} rebuild electron）。`);
    if (
      run(`${pm} --filter ${DESKTOP_PACKAGE} rebuild electron`, process.env) !== 0 ||
      needsElectronRebuild(electronState())
    ) {
      fail(`Electron を作り直せませんでした。「${pm} install」をもう一度打ってから開き直してください。`);
      return false;
    }
  }
  return true;
}

/** @returns {{ pathTxt: string | null, binaryExists: boolean }} */
function electronState() {
  try {
    const require = createRequire(join(desktopDir, 'package.json'));
    const electronDir = dirname(require.resolve('electron/package.json'));
    const pathTxt = readOrNull(join(electronDir, 'path.txt'));
    const binaryExists = pathTxt !== null && existsSync(join(electronDir, 'dist', pathTxt.trim()));
    return { pathTxt, binaryExists };
  } catch {
    return { pathTxt: null, binaryExists: false };
  }
}

/** @returns {string} ログのフォルダ */
function locateLogsDir() {
  const appData = process.env['APPDATA'] ?? join(process.env['USERPROFILE'] ?? '', 'AppData', 'Roaming');
  const desktopPackage = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'));
  const userData = userDataDir(appData, desktopPackage);
  const { dir, fromPointer } = logsDirFor(userData, readOrNull(join(userData, 'storage-pointer.json')));
  say(
    fromPointer
      ? `ログのフォルダ（保存先の記録から）: ${dir}`
      : `ログのフォルダ（保存先の記録が無いので既定の場所）: ${dir}`,
  );
  return dir;
}

// <!-- req webcorefoundation:0a87d854.84c5 -->
function openLogsFolder() {
  const dir = locateLogsDir();
  if (!existsSync(dir)) {
    say('ログのフォルダはまだありません。アプリを一度起動すると、上の場所にできます（ここでは作りません）。');
    return 0;
  }
  spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
  say('エクスプローラでログのフォルダを開きました。');
  return 0;
}

function openLogTailWindow() {
  const logFile = join(locateLogsDir(), todayLogFileName(new Date()));
  const { file, args } = logTailLaunch(logTailScript(logFile));
  const result = spawnSync(file, args, { stdio: 'ignore', windowsVerbatimArguments: true });
  if (result.status !== 0) {
    fail('ログを流す窓を開けませんでした。4 番（ログを見る）でフォルダを開いて、その日のログを直接開いてください。');
    return;
  }
  say('その日のログを流し続ける窓を開きました。');
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>} 終わりのコード（0 以外なら run-app.cmd が窓を止める）
 */
// <!-- req webcorefoundation:8bb46d4e.0f28 --> <!-- req webcorefoundation:cc4c9850.d5ad -->
export async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'error') {
    fail(parsed.message);
    return 1;
  }
  const mode = parsed.kind === 'mode' ? parsed.mode : await askMode();
  if (mode === null) return 0;
  say(`「${MODE_LABELS[mode]}」で始めます。`);

  if (mode === 'logs') return openLogsFolder();

  const pm = pnpmCommand(hasPnpmOnPath());
  if (pm !== 'pnpm')
    say('pnpm が見つからないので「corepack pnpm」を使います（「corepack enable」を一度打つと pnpm で呼べます）。');
  if (!prepare(pm)) return 1;

  if (mode === 'debug') openLogTailWindow();

  // Electron を GUI のアプリとして起動する（Node.js として動く設定が残っていると窓が開かない）。
  const baseEnv = { ...process.env };
  delete baseEnv['ELECTRON_RUN_AS_NODE'];
  for (const step of stepsFor(mode, pm)) {
    say(`${step.title}：${step.command}`);
    if (step.title.includes('起動')) say('止めるときは、アプリの窓を閉じるか、この窓で Ctrl+C を押してください。');
    const env = step.debugEnv ? { ...baseEnv, [DEBUG_ENV]: '1' } : baseEnv;
    const code = run(step.command, env);
    if (code !== 0) {
      fail(
        `「${step.command}」が終わりのコード ${code} で止まりました。上の表示を読んで直してから開き直してください。`,
      );
      return code;
    }
  }
  say('アプリが終わりました。');
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      fail(
        `思いがけないエラーで止まりました（${error instanceof Error ? error.message : String(error)}）。` +
          'もう一度 run-app.cmd を開いてください。同じところで止まるときは、この窓の表示を残したまま知らせてください。',
      );
      process.exit(1);
    },
  );
}
