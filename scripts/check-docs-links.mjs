#!/usr/bin/env node
/**
 * 設計ドキュメントの Wikilink 解決チェッカ。
 *
 * 本プロジェクトの設計書は `[[相対パス#見出し]]` 形式で相互参照し密結合している
 * （`.claude/rules/docs.rule.md`「文書同時改訂の原則」）。リンク切れは
 * 「反映済みのはずが実体は無い」という不整合を生み、過去に G3 / G19 / MJ-B1〜B5
 * として繰り返し検出された。人手の監査でしか見つからなかったため、機械化する。
 *
 * 検査内容:
 *   1. `[[path]]` / `[[path#anchor]]` の path が実在するか（参照元ファイルからの相対）
 *   2. `#anchor` が参照先の見出しに実在するか（数字節 `3.1` は見出し番号、それ以外は見出し文字列）
 *   3. `]][[#N]]` ショートハンド（直前リンクのファイルを暗黙に継承する曖昧記法）の検出
 *
 * 使い方: node scripts/check-docs-links.mjs [--warn-shorthand]
 * 終了コード: 0=OK / 1=リンク切れあり
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_ROOT = join(REPO_ROOT, 'docs');

/** `00_reference.md` §8 の運用ルール本文に出てくる記法プレースホルダ（実リンクではない）。 */
const NOTATION_PLACEHOLDERS = new Set(['file.md', '相対パス']);

/** 見出し行から「番号」と「本文」を取り出す。`### 4.1.1 Phase 2 実施順序` → { num: '4.1.1', text: 'Phase 2 実施順序' } */
function parseHeading(line) {
  const m = /^#{1,6}\s+(.*)$/.exec(line);
  if (m === null) return null;
  const body = m[1].trim();
  const numMatch = /^(\d+(?:\.\d+)*)[.．]?\s*(.*)$/.exec(body);
  return numMatch !== null ? { num: numMatch[1], text: numMatch[2].trim() } : { num: null, text: body };
}

/** Markdown ファイルの全見出しを収集する。 */
function collectHeadings(absPath) {
  const headings = [];
  for (const line of readFileSync(absPath, 'utf8').split(/\r?\n/)) {
    const h = parseHeading(line);
    if (h !== null) headings.push(h);
  }
  return headings;
}

/** アンカーが見出し群のどれかに一致するか。数字節は前方一致ではなく完全一致で見る。 */
function anchorExists(anchor, headings) {
  const a = anchor.trim();
  if (a === '') return true;
  if (/^\d+(\.\d+)*$/.test(a)) return headings.some((h) => h.num === a);
  // 非数値アンカーは見出し文字列の部分一致で許容する（章題での参照）。
  return headings.some((h) => h.text.includes(a) || `${h.num ?? ''} ${h.text}`.includes(a));
}

/** docs/ 配下の .md を再帰列挙。 */
function listMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listMarkdown(p));
    else if (entry.endsWith('.md')) out.push(p);
  }
  return out;
}

const headingCache = new Map();
function headingsOf(absPath) {
  if (!headingCache.has(absPath)) headingCache.set(absPath, collectHeadings(absPath));
  return headingCache.get(absPath);
}

const warnShorthand = process.argv.includes('--warn-shorthand');
const broken = [];
const shorthand = [];

for (const file of listMarkdown(DOCS_ROOT)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // `]][[#N]]` = 直前リンクのファイルを暗黙継承する曖昧記法。厳密には現ファイル §N に解決する。
    for (const m of line.matchAll(/\]\]\[\[#([^\]]+)\]\]/g)) {
      shorthand.push({ file, line: i + 1, anchor: m[1] });
    }
    for (const m of line.matchAll(/\[\[([^\]|#]+?)(?:#([^\]|]+))?\]\]/g)) {
      const target = m[1].trim();
      const anchor = m[2]?.trim() ?? '';
      if (NOTATION_PLACEHOLDERS.has(target)) continue;
      const abs = resolve(dirname(file), target);
      let exists = true;
      try {
        statSync(abs);
      } catch {
        exists = false;
      }
      if (!exists) {
        broken.push({
          file,
          line: i + 1,
          link: m[0],
          reason: `参照先ファイルが存在しない → ${relative(REPO_ROOT, abs)}`,
        });
        continue;
      }
      if (anchor !== '' && !anchorExists(anchor, headingsOf(abs))) {
        broken.push({ file, line: i + 1, link: m[0], reason: `参照先に見出し「${anchor}」が存在しない` });
      }
    }
  });
}

const rel = (p) => relative(REPO_ROOT, p).replace(/\\/g, '/');

if (shorthand.length > 0 && warnShorthand) {
  console.log(
    `\n[warn] ]][[#N]] ショートハンド ${shorthand.length} 件（直前リンクのファイルを暗黙継承する曖昧記法。フル表記推奨）`,
  );
  for (const s of shorthand.slice(0, 20)) console.log(`  ${rel(s.file)}:${s.line}  [[#${s.anchor}]]`);
  if (shorthand.length > 20) console.log(`  … 他 ${shorthand.length - 20} 件`);
}

if (broken.length === 0) {
  console.log(`docs Wikilink: OK（リンク切れ 0 件）`);
  process.exit(0);
}

console.error(`\ndocs Wikilink: ${broken.length} 件のリンク切れ\n`);
for (const b of broken) console.error(`  ${rel(b.file)}:${b.line}\n    ${b.link}\n    → ${b.reason}`);
console.error(`\n是正方針は .claude/rules/docs.rule.md（体裁）と .claude/rules/quality.rule.md（再発防止）を参照。`);
process.exit(1);
