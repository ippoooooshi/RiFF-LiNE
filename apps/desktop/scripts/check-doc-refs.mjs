/**
 * apps/ と packages/ のソースとテストの注が、今の設計書に在る節を指しているかを確かめる（単体テストは
 * apps/desktop/src/dev/docRefs.test.ts、UT-DEV-DOCREF。基本設計 11 章 3.1 節と web-core-foundation.md 14.4 節の採番簿）。 <!-- req webcorefoundation:0d5244ae.a681 -->
 * 15.9 節：基本設計書と実装が離れる状態と、詳細設計書と実装が離れる状態を防ぎ、次にその機能を触るセッションが古い設計書を信じるおそれを防ぐため、
 * 注が指す節が今の設計書に在るかを機械で確かめる <!-- req webcorefoundation:a08f997e.d2bb --> <!-- req webcorefoundation:a08f997e.77e3 --> <!-- req webcorefoundation:a08f997e.5e4b -->
 *
 * 拾う形は 4 つ：
 *  - 「<設計書のファイル名> N.N 節」（「<ファイル名> の N.N 節」「<ファイル名>、N.N 節」、番号を「・」「、」「,」「と」で
 *    並べた「<ファイル名> N.N・N.N 節」も）：そのファイルの見出しに、並べた番号の全部が在ること。在らなければ失敗
 *  - 「本書 N.N 節」：そのファイルの対応タグが指す詳細設計を本書とみなし、その見出しに N.N が在ること。
 *    対応タグが 1 つの詳細設計だけを指すときだけ見る（2 つ以上か、無いときは本書を決めにくいので見ない）
 *  - 「<設計書のファイル名> 記号N.N」「本書 記号N.N」（記号は節の記号 U+00A7。「記号N.N・記号N.N」と並べたものも）：
 *    番号が見出しに在るかを同じように見る。今の設計書に無い節を指すものは、ファイルごとの数を基準線
 *    （下の MISSING_SECTION_BASELINE_FILE）までにし、増やさない（「N.N 節」の形へ書き直すときに指す先を直す）
 *  - 節の記号と番号の形：番号の書き方を「N.N 節」にそろえる。今あるものは基準線（下の SECTION_SIGN_BASELINE_FILE）の数までにし、増やさない
 * 版（コミットの番号）を書いた注と「作り直す前の」と書いた注は、作り直す前の版を指しているので見ない。
 * 番号が在るかだけを見るので、番号は在るが別の節を指している注は見つけられない。
 * 拾わない形：ファイル名に「.md」を付けない書き方（「editing-core 7.2 節」）、見出しへのリンク（「[[ファイル名#3]]」）、
 * 「節」も記号も付けない番号（「ファイル名 5.3)」）。
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

/**
 * 節の記号の形のうち、今の設計書に無い節を指すものの数の基準線（リポジトリからのファイルの場所 → 数）を置くファイル。
 * apps/desktop/scripts からの場所。無ければ全部のファイルを 0 として比べる。
 */
export const MISSING_SECTION_BASELINE_FILE = 'doc-refs-missing-section-baseline.json';

