/**
 * 配布用のパッケージの中に、表示義務のあるファイルが在るかを確かめる（web-core-foundation.md 8.3 節の出荷の条件の 1 つ目）。
 * 「ライセンスを確認した」の記述ではなく、ファイルが在ることで決める。無ければ終わりのコード 1 で失敗させる。
 * package.json の postdist で、electron-builder がパッケージを作った後に走る。
 * 8.3 節の出荷の条件の 1 つ目（機械の確かめ） <!-- req webcorefoundation:738c2fa6.7812 --> <!-- req webcorefoundation:738c2fa6.03ac --> <!-- req webcorefoundation:738c2fa6.f443 --> <!-- req webcorefoundation:80a2d989.bdf0 --> <!-- req webcorefoundation:80a2d989.f8ea --> <!-- req webcorefoundation:80a2d989.e8eb --> <!-- req webcorefoundation:80a2d989.360d --> <!-- req webcorefoundation:80a2d989.5912 --> <!-- req webcorefoundation:549bead7.2fe0 --> <!-- req webcorefoundation:549bead7.6edc --> <!-- req webcorefoundation:549bead7.70d3 --> <!-- req webcorefoundation:684a4f9d.8b17 -->
 *
 * 見るファイル（8.2 節で表示義務があると分かったもの）：
 *  - Electron（MIT と Chromium の各ライセンス）：electron-builder がパッケージの直下に置く LICENSE.electron.txt・LICENSES.chromium.html
 *  - alphaTab（MPL-2.0）：LICENSE と、組み込んだ部品のライセンスの LICENSE.header（fork を配るときは fork の LICENSE をここに置く、8.3 節）
 *  - 同梱の SoundFont：dist/soundfont/LICENSE と、音源の出どころの README.md
 *  - 同梱の Bravura フォント（SIL OFL 1.1、フォントと一緒に配る）と、レンダラーに組み込む React・React DOM・Zustand（MIT の全文）
 * alphaTab と SoundFont の分は Phase 0 の確認（8.2 節の最後）の結果で当てはめ直す。
 * 表示義務のあるものはクレジットの画面にも載せる（ライブラリ名・ライセンスの種類・条項へのリンクの配列。作業パッケージ 8 の screens-navigation.md） <!-- req webcorefoundation:884fa8ed.d662 --> <!-- req webcorefoundation:884fa8ed.fd09 --> <!-- req webcorefoundation:884fa8ed.ec35 --> <!-- req webcorefoundation:884fa8ed.e32e --> <!-- req webcorefoundation:884fa8ed.6f71 --> <!-- req webcorefoundation:884fa8ed.1353 -->
 * 8.2 節：alphaTab と SoundFont のライセンスファイル（LICENSE・LICENSE.header・dist/soundfont/LICENSE・README.md）は Phase 0 で開いて確定させる。fork の LICENSE と LICENSE.header は本家のまま残す <!-- req webcorefoundation:6a296a99.160d --> <!-- req webcorefoundation:6a296a99.8e89 --> <!-- req webcorefoundation:6a296a99.c48b --> <!-- req webcorefoundation:6a296a99.8125 --> <!-- req webcorefoundation:6a296a99.e310 --> <!-- req webcorefoundation:6a296a99.51a0 --> <!-- req webcorefoundation:8c48dece.fe18 --> <!-- req webcorefoundation:8c48dece.c999 --> <!-- req webcorefoundation:8c48dece.3479 --> <!-- req webcorefoundation:8c48dece.eb27 --> <!-- req webcorefoundation:8c48dece.2979 --> <!-- req webcorefoundation:8c48dece.3c74 --> <!-- req webcorefoundation:8c48dece.cf27 --> <!-- req webcorefoundation:e65e8ef6.628a --> <!-- req webcorefoundation:2be6035a.98a2 --> <!-- req webcorefoundation:2be6035a.5938 --> <!-- req webcorefoundation:2be6035a.cde6 -->
 * 8.2 節：ライブラリとアセットを採用するときと版を上げるときに、同じ PR で配布元のライセンスファイルを開いて (1)〜(4) を読む <!-- req webcorefoundation:9cf58245.2d86 --> <!-- req webcorefoundation:9cf58245.0409 --> <!-- req webcorefoundation:9cf58245.5283 --> <!-- req webcorefoundation:9cf58245.99fb --> <!-- req webcorefoundation:9cf58245.6102 --> <!-- req webcorefoundation:9cf58245.d120 --> <!-- req webcorefoundation:9cf58245.3f05 --> <!-- req webcorefoundation:4a2eb435.202e --> <!-- req webcorefoundation:4a2eb435.6b20 --> <!-- req webcorefoundation:4a2eb435.9ab0 --> <!-- req webcorefoundation:e4e3ebf8.79dd --> <!-- req webcorefoundation:e4e3ebf8.b2fa --> <!-- req webcorefoundation:e4e3ebf8.415e --> <!-- req webcorefoundation:e4e3ebf8.7439 --> <!-- req webcorefoundation:e4e3ebf8.c3cb --> <!-- req webcorefoundation:ec3c3335.ec2d --> <!-- req webcorefoundation:ec3c3335.79c3 --> <!-- req webcorefoundation:e1672b2d.1cca --> <!-- req webcorefoundation:e1672b2d.8bca --> <!-- req webcorefoundation:e1672b2d.ca0d -->
 * 出荷の条件の 2 つ目（再配布の条件と開示義務、fork で直したファイルのソースの公開）は、出荷の前に人が突き合わせる（作業パッケージ 9） <!-- req webcorefoundation:b37cc171.d3e6 --> <!-- req webcorefoundation:b37cc171.1f9c --> <!-- req webcorefoundation:b37cc171.89d8 --> <!-- req webcorefoundation:684a4f9d.ec10 --> <!-- req webcorefoundation:41851033.d110 --> <!-- req webcorefoundation:41851033.e5ad --> <!-- req webcorefoundation:1df75e46.799d --> <!-- req webcorefoundation:1df75e46.16bd --> <!-- req webcorefoundation:1df75e46.8439 --> <!-- req webcorefoundation:1df75e46.7657 -->
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILDER_CONFIG_FILE, distPaths } from './run-app.mjs';

/** パッケージの直下（win-unpacked）からの場所。 */
export const REQUIRED_LICENSE_FILES = [
  'LICENSE.electron.txt',
  'LICENSES.chromium.html',
  'resources/licenses/alphatab/LICENSE',
  'resources/licenses/alphatab/LICENSE.header',
  'resources/licenses/alphatab-soundfont/LICENSE',
  'resources/licenses/alphatab-soundfont/README.md',
  'resources/licenses/bravura-font/OFL.txt',
  'resources/licenses/react/LICENSE',
  'resources/licenses/react-dom/LICENSE',
  'resources/licenses/zustand/LICENSE',
];

