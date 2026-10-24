// UT-DEV-DOCREF: web-core-foundation.md 14.4 節（採番簿の UT-DEV-DOCREF の行）— apps/ と packages/ のソースとテストの注が、
// 検証節: web-core-foundation.md 14.4 節 <!-- req webcorefoundation:c27f130d.80fd -->
// 今の設計書に在る節を指しているかの確かめ（apps/desktop/scripts/check-doc-refs.mjs）
// 検証観点: 見出しに無い番号を見つける・在る番号は通す・作り直す前の版を指す注は見ない・本書は対応タグから決める・
// 節の記号は基準線より増やさない（C0/C1）。下の偽物の注は、このファイル自身が確かめに当たらないよう文字列を分けて組む。

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SECTION_SIGN_BASELINE_FILE,
  checkDocRefs,
  docRefsReport,
  findDocRefProblems,
  headingNumbers,
  runDocRefsCheck,
  scannedFiles,
  tagPrefixOf,
} from '../../scripts/check-doc-refs.mjs';

/** リポジトリの直下。 */
const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const scriptsDir = join(repoDir, 'apps', 'desktop', 'scripts');

const SIGN = '§';
const MD = (name: string) => `${name}.md`;
const SETSU = '節';
/** 偽物の設計書の見出し。 */
const docs: Record<string, Set<string>> = {
  [MD('web-core-foundation')]: new Set(['9', '9.1', '9.2', '12', '12.1']),
  [MD('playback-integration')]: new Set(['8', '8.1']),
};
const headingsOf = (doc: string) => docs[doc] ?? null;
const byTag = new Map([
  ['webcorefoundation', MD('web-core-foundation')],
  ['playbackintegration', MD('playback-integration')],
]);
const tag = (prefix: string) => `<!-- req ${prefix}:0123abcd.4567 -->`;