const SECTION_SIGN = '§';
const ONE_NUMBER = String.raw`\d+(?:\.\d+)*`;
const ALL_NUMBERS = new RegExp(ONE_NUMBER, 'g');
const SEPARATOR = String.raw`\s*[・、,と]\s*`;
/** 番号を 1 つか、区切りで並べたもの（「12.1・12.2」）。 */
const NUMBER_LIST = String.raw`(${ONE_NUMBER}(?:${SEPARATOR}${ONE_NUMBER})*)`;
/** 節の記号つきの番号を 1 つか、区切りで並べたもの（「記号12.1・記号12.2」。2 つ目からも記号が要る）。 */
const SIGN_LIST = String.raw`${SECTION_SIGN}\s*(${ONE_NUMBER}(?:${SEPARATOR}${SECTION_SIGN}\s*${ONE_NUMBER})*)`;
/** 設計書のファイル名と、その後ろの空白・読点・「の」。 */
const DOC_FILE = String.raw`([A-Za-z0-9_-]+\.md)\s*[、,]?\s*(?:の\s*)?`;
const OWN_DOC = String.raw`本書\s*(?:の\s*)?`;
const DOC_REF = new RegExp(String.raw`${DOC_FILE}${NUMBER_LIST}\s*節`, 'g');
const OWN_DOC_REF = new RegExp(String.raw`${OWN_DOC}${NUMBER_LIST}\s*節`, 'g');
const DOC_SIGN_REF = new RegExp(`${DOC_FILE}${SIGN_LIST}`, 'g');
const OWN_DOC_SIGN_REF = new RegExp(`${OWN_DOC}${SIGN_LIST}`, 'g');
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
 * 1 つのファイルの中の、指す先が見つからない注（「N.N 節」の形は problems、節の記号の形は signProblems）と、
 * 節の記号の数（副作用なし）。
 * @param {string} text ファイルの中身
 * @param {(docFile: string) => Set<string> | null} headingsOf 設計書の見出しの番号（無い設計書は null）
 * @param {Map<string, string>} docByTagPrefix 対応タグの頭 → 詳細設計のファイル名
 * @returns {{ problems: { line: number, ref: string, reason: string }[], signProblems: { line: number, ref: string, reason: string }[], sectionSigns: number }}
 */
export function findDocRefProblems(text, headingsOf, docByTagPrefix) {
  const problems = [];
  const signProblems = [];
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
    /** 並べた番号の 1 つずつを、設計書の見出しと突き合わせる。label は理由の文の頭（「<ファイル名> 」「本書（<ファイル名>）」）。 */
    const check = (out, docFile, label, ref, numberList) => {
      const numbers = headingsOf(docFile);
      if (numbers === null) {
        out.push({ line: i + 1, ref, reason: `${docFile} が設計書のフォルダに無い` });
        return;
      }
      for (const n of numberList.match(ALL_NUMBERS)) {
        if (!numbers.has(n)) out.push({ line: i + 1, ref, reason: `${label}に ${n} の見出しが無い` });
      }
    };
    for (const m of line.matchAll(DOC_REF)) check(problems, m[1], `${m[1]} `, m[0], m[2]);
    for (const m of line.matchAll(DOC_SIGN_REF)) check(signProblems, m[1], `${m[1]} `, m[0], m[2]);
    if (ownDoc === null) return;
    for (const m of line.matchAll(OWN_DOC_REF)) check(problems, ownDoc, `本書（${ownDoc}）`, m[0], m[1]);
    for (const m of line.matchAll(OWN_DOC_SIGN_REF)) check(signProblems, ownDoc, `本書（${ownDoc}）`, m[0], m[1]);
  });
  return { problems, signProblems, sectionSigns };
}

/**
 * ファイルごとの数を基準線と比べる（副作用なし）。基準線に無いファイルは 0、数えて 0 だったファイルも 0 として比べる。
 * @param {Record<string, number>} counts
 * @param {Record<string, number>} baseline
 * @param {(rel: string, n: number, base: number) => string} overText 基準線より増えたときの文
 * @param {(rel: string, n: number, base: number) => string} belowText 基準線より減ったときの文
 * @returns {{ over: string[], below: string[] }}
 */
