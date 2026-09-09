#!/usr/bin/env node
/**
 * 設計ドキュメントの相互参照チェッカ。
 *
 * 本プロジェクトの設計書は `[[相対パス#見出し]]` 形式で相互参照し密結合している
 * （`.claude/rules/docs.rule.md`「文書同時改訂の原則」）。リンク切れは
 * 「反映済みのはずが実体は無い」という不整合を生み、過去に G3 / G19 / MJ-B1〜B5
 * として繰り返し検出された。人手の監査でしか見つからなかったため、機械化する。
 *
 * 検査内容:
 *   1. `[[path]]` / `[[path#anchor]]` の path が実在するか（参照元ファイルからの相対）
 *   2. `#anchor` が参照先の見出しに実在するか（数字節 `3.1` は見出し番号、それ以外は見出し文字列）
 *   3. Markdown 相対リンク `[表示](相対パス.md#見出し)` も同様に検査する。
 *      `docs/` から `.claude/` への参照は Wikilink 規約外（docs.rule.md 体裁節）のため
 *      Markdown リンクで書く決まりだが、それが無検査だと MJ-B5 と同型の腐り方をする。
 *   4. `]][[#N]]` ショートハンド（直前リンクのファイルを暗黙に継承する曖昧記法）の検出
 *
 * コードスパン（`...`）とフェンスドコードブロックの中は記法の説明・監査記録での
 * 「壊れたリンクの引用」に使われるため、リンクとして解釈しない。
 *
 * 使い方: node scripts/check-docs-links.mjs [--warn-shorthand]
 * 終了コード: 0=OK / 1=リンク切れあり
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_ROOT = join(REPO_ROOT, 'docs');

/** 見出し行から「番号」と「本文」を取り出す。`### 4.1.1 Phase 2 実施順序` → { num: '4.1.1', text: 'Phase 2 実施順序' } */
function parseHeading(line) {
  const m = /^#{1,6}\s+(.*)$/.exec(line);
  if (m === null) return null;
  const body = m[1].trim();
  const numMatch = /^(\d+(?:\.\d+)*)[.．]?\s*(.*)$/.exec(body);
  return numMatch !== null ? { num: numMatch[1], text: numMatch[2].trim() } : { num: null, text: body };
}

/** Markdown ファイルの全見出しを収集する。フェンス内の `#` はコメント行なので除外する。 */
function collectHeadings(absPath) {
  const headings = [];
  let inFence = false;
  for (const line of readFileSync(absPath, 'utf8').split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
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

/** インラインコードスパンを同じ長さの空白へ潰す（列位置を保つため）。 */
function stripCodeSpans(line) {
  return line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
}

const warnShorthand = process.argv.includes('--warn-shorthand');
const broken = [];
const shorthand = [];

/** 参照先ファイル＋アンカーを検査し、問題があれば broken へ積む。 */
function verify(file, lineNo, rawLink, targetPath, anchor) {
  const abs = resolve(dirname(file), targetPath);
  let exists = true;
  try {
    statSync(abs);
  } catch {
    exists = false;
  }
  if (!exists) {
    broken.push({
      file,
      line: lineNo,
      link: rawLink,
      reason: `参照先ファイルが存在しない → ${relative(REPO_ROOT, abs)}`,
    });
    return;
  }
  if (anchor !== '' && !anchorExists(anchor, headingsOf(abs))) {
    broken.push({ file, line: lineNo, link: rawLink, reason: `参照先に見出し「${anchor}」が存在しない` });
  }
}

for (const file of listMarkdown(DOCS_ROOT)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inFence = false;
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const line = stripCodeSpans(raw);

    // `]][[#N]]` = 直前リンクのファイルを暗黙継承する曖昧記法。厳密には現ファイル §N に解決する。
    for (const m of line.matchAll(/\]\]\[\[#([^\]]+)\]\]/g)) {
      shorthand.push({ file, line: i + 1, anchor: m[1] });
    }

    // Wikilink `[[相対パス#見出し]]`（docs 内文書間の規定形式）
    for (const m of line.matchAll(/\[\[([^\]|#]+?)(?:#([^\]|]+))?\]\]/g)) {
      verify(file, i + 1, m[0], m[1].trim(), m[2]?.trim() ?? '');
    }

    // Markdown 相対リンク `[表示](相対パス.md#見出し)`（docs → .claude 等の規定形式）
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const [path, anchor = ''] = href.split('#');
      if (!path.endsWith('.md')) continue;
      verify(file, i + 1, m[0], path, anchor);
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
  console.log(`docs 相互参照: OK（リンク切れ 0 件）`);
  process.exit(0);
}

console.error(`\ndocs 相互参照: ${broken.length} 件のリンク切れ\n`);
for (const b of broken) console.error(`  ${rel(b.file)}:${b.line}\n    ${b.link}\n    → ${b.reason}`);
console.error(`\n是正方針は .claude/rules/docs.rule.md（体裁）と .claude/rules/quality.rule.md（再発防止）を参照。`);
process.exit(1);
