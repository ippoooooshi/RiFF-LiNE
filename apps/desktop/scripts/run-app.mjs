// 起動の口の中身（詳細設計 web-core-foundation.md 5.3 節）。
// リポジトリ直下の run-app.cmd が Node.js を見つけてこのファイルを呼ぶ。起動の手順はすべてこの 1 ファイルに置く。
// 判断（どの形で起動するか・install が要るか・Electron を直すか・Node.js の版が合うか）は副作用の無い関数に分け、 <!-- req webcorefoundation:6b4164d2.e26b -->
// apps/desktop/src/dev/runApp.test.ts（UT-DEV-RUNAPP）で確かめる。 <!-- req webcorefoundation:029375a8.9138 -->
//
// 使い方: run-app.cmd [dev|debug|prod|logs|dist]
//   引数なしで開くと番号の一覧を出し、3 秒のあいだ何も押さなければ 1（dev）で起動する。
//   4 番（logs）は、開発のときのログ（RiFF-LiNE-dev）と配布したアプリのログ（RiFF-LiNE）のどちらを開くかを番号で選ぶ
//   （3 秒のあいだ何も押さなければ開発のとき）。run-app.cmd logs dev・run-app.cmd logs dist なら選ばずに開く。
//   5 番（dist）は配布と同じ形：Electron Builder で配布用のパッケージを作り（8.4 節、表示義務のあるファイルの確かめつき）、
//   その中の実行ファイルで起動する。
// 15.8 節：版はアプリ（apps/desktop・Phase 3 の apps/mobile）ごとに独立させ、それぞれの package.json の version にセマンティックバージョニング（x.y.z）で持つ。
// PC 版と iPhone 版を 1 つの版の番号に縛らない（直下の package.json の version は 0.0.0 のままで製品の版にしない）。Phase 1 を終えた時点の PC 版は 0.x。
// 作業パッケージごとのマージで版を上げる道具と、詳しいリリースノートの運用は置かない <!-- req webcorefoundation:3f22063a.9d3f --> <!-- req webcorefoundation:3f22063a.cb17 --> <!-- req webcorefoundation:3f22063a.44ab --> <!-- req webcorefoundation:3f22063a.3a6d --> <!-- req webcorefoundation:3f22063a.83f3 --> <!-- req webcorefoundation:3f22063a.42b8 --> <!-- req webcorefoundation:e8dd8dd8.5454 --> <!-- req webcorefoundation:a1585ffd.e83d --> <!-- req webcorefoundation:a1585ffd.c5b3 --> <!-- req webcorefoundation:a1585ffd.4818 -->
// 配布用のパッケージの版は apps/desktop/package.json の version <!-- req webcorefoundation:01c09235.c9a5 --> <!-- req webcorefoundation:01c09235.be13 --> <!-- req webcorefoundation:01c09235.d498 -->
// <!-- req webcorefoundation:86e581d3.b93d --> <!-- req webcorefoundation:fbf53582.4509 --> <!-- req webcorefoundation:0938c87d.2aec --> <!-- req webcorefoundation:f87abd8f.6e9f -->
// <!-- req webcorefoundation:e1c3b818.ebb6 --> <!-- req webcorefoundation:e1c3b818.ed82 --> <!-- req webcorefoundation:e1c3b818.b2c5 -->

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 起動の形。番号は配列の並び（1 から）。 */
// <!-- req webcorefoundation:f78481da.ad2c --> <!-- req webcorefoundation:f78481da.8d38 --> <!-- req webcorefoundation:f78481da.311d --> <!-- req webcorefoundation:f78481da.9ee3 --> <!-- req webcorefoundation:f78481da.ca96 --> <!-- req webcorefoundation:f78481da.8e0f -->
export const MODES = ['dev', 'debug', 'prod', 'logs', 'dist'];

/** 形ごとの一覧の表示。 */
export const MODE_LABELS = {
  dev: 'ふだん（開発。書き換えるとすぐ画面に出る）',
  debug: 'デバッグ（開発者ツール・デバッガー・ログの窓を開く）',
  prod: '本番に近い形（ビルドしてから起動する）',
  logs: 'ログのフォルダを開く',
  dist: '配布と同じ形（配布用のパッケージを作り、その中の実行ファイルで起動する）',
};

