/**
 * apps/ と packages/ のソースとテストの注が、今の設計書に在る節を指しているかを確かめる（単体テストは
 * apps/desktop/src/dev/docRefs.test.ts、UT-DEV-DOCREF。基本設計 11 章 3.1 節と web-core-foundation.md 14.4 節の採番簿）。 <!-- req webcorefoundation:a2527f44.80fd --> <!-- req webcorefoundation:90add280.a681 -->
 *
 * 拾う形は 3 つ：
 *  - 「<設計書のファイル名> N.N 節」（「<ファイル名> の N.N 節」も）：そのファイルの見出しに N.N が在ること
 *  - 「本書 N.N 節」：そのファイルの対応タグが指す詳細設計を本書とみなし、その見出しに N.N が在ること。
 *    対応タグが 1 つの詳細設計だけを指すときだけ見る（2 つ以上か、無いときは本書を決めにくいので見ない）
 *  - 節の記号（U+00A7）と番号の形：番号の書き方を「N.N 節」にそろえる。今あるものは基準線（下の SECTION_SIGN_BASELINE_FILE）の数までにし、増やさない
 * 版（コミットの番号）を書いた注と「作り直す前の」と書いた注は、作り直す前の版を指しているので見ない。
 * 番号が在るかだけを見るので、番号は在るが別の節を指している注は見つけられない。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 見るファイルの拡張子。 */
export const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.css', '.html', '.yml', '.cmd'];

/** 降りないフォルダ（作ったもの・入れたもの）。 */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'out', 'release', 'coverage']);

/** git で追いかけない置き場所（alphaTab の資産を写す先）。 */
const SKIPPED_PATHS = new Set(['apps/desktop/src/renderer/public']);

/** 設計書を探すフォルダ（リポジトリからの場所）。 */
export const DOC_DIRS = ['docs/detailed_design', 'docs/basic_design'];

/** 節の記号の数の基準線（リポジトリからのファイルの場所 → 数）を置くファイル。apps/desktop/scripts からの場所。 */
export const SECTION_SIGN_BASELINE_FILE = 'doc-refs-section-sign-baseline.json';

const SECTION_SIGN = '§';
const NUMBER = String.raw`(\d+(?:\.\d+)*)`;
const DOC_REF = new RegExp(String.raw`([A-Za-z0-9_-]+\.md)\s*(?:の\s*)?${NUMBER}\s*節`, 'g');
const OWN_DOC_REF = new RegExp(String.raw`本書\s*(?:の\s*)?${NUMBER}\s*節`, 'g');
const TAG = new RegExp(`${'<!-'}- req ([a-z0-9]+):[0-9a-f]{8}\\.[0-9a-f]{4} -->`, 'g');
const OLD_VERSION = /`[0-9a-f]{7,40}`|作り直す前の/;

/**
 * 設計書の見出しの番号の集まり（「## 12. 描画の窓口」は 12、「### 12.1 窓口のクラス」は 12.1）。
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function headingNumbers(markdown) {
  const numbers = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^#{1,6}\s+(\d+(?:\.\d+)*)\.?(?:\s|$)/.exec(line);
    if (m) numbers.add(m[1]);
  }
  return numbers;
}

/**
 * 対応タグの頭（`webcorefoundation` など）。詳細設計のファイル名から英数字だけを残して小文字にしたもの。
 * @param {string} docFile `web-core-foundation.md`
 */