/**
 * 無いファイルの並びを返す（空なら全部在る）。
 * @param {string} packageDir パッケージの直下
 * @param {(path: string) => boolean} exists
 */
export function missingLicenseFiles(packageDir, exists = existsSync) {
  return REQUIRED_LICENSE_FILES.filter((f) => !exists(join(packageDir, f)));
}

/**
 * 確かめの中身（副作用なし）。パッケージが無い・ファイルが欠けているときは終わりのコード 1 と、欠けた名前を入れた文を返す。
 * 単体テストは apps/desktop/src/dev/licenseFiles.test.ts（UT-DEV-LICENSE）。 <!-- req webcorefoundation:93525667.da40 -->
 * @param {string} packageDir パッケージの直下
 * @param {(path: string) => boolean} exists
 * @returns {{ exitCode: 0 | 1, missing: string[], message: string }}
 */
export function checkLicenseFiles(packageDir, exists = existsSync) {
  if (!exists(packageDir)) {
    return {
      exitCode: 1,
      missing: [],
      message: `[check-license-files] 配布用のパッケージが見つかりません（${packageDir}）。先に pnpm --filter @riff-line/desktop dist を打ってください。`,
    };
  }
  const missing = missingLicenseFiles(packageDir, exists);
  if (missing.length > 0) {
    return {
      exitCode: 1,
      missing,
      message: `[check-license-files] 表示義務のあるファイルがパッケージに入っていません（8.3 節）：${missing.join('・')}`,
    };
  }
  return {
    exitCode: 0,
    missing: [],
    message: `[check-license-files] 表示義務のあるファイル ${REQUIRED_LICENSE_FILES.length} 個が、パッケージに入っています。`,
  };
}

/**
 * 台本の入口の中身：場所を渡されればそこを、渡されなければ electron-builder.yml の出力の場所のパッケージを確かめ、結果を出して終わりのコードを返す。
 * 入口の分かれ目（下の if）にはこの呼び出しだけを置き、処理はここでテストする（turn 184：分かれ目の中に置いた処理をカバレッジが数えなかった）。
 * @param {string | undefined} packageArg 打つときに渡した場所
 * @param {string} desktopDir apps/desktop の場所
 * @param {{ log: (text: string) => void, error: (text: string) => void }} out
 * @returns {number}
 */
export function runLicenseCheck(packageArg, desktopDir, out) {
  const packageDir = packageArg
    ? resolve(packageArg)
    : distPaths(desktopDir, readFileSync(join(desktopDir, BUILDER_CONFIG_FILE), 'utf8')).dir;
  const result = checkLicenseFiles(packageDir);
  if (result.exitCode !== 0) out.error(result.message);
  else out.log(result.message);
  return result.exitCode;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// (b) 入口は子のプロセスで打つテスト（UT-DEV-LICENSE-04・06）で確かめ、カバレッジ（web-core-foundation.md 14.7 節）では数えない
/* v8 ignore if */
if (isMain)
  process.exit(runLicenseCheck(process.argv[2], resolve(dirname(fileURLToPath(import.meta.url)), '..'), console));
