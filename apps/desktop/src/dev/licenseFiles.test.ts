// UT-DEV-LICENSE: web-core-foundation.md §8.3 — 配布用のパッケージに表示義務のあるファイルが在るかの確かめ
// （apps/desktop/scripts/check-license-files.mjs）
// 検証観点: 全部在れば通る・1 つ欠けると欠けた名前を出して終わりのコード 1・見るファイルが electron-builder.yml と合う（C0/C1）。
// 本物の配布用のパッケージは作らず、OS の一時フォルダに置いた偽物で確かめる。

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { REQUIRED_LICENSE_FILES, checkLicenseFiles } from '../../scripts/check-license-files.mjs';

/** apps/desktop の場所。 */
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(desktopDir, 'scripts', 'check-license-files.mjs');

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 偽物のパッケージの直下を作り、`skip` 以外の表示義務のファイルを置く。 */
function fakePackage(skip: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'riffline-license-'));
  made.push(dir);
  for (const f of REQUIRED_LICENSE_FILES) {
    if (f === skip) continue;
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), 'license\n');
  }
  return dir;
}

describe('check-license-files.mjs', () => {
  it('checkLicenseFiles_10個全部在る_通る', () => {
    // UT-DEV-LICENSE-01 8.3 節「表示義務のあるもの（著作権表示とライセンス全文）が、配るパッケージに入っていること」
    expect(REQUIRED_LICENSE_FILES).toHaveLength(10);
    const result = checkLicenseFiles(fakePackage(null));
    expect(result).toEqual({ exitCode: 0, missing: [], message: expect.stringContaining('10 個') });
  });

  it('checkLicenseFiles_1つ欠ける_欠けた名前を出して終わりのコード1', () => {
    // UT-DEV-LICENSE-02 8.3 節「表示義務のあるファイルがパッケージの中に在るかを確かめるスクリプト…無ければ失敗させる」
    const lost = 'resources/licenses/zustand/LICENSE';
    const result = checkLicenseFiles(fakePackage(lost));
    expect(result.exitCode).toBe(1);
    expect(result.missing).toEqual([lost]);
    expect(result.message).toContain(lost);
  });

  it('checkLicenseFiles_パッケージが無い_終わりのコード1', () => {
    // UT-DEV-LICENSE-03 8.3 節「配布用のパッケージを作った後に」確かめるので、作っていなければ通さない
    const dir = join(fakePackage(null), 'none');
    const result = checkLicenseFiles(dir);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('pnpm --filter @riff-line/desktop dist');
  });

  it('スクリプトを打つ_1つ欠ける_欠けた名前を出して終わりのコード1', () => {
    // UT-DEV-LICENSE-04 8.3 節の「無ければ失敗させる」を、postdist と同じくスクリプトとして打って確かめる
    const lost = 'LICENSES.chromium.html';
    const broken = spawnSync(process.execPath, [script, fakePackage(lost)], { encoding: 'utf8' });
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain(lost);
    const whole = spawnSync(process.execPath, [script, fakePackage(null)], { encoding: 'utf8' });
    expect(whole.status).toBe(0);
  });

  it('見るファイル_electron-builderの設定ファイルが置くものと同じ', () => {
    // UT-DEV-LICENSE-05 8.3 節「確かめるファイルは、8.2 節で表示義務があると分かったものとする」。
    // 置く側（electron-builder.yml の extraResources）と見る側の一覧を 2 か所に持つので、食い違いをここで止める
    const config = readFileSync(join(desktopDir, 'electron-builder.yml'), 'utf8');
    const placed = [...config.matchAll(/^\s+to:\s*(\S+)\s*$/gm)].map((m) => `resources/${m[1]}`).sort();
    const checked = REQUIRED_LICENSE_FILES.filter((f) => f.startsWith('resources/')).sort();
    expect(checked).toEqual(placed);
  });
});
