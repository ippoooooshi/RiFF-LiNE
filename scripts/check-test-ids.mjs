#!/usr/bin/env node
/**
 * テスト ID の付与とプレフィックス予約のチェッカ。
 *
 * `.claude/rules/tests.rule.md` は「各テストの先頭コメントに、対応するテスト ID
 * （`// UT-XXX` / `// IT-XXX`）と、検証している詳細設計書の節番号を明記」することを
 * 求めているが、プレフィックスを予約する中央の台帳が無かったため（MJ-A5）、
 * 実際には 87 テストファイル中 26 ファイルが ID を 1 つも持たない状態だった（MJ-A7）。
 * 要件 → 設計 → API → テスト ID の鎖が最後の一段で切れると、
 * 「この要件を守るテストはどれか」を機械的に辿れなくなる。
 *
 * 検査内容:
 *   1. すべてのテストファイルが、予約済みプレフィックスの ID を最低 1 つ持つか
 *   2. 使われている ID のプレフィックスが、採番簿に予約されているか
 *
 * 採番簿の正: docs/basic_design/11_test_strategy.md §3.1（本スクリプトが同節から読み取る）
 *
 * 使い方: node scripts/check-test-ids.mjs
 * 終了コード: 0=OK / 1=違反あり
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(REPO_ROOT, 'docs', 'basic_design', '11_test_strategy.md');
const SCAN_ROOTS = [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')];

/** 採番簿（11_test_strategy.md §3.1）の表から予約済みプレフィックスを読む。 */
function loadReservedPrefixes() {
  const text = readFileSync(REGISTRY, 'utf8');
  const start = text.indexOf('### 3.1 テスト ID 採番簿');
  if (start < 0) {
    throw new Error('11_test_strategy.md に「### 3.1 テスト ID 採番簿」が見つからない（採番簿が正）');
  }
  const section = text.slice(start, text.indexOf('\n## ', start) === -1 ? undefined : text.indexOf('\n## ', start));
  const prefixes = new Set();
  for (const m of section.matchAll(/`((?:UT|IT)-[A-Z-]+?)-\*`/g)) prefixes.add(m[1]);
  if (prefixes.size === 0) throw new Error('採番簿からプレフィックスを 1 件も読み取れなかった');
  return prefixes;
}

/** テストファイルを再帰列挙（node_modules・dist は除く）。 */
function listTestFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listTestFiles(p));
    else if (/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const reserved = loadReservedPrefixes();
const missing = [];
const unknown = [];

for (const root of SCAN_ROOTS) {
  for (const file of listTestFiles(root)) {
    const text = readFileSync(file, 'utf8');
    // コメント中の ID のみを対象にする（テスト名の文字列と区別する）。
    const ids = [...text.matchAll(/\/\/[^\n]*?\b((?:UT|IT)-[A-Z0-9-]+)/g)].map((m) => m[1]);
    if (ids.length === 0) {
      missing.push(file);
      continue;
    }
    for (const id of ids) {
      // 末尾の連番（-01 等）を落としながら、最長一致で予約プレフィックスを探す。
      const parts = id.split('-');
      const matched = parts.some((_, i) => reserved.has(parts.slice(0, parts.length - i).join('-')));
      if (!matched) unknown.push({ file, id });
    }
  }
}

const rel = (p) => relative(REPO_ROOT, p).replace(/\\/g, '/');

if (missing.length === 0 && unknown.length === 0) {
  console.log(`テスト ID: OK（予約プレフィックス ${reserved.size} 種、未付与 0 件）`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error(`\nテスト ID 未付与: ${missing.length} ファイル\n`);
  for (const f of missing) console.error(`  ${rel(f)}`);
}
if (unknown.length > 0) {
  const seen = new Set();
  console.error(`\n採番簿に無いプレフィックス: ${unknown.length} 箇所\n`);
  for (const u of unknown) {
    const key = `${u.file}|${u.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`  ${rel(u.file)}  ${u.id}`);
  }
}
console.error(
  `\n採番簿は docs/basic_design/11_test_strategy.md §3.1（正）。` +
    `\n各テストの先頭コメントに「// <ID> <検証対象の詳細設計書 §番号>」を書く（.claude/rules/tests.rule.md）。`,
);
process.exit(1);