/** 4 番（logs）で開くログ。番号は配列の並び（1 から）。 */
// <!-- req webcorefoundation:0563e1d1.72fe --> <!-- req webcorefoundation:0563e1d1.797e -->
export const LOG_TARGETS = ['dev', 'dist'];

/** 開くログごとの一覧の表示。 */
export const LOG_TARGET_LABELS = {
  dev: '開発のときのログ（RiFF-LiNE-dev）',
  dist: '配布したアプリのログ（RiFF-LiNE）',
};

/**
 * アプリの領域（app.getPath('userData')）のフォルダの名前（data-model-persistence.md 11 節）。
 * main 側の apps/desktop/src/main/userDataDir.ts と同じ値で、テストが一致を確かめる。
 */
export const USER_DATA_DIR_NAMES = { dev: 'RiFF-LiNE-dev', dist: 'RiFF-LiNE' };

/** 配布用のパッケージ作りの設定ファイル（8.4 節。成果物の置き場所と製品名はここにだけ書く）。 */
export const BUILDER_CONFIG_FILE = 'electron-builder.yml';

/**
 * electron-builder.yml から、製品名（productName）と成果物の置き場所（directories.output）を読む。読めなければ null。
 * @param {string} configText electron-builder.yml の中身
 * @returns {{ productName: string, output: string } | null}
 */