describe('check-doc-refs.mjs', () => {
  it('headingNumbers_章と節の番号を拾う', () => {
    // UT-DEV-DOCREF-01 「<設計書のファイル名> N.N 節」の N.N を、そのファイルの見出しと突き合わせる
    const md = ['# 題', '## 12. 描画の窓口', '### 12.1 窓口のクラス', '#### 3.2.2 部分の差し替え', '本文 12.4'].join(
      '\n',
    );
    expect([...headingNumbers(md)].sort()).toEqual(['12', '12.1', '3.2.2']);
    expect(tagPrefixOf(MD('web-core-foundation'))).toBe('webcorefoundation');
  });

  it('findDocRefProblems_見出しに無い番号と無い設計書を見つける', () => {
    // UT-DEV-DOCREF-02 見出しに無い番号・設計書のフォルダに無いファイルは失敗
    const text = [
      `// ${MD('web-core-foundation')} 12.1 ${SETSU}：在る`,
      `// ${MD('web-core-foundation')} の 9.2 ${SETSU}：「の」を挟んでも在る`,
      `// ${MD('web-core-foundation')} 12.9 ${SETSU}：無い`,
      `// ${MD('no-such-doc')} 1 ${SETSU}：設計書が無い`,
    ].join('\n');
    const { problems } = findDocRefProblems(text, headingsOf, byTag);
    expect(problems.map((p) => p.line)).toEqual([3, 4]);
    expect(problems[0]?.reason).toContain('12.9');
    expect(problems[1]?.reason).toContain(MD('no-such-doc'));
  });

  it('findDocRefProblems_作り直す前の版を指す注は見ない', () => {
    // UT-DEV-DOCREF-03 版（コミット）を書いた注・「作り直す前の」と書いた注は確かめから外す
    const text = [
      `// 作り直す前の ${MD('web-core-foundation')} 3.5 ${SETSU}`,
      `// ${MD('web-core-foundation')} 3.5 ${SETSU}（\`2759936\` 時点）`,
    ].join('\n');
    expect(findDocRefProblems(text, headingsOf, byTag).problems).toEqual([]);
  });

  it('findDocRefProblems_本書は対応タグが1つの詳細設計を指すときだけ見る', () => {
    // UT-DEV-DOCREF-04 「本書 N.N 節」は、そのファイルの対応タグが指す詳細設計とみなす。2 つ以上なら決めにくいので見ない
    const own = `// 本書 8.2 ${SETSU} ${tag('playbackintegration')}`;
    expect(findDocRefProblems(own, headingsOf, byTag).problems.map((p) => p.reason)).toEqual([
      `本書（${MD('playback-integration')}）に 8.2 の見出しが無い`,
    ]);
    expect(
      findDocRefProblems(`// 本書 8.1 ${SETSU} ${tag('playbackintegration')}`, headingsOf, byTag).problems,
    ).toEqual([]);
    const two = `${own}\n// ${tag('webcorefoundation')}`;
    expect(findDocRefProblems(two, headingsOf, byTag).problems).toEqual([]);
    expect(findDocRefProblems(`// 本書 8.2 ${SETSU}`, headingsOf, byTag).problems).toEqual([]);
  });

  it('findDocRefProblems_節の記号を数える', () => {
    // UT-DEV-DOCREF-05 節の記号の形（「<ファイル名> 記号N」「本書 記号N」）は数え、基準線と比べる
    const text = `// ${MD('web-core-foundation')} ${SIGN}12.1・本書 ${SIGN}3\n// ${SIGN}9`;
    expect(findDocRefProblems(text, headingsOf, byTag).sectionSigns).toBe(3);
  });

  it('リポジトリ_注が指す節は今の設計書に在り_節の記号は基準線のとおり', () => {
    // UT-DEV-DOCREF-06 apps/ と packages/ の .ts・.tsx・.mjs・.css・.html・.yml・.cmd の全部。
    // 節の記号は「N.N 節」の形へ直していくので、基準線より増やさず、減ったら基準線を下げる
    const baseline = JSON.parse(readFileSync(join(scriptsDir, SECTION_SIGN_BASELINE_FILE), 'utf8')) as Record<
      string,
      number
    >;
    const files = scannedFiles(repoDir);
    expect(files).toContain('apps/desktop/src/main/main.ts');
    expect(files).toContain('apps/desktop/electron-builder.yml');
    expect(files).toContain('run-app.cmd');
    expect(files.some((f) => f.includes('node_modules') || f.startsWith('apps/desktop/dist'))).toBe(false);
    const result = checkDocRefs(repoDir, baseline);
    expect(result.problems).toEqual([]);
    expect(result.overBaseline).toEqual([]);
    expect(result.belowBaseline).toEqual([]);
  });

  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  /** OS の一時フォルダに、設計書 2 つとソース 3 つの偽物のリポジトリを作る。 */
  function fakeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'riffline-docrefs-'));
    made.push(dir);
    const put = (rel: string, text: string) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    put(`docs/detailed_design/${MD('web-core-foundation')}`, '## 12. 窓口\n### 12.1 クラス\n');
    put(`docs/basic_design/${MD('11_test_strategy')}`, '## 3. 採番\n### 3.1 表\n');
    put(
      'apps/a.ts',
      [
        `// ${MD('web-core-foundation')} 12.9 ${SETSU}`,
        `// ${MD('11_test_strategy')} 3.1 ${SETSU}`,
        `// ${MD('no-such')} 1 ${SETSU}`,
        `// ${SIGN}3 ${SIGN}4`,
      ].join('\n'),
    );
    put('packages/b.ts', `// ${SIGN}1\n`);
    put('packages/c.ts', `// ${SIGN}1\n`);
    return dir;
  }

  it('checkDocRefs_ファイルごとの問題と_基準線より増えた所と減った所を並べる', () => {
    // UT-DEV-DOCREF-07 設計書は詳細設計と基本設計のフォルダから探し、無い番号・無い設計書を「場所:行」で出す。
    // 節の記号は基準線より増えたら直す、減ったら基準線を下げる（基準線に無いファイルは 0、無くなったファイルも 0 として比べる）
    const result = checkDocRefs(fakeRepo(), { 'apps/a.ts': 1, 'packages/b.ts': 5, 'apps/gone.ts': 2 });
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatch(/^apps\/a\.ts:1 .*12\.9 の見出しが無い$/);
    expect(result.problems[1]).toMatch(/^apps\/a\.ts:3 .*が設計書のフォルダに無い$/);
    expect(result.sectionSigns).toEqual({ 'apps/a.ts': 2, 'packages/b.ts': 1, 'packages/c.ts': 1 });
    expect(result.overBaseline).toHaveLength(2);
    expect(result.overBaseline[0]).toMatch(/^apps\/a\.ts：.* 2 個（基準線 1）/);
    expect(result.overBaseline[1]).toMatch(/^packages\/c\.ts：.* 1 個（基準線 0）/);
    expect(result.belowBaseline).toHaveLength(2);
    expect(result.belowBaseline[0]).toMatch(/^packages\/b\.ts：.* 1 個に減った（基準線 5）/);
    expect(result.belowBaseline[1]).toMatch(/^apps\/gone\.ts：.* 0 個に減った（基準線 2）/);
  });

  it('docRefsReport_見つかったものがあれば終わりのコード1と件数_無ければ0', () => {
    // UT-DEV-DOCREF-08 見つかったもの（指す先の無い注・基準線より増えた・減った）を全部並べて失敗させる
    expect(docRefsReport({ problems: ['p'], overBaseline: ['o'], belowBaseline: ['b'] })).toEqual({
      exitCode: 1,
      message: '[check-doc-refs] 3 件\np\no\nb',
    });
    expect(docRefsReport({ problems: [], overBaseline: [], belowBaseline: [] })).toEqual({
      exitCode: 0,
      message: expect.stringContaining('どれも今の設計書に在ります'),
    });
  });

  it('本書は詳細設計に無い頭の対応タグでは決めず_無いフォルダには降りない', () => {
    // UT-DEV-DOCREF-10 対応タグの頭が詳細設計のどのファイルにも当たらなければ本書は決まらないので「本書 N.N 節」は見ない。
    // apps と packages のどちらかが無いリポジトリでも、在る方だけを見る
    expect(findDocRefProblems(`// 本書 8.2 ${SETSU} ${tag('nosuchdoc')}`, headingsOf, byTag).problems).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), 'riffline-docrefs-'));
    made.push(dir);
    mkdirSync(join(dir, 'apps'));
    writeFileSync(join(dir, 'apps', 'x.ts'), '// x\n');
    expect(scannedFiles(dir)).toEqual(['apps/x.ts']);
  });

  it('スクリプトを打つ_今のリポジトリ_終わりのコード0', () => {
    // UT-DEV-DOCREF-09 スクリプトとして打っても、今のリポジトリの注が指す節は全部在るので通る（入口の配線の確かめ）
    const run = spawnSync(process.execPath, [join(scriptsDir, 'check-doc-refs.mjs')], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('どれも今の設計書に在ります');
  });

  it('runDocRefsCheck_見つかれば文を誤りの側に出して1_無ければ通常の側に出して0', () => {
    // UT-DEV-DOCREF-11 台本の入口の中身を分かれ目の外で確かめる（turn 184：分かれ目の中の処理をカバレッジが数えなかった）
    const lines = { log: [] as string[], error: [] as string[] };
    const out = { log: (t: string) => lines.log.push(t), error: (t: string) => lines.error.push(t) };
    const fakeScripts = join(fakeRepo(), 'apps', 'desktop', 'scripts');
    mkdirSync(fakeScripts, { recursive: true });
    writeFileSync(join(fakeScripts, SECTION_SIGN_BASELINE_FILE), '{}');
    expect(runDocRefsCheck(fakeScripts, out)).toBe(1);
    expect(lines.error.join('')).toContain('12.9 の見出しが無い');
    expect(runDocRefsCheck(scriptsDir, out)).toBe(0);
    expect(lines.log.join('')).toContain('どれも今の設計書に在ります');
  });
});