export function tagPrefixOf(docFile) {
  return docFile
    .replace(/\.md$/, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

/**
 * 1 つのファイルの中の、指す先が見つからない注と、節の記号の数（副作用なし）。
 * @param {string} text ファイルの中身
 * @param {(docFile: string) => Set<string> | null} headingsOf 設計書の見出しの番号（無い設計書は null）
 * @param {Map<string, string>} docByTagPrefix 対応タグの頭 → 詳細設計のファイル名
 * @returns {{ problems: { line: number, ref: string, reason: string }[], sectionSigns: number }}
 */
export function findDocRefProblems(text, headingsOf, docByTagPrefix) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  const ownDocs = new Set();
  for (const m of text.matchAll(TAG)) {
    const doc = docByTagPrefix.get(m[1]);
    if (doc) ownDocs.add(doc);
  }
  const ownDoc = ownDocs.size === 1 ? [...ownDocs][0] : null;
  let sectionSigns = 0;
  lines.forEach((line, i) => {
    sectionSigns += line.split(SECTION_SIGN).length - 1;
    if (OLD_VERSION.test(line)) return;
    for (const m of line.matchAll(DOC_REF)) {
      const numbers = headingsOf(m[1]);
      if (numbers === null) problems.push({ line: i + 1, ref: m[0], reason: `${m[1]} が設計書のフォルダに無い` });
      else if (!numbers.has(m[2]))
        problems.push({ line: i + 1, ref: m[0], reason: `${m[1]} に ${m[2]} の見出しが無い` });
    }
    if (ownDoc === null) return;
    for (const m of line.matchAll(OWN_DOC_REF)) {
      const numbers = headingsOf(ownDoc);
      if (numbers !== null && !numbers.has(m[1])) {
        problems.push({ line: i + 1, ref: m[0], reason: `本書（${ownDoc}）に ${m[1]} の見出しが無い` });
      }
    }
  });
  return { problems, sectionSigns };
}

/**
 * apps/ と packages/ の中と、リポジトリ直下（起動の口の run-app.cmd）の見るファイル（リポジトリからの場所、/ 区切り、並べたもの）。
 * @param {string} repoDir
 */
export function scannedFiles(repoDir) {
  const out = readdirSync(repoDir).filter(
    (name) => SCANNED_EXTENSIONS.includes(extname(name)) && statSync(join(repoDir, name)).isFile(),
  );
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = relative(repoDir, path).replace(/\\/g, '/');
      if (statSync(path).isDirectory()) {
        if (!SKIPPED_DIRS.has(name) && !SKIPPED_PATHS.has(rel)) walk(path);
      } else if (SCANNED_EXTENSIONS.includes(extname(name))) {
        out.push(rel);
      }
    }
  };
  for (const top of ['apps', 'packages']) {
    if (existsSync(join(repoDir, top))) walk(join(repoDir, top));
  }
  return out.sort();
}

/**
 * リポジトリ全体の確かめ。
 * @param {string} repoDir
 * @param {Record<string, number>} baseline 節の記号の数の基準線
 * @returns {{ problems: string[], overBaseline: string[], belowBaseline: string[], sectionSigns: Record<string, number> }}
 */
export function checkDocRefs(repoDir, baseline) {
  const cache = new Map();
  const headingsOf = (docFile) => {
    if (!cache.has(docFile)) {
      const dir = DOC_DIRS.find((d) => existsSync(join(repoDir, d, docFile)));
      cache.set(docFile, dir ? headingNumbers(readFileSync(join(repoDir, dir, docFile), 'utf8')) : null);
    }
    return cache.get(docFile);
  };
  const docByTagPrefix = new Map(
    readdirSync(join(repoDir, DOC_DIRS[0]))
      .filter((f) => f.endsWith('.md'))
      .map((f) => [tagPrefixOf(f), f]),
  );
  const problems = [];
  const sectionSigns = {};
  for (const rel of scannedFiles(repoDir)) {
    const result = findDocRefProblems(readFileSync(join(repoDir, rel), 'utf8'), headingsOf, docByTagPrefix);
    for (const p of result.problems) problems.push(`${rel}:${p.line} 「${p.ref}」 ${p.reason}`);
    if (result.sectionSigns > 0) sectionSigns[rel] = result.sectionSigns;
  }
  const overBaseline = Object.entries(sectionSigns)
    .filter(([rel, n]) => n > (baseline[rel] ?? 0))
    .map(([rel, n]) => `${rel}：${SECTION_SIGN} が ${n} 個（基準線 ${baseline[rel] ?? 0}）。「N.N 節」の形で書く`);
  const belowBaseline = Object.entries(baseline)
    .filter(([rel, n]) => (sectionSigns[rel] ?? 0) < n)
    .map(
      ([rel, n]) => `${rel}：${SECTION_SIGN} が ${sectionSigns[rel] ?? 0} 個に減った（基準線 ${n}）。基準線を下げる`,
    );
  return { problems, overBaseline, belowBaseline, sectionSigns };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const repoDir = resolve(scriptsDir, '..', '..', '..');
  const baseline = JSON.parse(readFileSync(join(scriptsDir, SECTION_SIGN_BASELINE_FILE), 'utf8'));
  const result = checkDocRefs(repoDir, baseline);
  const lines = [...result.problems, ...result.overBaseline, ...result.belowBaseline];
  if (lines.length > 0) {
    console.error(`[check-doc-refs] ${lines.length} 件\n${lines.join('\n')}`);
    process.exit(1);
  }
  console.log('[check-doc-refs] 注が指す設計書の節は、どれも今の設計書に在ります。');
}