export function distSettingsFromConfig(configText) {
  const productName = /^productName:\s*(\S+)\s*$/m.exec(configText)?.[1];
  const output = /^directories:\s*\r?\n(?:[ \t]+#.*\r?\n)*[ \t]+output:\s*(\S+)\s*$/m.exec(configText)?.[1];
  return productName && output ? { productName, output } : null;
}

/**
 * 配布用のパッケージの直下（成果物の置き場所の下の win-unpacked）と、その中の実行ファイル。
 * @param {string} desktopDir apps/desktop の場所
 * @param {string} configText electron-builder.yml の中身
 * @returns {{ dir: string, exe: string }}
 */
export function distPaths(desktopDir, configText) {
  const settings = distSettingsFromConfig(configText);
  if (settings === null) throw new Error(`${BUILDER_CONFIG_FILE} の productName か directories.output が読めません。`);
  const dir = join(desktopDir, settings.output, 'win-unpacked');
  return { dir, exe: join(dir, `${settings.productName}.exe`) };
}

/** 引数なしで開いたとき、何も押さなければ 1 で起動するまでの時間。 */
// <!-- req webcorefoundation:f78481da.10b3 -->
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
 * 4 番（logs）だけは 2 つ目の引数（dev・dist）で開くログを決められる。無ければ logTarget を持たない（番号で選ぶ）。
 * @param {readonly string[]} argv `run-app.cmd` に付けた引数
 * @returns {{ kind: 'menu' } | { kind: 'mode', mode: string, logTarget?: string } | { kind: 'error', message: string }}
 */
// <!-- req webcorefoundation:f78481da.f065 --> <!-- req webcorefoundation:0938c87d.51db --> <!-- req webcorefoundation:0563e1d1.d91a --> <!-- req webcorefoundation:0563e1d1.7348 -->
export function parseArgs(argv) {
  const [first, second] = argv;
  if (first === undefined || first === '') return { kind: 'menu' };
  const mode = first.toLowerCase();
  if (!MODES.includes(mode)) {
    return {
      kind: 'error',
      message: `引数「${first}」は使えません。${MODES.join('・')} のどれかを付けるか、引数なしで開いてください。`,
    };
  }
  if (mode !== 'logs' || second === undefined || second === '') return { kind: 'mode', mode };
  const logTarget = second.toLowerCase();
  if (LOG_TARGETS.includes(logTarget)) return { kind: 'mode', mode, logTarget };
  return {
    kind: 'error',
    message: `logs の後の引数「${second}」は使えません。${LOG_TARGETS.join('・')} のどちらかを付けるか、logs だけで開いてください。`,
  };
}

/**
 * 4 番（logs）の一覧で押したキーから、開くログを決める。Enter は 1（開発のとき）と同じ。それ以外のキーは null（待ち続ける）。
 * @param {string} key 押したキー（1 文字）
 * @returns {string | null}
 */
// <!-- req webcorefoundation:0563e1d1.2312 --> <!-- req webcorefoundation:0563e1d1.5f69 -->
export function logTargetFromKey(key) {
  if (key === '\r' || key === '\n') return LOG_TARGETS[0];
  const index = Number.parseInt(key, 10);
  if (String(index) === key && index >= 1 && index <= LOG_TARGETS.length) return LOG_TARGETS[index - 1];
  return null;
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
 * @param {string} [distExe] `dist` で起動する実行ファイル（`distPaths` の exe）
 * @returns {{ title: string, command: string, debugEnv: boolean }[]}
 */
// <!-- req webcorefoundation:7bd8e8ef.74f6 --> <!-- req webcorefoundation:8bb46d4e.28f6 --> <!-- req webcorefoundation:8bb46d4e.adf9 --> <!-- req webcorefoundation:b50a7d60.86da --> <!-- req webcorefoundation:b50a7d60.9ef5 --> <!-- req webcorefoundation:b50a7d60.d426 -->
export function stepsFor(mode, pm, distExe = '') {
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
    case 'dist':
      return [
        {
          title: '配布用のパッケージを作る（electron-vite build と electron-builder、表示義務のあるファイルの確かめ）',
          command: `${desktop} run dist`,
          debugEnv: false,
        },
        {
          title: '配布用のパッケージの中の実行ファイルで起動',
          command: `"${distExe}"`,
          debugEnv: false,
        },
      ];
    default:
      throw new Error(`知らない起動の形: ${mode}`);
  }
}

/**
 * アプリのデータのフォルダ（Electron の `app.getPath('userData')` と同じ場所）。
 * Windows では `%APPDATA%` の下の、開発のときは RiFF-LiNE-dev、配布したアプリは RiFF-LiNE のフォルダ（data-model-persistence.md 11 節）。
 * @param {string} appDataDir `%APPDATA%`
 * @param {string} target `LOG_TARGETS` のどれか
 * @returns {string}
 */
export function userDataDir(appDataDir, target) {
  const name = USER_DATA_DIR_NAMES[target];
  if (name === undefined) throw new Error(`知らないログの種類: ${target}`);
  return join(appDataDir, name);
}

/**
 * ログのフォルダ（error-logging-foundation.md の `logs/`）。保存先の決まり（data-model-persistence.md 11 節）のとおり、
 * userData の `storage-pointer.json` に主ストレージの場所があればその下の `TabApp/logs`、無ければ `{userData}/TabApp/logs`。
 * @param {string} userData `userDataDir` の値
 * @param {string | null} pointerText `storage-pointer.json` の中身（無ければ null）
 * @returns {{ dir: string, fromPointer: boolean }}
 */
// <!-- req webcorefoundation:0563e1d1.1b6a -->
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
// ここから下は副作用のある手順。子のプロセス・Electron の起動・ファイル・入出力は、引数で受け取る打つ関数（RunAppDeps）を通す。
// テスト（UT-DEV-RUNAPP）は偽物を渡して手順の並びと分かれ目を確かめる（2026-10-24 チャット側の決定）。
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const repoRoot = resolve(desktopDir, '..', '..');

/**
 * 副作用のある手順が打つ関数。`main` が受け取り、下の手順へそのまま渡す。
 * @typedef {object} RunAppDeps
 * @property {typeof spawnSync} spawnSync
 * @property {typeof spawn} spawn
 * @property {(path: string, encoding: 'utf8') => string} readFileSync
 * @property {(path: string) => boolean} existsSync
 * @property {(path: string, data: string) => void} writeFileSync
 * @property {{ write: (text: string) => unknown }} stdout
 * @property {{ write: (text: string) => unknown }} stderr
 * @property {{ isTTY?: boolean, setRawMode: (raw: boolean) => unknown, setEncoding: (enc: 'utf8') => unknown, resume: () => unknown, pause: () => unknown, on: (ev: 'data', fn: (key: string) => void) => unknown, off: (ev: 'data', fn: (key: string) => void) => unknown }} stdin
 * @property {{ on: (ev: 'SIGINT', fn: () => void) => unknown, off: (ev: 'SIGINT', fn: () => void) => unknown }} signals
 * @property {NodeJS.ProcessEnv} env
 * @property {string} nodeVersion
 * @property {(fn: () => void, ms: number) => unknown} setTimeout
 * @property {(timer: unknown) => void} clearTimeout
 * @property {() => Date} now
 * @property {() => string} electronDir electron のパッケージのフォルダ。見つからなければ投げる
 */

/**
 * 本物の打つ関数。台本の入口だけが使う。
 * @returns {RunAppDeps}
 */
export function defaultDeps() {
  return {
    spawnSync,
    spawn,
    readFileSync,
    existsSync,
    writeFileSync,
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    signals: process,
    env: process.env,
    nodeVersion: process.version,
    setTimeout,
    clearTimeout,
    now: () => new Date(),
    electronDir: () => dirname(createRequire(join(desktopDir, 'package.json')).resolve('electron/package.json')),
  };
}

/**
 * @param {RunAppDeps} d
 * @param {string} text
 */
const say = (d, text) => d.stdout.write(`[run-app] ${text}\n`);
/**
 * @param {RunAppDeps} d
 * @param {string} text
 */
const fail = (d, text) => d.stderr.write(`[run-app] 失敗: ${text}\n`);

/**
 * @param {RunAppDeps} d
 * @param {string} path
 */
const readOrNull = (d, path) => {
  try {
    return d.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * シェルを通してコマンドを打ち、終わるまで待つ。Ctrl+C は子に任せ、こちらは終わりのコードを受け取る。
 * @param {RunAppDeps} d
 * @param {string} command
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
function run(d, command, env) {
  const ignoreSigint = () => {};
  d.signals.on('SIGINT', ignoreSigint);
  try {
    const result = d.spawnSync(command, { cwd: repoRoot, env, shell: true, stdio: 'inherit' });
    if (result.error) {
      fail(d, `「${command}」を始められませんでした（${result.error.message}）。`);
      return 1;
    }
    return result.status ?? 1;
  } finally {
    d.signals.off('SIGINT', ignoreSigint);
  }
}

/**
 * @param {RunAppDeps} d
 * @returns {boolean}
 */
function hasPnpmOnPath(d) {
  const result = d.spawnSync('pnpm --version', { cwd: repoRoot, shell: true, stdio: 'ignore' });
  return result.status === 0;
}

/**
 * 番号の一覧を出して 1 つ選ばせる。3 秒のあいだ何も押さなければ一覧の 1 番。
 * @param {RunAppDeps} d
 * @param {string} heading 一覧の前に出す文
 * @param {readonly string[]} items 選べるもの（1 番から）
 * @param {Record<string, string>} labels 一覧の表示
 * @param {(key: string) => string | null} fromKey 押したキーから選んだものを決める
 * @returns {Promise<string | null>} 選んだもの。Ctrl+C なら null。
 */
function askByNumber(d, heading, items, labels, fromKey) {
  say(d, heading);
  items.forEach((item, i) => d.stdout.write(`    ${i + 1}  ${labels[item]}\n`));
  if (!d.stdin.isTTY) return Promise.resolve(items[0]);
  return new Promise((resolvePromise) => {
    const stdin = d.stdin;
    /** @param {string | null} item */
    const done = (item) => {
      d.clearTimeout(timer);
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      resolvePromise(item);
    };
    /** @param {string} key */
    const onData = (key) => {
      if (key === '\u0003') return done(null);
      const item = fromKey(key);
      if (item !== null) done(item);
    };
    const timer = d.setTimeout(() => done(items[0]), MENU_TIMEOUT_MS);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

/**
 * @param {RunAppDeps} d
 * @returns {Promise<string | null>} 選んだ形。Ctrl+C なら null。
 */
// <!-- req webcorefoundation:f78481da.1ac1 --> <!-- req webcorefoundation:e1397463.c291 -->
function askMode(d) {
  return askByNumber(
    d,
    '起動の形を番号で選んでください（3 秒のあいだ何も押さなければ 1 で起動します）。',
    MODES,
    MODE_LABELS,
    modeFromKey,
  );
}

/**
 * @param {RunAppDeps} d
 * @returns {Promise<string | null>} 開くログ（4 番）。Ctrl+C なら null。
 */
function askLogTarget(d) {
  return askByNumber(
    d,
    'どちらのログを開くかを番号で選んでください（3 秒のあいだ何も押さなければ 1 の開発のときのログを開きます）。',
    LOG_TARGETS,
    LOG_TARGET_LABELS,
    logTargetFromKey,
  );
}

/**
 * 起動の前の確かめ（5.3 節）。どれも前と変わっていなければすぐに通り抜ける。
 * @param {RunAppDeps} d
 * @param {string} pm
 * @returns {boolean} 続けてよいか
 */
// <!-- req webcorefoundation:1068876c.7739 --> <!-- req webcorefoundation:a03addc9.cc5f --> <!-- req webcorefoundation:a7ed0e1c.a07e --> <!-- req webcorefoundation:e1397463.418f --> <!-- req webcorefoundation:e1397463.bc91 -->
function prepare(d, pm) {
  say(d, '手順 1/3：Node.js の版を確かめています。');
  const nvmrc = readOrNull(d, join(repoRoot, '.nvmrc')) ?? '';
  const version = checkNodeVersion(d.nodeVersion, nvmrc);
  if (!version.ok) {
    fail(d, version.message);
    return false;
  }

  say(d, '手順 2/3：依存のパッケージが今の pnpm-lock.yaml と合っているかを確かめています。');
  const lockText = readOrNull(d, join(repoRoot, 'pnpm-lock.yaml'));
  if (lockText === null) {
    fail(d, 'リポジトリ直下に pnpm-lock.yaml がありません。リポジトリを取り直してください。');
    return false;
  }
  const lockHash = sha256(lockText);
  const recordPath = join(repoRoot, 'node_modules', LOCK_RECORD_FILE);
  const hasNodeModules = d.existsSync(join(repoRoot, 'node_modules', '.pnpm'));
  if (needsInstall({ hasNodeModules, lockHash, recordedHash: readOrNull(d, recordPath) })) {
    say(d, `依存のパッケージを入れ直します（${pm} install）。数分かかることがあります。`);
    if (run(d, `${pm} install`, d.env) !== 0) {
      fail(
        d,
        `${pm} install が失敗しました。上の表示を読み、ネットワークにつながっているかを確かめてから開き直してください。`,
      );
      return false;
    }
    d.writeFileSync(recordPath, `${lockHash}\n`);
  }

  say(d, '手順 3/3：Electron の実行ファイルを確かめています。');
  if (needsElectronRebuild(electronState(d))) {
    say(d, `Electron の実行ファイルが無いので作り直します（${pm} --filter ${DESKTOP_PACKAGE} rebuild electron）。`);
    if (
      run(d, `${pm} --filter ${DESKTOP_PACKAGE} rebuild electron`, d.env) !== 0 ||
      needsElectronRebuild(electronState(d))
    ) {
      fail(d, `Electron を作り直せませんでした。「${pm} install」をもう一度打ってから開き直してください。`);
      return false;
    }
  }
  return true;
}

/**
 * @param {RunAppDeps} d
 * @returns {{ pathTxt: string | null, binaryExists: boolean }}
 */
function electronState(d) {
  try {
    const electronDir = d.electronDir();
    const pathTxt = readOrNull(d, join(electronDir, 'path.txt'));
    const binaryExists = pathTxt !== null && d.existsSync(join(electronDir, 'dist', pathTxt.trim()));
    return { pathTxt, binaryExists };
  } catch {
    return { pathTxt: null, binaryExists: false };
  }
}

/**
 * @param {RunAppDeps} d
 * @param {string} target `LOG_TARGETS` のどれか
 * @returns {string} ログのフォルダ
 */
function locateLogsDir(d, target) {
  const appData = d.env['APPDATA'] ?? join(d.env['USERPROFILE'] ?? '', 'AppData', 'Roaming');
  const userData = userDataDir(appData, target);
  const { dir, fromPointer } = logsDirFor(userData, readOrNull(d, join(userData, 'storage-pointer.json')));
  say(
    d,
    fromPointer
      ? `${LOG_TARGET_LABELS[target]}のフォルダ（保存先の記録から）: ${dir}`
      : `${LOG_TARGET_LABELS[target]}のフォルダ（保存先の記録が無いので既定の場所）: ${dir}`,
  );
  return dir;
}

/**
 * @param {RunAppDeps} d
 * @param {string} target `LOG_TARGETS` のどれか
 * @returns {number}
 */
// <!-- req webcorefoundation:0563e1d1.7bde -->
function openLogsFolder(d, target) {
  const dir = locateLogsDir(d, target);
  if (!d.existsSync(dir)) {
    say(d, 'ログのフォルダはまだありません。アプリを一度起動すると、上の場所にできます（ここでは作りません）。');
    return 0;
  }
  d.spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
  say(d, 'エクスプローラでログのフォルダを開きました。');
  return 0;
}

/** @param {RunAppDeps} d */
function openLogTailWindow(d) {
  // デバッグの形は開発で動かすので、開発のときのログを流す。
  const logFile = join(locateLogsDir(d, 'dev'), todayLogFileName(d.now()));
  const { file, args } = logTailLaunch(logTailScript(logFile));
  const result = d.spawnSync(file, args, { stdio: 'ignore', windowsVerbatimArguments: true });
  if (result.status !== 0) {
    fail(d, 'ログを流す窓を開けませんでした。4 番（ログを見る）でフォルダを開いて、その日のログを直接開いてください。');
    return;
  }
  say(d, 'その日のログを流し続ける窓を開きました。');
}

/**
 * @param {readonly string[]} argv
 * @param {RunAppDeps} d 打つ関数（台本の入口は `defaultDeps()`、テストは偽物）
 * @returns {Promise<number>} 終わりのコード（0 以外なら run-app.cmd が窓を止める）
 */
// <!-- req webcorefoundation:8bb46d4e.0f28 --> <!-- req webcorefoundation:cc4c9850.d5ad -->
export async function main(argv, d) {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'error') {
    fail(d, parsed.message);
    return 1;
  }
  const mode = parsed.kind === 'mode' ? parsed.mode : await askMode(d);
  if (mode === null) return 0;
  say(d, `「${MODE_LABELS[mode]}」で始めます。`);

  if (mode === 'logs') {
    const target = parsed.kind === 'mode' && parsed.logTarget ? parsed.logTarget : await askLogTarget(d);
    if (target === null) return 0;
    return openLogsFolder(d, target);
  }

  const pm = pnpmCommand(hasPnpmOnPath(d));
  if (pm !== 'pnpm')
    say(d, 'pnpm が見つからないので「corepack pnpm」を使います（「corepack enable」を一度打つと pnpm で呼べます）。');
  if (!prepare(d, pm)) return 1;

  if (mode === 'debug') openLogTailWindow(d);

  // Electron を GUI のアプリとして起動する（Node.js として動く設定が残っていると窓が開かない）。
  const baseEnv = { ...d.env };
  delete baseEnv['ELECTRON_RUN_AS_NODE'];
  const distExe =
    mode === 'dist' ? distPaths(desktopDir, d.readFileSync(join(desktopDir, BUILDER_CONFIG_FILE), 'utf8')).exe : '';
  for (const step of stepsFor(mode, pm, distExe)) {
    say(d, `${step.title}：${step.command}`);
    if (step.title.includes('起動')) say(d, '止めるときは、アプリの窓を閉じるか、この窓で Ctrl+C を押してください。');
    const env = step.debugEnv ? { ...baseEnv, [DEBUG_ENV]: '1' } : baseEnv;
    const code = run(d, step.command, env);
    if (code !== 0) {
      fail(
        d,
        `「${step.command}」が終わりのコード ${code} で止まりました。上の表示を読んで直してから開き直してください。`,
      );
      return code;
    }
  }
  say(d, 'アプリが終わりました。');
  return 0;
}

/**
 * 台本の入口の中身：main を打ち、終わりのコードで終える。思いがけないエラーは日本語の文を出して 1 で終える。
 * 入口の分かれ目（下の if）にはこの呼び出しだけを置き、処理はここでテストする（turn 184：分かれ目の中に置いた処理の不具合をカバレッジが数えなかった）。
 * @param {readonly string[]} argv
 * @param {RunAppDeps} d
 * @param {(code: number) => void} exit 終わらせる関数（台本の入口は process.exit）
 * @returns {Promise<void>}
 */
export function runEntry(argv, d, exit) {
  return main(argv, d).then(
    (code) => exit(code),
    (error) => {
      fail(
        d,
        `思いがけないエラーで止まりました（${error instanceof Error ? error.message : String(error)}）。` +
          'もう一度 run-app.cmd を開いてください。同じところで止まるときは、この窓の表示を残したまま知らせてください。',
      );
      exit(1);
    },
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
// (b) 入口は子のプロセスで打つテスト（UT-DEV-RUNAPP-59）で確かめ、カバレッジ（web-core-foundation.md 14.7 節）では数えない
/* v8 ignore if */
if (invokedDirectly) void runEntry(process.argv.slice(2), defaultDeps(), process.exit);