export function compareWithBaseline(counts, baseline, overText, belowText) {
  const over = Object.entries(counts)
    .filter(([rel, n]) => n > (baseline[rel] ?? 0))
    .map(([rel, n]) => overText(rel, n, baseline[rel] ?? 0));
  const below = Object.entries(baseline)
    .filter(([rel, n]) => (counts[rel] ?? 0) < n)
    .map(([rel, n]) => belowText(rel, counts[rel] ?? 0, n));
  return { over, below };
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
 * @param {Record<string, number>} [missingBaseline] 節の記号の形で今の設計書に無い節を指すものの数の基準線
 * @returns {{ problems: string[], overBaseline: string[], belowBaseline: string[], sectionSigns: Record<string, number>, missingSections: Record<string, number> }}
 */
export function checkDocRefs(repoDir, baseline, missingBaseline = {}) {
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
  const missingSections = {};
  const missingRefs = {};
  for (const rel of scannedFiles(repoDir)) {
    const result = findDocRefProblems(readFileSync(join(repoDir, rel), 'utf8'), headingsOf, docByTagPrefix);
    for (const p of result.problems) problems.push(`${rel}:${p.line} 「${p.ref}」 ${p.reason}`);
    if (result.sectionSigns > 0) sectionSigns[rel] = result.sectionSigns;
    if (result.signProblems.length > 0) {
      missingSections[rel] = result.signProblems.length;
      missingRefs[rel] = result.signProblems.map((p) => `${p.line} 行「${p.ref}」 ${p.reason}`).join('、');
    }
  }
  const signs = compareWithBaseline(
    sectionSigns,
    baseline,
    (rel, n, base) => `${rel}：${SECTION_SIGN} が ${n} 個（基準線 ${base}）。「N.N 節」の形で書く`,
    (rel, n, base) => `${rel}：${SECTION_SIGN} が ${n} 個に減った（基準線 ${base}）。基準線を下げる`,
  );
  const missing = compareWithBaseline(
    missingSections,
    missingBaseline,
    (rel, n, base) =>
      `${rel}：今の設計書に無い節を指す ${SECTION_SIGN} の注が ${n} 個（基準線 ${base}）。今ある節を「N.N 節」の形で指す：${missingRefs[rel]}`,
    (rel, n, base) =>
      `${rel}：今の設計書に無い節を指す ${SECTION_SIGN} の注が ${n} 個に減った（基準線 ${base}）。${MISSING_SECTION_BASELINE_FILE} を下げる`,
  );
  return {
    problems,
    overBaseline: [...signs.over, ...missing.over],
    belowBaseline: [...signs.below, ...missing.below],
    sectionSigns,
    missingSections,
  };
}

/**
 * 確かめの結果から、終わりのコードと出す文を決める（副作用なし）。見つかったものがあれば 1 と件数と並び、無ければ 0。
 * @param {{ problems: string[], overBaseline: string[], belowBaseline: string[] }} result checkDocRefs の結果
 * @returns {{ exitCode: 0 | 1, message: string }}
 */
export function docRefsReport(result) {
  const lines = [...result.problems, ...result.overBaseline, ...result.belowBaseline];
  if (lines.length > 0) return { exitCode: 1, message: `[check-doc-refs] ${lines.length} 件\n${lines.join('\n')}` };
  return { exitCode: 0, message: '[check-doc-refs] 注が指す設計書の節は、どれも今の設計書に在ります。' };
}

/**
 * 台本の入口の中身：リポジトリの注を確かめ、結果を出して終わりのコードを返す。
 * 入口の分かれ目（下の if）にはこの呼び出しだけを置き、処理はここでテストする（turn 184：分かれ目の中に置いた処理をカバレッジが数えなかった）。
 * @param {string} scriptsDir apps/desktop/scripts の場所（基準線のファイルの置き場所。リポジトリの直下はその 3 つ上）
 * @param {{ log: (text: string) => void, error: (text: string) => void }} out
 * @returns {number}
 */
export function runDocRefsCheck(scriptsDir, out) {
  const repoDir = resolve(scriptsDir, '..', '..', '..');
  const baseline = JSON.parse(readFileSync(join(scriptsDir, SECTION_SIGN_BASELINE_FILE), 'utf8'));
  const missingPath = join(scriptsDir, MISSING_SECTION_BASELINE_FILE);
  const missingBaseline = existsSync(missingPath) ? JSON.parse(readFileSync(missingPath, 'utf8')) : {};
  const report = docRefsReport(checkDocRefs(repoDir, baseline, missingBaseline));
  if (report.exitCode !== 0) out.error(report.message);
  else out.log(report.message);
  return report.exitCode;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// (b) 入口は子のプロセスで打つテスト（UT-DEV-DOCREF-09）で確かめ、カバレッジ（web-core-foundation.md 14.7 節）では数えない
/* v8 ignore if */
if (isMain) process.exit(runDocRefsCheck(dirname(fileURLToPath(import.meta.url)), console));
